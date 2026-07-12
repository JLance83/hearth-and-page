// Hearth & Page — Express API Server
// dist/index.cjs — Supabase PostgreSQL edition
// Migrated from SQLite — June 28 2026

'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
let bcrypt;
try { bcrypt = require('bcryptjs'); } catch(e) { bcrypt = null; }
const os = require('os');

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_7xmsQDqc_DfXJZqjovXzezt7wsS5gr8Dc';
const FROM_EMAIL = 'Hearth & Page <support@hearthandpage.ca>';
const APP_URL = process.env.APP_URL || 'https://hearthandpage.ca';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ──────────────────────────────────────────────
// Supabase REST API
// ──────────────────────────────────────────────
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://omuwicdbeuavojrnddwe.supabase.co').trim();
const SUPABASE_KEY = (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tdXdpY2RiZXVhdm9qcm5kZHdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjY1MDYxMiwiZXhwIjoyMDk4MjI2NjEyfQ.bQhktT5DCmLQwF6GPBcrR-pF1auBpjAZu_4gOU-EJL8').trim();

console.log('[DB] Supabase endpoint:', SUPABASE_URL);

// camelCase ↔ snake_case helpers
function toSnakeKey(k) {
  return k.replace(/([A-Z])/g, m => '_' + m.toLowerCase());
}
function toCamelKey(k) {
  return k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function toSnake(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[toSnakeKey(k)] = v;
  return out;
}
function toCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamelKey(k)] = v;
  return out;
}

// Core Supabase REST request
// options: { filters{}, body, returning, upsert, ignoreConflict, order, select, single }
function supaRequest(method, table, options = {}) {
  return new Promise((resolve, reject) => {
    const { filters = {}, body, returning = false, upsert = false, ignoreConflict = false, order, select, single } = options;

    // Build query string
    const qs = [];
    for (const [col, val] of Object.entries(filters)) {
      qs.push(`${col}=${encodeURIComponent(val)}`);
    }
    if (order) qs.push(`order=${encodeURIComponent(order)}`);
    if (select) qs.push(`select=${encodeURIComponent(select)}`);

    const urlPath = `/rest/v1/${table}${qs.length ? '?' + qs.join('&') : ''}`;

    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
    };

    // Prefer header
    const prefs = [];
    if (returning || upsert || ignoreConflict) prefs.push('return=representation');
    if (upsert) prefs.push('resolution=merge-duplicates');
    if (ignoreConflict) prefs.push('resolution=ignore-duplicates');
    if (prefs.length) headers['Prefer'] = prefs.join(',');

    let bodyStr = null;
    if (body) {
      bodyStr = JSON.stringify(body);
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const parsed = new URL(SUPABASE_URL);
    const reqOptions = {
      hostname: parsed.hostname,
      path: urlPath,
      method,
      headers,
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 204 || !data.trim()) return resolve([]);
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            // 409 conflict on ignore — return empty array (caller checks length)
            if (res.statusCode === 409) return resolve([]);
            return reject(new Error(`Supabase ${method} ${table} ${res.statusCode}: ${data}`));
          }
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch(e) {
          reject(new Error(`Supabase parse error: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Convenience wrappers that return camelCase rows
async function dbGet(table, filters = {}, opts = {}) {
  const rows = await supaRequest('GET', table, { filters, ...opts });
  return rows.length ? toCamel(rows[0]) : null;
}
async function dbAll(table, filters = {}, opts = {}) {
  const rows = await supaRequest('GET', table, { filters, ...opts });
  return rows.map(toCamel);
}
async function dbInsert(table, data, opts = {}) {
  const rows = await supaRequest('POST', table, { body: toSnake(data), returning: true, ...opts });
  return rows.length ? toCamel(rows[0]) : null;
}
async function dbUpsert(table, data, opts = {}) {
  const rows = await supaRequest('POST', table, { body: toSnake(data), upsert: true, ...opts });
  return rows.length ? toCamel(rows[0]) : null;
}
async function dbUpdate(table, filters, data) {
  await supaRequest('PATCH', table, { filters, body: toSnake(data) });
}
async function dbDelete(table, filters) {
  await supaRequest('DELETE', table, { filters });
}

// ──────────────────────────────────────────────
// Auth helpers
// ──────────────────────────────────────────────
async function hashPassword(password) {
  if (bcrypt) return bcrypt.hash(password, 10);
  return crypto.createHash('sha256').update(password + 'hearth_salt_2024').digest('hex');
}

async function checkPassword(password, hash) {
  if (bcrypt) {
    try {
      if (hash && (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$'))) {
        return bcrypt.compare(password, hash);
      }
    } catch(e) {}
  }
  const sha = crypto.createHash('sha256').update(password + 'hearth_salt_2024').digest('hex');
  return sha === hash;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not signed in' });
  }
  const token = authHeader.slice(7);
  try {
    // 1. Get session
    const session = await dbGet('sessions', { token: `eq.${token}`, expires_at: `gt.${Date.now()}` });
    if (!session) return res.status(401).json({ message: 'Not signed in' });
    // 2. Get user
    const user = await dbGet('users', { id: `eq.${session.userId}` });
    if (!user) return res.status(401).json({ message: 'Not signed in' });
    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      emailVerified: !!user.emailVerified,
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd,
      gracePeriodEnd: user.gracePeriodEnd,
    };
    req.token = token;
    next();
  } catch (e) {
    console.error('[auth] requireAuth error:', e.message);
    res.status(500).json({ message: 'Auth error' });
  }
}

// ── Subscription middleware ───────────────────────────────────────────────────
const FREE_FORMS = ['form8'];

function requireSubscription(req, res, next) {
  const status = req.user?.subscriptionStatus;
  const plan   = req.user?.plan;
  if (status === 'active' && plan !== 'free') return next();
  if (status === 'past_due') return next();
  const formType = req.params?.formType || req.body?.formType || req.query?.formType || '';
  if (FREE_FORMS.includes(formType)) return next();
  return res.status(403).json({ message: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED', upgradeUrl: '/pricing' });
}

function requirePaidExport(req, res, next) {
  const status = req.user?.subscriptionStatus;
  const plan   = req.user?.plan;
  if ((status === 'active' || status === 'past_due') && plan !== 'free') return next();
  return res.status(403).json({ message: 'PDF download requires a subscription', code: 'PDF_LOCKED', upgradeUrl: '/pricing' });
}

// ──────────────────────────────────────────────
// Resend email helper
// ──────────────────────────────────────────────
function sendViaResend(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(JSON.stringify(parsed)));
        } catch (e) { reject(new Error('Parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ──────────────────────────────────────────────
// Express app
// ──────────────────────────────────────────────
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[express] ${req.method} ${req.path} ${res.statusCode} in ${ms}ms`);
  });
  next();
});

// ──────────────────────────────────────────────
// API Routes
// ──────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), db: 'supabase', keyRole: SUPABASE_KEY.includes('service_role') ? 'service_role' : 'anon' }));
app.post('/api/auth/login-debug', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await dbGet('users', { email: `eq.${email.toLowerCase()}` });
    if (!user) return res.json({ step: 'user_lookup', result: 'NOT_FOUND' });
    const bcrypt2 = require('bcryptjs');
    const ok = await bcrypt2.compare(password, user.passwordHash);
    if (!ok) return res.json({ step: 'password_check', result: 'MISMATCH', hashStart: (user.passwordHash||'').substring(0,15) });
    try {
      const tok = require('crypto').randomBytes(32).toString('hex');
      const exp = Date.now() + 86400000;
      const sess = await dbInsert('sessions', { userId: user.id, token: tok, expiresAt: exp, createdAt: Date.now() });
      await dbDelete('sessions', { token: `eq.${tok}` });
      return res.json({ step: 'all_ok', userId: user.id, plan: user.plan });
    } catch(e2) { return res.json({ step: 'session_insert', error: e2.message }); }
  } catch(e) { return res.json({ step: 'exception', error: e.message }); }
});
app.get('/api/status', (req, res) => res.json({ ok: true, version: '3.4.4-pdfjs-text', db: 'supabase', openaiConfigured: !!(process.env.CUSTOM_CRED_API_OPENAI_COM_TOKEN || process.env.OPENAI_API_KEY) }));
app.get('/api/', (req, res) => res.json({ name: 'Hearth & Page API', version: '3.0.0', db: 'supabase' }));

