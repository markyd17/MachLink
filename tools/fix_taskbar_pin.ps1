<#
.SYNOPSIS
  Stamps the System.AppUserModel.ID property MachLink needs onto its
  desktop shortcut and taskbar pin, so the running app merges into the
  pinned icon instead of showing up as a second, separate one.

.DESCRIPTION
  Root cause (confirmed live, not guessed): app.py calls
  SetCurrentProcessExplicitAppUserModelID("MachLink.App") before creating
  its window, which is enough to fix the TASKBAR ICON showing the generic
  Python logo. It is NOT enough on its own for pinning/grouping - Windows
  decides whether a running window belongs to an existing pinned tile by
  comparing AppUserModelIDs, and a plain shortcut (desktop or taskbar pin)
  has none set unless something explicitly writes it. Without a matching
  ID on the shortcut, Windows can't correlate "this running window" with
  "that pinned tile" and shows a second icon next to the pin instead of
  merging into it - regardless of whether the shortcut's target/icon are
  otherwise correct.

  Re-run this any time you recreate the MachLink shortcut/pin (e.g. after
  changing static/machlink.ico, or if the icon design changes again and
  you delete + re-pin) - a freshly created shortcut never carries this
  property on its own.

  Uses the shell's own property-store API (SHGetPropertyStoreFromParsingName)
  rather than trying to go through IShellLink's own COM interfaces
  directly - the latter reported success on every call (Load/SetValue/
  Commit/Save all returned S_OK) while silently writing nothing, traced to
  a PROPVARIANT struct that was 16 bytes instead of the real 24-byte
  layout the API expects on 64-bit Windows. Confirmed by hand with a
  read-back after each attempt, not assumed from the HRESULTs alone.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\fix_taskbar_pin.ps1
#>

$AppId = "MachLink.App"

$Code = @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PROPERTYKEY {
    public Guid fmtid;
    public int pid;
}

// The real Win32 PROPVARIANT is 24 bytes on x64 (8-byte vt/reserved header
// + a 16-byte union) - a 16-byte version (just vt + one pointer) silently
// under-supplies whatever the property store implementation copies out of
// it, producing S_OK return codes with no actual effect. The extra
// IntPtr-sized padding field below is what makes this correct.
[StructLayout(LayoutKind.Sequential)]
public struct PROPVARIANT_STR {
    public ushort vt;
    public ushort wReserved1, wReserved2, wReserved3;
    public IntPtr p;
    public IntPtr padding;
}

[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
    int GetCount(out uint cProps);
    int GetAt(uint iProp, out PROPERTYKEY pkey);
    int GetValue(ref PROPERTYKEY key, out PROPVARIANT_STR pv);
    int SetValue(ref PROPERTYKEY key, ref PROPVARIANT_STR pv);
    int Commit();
}

public static class MachLinkShell32 {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern int SHGetPropertyStoreFromParsingName(
        string pszPath, IntPtr pbc, int flags, ref Guid riid, out IPropertyStore ppv);
}

public static class MachLinkAumid {
    // PKEY_AppUserModel_ID - documented, stable GUID/PID pair.
    static PROPERTYKEY Key() {
        return new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    }

    public static bool SetAumid(string path, string aumid) {
        Guid iid = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
        IPropertyStore store;
        int hrOpen = MachLinkShell32.SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2 /* GPS_READWRITE */, ref iid, out store);
        if (hrOpen != 0) return false;

        var pkey = Key();
        IntPtr pStr = Marshal.StringToCoTaskMemUni(aumid);
        try {
            var pv = new PROPVARIANT_STR { vt = 31 /* VT_LPWSTR */, p = pStr };
            int hrSet = store.SetValue(ref pkey, ref pv);
            int hrCommit = store.Commit();
            return hrSet == 0 && hrCommit == 0;
        } finally {
            Marshal.FreeCoTaskMem(pStr);
            Marshal.ReleaseComObject(store);
        }
    }

    public static string GetAumid(string path) {
        Guid iid = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
        IPropertyStore store;
        int hrOpen = MachLinkShell32.SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 0 /* GPS_DEFAULT */, ref iid, out store);
        if (hrOpen != 0) return null;
        var pkey = Key();
        PROPVARIANT_STR pv;
        int hr = store.GetValue(ref pkey, out pv);
        Marshal.ReleaseComObject(store);
        if (hr != 0 || pv.p == IntPtr.Zero) return null;
        return Marshal.PtrToStringUni(pv.p);
    }
}
'@
Add-Type -TypeDefinition $Code -Language CSharp

$Candidates = @(
    "$env:USERPROFILE\Desktop\MachLink.lnk",
    "$env:OneDrive\Desktop\MachLink.lnk",
    "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\MachLink.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\MachLink.lnk"
) | Where-Object { Test-Path $_ } | Select-Object -Unique

if (-not $Candidates) {
    Write-Host "No MachLink.lnk found on the Desktop, Start Menu, or taskbar pins - nothing to fix."
    Write-Host "(Create/pin your shortcut first, then re-run this script.)"
    exit 0
}

foreach ($path in $Candidates) {
    Copy-Item -Path $path -Destination "$path.bak" -Force
    $before = [MachLinkAumid]::GetAumid($path)
    if (-not $before) { $before = "(none)" }
    $ok = [MachLinkAumid]::SetAumid($path, $AppId)
    $after = [MachLinkAumid]::GetAumid($path)
    if ($ok -and $after -eq $AppId) {
        Write-Host "OK   $path (was: $before) -> $after"
    } else {
        if (-not $after) { $after = "(none)" }
        Write-Host "FAIL $path - AUMID still: $after. Backup at $path.bak is untouched/restorable if needed."
    }
}

Write-Host ""
Write-Host "Close MachLink if it's running, then relaunch via the shortcut/pin."
Write-Host "If the taskbar still shows two icons after that, sign out and back in once (or restart explorer.exe) to clear its cached pin-to-window association."
