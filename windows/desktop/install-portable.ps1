[CmdletBinding()]
param(
    [string]$PackageDirectory = $PSScriptRoot,
    [switch]$NoDesktopShortcut,
    [switch]$Preview,
    [switch]$UpdateDesktopShortcut,
    [switch]$VerifyOnly,
    [string]$DesktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
)

$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath($PackageDirectory)
$executableName = if (Test-Path -LiteralPath (Join-Path $packageRoot 'LocalCodexBridge.exe')) { 'LocalCodexBridge.exe' } else { 'LocalCodexBridge.Desktop.exe' }
$executable = Join-Path $packageRoot $executableName
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Portable desktop executable was not found: $executable" }

$verifier = Join-Path $packageRoot 'verify-release-package.ps1'
if (Test-Path -LiteralPath $verifier -PathType Leaf) { & $verifier -PackageDirectory $packageRoot }
if ($VerifyOnly) { Write-Output 'INSTALL_VERIFY_ONLY=PASS (no shortcut, registry, data or processes changed)'; return }
$desktop = (Resolve-Path -LiteralPath $DesktopDirectory).Path
$shortcutName = 'Local Codex Bridge.lnk'
$shortcutPath = Join-Path $desktop $shortcutName
if (-not $NoDesktopShortcut) {
    $shell = New-Object -ComObject WScript.Shell
    if (Test-Path -LiteralPath $shortcutPath) {
        $existing = $shell.CreateShortcut($shortcutPath)
        if ([IO.Path]::GetFullPath($existing.TargetPath) -ne $executable -and -not $UpdateDesktopShortcut) {
            throw 'Existing shortcut preserved. Use -UpdateDesktopShortcut only after verifying this package. No duplicate shortcut created.'
        }
        if ($UpdateDesktopShortcut) {
            $backup = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'BridgeCodex\ShortcutBackups'
            New-Item -ItemType Directory -Path $backup -Force | Out-Null
            Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $backup ((Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N')+'.lnk'))
        }
    }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $executable
    $shortcut.Arguments = ''
    $shortcut.WindowStyle = 1
    $shortcut.WorkingDirectory = $packageRoot
    $shortcut.Description = 'Local Codex Bridge desktop application'
    $shortcut.IconLocation = $executable + ',0'
    $shortcut.Save()
    Write-Output $shortcutPath
}
Write-Output ('First run: open ' + $executableName + '. Enter your own Tunnel ID and Runtime API Key in tray configuration, save, true-exit and restart.')
Write-Output 'Prerequisites: Node.js 24+, official Codex CLI and WebView2 Runtime. Use a short path. No startup entry added.'
Write-Output 'No user token/API key is packaged. CurrentUser DPAPI credentials stay on this machine. Read START-HERE.zh-CN.md for Chinese instructions.'