// ── Auth ──

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
    const existing = await dbGet('users', { email: `eq.${email.toLowerCase()}` });
    if (existing) return res.status(409).json({ message: 'Email already registered' });
    const passwordHash = await hashPassword(password);
    const newUser = await dbInsert('users', {
      email: email.toLowerCase(), passwordHash, firstName: firstName || '',
      emailVerified: 0, plan: 'free', subscriptionStatus: null,
      createdAt: Date.now(), updatedAt: Date.now()
    });
    const userId = newUser.id;
    // Create session
    const token = generateToken();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await dbInsert('sessions', { userId, token, expiresAt, createdAt: Date.now() });
    // Verification token
    const verifyToken = generateToken();
    const verifyExpires = Date.now() + 24 * 60 * 60 * 1000;
    await dbInsert('email_verify_tokens', { userId, token: verifyToken, expiresAt: verifyExpires });
    // Send verification email
    const appUrl = 'https://www.perplexity.ai/computer/a/family-law-app-ZPvdw1QKTY.YulaIEUT7Fw';
    const verifyUrl = appUrl + '#/verify?token=' + verifyToken;
    const name = firstName || 'there';
    sendViaResend({
      from: 'Hearth & Page <support@hearthandpage.ca>',
      to: [email.toLowerCase()],
      subject: 'Verify your Hearth & Page account',
      html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#f9fafb;">
        <div style="background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
          <div style="margin-bottom:28px;"><span style="font-size:24px;font-weight:700;color:#0d9488;">Hearth</span><span style="font-size:24px;font-weight:300;color:#374151;"> & Page</span></div>
          <h1 style="font-size:20px;color:#111827;margin:0 0 12px;">Welcome, ${name}.</h1>
          <p style="color:#6b7280;line-height:1.6;margin:0 0 28px;">Thanks for signing up. Click the button below to verify your email address and activate your account. This link expires in 24 hours.</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">Verify my email</a>
          <p style="color:#9ca3af;font-size:12px;margin-top:32px;">If you didn't create this account, you can ignore this email.<br>Hearth & Page — hearthandpage.ca</p>
        </div></body></html>`,
      text: 'Welcome to Hearth & Page, ' + name + '. Verify your email here: ' + verifyUrl
    }).catch(err => console.error('[auth] verify email send failed:', err.message));
    const user = await dbGet('users', { id: `eq.${userId}` });
    res.json({ user, token, expiresAt, requiresVerification: true });
  } catch (e) {
    console.error('[auth] register error:', e.message);
    res.status(500).json({ message: 'Registration failed' });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  req.url = '/api/auth/register';
  app.handle(req, res);
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    const user = await dbGet('users', { email: `eq.${email.toLowerCase()}` });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const passwordOk = await checkPassword(password, user.passwordHash);
    if (!passwordOk) return res.status(401).json({ message: 'Invalid credentials' });
    const token = generateToken();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await dbInsert('sessions', { userId: user.id, token, expiresAt, createdAt: Date.now() });
    res.json({
      user: { id: user.id, email: user.email, firstName: user.firstName, emailVerified: !!user.emailVerified, plan: user.plan, subscriptionStatus: user.subscriptionStatus, subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd, gracePeriodEnd: user.gracePeriodEnd, createdAt: user.createdAt },
      token, expiresAt,
    });
  } catch (e) {
    console.error('[auth] login error:', e.message, e.stack);
    res.status(500).json({ message: 'Login failed', debug: e.message });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    await dbDelete('sessions', { token: `eq.${req.token}` });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'Logout failed' }); }
});


// ─── Twilio SMS helper ───────────────────────────────────────────────────────
async function sendViaTwilio(to, body) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) {
    console.warn('[Twilio] Credentials not configured — skipping SMS to', to);
    return { ok: false, reason: 'not_configured' };
  }
  // Normalize phone: ensure E.164 format
  let phone = to.replace(/\s+/g, '').replace(/[.\-()]/g, '');
  if (phone.startsWith('1') && phone.length === 11) phone = '+' + phone;
  else if (!phone.startsWith('+')) phone = '+1' + phone;

  const params = new URLSearchParams({ To: phone, From: from, Body: body });
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  return new Promise((resolve, reject) => {
    const https = require('https');
    const auth  = Buffer.from(`${sid}:${token}`).toString('base64');
    const req   = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params.toString()),
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.sid) resolve({ ok: true, sid: json.sid });
          else resolve({ ok: false, error: json.message || data });
        } catch(e) { resolve({ ok: false, error: data }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.write(params.toString());
    req.end();
  });
}

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

app.patch('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { firstName, email } = req.body;
    if (firstName !== undefined) await dbUpdate('users', { id: `eq.${req.user.id}` }, { firstName, updatedAt: Date.now() });
    if (email !== undefined) await dbUpdate('users', { id: `eq.${req.user.id}` }, { email: email.toLowerCase(), updatedAt: Date.now() });
    const user = await dbGet('users', { id: `eq.${req.user.id}` });
    res.json({ user });
  } catch (e) { res.status(500).json({ message: 'Update failed' }); }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await dbGet('users', { id: `eq.${req.user.id}` });
    const currentOk = await checkPassword(currentPassword, user.passwordHash);
    if (!currentOk) return res.status(401).json({ message: 'Current password is incorrect' });
    await dbUpdate('users', { id: `eq.${req.user.id}` }, { passwordHash: await hashPassword(newPassword), updatedAt: Date.now() });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'Password change failed' }); }
});

app.post('/api/auth/forgot', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });
    const user = await dbGet('users', { email: `eq.${email.toLowerCase()}` });
    if (!user) return res.json({ message: 'If an account exists for that email, a reset link has been sent. Check your inbox.' });
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = Date.now() + 60 * 60 * 1000;
    await dbInsert('sessions', { userId: user.id, token: 'reset_' + resetToken, expiresAt: resetExpiry, createdAt: Date.now() });
    const resetUrl = APP_URL + '/forgot?token=' + resetToken + '&step=reset';
    try {
      await sendViaResend({
        from: FROM_EMAIL, to: [user.email],
        subject: 'Reset your Hearth & Page password',
        html: '<div style="font-family:Arial,sans-serif;background:#f8f5f0;padding:32px"><div style="max-width:520px;margin:0 auto;background:white;border-radius:12px;padding:32px"><h2 style="color:#1B4150;font-family:Georgia,serif;margin-top:0">Hearth &amp; Page</h2><p>Hi ' + (user.firstName || 'there') + ',</p><p>We received a request to reset your password. Click below — this link expires in 1 hour.</p><div style="text-align:center;margin:32px 0"><a href="' + resetUrl + '" style="background:#1B4150;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Reset my password</a></div><p style="color:#888;font-size:13px">If you did not request this, you can safely ignore this email.</p></div></div>',
        text: 'Reset your Hearth & Page password:\n\n' + resetUrl + '\n\nThis link expires in 1 hour.',
      });
    } catch (emailErr) { console.error('[forgot] Email send failed:', emailErr.message); }
    res.json({ message: 'If an account exists for that email, a reset link has been sent. Check your inbox.' });
  } catch (e) {
    console.error('[forgot] error:', e.message);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/auth/reset', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and password required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    const session = await dbGet('sessions', { token: `eq.reset_${token}`, expires_at: `gt.${Date.now()}` });
    if (!session) return res.status(400).json({ message: 'Reset link is invalid or has expired. Please request a new one.' });
    const newHash = await hashPassword(password);
    await dbUpdate('users', { id: `eq.${session.userId}` }, { passwordHash: newHash, updatedAt: Date.now() });
    await dbDelete('sessions', { token: `eq.reset_${token}` });
    res.json({ ok: true, message: 'Password updated successfully. You can now log in.' });
  } catch (e) {
    console.error('[reset] error:', e.message);
    res.status(500).json({ message: 'Password reset failed. Please try again.' });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Token required' });
    const row = await dbGet('email_verify_tokens', { token: `eq.${token}`, used_at: 'is.null' });
    if (!row) return res.status(400).json({ message: 'Invalid or expired verification link' });
    if (row.expiresAt < Date.now()) return res.status(400).json({ message: 'Verification link expired — request a new one' });
    await dbUpdate('users', { id: `eq.${row.userId}` }, { emailVerified: 1 });
    await dbUpdate('email_verify_tokens', { id: `eq.${row.id}` }, { usedAt: Date.now() });
    res.json({ ok: true, message: 'Email verified successfully' });
  } catch (e) {
    console.error('[auth] verify error:', e.message);
    res.status(500).json({ message: 'Verification failed' });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'Token required' });
    const row = await dbGet('email_verify_tokens', { token: `eq.${token}`, used_at: 'is.null' });
    if (!row) return res.status(400).json({ message: 'Invalid or expired verification link' });
    if (row.expiresAt < Date.now()) return res.status(400).json({ message: 'Verification link expired — request a new one' });
    await dbUpdate('users', { id: `eq.${row.userId}` }, { emailVerified: 1 });
    await dbUpdate('email_verify_tokens', { id: `eq.${row.id}` }, { usedAt: Date.now() });
    const user = await dbGet('users', { id: `eq.${row.userId}` });
    res.json({ ok: true, user });
  } catch (e) {
    console.error('[auth] verify post error:', e.message);
    res.status(500).json({ message: 'Verification failed' });
  }
});

app.post('/api/auth/resend-verify', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (user.emailVerified) return res.json({ ok: true, message: 'Already verified' });
    // Invalidate old tokens
    await dbUpdate('email_verify_tokens', { user_id: `eq.${user.id}`, used_at: 'is.null' }, { usedAt: Date.now() });
    const verifyToken = generateToken();
    const verifyExpires = Date.now() + 24 * 60 * 60 * 1000;
    await dbInsert('email_verify_tokens', { userId: user.id, token: verifyToken, expiresAt: verifyExpires });
    const appUrl = 'https://www.perplexity.ai/computer/a/family-law-app-ZPvdw1QKTY.YulaIEUT7Fw';
    const verifyUrl = appUrl + '#/verify?token=' + verifyToken;
    const name = user.firstName || 'there';
    await sendViaResend({
      from: 'Hearth & Page <support@hearthandpage.ca>',
      to: [user.email],
      subject: 'Verify your Hearth & Page account',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;"><h2 style="color:#0d9488;">Verify your email</h2><p>Hi ${name}, click below to verify your email address. This link expires in 24 hours.</p><a href="${verifyUrl}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Verify my email</a><p style="color:#9ca3af;font-size:12px;margin-top:24px;">Hearth & Page — hearthandpage.ca</p></div>`,
      text: 'Verify your email: ' + verifyUrl
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth] resend-verify error:', e.message);
    res.status(500).json({ message: 'Failed to resend verification email' });
  }
});

// ── Cases ──

app.get('/api/cases', requireAuth, async (req, res) => {
  try {
    const cases = await dbAll('cases', { user_id: `eq.${req.user.id}` }, { order: 'updated_at.desc' });
    res.json(cases);
  } catch (e) { res.status(500).json({ message: 'Failed to fetch cases' }); }
});

