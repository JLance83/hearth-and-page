// dist/health_extras.js
// Boot-time metadata + PDF runtime probe for /api/health and
// /api/pdf-runtime-check. Kept separate from index.cjs so the additions are
// easy to inspect and reason about.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ─── Boot info ────────────────────────────────────────────────────────────
// Railway injects RAILWAY_GIT_COMMIT_SHA and friends automatically. We fall
// back to any prebuilt marker file the build step wrote, and finally to null.
function _readCommit() {
  const fromEnv = process.env.RAILWAY_GIT_COMMIT_SHA
               || process.env.RAILWAY_DEPLOYMENT_ID
               || process.env.GIT_COMMIT
               || process.env.SOURCE_COMMIT;
  if (fromEnv) return fromEnv;
  try {
    const p = path.join(__dirname, 'git_sha.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim() || null;
  } catch (_) { /* ignore */ }
  return null;
}

function _readPkgVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null;
  } catch (_) { return null; }
}

const _bootMs = Date.now();
const BOOT_INFO = Object.freeze({
  commit: _readCommit(),
  startTime: new Date(_bootMs).toISOString(),
  startTimeMs: _bootMs,
  node: process.version,
  version: _readPkgVersion(),
});

// ─── PDF runtime probe ────────────────────────────────────────────────────
// Shells out to `python3 fill_pdf.py --self-check`. The self-check imports
// pypdf from the vendored wheel and prints a small JSON payload. If the
// vendored wheel is broken, this endpoint 500s and the smoke test fails —
// which is exactly what we want.

function _resolvePython() {
  // Prefer the interpreter path recorded at build time; fall back to PATH.
  try {
    const p = path.join(__dirname, 'python3_path.txt');
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v && fs.existsSync(v)) return v;
    }
  } catch (_) { /* ignore */ }
  return 'python3';
}

function _resolveFillPdf() {
  // Try dist/fill_pdf.py first (Railway build copies it here), then repo root.
  const distPath = path.join(__dirname, 'fill_pdf.py');
  if (fs.existsSync(distPath)) return distPath;
  return path.join(__dirname, '..', 'fill_pdf.py');
}

function checkPdfRuntime() {
  return new Promise((resolve) => {
    const started = Date.now();
    const python = _resolvePython();
    const fillPdf = _resolveFillPdf();
    execFile(python, [fillPdf, '--self-check'], { timeout: 10_000 }, (err, stdout, stderr) => {
      const durationMs = Date.now() - started;
      if (err) {
        return resolve({
          ok: false,
          error: String(err.message || err),
          stderr: (stderr || '').slice(0, 2000),
          stdout: (stdout || '').slice(0, 2000),
          durationMs,
          python,
          fillPdf,
        });
      }
      let parsed = null;
      try { parsed = JSON.parse(stdout.trim()); } catch (_) { /* leave null */ }
      if (parsed && parsed.ok) {
        return resolve({ ...parsed, durationMs, python, fillPdf });
      }
      return resolve({
        ok: false,
        error: 'self-check did not return ok:true',
        stdout: (stdout || '').slice(0, 2000),
        stderr: (stderr || '').slice(0, 2000),
        durationMs,
        python,
        fillPdf,
      });
    });
  });
}

module.exports = { BOOT_INFO, checkPdfRuntime };
