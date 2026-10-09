param(
    [string]$ReadyUrl,
    [string]$StatusUrl,
    [string]$StatusPageUrl,
    [string]$ProfileName,
    [string]$TunnelExecutable,
    [string]$RuntimeKeyFile,
    [string]$LogDirectory,
    [string]$ProjectionPath,
    [string]$CheckpointDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Import-Module (Join-Path $PSScriptRoot 'TrayCore.psm1') -Force

$settings = Resolve-LocalCodexBridgeSettings
if ([string]::IsNullOrWhiteSpace($ReadyUrl)) { $ReadyUrl = $settings.ReadyUrl }
if ([string]::IsNullOrWhiteSpace($StatusUrl)) { $StatusUrl = $settings.StatusUrl }
if ([string]::IsNullOrWhiteSpace($StatusPageUrl)) { $StatusPageUrl = $settings.StatusPageUrl }
if ([string]::IsNullOrWhiteSpace($ProfileName)) { $ProfileName = $settings.ProfileName }
if ([string]::IsNullOrWhiteSpace($TunnelExecutable)) { $TunnelExecutable = $settings.TunnelExecutable }
if ([string]::IsNullOrWhiteSpace($RuntimeKeyFile)) { $RuntimeKeyFile = $settings.RuntimeKeyFile }
if ([string]::IsNullOrWhiteSpace($LogDirectory)) { $LogDirectory = $settings.LogDirectory }
if ([string]::IsNullOrWhiteSpace($ProjectionPath)) { $ProjectionPath = $settings.ProjectionPath }
if ([string]::IsNullOrWhiteSpace($CheckpointDirectory)) { $CheckpointDirectory = $settings.CheckpointDirectory }

$readyUri = $null
if (
    [string]::IsNullOrWhiteSpace($ReadyUrl) -or
    -not [Uri]::TryCreate($ReadyUrl, [UriKind]::Absolute, [ref]$readyUri) -or
    @('http', 'https') -notcontains $readyUri.Scheme
) {
    throw 'ReadyUrl is required and must be an absolute HTTP(S) URL. Use -ReadyUrl or LOCAL_CODEX_BRIDGE_READY_URL.'
}
$statusUri = $null
if (
    [string]::IsNullOrWhiteSpace($StatusUrl) -or
    -not [Uri]::TryCreate($StatusUrl, [UriKind]::Absolute, [ref]$statusUri) -or
    @('http', 'https') -notcontains $statusUri.Scheme
) {
    throw 'StatusUrl is required and must be an absolute HTTP(S) URL. Use -StatusUrl or LOCAL_CODEX_BRIDGE_STATUS_URL.'
}
$statusPageUri = $null
if (
    [string]::IsNullOrWhiteSpace($StatusPageUrl) -or
    -not [Uri]::TryCreate($StatusPageUrl, [UriKind]::Absolute, [ref]$statusPageUri) -or
    @('http', 'https') -notcontains $statusPageUri.Scheme
) {
    throw 'StatusPageUrl is required and must be an absolute HTTP(S) URL. Use -StatusPageUrl or LOCAL_CODEX_BRIDGE_STATUS_PAGE_URL.'
}
if ([string]::IsNullOrWhiteSpace($ProfileName) -or $ProfileName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw 'ProfileName is required and may contain only letters, numbers, dot, underscore, and hyphen. Use -ProfileName or LOCAL_CODEX_BRIDGE_TUNNEL_PROFILE.'
}
if ([string]::IsNullOrWhiteSpace($TunnelExecutable) -or -not [IO.Path]::IsPathRooted($TunnelExecutable)) {
    throw 'TunnelExecutable is required and must be an absolute path. Use -TunnelExecutable or LOCAL_CODEX_BRIDGE_TUNNEL_EXE.'
}
if ([string]::IsNullOrWhiteSpace($ProjectionPath) -or -not [IO.Path]::IsPathRooted($ProjectionPath)) {
    throw 'ProjectionPath is required and must be absolute. Use -ProjectionPath or LOCAL_CODEX_BRIDGE_PROJECTION_PATH.'
}
if (-not [string]::IsNullOrWhiteSpace($CheckpointDirectory) -and -not [IO.Path]::IsPathRooted($CheckpointDirectory)) {
    throw 'CheckpointDirectory must be absolute when configured. Use LOCAL_CODEX_BRIDGE_CHECKPOINT_DIR.'
}
if (-not [string]::IsNullOrWhiteSpace($RuntimeKeyFile) -and -not [IO.Path]::IsPathRooted($RuntimeKeyFile)) {
    throw 'RuntimeKeyFile must be absolute when configured. Use LOCAL_CODEX_BRIDGE_RUNTIME_KEY_FILE.'
}
if ([string]::IsNullOrWhiteSpace($LogDirectory)) {
    throw 'LogDirectory is required. Use -LogDirectory or LOCAL_CODEX_BRIDGE_LOG_DIR.'
}
if (-not [IO.Path]::IsPathRooted($LogDirectory)) {
    throw 'LogDirectory must be absolute. Use -LogDirectory or LOCAL_CODEX_BRIDGE_LOG_DIR.'
}

$script:Ownership = $null
$script:Cursor = New-ProjectionCursor
$script:LastReady = $null
$script:WaitingCount = [long]0
$script:BaseIconState = 'stopped'
$script:TrayIcons = @{}
$script:OwnedTrayIcons = New-Object System.Collections.ArrayList
$script:LastSnapshot = $null
$script:LastSummary = $null
$script:TrayMutex = $null
$script:LogFile = Join-Path $LogDirectory 'tunnel-client.log'

$createdNewMutex = $false
$script:TrayMutex = New-Object Threading.Mutex($false, "Local\LocalCodexBridgeTray.$ProfileName", [ref]$createdNewMutex)
if (-not $createdNewMutex) {
    [Windows.Forms.MessageBox]::Show(
        (Get-TrayText 'Local Codex Bridge \u6258\u76d8\u5df2\u7ecf\u5728\u8fd0\u884c\u3002'),
        'Local Codex Bridge',
        [Windows.Forms.MessageBoxButtons]::OK,
        [Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    $script:TrayMutex.Dispose()
    exit 0
}

function Test-FormalReady {
    try {
        $request = [Net.HttpWebRequest]::Create($ReadyUrl)
        $request.Method = 'GET'
        $request.Timeout = 3000
        $request.ReadWriteTimeout = 3000
        $response = $request.GetResponse()
        try { return [int]$response.StatusCode -eq 200 } finally { $response.Dispose() }
    } catch {
        return $false
    }
}

function Get-FormalIdentityFromCommandLine([string]$CommandLine) {
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $null }
    $profilePattern = '(?i)(?:^|\s)--profile\s+(?:"?' + [regex]::Escape($ProfileName) + '"?)(?:\s|$)'
    $pidPattern = '(?i)(?:^|\s)--pid\.file\s+(?:"([^"]+)"|(\S+))'
    if ($CommandLine -notmatch '(?i)(?:^|\s)run(?:\s|$)' -or $CommandLine -notmatch $profilePattern) { return $null }
    $pidMatch = [regex]::Match($CommandLine, $pidPattern)
    $pidPath = if ($pidMatch.Success) {
        if ($pidMatch.Groups[1].Success) { $pidMatch.Groups[1].Value } else { $pidMatch.Groups[2].Value }
    } else {
        $null
    }
    [pscustomobject]@{
        ProfileName = $ProfileName
        PidFilePath = if ($pidPath) { [IO.Path]::GetFullPath($pidPath) } else { $null }
    }
}

function Get-JsonEndpoint([string]$Url) {
    try {
        $request = [Net.HttpWebRequest]::Create($Url)
        $request.Method = 'GET'
        $request.Timeout = 2500
        $request.ReadWriteTimeout = 2500
        $request.Proxy = $null
        $response = $request.GetResponse()
        try {
            $reader = New-Object IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
            try {
                return ($reader.ReadToEnd() | ConvertFrom-Json)
            } finally {
                $reader.Dispose()
            }
        } finally {
            $response.Dispose()
        }
    } catch {
        return $null
    }
}

function Get-BridgeStatusSnapshot {
    return Get-JsonEndpoint $StatusUrl
}

function Test-BridgeHealthy($Snapshot) {
    if ($null -eq $Snapshot) { return $false }
    $bridge = Get-TrayProperty $Snapshot 'bridge'
    $bridgeStatus = [string](Get-TrayProperty $bridge 'status')
    return $bridgeStatus -eq 'running'
}

function Test-LocalPortInUse([Uri]$Uri) {
    if ($null -eq $Uri -or $Uri.Port -le 0) { return $false }
    try {
        return @(
            Get-NetTCPConnection -State Listen -LocalPort $Uri.Port -ErrorAction Stop
        ).Count -gt 0
    } catch {
        return $false
    }
}

function Read-RuntimeApiKey {
    if ([string]::IsNullOrWhiteSpace($RuntimeKeyFile)) {
        throw 'Runtime API Key file is not configured.'
    }
    if (-not (Test-Path -LiteralPath $RuntimeKeyFile -PathType Leaf)) {
        throw "Runtime API Key file was not found: $RuntimeKeyFile"
    }

    $cipher = [IO.File]::ReadAllText($RuntimeKeyFile).Trim()
    if ([string]::IsNullOrWhiteSpace($cipher)) { throw 'Runtime API Key file is empty.' }
    $secure = ConvertTo-SecureString -String $cipher
    $plain = [Net.NetworkCredential]::new('', $secure).Password
    if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Runtime API Key decrypted to an empty value.' }
    return $plain
}

function Open-StatusPage {
    Start-Process -FilePath $StatusPageUrl | Out-Null
}

function Open-LogDirectory {
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    Start-Process -FilePath 'explorer.exe' -ArgumentList @($LogDirectory) | Out-Null
}

function Open-LogFile {
    if (-not (Test-Path -LiteralPath $script:LogFile -PathType Leaf)) {
        Open-LogDirectory
        return
    }
    Start-Process -FilePath 'notepad.exe' -ArgumentList @($script:LogFile) | Out-Null
}

function Show-StatusOverview {
    $snapshot = Get-BridgeStatusSnapshot
    if ($null -eq $snapshot) {
        [Windows.Forms.MessageBox]::Show(
            ((Get-TrayText 'Bridge \u5f53\u524d\u4e0d\u53ef\u7528\u3002') + "`r`n`r`n" + (Get-TrayText '\u72b6\u6001\u63a5\u53e3\uff1a') + $StatusUrl + "`r`n" + (Get-TrayText '\u65e5\u5fd7\u76ee\u5f55\uff1a') + $LogDirectory),
            (Get-TrayText 'Local Codex Bridge \u72b6\u6001\u6982\u89c8'),
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
    }
    $summary = Format-TrayStatusSummary $snapshot
    [Windows.Forms.MessageBox]::Show(
        ($summary.Lines -join "`r`n"),
        (Get-TrayText 'Local Codex Bridge \u72b6\u6001\u6982\u89c8'),
        [Windows.Forms.MessageBoxButtons]::OK,
        $(if ($summary.IsHealthy) { [Windows.Forms.MessageBoxIcon]::Information } else { [Windows.Forms.MessageBoxIcon]::Warning })
    ) | Out-Null
}

function Get-TunnelObservation([int]$ProcessId, $RetainedProcess = $null) {
    $cim = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    if ($null -eq $cim) { return $null }
    $identity = Get-FormalIdentityFromCommandLine ([string]$cim.CommandLine)
    if ($null -eq $identity) { return $null }
    if (-not [string]::Equals([IO.Path]::GetFullPath([string]$cim.ExecutablePath), [IO.Path]::GetFullPath($TunnelExecutable), [StringComparison]::OrdinalIgnoreCase)) { return $null }
    $process = if ($null -ne $RetainedProcess) { $RetainedProcess } else { [Diagnostics.Process]::GetProcessById($ProcessId) }
    [pscustomobject]@{
        ProcessId = $ProcessId
        ExecutablePath = [IO.Path]::GetFullPath([string]$cim.ExecutablePath)
        StartTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks
        CommandLine = [string]$cim.CommandLine
        ProfileName = $identity.ProfileName
        PidFilePath = $identity.PidFilePath
    }
}

function Find-FormalTunnelProcess {
    foreach ($candidate in @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'tunnel-client.exe'" -ErrorAction SilentlyContinue)) {
        try {
            $observation = Get-TunnelObservation ([int]$candidate.ProcessId)
            if ($null -ne $observation) { return $observation }
        } catch { }
    }
    return $null
}

function Initialize-TrayIcons {
    $iconDirectory = Join-Path $PSScriptRoot 'icons'
    $definitions = @{
        stopped = [pscustomobject]@{ FileName = 'stopped.ico'; Fallback = [Drawing.SystemIcons]::Application }
        starting = [pscustomobject]@{ FileName = 'starting.ico'; Fallback = [Drawing.SystemIcons]::Information }
        ready = [pscustomobject]@{ FileName = 'ready.ico'; Fallback = [Drawing.SystemIcons]::Asterisk }
        attention = [pscustomobject]@{ FileName = 'attention.ico'; Fallback = [Drawing.SystemIcons]::Warning }
        error = [pscustomobject]@{ FileName = 'error.ico'; Fallback = [Drawing.SystemIcons]::Error }
    }

    foreach ($state in $definitions.Keys) {
        $definition = $definitions[$state]
        $path = Join-Path $iconDirectory $definition.FileName
        try {
            $icon = New-Object Drawing.Icon -ArgumentList ([IO.Path]::GetFullPath($path))
            $script:TrayIcons[$state] = $icon
            $null = $script:OwnedTrayIcons.Add($icon)
        } catch {
            $script:TrayIcons[$state] = $definition.Fallback
        }
    }
}

function Set-TrayIconState {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('stopped', 'starting', 'ready', 'attention', 'error')]
        [string]$State
    )

    $notifyIcon.Icon = $script:TrayIcons[$State]
}

function Refresh-TrayIcon {
    Set-TrayIconState (Resolve-TrayIconState $script:BaseIconState $script:WaitingCount)
}

function Show-Notice([string]$Title, [string]$Text) {
    $notifyIcon.BalloonTipTitle = $Title
    $notifyIcon.BalloonTipText = $Text
    $notifyIcon.ShowBalloonTip(4000)
}

function Set-TrayStatus {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)]
        [ValidateSet('stopped', 'starting', 'ready', 'attention', 'error')]
        [string]$IconState
    )

    $statusItem.Text = (Get-TrayText '\u72b6\u6001\uff1a') + $Text
    $notifyIcon.Text = if ($Text.Length -le 63) { $Text } else { $Text.Substring(0, 63) }
    $script:BaseIconState = $IconState
    Refresh-TrayIcon
}

