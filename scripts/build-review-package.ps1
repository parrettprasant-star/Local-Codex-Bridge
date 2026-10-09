[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][string]$WebViewSdkDirectory,
    [string]$TunnelDirectory = '',
    [string]$BuildLabel = 'developer-review'
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
$sdk = [IO.Path]::GetFullPath($WebViewSdkDirectory)
$documentation = if (Test-Path -LiteralPath (Join-Path $repo 'release-prep\README.public-draft.md')) { Join-Path $repo 'release-prep' } else { $repo }
$readmeName = if ($documentation -eq $repo) { 'README.md' } else { 'README.public-draft.md' }
if (Test-Path -LiteralPath $output) { throw 'Refusing to overwrite a package. Choose a new short directory.' }
if ($output.Length -gt 140) { throw 'Use a short package path to protect the WebView2 profile height/path budget.' }
if ($BuildLabel -notmatch '^[a-zA-Z0-9.-]{1,64}$') { throw 'BuildLabel must be short and non-private.' }
foreach ($name in @('LICENSE-WebView2.txt','NOTICE-WebView2.txt','lib\net462\Microsoft.Web.WebView2.Core.dll','lib\net462\Microsoft.Web.WebView2.WinForms.dll','lib\runtimes\win-x64\native\WebView2Loader.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $sdk $name) -PathType Leaf)) { throw ('Restore the official SDK first: missing ' + $name) }
}
# No production dist, package, shortcuts, registry, credentials or state touched.
Push-Location $repo
try {
    & npm.cmd run build:staging
    if ($LASTEXITCODE -ne 0) { throw 'Frontend/staging build failed' }
    & (Join-Path $repo 'windows\desktop\build-desktop.ps1') -OutputDirectory $output -WebViewLibraryRoot (Join-Path $sdk 'lib')
    if ($LASTEXITCODE -ne 0) { throw 'Desktop compile failed' }
    Copy-Item -LiteralPath (Join-Path $output 'BridgeCodex-V6-Preview.exe') -Destination (Join-Path $output 'LocalCodexBridge.exe')
    New-Item -ItemType Directory -Path (Join-Path $output 'dist') | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $repo '.staging\dist\src') -File | ForEach-Object {
        if ($_.Extension -eq '.js') { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $output 'dist') }
    }
    $copies = @{
        (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll') = 'Microsoft.Web.WebView2.Core.dll'
        (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.WinForms.dll') = 'Microsoft.Web.WebView2.WinForms.dll'
        (Join-Path $sdk 'lib\runtimes\win-x64\native\WebView2Loader.dll') = 'WebView2Loader.dll'
        (Join-Path $sdk 'LICENSE-WebView2.txt') = 'LICENSE-WebView2.txt'
        (Join-Path $sdk 'NOTICE-WebView2.txt') = 'NOTICE-WebView2.txt'
        (Join-Path $repo 'windows\desktop\WEBVIEW2-SDK-VERSION.txt') = 'WEBVIEW2-SDK-VERSION.txt'
        (Join-Path $repo 'windows\desktop\update-manifest.local.example.json') = 'update-manifest.local.example.json'
        (Join-Path $repo 'LICENSE') = 'LICENSE'
        (Join-Path $documentation $readmeName) = 'README.md'
        (Join-Path $documentation 'LOCAL-HTTP.md') = 'LOCAL-HTTP.md'
        (Join-Path $documentation 'TUNNEL-SETUP.md') = 'TUNNEL-SETUP.md'
        (Join-Path $documentation 'THIRD-PARTY.md') = 'THIRD-PARTY.md'
    }
    foreach ($file in $copies.Keys) { Copy-Item -LiteralPath $file -Destination (Join-Path $output $copies[$file]) }
    $template = Get-Content -Raw -LiteralPath (Join-Path $repo 'windows\desktop\tunnel-profile.template.yaml')
    $template = $template -replace '(tunnel_id:\s*)"[^"\r\n]*"', '$1"tunnel_UNCONFIGURED"'
    [IO.File]::WriteAllText((Join-Path $output 'tunnel-profile.template.yaml'), $template, (New-Object Text.UTF8Encoding($false)))
    $hasTunnel = -not [string]::IsNullOrWhiteSpace($TunnelDirectory)
    if ($hasTunnel) {
        # Explicit local testing only. Unknown executable provenance is NOT
        # certified by copying it; the distribution gate remains separate.
        foreach ($name in @('tunnel-client.exe','tunnel-client.version.txt')) {
            Copy-Item -LiteralPath (Join-Path ([IO.Path]::GetFullPath($TunnelDirectory)) $name) -Destination (Join-Path $output $name)
        }
    }
    $sourceMetadata = Get-Content -Raw -LiteralPath (Join-Path $repo 'package.json') | ConvertFrom-Json
    $metadata = [ordered]@{
        name = 'local-codex-bridge'; product_name = 'Local Codex Bridge'; version = $sourceMetadata.version
        build_label = $BuildLabel; type = 'module'; executable = 'LocalCodexBridge.exe'
        engines = @{ node = '>=24' }; webview2_package = 'Microsoft.Web.WebView2'; webview2_version = '1.0.4129.50'
        release_status = 'local-validation-only'; tunnel_bundled = $hasTunnel
    }
    [IO.File]::WriteAllText((Join-Path $output 'package.json'), ($metadata | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $output 'HANDOFF.md'), "Developer review package; not a public installer. Use your own Tunnel identity. No credentials or user data included. See README.md and TUNNEL-SETUP.md.", (New-Object Text.UTF8Encoding($false)))
    $inventory = @(Get-ChildItem -LiteralPath $output -Recurse -File | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($output.Length + 1).Replace('\','/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
    [IO.File]::WriteAllText((Join-Path $output 'PACKAGE-MANIFEST.json'), ($inventory | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
    Write-Output ('REVIEW_PACKAGE=PASS ' + $output)
} finally { Pop-Location }