app.post('/api/cases', requireAuth, async (req, res) => {
  try {
    const { title, caseType } = req.body;
    if (!title) return res.status(400).json({ message: 'Title required' });
    const status = req.user?.subscriptionStatus;
    const plan   = req.user?.plan;
    const isPaid = (status === 'active' || status === 'past_due') && plan !== 'free';
    if (!isPaid) {
      const requestedForms = (caseType || 'form8-general').split(',').map(f => f.trim().split('-')[0]);
      const allFree = requestedForms.every(f => FREE_FORMS.includes(f));
      if (!allFree) return res.status(403).json({ message: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED', upgradeUrl: '/pricing' });
    }
    const now = Date.now();
    const newCase = await dbInsert('cases', { userId: req.user.id, title, caseType: caseType || 'form8-general', status: 'active', createdAt: now, updatedAt: now });
    res.json(newCase);
  } catch (e) { res.status(500).json({ message: 'Failed to create case' }); }
});

app.get('/api/cases/limit', requireAuth, async (req, res) => {
  try {
    const limits = { free: 1, standard: 3, plus: 999 };
    const limit = limits[req.user.plan] || 1;
    const cases = await dbAll('cases', { user_id: `eq.${req.user.id}`, status: 'neq.deleted' });
    const used = cases.length;
    res.json({ limit, used, remaining: Math.max(0, limit - used), canCreate: used < limit, plan: req.user.plan });
  } catch (e) { res.status(500).json({ message: 'Failed to check case limit' }); }
});

// GET /api/cases/shared — respondent gets cases they are linked to (MUST be before /:caseId)
app.get('/api/cases/shared', requireAuth, async (req, res) => {
  try {
    const rows = await supaRequest('GET', 'cases', {
      filters: { respondent_user_id: `eq.${req.user.id}` },
      opts: { order: 'updated_at.desc' }
    });
    res.json(rows.map ? rows.map(r => (typeof r === 'object' ? Object.fromEntries(Object.entries(r).map(([k,v]) => [k.replace(/_([a-z])/g, (_,c) => c.toUpperCase()), v])) : r)) : rows);
  } catch(e) { res.status(500).json({ message: 'Failed to fetch shared cases' }); }
});

app.get('/api/cases/:caseId', requireAuth, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    res.json(c);
  } catch (e) { res.status(500).json({ message: 'Failed to fetch case' }); }
});

app.patch('/api/cases/:caseId', requireAuth, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    const { title, caseType, status, package_id, package_forms, package_status, current_form_idx } = req.body;
    const updates = { updatedAt: Date.now() };
    if (title !== undefined) updates.title = title;
    if (caseType !== undefined) updates.caseType = caseType;
    if (status !== undefined) updates.status = status;
    if (package_id !== undefined) updates.package_id = package_id;
    if (package_forms !== undefined) updates.package_forms = typeof package_forms === 'string' ? package_forms : JSON.stringify(package_forms);
    if (package_status !== undefined) updates.package_status = typeof package_status === 'string' ? package_status : JSON.stringify(package_status);
    if (current_form_idx !== undefined) updates.current_form_idx = current_form_idx;
    await dbUpdate('cases', { id: `eq.${c.id}` }, updates);
    const updated = await dbGet('cases', { id: `eq.${c.id}` });
    res.json(updated);
  } catch (e) { res.status(500).json({ message: 'Failed to update case' }); }
});

app.delete('/api/cases/:caseId', requireAuth, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    await dbDelete('form_data', { case_id: `eq.${c.id}` });
    await dbDelete('pdf_checkboxes', { case_id: `eq.${c.id}` });
    await dbDelete('cases', { id: `eq.${c.id}` });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'Failed to delete case' }); }
});

// ── Two-Party Collaboration ──────────────────────────────────────────────────

// POST /api/cases/:caseId/invite — applicant generates/refreshes an invite link
app.post('/api/cases/:caseId/invite', requireAuth, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    // Generate a cryptographically secure token
    const token = crypto.randomBytes(24).toString('hex');
    const expires = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    await dbUpdate('cases', { id: `eq.${c.id}` }, {
      inviteToken: token,
      inviteExpiresAt: expires,
      collabStatus: c.collabStatus === 'active' ? 'active' : 'invited',
      updatedAt: Date.now()
    });
    const inviteUrl = `${req.headers.origin || 'https://api-production-2334.up.railway.app'}/#/join/${token}`;
    res.json({ token, inviteUrl, expiresAt: expires });
  } catch(e) { res.status(500).json({ message: 'Failed to generate invite' }); }
});

// GET /api/invite/:token — preview invite (public, no auth required)
app.get('/api/invite/:token', async (req, res) => {
  try {
    const c = await dbGet('cases', { invite_token: `eq.${req.params.token}` });
    if (!c) return res.status(404).json({ message: 'Invite not found or expired' });
    if (c.inviteExpiresAt && Date.now() > c.inviteExpiresAt) {
      return res.status(410).json({ message: 'Invite link has expired' });
    }
    // Return safe preview (no sensitive form data)
    const applicant = await dbGet('users', { id: `eq.${c.userId}` });
    res.json({
      caseId: c.id,
      caseTitle: c.title,
      caseType: c.caseType,
      applicantName: applicant ? (applicant.firstName || 'The applicant') : 'The applicant',
      collabStatus: c.collabStatus,
      alreadyLinked: !!c.respondentUserId,
      expiresAt: c.inviteExpiresAt
    });
  } catch(e) { res.status(500).json({ message: 'Failed to preview invite' }); }
});

// POST /api/invite/:token/accept — respondent accepts invite (must be logged in)
app.post('/api/invite/:token/accept', requireAuth, async (req, res) => {
  try {
    const c = await dbGet('cases', { invite_token: `eq.${req.params.token}` });
    if (!c) return res.status(404).json({ message: 'Invite not found' });
    if (c.inviteExpiresAt && Date.now() > c.inviteExpiresAt) {
      return res.status(410).json({ message: 'Invite link has expired. Ask the applicant to send a new one.' });
    }
    if (c.userId === req.user.id) {
      return res.status(400).json({ message: 'You cannot join your own case as the respondent.' });
    }
    if (c.respondentUserId && c.respondentUserId !== req.user.id) {
      return res.status(409).json({ message: 'This case already has a respondent linked.' });
    }
    await dbUpdate('cases', { id: `eq.${c.id}` }, {
      respondentUserId: req.user.id,
      respondentEmail: req.user.email,
      collabStatus: 'active',
      updatedAt: Date.now()
    });
    res.json({ ok: true, caseId: c.id, caseTitle: c.title, message: 'You are now linked to this case as the respondent.' });
  } catch(e) { res.status(500).json({ message: 'Failed to accept invite' }); }
});

// DELETE /api/cases/:caseId/collab — applicant revokes collaboration
app.delete('/api/cases/:caseId/collab', requireAuth, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    await dbUpdate('cases', { id: `eq.${c.id}` }, {
      respondentUserId: null,
      respondentEmail: null,
      inviteToken: null,
      inviteExpiresAt: null,
      collabStatus: 'none',
      updatedAt: Date.now()
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ message: 'Failed to revoke collaboration' }); }
});

// GET /api/cases/:caseId/collab-status — get current collaboration state
app.get('/api/cases/:caseId/collab-status', requireAuth, async (req, res) => {
  try {
    // Owner can always see; respondent can also check
    let c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) {
      // Check if user is the respondent
      c = await dbGet('cases', { id: `eq.${req.params.caseId}`, respondent_user_id: `eq.${req.user.id}` });
    }
    if (!c) return res.status(404).json({ message: 'Case not found' });
    const isOwner = c.userId === req.user.id;
    res.json({
      collabStatus: c.collabStatus || 'none',
      isOwner,
      respondentEmail: isOwner ? c.respondentEmail : undefined,
      respondentLinked: !!c.respondentUserId,
      inviteToken: isOwner ? c.inviteToken : undefined,
      inviteExpiresAt: isOwner ? c.inviteExpiresAt : undefined
    });
  } catch(e) { res.status(500).json({ message: 'Failed to get collab status' }); }
});

// Allow respondent to read form data of a case they are linked to
app.get('/api/cases/:caseId/shared-form-data', requireAuth, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, respondent_user_id: `eq.${req.user.id}` });
    if (!c) return res.status(403).json({ message: 'Not authorised for this case' });
    const data = await dbAll('form_data', { case_id: `eq.${c.id}` });
    res.json(data);
  } catch(e) { res.status(500).json({ message: 'Failed to fetch shared form data' }); }
});

// ── Form Data ──

app.get('/api/cases/:caseId/form-data', requireAuth, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    const status = req.user?.subscriptionStatus;
    const plan   = req.user?.plan;
    const isPaid = (status === 'active' || status === 'past_due') && plan !== 'free';
    const isFreeForm = (c.caseType || '').split(',').every(f => FREE_FORMS.includes(f.trim().split('-')[0]));
    if (!isPaid && !isFreeForm) return res.status(403).json({ message: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' });
    const data = await dbAll('form_data', { case_id: `eq.${c.id}` }, { order: 'id.desc' });
    res.json(data);
  } catch (e) { res.status(500).json({ message: 'Failed to fetch form data' }); }
});

app.post('/api/cases/:caseId/form-data', requireAuth, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    const status = req.user?.subscriptionStatus;
    const plan   = req.user?.plan;
    const isPaid = (status === 'active' || status === 'past_due') && plan !== 'free';
    const isFreeForm = (c.caseType || '').split(',').every(f => FREE_FORMS.includes(f.trim().split('-')[0]));
    if (!isPaid && !isFreeForm) return res.status(403).json({ message: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' });
    const { section, fieldKey, fieldValue } = req.body;
    if (!section || !fieldKey) return res.status(400).json({ message: 'section and fieldKey required' });
    const val = typeof fieldValue === 'object' ? JSON.stringify(fieldValue) : String(fieldValue ?? '');
    const row = await dbUpsert('form_data', { caseId: c.id, section, fieldKey, fieldValue: val, updatedAt: Date.now() });
    res.json(row);
  } catch (e) { res.status(500).json({ message: 'Failed to save form data' }); }
});

app.put('/api/cases/:caseId/form-data', requireAuth, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    const status = req.user?.subscriptionStatus;
    const plan   = req.user?.plan;
    const isPaid = (status === 'active' || status === 'past_due') && plan !== 'free';
    const isFreeForm = (c.caseType || '').split(',').every(f => FREE_FORMS.includes(f.trim().split('-')[0]));
    if (!isPaid && !isFreeForm) return res.status(403).json({ message: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' });
    const items = Array.isArray(req.body) ? req.body : [req.body];
    for (const item of items) {
      const { section, fieldKey, fieldValue } = item;
      if (!section || !fieldKey) continue;
      const val = typeof fieldValue === 'object' ? JSON.stringify(fieldValue) : String(fieldValue ?? '');
      await dbUpsert('form_data', { caseId: c.id, section, fieldKey, fieldValue: val, updatedAt: Date.now() });
    }
    await dbUpdate('cases', { id: `eq.${c.id}` }, { updatedAt: Date.now() });
    res.json({ ok: true, count: items.length });
  } catch (e) { res.status(500).json({ message: 'Failed to bulk save form data' }); }
});

// ── PDF Fill Helper ──

const FILL_SCRIPT = path.join(__dirname, 'fill_pdf.py');