function Read-ProjectionSignals {
    if (-not (Test-Path -LiteralPath $ProjectionPath -PathType Leaf)) { return }
    try {
        $projection = Get-Content -LiteralPath $ProjectionPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $script:WaitingCount = [Math]::Max([long]0, [long]$projection.counts.waiting)
        Refresh-TrayIcon
        foreach ($signal in @(Select-NewProjectionSignals $script:Cursor $projection)) {
            switch ([string]$signal.kind) {
                'waiting_approval' { Show-Notice (Get-TrayText 'Codex \u9700\u8981\u5ba1\u6279') (Get-TrayText 'Codex \u56de\u5408\u6b63\u5728\u7b49\u5f85\u5ba1\u6279\u3002') }
                'waiting_user_input' { Show-Notice (Get-TrayText 'Codex \u9700\u8981\u8f93\u5165') (Get-TrayText 'Codex \u56de\u5408\u6b63\u5728\u7b49\u5f85\u7528\u6237\u8f93\u5165\u3002') }
                'terminal' {
                    $notice = Resolve-TerminalNotice ([string]$signal.status)
                    Show-Notice $notice.Title $notice.Text
                }
            }
        }
    } catch {
        Set-TrayStatus 'Projection unavailable' 'error'
    }
}

function Clear-ExitedOwnership {
    if ($null -eq $script:Ownership) { return }
    try {
        if ($script:Ownership.Process.HasExited) {
            Remove-Item -LiteralPath $script:Ownership.PidFilePath -Force -ErrorAction SilentlyContinue
            $script:Ownership = $null
        }
    } catch { }
}

