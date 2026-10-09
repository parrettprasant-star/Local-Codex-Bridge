[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Fresh toolchain output directory required.' }
New-Item -ItemType Directory -Path $output | Out-Null
$archive = Join-Path $output 'go1.27.2.windows-amd64.zip'
Invoke-WebRequest -Uri 'https://go.dev/dl/go1.27.2.windows-amd64.zip' -OutFile $archive -TimeoutSec 120
if ((Get-FileHash -LiteralPath $archive).Hash -ne '1314008898BD40DF77AF4B014F777F08873DBDFBCD3D92308728EE03304FE04F') { throw 'Official Go toolchain checksum mismatch.' }
Expand-Archive -LiteralPath $archive -DestinationPath $output
Write-Output (Join-Path $output 'go\bin\go.exe')