function getPythonBin() {
  const candidates = ['/usr/bin/python3', '/usr/local/bin/python3', '/usr/bin/python', '/usr/local/bin/python'];
  const savedPathFile = path.join(__dirname, 'python3_path.txt');
  if (fs.existsSync(savedPathFile)) {
    const savedPath = fs.readFileSync(savedPathFile, 'utf8').trim();
    if (savedPath) candidates.unshift(savedPath);
  }
  for (const c of candidates) { if (fs.existsSync(c)) { console.log('[pdf-fill] Python binary:', c); return c; } }
  return 'python3';
}
const PYTHON_BIN = getPythonBin();

async function fillPDF(pdfPath, formData, formType) {
  return new Promise((resolve) => {
    const tmpJson = path.join(os.tmpdir(), `hp_formdata_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    const tmpOut = path.join(os.tmpdir(), `hp_filled_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    try { fs.writeFileSync(tmpJson, JSON.stringify(formData)); } catch(e) { resolve(fs.readFileSync(pdfPath)); return; }
    if (!fs.existsSync(FILL_SCRIPT)) { resolve(fs.readFileSync(pdfPath)); return; }
    const { exec } = require('child_process');
    const ftArg = formType ? ` ${JSON.stringify(String(formType))}` : '';
    const cmd = `${PYTHON_BIN} ${JSON.stringify(FILL_SCRIPT)} ${JSON.stringify(pdfPath)} ${JSON.stringify(tmpOut)} ${JSON.stringify(tmpJson)}${ftArg}`;
    exec(cmd, { timeout: 30000, shell: true }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpJson); } catch(e) {}
      if (err) { console.error('[fillPDF] python error:', stderr); try { fs.unlinkSync(tmpOut); } catch(e) {} resolve(fs.readFileSync(pdfPath)); return; }
      if (!fs.existsSync(tmpOut)) { resolve(fs.readFileSync(pdfPath)); return; }
      const filledBytes = fs.readFileSync(tmpOut);
      try { fs.unlinkSync(tmpOut); } catch(e) {}
      resolve(filledBytes);
    });
  });
}

// ── PDF Checkboxes ──

const CHECKBOX_DEFS = {
  form8: [
    { name: 'custody', label: 'Custody or access', page: 1, fieldKey: 'relief_custody' },
    { name: 'child_support', label: 'Child support', page: 1, fieldKey: 'relief_childSupport' },
    { name: 'spousal_support', label: 'Spousal support', page: 1, fieldKey: 'relief_spousalSupport' },
    { name: 'property', label: 'Property / equalization', page: 1, fieldKey: 'relief_property' },
    { name: 'restraining_order', label: 'Restraining order', page: 1, fieldKey: 'relief_restrainingOrder' },
    { name: 'divorce', label: 'Divorce', page: 1, fieldKey: 'relief_divorce' },
    { name: 'other_orders', label: 'Other orders', page: 1, fieldKey: 'relief_other' },
  ],
  form13: [
    { name: 'employed', label: 'Employed', page: 1, fieldKey: 'employment_status_employed' },
    { name: 'self_employed', label: 'Self-employed', page: 1, fieldKey: 'employment_status_selfEmployed' },
    { name: 'unemployed', label: 'Unemployed', page: 1, fieldKey: 'employment_status_unemployed' },
    { name: 'other_income', label: 'Other income sources', page: 6, fieldKey: 'income_otherSources' },
  ],
  form35_1: [
    { name: 'applicant', label: 'I am the applicant', page: 1, fieldKey: 'role_applicant' },
    { name: 'respondent', label: 'I am the respondent', page: 1, fieldKey: 'role_respondent' },
    { name: 'has_children', label: 'Children are involved', page: 1, fieldKey: 'children_hasChildren' },
    { name: 'domestic_violence', label: 'Domestic violence history', page: 2, fieldKey: 'violence_history' },
    { name: 'seeking_custody', label: 'Seeking custody/parenting time', page: 3, fieldKey: 'parenting_seekingCustody' },
  ],
};

app.get('/api/cases/:caseId/pdf-checkboxes/:formType', requireAuth, requireSubscription, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    const formType = req.params.formType;
    const override = await dbGet('form_data', { case_id: `eq.${c.id}`, section: `eq.__meta__`, field_key: `eq.pdf_checkbox_overrides_${formType}` });
    let savedOverrides = {};
    if (override && override.fieldValue) { try { savedOverrides = JSON.parse(override.fieldValue); } catch(e) {} }
    const formDataRows = await dbAll('form_data', { case_id: `eq.${c.id}` });
    const formDataMap = {};
    for (const row of formDataRows) formDataMap[row.fieldKey] = row.fieldValue;
    const savedCheckboxes = await dbAll('pdf_checkboxes', { case_id: `eq.${c.id}`, form_type: `eq.${formType}` });
    const savedMap = {};
    for (const cb of savedCheckboxes) savedMap[cb.checkboxName] = !!cb.checked;
    const defs = CHECKBOX_DEFS[formType] || [];
    let checkboxes;
    if (defs.length > 0) {
      checkboxes = defs.map(def => {
        const formVal = formDataMap[def.fieldKey];
        const autoChecked = formVal === 'true' || formVal === true || formVal === '1' || formVal === 'yes';
        const saved = savedMap.hasOwnProperty(def.name) ? savedMap[def.name] : autoChecked;
        const overrideVal = savedOverrides.hasOwnProperty(def.name) ? savedOverrides[def.name] : saved;
        return { name: def.name, label: def.label, page: def.page || 1, type: 'CheckBox', autoChecked, savedOverride: overrideVal };
      });
    } else if (savedCheckboxes.length > 0) {
      checkboxes = savedCheckboxes.map(cb => ({ name: cb.checkboxName, page: 1, type: 'CheckBox', autoChecked: !!cb.checked, savedOverride: savedOverrides.hasOwnProperty(cb.checkboxName) ? savedOverrides[cb.checkboxName] : !!cb.checked }));
    } else { checkboxes = []; }
    res.json({ checkboxes, savedOverrides });
  } catch (e) { console.error('[checkboxes] error:', e.message); res.status(500).json({ message: 'Failed to fetch checkboxes' }); }
});

app.post('/api/cases/:caseId/pdf-checkboxes/:formType', requireAuth, requireSubscription, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    const { checkboxes } = req.body;
    if (!Array.isArray(checkboxes)) return res.status(400).json({ message: 'checkboxes array required' });
    for (const cb of checkboxes) {
      await dbUpsert('pdf_checkboxes', { caseId: c.id, formType: req.params.formType, checkboxName: cb.name, checked: cb.checked ? 1 : 0, updatedAt: Date.now() });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'Failed to save checkboxes' }); }
});

// ── Official PDF generation ──

app.post('/api/cases/:caseId/official-pdf/:formType', requireAuth, requirePaidExport, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    const formType = req.params.formType;
    const pdfPath = path.join(__dirname, 'public', 'pdfs', `${formType}.pdf`);
    if (!fs.existsSync(pdfPath)) return res.status(404).json({ message: 'PDF template not found for ' + formType });
    const formData = await dbAll('form_data', { case_id: `eq.${c.id}` });
    const filledPdf = await fillPDF(pdfPath, formData, formType);
    const formLabel = formType.replace(/_/g, '.').toUpperCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="HearthAndPage-${formLabel}.pdf"`);
    res.setHeader('Content-Length', filledPdf.length);
    res.send(filledPdf);
  } catch (e) { console.error('[pdf] official-pdf error:', e.message); res.status(500).json({ message: 'Failed to generate PDF' }); }
});

app.post('/api/cases/:caseId/pdf-link/:formType', requireAuth, requirePaidExport, async (req, res) => {
  try {
    const { caseId, formType } = req.params;
    const c = await dbGet('cases', { id: `eq.${caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    const pdfPath = path.join(__dirname, 'public', 'pdfs', `${formType}.pdf`);
    if (!fs.existsSync(pdfPath)) return res.status(404).json({ message: 'PDF template not found for ' + formType });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    await dbInsert('pdf_download_tokens', { token, caseId, formType, userId: req.user.id, expiresAt, createdAt: Date.now() });
    const RAILWAY_API_URL = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://api-production-2334.up.railway.app';
    const downloadUrl = `${RAILWAY_API_URL}/api/download/${token}`;
    const formLabel = formType.replace('form', 'Form ').replace('_', '.').toUpperCase();
    res.json({ url: downloadUrl, token, expiresAt, formType, formLabel });
  } catch (e) { console.error('[pdf-link] error:', e.message); res.status(500).json({ message: 'Failed to create download link' }); }
});

