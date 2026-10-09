[CmdletBinding()]
param(
    [string]$PackageDirectory = (Join-Path (Get-Location) 'artifacts\BridgeCodex-Windows-portable-v6.0.0')
)

$ErrorActionPreference = 'Stop'
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$root = [IO.Path]::GetFullPath($PackageDirectory)
Assert-True (Test-Path -LiteralPath $root -PathType Container) "Portable package directory was not found: $root"
$entry = if (Test-Path -LiteralPath (Join-Path $root 'LocalCodexBridge.exe') -PathType Leaf) { 'LocalCodexBridge.exe' } else { 'BridgeCodex-V6-Preview.exe' }
$required = @(
    $entry,
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.WinForms.dll',
    'WebView2Loader.dll',
    'dist\index.js',
    'tunnel-profile.template.yaml',
    'update-manifest.local.example.json',
    'WEBVIEW2-SDK-VERSION.txt',
    'HANDOFF.md'
)
foreach ($relative in $required) {
    Assert-True (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf) "Portable dependency is missing: $relative"
}
$metadata = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
if ($metadata.tunnel_bundled -ne $false) {
    foreach ($relative in @('tunnel-client.exe','tunnel-client.version.txt')) {
        Assert-True (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf) ('Declared bundled dependency missing: '+$relative)
    }
}
Assert-True ([string]$metadata.product_name -eq 'Local Codex Bridge') 'Portable metadata product_name must be Local Codex Bridge.'
if ($entry -eq 'LocalCodexBridge.exe') {
    Assert-True ([string]$metadata.executable -eq 'LocalCodexBridge.exe') 'Portable metadata must name the formal executable.'
}
Assert-True ([string]$metadata.webview2_package -eq 'Microsoft.Web.WebView2') 'Portable metadata must identify WebView2.'
$forbidden = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
    $_.FullName -match '\\dist\\src\\|\\node_modules\\|\\test\\|\\.staging\\|\.map$'
}
Assert-True ($forbidden.Count -eq 0) 'Portable package contains test, source-layout, staging, or map artifacts.'
Write-Output 'PORTABLE_TESTS_OK'
