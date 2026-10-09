@echo off
title Local Codex Bridge Debug
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NoExit -STA -ExecutionPolicy Bypass -File "%~dp0LocalCodexBridgeTray.ps1" %*
