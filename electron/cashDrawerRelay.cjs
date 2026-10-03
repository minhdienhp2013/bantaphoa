const http = require('node:http');
const https = require('node:https');
const { LAN_PORT, CERT_PORT, lanAddresses, certificateHandler } = require('./cashDrawerLan.cjs');
const { timingSafeEqual } = require('node:crypto');
const PORT = 28089;
function createCashDrawerRelay(controller, certificates) {
  let server;
  let setupServer;
  async function start(port) {
    if (server || !controller.readSettings().relayEnabled) return;
    const configuration = controller.readSettings();
    const lan = configuration.relayMode === 'lan';
    if (lan && !lanAddresses().some((entry) => entry.address === configuration.relayHost)) {
      throw new Error('IP máy tính đã đổi; chọn lại IP trong cấu hình LAN.');
    }
    const material = lan ? certificates.read(configuration.relayHost) : null;
    const handler = async (req, res) => {
      const settings = controller.readSettings();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Vary', 'Origin');
      const reply = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (!settings.relayEnabled || req.headers.origin !== settings.relayOrigin) return reply(403, { error: 'forbidden' });
      res.setHeader('Access-Control-Allow-Origin', settings.relayOrigin);
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        if (req.headers['access-control-request-private-network'] === 'true') {
          res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }
        return reply(204, null);
      }
      const expected = Buffer.from(`Bearer ${settings.relayKey}`);
      const supplied = Buffer.from(req.headers.authorization || '');
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return reply(401, { error: 'unauthorized' });
      if (req.method === 'GET' && req.url === '/status') return reply(200, { ready: true });
      if (req.method !== 'POST' || req.url !== '/open') return reply(404, { error: 'not_found' });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'json_required' });
      let body = '';
      try {
        for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 1024) { reply(413, { error: 'too_large' }); req.destroy(); return; } }
        const input = JSON.parse(body);
        // Remote callers choose only a transaction ID, never a destination or raw bytes.
        if (Object.keys(input).length !== 1) return reply(400, { error: 'invalid_request' });
        const result = await controller.open(input.transactionId);
        reply(200, result);
      } catch { if (!res.headersSent) reply(400, { error: 'invalid_request' }); }
    };
    const next = lan ? https.createServer(material.tls, handler) : http.createServer(handler);
    next.requestTimeout = 5000;
    next.headersTimeout = 5000;
    await new Promise((resolve, reject) => {
      next.once('error', reject);
      next.listen(port ?? (lan ? LAN_PORT : PORT), lan ? configuration.relayHost : '127.0.0.1', resolve);
    });
    next.on('error', () => {});
    server = next;
    if (lan) {
      const setup = http.createServer(certificateHandler(material));
      setup.requestTimeout = 5000;
      setup.headersTimeout = 5000;
      try {
        await new Promise((resolve, reject) => {
          setup.once('error', reject); setup.listen(CERT_PORT, configuration.relayHost, resolve);
        });
        setup.on('error', () => {}); setupServer = setup;
      } catch (error) {
        await new Promise((resolve) => { next.close(resolve); next.closeAllConnections(); });
        server = undefined; throw error;
      }
    }
  }
  return { start, address: () => server?.address(), close: () => new Promise((resolve) => {
    const previous = [server, setupServer].filter(Boolean); server = undefined; setupServer = undefined;
    Promise.all(previous.map((item) => new Promise((done) => {
      item.close(done); item.closeAllConnections();
    }))).then(resolve);
  }) };
}
module.exports = { createCashDrawerRelay, PORT };
