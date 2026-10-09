[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$GoExecutable,
    [Parameter(Mandatory=$true)][string]$WorkDirectory,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$GoExecutable = (Resolve-Path -LiteralPath $GoExecutable).Path
$work = [IO.Path]::GetFullPath($WorkDirectory)
$output = [IO.Path]::GetFullPath($OutputDirectory)
if ((Test-Path -LiteralPath $work) -or (Test-Path -LiteralPath $output)) { throw 'Fresh work/output directories required.' }
if ((& $GoExecutable version) -notmatch '^go version go1\.27\.2 windows/amd64$') { throw 'Pinned Windows Go 1.27.2 toolchain required.' }
New-Item -ItemType Directory -Path $work,$output | Out-Null
$archive = Join-Path $work 'runtime-source.tar.gz'
$sourceHash = '88953678325FFE650CC562BBD0B147E7E8E984B0527AA8B1647B02D6660CE9E0'
Invoke-WebRequest -Uri 'https://github.com/openai/tunnel-client/releases/download/v0.0.16/tunnel-client-runtime-source-v0.0.16.tar.gz' -OutFile $archive -TimeoutSec 120
if ((Get-FileHash -LiteralPath $archive).Hash -ne $sourceHash) { throw 'Official source archive checksum mismatch.' }
& tar.exe -xf $archive -C $work
if ($LASTEXITCODE -ne 0) { throw 'Source extraction failed.' }
$source = Join-Path $work 'tunnel-client-runtime-source-v0.0.16'
$changes = @('golang.org/x/net@v0.60.0','go.opentelemetry.io/otel@v1.45.0',
    'go.opentelemetry.io/otel/sdk@v1.45.0','go.opentelemetry.io/otel/sdk/metric@v1.45.0',
    'go.opentelemetry.io/otel/metric@v1.45.0','go.opentelemetry.io/otel/trace@v1.45.0')
$environmentNames = @('GOBIN','GOPATH','GOCACHE','GOTOOLCHAIN','GOFLAGS','GOSUMDB','GOPROXY','GOWORK','CGO_ENABLED','GOOS','GOARCH','GOENV','GOPRIVATE','GONOSUMDB','GONOPROXY')
$prior = @{}
foreach ($name in $environmentNames) { $prior[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
try {
    $env:GOBIN = Join-Path $work 'tools'; $env:GOPATH = Join-Path $work 'modules'; $env:GOCACHE = Join-Path $work 'cache'
    $env:GOTOOLCHAIN = 'local'; $env:GOFLAGS = '-mod=mod'; $env:GOSUMDB = 'sum.golang.org'; $env:GOPROXY = 'https://proxy.golang.org'
    $env:GOWORK = 'off'; $env:CGO_ENABLED = '0'; $env:GOOS = 'windows'; $env:GOARCH = 'amd64'
    $env:GOENV = 'off'; $env:GOPRIVATE = ''; $env:GONOSUMDB = ''; $env:GONOPROXY = ''
    Push-Location $source
    try {
        & $GoExecutable get @changes
        if ($LASTEXITCODE -ne 0) { throw 'Pinned dependency repair failed.' }
        $flags = '-X github.com/openai/tunnel-client/pkg/version.semanticVersion=0.0.16-lcb.1 -X github.com/openai/tunnel-client/pkg/version.GitSHA=5f99daabd4aa4a77049e6d81d54a0d8c18335397 -X github.com/openai/tunnel-client/pkg/version.GoVersion=go1.27.2 -X github.com/openai/tunnel-client/pkg/version.Flavor=runtime'
        $binary = Join-Path $output 'tunnel-client.exe'
        & $GoExecutable build -trimpath -buildvcs=false -ldflags $flags -o $binary ./cmd/client-runtime
        if ($LASTEXITCODE -ne 0) { throw 'Hardened runtime compilation failed.' }
        & $GoExecutable install golang.org/x/vuln/cmd/govulncheck@v1.8.0
        if ($LASTEXITCODE -ne 0) { throw 'Pinned vulnerability checker build failed.' }
        $scanner = Join-Path $env:GOBIN 'govulncheck.exe'
        & $scanner -mode=binary -scan=symbol $binary *> (Join-Path $output 'VULNERABILITY-CHECK.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Vulnerability check failed. Do not distribute this runtime.' }
        $buildInfo = @(& $GoExecutable version -m $binary)
        if ($buildInfo.Count -eq 0 -or $buildInfo[0] -notmatch ':\s+(go[0-9.]+)$') { throw 'Unexpected Go build-info header.' }
        # Retain all module/checksum evidence, but never publish the builder's
        # absolute output path or Windows username in a diagnostic header.
        $buildInfo[0] = 'tunnel-client.exe: ' + $Matches[1]
        [IO.File]::WriteAllLines((Join-Path $output 'BUILD-INFO.txt'), $buildInfo, (New-Object Text.UTF8Encoding($false)))
        $licenses = Join-Path $output 'licenses'
        New-Item -ItemType Directory -Path $licenses | Out-Null
        $modules = @()
        foreach ($line in $buildInfo) {
            if ($line -notmatch '^\s*dep\s+(\S+)\s+(\S+)\s+(\S+)') { continue }
            $modulePath = $Matches[1]; $moduleVersion = $Matches[2]; $moduleSum = $Matches[3]
            $module = (& $GoExecutable list -m -json $modulePath) | ConvertFrom-Json
            if ($LASTEXITCODE -ne 0) { throw 'License metadata lookup failed.' }
            $licenseFiles = @(Get-ChildItem -LiteralPath $module.Dir -File | Where-Object {$_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)'})
            if ($licenseFiles.Count -eq 0) { throw ('Missing license for '+$modulePath) }
            $directory = Join-Path $licenses ($modulePath.Replace('/','_')+'@'+$moduleVersion)
            New-Item -ItemType Directory -Path $directory | Out-Null
            $evidence = @()
            foreach ($license in $licenseFiles) {
                Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $directory $license.Name)
                $evidence += [ordered]@{file='licenses/'+(Split-Path -Leaf $directory)+'/'+$license.Name;sha256=(Get-FileHash -LiteralPath $license.FullName).Hash}
            }
            $modules += [ordered]@{name=$modulePath;version=$moduleVersion;go_sum=$moduleSum;licenses=$evidence}
        }
        Copy-Item -LiteralPath (Join-Path $source 'LICENSE') -Destination (Join-Path $output 'LICENSE-Tunnel.txt')
        Copy-Item -LiteralPath (Join-Path $source 'NOTICE') -Destination (Join-Path $output 'NOTICE-Tunnel.txt')
        $goRoot = (& $GoExecutable env GOROOT).Trim()
        Copy-Item -LiteralPath (Join-Path $goRoot 'LICENSE') -Destination (Join-Path $output 'LICENSE-Go.txt')
        Copy-Item -LiteralPath (Join-Path $source 'go.mod'),(Join-Path $source 'go.sum') -Destination $output
        [IO.File]::WriteAllText((Join-Path $output 'tunnel-client.version.txt'), '0.0.16-lcb.1 (community dependency-repair build)', (New-Object Text.UTF8Encoding($false)))
        $record = [ordered]@{upstream='https://github.com/openai/tunnel-client';upstream_tag='v0.0.16';upstream_commit='5f99daabd4aa4a77049e6d81d54a0d8c18335397';source_sha256=$sourceHash;go='go1.27.2';changes=$changes;modified_runtime=$true;official_binary=$false;sha256=(Get-FileHash -LiteralPath $binary).Hash;scanner='govulncheck v1.8.0 binary symbol scan';scanner_scope='Known vulnerability DB at build time; not proof of absence of all defects';modules=$modules}
        [IO.File]::WriteAllText((Join-Path $output 'TUNNEL-PROVENANCE.json'), ($record | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    } finally { Pop-Location }
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name,$prior[$name],'Process') }
}
Write-Output ('HARDENED_TUNNEL=PASS '+$output)
