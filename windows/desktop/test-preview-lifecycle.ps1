[CmdletBinding()]
param(
    [string]$PackageDirectory = (Join-Path (Get-Location) 'artifacts\BridgeCodex-Windows-portable-v6.0.0'),
    [string]$StateRoot = '',
    [switch]$CheckV5
)

$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-PreviewProcess([string]$EntryPath) {
    $nodePath = [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        [string]$_.Name -ieq 'node.exe' -and
        [string]$_.ExecutablePath -and
        [IO.Path]::GetFullPath([string]$_.ExecutablePath) -ieq $nodePath -and
        [string]$_.CommandLine -and
        [string]$_.CommandLine -like ('*' + $EntryPath + '*')
    })
    return $processes
}

function Get-ListenerPid([int]$Port) {
    $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $listener) { return 0 }
    return [int]$listener.OwningProcess
}

function Test-V6Mutex {
    try {
        $mutex = [System.Threading.Mutex]::OpenExisting('Local\BridgeCodex.V6Preview')
        $mutex.Dispose()
        return $true
    } catch [System.Threading.WaitHandleCannotBeOpenedException] {
        return $false
    } catch [System.UnauthorizedAccessException] {
        return $false
    }
}

function Get-OwnershipCount([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return 0 }
    try {
        $value = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
        if ($null -eq $value) { return 0 }
        return @($value.PSObject.Properties).Count
    } catch {
        return -1
    }
}

function New-PreviewArguments([string]$Root, [switch]$SignalExit) {
    $arguments = @('--test-state-root', ('"' + $Root + '"'))
    if ($SignalExit) { $arguments += '--signal-exit' }
    return ,$arguments
}

function Start-Preview([string]$Executable, [string]$Root, [switch]$SignalExit, [switch]$Wait) {
    if ($SignalExit) {
        $arguments = New-PreviewArguments -Root $Root -SignalExit
    } else {
        $arguments = New-PreviewArguments -Root $Root
    }
    if ($Wait) { return Start-Process -FilePath $Executable -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $Executable) -WindowStyle Hidden -Wait -PassThru }
    return Start-Process -FilePath $Executable -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $Executable) -WindowStyle Hidden -PassThru
}

function Wait-PreviewReady($Process, [string]$Root, [string]$PackageRoot, [string]$Executable) {
    $settingsPath = Join-Path $Root 'desktop-settings.json'
    $hostStatusPath = Join-Path $Root 'run\desktop-host-status.json'
    $settings = $null
    for ($i = 0; $i -lt 100; $i++) {
        if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
            try {
                $candidate = Get-Content -Raw -Encoding UTF8 -LiteralPath $settingsPath | ConvertFrom-Json
                $candidateRoot = [IO.Path]::GetFullPath([string]$candidate.bridgeWorkingDirectory).TrimEnd('\')
                if ([bool]$candidate.previewMode -and $candidateRoot -eq $PackageRoot) { $settings = $candidate; break }
            } catch { }
        }
        Start-Sleep -Milliseconds 200
    }
    Assert-True ($null -ne $settings) 'r3 Preview settings did not become available.'
    $uri = [Uri]$settings.statusUrl
    Assert-True ($uri.Port -ge 37930 -and $uri.Port -le 37939 -and $uri.Port -ne 37821) ('r3 Preview port is not isolated: ' + $uri.Port)
    Assert-True (-not [bool]$settings.startTunnel) 'Isolated lifecycle test unexpectedly enabled the V6 Tunnel without a test key.'
    $metadata = Get-Content -Raw -LiteralPath (Join-Path $PackageRoot 'package.json') | ConvertFrom-Json
    if ($metadata.tunnel_bundled -ne $false) {
        Assert-True (Test-Path -LiteralPath (Join-Path $PackageRoot 'tunnel-client.exe') -PathType Leaf) 'Declared bundled Tunnel client is missing from the lifecycle package.'
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $PackageRoot 'tunnel-profile.template.yaml') -PathType Leaf) 'V6 Tunnel profile template is missing from the lifecycle package.'
    Assert-True ([string]$settings.serviceSessionFile -eq (Join-Path $Root 'service_sessions.json')) 'r3 Preview state root is not isolated.'
    $status = $null
    for ($i = 0; $i -lt 100; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $settings.statusUrl -UseBasicParsing -TimeoutSec 2
            if ([int]$response.StatusCode -eq 200) { $status = $response.Content | ConvertFrom-Json; break }
        } catch { Start-Sleep -Milliseconds 250 }
    }
    Assert-True ($null -ne $status) ('r3 Preview status API did not become ready on port ' + $uri.Port)
    $hostStatus = $null
    for ($i = 0; $i -lt 120; $i++) {
        if (Test-Path -LiteralPath $hostStatusPath -PathType Leaf) {
            try {
                $candidate = Get-Content -Raw -Encoding UTF8 -LiteralPath $hostStatusPath | ConvertFrom-Json
                if ([int]$candidate.host_pid -eq $Process.Id -and [string]$candidate.host_mode -eq 'WebView2' -and [bool]$candidate.app_loaded) { $hostStatus = $candidate; break }
            } catch { }
        }
        if ($Process.HasExited) { break }
        Start-Sleep -Milliseconds 250
    }
    Assert-True ($null -ne $hostStatus) 'r3 Preview did not prove WebView2 app_loaded=true.'
    $app = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $uri.Port + '/app') -UseBasicParsing -TimeoutSec 5
    Assert-True ([int]$app.StatusCode -eq 200 -and $app.Content -match 'Local Codex Bridge') 'r3 Preview /app did not load.'
    Assert-True ((Get-ListenerPid $uri.Port) -gt 0) 'r3 Preview listener was not present.'
    return [pscustomobject]@{ Settings = $settings; Status = $status; HostStatus = $hostStatus; Port = $uri.Port }
}

