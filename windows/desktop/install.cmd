@echo off
setlocal
echo Local Codex Bridge - verified local shortcut installation
echo No dependency downloads, cloud registration, startup entry or task execution.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-portable.ps1" -PackageDirectory "%~dp0." %*
set "LCB_TASK_INSTALL_EXIT=%ERRORLEVEL%"
if not "%LCB_TASK_INSTALL_EXIT%"=="0" echo Installation stopped. Read START-HERE.zh-CN.md before retrying.
if "%LCB_TASK_INSTALL_EXIT%"=="0" echo Complete. Open the desktop shortcut and follow START-HERE.zh-CN.md.
if not "%LCB_INSTALL_NO_PAUSE%"=="1" pause
exit /b %LCB_TASK_INSTALL_EXIT%
