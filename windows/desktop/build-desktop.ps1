[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path (Get-Location) '.staging\desktop'),
    [string]$WebViewLibraryRoot = (Join-Path $PSScriptRoot 'lib')
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'LocalCodexBridge.Desktop.cs'
$appHostSource = Join-Path $PSScriptRoot 'BridgeCodexAppHost.cs'
$webViewCore = Join-Path $WebViewLibraryRoot 'net462\Microsoft.Web.WebView2.Core.dll'
$webViewForms = Join-Path $WebViewLibraryRoot 'net462\Microsoft.Web.WebView2.WinForms.dll'
$webViewLoader = Join-Path $WebViewLibraryRoot 'runtimes\win-x64\native\WebView2Loader.dll'
$icon = Join-Path $PSScriptRoot '..\icons\ready.ico'
$manifest = Join-Path $PSScriptRoot 'LocalCodexBridge.Desktop.manifest'
$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($compiler)) {
    $command = Get-Command csc.exe -ErrorAction SilentlyContinue
    if ($null -ne $command) { $compiler = $command.Source }
}
if ([string]::IsNullOrWhiteSpace($compiler)) { throw 'C# compiler not found. Install the Windows .NET Framework developer tools.' }
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Desktop source was not found: $source" }
if (-not (Test-Path -LiteralPath $appHostSource -PathType Leaf)) { throw "Bridge Codex host source was not found: $appHostSource" }
if (-not (Test-Path -LiteralPath $webViewCore -PathType Leaf)) { throw "WebView2 Core managed assembly was not found: $webViewCore" }
if (-not (Test-Path -LiteralPath $webViewForms -PathType Leaf)) { throw "WebView2 WinForms managed assembly was not found: $webViewForms" }
if (-not (Test-Path -LiteralPath $webViewLoader -PathType Leaf)) { throw "WebView2 x64 native loader was not found: $webViewLoader" }
if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) { throw "Desktop icon was not found: $icon" }
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Desktop manifest was not found: $manifest" }

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'LocalCodexBridge.Desktop.exe'
$previewOutput = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'BridgeCodex-V6-Preview.exe'
$package = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\..\package.json') | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Desktop version must be a three-part release version.' }
$versionSource = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'BuildVersion.generated.cs'
$assemblyVersion = $package.version + '.0'
[IO.File]::WriteAllText($versionSource, ('using System.Reflection;' + [Environment]::NewLine +
    '[assembly: AssemblyTitle("Local Codex Bridge")]' + [Environment]::NewLine +
    '[assembly: AssemblyProduct("Local Codex Bridge")]' + [Environment]::NewLine +
    '[assembly: AssemblyDescription("ChatGPT to local Codex control center")]' + [Environment]::NewLine +
    '[assembly: AssemblyVersion("' + $assemblyVersion + '")]' + [Environment]::NewLine +
    '[assembly: AssemblyFileVersion("' + $assemblyVersion + '")]'), (New-Object Text.UTF8Encoding($false)))
$systemReferences = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.dll'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Core.dll'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Drawing.dll'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Windows.Forms.dll'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Web.Extensions.dll'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Security.dll'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Management.dll')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
if ($systemReferences.Count -lt 7) { throw 'One or more required .NET Framework assemblies are missing.' }
$webViewReferences = @($webViewCore, $webViewForms)
$references = @($systemReferences) + @($webViewReferences)

$referenceArguments = @($references | ForEach-Object { '/r:' + $_ })
function Invoke-DesktopCompile([string]$target, [string]$define) {
    $arguments = @('/nologo', '/target:winexe', '/optimize+', '/langversion:5', ('/out:' + $target), ('/win32icon:' + $icon), ('/win32manifest:' + $manifest))
    if (-not [string]::IsNullOrWhiteSpace($define)) { $arguments += ('/define:' + $define) }
    & $compiler @arguments @referenceArguments $source $appHostSource $versionSource
    if ($LASTEXITCODE -ne 0) { throw "Desktop compilation failed with exit code $LASTEXITCODE" }
}
Invoke-DesktopCompile $output ''
Invoke-DesktopCompile $previewOutput 'BRIDGE_CODEX_PREVIEW'
Write-Output $output
Write-Output $previewOutput