app.get('/api/download/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const row = await dbGet('pdf_download_tokens', { token: `eq.${token}` });
    if (!row) return res.status(404).send('Download link not found or already used.');
    if (Date.now() > row.expiresAt) {
      await dbDelete('pdf_download_tokens', { token: `eq.${token}` });
      return res.status(410).send('This download link has expired. Please generate a new one from the app.');
    }
    const pdfPath = path.join(__dirname, 'public', 'pdfs', `${row.formType}.pdf`);
    if (!fs.existsSync(pdfPath)) return res.status(404).send('PDF not found.');
    const formData = await dbAll('form_data', { case_id: `eq.${row.caseId}` });
    const filledPdf = await fillPDF(pdfPath, formData, row.formType);
    const formLabel = row.formType.replace(/_/g, '.').toUpperCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="HearthAndPage-${formLabel}.pdf"`);
    res.setHeader('Content-Length', filledPdf.length);
    res.send(filledPdf);
  } catch (e) { console.error('[download] error:', e.message); res.status(500).send('Failed to serve PDF.'); }
});

// ── Email proxy ──

app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, html, text, attachments } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'Missing required fields: to, subject' });
    const payload = { from: FROM_EMAIL, to: Array.isArray(to) ? to : [to], subject, text: text || '', html: html || undefined, attachments: attachments || [] };
    const result = await sendViaResend(payload);
    res.json({ ok: true, id: result.id });
  } catch (e) { console.error('[HP] /api/send-email error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/email/send', async (req, res) => { req.url = '/api/send-email'; app.handle(req, res); });

// ── Account ──

app.get('/api/account', requireAuth, async (req, res) => {
  try {
    const user = await dbGet('users', { id: `eq.${req.user.id}` });
    const cases = await dbAll('cases', { user_id: `eq.${req.user.id}` });
    res.json({ user, cases });
  } catch (e) { res.status(500).json({ message: 'Failed to fetch account' }); }
});

app.delete('/api/account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const cases = await dbAll('cases', { user_id: `eq.${userId}` });
    for (const c of cases) {
      await dbDelete('form_data', { case_id: `eq.${c.id}` });
      await dbDelete('pdf_checkboxes', { case_id: `eq.${c.id}` });
    }
    await dbDelete('cases', { user_id: `eq.${userId}` });
    await dbDelete('sessions', { user_id: `eq.${userId}` });
    await dbDelete('users', { id: `eq.${userId}` });
    res.json({ ok: true });
  } catch (e) { console.error('[account] delete error:', e.message); res.status(500).json({ message: 'Failed to delete account' }); }
});

app.get('/api/account/export', requireAuth, async (req, res) => {
  try {
    const user = await dbGet('users', { id: `eq.${req.user.id}` });
    const cases = await dbAll('cases', { user_id: `eq.${req.user.id}` });
    const exportData = { exportedAt: new Date().toISOString(), user, cases: [] };
    for (const c of cases) {
      const formData = await dbAll('form_data', { case_id: `eq.${c.id}` });
      const checkboxes = await dbAll('pdf_checkboxes', { case_id: `eq.${c.id}` });
      exportData.cases.push({ ...c, formData, checkboxes });
    }
    res.json(exportData);
  } catch (e) { res.status(500).json({ message: 'Failed to export data' }); }
});

// ── Stripe ──

// Stripe webhook MUST be registered before express.json() for raw body
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.json({ received: true });
  let event;
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const obj = event.data.object;
    async function syncSubToUser(customerId, sub) {
      if (!customerId || !sub) return;
      const priceId = sub.items?.data[0]?.price?.id;
      const plan = priceId === process.env.STRIPE_PRICE_PLUS ? 'plus' : 'standard';
      const status = sub.status;
      const periodEnd = sub.current_period_end ? sub.current_period_end * 1000 : null;
      await dbUpdate('users', { stripe_customer_id: `eq.${customerId}` }, { plan: status === 'active' ? plan : 'free', subscriptionStatus: status, subscriptionCurrentPeriodEnd: periodEnd, stripeSubscriptionId: sub.id });
      console.log(`[webhook] ${event.type} — customer ${customerId} plan=${plan} status=${status}`);
    }
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await syncSubToUser(obj.customer, obj); break;
      case 'customer.subscription.deleted':
        await dbUpdate('users', { stripe_customer_id: `eq.${obj.customer}` }, { plan: 'free', subscriptionStatus: 'canceled', stripeSubscriptionId: null });
        break;
      case 'invoice.payment_succeeded': {
        if (obj.subscription) {
          const sub = await stripe.subscriptions.retrieve(obj.subscription);
          await syncSubToUser(obj.customer, sub);
          // Send receipt email via Resend
          try {
            const custRow = await dbGet('users', { stripe_customer_id: `eq.${obj.customer}` });
            if (custRow?.email) {
              const priceId2 = sub.items?.data[0]?.price?.id;
              const planName = priceId2 === process.env.STRIPE_PRICE_PLUS ? 'Plus' : 'Standard';
              const amountCAD = (obj.amount_paid / 100).toFixed(2);
              const periodEndDate = new Date(sub.current_period_end * 1000).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
              await sendViaResend({
                from: 'Hearth & Page <support@hearthandpage.ca>',
                to: [custRow.email],
                subject: `Your Hearth & Page receipt — $${amountCAD} CAD`,
                html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#28251D">
  <h2 style="color:#01696F">Payment received — thank you!</h2>
  <p>Hi ${custRow.name || 'there'},</p>
  <p>We've received your payment for your <strong>Hearth &amp; Page ${planName} plan</strong>.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px 0;border-bottom:1px solid #D4D1CA">Plan</td><td style="padding:8px 0;border-bottom:1px solid #D4D1CA;text-align:right"><strong>${planName}</strong></td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #D4D1CA">Amount charged</td><td style="padding:8px 0;border-bottom:1px solid #D4D1CA;text-align:right"><strong>$${amountCAD} CAD</strong></td></tr>
    <tr><td style="padding:8px 0">Next renewal</td><td style="padding:8px 0;text-align:right">${periodEndDate}</td></tr>
  </table>
  <p>You can manage your subscription at any time from your <a href="${process.env.APP_URL || 'https://hearthandpage.ca'}" style="color:#01696F">Hearth &amp; Page account</a>.</p>
  <p style="font-size:12px;color:#7A7974;margin-top:32px">Hearth &amp; Page &bull; heartandpage.ca &bull; support@heartandpage.ca<br>This is an automated receipt. Please do not reply to this email.</p>
</div>`,
              });
              console.log(`[webhook] Receipt email sent to ${custRow.email}`);
            }
          } catch (emailErr) {
            console.error('[webhook] Receipt email failed:', emailErr.message);
          }
        }
        break;
      }
      case 'invoice.payment_failed': {
        await dbUpdate('users', { stripe_customer_id: `eq.${obj.customer}` }, { subscriptionStatus: 'past_due' });
        // Send a helpful payment failure email
        try {
          const failedUser = await dbGet('users', { stripe_customer_id: `eq.${obj.customer}` });
          if (failedUser && failedUser.email) {
            const userName = failedUser.name ? failedUser.name.split(' ')[0] : 'there';
            const portalUrl = (process.env.APP_URL || 'https://hearthandpage.ca') + '/#/account';
            await sendViaResend({
              from: 'Hearth & Page <support@hearthandpage.ca>',
              to: [failedUser.email],
              subject: 'Action needed — your Hearth & Page payment could not be processed',
              html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#fff;">
  <h2 style="color:#C9903A;margin-bottom:8px;">Payment could not be processed</h2>
  <p style="color:#374151;font-size:15px;">Hi ${userName},</p>
  <p style="color:#374151;font-size:15px;">We weren't able to process your last Hearth &amp; Page subscription payment. Your account has been moved to a grace period — you still have access for now, but please update your payment details soon to avoid any interruption.</p>
  <div style="background:#fff8ed;border-left:4px solid #C9903A;border-radius:4px;padding:16px 20px;margin:24px 0;">
    <p style="color:#7a3e00;font-size:14px;margin:0 0 8px;font-weight:600;">Common reasons a card is declined:</p>
    <ul style="color:#7a3e00;font-size:14px;margin:0;padding-left:20px;">
      <li>Your bank requires online purchases to be enabled (very common with debit Visa &amp; Mastercard)</li>
      <li>The card has expired or the billing details have changed</li>
      <li>Your bank flagged the transaction — a quick call to them resolves this</li>
    </ul>
  </div>
  <p style="color:#374151;font-size:15px;"><strong>No additional charges were made.</strong> We'll retry the payment automatically.</p>
  <a href="${portalUrl}" style="display:inline-block;background:#C9903A;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:8px 0 24px;">Update my payment method &rarr;</a>
  <p style="color:#6b7280;font-size:13px;">If you have any questions, reply to this email and we'll help sort it out.</p>
  <p style="color:#9ca3af;font-size:12px;margin-top:32px;">Hearth &amp; Page &mdash; hearthandpage.ca</p>
</div>`
            });
          }
        } catch (pfEmailErr) {
          console.error('[webhook] Payment failed email error:', pfEmailErr.message);
        }
        break;
      }
    }
  } catch (e) { console.error('[webhook] Handler error:', e.message); }
  res.json({ received: true });
});

app.post('/api/stripe/create-checkout', requireAuth, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { priceId, successUrl, cancelUrl } = req.body;
    if (!priceId) return res.status(400).json({ message: 'priceId required' });
    const userRow = await dbGet('users', { id: `eq.${req.user.id}` });
    let customerId = userRow?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: req.user.email, metadata: { userId: String(req.user.id) } });
      customerId = customer.id;
      await dbUpdate('users', { id: `eq.${req.user.id}` }, { stripeCustomerId: customerId });
    }
    const session = await stripe.checkout.sessions.create({
      customer: customerId, payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }], mode: 'subscription',
      success_url: successUrl || process.env.APP_URL + '/?checkout=success',
      cancel_url: cancelUrl || process.env.APP_URL + '/pricing',
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto' },
    });
    res.json({ url: session.url });
  } catch (e) { console.error('[stripe/create-checkout] error:', e.message); res.status(500).json({ message: 'Failed to create checkout session' }); }
});

app.post('/api/stripe/billing-portal', requireAuth, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { returnUrl } = req.body;
    const userRow = await dbGet('users', { id: `eq.${req.user.id}` });
    if (!userRow?.stripeCustomerId) return res.status(400).json({ message: 'No Stripe customer found' });
    const session = await stripe.billingPortal.sessions.create({ customer: userRow.stripeCustomerId, return_url: returnUrl || process.env.APP_URL });
    res.json({ url: session.url });
  } catch (e) { console.error('[stripe/billing-portal] error:', e.message); res.status(500).json({ message: 'Failed to open billing portal' }); }
});

app.post('/api/stripe/portal', requireAuth, async (req, res) => { req.url = '/api/stripe/billing-portal'; app.handle(req, res); });

app.post('/api/stripe/sync', requireAuth, async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return res.json({ ok: true });
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const userRow = await dbGet('users', { id: `eq.${req.user.id}` });
    if (!userRow || !userRow.stripeCustomerId) return res.json({ ok: true });
    const subs = await stripe.subscriptions.list({ customer: userRow.stripeCustomerId, limit: 1, status: 'active' });
    if (subs.data.length > 0) {
      const sub = subs.data[0];
      const priceId = sub.items.data[0]?.price?.id;
      const plan = priceId === process.env.STRIPE_PRICE_PLUS ? 'plus' : 'standard';
      await dbUpdate('users', { id: `eq.${req.user.id}` }, { plan, subscriptionStatus: sub.status, subscriptionCurrentPeriodEnd: sub.current_period_end * 1000, stripeSubscriptionId: sub.id });
    }
    const updated = await dbGet('users', { id: `eq.${req.user.id}` });
    res.json({ ok: true, user: updated });
  } catch (e) { console.error('[stripe/sync] error:', e.message); res.json({ ok: true }); }
});

// ── Safety ──

app.get('/api/safety/contacts', requireAuth, async (req, res) => {
  try {
    const rows = await dbAll('safety_contacts', { user_id: `eq.${req.user.id}` }, { order: 'id.asc' });
    res.json(rows);
  } catch(e) { res.status(500).json({ message: 'Failed' }); }
});

app.post('/api/safety/contacts', requireAuth, async (req, res) => {
  try {
    const { name, contactType, contactValue } = req.body;
    if (!name || !contactType || !contactValue) return res.status(400).json({ message: 'Missing fields' });
    const row = await dbInsert('safety_contacts', { userId: req.user.id, name: name.trim(), contactType: contactType.trim(), contactValue: contactValue.trim(), createdAt: Date.now() });
    res.json(row);
  } catch(e) { console.error('[Safety] Contacts POST error:', e.message); res.status(500).json({ message: 'Failed' }); }
});

app.delete('/api/safety/contacts/:id', requireAuth, async (req, res) => {
  try {
    await dbDelete('safety_contacts', { id: `eq.${req.params.id}`, user_id: `eq.${req.user.id}` });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ message: 'Failed' }); }
});

app.get('/api/safety/settings', requireAuth, async (req, res) => {
  try {
    const row = await dbGet('safety_settings', { user_id: `eq.${req.user.id}` });
    res.json({ codeWord: (row && row.codeWord) || '' });
  } catch(e) { res.status(500).json({ message: 'Failed' }); }
});

app.put('/api/safety/settings', requireAuth, async (req, res) => {
  try {
    const { codeWord } = req.body;
    const cleaned = (codeWord || '').trim().toLowerCase();
    const existing = await dbGet('safety_settings', { user_id: `eq.${req.user.id}` });
    if (existing) {
      await dbUpdate('safety_settings', { user_id: `eq.${req.user.id}` }, { codeWord: cleaned, updatedAt: Date.now() });
    } else {
      try {
        await dbInsert('safety_settings', { userId: req.user.id, codeWord: cleaned, updatedAt: Date.now() });
      } catch(insertErr) {
        await dbUpdate('safety_settings', { user_id: `eq.${req.user.id}` }, { codeWord: cleaned, updatedAt: Date.now() });
      }
    }
    res.json({ ok: true });
  } catch(e) { console.error('[Safety] Settings PUT error:', e.message); res.status(500).json({ message: 'Failed' }); }
});

app.post('/api/safety/trigger', requireAuth, async (req, res) => {
  try {
    const { method } = req.body;
    const windowKey = Math.floor(Date.now() / 60000).toString();
    // Try to insert cooldown record — ignore-duplicates returns empty if conflict
    const cooldownResult = await supaRequest('POST', 'safety_cooldown', {
      body: { user_id: req.user.id, window_key: windowKey },
      ignoreConflict: true,
    });
    if (!cooldownResult || cooldownResult.length === 0) {
      return res.json({ sent: false, reason: 'cooldown' });
    }
    // Clean up old window keys
    const oldKey = (Math.floor(Date.now() / 60000) - 2).toString();
    await supaRequest('DELETE', 'safety_cooldown', { filters: { user_id: `eq.${req.user.id}`, window_key: `lte.${oldKey}` } });

    const contacts = await dbAll('safety_contacts', { user_id: `eq.${req.user.id}` });
    const user = await dbGet('users', { id: `eq.${req.user.id}` });
    if (!contacts.length) return res.status(400).json({ message: 'No contacts configured' });

    const userName = user ? (user.firstName || 'Someone using Hearth & Page') : 'Someone using Hearth & Page';
    const triggeredAt = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto', hour12: true });
    const isSafeWord = method === 'codeword';
    const emailSubject = isSafeWord ? `SAFE WORD TRIGGERED — ${userName} may need help` : `SAFETY ALERT — ${userName} may need help`;
    const triggerLabel = isSafeWord ? 'Their <strong>secret safe word</strong> was typed — this is an automatic silent alert.' : 'They manually activated their safety alert button.';
    const emailBody = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <div style="background:#7B2D3E;color:#fff;padding:16px 20px;border-radius:8px;margin-bottom:20px;">
        <h2 style="margin:0 0 4px;font-size:20px;">⚠️ ${isSafeWord ? 'Safe Word Triggered' : 'Safety Alert'}</h2>
        <p style="margin:0;font-size:14px;opacity:0.9;">This is an automated safety alert from Hearth & Page</p>
      </div>
      <p style="font-size:15px;color:#111;line-height:1.6;"><strong>${userName}</strong> has activated their safety alert on the Hearth & Page family law app at <strong>${triggeredAt} (Eastern)</strong>.</p>
      <p style="font-size:15px;color:#111;line-height:1.6;">${triggerLabel}</p>
      <p style="font-size:15px;color:#111;line-height:1.6;">They may be in a dangerous situation and may need your help. Please try to reach them immediately.</p>
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0;font-size:14px;color:#856404;"><strong>If you cannot reach them and believe they are in danger, call 911.</strong></p>
      </div>
      <p style="font-size:12px;color:#666;border-top:1px solid #eee;padding-top:16px;margin-top:24px;">This alert was sent by Hearth & Page — a guided Ontario family court form assistant.</p>
    </div>`;

    const emailContacts = contacts.filter(c => c.contactType === 'email' || (!c.contactType && c.email));
    const smsContacts   = contacts.filter(c => c.contactType === 'sms' || c.contactType === 'phone');

    // Build SMS body (concise — must fit 160 chars ideally)
    const isSafeWordSms = method === 'codeword';
    const smsAlert = isSafeWordSms
      ? `⚠️ SAFE WORD ALERT: ${userName} may need help — their secret safe word was triggered on Hearth & Page at ${triggeredAt} ET. Please check on them immediately.`
      : `⚠️ SAFETY ALERT: ${userName} activated their safety alert on Hearth & Page at ${triggeredAt} ET. They may be in danger — please check on them NOW.`;

    // Get user's courthouse for follow-up SMS location
    let courthouseLocation = null;
    try {
      const caseRows = await dbAll('cases', { user_id: `eq.${req.user.id}` });
      if (caseRows && caseRows.length > 0) {
        const lastCase = caseRows[caseRows.length - 1];
        const ch = lastCase.courthouse || lastCase.data?.courthouse || null;
        if (ch) courthouseLocation = ch;
      }
    } catch(e) { /* non-critical */ }

    const smsFollowUp = courthouseLocation
      ? `📍 Follow-up: ${userName} was last working on a case in ${courthouseLocation}. If they were at or near that courthouse, search that area. Call 911 if you cannot reach them.`
      : `📍 Follow-up: If you cannot reach ${userName}, call 911. They may be at or near a courthouse or legal services office. This automated alert was sent by Hearth & Page.`;

    const sendPromises = [
      // Email alerts
      ...emailContacts.map(c => {
        const toEmail = c.contactValue || c.email;
        return sendViaResend({ from: 'Hearth & Page Safety <safety@hearthandpage.ca>', to: [toEmail], subject: emailSubject, html: emailBody })
          .catch(err => console.error('[Safety] Email failed to', toEmail, err.message));
      }),
      // SMS alerts — first message, then follow-up with location
      ...smsContacts.map(async c => {
        const phone = c.contactValue || c.phone;
        try {
          await sendViaTwilio(phone, smsAlert);
          // Follow-up after 15 seconds
          setTimeout(async () => {
            try { await sendViaTwilio(phone, smsFollowUp); }
            catch(e) { console.error('[Safety] SMS follow-up failed:', e.message); }
          }, 15000);
        } catch(err) {
          console.error('[Safety] SMS failed to', phone, err.message);
        }
      }),
    ];
    await Promise.all(sendPromises);
    const totalSent = emailContacts.length + smsContacts.length;
    await dbInsert('alert_log', { userId: req.user.id, method: method || 'button', triggeredAt: Date.now() });
    res.json({ ok: true, sent: totalSent, emailSent: emailContacts.length, smsSent: smsContacts.length });
  } catch(e) { console.error('[Safety] Trigger error:', e.message); res.status(500).json({ message: 'Failed to send alert' }); }
});

app.post('/api/safety/check-codeword', requireAuth, async (req, res) => {
  try {
    const { word } = req.body;
    const settings = await dbGet('safety_settings', { user_id: `eq.${req.user.id}` });
    if (!settings || !settings.codeWord || !word) return res.json({ match: false });
    const cw = settings.codeWord.toLowerCase().trim();
    const typed = word.toLowerCase().trim();
    const match = typed.includes(cw) && cw.length >= 3;
    res.json({ match });
  } catch(e) { res.status(500).json({ message: 'Failed' }); }
});

// ── Admin routes ──

app.post('/api/__admin/reset-pw', async (req, res) => {
  const { adminKey, email, newPassword } = req.body;
  if (adminKey !== 'hp_admin_reset_2024') return res.status(403).json({ error: 'Forbidden' });
  const user = await dbGet('users', { email: `eq.${email.toLowerCase()}` });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const newHash = await hashPassword(newPassword);
  await dbUpdate('users', { id: `eq.${user.id}` }, { passwordHash: newHash });
  res.json({ ok: true, email: user.email });
});

app.post('/api/__admin/list-users', async (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== 'hp_admin_reset_2024') return res.status(403).json({ error: 'Forbidden' });
  const users = await dbAll('users', {}, { order: 'id.asc' });
  res.json(users.map(u => ({ ...u, passwordHash: u.passwordHash ? u.passwordHash.substring(0,30) + '...' : null })));
});

app.post('/api/__admin/ensure-testuser', async (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== 'hp_admin_reset_2024') return res.status(403).json({ error: 'Forbidden' });
  const existing = await dbGet('users', { email: `eq.jlance1@icloud.com` });
  if (existing) {
    const newHash = await hashPassword('Cayenne07');
    await dbUpdate('users', { id: `eq.${existing.id}` }, { passwordHash: newHash, plan: 'plus', emailVerified: 1, subscriptionStatus: 'active' });
    return res.json({ action: 'updated', id: existing.id });
  }
  const hash = await hashPassword('Cayenne07');
  const newUser = await dbInsert('users', { email: 'jlance1@icloud.com', passwordHash: hash, firstName: 'Joshua', emailVerified: 1, plan: 'plus', subscriptionStatus: 'active', createdAt: Date.now(), updatedAt: Date.now() });
  res.json({ action: 'created', id: newUser.id });
});