function Update-ReadyStatus {
    Clear-ExitedOwnership
    $snapshot = Get-BridgeStatusSnapshot
    if ($null -ne $snapshot) {
        $script:LastSnapshot = $snapshot
        $script:LastSummary = Format-TrayStatusSummary $snapshot
        $iconState = if ($script:LastSummary.IsHealthy) {
            if ($script:LastSummary.Pending -gt 0) { 'attention' } else { 'ready' }
        } else {
            'error'
        }
        Set-TrayStatus (
            ((Get-TrayText 'Bridge\uff1a') + $script:LastSummary.Bridge + ' | ' + (Get-TrayText '\u5f53\u524d\uff1a') + $script:LastSummary.Current + ' | ' + (Get-TrayText '\u5e76\u53d1\uff1a') + "$($script:LastSummary.BridgeRunning)/$($script:LastSummary.WorkerMax)")
        ) $iconState
        $script:LastReady = $true
        return
    }

    $ready = Test-FormalReady
    if ($ready) {
        Set-TrayStatus $(if ($null -ne $script:Ownership) { Get-TrayText 'Tunnel \u5df2\u8fde\u63a5\uff0cBridge \u6b63\u5728\u542f\u52a8' } else { Get-TrayText 'Tunnel \u5df2\u8fde\u63a5\uff0cBridge \u72b6\u6001\u4e0d\u53ef\u7528' }) 'starting'
    } elseif ($null -ne (Find-FormalTunnelProcess)) {
        Set-TrayStatus (Get-TrayText 'Tunnel \u5df2\u8fd0\u884c\uff0c\u7b49\u5f85\u5c31\u7eea') 'starting'
    } else {
        $notReadyState = Resolve-NotReadyBaseIconState $script:BaseIconState ($null -ne $script:Ownership)
        Set-TrayStatus (Get-TrayText 'Bridge \u672a\u8fde\u63a5') $notReadyState
        if ($script:LastReady -eq $true) { Show-Notice (Get-TrayText 'Local Codex Bridge \u5df2\u65ad\u5f00') (Get-TrayText 'Bridge \u72b6\u6001\u63a5\u53e3\u4e0d\u53ef\u7528\uff0c\u672a\u81ea\u52a8\u91cd\u542f\u73b0\u6709\u5916\u90e8\u5b9e\u4f8b\u3002') }
    }
    $script:LastReady = $ready
}

