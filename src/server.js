/**
 * Pértiga Dashboard — Backend Server (Skeleton)
 * 
 * Node.js HTTP server (no framework) for the real estate analytics dashboard.
 * This is a representative skeleton — the full implementation is not published.
 * 
 * Features:
 * - SHA-256 session authentication with cookie
 * - Rate limiting (5 attempts → 15 min lockout)
 * - PostgREST reverse proxy (API key injected server-side)
 * - Ollama integration for embedding generation (bge-m3, 1024-dim)
 * - Batch embedding for properties without vectors
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3002;
const DIR = path.join(__dirname);
const POSTGREST = 'http://127.0.0.1:3000'; // PostgREST endpoint
const OLLAMA = 'http://127.0.0.1:11434';  // Ollama endpoint

// API key for PostgREST — injected into dashboard at serve time (never exposed to client)
const API_KEY = process.env.PERTIGA_API_KEY;
if (!API_KEY) {
  console.error('FATAL: PERTIGA_API_KEY environment variable not set');
  process.exit(1);
}

// === AUTH: SHA-256 + session cookie ===
const USERS = {};
USERS[process.env.PERTIGA_ADMIN_USER || 'admin'] = 
  process.env.PERTIGA_ADMIN_HASH || crypto.createHash('sha256').update('changeme').digest('hex');
const SESSIONS = new Map();
const COOKIE_NAME = 'pertiga_session';
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

// === RATE LIMITING: 5 attempts → 15 min lockout ===
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

// === EMBEDDING BATCH: prevent concurrent runs ===
let embedMissingRunning = false;

const MAX_BODY = 1e6; // 1MB body limit

// ... (authentication, proxy, and embedding logic omitted in this skeleton)
// Full implementation handles:
// - POST /login → validate credentials, create session, set cookie
// - POST /logout → destroy session
// - GET / → serve index.html with API_KEY injected
// - POST /embed-property → generate embedding via Ollama, save to PostgREST
// - POST /embed-missing → batch process properties without embeddings (50 concurrent)
// - ALL /api/* → proxy to PostgREST with API key header injection
// - GET /* → serve static files

const server = http.createServer(async (req, res) => {
  // Route handlers would go here
  // See README.md for full architecture details
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Pértiga Dashboard running on http://127.0.0.1:${PORT}`);
});
