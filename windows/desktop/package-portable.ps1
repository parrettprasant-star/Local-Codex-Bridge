[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path (Get-Location) 'artifacts'),
    [string]$ReleaseLabel = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $repoRoot
$stagingRoot = Join-Path $repoRoot '.staging'
$desktopOutput = Join-Path $stagingRoot 'desktop'
$bridgeOutput = Join-Path $stagingRoot 'dist'
$package = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'package.json') | ConvertFrom-Json
$version = [string]$package.version
$release = if ([string]::IsNullOrWhiteSpace($ReleaseLabel)) { $version } else { $ReleaseLabel.Trim() }
if ($release -notmatch '^\d+\.\d+\.\d+$') { throw 'ReleaseLabel must use semantic version form x.y.z.' }
$name = 'BridgeCodex-Windows-portable-v' + $release
$packageRoot = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) $name
$zipPath = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) ($name + '.zip')
$webView2Version = '1.0.4129.50'

New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
& npm run build:staging
if ($LASTEXITCODE -ne 0) { throw "Bridge staging build failed with exit code $LASTEXITCODE" }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-desktop.ps1') -OutputDirectory $desktopOutput
if ($LASTEXITCODE -ne 0) { throw "Desktop build failed with exit code $LASTEXITCODE" }

if (Test-Path -LiteralPath $packageRoot) { Remove-Item -LiteralPath $packageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $desktopOutput 'LocalCodexBridge.Desktop.exe') -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $desktopOutput 'BridgeCodex-V6-Preview.exe') -Destination (Join-Path $packageRoot 'LocalCodexBridge.exe')
$webView2Files = @(
    (Join-Path $repoRoot 'windows\desktop\lib\net462\Microsoft.Web.WebView2.Core.dll'),
    (Join-Path $repoRoot 'windows\desktop\lib\net462\Microsoft.Web.WebView2.WinForms.dll'),
    (Join-Path $repoRoot 'windows\desktop\lib\runtimes\win-x64\native\WebView2Loader.dll')
)
foreach ($webView2File in $webView2Files) {
    if (-not (Test-Path -LiteralPath $webView2File -PathType Leaf)) { throw "WebView2 package dependency was not found: $webView2File" }
}
Copy-Item -LiteralPath $webView2Files[0] -Destination $packageRoot
Copy-Item -LiteralPath $webView2Files[1] -Destination $packageRoot
Copy-Item -LiteralPath $webView2Files[2] -Destination $packageRoot
$tunnelFiles = @(
    (Join-Path $repoRoot 'windows\desktop\tunnel-client.exe'),
    (Join-Path $repoRoot 'windows\desktop\tunnel-profile.template.yaml'),
    (Join-Path $repoRoot 'windows\desktop\tunnel-client.version.txt')
)
foreach ($tunnelFile in $tunnelFiles) {
    if (-not (Test-Path -LiteralPath $tunnelFile -PathType Leaf)) { throw "V6 Tunnel dependency was not found: $tunnelFile" }
}
Copy-Item -LiteralPath $tunnelFiles[0] -Destination (Join-Path $packageRoot 'tunnel-client.exe')
Copy-Item -LiteralPath $tunnelFiles[1] -Destination (Join-Path $packageRoot 'tunnel-profile.template.yaml')
Copy-Item -LiteralPath $tunnelFiles[2] -Destination (Join-Path $packageRoot 'tunnel-client.version.txt')
Copy-Item -LiteralPath (Join-Path $bridgeOutput 'src') -Destination (Join-Path $packageRoot 'dist') -Recurse
$portablePackage = [ordered]@{
    name = 'local-codex-bridge'
    version = $version
    private = $true
    product_name = 'Local Codex Bridge'
    description = 'Local Codex Bridge portable runtime payload.'
    executable = 'LocalCodexBridge.exe'
    preview_executable = 'LocalCodexBridge.exe'
    webview2_package = 'Microsoft.Web.WebView2'
    webview2_version = $webView2Version
    type = 'module'
    engines = [ordered]@{ node = '>=24' }
}
$portablePackage | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PORTABLE-README.md') -Destination (Join-Path $packageRoot 'README.md')
$handoffCandidates = @(
    (Join-Path $repoRoot ('V' + $release + '-HANDOFF.md')),
    (Join-Path $repoRoot ('V' + $release + '-PHASE1-HANDOFF.md'))
)
$handoff = $handoffCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($handoff)) { throw "No handoff document was found for release $release." }
Copy-Item -LiteralPath $handoff -Destination (Join-Path $packageRoot 'HANDOFF.md')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update-manifest.local.example.json') -Destination (Join-Path $packageRoot 'update-manifest.local.example.json')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'WEBVIEW2-SDK-VERSION.txt') -Destination (Join-Path $packageRoot 'WEBVIEW2-SDK-VERSION.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-portable.ps1') -Destination $packageRoot
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
Write-Output $zipPath