function Start-FormalTunnel {
    Clear-ExitedOwnership
    $existingSnapshot = Get-BridgeStatusSnapshot
    $existingBridgeIsHealthy = Test-BridgeHealthy $existingSnapshot
    $existingTunnel = Find-FormalTunnelProcess
    $readyPortInUse = Test-LocalPortInUse $readyUri
    $statusPortInUse = Test-LocalPortInUse $statusUri
    $startupDecision = Resolve-TrayStartupDecision $existingBridgeIsHealthy ($null -ne $existingTunnel) $readyPortInUse $statusPortInUse

    if ($startupDecision -eq 'reuse-bridge') {
        $script:LastSnapshot = $existingSnapshot
        $script:LastSummary = Format-TrayStatusSummary $existingSnapshot
        Set-TrayStatus (Get-TrayText 'Bridge \u5df2\u5728\u8fd0\u884c\uff08\u5916\u90e8\u5b9e\u4f8b\uff09') 'ready'
        Show-Notice (Get-TrayText 'Local Codex Bridge \u5df2\u5728\u8fd0\u884c') (Get-TrayText '\u68c0\u6d4b\u5230\u5065\u5eb7\u5b9e\u4f8b\uff0c\u672a\u91cd\u590d\u542f\u52a8\uff0c\u4e5f\u672a\u7ec8\u6b62\u73b0\u6709\u5b9e\u4f8b\u3002')
        return
    }

    if ($startupDecision -eq 'reuse-tunnel') {
        Set-TrayStatus (Get-TrayText 'Tunnel \u5df2\u5728\u8fd0\u884c\uff0c\u7b49\u5f85 Bridge \u72b6\u6001') 'starting'
        Show-Notice (Get-TrayText 'Local Codex Bridge \u5df2\u5728\u8fd0\u884c') (Get-TrayText '\u68c0\u6d4b\u5230\u73b0\u6709 Tunnel\uff0c\u672a\u91cd\u590d\u7ed1\u5b9a 8080\uff0c\u4e5f\u672a\u7ec8\u6b62\u73b0\u6709\u5b9e\u4f8b\u3002')
        return
    }
    if (-not (Test-Path -LiteralPath $TunnelExecutable -PathType Leaf)) {
        Set-TrayStatus (Get-TrayText 'Tunnel \u7a0b\u5e8f\u4e0d\u5b58\u5728') 'error'
        Show-Notice (Get-TrayText 'Bridge \u542f\u52a8\u5931\u8d25') ((Get-TrayText '\u627e\u4e0d\u5230 tunnel-client\uff1a') + $TunnelExecutable)
        return
    }
    if ($startupDecision -eq 'ready-port-conflict') {
        Set-TrayStatus (Get-TrayText 'Tunnel \u7aef\u53e3\u88ab\u5176\u4ed6\u7a0b\u5e8f\u5360\u7528') 'error'
        Show-Notice (Get-TrayText '\u7aef\u53e3\u51b2\u7a81') ((Get-TrayText 'Tunnel \u7aef\u53e3 ') + "$($readyUri.Port)" + (Get-TrayText ' \u5df2\u88ab\u975e Bridge \u8fdb\u7a0b\u5360\u7528\u3002\u672a\u542f\u52a8\u65b0\u5b9e\u4f8b\u3002'))
        return
    }
    if ($startupDecision -eq 'status-port-conflict') {
        Set-TrayStatus (Get-TrayText 'Bridge \u72b6\u6001\u7aef\u53e3\u88ab\u5176\u4ed6\u7a0b\u5e8f\u5360\u7528') 'error'
        Show-Notice (Get-TrayText '\u7aef\u53e3\u51b2\u7a81') ((Get-TrayText 'Bridge \u72b6\u6001\u7aef\u53e3 ') + "$($statusUri.Port)" + (Get-TrayText ' \u5df2\u88ab\u5360\u7528\uff0c\u65e0\u6cd5\u5b89\u5168\u542f\u52a8\u3002'))
        return
    }

    try {
        $runtimeKey = Read-RuntimeApiKey
        New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
        $runDirectory = Join-Path $env:LOCALAPPDATA 'LocalCodexBridge\run'
        [IO.Directory]::CreateDirectory($runDirectory) | Out-Null
        $pidFile = Join-Path $runDirectory ("tunnel-{0}.pid" -f [guid]::NewGuid().ToString('N'))
        $startInfo = New-Object Diagnostics.ProcessStartInfo
        $startInfo.FileName = [IO.Path]::GetFullPath($TunnelExecutable)
        $startInfo.Arguments = "run --profile `"$ProfileName`" --pid.file `"$pidFile`" --log.file `"$script:LogFile`""
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $startInfo.EnvironmentVariables['CONTROL_PLANE_API_KEY'] = $runtimeKey
        $startInfo.EnvironmentVariables['LOCAL_CODEX_BRIDGE_UX_PROJECTION'] = [IO.Path]::GetFullPath($ProjectionPath)
        $startInfo.EnvironmentVariables['LUMEN_CODEX_V2_UX_PROJECTION'] = [IO.Path]::GetFullPath($ProjectionPath)
        if (-not [string]::IsNullOrWhiteSpace($CheckpointDirectory)) {
            $checkpointDirectoryPath = [IO.Path]::GetFullPath($CheckpointDirectory)
            $startInfo.EnvironmentVariables['LOCAL_CODEX_BRIDGE_CHECKPOINT_DIR'] = $checkpointDirectoryPath
            $startInfo.EnvironmentVariables['LUMEN_CODEX_V2_CHECKPOINT_DIR'] = $checkpointDirectoryPath
        }
        Set-TrayStatus (Get-TrayText '\u6b63\u5728\u540e\u53f0\u542f\u52a8 Bridge') 'starting'
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $startInfo
        if (-not $process.Start()) { throw 'tunnel-client process could not be started.' }
        $runtimeKey = $null
    } catch {
        $runtimeKey = $null
        Set-TrayStatus (Get-TrayText 'Bridge \u542f\u52a8\u5931\u8d25') 'error'
        Show-Notice (Get-TrayText 'Bridge \u542f\u52a8\u5931\u8d25') $_.Exception.Message
        return
    }

    $observation = $null
    for ($attempt = 0; $attempt -lt 50 -and $null -eq $observation; $attempt += 1) {
        Start-Sleep -Milliseconds 200
        try { $observation = Get-TunnelObservation $process.Id $process } catch { }
    }
    if ($null -eq $observation -or -not [string]::Equals($observation.PidFilePath, [IO.Path]::GetFullPath($pidFile), [StringComparison]::OrdinalIgnoreCase)) {
        Set-TrayStatus (Get-TrayText '\u5df2\u542f\u52a8\uff0c\u4f46\u672a\u53d6\u5f97\u6240\u6709\u6743\u8bc1\u660e') 'attention'
        Show-Notice (Get-TrayText 'Bridge \u5df2\u542f\u52a8') (Get-TrayText '\u65e0\u6cd5\u53d6\u5f97\u5f3a\u6240\u6709\u6743\u8bc1\u660e\uff0c\u56e0\u6b64\u672c Tray \u4e0d\u4f1a\u505c\u6b62\u8fd9\u4e2a\u5b9e\u4f8b\u3002')
        return
    }
    $script:Ownership = [pscustomobject]@{
        Process = $process
        ProcessId = $process.Id
        ExecutablePath = $observation.ExecutablePath
        StartTimeUtcTicks = $observation.StartTimeUtcTicks
        LaunchCommandLine = $observation.CommandLine
        ProfileName = $ProfileName
        PidFilePath = [IO.Path]::GetFullPath($pidFile)
    }
    Set-TrayStatus (Get-TrayText 'Bridge \u5df2\u542f\u52a8\uff0c\u7b49\u5f85\u72b6\u6001\u9875\u5c31\u7eea') 'starting'
}

