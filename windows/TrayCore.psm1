Set-StrictMode -Version Latest

function Resolve-LocalCodexBridgeSettings {
    param(
        [string]$SettingsPath = (Join-Path $PSScriptRoot 'local-settings.json'),
        [hashtable]$Environment = $null
    )

    $settings = $null
    if (Test-Path -LiteralPath $SettingsPath -PathType Leaf) {
        try {
            $settings = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            throw "Local settings file is not valid JSON: $SettingsPath"
        }
    }

    $definitions = @(
        [pscustomobject]@{ Key = 'ReadyUrl'; Json = 'readyUrl'; Names = @('LOCAL_CODEX_BRIDGE_READY_URL', 'LUMEN_CODEX_V2_READY_URL') },
        [pscustomobject]@{ Key = 'StatusUrl'; Json = 'statusUrl'; Names = @('LOCAL_CODEX_BRIDGE_STATUS_URL', 'LUMEN_CODEX_V2_STATUS_URL') },
        [pscustomobject]@{ Key = 'StatusPageUrl'; Json = 'statusPageUrl'; Names = @('LOCAL_CODEX_BRIDGE_STATUS_PAGE_URL', 'LUMEN_CODEX_V2_STATUS_PAGE_URL') },
        [pscustomobject]@{ Key = 'ProfileName'; Json = 'tunnelProfile'; Names = @('LOCAL_CODEX_BRIDGE_TUNNEL_PROFILE', 'LUMEN_CODEX_V2_TUNNEL_PROFILE') },
        [pscustomobject]@{ Key = 'TunnelExecutable'; Json = 'tunnelExecutable'; Names = @('LOCAL_CODEX_BRIDGE_TUNNEL_EXE', 'LUMEN_CODEX_V2_TUNNEL_EXE') },
        [pscustomobject]@{ Key = 'RuntimeKeyFile'; Json = 'runtimeKeyFile'; Names = @('LOCAL_CODEX_BRIDGE_RUNTIME_KEY_FILE', 'LUMEN_CODEX_V2_RUNTIME_KEY_FILE') },
        [pscustomobject]@{ Key = 'LogDirectory'; Json = 'logDirectory'; Names = @('LOCAL_CODEX_BRIDGE_LOG_DIR', 'LUMEN_CODEX_V2_LOG_DIR') },
        [pscustomobject]@{ Key = 'ProjectionPath'; Json = 'projectionPath'; Names = @('LOCAL_CODEX_BRIDGE_PROJECTION_PATH', 'LOCAL_CODEX_BRIDGE_UX_PROJECTION', 'LUMEN_CODEX_V2_PROJECTION_PATH', 'LUMEN_CODEX_V2_UX_PROJECTION') },
        [pscustomobject]@{ Key = 'CheckpointDirectory'; Json = 'checkpointDirectory'; Names = @('LOCAL_CODEX_BRIDGE_CHECKPOINT_DIR', 'LUMEN_CODEX_V2_CHECKPOINT_DIR') }
    )
    $resolved = @{}
    foreach ($definition in $definitions) {
        $value = $null
        foreach ($name in $definition.Names) {
            if ($null -ne $Environment) {
                if ($Environment.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$Environment[$name])) {
                    $value = [string]$Environment[$name]
                    break
                }
            } else {
                $environmentValue = [Environment]::GetEnvironmentVariable($name, 'Process')
                if (-not [string]::IsNullOrWhiteSpace($environmentValue)) {
                    $value = $environmentValue
                    break
                }
            }
        }
        if ([string]::IsNullOrWhiteSpace($value) -and $null -ne $settings) {
            $property = $settings.PSObject.Properties[$definition.Json]
            if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
                $value = [string]$property.Value
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $resolved[$definition.Key] = [Environment]::ExpandEnvironmentVariables($value).Trim()
        }
    }

    if (-not $resolved.ContainsKey('ProjectionPath')) {
        $localAppData = if ($null -ne $Environment -and $Environment.ContainsKey('LOCALAPPDATA')) {
            [string]$Environment['LOCALAPPDATA']
        } else {
            [Environment]::GetEnvironmentVariable('LOCALAPPDATA', 'Process')
        }
        if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
            $resolved['ProjectionPath'] = Join-Path $localAppData 'LocalCodexBridge\ux-projection.json'
        }
    }

    $appData = if ($null -ne $Environment -and $Environment.ContainsKey('APPDATA')) {
        [string]$Environment['APPDATA']
    } else {
        [Environment]::GetEnvironmentVariable('APPDATA', 'Process')
    }
    $localAppData = if ($null -ne $Environment -and $Environment.ContainsKey('LOCALAPPDATA')) {
        [string]$Environment['LOCALAPPDATA']
    } else {
        [Environment]::GetEnvironmentVariable('LOCALAPPDATA', 'Process')
    }

    if (-not $resolved.ContainsKey('StatusUrl')) {
        $resolved['StatusUrl'] = 'http://127.0.0.1:37821/api/status'
    }
    if (-not $resolved.ContainsKey('StatusPageUrl')) {
        $resolved['StatusPageUrl'] = 'http://127.0.0.1:37821/status'
    }
    if (-not $resolved.ContainsKey('RuntimeKeyFile') -and -not [string]::IsNullOrWhiteSpace($appData)) {
        $keyCandidates = @(
            (Join-Path $appData 'LocalCodexBridge\runtime_key_v5.securestring'),
            (Join-Path $appData 'LocalCodexBridge\control_plane_api_key.dpapi')
        )
        $existingKey = $keyCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        $resolved['RuntimeKeyFile'] = if ($existingKey) { $existingKey } else { $keyCandidates[0] }
    }
    if (-not $resolved.ContainsKey('LogDirectory') -and -not [string]::IsNullOrWhiteSpace($localAppData)) {
        $resolved['LogDirectory'] = Join-Path $localAppData 'LocalCodexBridge\logs'
    }

    return [pscustomobject]@{
        ReadyUrl = if ($resolved.ContainsKey('ReadyUrl')) { $resolved['ReadyUrl'] } else { $null }
        StatusUrl = if ($resolved.ContainsKey('StatusUrl')) { $resolved['StatusUrl'] } else { $null }
        StatusPageUrl = if ($resolved.ContainsKey('StatusPageUrl')) { $resolved['StatusPageUrl'] } else { $null }
        ProfileName = if ($resolved.ContainsKey('ProfileName')) { $resolved['ProfileName'] } else { $null }
        TunnelExecutable = if ($resolved.ContainsKey('TunnelExecutable')) { $resolved['TunnelExecutable'] } else { $null }
        RuntimeKeyFile = if ($resolved.ContainsKey('RuntimeKeyFile')) { $resolved['RuntimeKeyFile'] } else { $null }
        LogDirectory = if ($resolved.ContainsKey('LogDirectory')) { $resolved['LogDirectory'] } else { $null }
        ProjectionPath = if ($resolved.ContainsKey('ProjectionPath')) { $resolved['ProjectionPath'] } else { $null }
        CheckpointDirectory = if ($resolved.ContainsKey('CheckpointDirectory')) { $resolved['CheckpointDirectory'] } else { $null }
    }
}

