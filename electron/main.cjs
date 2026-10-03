const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createCashDrawerController } = require('./cashDrawer.cjs');
const { createCashDrawerRelay } = require('./cashDrawerRelay.cjs');
const cashDrawer = createCashDrawerController(() => app.getPath('userData'));

const { createLanCertificates, lanAddresses } = require('./cashDrawerLan.cjs');
const lanCertificates = createLanCertificates(() => app.getPath('userData'), safeStorage);
const drawerRelay = createCashDrawerRelay(cashDrawer, lanCertificates);
let preparingLan = false;

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
const APP_ID = 'vn.bantaphoa.sales';
const PRINTER_SETTINGS_FILE = 'desktop-printer.json';

let mainWindow = null;
let tray = null;
let quitting = false;
const LOGIN_ARGS = ['--background'];

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function loginItemOptions() {
  return { path: process.execPath, args: LOGIN_ARGS };
}

function refreshTrayMenu() {
  if (!tray) return;
  const supportsLogin = app.isPackaged && process.platform === 'win32';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở Bán Tạp Hóa', click: showMainWindow },
    { label: 'Đóng cửa sổ vẫn giữ cầu nối két hoạt động', enabled: false },
    { type: 'separator' },
    ...(supportsLogin ? [{
      label: 'Khởi động cùng Windows', type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => {
        try {
          app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked });
        } catch (error) { console.error('Không đổi được khởi động cùng Windows:', error); }
        refreshTrayMenu();
      },
    }] : []),
    { label: 'Thoát hẳn (dừng cầu nối két)', click: () => app.quit() },
  ]));
}

function createBackgroundTray() {
  if (process.platform !== 'win32') return;
  try {
    const icon = loadTrayIcon();
    if (icon.isEmpty()) throw new Error('Không tìm thấy biểu tượng khay hệ thống.');
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Bán Tạp Hóa · cầu nối két tiền');
    tray.on('double-click', showMainWindow);
    refreshTrayMenu();
  } catch (error) {
    if (tray) tray.destroy();
    tray = null;
    console.error('Không tạo được khay hệ thống; giữ cửa sổ mở:', error);
  }
}

function loadTrayIcon() {
  const candidates = [rendererPath('apple-touch-icon-v3-180.png')];
  if (!app.isPackaged) {
    candidates.push(path.join(app.getAppPath(), 'public', 'apple-touch-icon-v3-180.png'));
  }
  for (const file of candidates) {
    try {
      // Node reads both Unicode Windows paths and files inside app.asar.
      const icon = nativeImage.createFromBuffer(fs.readFileSync(file));
      if (!icon.isEmpty()) return icon;
    } catch { /* Try the next image when an asset is missing or unreadable. */ }
  }
  // A red/gold M stays available even without the renderer's image assets.
  return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA1klEQVR4nO2WQQ6EIAxFS+8xiZs5w7j33LOfOYObSTyIrkicAkKLfGJiN0aUvkcpCUSdw8UGP4/n2gI2LnPAYxQ8lZtzP7SW4NQHlASj4VIi6AF0XEPg9R5MyUvmOaJ4D8Qmf6dfFVzOH5fZqbagtBKaiql7IJdcu12mJkxBLL1yjVNAFDaQXK18L23Yqgp4qPWYqgViq6o9ruoK5JJr4CaBI4gWbhbYw+QTJnAGvFrgjLgFugsk7wOIUN8HWgR7EzTYM1kOIOF/AigJyQh6oKVEj63OxgaJ2Fk6cHyCTgAAAABJRU5ErkJggg==');
}

function initializeWindowsStartup() {
  if (!app.isPackaged || process.platform !== 'win32' || !tray) return;
  // Initialize once; later launches respect the tray choice and Windows startup settings.
  const marker = path.join(app.getPath('userData'), 'desktop-startup-initialized');
  try {
    if (fs.existsSync(marker)) return;
    app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: true });
    fs.writeFileSync(marker, '1', 'utf8');
    refreshTrayMenu();
  } catch (error) { console.error('Không thiết lập được khởi động cùng Windows:', error); }
}

