[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Refusing to overwrite a scanner directory.' }
New-Item -ItemType Directory -Path $output | Out-Null
$archive = Join-Path $output 'gitleaks.zip'
Invoke-WebRequest -Uri 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip' -OutFile $archive
if ((Get-FileHash -LiteralPath $archive).Hash -ne 'D29144DEFF3A68AA93CED33DDDF84B7FDC26070ADD4AA0F4513094C8332AFC4E') { throw 'Secret scanner checksum mismatch.' }
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $output 'tool')
& (Join-Path $output 'tool\gitleaks.exe') version
if ($LASTEXITCODE -ne 0) { throw 'Verified scanner did not run.' }
