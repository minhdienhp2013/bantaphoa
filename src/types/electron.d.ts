export {};

export interface CashDrawerSettings {
  enabled: boolean;
  transport?: 'lan' | 'usb';
  printerName?: string;
  relayEnabled?: boolean;
  relayOrigin?: string;
  relayKey?: string;
  relayMode?: 'tailscale' | 'lan';
  relayHost?: string;
  host: string;
  port: number;
  pin: 0 | 1;
  onTime: number;
  offTime: number;
}

export interface CashDrawerLanCertificate {
  url: string;
  certificateUrl: string;
  fingerprint: string;
  expiresAt: number;
}
export interface CashDrawerLanInfo {
  addresses: Array<{ name: string; address: string }>;
  certificate: CashDrawerLanCertificate | null;
  running: boolean;
}
declare global {
  interface Window {
    minhDienDesktop?: {
      isElectron: true;
      platform: string;
      getCashDrawerSettings?: () => Promise<CashDrawerSettings>;
      getCashDrawerLanInfo?: () => Promise<CashDrawerLanInfo>;
      prepareCashDrawerLan?: (host: string) => Promise<CashDrawerLanCertificate>;
      saveCashDrawerSettings?: (input: CashDrawerSettings) => Promise<CashDrawerSettings>;
      openCashDrawer?: (input: { transactionId: string }) => Promise<{
        status: 'not_configured' | 'busy' | 'already_attempted' | 'sent' | 'failed';
      }>;
      getVersion: () => Promise<string>;
      getPrinters: () => Promise<Array<{
        name: string;
        displayName?: string;
        description?: string;
        status?: number;
        isDefault?: boolean;
      }>>;
      getPrinterSettings: () => Promise<{
        receiptDeviceName: string;
        a4DeviceName: string;
        deviceName: string;
      }>;
      savePrinterSettings: (input: {
        deviceName: string;
        kind?: 'receipt' | 'a4';
      }) => Promise<{
        receiptDeviceName: string;
        a4DeviceName: string;
        deviceName: string;
      }>;
      testPrinter: (input: {
        deviceName: string;
        paperSize: '58mm' | '80mm' | 'A4';
      }) => Promise<{
        ok: true;
      }>;
      printReceipt: (input: {
        html: string;
        paperSize: '58mm' | '80mm';
      }) => Promise<{
        ok: true;
      }>;
      printA4: (input: {
        html: string;
      }) => Promise<{
        ok: true;
      }>;
    };
  }
}

