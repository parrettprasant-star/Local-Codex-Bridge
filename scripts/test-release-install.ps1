[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PackageDirectory)
$ErrorActionPreference='Stop'
$package=(Resolve-Path -LiteralPath $PackageDirectory).Path
& (Join-Path $PSScriptRoot 'verify-release-package.ps1') -PackageDirectory $package
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('lcb-install-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
$installer=Join-Path $package 'install-portable.ps1'
& $installer -PackageDirectory $package -VerifyOnly -DesktopDirectory $temporary
if (@(Get-ChildItem -LiteralPath $temporary).Count -ne 0) { throw 'Verify-only wrote a shortcut.' }
function Invoke-IsolatedWrapper([switch]$VerifyOnly) {
    $previousNoPause=[Environment]::GetEnvironmentVariable('LCB_INSTALL_NO_PAUSE','Process')
    try {
        $env:LCB_INSTALL_NO_PAUSE='1'
        $mode=if($VerifyOnly){' -VerifyOnly'}else{''}
        & $env:ComSpec /d /c ('""'+(Join-Path $package 'install.cmd')+'"'+$mode+' -DesktopDirectory "'+$temporary+'""')
        if ($LASTEXITCODE -ne 0) { throw 'Double-click wrapper failed.' }
    } finally {
        [Environment]::SetEnvironmentVariable('LCB_INSTALL_NO_PAUSE',$previousNoPause,'Process')
    }
}
Invoke-IsolatedWrapper -VerifyOnly
if (@(Get-ChildItem -LiteralPath $temporary).Count -ne 0) { throw 'Wrapper verify-only wrote a shortcut.' }
Write-Output 'INSTALL_CMD_WRAPPER=PASS (verify-only; no real desktop writes)'
Invoke-IsolatedWrapper
$shortcut=Join-Path $temporary 'Local Codex Bridge.lnk'
$shell=New-Object -ComObject WScript.Shell
$link=$shell.CreateShortcut($shortcut)
if($link.TargetPath -ne (Join-Path $package 'LocalCodexBridge.exe') -or $link.Arguments -ne '' -or $link.WorkingDirectory -ne $package){throw 'Incorrect installed shortcut.'}
& $installer -PackageDirectory $package -DesktopDirectory $temporary
if (@(Get-ChildItem -LiteralPath $temporary -Filter '*.lnk').Count -ne 1) { throw 'Duplicate shortcut.' }
$link.TargetPath=Join-Path $temporary 'existing-user-tool.exe';$link.Save()
$before=(Get-FileHash -LiteralPath $shortcut).Hash
$rejected=$false
try{& $installer -PackageDirectory $package -DesktopDirectory $temporary}catch{$rejected=$true}
if(-not $rejected -or (Get-FileHash -LiteralPath $shortcut).Hash -ne $before){throw 'Installer overwrote an unrelated target without opt-in.'}
Write-Output 'INSTALL_SHORTCUT_IDEMPOTENT_AND_CONFLICT_SAFE=PASS (isolated temporary desktop only)'
# Keep small isolated test evidence; never delete real desktop shortcuts/state.
