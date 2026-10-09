[CmdletBinding()]
param(
    [string]$PackageDirectory,
    [int]$WaitAttempts = 320
)

$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-ProcessByExactPath([string]$Path) {
    $expected = [IO.Path]::GetFullPath($Path)
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        [string]$_.ExecutablePath -and [IO.Path]::GetFullPath([string]$_.ExecutablePath) -ieq $expected
    })
}

function Get-NodeChild([string]$EntryPath, [int]$ParentPid) {
    $entry = [IO.Path]::GetFullPath($EntryPath).Replace('/', '\')
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        [string]$_.Name -ieq 'node.exe' -and
        [int]$_.ParentProcessId -eq $ParentPid -and
        [string]$_.CommandLine -and
        $_.CommandLine.Replace('/', '\').IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
}

function Read-Json([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        $json = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
        try { return $json | ConvertFrom-Json -DateKind String } catch { return $json | ConvertFrom-Json }
    }
    catch { return $null }
}

function IsFreshState($State, [DateTime]$StartedAt) {
    if ($null -eq $State -or [string]::IsNullOrWhiteSpace([string]$State.updated_at)) { return $false }
    try { return [DateTime]::Parse([string]$State.updated_at).ToUniversalTime() -ge $StartedAt.ToUniversalTime() } catch { return $false }
}

function Wait-State([string]$StatePath, [string]$TunnelPath, [string]$EntryPath, [int]$PreviousChildPid, [DateTime]$StartedAt) {
    for ($attempt = 0; $attempt -lt $WaitAttempts; $attempt++) {
        $state = Read-Json $StatePath
        if ((IsFreshState $state $StartedAt) -and [string]$state.status -eq 'running' -and [string]$state.registration -eq 'ready' -and [int]$state.mcp_child_pid -gt 0 -and [int]$state.mcp_child_pid -ne $PreviousChildPid) {
            return $state
        }
        Start-Sleep -Milliseconds 250
    }
    return $null
}

function Wait-ExactIdentity($State, [string]$TunnelPath, [string]$EntryPath) {
    for ($attempt = 0; $attempt -lt $WaitAttempts; $attempt++) {
        $parents = @(Get-ProcessByExactPath $TunnelPath)
        $children = @(Get-NodeChild $EntryPath ([int]$State.parent_pid))
        if ($parents.Count -eq 1 -and [int]$parents[0].ProcessId -eq [int]$State.parent_pid -and $children.Count -eq 1 -and [int]$children[0].ProcessId -eq [int]$State.mcp_child_pid) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

$packageRoot = [IO.Path]::GetFullPath($PackageDirectory).TrimEnd('\')
$executable = Join-Path $packageRoot 'LocalCodexBridge.exe'
$entry = Join-Path $packageRoot 'dist\index.js'
$tunnel = Join-Path $packageRoot 'tunnel-client.exe'
$stateRoot = Join-Path $env:LOCALAPPDATA 'BridgeCodex\V6Preview'
$statePath = Join-Path $stateRoot 'run\tunnel-state.json'
$settingsPath = Join-Path $stateRoot 'desktop-settings.json'
$hostPath = Join-Path $stateRoot 'run\desktop-host-status.json'
$ownershipPath = Join-Path $stateRoot 'run\desktop-ownership.json'
Assert-True (Test-Path -LiteralPath $executable -PathType Leaf) ('Candidate executable missing: ' + $executable)
Assert-True (Test-Path -LiteralPath $tunnel -PathType Leaf) ('Candidate Tunnel missing: ' + $tunnel)
Assert-True ((Get-ProcessByExactPath $executable).Count -eq 0) 'Candidate executable is already running.'
Assert-True ((Get-ProcessByExactPath $tunnel).Count -eq 0) 'Candidate Tunnel is already running.'

$process = $null
try {
    $startedAt = [DateTime]::UtcNow
    $process = Start-Process -FilePath $executable -WorkingDirectory $packageRoot -WindowStyle Hidden -PassThru
    $settings = $null
    for ($attempt = 0; $attempt -lt $WaitAttempts; $attempt++) {
        if ($process.HasExited) { throw ('Candidate exited before Tunnel settings became available: ' + $process.ExitCode) }
        $settings = Read-Json $settingsPath
        if ($null -ne $settings -and [bool]$settings.startTunnel -and [string]$settings.bridgeWorkingDirectory -like ($packageRoot + '*')) { break }
        Start-Sleep -Milliseconds 250
    }
    Assert-True ($null -ne $settings -and [bool]$settings.startTunnel) 'Candidate did not enable its configured V6 Tunnel.'
    $state = $null
    for ($attempt = 0; $attempt -lt $WaitAttempts; $attempt++) {
        $state = Read-Json $statePath
        if ((IsFreshState $state $startedAt) -and [string]$state.status -eq 'running' -and [string]$state.registration -eq 'ready' -and [int]$state.parent_pid -gt 0 -and [int]$state.mcp_child_pid -gt 0 -and [string]$state.transport_status -eq 'ready') { break }
        if ($process.HasExited) { throw ('Candidate exited while waiting for Tunnel readiness: ' + $process.ExitCode) }
        Start-Sleep -Milliseconds 250
    }
    Assert-True ($null -ne $state -and [string]$state.registration -eq 'ready') 'Tunnel did not reach ready with child identity.'
    $parentPid = [int]$state.parent_pid
    $childPid = [int]$state.mcp_child_pid
    Assert-True (Wait-ExactIdentity $state $tunnel $entry) 'Recorded Tunnel parent/child identity is not live.'
    Write-Output ('TUNNEL_READY parent=' + $parentPid + ' child=' + $childPid + ' registration=ready')

    Stop-Process -Id $childPid -Force
    Write-Output ('SIMULATED_EXACT_MCP_CHILD_CRASH pid=' + $childPid)
    $recovered = Wait-State $statePath $tunnel $entry $childPid $startedAt
    Assert-True ($null -ne $recovered) 'Tunnel did not recover to ready with a new MCP child.'
    $newParentPid = [int]$recovered.parent_pid
    $newChildPid = [int]$recovered.mcp_child_pid
    Assert-True ($newChildPid -ne $childPid) 'Recovery reused the crashed MCP child identity.'
    Assert-True ([string]$recovered.transport_status -eq 'ready') 'Recovered transport status was not ready.'
    Assert-True (Wait-ExactIdentity $recovered $tunnel $entry) 'Recovered Tunnel parent/child identity is not live.'
    $health = Invoke-WebRequest -Uri (([string]$recovered.health_url).TrimEnd('/') + '/readyz') -UseBasicParsing -TimeoutSec 5
    Assert-True ([int]$health.StatusCode -eq 200) 'Recovered Tunnel health probe was not HTTP 200.'
    Write-Output ('TUNNEL_CHILD_RECOVERY_OK parent=' + $newParentPid + ' child=' + $newChildPid + ' transport=ready')
}
finally {
    if ($null -ne $process) {
        try { Start-Process -FilePath $executable -ArgumentList '--signal-exit' -WorkingDirectory $packageRoot -WindowStyle Hidden -Wait | Out-Null } catch { }
    }
}

for ($attempt = 0; $attempt -lt $WaitAttempts; $attempt++) {
    if ((Get-ProcessByExactPath $executable).Count -eq 0 -and (Get-ProcessByExactPath $tunnel).Count -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $stateRoot 'run\tunnel-client.pid') -PathType Leaf)) { break }
    Start-Sleep -Milliseconds 250
}
Assert-True ((Get-ProcessByExactPath $executable).Count -eq 0) 'Candidate executable remained after recovery test.'
Assert-True ((Get-ProcessByExactPath $tunnel).Count -eq 0) 'Candidate Tunnel remained after recovery test.'
$finalState = Read-Json $statePath
Assert-True ($null -ne $finalState -and [string]$finalState.status -eq 'stopped' -and [string]$finalState.registration -eq 'not_registered') 'Tunnel state did not become stopped after cleanup.'
Write-Output 'TUNNEL_CHILD_RECOVERY_CLEAN=PASS'
