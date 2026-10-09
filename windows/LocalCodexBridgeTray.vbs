Option Explicit

Dim fileSystem, shell, scriptDirectory, trayScript, command
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
trayScript = fileSystem.BuildPath(scriptDirectory, "LocalCodexBridgeTray.ps1")
command = Chr(34) & shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe" & Chr(34) & " -NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & trayScript & Chr(34)
shell.Run command, 0, False