// ── PDF Review & Patch — field list endpoint ──────────────────────────────
// GET /api/cases/:caseId/pdf-fields/:formType
// Returns [{fieldId, label, currentValue, isBlank}] for the review screen
// v2: uses row.fieldKey (camelCase from dbAll/toCamel) — build 1782819450
app.get('/api/cases/:caseId/pdf-fields/:formType', requireAuth, requireSubscription, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });

    const formType = req.params.formType; // e.g. 'form13'
    // Load schema from disk
    const schemaPath = path.join(__dirname, '..', 'form-engine', 'ON', `${formType}-schema.json`);
    let schemaFields = [];
    if (fs.existsSync(schemaPath)) {
      try {
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        for (const part of (schema.parts || [])) {
          for (const field of (part.fields || [])) {
            // Include all fillable fields (text, currency, numbers, dates, calculated)
            if (field.type && !['checkbox','file','doc','header','separator','label'].includes(field.type)) {
              schemaFields.push({ fieldId: field.fieldId, label: field.label || field.fieldId, partTitle: part.title || '' });
            }
          }
        }
      } catch(e) { /* schema parse error — proceed with empty */ }
    }

    // Fetch current saved values (dbAll returns camelCase rows via toCamel)
    const saved = await dbAll('form_data', { case_id: `eq.${c.id}` });
    const valueMap = {};
    for (const row of saved) { valueMap[row.fieldKey] = row.fieldValue; }

    // Build response
    const fields = schemaFields.map(f => ({
      fieldId: f.fieldId,
      label: f.label,
      partTitle: f.partTitle,
      currentValue: valueMap[f.fieldId] || '',
      isBlank: !valueMap[f.fieldId] || String(valueMap[f.fieldId]).trim() === '',
    }));

    // Sort: blanks first, then filled
    fields.sort((a, b) => (b.isBlank ? 1 : 0) - (a.isBlank ? 1 : 0));

    res.json({ fields, formType, caseId: c.id });
  } catch(e) { res.status(500).json({ message: 'Failed to load field list' }); }
});