function Stop-OwnedTunnel {
    if ($null -eq $script:Ownership) {
        Set-TrayStatus (Get-TrayText '\u672a\u505c\u6b62\uff1a\u5f53\u524d\u5b9e\u4f8b\u4e0d\u5c5e\u4e8e\u672c Tray') 'attention'
        Show-Notice (Get-TrayText '\u672a\u6267\u884c\u505c\u6b62') (Get-TrayText '\u5f53\u524d Bridge \u7531\u5176\u4ed6\u542f\u52a8\u5668\u7ba1\u7406\uff0c\u672c Tray \u4e0d\u4f1a\u7ec8\u6b62\u5b83\u3002')
        return
    }
    try {
        $pidText = (Get-Content -LiteralPath $script:Ownership.PidFilePath -Raw -Encoding ASCII).Trim()
        $pidValue = [long]$pidText
        $observation = Get-TunnelObservation $script:Ownership.ProcessId $script:Ownership.Process
        if ($null -eq $observation -or -not (Test-TunnelOwnershipEvidence $script:Ownership $observation $pidValue)) {
            Set-TrayStatus (Get-TrayText '\u672a\u505c\u6b62\uff1a\u6240\u6709\u6743\u6821\u9a8c\u4e0d\u4e00\u81f4') 'attention'
            Show-Notice (Get-TrayText '\u672a\u6267\u884c\u505c\u6b62') (Get-TrayText 'Tunnel \u8eab\u4efd\u65e0\u6cd5\u91cd\u65b0\u6838\u9a8c\uff0c\u672a\u7ec8\u6b62\u4efb\u4f55\u8fdb\u7a0b\u3002')
            return
        }
        $kill = Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', [string]$script:Ownership.ProcessId, '/T', '/F') -WindowStyle Hidden -Wait -PassThru
        if ($kill.ExitCode -ne 0) {
            throw "taskkill failed with exit code $($kill.ExitCode)."
        }
        $script:Ownership.Process.WaitForExit(3000) | Out-Null
        if (-not $script:Ownership.Process.HasExited) {
            throw 'Owned Tunnel did not exit.'
        }
        Remove-Item -LiteralPath $script:Ownership.PidFilePath -Force -ErrorAction SilentlyContinue
        $script:Ownership = $null
        Set-TrayStatus (Get-TrayText 'Bridge \u5df2\u505c\u6b62') 'stopped'
    } catch {
        Set-TrayStatus (Get-TrayText 'Bridge \u505c\u6b62\u5931\u8d25') 'error'
        Show-Notice (Get-TrayText 'Bridge \u505c\u6b62\u5931\u8d25') $_.Exception.Message
    }
}