function New-ProjectionCursor {
    [pscustomobject]@{
        Generation = $null
        Sequence = [long]0
    }
}

function Resolve-TrayIconState {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('stopped', 'starting', 'ready', 'attention', 'error')]
        [string]$BaseState,

        [Parameter(Mandatory = $true)]
        [long]$WaitingCount
    )

    if ($BaseState -eq 'error') { return 'error' }
    if ($WaitingCount -gt 0) { return 'attention' }
    return $BaseState
}

function Resolve-NotReadyBaseIconState {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('stopped', 'starting', 'ready', 'attention', 'error')]
        [string]$CurrentBaseState,

        [Parameter(Mandatory = $true)]
        [bool]$HasOwnership
    )

    if ($HasOwnership) { return 'starting' }
    if ($CurrentBaseState -eq 'starting' -or $CurrentBaseState -eq 'attention') { return $CurrentBaseState }
    return 'stopped'
}

function Select-NewProjectionSignals {
    param(
        [Parameter(Mandatory = $true)]$Cursor,
        [Parameter(Mandatory = $true)]$Projection
    )

    $generation = [string]$Projection.generation.id
    $sequence = [long]$Projection.sequence
    if ([string]::IsNullOrWhiteSpace([string]$Cursor.Generation) -or $Cursor.Generation -cne $generation) {
        $Cursor.Generation = $generation
        $Cursor.Sequence = $sequence
        return @()
    }

    $newSignals = @($Projection.signals) |
        Where-Object { [long]$_.sequence -gt [long]$Cursor.Sequence } |
        Sort-Object { [long]$_.sequence }
    $Cursor.Sequence = [Math]::Max([long]$Cursor.Sequence, $sequence)
    return @($newSignals)
}

