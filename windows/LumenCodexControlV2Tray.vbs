Option Explicit

Dim shell, fileSystem, scriptDirectory, trayScript, powerShell, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
trayScript = fileSystem.BuildPath(scriptDirectory, "LocalCodexBridgeTray.vbs")
powerShell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
command = Quote(powerShell) & " " & Quote(trayScript)

shell.CurrentDirectory = scriptDirectory
shell.Run command, 0, False

Function Quote(value)
    Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
