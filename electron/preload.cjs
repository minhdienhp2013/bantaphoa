const { contextBridge, ipcRenderer } = require('electron');

const desktopApi = Object.freeze({
  isElectron: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('desktop:get-version'),
  getCashDrawerSettings: () => ipcRenderer.invoke('desktop:get-cash-drawer-settings'),
  getCashDrawerLanInfo: () => ipcRenderer.invoke('desktop:get-cash-drawer-lan-info'),
  prepareCashDrawerLan: (host) => ipcRenderer.invoke('desktop:prepare-cash-drawer-lan', host),
  saveCashDrawerSettings: (input) => ipcRenderer.invoke('desktop:save-cash-drawer-settings', input),
  openCashDrawer: (input) => ipcRenderer.invoke('desktop:open-cash-drawer', input),
  getPrinters: () => ipcRenderer.invoke('desktop:get-printers'),
  getPrinterSettings: () => ipcRenderer.invoke('desktop:get-printer-settings'),
  savePrinterSettings: (input) => ipcRenderer.invoke('desktop:save-printer-settings', input),
  testPrinter: (input) => ipcRenderer.invoke('desktop:test-printer', input),
  printReceipt: (input) => ipcRenderer.invoke('desktop:print-receipt', input),
  printA4: (input) => ipcRenderer.invoke('desktop:print-a4', input),
});

contextBridge.exposeInMainWorld('banTapHoaDesktop', desktopApi);
