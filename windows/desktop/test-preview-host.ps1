[CmdletBinding()]
param(
    [string]$PackageDirectory = (Join-Path (Get-Location) 'artifacts\BridgeCodex-Windows-portable-v6.0.0'),
    [string]$StateRoot = '',
    [switch]$CheckV5
)

$ErrorActionPreference = 'Stop'
try {
    $existingMutex = [System.Threading.Mutex]::OpenExisting('Local\BridgeCodex.V6Preview')
    $existingMutex.Dispose()
    throw 'Refusing GUI smoke while an existing Bridge owns the single-instance mutex. Exit it explicitly first.'
} catch [System.Threading.WaitHandleCannotBeOpenedException] { }
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$sourcePackageRoot = [IO.Path]::GetFullPath($PackageDirectory).TrimEnd('\')
# Exercise an exact isolated payload copy. WebView2's default profile belongs to
# this copy; GUI tests must never contaminate the distributable with browser data.
$packageRoot = Join-Path ([IO.Path]::GetTempPath()) ('lcb-gui-'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $packageRoot | Out-Null
$manifest = Join-Path $sourcePackageRoot 'PACKAGE-MANIFEST.json'
if (Test-Path -LiteralPath $manifest) {
    foreach ($file in @(Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json)) {
        $sourcePath = [IO.Path]::GetFullPath((Join-Path $sourcePackageRoot $file.path))
        $targetPath = [IO.Path]::GetFullPath((Join-Path $packageRoot $file.path))
        if (-not $sourcePath.StartsWith($sourcePackageRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or
            -not $targetPath.StartsWith($packageRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe package test path.' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath
        if ((Get-FileHash -LiteralPath $targetPath).Hash -ne $file.sha256) { throw 'Test copy differs from manifest.' }
    }
} else {
    Get-ChildItem -LiteralPath $sourcePackageRoot -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $packageRoot }
    Copy-Item -LiteralPath (Join-Path $sourcePackageRoot 'dist') -Destination (Join-Path $packageRoot 'dist') -Recurse
}
$previewExecutable = Join-Path $packageRoot 'LocalCodexBridge.exe'
if (-not (Test-Path -LiteralPath $previewExecutable -PathType Leaf)) { $previewExecutable = Join-Path $packageRoot 'BridgeCodex-V6-Preview.exe' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
if ([string]::IsNullOrWhiteSpace($StateRoot)) {
    $previewRoot = Join-Path $repoRoot ('.staging\preview-host-'+[guid]::NewGuid().ToString('N'))
    $previewArguments = @('--test-state-root', ('"' + $previewRoot + '"'))
} else {
    $previewRoot = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
    if (-not $previewRoot.StartsWith($repoRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'StateRoot must stay inside the V6-dev checkout.' }
    $previewArguments = @('--test-state-root', ('"' + $previewRoot + '"'))
}
$settingsPath = Join-Path $previewRoot 'desktop-settings.json'
$hostStatusPath = Join-Path $previewRoot 'run\desktop-host-status.json'
Assert-True (Test-Path -LiteralPath $previewExecutable -PathType Leaf) "Preview executable was not found: $previewExecutable"

$v5BeforeBody = $null
$v5LineBefore = $null
$v5PidBefore = 0
if ($CheckV5) {
    $v5Before = Invoke-WebRequest -Uri 'http://127.0.0.1:37821/api/status' -UseBasicParsing -TimeoutSec 5
    $v5BeforeBody = $v5Before.Content | ConvertFrom-Json
    $v5LineBefore = @(netstat.exe -ano | Select-String -Pattern '\s127\.0\.0\.1:37821\s+\S+\s+LISTENING\s+\d+') | Select-Object -First 1
    if ($v5LineBefore) { $v5PidBefore = [int](($v5LineBefore.ToString().Trim() -split '\s+')[-1]) }
}

$previewProcess = $null
$failure = $null
try {
    $previewProcess = Start-Process -FilePath $previewExecutable -ArgumentList $previewArguments -WorkingDirectory $packageRoot -WindowStyle Hidden -PassThru
    $settings = $null
    for ($i = 0; $i -lt 60; $i++) {
        if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
            try {
                $candidate = Get-Content -Raw -Encoding UTF8 -LiteralPath $settingsPath | ConvertFrom-Json
                $candidateRoot = [IO.Path]::GetFullPath([string]$candidate.bridgeWorkingDirectory).TrimEnd('\')
                if ($candidate.statusUrl -and [bool]$candidate.previewMode -and $candidateRoot -eq $packageRoot) {
                    $settings = $candidate
                    break
                }
            } catch { }
        }
        Start-Sleep -Milliseconds 200
    }
    Assert-True ($null -ne $settings) 'Preview settings did not become available.'
    $previewUri = [Uri]$settings.statusUrl
    Assert-True ($previewUri.Port -ge 37930 -and $previewUri.Port -le 37939 -and $previewUri.Port -ne 37821) ('Preview status port is not isolated: ' + $previewUri.Port)
    $settingsRoot = [IO.Path]::GetFullPath([string]$settings.bridgeWorkingDirectory).TrimEnd('\')
    Assert-True ($settingsRoot -eq $packageRoot) ('Preview runtime root mismatch: actual=' + $settingsRoot + ' expected=' + $packageRoot)
    Assert-True ([string]$settings.bridgeEntry -eq 'dist\index.js') ('Preview entry mismatch: ' + [string]$settings.bridgeEntry)
    Assert-True (-not [bool]$settings.startTunnel) 'Isolated host test unexpectedly enabled the V6 Tunnel without a test key.'
    $metadata = Get-Content -Raw -LiteralPath (Join-Path $packageRoot 'package.json') | ConvertFrom-Json
    if ($metadata.tunnel_bundled -ne $false) {
        Assert-True (Test-Path -LiteralPath (Join-Path $packageRoot 'tunnel-client.exe') -PathType Leaf) 'Declared bundled Tunnel client is missing.'
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $packageRoot 'tunnel-profile.template.yaml') -PathType Leaf) 'V6 Tunnel profile template is missing from the Preview package.'
    Assert-True ([string]$settings.serviceSessionFile -eq (Join-Path $previewRoot 'service_sessions.json')) 'Preview service session file is not isolated.'

    $previewStatus = $null
    for ($i = 0; $i -lt 80; $i++) {
        try {
            $statusResponse = Invoke-WebRequest -Uri $settings.statusUrl -UseBasicParsing -TimeoutSec 2
            if ([int]$statusResponse.StatusCode -eq 200) {
                $previewStatus = $statusResponse.Content | ConvertFrom-Json
                break
            }
        } catch { Start-Sleep -Milliseconds 250 }
    }
    Assert-True ($null -ne $previewStatus) ('Preview status API did not become ready on port ' + $previewUri.Port)

    $hostStatus = $null
    for ($i = 0; $i -lt 100; $i++) {
        if (Test-Path -LiteralPath $hostStatusPath -PathType Leaf) {
            try {
                $candidate = Get-Content -Raw -Encoding UTF8 -LiteralPath $hostStatusPath | ConvertFrom-Json
                if ([int]$candidate.host_pid -eq $previewProcess.Id -and [string]$candidate.host_mode -eq 'WebView2' -and [bool]$candidate.app_loaded -and [string]$candidate.detail -eq 'control-center-dom-ready') {
                    $hostStatus = $candidate
                    break
                }
            } catch { }
        }
        if ($previewProcess.HasExited) { break }
        Start-Sleep -Milliseconds 300
    }
    if ($null -eq $hostStatus) {
        $detail = ''
        if (Test-Path -LiteralPath $hostStatusPath -PathType Leaf) {
            try { $detail = (Get-Content -Raw -Encoding UTF8 -LiteralPath $hostStatusPath | ConvertFrom-Json | Out-String).Trim() } catch { }
        }
        throw ('Preview host did not prove WebView2 + /app loaded. ' + $detail)
    }

    $appResponse = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $previewUri.Port + '/app') -UseBasicParsing -TimeoutSec 5
    Assert-True ([int]$appResponse.StatusCode -eq 200) 'Preview /app did not return HTTP 200.'
    Assert-True ($appResponse.Content -match 'Local Codex Bridge') 'Preview /app content did not contain Local Codex Bridge.'
    Assert-True ([string]$previewStatus.bridge.product_name -eq 'Local Codex Bridge') 'Preview status product name mismatch.'
    $listener = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $previewUri.Port -State Listen -ErrorAction SilentlyContinue) | Select-Object -First 1
    Assert-True ($null -ne $listener) 'Preview status port was not listening.'

    if ($CheckV5) {
        $v5During = Invoke-WebRequest -Uri 'http://127.0.0.1:37821/api/status' -UseBasicParsing -TimeoutSec 5
        $v5DuringBody = $v5During.Content | ConvertFrom-Json
        Assert-True ([int]$v5During.StatusCode -eq 200 -and [string]$v5DuringBody.bridge.status -eq 'running' -and [string]$v5DuringBody.bridge.version -eq [string]$v5BeforeBody.bridge.version) 'V5 changed during Preview host test.'
        $v5LineDuring = @(netstat.exe -ano | Select-String -Pattern '\s127\.0\.0\.1:37821\s+\S+\s+LISTENING\s+\d+') | Select-Object -First 1
        if ($v5PidBefore -ne 0 -and $v5LineDuring) {
            $v5PidDuring = [int](($v5LineDuring.ToString().Trim() -split '\s+')[-1])
            Assert-True ($v5PidDuring -eq $v5PidBefore) 'V5 status listener PID changed during Preview host test.'
        }
    }
    Assert-True ([string]$hostStatus.detail -eq 'control-center-dom-ready') 'Preview host did not prove Control Center DOM readiness.'
    Write-Output ('PREVIEW_HOST_WEBVIEW2_OK port=' + $previewUri.Port + ' host_pid=' + $previewProcess.Id + ' app_loaded=true dom_ready=true')
}
catch {
    $failure = $_.Exception.Message
}
finally {
    if ($previewProcess -and -not $previewProcess.HasExited) {
        $identity = Get-CimInstance Win32_Process -Filter ('ProcessId='+$previewProcess.Id)
        if ($identity -and $identity.ExecutablePath -eq $previewExecutable) {
            $signal = Start-Process -FilePath $previewExecutable -ArgumentList @('--signal-exit','--test-state-root',('"'+$previewRoot+'"')) -WindowStyle Hidden -PassThru
            $signal.WaitForExit(5000) | Out-Null
            if (-not $previewProcess.WaitForExit(20000)) { throw 'Owned host did not exit gracefully; inspect exact identity, do not kill by process name.' }
        }
    }
    Start-Sleep -Milliseconds 800
}
if ($failure) { throw $failure }
if ($previewProcess -and (Get-Process -Id $previewProcess.Id -ErrorAction SilentlyContinue)) { throw 'Preview host process remained after cleanup.' }

if ($CheckV5) {
    $v5After = Invoke-WebRequest -Uri 'http://127.0.0.1:37821/api/status' -UseBasicParsing -TimeoutSec 5
    $v5AfterBody = $v5After.Content | ConvertFrom-Json
    Assert-True ([int]$v5After.StatusCode -eq 200 -and [string]$v5AfterBody.bridge.status -eq 'running' -and [string]$v5AfterBody.bridge.version -eq [string]$v5BeforeBody.bridge.version) 'V5 was not healthy after Preview host cleanup.'
    $v5LineAfter = @(netstat.exe -ano | Select-String -Pattern '\s127\.0\.0\.1:37821\s+\S+\s+LISTENING\s+\d+') | Select-Object -First 1
    $v5PidAfter = 0
    if ($v5LineAfter) { $v5PidAfter = [int](($v5LineAfter.ToString().Trim() -split '\s+')[-1]) }
    if ($v5PidBefore -ne 0) { Assert-True ($v5PidAfter -eq $v5PidBefore) ('V5 status listener PID changed after Preview cleanup to ' + $v5PidAfter) }
    Write-Output ('V5_UNCHANGED_AFTER_PREVIEW port=37821 pid=' + $v5PidAfter)
} else {
    Write-Output 'V5_CHECK_SKIPPED_NO_V5_RUNTIME'
}