function Restart-Bridge {
    if ($null -eq $script:Ownership) {
        Set-TrayStatus (Get-TrayText '\u672a\u91cd\u542f\uff1a\u5f53\u524d\u5b9e\u4f8b\u4e0d\u5c5e\u4e8e\u672c Tray') 'attention'
        Show-Notice (Get-TrayText '\u672a\u6267\u884c\u91cd\u542f') (Get-TrayText '\u5f53\u524d Bridge \u7531\u5176\u4ed6\u542f\u52a8\u5668\u7ba1\u7406\uff1b\u4e3a\u907f\u514d\u8bef\u6740\u5065\u5eb7\u5b9e\u4f8b\uff0c\u672c Tray \u672a\u6267\u884c\u91cd\u542f\u3002')
        return
    }
    Stop-OwnedTunnel
    if ($null -eq $script:Ownership) {
        Start-Sleep -Milliseconds 300
        Start-FormalTunnel
    }
}

function Exit-Tray {
    if ($null -ne $script:Ownership) { Stop-OwnedTunnel }
    $timer.Stop()
    [Windows.Forms.Application]::Exit()
}

Initialize-TrayIcons
$notifyIcon = New-Object Windows.Forms.NotifyIcon
$notifyIcon.Icon = $script:TrayIcons.stopped
$notifyIcon.Visible = $true
$notifyIcon.Text = 'Local Codex Bridge'
$menu = New-Object Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add((Get-TrayText 'Bridge\uff1a\u6b63\u5728\u8fde\u63a5'))
$statusItem.Enabled = $false
$menu.Items.Add((Get-TrayText '\u72b6\u6001\u6982\u89c8'), $null, { Show-StatusOverview }) | Out-Null
$menu.Items.Add((Get-TrayText '\u6253\u5f00\u5b8c\u6574\u72b6\u6001\u9875'), $null, { Open-StatusPage }) | Out-Null
$menu.Items.Add((Get-TrayText '\u67e5\u770b\u65e5\u5fd7'), $null, { Open-LogFile }) | Out-Null
$menu.Items.Add((Get-TrayText '\u6253\u5f00\u65e5\u5fd7\u76ee\u5f55'), $null, { Open-LogDirectory }) | Out-Null
$menu.Items.Add('-') | Out-Null
$menu.Items.Add((Get-TrayText '\u542f\u52a8 / \u8fde\u63a5 Bridge'), $null, { Start-FormalTunnel }) | Out-Null
$menu.Items.Add((Get-TrayText '\u91cd\u542f Bridge'), $null, { Restart-Bridge }) | Out-Null
$menu.Items.Add((Get-TrayText '\u505c\u6b62 Bridge'), $null, { Stop-OwnedTunnel }) | Out-Null
$menu.Items.Add('-') | Out-Null
$menu.Items.Add((Get-TrayText '\u9000\u51fa\u6258\u76d8'), $null, {
    Exit-Tray
}) | Out-Null
$notifyIcon.ContextMenuStrip = $menu

Read-ProjectionSignals
Start-FormalTunnel
Update-ReadyStatus
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 10000
$timer.Add_Tick({ Update-ReadyStatus; Read-ProjectionSignals })
$timer.Start()
try {
    [Windows.Forms.Application]::Run()
} finally {
    if ($null -ne $script:Ownership) {
        try { Stop-OwnedTunnel } catch { }
    }
    if ($null -ne $timer) {
        $timer.Stop()
        $timer.Dispose()
    }
    if ($null -ne $notifyIcon) {
        $notifyIcon.Visible = $false
        $notifyIcon.Dispose()
    }
    if ($null -ne $menu) { $menu.Dispose() }
    foreach ($icon in @($script:OwnedTrayIcons)) { $icon.Dispose() }
    if ($null -ne $script:TrayMutex) {
        try { $script:TrayMutex.ReleaseMutex() } catch { }
        $script:TrayMutex.Dispose()
    }
}
