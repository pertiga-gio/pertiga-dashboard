/**
 * Inmobiliaria Puerta — Proxy de Webhooks Meta (Extracto de código real)
 *
 * Recibe webhooks de Meta Cloud API (WhatsApp Business), verifica la firma
 * HMAC-SHA256, aplica rate limiting, filtra bots, y ruthea a n8n por phone_number_id.
 * Sanitizado: tokens y secretos reemplazados por placeholders.
 */

const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

// === CONFIG (valores reales desde .env) ===
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || '***placeholder***';
const APP_SECRET = process.env.META_APP_SECRET || '';
const N8N_PORT = parseInt(process.env.N8N_PORT || '5678');
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '8090');
const LOG_FILE = process.env.PROXY_LOG_FILE || '/tmp/proxy.log';
const MAX_BODY_SIZE = 1 * 1024 * 1024;  // 1MB

// === BOT BLOCKLIST — drop messages from known spam numbers ===
const BOT_BLOCKLIST = ['573152333333'];

// === RATE LIMITING (en memoria, por IP) ===
const rateLimiter = {
  window: 60 * 1000,     // 1 minuto
  maxRequests: 60,      // 60 req/min por IP
  hits: new Map(),

  check(ip) {
    const now = Date.now();
    const record = this.hits.get(ip) || { count: 0, start: now };

    if (now - record.start > this.window) {
      record.count = 0;
      record.start = now;
    }

    record.count++;
    this.hits.set(ip, record);

    // Limpieza periódica
    if (this.hits.size > 1000) {
      for (const [key, val] of this.hits) {
        if (now - val.start > this.window) this.hits.delete(key);
      }
    }

    return record.count <= this.maxRequests;
  }
};

// === LOG CON ROTACIÓN ===
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > 5 * 1024 * 1024) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.${ts.replace(/[:.]/g, '-')}`);
    }
  } catch (e) { /* archivo no existe aún */ }
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

// === VALIDACIÓN DE FIRMA META (HMAC-SHA256) ===
function verifyMetaSignature(rawBody, signatureHeader) {
  if (!APP_SECRET || !signatureHeader) return true; // skip in dev without secret
  if (!signatureHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  // Timing-safe comparison
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

// === SERVIDOR HTTP ===
http.createServer((req, res) => {
  // GET: webhook verification handshake de Meta
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://localhost:${PROXY_PORT}`);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      log('✅ Webhook verified');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(challenge);
    }
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // POST: incoming webhook
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end('Method not allowed');
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // Rate limiting
  if (!rateLimiter.check(clientIp)) {
    log(`⚠️ Rate limited: ${clientIp}`);
    res.writeHead(429);
    return res.end('Too many requests');
  }

  let rawBody = '';
  req.on('data', chunk => {
    rawBody += chunk;
    if (rawBody.length > MAX_BODY_SIZE) {
      req.destroy();
      res.writeHead(413);
      res.end('Payload too large');
    }
  });

  req.on('end', () => {
    // 1. HMAC-SHA256 signature verification
    const signature = req.headers['x-hub-signature-256'];
    if (!verifyMetaSignature(rawBody, signature)) {
      log(`❌ Invalid signature from ${clientIp}`);
      res.writeHead(401);
      return res.end('Invalid signature');
    }

    let parsed;
    try { parsed = JSON.parse(rawBody); } catch(e) {
      res.writeHead(400);
      return res.end('Invalid JSON');
    }

    // 2. Extraer phone_number_id para routing
    const phoneId = parsed?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    const messages = parsed?.entry?.[0]?.changes?.[0]?.value?.messages;

    if (!messages || messages.length === 0) {
      res.writeHead(200);
      return res.end('OK (no messages)');
    }

    // 3. BOT BLOCKLIST — drop spam
    const from = messages[0]?.from;
    if (from && BOT_BLOCKLIST.includes(from)) {
      log(`🚫 Blocked: ${from}`);
      res.writeHead(200);
      return res.end('OK (blocked)');
    }

    // 4. ROUTING por phone_number_id
    let n8nPath = '/webhook/whatsapp-cloud-inbound'; // default: Inmobiliaria Puerta
    if (phoneId === '1167136503139836') {
      n8nPath = '/webhook/pertiga-inbound'; // Pertiga Bot Empresa
      log(`🔀 Routing to Pertiga Bot (phone_number_id: ${phoneId})`);
    } else {
      log(`🔀 Routing to Inmobiliaria Puerta (phone_number_id: ${phoneId || 'default'})`);
    }

    // 5. Forward to n8n
    const n8nReq = http.request({
      hostname: '127.0.0.1',
      port: N8N_PORT,
      path: n8nPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    }, (n8nRes) => {
      n8nRes.pipe(res);
    });

    n8nReq.on('error', (e) => {
      log(`❌ n8n error: ${e.message}`);
      res.writeHead(502);
      res.end('Bad Gateway');
    });

    n8nReq.on('timeout', () => {
      n8nReq.destroy();
      log('⏰ n8n timeout');
      res.writeHead(504);
      res.end('Gateway timeout');
    });

    n8nReq.write(rawBody);
    n8nReq.end();
  });
}).listen(PROXY_PORT, '0.0.0.0', () => {
  log(`🚀 Pertiga Proxy running on port ${PROXY_PORT}`);
});