function rendererPath(...parts) {
  return path.join(app.getAppPath(), 'dist-electron', ...parts);
}

function printerSettingsPath() {
  return path.join(app.getPath('userData'), PRINTER_SETTINGS_FILE);
}

function isAllowedNavigation(url) {
  if (app.isPackaged) return url.startsWith('file:');
  return url.startsWith(DEV_SERVER_URL);
}

function normalizePrinterName(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized || normalized.length > 240) return '';
  return normalized;
}

function readPrinterSettings() {
  try {
    const raw = fs.readFileSync(printerSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const legacyDeviceName = normalizePrinterName(parsed?.deviceName);
    const receiptDeviceName = normalizePrinterName(parsed?.receiptDeviceName) || legacyDeviceName;
    const a4DeviceName = normalizePrinterName(parsed?.a4DeviceName);
    return {
      receiptDeviceName,
      a4DeviceName,
      deviceName: receiptDeviceName,
    };
  } catch {
    return { receiptDeviceName: '', a4DeviceName: '', deviceName: '' };
  }
}

function writePrinterSettings(kind, deviceName) {
  const current = readPrinterSettings();
  const receiptDeviceName = kind === 'a4' ? current.receiptDeviceName : deviceName;
  const a4DeviceName = kind === 'a4' ? deviceName : current.a4DeviceName;
  const payload = {
    receiptDeviceName,
    a4DeviceName,
    deviceName: receiptDeviceName,
    updatedAt: Date.now(),
  };
  fs.writeFileSync(printerSettingsPath(), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function getPrinters(webContents) {
  const printers = await webContents.getPrintersAsync();
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName,
    description: printer.description,
    status: printer.status,
    isDefault: printer.isDefault,
  }));
}