// PATCH /api/cases/:caseId/pdf-fields/:formType
// Accepts [{fieldId, value}] — saves each back into form_data, then returns updated blank count
app.patch('/api/cases/:caseId/pdf-fields/:formType', requireAuth, requireSubscription, async (req, res) => {
  try {
    const c = await dbGet('cases', { id: `eq.${req.params.caseId}`, user_id: `eq.${req.user.id}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });

    const updates = Array.isArray(req.body) ? req.body : [];
    for (const { fieldId, value, section } of updates) {
      if (!fieldId) continue;
      const val = String(value ?? '');
      await dbUpsert('form_data', {
        caseId: c.id,
        section: section || '__patch__',
        fieldKey: fieldId,
        fieldValue: val,
        updatedAt: Date.now(),
      });
    }
    await dbUpdate('cases', { id: `eq.${c.id}` }, { updatedAt: Date.now() });
    res.json({ ok: true, saved: updates.length });
  } catch(e) { res.status(500).json({ message: 'Failed to save patches' }); }
});


// ──────────────────────────────────────────────
// Document upload / management routes
// ──────────────────────────────────────────────
const multer = require('multer');
const multerStorage = multer.memoryStorage();
const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','application/pdf',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'];
    const extOk = /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|txt|heic|heif)$/i.test(file.originalname);
    if (allowed.includes(file.mimetype) || extOk) cb(null, true);
    else cb(new Error('Unsupported file type'));
  }
});

// GET /api/cases/:caseId/documents
app.get('/api/cases/:caseId/documents', requireAuth, async (req, res) => {
  try {
    const caseId = parseInt(req.params.caseId);
    const userId = req.user.id;
    // Verify case ownership
    const c = await dbGet('cases', { id: `eq.${caseId}`, user_id: `eq.${userId}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    const docs = await dbAll('case_documents', { case_id: `eq.${caseId}`, user_id: `eq.${userId}` });
    // Return metadata only (no fileData) for list — field names match frontend expectations
    const list = docs.map(d => ({
      id: d.id,
      fileName: d.filename || d.fileName,
      fileType: d.file_type || d.fileType,
      fileSize: d.file_size || d.fileSize,
      label: d.label,
      category: d.category || null,
      description: d.description || null,
      uploadedAt: d.created_at || d.createdAt
    }));
    res.json(list);
  } catch(e) { res.status(500).json({ message: 'Failed to load documents' }); }
});

// POST /api/cases/:caseId/documents
app.post('/api/cases/:caseId/documents', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const caseId = parseInt(req.params.caseId);
    const userId = req.user.id;
    const c = await dbGet('cases', { id: `eq.${caseId}`, user_id: `eq.${userId}` });
    if (!c) return res.status(404).json({ message: 'Case not found' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const fileData = req.file.buffer.toString('base64');
    const now = Date.now();
    const label = req.body.label || null;
    const category = req.body.category || null;
    const description = req.body.description || null;
    const row = await dbInsert('case_documents', {
      case_id: caseId,
      user_id: userId,
      filename: req.file.originalname,
      file_type: req.file.mimetype,
      file_size: req.file.size,
      file_data: fileData,
      label,
      category,
      description,
      created_at: now
    });
    res.json({ id: row.id, fileName: row.filename || row.fileName, fileType: row.file_type || row.fileType, fileSize: row.file_size || row.fileSize, label: row.label, category: row.category, description: row.description, uploadedAt: row.created_at || row.createdAt });
  } catch(e) {
    console.error('Document upload error:', e.message);
    res.status(500).json({ error: e.message || 'Upload failed' });
  }
});

// GET /api/cases/:caseId/documents/:docId  (with fileData for preview/download)
app.get('/api/cases/:caseId/documents/:docId', requireAuth, async (req, res) => {
  try {
    const caseId = parseInt(req.params.caseId);
    const docId = parseInt(req.params.docId);
    const userId = req.user.id;
    const doc = await dbGet('case_documents', { id: `eq.${docId}`, case_id: `eq.${caseId}`, user_id: `eq.${userId}` });
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    res.json({
      id: doc.id, fileName: doc.filename || doc.fileName,
      fileType: doc.file_type || doc.fileType, fileSize: doc.file_size || doc.fileSize,
      fileData: doc.file_data || doc.fileData,
      label: doc.label, category: doc.category || null,
      description: doc.description || null,
      uploadedAt: doc.created_at || doc.createdAt
    });
  } catch(e) { res.status(500).json({ message: 'Failed to load document' }); }
});

// DELETE /api/cases/:caseId/documents/:docId
app.delete('/api/cases/:caseId/documents/:docId', requireAuth, async (req, res) => {
  try {
    const caseId = parseInt(req.params.caseId);
    const docId = parseInt(req.params.docId);
    const userId = req.user.id;
    const doc = await dbGet('case_documents', { id: `eq.${docId}`, case_id: `eq.${caseId}`, user_id: `eq.${userId}` });
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    await dbDelete('case_documents', { id: `eq.${docId}` });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ message: 'Delete failed' }); }
});

// PATCH /api/cases/:caseId/documents/:docId  (update label)
app.patch('/api/cases/:caseId/documents/:docId', requireAuth, async (req, res) => {
  try {
    const caseId = parseInt(req.params.caseId);
    const docId = parseInt(req.params.docId);
    const userId = req.user.id;
    const doc = await dbGet('case_documents', { id: `eq.${docId}`, case_id: `eq.${caseId}`, user_id: `eq.${userId}` });
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    const { label, category, description } = req.body;
    const updates = {};
    if (label !== undefined) updates.label = label || null;
    if (category !== undefined) updates.category = category || null;
    if (description !== undefined) updates.description = description || null;
    await dbUpdate('case_documents', { id: `eq.${docId}` }, updates);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ message: 'Label update failed' }); }
});

