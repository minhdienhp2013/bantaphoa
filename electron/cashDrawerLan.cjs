const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { randomBytes, X509Certificate } = require('node:crypto');

const LAN_PORT = 28090;
const CERT_PORT = 28091;
function isPrivateIPv4(address) {
  if (typeof address !== 'string') return false;
  const [a, b] = String(address).split('.').map(Number);
  return net.isIP(address) === 4 && (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
}
function lanAddresses(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([name, entries]) => (entries || [])
    .filter((entry) => !entry.internal && isPrivateIPv4(entry.address))
    .map((entry) => ({ name, address: entry.address })));
}

// All user data travels in environment variables, never interpolated into PowerShell.
const CERT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')
Import-Module (Join-Path $PSHOME 'Modules\PKI\PKI.psd1')
$root = $null; $leaf = $null
try {
  $root = New-SelfSignedCertificate -Type Custom -Subject 'CN=Minh Dien Cash Drawer LAN' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -KeyUsage CertSign,CRLSign -TextExtension @('2.5.29.19={critical}{text}ca=true&pathlength=0') -NotAfter (Get-Date).AddYears(10)
  $leaf = New-SelfSignedCertificate -Type Custom -Subject ('CN=' + $env:MINHDIEN_LAN_IP) -Signer $root -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @(('2.5.29.17={text}IPAddress=' + $env:MINHDIEN_LAN_IP), '2.5.29.37={text}1.3.6.1.5.5.7.3.1', '2.5.29.19={critical}{text}ca=false') -NotAfter (Get-Date).AddDays(365)
  Export-Certificate -Cert $root -FilePath (Join-Path $env:MINHDIEN_LAN_DIR 'root.cer') -Type CERT | Out-Null
  Export-Certificate -Cert $leaf -FilePath (Join-Path $env:MINHDIEN_LAN_DIR 'server.cer') -Type CERT | Out-Null
  $password = ConvertTo-SecureString $env:MINHDIEN_LAN_PASSWORD -AsPlainText -Force
  Export-PfxCertificate -Cert $leaf -FilePath (Join-Path $env:MINHDIEN_LAN_DIR 'server.pfx') -Password $password -ChainOption EndEntityCertOnly -CryptoAlgorithmOption AES256_SHA256 | Out-Null
} finally {
  if ($leaf) { Remove-Item ('Cert:\CurrentUser\My\' + $leaf.Thumbprint) -DeleteKey }
  if ($root) { Remove-Item ('Cert:\CurrentUser\My\' + $root.Thumbprint) -DeleteKey }
}
`;

function createLanCertificates(getDirectory, safeStorage) {
  const directory = () => path.join(getDirectory(), 'cash-drawer-lan');
  function read(host) {
    if (!isPrivateIPv4(host)) throw new Error('Chọn IP mạng nội bộ của máy tính tại quầy.');
    const saved = JSON.parse(fs.readFileSync(path.join(directory(), 'config.json'), 'utf8'));
    if (saved.host !== host || Date.now() >= saved.expiresAt) throw new Error('Tạo chứng chỉ LAN cho IP này trong cấu hình két.');
    const root = fs.readFileSync(path.join(directory(), 'root.cer'));
    const certificate = new X509Certificate(root);
    return {
      tls: { pfx: fs.readFileSync(path.join(directory(), 'server.pfx')),
        passphrase: safeStorage.decryptString(Buffer.from(saved.password, 'base64')), minVersion: 'TLSv1.2' },
      root, fingerprint: certificate.fingerprint256, expiresAt: saved.expiresAt,
    };
  }
  async function prepare(host) {
    if (process.platform !== 'win32') throw new Error('Tạo chứng chỉ LAN hiện hỗ trợ máy tính Windows.');
    if (!lanAddresses().some((entry) => entry.address === host)) throw new Error('Chọn IP của máy tính đang nối mạng nội bộ.');
    try { return publicInfo(host); } catch { /* Create only when missing, expired, or IP changed. */ }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows chưa sẵn sàng bảo vệ chứng chỉ LAN.');
    const temporary = fs.mkdtempSync(path.join(getDirectory(), 'drawer-cert-'));
    const password = randomBytes(32).toString('hex');
    try {
      await new Promise((resolve, reject) => execFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(CERT_SCRIPT, 'utf16le').toString('base64'),
      ], { windowsHide: true, timeout: 60000, env: { ...process.env,
        PSModulePath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
        MINHDIEN_LAN_IP: host, MINHDIEN_LAN_DIR: temporary, MINHDIEN_LAN_PASSWORD: password } },
      (error) => error ? reject(new Error('Không tạo được chứng chỉ LAN trên Windows.', { cause: error })) : resolve()));
      require('node:tls').createSecureContext({ pfx: fs.readFileSync(path.join(temporary, 'server.pfx')), passphrase: password });
      const expiresAt = new X509Certificate(fs.readFileSync(path.join(temporary, 'server.cer'))).validTo;
      fs.writeFileSync(path.join(temporary, 'config.json'), JSON.stringify({ host,
        expiresAt: Date.parse(expiresAt), password: safeStorage.encryptString(password).toString('base64') }));
      // Keep the previous working certificate until generation and validation succeed.
      const backup = directory() + '.previous';
      fs.rmSync(backup, { recursive: true, force: true });
      if (fs.existsSync(directory())) fs.renameSync(directory(), backup);
      try { fs.renameSync(temporary, directory()); }
      catch (error) { if (fs.existsSync(backup)) fs.renameSync(backup, directory()); throw error; }
      fs.rmSync(backup, { recursive: true, force: true });
      return publicInfo(host);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  function publicInfo(host) {
    const { fingerprint, expiresAt } = read(host);
    return { url: `https://${host}:${LAN_PORT}`, certificateUrl: `http://${host}:${CERT_PORT}`,
      fingerprint, expiresAt };
  }
  return { read, prepare, publicInfo };
}

// The unencrypted setup endpoint exposes only the PUBLIC certificate, never keys or pulses.
function certificateHandler(material) {
  const fingerprint = material.fingerprint;
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (req.url === '/root.cer') {
      res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="minh-dien-lan.cer"' });
      return res.end(material.root);
    }
    if (req.url === '/ios.mobileconfig') {
      const data = material.root.toString('base64');
      const id = fingerprint.replaceAll(':', '').slice(0, 32);
      const uuid = id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
      const rootUuid = material.fingerprint.replaceAll(':', '').slice(32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
      res.writeHead(200, { 'Content-Type': 'application/x-apple-aspen-config', 'Content-Disposition': 'attachment; filename="minh-dien-lan.mobileconfig"' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>vn.minhdien.lan.${id}</string><key>PayloadUUID</key><string>${uuid}</string><key>PayloadDisplayName</key><string>Minh Dien Cash Drawer LAN</string><key>PayloadContent</key><array><dict><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>vn.minhdien.lan.root.${id}</string><key>PayloadUUID</key><string>${rootUuid}</string><key>PayloadDisplayName</key><string>Minh Dien Cash Drawer LAN</string><key>PayloadContent</key><data>${data}</data></dict></array></dict></plist>`);
    }
    if (req.url !== '/') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    res.end(`<!doctype html><html lang="vi"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ghép két qua LAN</title><body style="font:18px sans-serif;max-width:640px;margin:24px;overflow-wrap:anywhere"><h1>Ghép két qua LAN</h1><p>Đối chiếu dấu vân tay bên dưới với ứng dụng trên máy tính quầy trước khi cài chứng chỉ.</p><p>${fingerprint}</p><p><a href="/ios.mobileconfig">iPhone/iPad: tải hồ sơ chứng chỉ</a></p><p>Cài đặt → Cài đặt chung → VPN &amp; Quản lý thiết bị → cài hồ sơ. Sau đó Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng chỉ → bật Minh Dien Cash Drawer LAN. Hồ sơ này chỉ chứa chứng chỉ, không tạo VPN.</p><p><a href="/root.cer">Android/Windows: tải chứng chỉ CA</a></p><p>Android: Cài đặt → Bảo mật → Cài chứng chỉ CA (tên menu tùy máy). Windows: mở tệp, cài vào Trusted Root Certification Authorities của Current User.</p><p>Quay lại phần mềm bán hàng, nhập địa chỉ HTTPS và mã ghép nối từ máy tính. Cho phép truy cập mạng nội bộ nếu trình duyệt hỏi. Dùng cùng Wi-Fi, không dùng mạng khách.</p></body></html>`);
  };
}
module.exports = { LAN_PORT, CERT_PORT, isPrivateIPv4, lanAddresses, CERT_SCRIPT, createLanCertificates, certificateHandler };
