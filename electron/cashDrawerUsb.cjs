const { execFile } = require('node:child_process');
// Fixed script, printer name travels as data, never as PowerShell code.
const SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DrawerRaw {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class Doc { public string Name="Cash drawer"; public string Output=null; public string Type="RAW"; }
 [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
 [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int StartDocPrinter(IntPtr h, int l, [In] Doc d);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
 [DllImport("winspool.drv")] public static extern bool EndPagePrinter(IntPtr h);
 [DllImport("winspool.drv")] public static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.drv")] public static extern bool AbortPrinter(IntPtr h);
 [DllImport("winspool.drv")] public static extern bool ClosePrinter(IntPtr h);
 public static void Send(string name, byte[] bytes) {
  IntPtr h; if(!OpenPrinter(name,out h,IntPtr.Zero)) throw new Exception("OpenPrinter");
  bool doc=false, ok=false;
  try {
   if(StartDocPrinter(h,1,new Doc())==0) throw new Exception("StartDocPrinter"); doc=true;
   if(!StartPagePrinter(h)) throw new Exception("StartPagePrinter");
   int written; if(!WritePrinter(h,bytes,bytes.Length,out written)||written!=bytes.Length) throw new Exception("WritePrinter");
   if(!EndPagePrinter(h)) throw new Exception("EndPagePrinter");
   if(!EndDocPrinter(h)) throw new Exception("EndDocPrinter"); doc=false; ok=true;
  } finally { if(!ok && doc) AbortPrinter(h); ClosePrinter(h); }
 }
}
'@
[DrawerRaw]::Send($env:MINHDIEN_DRAWER_PRINTER,[Convert]::FromBase64String($env:MINHDIEN_DRAWER_BYTES))
`;
function sendUsbPulse(settings, run = execFile, platform = process.platform) {
  if (platform !== 'win32') return Promise.reject(new Error('Kết nối USB cần máy tính Windows tại quầy.'));
  return new Promise((resolve, reject) => {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 3000, maxBuffer: 8192,
      env: { ...process.env, MINHDIEN_DRAWER_PRINTER: settings.printerName,
        MINHDIEN_DRAWER_BYTES: Buffer.from([27, 112, settings.pin, settings.onTime, settings.offTime]).toString('base64') },
    }, (error) => error ? reject(new Error('Không gửi được lệnh RAW tới máy in USB.')) : resolve());
  });
}
module.exports = { sendUsbPulse };
