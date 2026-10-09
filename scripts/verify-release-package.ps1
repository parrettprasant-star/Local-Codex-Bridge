[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PackageDirectory).Path.TrimEnd('\')
$manifestPath = Join-Path $root 'PACKAGE-MANIFEST.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Missing package manifest.' }
# Windows PowerShell 5.1 emits the JSON array as a single pipeline object.
# Wrapping that pipeline in @() nests the manifest; keep the parsed array flat.
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
function Get-PackageHash([string]$Path) {
    # Avoid inherited PowerShell 7 module paths breaking Windows PowerShell's
    # Get-FileHash autoload when install.cmd is started by a local assistant.
    $stream = [IO.File]::OpenRead($Path)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','') }
    finally { $hash.Dispose(); $stream.Dispose() }
}
$seen = @{}
foreach ($file in $manifest) {
    if ($file.path -notmatch '^[^:]+$' -or [IO.Path]::IsPathRooted($file.path)) { throw 'Unsafe manifest path.' }
    $path = [IO.Path]::GetFullPath((Join-Path $root $file.path))
    if (-not $path.StartsWith($root+'\', [StringComparison]::OrdinalIgnoreCase) -or $seen.ContainsKey($path)) { throw 'Escaping or duplicate manifest entry.' }
    $seen[$path] = $true
    $item = Get-Item -LiteralPath $path
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point in release.' }
    if ($item.Length -ne $file.bytes -or (Get-PackageHash $path) -ne $file.sha256) { throw ('Package integrity mismatch: '+$file.path) }
}
foreach ($item in Get-ChildItem -LiteralPath $root -Recurse -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point in release tree.' }
    if (-not $item.PSIsContainer -and $item.FullName -ne $manifestPath -and -not $seen.ContainsKey($item.FullName)) { throw ('Unlisted package file: '+$item.Name) }
}
foreach ($name in @('LocalCodexBridge.exe','dist\index.js','dist\control-center-shell.js','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','LICENSE','README.md','TUNNEL-SETUP.md','tunnel-profile.template.yaml','package.json',
    'install.cmd','install-portable.ps1','START-HERE.zh-CN.md','USER-GUIDE.zh-CN.md',
    'CHATGPT-PROMPTS.zh-CN.md','PRIVACY-RELEASE.zh-CN.md','projects.json.example')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $name) -PathType Leaf)) { throw ('Incomplete release: '+$name) }
}
$metadata = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
$version = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $root 'LocalCodexBridge.exe'))
if ($version.FileVersion -ne ($metadata.version+'.0') -or $version.ProductName -ne 'Local Codex Bridge') { throw 'EXE and package version metadata disagree.' }
if ((Get-Content -Raw -LiteralPath (Join-Path $root 'tunnel-profile.template.yaml')) -notmatch 'tunnel_id:\s*"tunnel_UNCONFIGURED"') { throw 'Public package must not carry a user Tunnel binding.' }
Write-Output ('PACKAGE_INTEGRITY=PASS files='+$manifest.Count+' version='+$metadata.version)