function Resolve-TerminalNotice {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Status
    )

    switch ($Status) {
        'completed' {
            return [pscustomobject]@{
                Title = Get-TrayText 'Codex \u56de\u5408\u5df2\u5b8c\u6210'
                Text = Get-TrayText 'Codex \u56de\u5408\u5df2\u6210\u529f\u5b8c\u6210\u3002'
            }
        }
        'interrupted' {
            return [pscustomobject]@{
                Title = Get-TrayText 'Codex \u56de\u5408\u5df2\u4e2d\u65ad'
                Text = Get-TrayText 'Codex \u56de\u5408\u5df2\u4e2d\u65ad\u6216\u53d6\u6d88\u3002'
            }
        }
        default {
            return [pscustomobject]@{
                Title = Get-TrayText 'Codex \u56de\u5408\u5931\u8d25'
                Text = (Get-TrayText 'Codex \u56de\u5408\u5931\u8d25\u6216\u5f02\u5e38\u7ed3\u675f\uff08\u72b6\u6001\uff1a') + $Status + (Get-TrayText '\uff09\u3002')
            }
        }
    }
}

function Test-TunnelOwnershipEvidence {
    param(
        [Parameter(Mandatory = $true)]$Ownership,
        [Parameter(Mandatory = $true)]$Observation,
        [Parameter(Mandatory = $true)][long]$PidFileValue
    )

    try {
        if ($Ownership.Process.HasExited) { return $false }
    } catch {
        return $false
    }

    if ([int]$Ownership.Process.Id -ne [int]$Ownership.ProcessId) { return $false }
    if ([int]$Observation.ProcessId -ne [int]$Ownership.ProcessId) { return $false }
    if ($PidFileValue -ne [long]$Ownership.ProcessId) { return $false }
    if ([long]$Observation.StartTimeUtcTicks -ne [long]$Ownership.StartTimeUtcTicks) { return $false }
    if (-not [string]::Equals(
        [string]$Observation.ExecutablePath,
        [string]$Ownership.ExecutablePath,
        [StringComparison]::OrdinalIgnoreCase)) { return $false }
    if (-not [string]::Equals(
        [string]$Observation.CommandLine,
        [string]$Ownership.LaunchCommandLine,
        [StringComparison]::Ordinal)) { return $false }
    if (-not [string]::Equals(
        [string]$Observation.ProfileName,
        [string]$Ownership.ProfileName,
        [StringComparison]::Ordinal)) { return $false }
    if (-not [string]::Equals(
        [string]$Observation.PidFilePath,
        [string]$Ownership.PidFilePath,
        [StringComparison]::OrdinalIgnoreCase)) { return $false }
    return $true
}

