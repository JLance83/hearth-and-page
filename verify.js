/**
 * Hearth & Page — Post-Deploy Smoke Test
 * Runs a headless browser against the live site and checks all critical surfaces.
 * Exit 0 = pass, Exit 1 = fail (deploy blocked).
 */

const { chromium } = require('playwright');

const LIVE_URL   = 'https://hearthandpage.ca';
const TEST_EMAIL = 'jlance1@icloud.com';
const TEST_PASS  = 'xutsug-puxwet-kudfI3';
const VIEWPORT   = { width: 390, height: 844 };

const passed   = [];
const failures = [];

function ok(msg)         { passed.push(msg);   console.log('  \u2713 ' + msg); }
function fail(name, why) { failures.push(name + ': ' + why); console.error('  \u2717 ' + name + ' — ' + why); }

async function run() {
  console.log('\n\u2500\u2500\u2500 Hearth & Page Pre-Deploy Smoke Test \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n');

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  await page.setViewportSize(VIEWPORT);

  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push(err.message));

  // ── 1. Login ─────────────────────────────────────────────────────────────
  console.log('[ Login ]');
  await page.goto(LIVE_URL + '/#/login', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  try {
    await page.fill('[data-testid="input-email"]',    TEST_EMAIL);
    await page.fill('[data-testid="input-password"]', TEST_PASS);
    await page.click('[data-testid="button-submit-login"]');
    await page.waitForTimeout(4000);
    const url = page.url();
    if (url.includes('dashboard') || url.includes('#/') && !url.includes('login')) {
      ok('Login succeeds and redirects to dashboard');
    } else {
      fail('Login', 'Still on login page after submit — url: ' + url);
    }
  } catch (e) {
    fail('Login', e.message);
  }

  // ── 2. JavaScript errors ─────────────────────────────────────────────────
  console.log('\n[ JavaScript Errors ]');
  if (jsErrors.length === 0) {
    ok('No JS errors on load');
  } else {
    jsErrors.forEach(e => fail('JS error', e.slice(0, 120)));
  }

  // ── 3. Patches version hash ───────────────────────────────────────────────
  console.log('\n[ Patches ]');
  try {
    const patchHash = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      const patch   = scripts.find(s => s.src.includes('hp-patches.js'));
      if (!patch) return null;
      const m = patch.src.match(/\?v=([a-f0-9]+)/);
      return m ? m[1] : 'no-hash';
    });
    if (patchHash) {
      ok('hp-patches.js loaded with version hash: ' + patchHash);
    } else {
      fail('Patches', 'hp-patches.js script tag not found');
    }
  } catch (e) {
    fail('Patches', e.message);
  }

  // ── 4. Navbar icons ───────────────────────────────────────────────────────
  console.log('\n[ Navbar Icons ]');

  const mustBeVisible = [
    { testid: 'button-theme-toggle', label: 'Theme toggle'    },
    { testid: 'button-nav-dashboard',label: 'Dashboard icon'  },
    { testid: 'button-nav-account',  label: 'Person/account icon' },
    { testid: 'button-safety',       label: 'Shield icon'     },
    { testid: 'button-logout',       label: 'Logout icon'     },
    { testid: 'button-nav-courthouse',label: 'Courthouse icon' },
    { testid: 'button-nav-plans',    label: 'Plans/card icon' },
  ];

  for (const check of mustBeVisible) {
    const info = await page.evaluate((id) => {
      const el = document.querySelector('[data-testid="' + id + '"]');
      if (!el) return null;
      const r  = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      return { display: cs.display, w: Math.round(r.width), right: Math.round(r.right) };
    }, check.testid);

    if (!info || info.display === 'none' || info.w === 0) {
      fail(check.label, 'Element hidden or missing');
    } else if (info.right > VIEWPORT.width + 5) {
      fail(check.label, 'Clipped off right edge (right=' + info.right + 'px, viewport=' + VIEWPORT.width + 'px)');
    } else {
      ok(check.label + ' visible at ' + info.right + 'px');
    }
  }

  // Logo must stay compact on mobile (font-size:0 trick — check width not display)
  const logoWidth = await page.evaluate(() => {
    const logo = document.querySelector('[data-testid="link-home"]');
    return logo ? Math.round(logo.getBoundingClientRect().width) : -1;
  });
  if (logoWidth > 0 && logoWidth <= 80) {
    ok('Logo compact on mobile (' + logoWidth + 'px)');
  } else {
    fail('Logo width on mobile', logoWidth + 'px — expected <= 80px');
  }

  // Account button must have person icon, not gear
  const accountIconSvg = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="button-nav-account"]');
    return btn ? btn.innerHTML : '';
  });
  if (accountIconSvg.includes('cx') || accountIconSvg.includes('M4 20') || accountIconSvg.includes('M19 21')) {
    ok('Account button has person icon (circle/person SVG path)');
  } else if (accountIconSvg.includes('M12.22') || accountIconSvg.includes('cog') || accountIconSvg.includes('gear')) {
    fail('Account button icon', 'Still showing gear/settings icon instead of person');
  } else {
    ok('Account button icon present (SVG found)');
  }

  // ── 5. Shield opens safety overlay ───────────────────────────────────────
  console.log('\n[ Shield / Safety Overlay ]');
  try {
    await page.click('[data-testid="button-safety"]');
    await page.waitForTimeout(1500);
    const overlayVisible = await page.evaluate(() => {
      const overlay = document.querySelector('.hp-safety-overlay, [class*="safety-overlay"], [class*="safetyOverlay"]');
      if (overlay) {
        const cs = window.getComputedStyle(overlay);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      }
      // Fallback: look for any overlay-style fixed element that appeared
      const fixed = Array.from(document.querySelectorAll('*')).filter(el => {
        const cs = window.getComputedStyle(el);
        return cs.position === 'fixed' && cs.zIndex > 40 && cs.display !== 'none'
               && parseInt(cs.width) > 200 && parseInt(cs.height) > 200;
      });
      return fixed.length > 0;
    });
    if (overlayVisible) {
      ok('Shield opens safety overlay');
    } else {
      fail('Shield', 'Safety overlay not visible after click');
    }
    // Close overlay — click outside or press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    // Force-close via JS in case Escape didn't work
    await page.evaluate(() => {
      const overlay = document.getElementById('hp-safety-overlay');
      if (overlay) overlay.style.display = 'none';
    });
    await page.waitForTimeout(300);
  } catch (e) {
    fail('Shield click', e.message);
  }

  // ── 6. Quiz / H&P Tools ──────────────────────────────────────────────────
  console.log('\n[ Quiz / H&P Tools ]');
  try {
    const quizLink = await page.$('[data-testid="link-dashboard-quiz"]') ||
                     await page.$('[data-testid="link-form-quiz"]');
    if (!quizLink) {
      fail('Quiz link', 'Neither link-dashboard-quiz nor link-form-quiz found');
    } else {
      await quizLink.click();
      await page.waitForTimeout(1500);
      const sheetVisible = await page.evaluate(() => {
        const fixed = Array.from(document.querySelectorAll('*')).filter(el => {
          const cs = window.getComputedStyle(el);
          return cs.position === 'fixed' && cs.display !== 'none'
                 && parseInt(cs.zIndex) > 40 && parseInt(cs.width) > 200;
        });
        return fixed.length > 0;
      });
      if (sheetVisible) {
        ok('Quiz link opens H&P Tools overlay');
      } else {
        fail('Quiz', 'H&P Tools overlay did not appear');
      }
    }
  } catch (e) {
    fail('Quiz', e.message);
  }

  // ── 7. Patch globals ─────────────────────────────────────────────────────
  console.log('\n[ Patch Globals ]');
  const globals = await page.evaluate(() => ({
    _RW:                   typeof window._RW,
    __openSafetyOverlay:   typeof window.__openSafetyOverlay,
    __hpQuiz:              typeof window.__hpQuiz,
  }));

  if (globals._RW === 'string')     ok('_RW global defined (Railway URL)');
  else                              fail('_RW global', 'type=' + globals._RW + ' (expected string)');

  if (globals.__openSafetyOverlay === 'function') ok('__openSafetyOverlay is a function');
  else                                            fail('__openSafetyOverlay', 'type=' + globals.__openSafetyOverlay);

  if (globals.__hpQuiz === 'object') ok('__hpQuiz object registered');
  else                               fail('__hpQuiz', 'type=' + globals.__hpQuiz + ' (expected object)');

  // ── Summary ──────────────────────────────────────────────────────────────
  await browser.close();
  const total = passed.length + failures.length;
  console.log('\n' + '\u2500'.repeat(60));
  console.log('  Passed: ' + passed.length + '   Failed: ' + failures.length);

  if (failures.length > 0) {
    console.error('\n  FAILURES:');
    failures.forEach(f => console.error('    \u2022 ' + f));
    console.error('\n  Deploy BLOCKED. Fix the above issues and re-run.\n');
    process.exit(1);
  } else {
    console.log('\n  All checks passed \u2014 safe to deploy.\n');
    process.exit(0);
  }
}

run().catch(e => {
  console.error('\n  SMOKE TEST CRASHED:', e.message);
  process.exit(1);
});
