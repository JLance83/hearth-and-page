// tests/smoke/frontend-smoke.spec.js
//
// Playwright smoke test suite for the Hearth & Page production frontend.
// Runs against PROD_HOST (default: app.hearthandpage.ca) after every deploy.
//
// Symptoms this suite guards against (all previously observed in production):
//
//   1. "PDF download button sometimes doesn't appear after login"
//      Root cause hypothesis: window.__hp_patches_ready was emitted mid-file
//      inside an IIFE, so downstream consumers sometimes queued forever.
//      Test: assert window.__hp_patches_ready becomes true within 10s of
//      page load AND that every window.__* function the download-button
//      injector needs is defined.
//
//   2. "Form list occasionally shows incomplete (missing forms)"
//      Root cause hypothesis: PDF template files fail to serve, or the
//      MutationObserver in hp-patches.js hasn't attached before the page
//      renders.
//      Test: HEAD-check that N known form template PDFs are all reachable
//      with content-type application/pdf.
//
//   3. "After a Railway cold start, first PDF generation sometimes fails silently"
//      Root cause hypothesis: cold Python interpreter + first-invocation
//      race in vendored pypdf load.
//      Test: after the deploy is confirmed live, immediately hit a static
//      PDF template URL and assert the response is a valid PDF (first byte
//      %PDF). Then also hit /api/pdf-runtime-check twice to force Python
//      subprocess start-up and confirm it doesn't silently error.
//
// All tests are unauthenticated. Full logged-in flows (login → dashboard →
// download button visible → PDF download) are out of scope for the smoke
// tier — those belong in a separate authenticated e2e suite that runs less
// frequently.

const { test, expect } = require('@playwright/test');

const HOST = process.env.PROD_HOST || 'app.hearthandpage.ca';
const BASE = `https://${HOST}`;

// Known critical form templates. If any of these fail to serve, the app is
// broken for a large portion of users. Kept small for smoke-test speed.
const CRITICAL_FORM_TEMPLATES = [
  'form8.pdf',    // Application (general)
  'form13.pdf',   // Financial Statement (Support Claims)
  'form14.pdf',   // Notice of Motion
  'form14a.pdf',  // Affidavit
  'form14b.pdf',  // Affidavit (for Uncontested Trial)
  'form35_1.pdf', // Affidavit in Support of Claim for Custody or Access
  'form36.pdf',   // Affidavit for Divorce
];

// Global-function surface that hp-patches.js is expected to expose after
// window.__hp_patches_ready. These are the ones the download-button injector
// and other consumers actually call — if any is missing, the corresponding
// UI element won't work.
const EXPECTED_GLOBALS = [
  '__hp_patches_ready',       // must be true
  '__patchForm35PDF_real',    // Form 35.1 PDF patcher
  '__patchForm13PDF_real',    // Form 13 PDF patcher
  '__emailPDF_real',          // Email-PDF handler
  '__openSafetyOverlay_real', // Safety overlay (may be lazy)
  '__getFlap35Token',         // Auth helper
];

test.describe('Frontend smoke', () => {
  test.setTimeout(45_000);

  test('page loads without console errors and hp-patches becomes ready', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const failedRequests = [];
    page.on('requestfailed', req => {
      failedRequests.push(`${req.url()} - ${req.failure()?.errorText}`);
    });

    const response = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    expect(response.status(), `${BASE}/ should load with 200`).toBe(200);

    // Wait for hp-patches.js to signal ready. This is the KEY assertion for
    // symptom #1: if this hangs, the ready signal is broken.
    await page.waitForFunction(
      () => window.__hp_patches_ready === true,
      null,
      { timeout: 10_000 },
    );

    // Check all expected globals are defined
    const missing = await page.evaluate((names) => {
      return names.filter(n => typeof window[n] === 'undefined');
    }, EXPECTED_GLOBALS);
    expect(missing, `all expected window.__ globals should be defined`).toEqual([]);

    // Give MutationObservers ~1s to settle, then check for JS errors from
    // that settling period too.
    await page.waitForTimeout(1000);

    // Filter out expected/benign console noise
    const realErrors = consoleErrors.filter(err => {
      // pdf-lib is loaded lazily via CDN — its absence at initial load is expected
      if (err.includes('pdf-lib')) return false;
      // Cloudflare beacons etc.
      if (err.includes('cdn-cgi/')) return false;
      return true;
    });
    expect(realErrors, `no critical console errors on page load`).toEqual([]);

    // Failed network requests are always a problem for static assets
    const criticalFailures = failedRequests.filter(f =>
      f.includes('/assets/hp-patches.js') ||
      f.includes('/assets/index-') ||
      f.includes('/assets/FormEngine.js'),
    );
    expect(criticalFailures, `no critical asset failures`).toEqual([]);
  });

  test('all critical form template PDFs are reachable with correct MIME', async ({ request }) => {
    for (const pdf of CRITICAL_FORM_TEMPLATES) {
      const url = `${BASE}/pdfs/${pdf}`;
      const res = await request.head(url);
      expect(res.status(), `${url} should return 200`).toBe(200);
      const ct = res.headers()['content-type'] || '';
      expect(ct, `${url} content-type should be application/pdf`).toMatch(/application\/pdf/i);
    }
  });

  test('static PDF templates serve valid PDF bytes (cold-start check)', async ({ request }) => {
    // Fetch the actual bytes of one critical PDF and verify the file magic.
    // A common cold-start failure mode is the file being returned with a
    // 200 but a truncated/empty body — the HEAD test above won't catch that.
    const res = await request.get(`${BASE}/pdfs/form8.pdf`, { timeout: 30_000 });
    expect(res.status()).toBe(200);
    const buf = await res.body();
    expect(buf.length, 'PDF body should be non-trivial').toBeGreaterThan(10_000);
    const magic = buf.slice(0, 4).toString('utf8');
    expect(magic, 'PDF magic bytes should be %PDF').toBe('%PDF');
  });

  test('pdf-runtime-check twice: cold python + warm python both succeed', async ({ request }) => {
    // Symptom #3: cold Python subprocess sometimes fails silently on first
    // invocation. We hit the endpoint twice with a small gap and require both
    // to succeed. The route caches for 60s, so the second call likely hits
    // the cache — but the first is a fresh subprocess start.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await request.get(`${BASE}/api/pdf-runtime-check`, { timeout: 30_000 });
      expect(res.status(), `attempt ${attempt} HTTP status`).toBe(200);
      const body = await res.json();
      expect(body.ok, `attempt ${attempt} .ok`).toBe(true);
      expect(body.pypdfVersion, `attempt ${attempt} .pypdfVersion`).toBeTruthy();
      if (attempt === 1) await new Promise(r => setTimeout(r, 500));
    }
  });
});
