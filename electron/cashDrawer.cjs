const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { sendUsbPulse } = require('./cashDrawerUsb.cjs');

const DEFAULT_SETTINGS = Object.freeze({ enabled: false, host: '', port: 9100, pin: 0, onTime: 25, offTime: 250 });

function normalizeSettings(input) {
  if (!input || typeof input.enabled !== 'boolean') throw new Error('Cấu hình két tiền không hợp lệ.');
  const settings = {
    enabled: input.enabled,
    host: typeof input.host === 'string' ? input.host.trim() : '',
    port: input.port, pin: input.pin, onTime: input.onTime, offTime: input.offTime,
  };
  if (input.transport !== undefined) {
    if (!['lan', 'usb'].includes(input.transport)) throw new Error('Kiểu kết nối két không hợp lệ.');
    settings.transport = input.transport;
    settings.printerName = typeof input.printerName === 'string' ? input.printerName.trim() : '';
    if (settings.printerName.length > 240 || /[\x00-\x1f]/.test(settings.printerName)) throw new Error('Tên máy in không hợp lệ.');
    if (settings.enabled && settings.transport === 'usb' && !settings.printerName) throw new Error('Chưa chọn máy in USB.');
  }
  if (input.relayEnabled !== undefined) {
    if (typeof input.relayEnabled !== 'boolean') throw new Error('Cấu hình cầu nối không hợp lệ.');
    settings.relayEnabled = input.relayEnabled;
    settings.relayOrigin = typeof input.relayOrigin === 'string' ? input.relayOrigin.trim() : '';
    settings.relayKey = typeof input.relayKey === 'string' ? input.relayKey : '';
    settings.relayMode = input.relayMode === undefined ? 'tailscale' : input.relayMode;
    if (!['tailscale', 'lan'].includes(settings.relayMode)) throw new Error('Kiểu cầu nối không hợp lệ.');
    settings.relayHost = typeof input.relayHost === 'string' ? input.relayHost.trim() : '';
    if (settings.relayMode === 'lan' && (settings.relayEnabled || settings.relayHost)
      && !require('./cashDrawerLan.cjs').isPrivateIPv4(settings.relayHost)) {
      throw new Error('Chọn IP mạng nội bộ của máy tính tại quầy.');
    }
    if (settings.relayEnabled) {
      let origin;
      try { origin = new URL(settings.relayOrigin); } catch { throw new Error('Nhập địa chỉ HTTPS của ứng dụng bán hàng.'); }
      if (origin.protocol !== 'https:' || origin.origin !== settings.relayOrigin) throw new Error('Nhập đúng origin HTTPS, không có đường dẫn.');
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(settings.relayKey)) throw new Error('Mã ghép nối cần 32–128 ký tự.');
    }
  }
  const octets = settings.host.split('.').map(Number);
  const privateAddress = net.isIP(settings.host) === 4 && (
    octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
  );
  if (settings.host && !privateAddress) throw new Error('Nhập IP nội bộ của máy in (10.x, 172.16–31.x hoặc 192.168.x).');
  if (settings.enabled && settings.transport !== 'usb' && !privateAddress) throw new Error('Chưa nhập IP nội bộ của máy in.');
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535
    || ![0, 1].includes(settings.pin)
    || !Number.isInteger(settings.onTime) || settings.onTime < 1 || settings.onTime > 255
    || !Number.isInteger(settings.offTime) || settings.offTime < settings.onTime || settings.offTime > 255) {
    throw new Error('Cổng hoặc thời gian xung mở két không hợp lệ.');
  }
  return settings;
}

// ESC/POS ESC p: connector selection, ON/OFF durations in units of 2 ms.
// This sends only five command bytes; it does not print a receipt or feed paper.
function sendPulse(settings, connect = net.createConnection, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let socket;
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket?.destroy();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Máy in không phản hồi lệnh mở két.')), timeoutMs);
    try {
      socket = connect({ host: settings.host, port: settings.port });
      socket.once('error', () => finish(new Error('Không kết nối được máy in để mở két.')));
      socket.once('close', () => finish(new Error('Kết nối máy in đã đóng trước khi gửi xong lệnh.')));
      socket.once('connect', () => {
        try {
          socket.end(Buffer.from([0x1b, 0x70, settings.pin, settings.onTime, settings.offTime]),
            () => finish());
        } catch (error) { finish(error); }
      });
    } catch (error) { finish(error); }
  });
}

function createCashDrawerController(getDirectory, send = (settings) => settings.transport === 'usb' ? sendUsbPulse(settings) : sendPulse(settings), clock = Date.now) {
  const file = (name) => path.join(getDirectory(), name);
  function readSettings() {
    try { return normalizeSettings(JSON.parse(fs.readFileSync(file('cash-drawer.json'), 'utf8'))); }
    catch { return { ...DEFAULT_SETTINGS }; }
  }
  function writeJson(name, value) {
    const destination = file(name);
    fs.writeFileSync(destination + '.tmp', JSON.stringify(value), 'utf8');
    fs.renameSync(destination + '.tmp', destination);
  }
  function saveSettings(input) {
    const settings = normalizeSettings(input);
    writeJson('cash-drawer.json', settings);
    return settings;
  }
  let busy = false;
  let lastAttemptAt = -Infinity;
  async function open(transactionId) {
    if (typeof transactionId !== 'string' || !/^POS_(?:EXPENSE|QUICK|PRODUCT|MANUAL)_[A-Za-z0-9_-]{1,120}$/.test(transactionId)) {
      throw new Error('Mã giao dịch mở két không hợp lệ.');
    }
    const settings = readSettings();
    const manual = transactionId.startsWith('POS_MANUAL_');
    if (!(settings.transport === 'usb' ? settings.printerName : settings.host) || (!manual && !settings.enabled)) return { status: 'not_configured' };
    if (busy || clock() - lastAttemptAt < 2000) return { status: 'busy' };
    // Journal before network I/O: timeout/restart must never automatically pulse twice.
    let attempted = [];
    const journal = file('cash-drawer-attempts.json');
    if (fs.existsSync(journal)) {
      attempted = JSON.parse(fs.readFileSync(journal, 'utf8'));
      if (!Array.isArray(attempted) || !attempted.every((id) => typeof id === 'string')) {
        throw new Error('Không đọc được lịch sử lệnh két. Kiểm tra cấu hình trên máy tính.');
      }
    }
    if (attempted.includes(transactionId)) return { status: 'already_attempted' };
    writeJson('cash-drawer-attempts.json', [...attempted, transactionId]);
    busy = true;
    lastAttemptAt = clock();
    try {
      await send(settings);
      return { status: 'sent' };
    } catch {
      return { status: 'failed' };
    } finally { busy = false; }
  }
  return { readSettings, saveSettings, open };
}

module.exports = { DEFAULT_SETTINGS, normalizeSettings, sendPulse, createCashDrawerController };
