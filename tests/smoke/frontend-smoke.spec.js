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

// ---------------------------------------------------------------------------
// Frontend v2 (Vite/React under /app-v2/*)
//
// Separate describe so an /app-v2 failure doesn't obscure legacy-app checks.
// These tests only verify the plumbing is correct: nixpacks built the bundle,
// Express serves it under /app-v2, assets resolve with correct Content-Type,
// and react-router deep links fall back to index.html correctly.
// ---------------------------------------------------------------------------
test.describe('Frontend v2 (/app-v2)', () => {
  test.setTimeout(30_000);

  test('/app-v2/ serves the v2 shell', async ({ request }) => {
    const res = await request.get(`${BASE}/app-v2/`);
    expect(res.status(), `${BASE}/app-v2/ should return 200`).toBe(200);
    const html = await res.text();
    expect(html, 'html should be the v2 shell').toContain('Hearth &amp; Page (v2)');
    // Vite build emits hashed asset URLs prefixed with /app-v2/
    expect(html, 'assets should be /app-v2/-prefixed').toMatch(/\/app-v2\/assets\/index-\w+\.js/);
  });

  test('/app-v2/status deep link falls back to the SPA shell', async ({ request }) => {
    // react-router handles /status client-side; server must return the shell.
    const res = await request.get(`${BASE}/app-v2/status`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('Hearth &amp; Page (v2)');
  });

  test('/app-v2 assets serve with correct Content-Type', async ({ page, request }) => {
    // First fetch the shell and extract the hashed asset filename dynamically,
    // so this test doesn't need to be updated on every rebuild.
    const html = await (await request.get(`${BASE}/app-v2/`)).text();
    const jsMatch = html.match(/\/app-v2\/(assets\/index-\w+\.js)/);
    const cssMatch = html.match(/\/app-v2\/(assets\/index-\w+\.css)/);
    expect(jsMatch, 'shell should reference a hashed JS bundle').not.toBeNull();
    expect(cssMatch, 'shell should reference a hashed CSS bundle').not.toBeNull();

    const jsRes = await request.get(`${BASE}/app-v2/${jsMatch[1]}`);
    expect(jsRes.status()).toBe(200);
    expect(jsRes.headers()['content-type']).toMatch(/javascript/);

    const cssRes = await request.get(`${BASE}/app-v2/${cssMatch[1]}`);
    expect(cssRes.status()).toBe(200);
    expect(cssRes.headers()['content-type']).toMatch(/css/);
  });

  test('/app-v2 renders without console errors and calls /api/health', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // The StatusPage component calls /api/health on mount — wait for the
    // response to confirm the same-origin API bridge works end-to-end.
    const healthPromise = page.waitForResponse(
      r => r.url().endsWith('/api/health') && r.status() === 200,
      { timeout: 15_000 },
    );
    await page.goto(`${BASE}/app-v2/`, { waitUntil: 'domcontentloaded' });
    await healthPromise;

    // React should have rendered the heading by now.
    await expect(page.getByRole('heading', { name: /production status/i })).toBeVisible({ timeout: 5_000 });

    expect(consoleErrors, 'no console errors on /app-v2/').toEqual([]);
  });
});
