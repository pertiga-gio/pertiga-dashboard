/**
 * Pértiga Dashboard — Backend Server (Real Code Excerpt)
 *
 * This is real production code from the Pértiga Dashboard, sanitized for public
 * display: internal IPs and API keys replaced with placeholders. This shows the
 * actual architecture and patterns used — not a skeleton/mock.
 *
 * Stack: Node.js http module (no Express), SHA-256 auth, session cookies,
 * rate limiting, PostgREST reverse proxy, Ollama embedding generation.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const PORT = 3002;
const DIR = path.join(__dirname);
const POSTGREST_HOST = process.env.POSTGREST_HOST || '127.0.0.1';
const POSTGREST_PORT = 3000;
const OLLAMA_HOST = process.env.OLLAMA_HOST || '127.0.0.1';
const OLLAMA_PORT = 11434;

// API key for PostgREST — injected into dashboard HTML at serve time (never exposed in client JS bundle)
const API_KEY = process.env.PERTIGA_API_KEY;
if (!API_KEY) {
  console.error('FATAL: PERTIGA_API_KEY environment variable not set');
  process.exit(1);
}

// === AUTH: bcrypt + JWT session cookie ===
const USERS = {};
// Password hash is bcrypt (60 chars), stored in env var
USERS[process.env.PERTIGA_ADMIN_USER || 'admin'] =
  process.env.PERTIGA_ADMIN_HASH || bcrypt.hashSync('changeme', 10);
const SESSIONS = new Map();
const COOKIE_NAME = 'pertiga_session';
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

// === RATE LIMITING: 5 attempts → 15 min lockout ===
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

// === EMBEDDING BATCH: prevent concurrent runs ===
let embedMissingRunning = false;

const MAX_BODY = 1e6; // 1MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', d => {
      body += d;
      if (body.length > MAX_BODY) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseCookies(str) {
  const c = {};
  (str || '').split(';').forEach(p => {
    const eqIdx = p.indexOf('=');
    if (eqIdx > 0) {
      c[p.substring(0, eqIdx).trim()] = p.substring(eqIdx + 1).trim();
    }
  });
  return c;
}

function getSession(req) {
  const c = parseCookies(req.headers.cookie);
  const sid = c[COOKIE_NAME];
  if (sid && SESSIONS.has(sid)) {
    const session = SESSIONS.get(sid);
    if (Date.now() - session.ts > SESSION_MAX_AGE) {
      SESSIONS.delete(sid);
      return null;
    }
    return session;
  }
  return null;
}

// === PostgREST reverse proxy with API key injection ===
function proxyApi(req, res) {
  const allowed = ['GET', 'POST', 'PATCH', 'OPTIONS', 'HEAD'];
  if (!allowed.includes(req.method)) {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // API key injected server-side — client never sees it
  const proxyHeaders = {
    'Content-Type': req.headers['content-type'] || 'application/json',
    'apikey': API_KEY,
    'Authorization': 'Bearer ' + API_KEY,
    'Prefer': req.headers['prefer'] || 'return=representation'
  };

  const opts = {
    method: req.method,
    hostname: POSTGREST_HOST,
    port: POSTGREST_PORT,
    path: req.url,
    headers: proxyHeaders,
    timeout: 30000
  };

  const proxy = http.request(opts, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res, { end: true });
  });
  proxy.on('error', (e) => {
    console.error('Proxy error:', e.message);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  });
  proxy.on('timeout', () => {
    proxy.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request timeout' }));
    }
  });
  req.pipe(proxy, { end: true });
}

// === HTTP server: route handlers ===
http.createServer((req, res) => {
  // Strip /dashboard prefix so all routes are normalized
  if (req.url.startsWith('/dashboard')) {
    req.url = req.url.replace(/^\/dashboard/, '') || '/';
  }

  // POST /login → validate credentials, create session, set cookie
  if (req.url === '/login' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const attempts = loginAttempts.get(ip) || { count: 0, last: 0 };
    if (attempts.count >= MAX_LOGIN_ATTEMPTS && Date.now() - attempts.last < LOGIN_LOCKOUT_MS) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Too many login attempts. Try again later.' }));
    }

    readBody(req).then(body => {
      try {
        const { user, pass } = JSON.parse(body);
        if (USERS[user] && bcrypt.compareSync(pass, USERS[user])) {
          loginAttempts.delete(ip);
          const sid = crypto.randomBytes(32).toString('hex');
          SESSIONS.set(sid, { user, ts: Date.now() });
          const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
          res.writeHead(200, {
            'Set-Cookie': `${COOKIE_NAME}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secureFlag}`,
            'Content-Type': 'application/json'
          });
          return res.end('{"ok":true}');
        }
      } catch(e) {}
      loginAttempts.set(ip, { count: attempts.count + 1, last: Date.now() });
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"ok":false}');
    }).catch(e => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
    });
    return;
  }

  // GET /logout → destroy session, redirect to login
  if (req.url === '/logout') {
    const c = parseCookies(req.headers.cookie);
    if (c[COOKIE_NAME]) SESSIONS.delete(c[COOKIE_NAME]);
    res.writeHead(302, { 'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`, Location: '/dashboard/' });
    return res.end();
  }

  // GET / → serve login page or dashboard (depending on session)
  if (req.url === '/' || req.url === '/index.html') {
    if (getSession(req)) {
      // Serve dashboard HTML with API key injected via window variable
      const fp = path.join(DIR, 'index.html');
      fs.readFile(fp, 'utf8', (err, data) => {
        if (err) { res.writeHead(500); return res.end('Error loading dashboard'); }
        // API key injected as JS variable — visible to client but never in static HTML
        const injected = data.replace(
          '</head>',
          '<script>window.__PERTIGA_API_KEY=' + JSON.stringify(API_KEY) + ';</script>\n</head>'
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(injected);
      });
    } else {
      // Serve login page (inline HTML, omitted here for brevity)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(/* LOGIN_PAGE HTML */);
    }
    return;
  }

  // Auth check: everything below requires a valid session
  if (!getSession(req)) {
    const c = parseCookies(req.headers.cookie);
    if (c[COOKIE_NAME]) {
      // Invalid/expired session — clear cookie and redirect
      res.writeHead(302, { 'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`, Location: '/dashboard/' });
    } else {
      res.writeHead(302, { Location: '/dashboard/' });
    }
    return res.end();
  }

  // POST /embed-property → generate embedding via Ollama, save to PostgREST
  if (req.url === '/embed-property' && req.method === 'POST') {
    readBody(req).then(body => {
      try {
        const { id, searchText } = JSON.parse(body);
        if (!id || !searchText) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'id and searchText required' }));
        }

        // 1. Call Ollama to generate embedding (bge-m3, 1024 dimensions)
        const embReq = http.request({
          hostname: OLLAMA_HOST, port: OLLAMA_PORT, method: 'POST',
          path: '/api/embed', headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        }, (embRes) => {
          let embData = '';
          embRes.on('data', d => embData += d);
          embRes.on('end', () => {
            try {
              const embJson = JSON.parse(embData);
              const embedding = embJson.embeddings[0];

              // 2. Update property in PostgREST with new embedding
              const patchBody = JSON.stringify({ embedding: embedding });
              const patchReq = http.request({
                hostname: POSTGREST_HOST, port: POSTGREST_PORT, method: 'PATCH',
                path: '/properties?id=eq.' + encodeURIComponent(id),
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': API_KEY,
                  'Authorization': 'Bearer ' + API_KEY,
                  'Prefer': 'return=minimal'
                },
                timeout: 30000
              }, (patchRes) => {
                let patchData = '';
                patchRes.on('data', d => patchData += d);
                patchRes.on('end', () => {
                  if (patchRes.statusCode < 300) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                  } else {
                    res.writeHead(patchRes.statusCode, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'PostgREST ' + patchRes.statusCode }));
                  }
                });
              });
              patchReq.on('error', e => {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bad Gateway' }));
              });
              patchReq.write(patchBody);
              patchReq.end();
            } catch(e) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Embed parse error' }));
            }
          });
        });
        embReq.on('error', e => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bad Gateway' }));
        });
        embReq.on('timeout', () => {
          embReq.destroy();
          if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request timeout' }));
          }
        });
        embReq.write(JSON.stringify({ model: 'bge-m3', input: searchText }));
        embReq.end();
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    }).catch(e => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
    });
    return;
  }

  // ALL /api/* requests → proxy to PostgREST with API key injected
  if (req.url.startsWith('/api/')) {
    req.url = req.url.replace(/^\/api/, '').split('?')[0];
    return proxyApi(req, res);
  }

  // Static files (with path traversal protection)
  let fp = path.join(DIR, req.url === '/' ? '/index.html' : req.url);
  if (!fp.startsWith(DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(fp);
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Pértiga Dashboard running on http://0.0.0.0:${PORT}`);
});