function Wait-ProcessExit($Process, [string]$Label) {
    for ($i = 0; $i -lt 120; $i++) {
        if ($null -eq (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 250
    }
    throw ($Label + ' did not exit after signal.')
}

function Assert-PreviewClean([string]$Root, [string]$PackageRoot, [int]$Port, [string]$Label) {
    $entry = Join-Path $PackageRoot 'dist\index.js'
    Assert-True (@(Get-PreviewProcess $entry).Count -eq 0) ($Label + ' left a same-package Node process.')
    Assert-True ((Get-ListenerPid $Port) -eq 0) ($Label + ' left Preview listener on port ' + $Port + '.')
    Assert-True (-not (Test-V6Mutex)) ($Label + ' left the V6 Preview mutex.')
    Assert-True ((Get-OwnershipCount (Join-Path $Root 'run\desktop-ownership.json')) -eq 0) ($Label + ' left Preview ownership metadata.')
    $hostStatusPath = Join-Path $Root 'run\desktop-host-status.json'
    Assert-True (Test-Path -LiteralPath $hostStatusPath -PathType Leaf) ($Label + ' did not write stopped host status.')
    $hostStatus = Get-Content -Raw -Encoding UTF8 -LiteralPath $hostStatusPath | ConvertFrom-Json
    Assert-True ([int]$hostStatus.host_pid -eq 0 -and -not [bool]$hostStatus.app_loaded -and [string]$hostStatus.detail -eq 'stopped') ($Label + ' host status was not stopped/cleared.')
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
Assert-True (-not (Test-V6Mutex)) 'Refusing lifecycle smoke while an existing Bridge owns the single-instance mutex. Exit it explicitly first.'
$packageRoot = [IO.Path]::GetFullPath($PackageDirectory).TrimEnd('\')
$previewExecutable = Join-Path $packageRoot 'LocalCodexBridge.exe'
if (-not (Test-Path -LiteralPath $previewExecutable -PathType Leaf)) { $previewExecutable = Join-Path $packageRoot 'BridgeCodex-V6-Preview.exe' }
Assert-True (Test-Path -LiteralPath $previewExecutable -PathType Leaf) ('r3 Preview executable was not found: ' + $previewExecutable)
if ([string]::IsNullOrWhiteSpace($StateRoot)) { $StateRoot = Join-Path $repoRoot ('.staging\r3-preview-lifecycle-' + [Guid]::NewGuid().ToString('N')) }
$stateRoot = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
Assert-True ($stateRoot.StartsWith($repoRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'r3 lifecycle StateRoot must stay inside V6-dev.'
Assert-True (-not (Test-Path -LiteralPath $stateRoot)) ('Refusing to reuse an existing lifecycle StateRoot: ' + $stateRoot)
$v5BeforeBody = $null
$v5BeforePid = 0
if ($CheckV5) {
    $v5Before = Invoke-WebRequest -Uri 'http://127.0.0.1:37821/api/status' -UseBasicParsing -TimeoutSec 5
    $v5BeforeBody = $v5Before.Content | ConvertFrom-Json
    $v5BeforePid = Get-ListenerPid 37821
}
$first = $null
$second = $null
$restart = $null
$restartSignal = $null
try {
    $first = Start-Preview -Executable $previewExecutable -Root $stateRoot
    $ready = Wait-PreviewReady $first $stateRoot $packageRoot $previewExecutable
    $firstPort = $ready.Port
    Assert-True (Test-V6Mutex) 'r3 Preview mutex was not held while the host was resident.'
    $second = Start-Preview -Executable $previewExecutable -Root $stateRoot -Wait
    Assert-True ([int]$second.ExitCode -eq 0) 'Second r3 Preview launch did not signal the existing instance.'
    Assert-True ($null -ne (Get-Process -Id $first.Id -ErrorAction SilentlyContinue)) 'Second launch replaced or lost the resident Preview host.'
    $reopenedHost = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $stateRoot 'run\desktop-host-status.json') | ConvertFrom-Json
    Assert-True ([int]$reopenedHost.host_pid -eq $first.Id -and [bool]$reopenedHost.app_loaded) 'Second launch did not preserve/reopen WebView2 app_loaded state.'
    Write-Output ('SECOND_LAUNCH_REOPEN_OK host_pid=' + $first.Id + ' app_loaded=true')

    $exitSignal = Start-Preview -Executable $previewExecutable -Root $stateRoot -SignalExit -Wait
    Assert-True ([int]$exitSignal.ExitCode -eq 0) 'r3 Exit signal was not accepted.'
    Wait-ProcessExit $first 'First r3 Preview host'
    Assert-PreviewClean $stateRoot $packageRoot $firstPort 'First r3 Exit'
    Write-Output ('R3_EXIT_CLEAN_OK port=' + $firstPort + ' mutex=false')

    $restart = Start-Preview -Executable $previewExecutable -Root $stateRoot
    $restartReady = Wait-PreviewReady $restart $stateRoot $packageRoot $previewExecutable
    Assert-True ($restartReady.Port -eq $firstPort) 'r3 immediate restart changed the isolated test port unexpectedly.'
    Assert-True ([bool]$restartReady.HostStatus.app_loaded) 'r3 immediate restart did not load WebView2.'
    Write-Output ('R3_RESTART_OK host_pid=' + $restart.Id + ' port=' + $restartReady.Port + ' app_loaded=true')
    $restartSignal = Start-Preview -Executable $previewExecutable -Root $stateRoot -SignalExit -Wait
    Assert-True ([int]$restartSignal.ExitCode -eq 0) 'r3 restart Exit signal was not accepted.'
    Wait-ProcessExit $restart 'Restarted r3 Preview host'
    Assert-PreviewClean $stateRoot $packageRoot $restartReady.Port 'Restarted r3 Exit'
    Write-Output ('R3_RESTART_EXIT_CLEAN_OK port=' + $restartReady.Port + ' mutex=false')
}
finally {
    foreach ($process in @($first, $restart)) {
        if ($null -ne $process -and $null -ne (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
            try { $signal = Start-Preview -Executable $previewExecutable -Root $stateRoot -SignalExit -Wait } catch { }
        }
    }
    if (Test-Path -LiteralPath $stateRoot) { Remove-Item -LiteralPath $stateRoot -Recurse -Force }
}
if ($CheckV5) {
    $v5After = Invoke-WebRequest -Uri 'http://127.0.0.1:37821/api/status' -UseBasicParsing -TimeoutSec 5
    $v5AfterBody = $v5After.Content | ConvertFrom-Json
    $v5AfterPid = Get-ListenerPid 37821
    Assert-True ([int]$v5After.StatusCode -eq 200 -and [string]$v5AfterBody.bridge.status -eq 'running' -and [string]$v5AfterBody.bridge.version -eq [string]$v5BeforeBody.bridge.version) 'V5 changed during r3 lifecycle test.'
    Assert-True ($v5BeforePid -eq $v5AfterPid) ('V5 37821 listener PID changed from ' + $v5BeforePid + ' to ' + $v5AfterPid + '.')
    Write-Output ('V5_UNCHANGED_AFTER_R3_LIFECYCLE port=37821 pid=' + $v5AfterPid)
} else {
    Write-Output 'V5_CHECK_SKIPPED_NO_V5_RUNTIME'
}
