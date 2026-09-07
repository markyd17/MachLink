' Launches MachLink with no console/terminal window at all, for the desktop
' shortcut - uses pythonw.exe (the windowless Python interpreter) directly
' rather than routing through run.bat/cmd.exe, since a .bat file always
' needs a console to interpret it even if the program it runs doesn't.
'
' run.bat itself is untouched and still works exactly as before if you
' ever want to double-click it directly and watch the console (e.g. to
' see startup messages live instead of checking machlink.log afterward).
Dim objShell, objFSO, scriptDir

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
scriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)

If Not objFSO.FileExists(scriptDir & "\config.yaml") Then
    MsgBox "config.yaml not found." & vbCrLf & vbCrLf & _
           "Copy config.example.yaml to config.yaml and fill it in first.", _
           vbExclamation, "MachLink"
    WScript.Quit 1
End If

objShell.CurrentDirectory = scriptDir
' The window-style argument below (1 = SW_SHOWNORMAL) is a hint the OS
' passes down for how the launched process's own first window should
' start. pythonw.exe itself never creates a console regardless of this
' value, so it used to be set to 0 (hidden) on the assumption there was
' a console left to hide - but pywebview's actual app window inherits
' that same startup hint for ITS window, so 0 was starting the real
' MachLink window hidden and never showing it (confirmed: it ran fully
' in the background - Flask serving, page loading - just never visible
' or even present in Alt-Tab). 1 keeps pythonw's console suppressed
' (still nothing to hide) while letting the real app window show normally.
objShell.Run "pythonw.exe app.py", 1, False