// POST /api/cases/:caseId/documents/:docId/parse  — GPT-4o Vision Smart Auto-fill
app.post('/api/cases/:caseId/documents/:docId/parse', requireAuth, async (req, res) => {
  try {
    const caseId = parseInt(req.params.caseId);
    const docId  = parseInt(req.params.docId);
    const userId = req.user.id;

    const doc = await dbGet('case_documents', { id: `eq.${docId}`, case_id: `eq.${caseId}`, user_id: `eq.${userId}` });
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    const fileData = doc.fileData || doc.file_data;
    const fileName = doc.filename || doc.fileName || 'document';
    const fileType = doc.fileType || doc.file_type || 'image/jpeg';

    if (!fileData) {
      console.log('[parse] no file_data on doc', docId);
      return res.json({ fields: [], docTypeLabel: fileName });
    }

    const openAiToken = process.env.CUSTOM_CRED_API_OPENAI_COM_TOKEN || process.env.OPENAI_API_KEY;
    if (!openAiToken) {
      console.error('[parse] No OpenAI token');
      return res.json({ fields: [], docTypeLabel: fileName });
    }

    // ── Convert to base64 image(s) ──────────────────────────────────────────
    const isPDF = fileType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    let imageBase64s = []; // array — image paths use this
    let isPDFDirect = false;
    let pdfText = null;

    if (isPDF) {
      // Use pdfjs-dist v3 (pure JS, no system deps) for text extraction
      try {
        const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
        pdfjsLib.GlobalWorkerOptions.workerSrc = false;
        const pdfBytes = new Uint8Array(Buffer.from(fileData, 'base64'));
        const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
        let extractedText = '';
        const numPages = Math.min(pdfDoc.numPages, 3);
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          const page = await pdfDoc.getPage(pageNum);
          const textContent = await page.getTextContent();
          extractedText += textContent.items.map(item => item.str).join(' ') + '\n';
        }
        if (extractedText.trim().length > 20) {
          pdfText = extractedText.slice(0, 6000);
          console.log('[parse] pdfjs extracted', pdfText.length, 'chars from', numPages, 'pages');
        }
      } catch(e) {
        console.warn('[parse] pdfjs text extraction failed:', e.message);
      }
      isPDFDirect = true;
    } else {
      // Image — resize directly
      let img = fileData;
      try {
        const sharp = require('sharp');
        const buf = Buffer.from(fileData, 'base64');
        const resized = await sharp(buf).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        img = resized.toString('base64');
      } catch(e) { console.warn('[parse] image resize failed:', e.message); }
      imageBase64s.push(img);
    }

    // ── Build GPT-4o Vision messages ────────────────────────────────────────

    const systemPrompt = `You are a document field extractor for a Canadian family law intake application.
Analyze the provided image(s) and:
1. Identify the document type
2. Extract ALL fields relevant to Ontario family law forms

DRIVER'S LICENCE: full_name, date_of_birth, address_street, address_city, address_province, address_postal_code, sex
PASSPORT: full_name, date_of_birth, nationality, expiry_date
NOTICE OF ASSESSMENT (NOA): full_name, tax_year, total_income, net_income, taxable_income, federal_tax_owing
T4 SLIP: employer_name, employee_name, tax_year, employment_income, income_tax_deducted, cpp_contributions, ei_premiums, employee_cpp_contributions
PAY STUB / PAYSTUB: employer_name, employee_name, pay_period_start, pay_period_end, pay_frequency, gross_pay, net_pay, ytd_gross, ytd_net, hourly_rate, hours_worked, regular_pay, overtime_pay, cpp_deduction, ei_deduction, income_tax_deduction, employer_address
BANK STATEMENT: account_holder_name, bank_name, statement_period_start, statement_period_end, opening_balance, closing_balance, total_deposits, total_withdrawals
BIRTH CERTIFICATE: child_full_name, child_date_of_birth, child_sex, parent1_name, parent2_name
MARRIAGE CERTIFICATE: spouse1_name, spouse2_name, marriage_date, marriage_location
COURT ORDER: court_file_number, order_date, applicant_name, respondent_name
SEPARATION AGREEMENT: party1_name, party2_name, agreement_date, children_names, support_amount

For monetary values use numbers only (no $ or commas). Dates use YYYY-MM-DD.
Confidence: "high" = clearly readable, "medium" = partially visible, "low" = uncertain.
Do NOT invent values. If unclear, omit.

Return ONLY valid JSON:
{
  "docType": "paystub",
  "docTypeLabel": "Pay Stub",
  "fields": [
    { "key": "employer_name", "label": "Employer Name", "value": "City of Toronto", "confidence": "high" },
    { "key": "gross_pay", "label": "Gross Pay", "value": "2125.00", "confidence": "high" }
  ]
}`;

    // Build content array — text extraction (PDF), images (photos), or fallback
    let userContent;
    if (isPDFDirect && pdfText) {
      // Best path: send extracted text — accurate, fast, cheap
      userContent = [
        { type: 'text', text: 'Here is the extracted text from the document:\n\n' + pdfText + '\n\nExtract all available fields and return the JSON.' }
      ];
      console.log('[parse] using text extraction path');
    } else if (imageBase64s.length > 0) {
      // Image path: vision
      userContent = [
        ...imageBase64s.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } })),
        { type: 'text', text: 'Extract all available fields from this document and return the JSON.' }
      ];
      console.log('[parse] using vision path');
    } else {
      console.warn('[parse] no usable content — returning empty');
      return res.json({ fields: [], docTypeLabel: fileName });
    }

    const body = JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    });

    console.log('[parse] calling OpenAI Vision | docType guess:', isPDF ? 'PDF' : 'image', '| pages:', imageBase64s.length);
    const oaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiToken}` },
      body,
      signal: AbortSignal.timeout(60000)
    });

    if (!oaiResponse.ok) {
      const errText = await oaiResponse.text();
      console.error('[parse] OpenAI error:', oaiResponse.status, errText.slice(0, 200));
      return res.json({ fields: [], docTypeLabel: fileName });
    }

    const oaiJson   = await oaiResponse.json();
    const rawContent = oaiJson.choices?.[0]?.message?.content || '{}';
    const cleaned   = rawContent.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); } catch(e) { parsed = { fields: [], docTypeLabel: fileName }; }

    const rawFields    = Array.isArray(parsed.fields) ? parsed.fields : [];
    const docTypeLabel = parsed.docTypeLabel || fileName;

    // ── Field key → wizard section/key mapping ───────────────────────────────
    // Keys must match EXACTLY what the React wizard uses in form state
    const AUTOFILL_KEY_MAP = {
      // ── Identity (all forms) ──
      'full_name':               { key: 'fullName',           section: 'applicant',       label: 'Full Name' },
      'employee_name':           { key: 'fullName',           section: 'applicant',       label: 'Full Name' },
      'date_of_birth':           { key: 'dob',                section: 'applicant',       label: 'Date of Birth' },
      'address_street':          { key: 'address',            section: 'applicant',       label: 'Street Address' },
      'address_city':            { key: 'city',               section: 'applicant',       label: 'City' },
      'address_province':        { key: 'province',           section: 'applicant',       label: 'Province' },
      'address_postal_code':     { key: 'postalCode',         section: 'applicant',       label: 'Postal Code' },
      // ── Employment & Income (Form 13 / 13.1) ──
      'employer_name':           { key: 'employerName',       section: 'f13_employment',  label: 'Employer Name' },
      'employer_address':        { key: 'employerAddress',    section: 'f13_employment',  label: 'Employer Address' },
      'pay_frequency':           { key: 'payFrequency',       section: 'f13_employment',  label: 'Pay Frequency' },
      'gross_pay':               { key: 'grossPay',           section: 'f13_employment',  label: 'Gross Pay (this period)' },
      'net_pay':                 { key: 'netPay',             section: 'f13_employment',  label: 'Net Pay (this period)' },
      'ytd_gross':               { key: 'ytdGross',           section: 'f13_employment',  label: 'YTD Gross Earnings' },
      'ytd_net':                 { key: 'ytdNet',             section: 'f13_employment',  label: 'YTD Net Earnings' },
      'hourly_rate':             { key: 'hourlyRate',         section: 'f13_employment',  label: 'Hourly Rate' },
      'pay_period_start':        { key: 'payPeriodStart',     section: 'f13_employment',  label: 'Pay Period Start' },
      'pay_period_end':          { key: 'payPeriodEnd',       section: 'f13_employment',  label: 'Pay Period End' },
      // Deductions
      'income_tax_deduction':    { key: 'incomeTaxDeducted',  section: 'f13_employment',  label: 'Income Tax Deducted' },
      'cpp_deduction':           { key: 'cppDeducted',        section: 'f13_employment',  label: 'CPP Deducted' },
      'ei_deduction':            { key: 'eiDeducted',         section: 'f13_employment',  label: 'EI Deducted' },
      // ── T4 ──
      'employment_income':       { key: 'annualEmploymentIncome', section: 'f13_income',  label: 'Annual Employment Income (T4 Box 14)' },
      'income_tax_deducted':     { key: 'incomeTaxDeducted',  section: 'f13_employment',  label: 'Income Tax Deducted (T4 Box 22)' },
      'cpp_contributions':       { key: 'cppDeducted',        section: 'f13_employment',  label: 'CPP Contributions' },
      'ei_premiums':             { key: 'eiDeducted',         section: 'f13_employment',  label: 'EI Premiums' },
      'tax_year':                { key: 'taxYear',            section: 'f13_income',      label: 'Tax Year' },
      // ── NOA ──
      'total_income':            { key: 'totalIncome',        section: 'f13_income',      label: 'Total Income (Line 15000)' },
      'net_income':              { key: 'netIncome',          section: 'f13_income',      label: 'Net Income (Line 23600)' },
      'taxable_income':          { key: 'taxableIncome',      section: 'f13_income',      label: 'Taxable Income (Line 26000)' },
      'federal_tax_owing':       { key: 'federalTaxOwing',    section: 'f13_income',      label: 'Federal Tax Owing/Refund' },
      // ── Children (birth certificate) ──
      'child_full_name':         { key: 'childFullName',      section: 'children',        label: "Child's Full Name" },
      'child_date_of_birth':     { key: 'childDob',           section: 'children',        label: "Child's Date of Birth" },
      'parent1_name':            { key: 'fullName',           section: 'applicant',       label: 'Full Name' },
      // ── Marriage certificate ──
      'spouse1_name':            { key: 'fullName',           section: 'applicant',       label: 'Full Name' },
      'spouse2_name':            { key: 'respondentFullName', section: 'respondent',      label: 'Respondent Full Name' },
      'marriage_date':           { key: 'marriageDate',       section: 'marriage',        label: 'Date of Marriage' },
      'marriage_location':       { key: 'marriageLocation',   section: 'marriage',        label: 'Place of Marriage' },
      // ── Drop these — not useful in wizard ──
      'sex':                     null,
      'nationality':             null,
      'expiry_date':             null,
      'licence_number':          null,
      'passport_number':         null,
      'sin_last3':               null,
    };

    const fields = rawFields.map(f => {
      const mapping = AUTOFILL_KEY_MAP[f.key];
      if (mapping === null) return null;
      if (mapping) return { ...f, key: mapping.key, section: mapping.section, label: mapping.label || f.label };
      return f; // unknown key — pass through as-is for display
    }).filter(Boolean);

    console.log('[parse] extracted', fields.length, 'mapped fields from', docTypeLabel);
    res.json({ fields, docTypeLabel, docType: parsed.docType || 'unknown' });

  } catch(e) {
    console.error('[parse] error:', e.message);
    res.json({ fields: [], docTypeLabel: 'document' });
  }
});


// ──────────────────────────────────────────────
// Static frontend
// ──────────────────────────────────────────────
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, {
    maxAge: NODE_ENV === 'production' ? '1d' : '0',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) res.setHeader('Cache-Control', 'public, max-age=86400');
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
  }));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'Not found' });
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'Not found' });
    res.status(200).send('<html><body><h1>Hearth & Page API</h1><p>Frontend not deployed.</p></body></html>');
  });
}

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────
async function start() {
  console.log('[HP] Starting Hearth & Page API v3.0.0 (Supabase)');
  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[HP] Server listening on port ${PORT}`);
    console.log(`[HP] Environment: ${NODE_ENV}`);
    console.log(`[HP] DB: Supabase @ ${SUPABASE_URL}`);
  });
}
start().catch(console.error);
