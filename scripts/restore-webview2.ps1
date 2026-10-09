[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\.staging\webview2-sdk'))
$ErrorActionPreference = 'Stop'
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $destination) { throw 'Refusing to overwrite an existing SDK directory. Use a fresh OutputDirectory.' }
$version = '1.0.4129.50'
$expectedSha256 = 'D3934F482D484B89FB4825DF720C710664E1143A1E90F7B3A60794EF33F473D2'
$url = 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/' + $version + '/microsoft.web.webview2.' + $version + '.nupkg'
New-Item -ItemType Directory -Path $destination | Out-Null
$archive = Join-Path $destination 'webview2.nupkg'
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
$actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($actual -ne $expectedSha256) { throw 'WebView2 package checksum changed. Do not compile; review the official package first.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    $entries = @{
        'lib/net462/Microsoft.Web.WebView2.Core.dll' = 'lib\net462\Microsoft.Web.WebView2.Core.dll'
        'lib/net462/Microsoft.Web.WebView2.WinForms.dll' = 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
        'runtimes/win-x64/native/WebView2Loader.dll' = 'lib\runtimes\win-x64\native\WebView2Loader.dll'
        'LICENSE.txt' = 'LICENSE-WebView2.txt'
        'NOTICE.txt' = 'NOTICE-WebView2.txt'
    }
    foreach ($name in $entries.Keys) {
        $entry = $zip.GetEntry($name)
        if ($null -eq $entry) { throw ('Required official SDK entry missing: ' + $name) }
        $target = Join-Path $destination $entries[$name]
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
    }
} finally { $zip.Dispose() }
Write-Output ('WEBVIEW2_SDK_RESTORE=PASS version=' + $version + ' sha256=' + $actual)
Write-Output ('LIBRARY_ROOT=' + (Join-Path $destination 'lib'))