async function requireInstalledPrinter(webContents, value) {
  const deviceName = normalizePrinterName(value);
  if (!deviceName) throw new Error('Hãy chọn máy in hóa đơn.');

  const printers = await getPrinters(webContents);
  const printer = printers.find((item) => item.name === deviceName);
  if (!printer) throw new Error('Máy in đã chọn không còn tồn tại trong Windows.');
  return printer;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildPrinterTestHtml(printer, paperSize) {
  const contentWidth = paperSize === 'A4' ? '186mm' : paperSize === '58mm' ? '54mm' : '78mm';
  const now = new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>Bán Tạp Hóa - In thử máy in</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: ${contentWidth};
    margin: 0 auto;
    padding: 2.5mm;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    line-height: 1.35;
  }
  .center { text-align: center; }
  .title { font-size: 17px; font-weight: 800; }
  .line { border-top: 1px dashed #000; margin: 7px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .ok { margin-top: 8px; font-size: 15px; font-weight: 800; }
</style>
</head>
<body>
  <div class="center title">BÁN TẠP HÓA</div>
  <div class="center">IN THỬ MÁY IN HÓA ĐƠN</div>
  <div class="line"></div>
  <div class="row"><span>Máy in</span><strong>${escapeHtml(printer.displayName || printer.name)}</strong></div>
  <div class="row"><span>Device</span><span>${escapeHtml(printer.name)}</span></div>
  <div class="row"><span>Khổ nội dung</span><span>${paperSize === 'A4' ? 'A4 (210 × 297 mm)' : paperSize === '58mm' ? '58mm' : '7,8 cm / máy 80mm'}</span></div>
  <div class="row"><span>Scale</span><span>100%</span></div>
  <div class="row"><span>Thời gian</span><span>${escapeHtml(now)}</span></div>
  <div class="line"></div>
  <div class="center ok">KẾT NỐI MÁY IN THÀNH CÔNG</div>
</body>
</html>`;
}

function receiptPageWidthMicrons(paperSize) {
  return paperSize === '58mm' ? 58_000 : 80_000;
}

function receiptBottomFeedMicrons(paperSize) {
  return paperSize === '58mm' ? 22_000 : 30_000;
}

function pixelsToMicrons(value) {
  return Math.ceil((Number(value) * 25_400) / 96);
}

async function printHtmlToPrinter(printer, paperSize, html, failureLabel) {
  if (typeof html !== 'string' || !html.trim() || html.length > 1_000_000) {
    throw new Error('Nội dung hóa đơn không hợp lệ.');
  }

  return new Promise(async (resolve, reject) => {
    const printWindow = new BrowserWindow({
      show: false,
      width: 420,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let completed = false;
    const finish = (error) => {
      if (completed) return;
      completed = true;
      if (!printWindow.isDestroyed()) printWindow.destroy();
      if (error) reject(error);
      else resolve();
    };

    printWindow.webContents.once('did-fail-load', (_event, _code, description) => {
      finish(new Error(description || failureLabel));
    });

    printWindow.webContents.once('did-finish-load', async () => {
      try {
        await printWindow.webContents.executeJavaScript(`
          Promise.all(Array.from(document.images).map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise((resolve) => {
              image.addEventListener('load', resolve, { once: true });
              image.addEventListener('error', resolve, { once: true });
            });
          }))
        `, true);

        const contentHeightPx = await printWindow.webContents.executeJavaScript(`
          Math.max(
            document.documentElement?.scrollHeight || 0,
            document.documentElement?.offsetHeight || 0,
            document.body?.scrollHeight || 0,
            document.body?.offsetHeight || 0,
            Math.ceil(document.body?.getBoundingClientRect().height || 0)
          )
        `, true);

        const pageSize = paperSize === 'A4'
          ? { width: 210_000, height: 297_000 }
          : {
              width: receiptPageWidthMicrons(paperSize),
              height: Math.max(
                50_000,
                pixelsToMicrons(contentHeightPx) + receiptBottomFeedMicrons(paperSize),
              ),
            };

        printWindow.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName: printer.name,
            color: false,
            margins: { marginType: 'none' },
            landscape: false,
            scaleFactor: 100,
            copies: 1,
            pageSize,
          },
          (success, failureReason) => {
            if (!success) {
              finish(new Error(failureReason || failureLabel));
              return;
            }
            finish();
          },
        );
      } catch (error) {
        finish(error instanceof Error ? error : new Error(failureLabel));
      }
    });

    try {
      await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    } catch (error) {
      finish(error instanceof Error ? error : new Error(failureLabel));
    }
  });
}

function printTestReceipt(printer, paperSize) {
  const html = buildPrinterTestHtml(printer, paperSize);
  return printHtmlToPrinter(printer, paperSize, html, 'Lệnh in thử thất bại.');
}

async function createMainWindow(background = false) {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#fbf7f2',
    title: 'Bán Tạp Hóa - Quản lý bán hàng',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) return;
    event.preventDefault();
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
  });

  window.once('ready-to-show', () => {
    if (!background || !tray) window.show();
  });
  window.on('close', (event) => {
    if (tray && !quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  // Windows shutdown does not necessarily emit app.before-quit.
  window.on('query-session-end', () => { quitting = true; });
  window.on('session-end', () => { quitting = true; });

  if (app.isPackaged) {
    await window.loadFile(rendererPath('index.html'));
  } else {
    try {
      await window.loadURL(DEV_SERVER_URL);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await window.loadURL(
        'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<!doctype html><meta charset="utf-8"><title>Bán Tạp Hóa Desktop</title>' +
          '<body style="font-family:Arial;padding:32px">' +
          '<h2>Chưa kết nối được Vite dev server</h2>' +
          '<p>Hãy chạy <code>npm run dev</code> trước, sau đó mở lại <code>npm run desktop:dev</code>.</p>' +
          '<pre>' + message.replace(/[&<>]/g, '') + '</pre></body>',
        ),
      );
    }
  }

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
}

function requireDrawerSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents
    || event.senderFrame !== event.sender.mainFrame
    || !isAllowedNavigation(event.senderFrame?.url || '')) {
    throw new Error('Không cho phép điều khiển két từ cửa sổ này.');
  }
}

ipcMain.handle('desktop:get-cash-drawer-settings', (event) => {
  requireDrawerSender(event);
  return cashDrawer.readSettings();
});
ipcMain.handle('desktop:get-cash-drawer-lan-info', (event) => {
  requireDrawerSender(event);
  const settings = cashDrawer.readSettings();
  let certificate = null;
  try { certificate = lanCertificates.publicInfo(settings.relayHost); } catch { /* Not prepared yet. */ }
  return { addresses: lanAddresses(), certificate, running: Boolean(drawerRelay.address()) && settings.relayMode === 'lan' };
});
ipcMain.handle('desktop:prepare-cash-drawer-lan', async (event, host) => {
  requireDrawerSender(event);
  if (preparingLan) throw new Error('Đang chuẩn bị chứng chỉ LAN.');
  preparingLan = true;
  try { return await lanCertificates.prepare(host); }
  finally { preparingLan = false; }
});
ipcMain.handle('desktop:save-cash-drawer-settings', async (event, input) => {
  requireDrawerSender(event);
  const settings = cashDrawer.saveSettings(input);
  await drawerRelay.close();
  await drawerRelay.start();
  return settings;
});
ipcMain.handle('desktop:open-cash-drawer', (event, input) => {
  requireDrawerSender(event);
  return cashDrawer.open(input?.transactionId || input?.expenseId);
});

ipcMain.handle('desktop:get-version', () => app.getVersion());

ipcMain.handle('desktop:get-printers', async (event) => getPrinters(event.sender));

ipcMain.handle('desktop:get-printer-settings', () => readPrinterSettings());

ipcMain.handle('desktop:save-printer-settings', async (event, input) => {
  const printer = await requireInstalledPrinter(event.sender, input?.deviceName);
  const kind = input?.kind === 'a4' ? 'a4' : 'receipt';
  return writePrinterSettings(kind, printer.name);
});

ipcMain.handle('desktop:test-printer', async (event, input) => {
  const printer = await requireInstalledPrinter(event.sender, input?.deviceName);
  const paperSize = input?.paperSize === 'A4'
    ? 'A4'
    : input?.paperSize === '58mm'
      ? '58mm'
      : '80mm';
  await printTestReceipt(printer, paperSize);
  return { ok: true };
});

ipcMain.handle('desktop:print-receipt', async (event, input) => {
  const saved = readPrinterSettings();
  const printer = await requireInstalledPrinter(event.sender, saved.receiptDeviceName);
  const paperSize = input?.paperSize === '58mm' ? '58mm' : '80mm';
  await printHtmlToPrinter(
    printer,
    paperSize,
    input?.html,
    'Không thể in hóa đơn trên máy in đã chọn.',
  );
  return { ok: true };
});

ipcMain.handle('desktop:print-a4', async (event, input) => {
  const saved = readPrinterSettings();
  const printer = await requireInstalledPrinter(event.sender, saved.a4DeviceName);
  await printHtmlToPrinter(
    printer,
    'A4',
    input?.html,
    'Không thể in A4 trên máy in đã chọn.',
  );
  return { ok: true };
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);

  app.on('second-instance', showMainWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    void drawerRelay.close();
    if (tray) tray.destroy();
    tray = null;
  });

  app.whenReady().then(async () => {
    createBackgroundTray();
    initializeWindowsStartup();
    await createMainWindow(process.argv.includes('--background'));
    await drawerRelay.start().catch(() => { /* Configuration UI can retry; never pulse on startup. */ });

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !tray) app.quit();
  });
}
