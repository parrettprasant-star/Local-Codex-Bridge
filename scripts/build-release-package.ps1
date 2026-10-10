[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [Parameter(Mandatory=$true)][string]$WebViewSdkDirectory,
    [string]$BuildLabel = 'v6.2.0-release-candidate',
    [string]$TunnelDirectory = ''
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
$documentation = if (Test-Path -LiteralPath (Join-Path $repo 'release-prep\RELEASE-GATES.md')) { Join-Path $repo 'release-prep' } else { $repo }
# Fresh builds only. External official Codex/Node/Tunnel dependencies remain
# independent; no unknown or vulnerable binary is silently bundled as approved.
& (Join-Path $PSScriptRoot 'build-review-package.ps1') -OutputDirectory $output -WebViewSdkDirectory $WebViewSdkDirectory -BuildLabel $BuildLabel
if ($LASTEXITCODE -ne 0) { throw 'Package build failed.' }
if (-not [string]::IsNullOrWhiteSpace($TunnelDirectory)) {
    $tunnel = (Resolve-Path -LiteralPath $TunnelDirectory).Path
    $provenance = Get-Content -Raw -LiteralPath (Join-Path $tunnel 'TUNNEL-PROVENANCE.json') | ConvertFrom-Json
    if (-not $provenance.modified_runtime -or $provenance.sha256 -ne (Get-FileHash -LiteralPath (Join-Path $tunnel 'tunnel-client.exe')).Hash -or
        (Get-Content -Raw -LiteralPath (Join-Path $tunnel 'VULNERABILITY-CHECK.txt')) -notmatch 'No vulnerabilities found') { throw 'Hardened Tunnel evidence is missing or mismatched.' }
    foreach ($name in @('tunnel-client.exe','tunnel-client.version.txt','LICENSE-Tunnel.txt','NOTICE-Tunnel.txt','LICENSE-Go.txt','BUILD-INFO.txt','TUNNEL-PROVENANCE.json','VULNERABILITY-CHECK.txt')) {
        Copy-Item -LiteralPath (Join-Path $tunnel $name) -Destination (Join-Path $output $name)
    }
    Copy-Item -LiteralPath (Join-Path $tunnel 'licenses') -Destination (Join-Path $output 'licenses') -Recurse
    $buildInfoPath = Join-Path $output 'BUILD-INFO.txt'
    $buildInfo = [IO.File]::ReadAllLines($buildInfoPath)
    if ($buildInfo.Length -eq 0 -or $buildInfo[0] -notmatch ':\s+(go[0-9.]+)$' -or $Matches[1] -ne $provenance.go) { throw 'Tunnel toolchain evidence mismatch.' }
    $buildInfo[0] = 'tunnel-client.exe: ' + $provenance.go
    [IO.File]::WriteAllLines($buildInfoPath, $buildInfo, (New-Object Text.UTF8Encoding($false)))
}
Copy-Item -LiteralPath (Join-Path $repo 'windows\desktop\install-portable.ps1') -Destination (Join-Path $output 'install-portable.ps1')
Copy-Item -LiteralPath (Join-Path $repo 'windows\desktop\install.cmd') -Destination (Join-Path $output 'install.cmd')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'verify-release-package.ps1') -Destination (Join-Path $output 'verify-release-package.ps1')
foreach ($name in @('SECURITY.md','CONTRIBUTING.md','RELEASE-GATES.md','RELEASE-NOTES-6.2.0.md',
    'START-HERE.zh-CN.md','USER-GUIDE.zh-CN.md','CHATGPT-PROMPTS.zh-CN.md','SCREENSHOT-GUIDE.zh-CN.md',
    'MACOS.zh-CN.md','CHATGPT-PLUGIN-SETUP.zh-CN.md',
    'PRIVACY-RELEASE.zh-CN.md','projects.json.example')) {
    Copy-Item -LiteralPath (Join-Path $documentation $name) -Destination (Join-Path $output $name)
}
# Documentation assets only: future builds must not ship a guide with broken
# image links. The already published v6.2.0 archives are not replaced.
$guideImages = Join-Path $documentation 'docs\images\quickstart'
$outputImages = Join-Path $output 'docs\images'
New-Item -ItemType Directory -Path $outputImages -Force | Out-Null
Copy-Item -LiteralPath $guideImages -Destination $outputImages -Recurse
$metadata = Get-Content -Raw -LiteralPath (Join-Path $output 'package.json') | ConvertFrom-Json
$metadata.release_status = 'release-candidate-not-published'
$metadata.tunnel_bundled = -not [string]::IsNullOrWhiteSpace($TunnelDirectory)
[IO.File]::WriteAllText((Join-Path $output 'package.json'), ($metadata | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText((Join-Path $output 'HANDOFF.md'), 'Release candidate: not published, not code-signed. All functional modules are present; independent Node/Codex/WebView2 and user-owned Tunnel prerequisites are documented. Do not promote until RELEASE-GATES.md passes.', (New-Object Text.UTF8Encoding($false)))
$inventory = @(Get-ChildItem -LiteralPath $output -Recurse -File | Where-Object {$_.Name -ne 'PACKAGE-MANIFEST.json'} | ForEach-Object {
    [ordered]@{path=$_.FullName.Substring($output.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}
})
[IO.File]::WriteAllText((Join-Path $output 'PACKAGE-MANIFEST.json'), ($inventory | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
& (Join-Path $PSScriptRoot 'verify-release-package.ps1') -PackageDirectory $output
Write-Output ('RELEASE_CANDIDATE_BUILD=PASS '+$output)