function Get-TrayProperty {
    param(
        [AllowNull()]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-TrayText {
    param([Parameter(Mandatory = $true)][string]$Escaped)

    return (('"' + $Escaped + '"') | ConvertFrom-Json)
}

function Convert-TrayTaskStatusLabel {
    param([AllowNull()][string]$Status)

    switch ($Status) {
        'NEED_CONFIRM' { return Get-TrayText '\u5f85\u786e\u8ba4' }
        'RUNNING' { return Get-TrayText '\u6267\u884c\u4e2d' }
        'STARTING' { return Get-TrayText '\u542f\u52a8\u4e2d' }
        'WAITING' { return Get-TrayText '\u7b49\u5f85\u4e2d' }
        'QUEUED' { return Get-TrayText '\u6392\u961f\u4e2d' }
        'RECOVERY_REQUIRED' { return Get-TrayText '\u9700\u8981\u6062\u590d' }
        'COMPLETED' { return Get-TrayText '\u5df2\u5b8c\u6210' }
        'DONE' { return Get-TrayText '\u5df2\u5b8c\u6210' }
        'FAILED' { return Get-TrayText '\u5931\u8d25' }
        'INTERRUPTED' { return Get-TrayText '\u5df2\u4e2d\u65ad' }
        default {
            if ([string]::IsNullOrWhiteSpace($Status)) { return Get-TrayText '\u7a7a\u95f2' }
            return $Status
        }
    }
}

function Format-TrayStatusSummary {
    param(
        [Parameter(Mandatory = $true)]$Snapshot
    )

    $bridge = Get-TrayProperty $Snapshot 'bridge'
    $appServer = Get-TrayProperty $Snapshot 'appServer'
    $appServerStatus = Get-TrayProperty $appServer 'status'
    $modelPolicy = Get-TrayProperty $Snapshot 'modelPolicy'
    $workers = Get-TrayProperty $Snapshot 'workers'
    $queue = Get-TrayProperty $Snapshot 'queue'
    $tasks = Get-TrayProperty $Snapshot 'tasks'
    $dashboard = Get-TrayProperty $Snapshot 'dashboard'
    $current = Get-TrayProperty $tasks 'current'

    $bridgeIsRunning = ([string](Get-TrayProperty $bridge 'status')) -eq 'running'
    $codexIsRunning = ([string](Get-TrayProperty $appServerStatus 'process_state')) -eq 'running'
    $bridgeLabel = if ($bridgeIsRunning) { Get-TrayText '\u5df2\u8fde\u63a5' } else { Get-TrayText '\u5f02\u5e38' }
    $codexLabel = if ($codexIsRunning) { Get-TrayText '\u6b63\u5e38' } else { Get-TrayText '\u5f02\u5e38' }
    $model = [string](Get-TrayProperty $modelPolicy 'policy_model')
    $effort = [string](Get-TrayProperty $modelPolicy 'policy_effort')
    $modelLabel = if ($model -eq 'gpt-5.6-luna' -and $effort -eq 'max') { 'Luna Max' } elseif ([string]::IsNullOrWhiteSpace($model)) { Get-TrayText '\u672a\u77e5' } else { $model }

    $currentStatus = [string](Get-TrayProperty $current 'status')
    $currentLabel = Convert-TrayTaskStatusLabel $currentStatus
    $currentTitle = [string](Get-TrayProperty $current 'name')
    if ([string]::IsNullOrWhiteSpace($currentTitle)) { $currentTitle = '-' }

    $bridgeRunning = [int](Get-TrayProperty $workers 'bridge_running')
    if ($null -eq (Get-TrayProperty $workers 'bridge_running')) {
        $bridgeRunning = [int](Get-TrayProperty $workers 'running')
    }
    $workerMax = [int](Get-TrayProperty $workers 'max')
    if ($workerMax -le 0) { $workerMax = 5 }
    $nativeActive = [int](Get-TrayProperty $dashboard 'native_active_count')
    if ($null -eq (Get-TrayProperty $dashboard 'native_active_count')) {
        $nativeActive = [int](Get-TrayProperty $workers 'native_active')
    }
    $queueCount = [int](Get-TrayProperty $queue 'waiting_count')
    $pendingCount = [int](Get-TrayProperty $dashboard 'pending_confirmation_count')
    if ($null -eq (Get-TrayProperty $dashboard 'pending_confirmation_count')) {
        $pendingItems = Get-TrayProperty $tasks 'pending_confirmations'
        $pendingCount = if ($null -eq $pendingItems) { 0 } else { @($pendingItems).Count }
    }

    [pscustomobject]@{
        IsHealthy = $bridgeIsRunning -and $codexIsRunning
        Bridge = $bridgeLabel
        Codex = $codexLabel
        Model = $modelLabel
        Current = $currentLabel
        CurrentTitle = $currentTitle
        BridgeRunning = $bridgeRunning
        WorkerMax = $workerMax
        NativeActive = $nativeActive
        Queue = $queueCount
        Pending = $pendingCount
        Lines = @(
            "Bridge：$bridgeLabel"
            "Codex：$codexLabel"
            ((Get-TrayText '\u6a21\u578b\u7b56\u7565\uff1a') + $modelLabel)
            ((Get-TrayText '\u5f53\u524d\u4efb\u52a1\uff1a') + $currentLabel)
            ((Get-TrayText '\u5f53\u524d\u6807\u9898\uff1a') + $currentTitle)
            ((Get-TrayText '\u5e76\u53d1\uff1a') + "$bridgeRunning/$workerMax")
            ((Get-TrayText '\u539f\u751f\u6d3b\u8dc3\uff1a') + "$nativeActive")
            ((Get-TrayText '\u6392\u961f\uff1a') + "$queueCount")
            ((Get-TrayText '\u5f85\u786e\u8ba4\uff1a') + "$pendingCount")
        )
    }
}

function Resolve-TrayStartupDecision {
    param(
        [Parameter(Mandatory = $true)][bool]$BridgeHealthy,
        [Parameter(Mandatory = $true)][bool]$ExistingTunnel,
        [Parameter(Mandatory = $true)][bool]$ReadyPortInUse,
        [Parameter(Mandatory = $true)][bool]$StatusPortInUse
    )

    if ($BridgeHealthy) { return 'reuse-bridge' }
    if ($ExistingTunnel) { return 'reuse-tunnel' }
    if ($ReadyPortInUse) { return 'ready-port-conflict' }
    if ($StatusPortInUse) { return 'status-port-conflict' }
    return 'start'
}

Export-ModuleMember -Function Resolve-LocalCodexBridgeSettings, New-ProjectionCursor, Resolve-TrayIconState, Resolve-NotReadyBaseIconState, Select-NewProjectionSignals, Resolve-TerminalNotice, Test-TunnelOwnershipEvidence, Get-TrayProperty, Get-TrayText, Convert-TrayTaskStatusLabel, Format-TrayStatusSummary, Resolve-TrayStartupDecision
