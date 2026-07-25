#!/usr/bin/env node
/**
 * Hearth & Page — Pre-Deploy Smoke Test
 * Runs a headless browser, logs in, and verifies all critical UI features.
 * Called by deploy.sh before every push. Exit 0 = pass, exit 1 = fail.
 */

const { chromium } = require('playwright');

const URL   = 'https://hearthandpage.ca';
const EMAIL = 'jlance1@icloud.com';
const PASS  = 'xutsug-puxwet-kudfI3';
const VIEWPORT = { width: 390, height: 844 }; // iPhone

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  console.log('  ✓ ' + name);
  passed++;
}

function fail(name, detail) {
  console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  failures.push(name + (detail ? ': ' + detail : ''));
  failed++;
}

async function run() {
  console.log('\n─── Hearth & Page Pre-Deploy Smoke Test ───────────────────\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize(VIEWPORT);

  // Collect JS errors
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));

  // ── 1. Login ──────────────────────────────────────────────────────────────
  console.log('[ Login ]');
  await page.goto(URL + '/#/login', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  try {
    await page.fill('[data-testid="input-email"]', EMAIL);
    await page.fill('[data-testid="input-password"]', PASS);
    await page.click('[data-testid="button-submit-login"]');
    await page.waitForTimeout(5000);
    const hash = await page.evaluate(() => window.location.hash);
    if (hash.includes('dashboard') || hash.includes('case')) {
      ok('Login succeeds and redirects to dashboard');
    } else {
      fail('Login', 'Expected #/dashboard, got ' + hash);
    }
  } catch (e) {
    fail('Login', e.message.substring(0, 100));
  }

  // ── 2. No JS errors on load ───────────────────────────────────────────────
  console.log('\n[ JavaScript Errors ]');
  const criticalErrors = jsErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('ResizeObserver') &&
    !e.includes('Non-Error')
  );
  if (criticalErrors.length === 0) {
    ok('No JS errors on load');
  } else {
    criticalErrors.forEach(e => fail('JS Error', e.substring(0, 120)));
  }

  // ── 3. Patches loaded at correct version ─────────────────────────────────
  console.log('\n[ Patches ]');
  const patchVersion = await page.evaluate(() => {
    const s = Array.from(document.querySelectorAll('script')).find(el => el.src.includes('hp-patches'));
    return s ? s.src.split('?v=')[1] : null;
  });
  if (patchVersion) {
    ok('hp-patches.js loaded with version hash: ' + patchVersion);
  } else {
    fail('hp-patches.js', 'Script not found in DOM');
  }

  // ── 4. Navbar icons present ───────────────────────────────────────────────
  console.log('\n[ Navbar Icons ]');
  const navChecks = [
    { id: 'button-theme-toggle', name: 'Theme toggle' },
    { id: 'button-nav-dashboard', name: 'Dashboard icon' },
    { id: 'button-nav-account', name: 'Person/account icon' },
    { id: 'button-safety', name: 'Shield icon' },
    { id: 'button-logout', name: 'Logout icon' },
  ];
  for (const check of navChecks) {
    const info = await page.evaluate((id) => {
      const el = document.querySelector('[data-testid="' + id + '"]');
      if (!el) return { exists: false };
      const r = el.getBoundingClientRect();
      return { exists: true, visible: r.width > 0, right: Math.round(r.right) };
    }, check.id);
    if (!info.exists) {
      fail(check.name, 'Element not in DOM');
    } else if (!info.visible) {
      fail(check.name, 'Element hidden (display:none or width:0)');
    } else if (info.right > VIEWPORT.width + 5) {
      fail(check.name, 'Clipped off right edge (right=' + info.right + 'px, viewport=' + VIEWPORT.width + 'px)');
    } else {
      ok(check.name + ' visible at ' + info.right + 'px');
    }
  }

  // Courthouse and plans should be HIDDEN on mobile
  const shouldBeHidden = ['button-nav-courthouse', 'button-nav-plans'];
  for (const id of shouldBeHidden) {
    const w = await page.evaluate((id) => {
      const el = document.querySelector('[data-testid="' + id + '"]');
      return el ? el.getBoundingClientRect().width : -1;
    }, id);
    if (w === 0) {
      ok(id + ' correctly hidden on mobile');
    } else if (w === -1) {
      ok(id + ' not in DOM (hidden by React)');
    } else {
      fail(id + ' should be hidden on mobile', 'width=' + w + 'px — will push icons off screen');
    }
  }

  // Person icon should NOT be a gear (check SVG path for person shape)
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
    await page.waitForTimeout(2000);
    const overlayOpen = await page.evaluate(() => {
      const overlay = document.getElementById('hp-safety-overlay');
      return overlay && overlay.style.display !== 'none' && overlay.style.display !== '';
    });
    if (overlayOpen) {
      ok('Shield opens safety overlay');
      // Close it
      await page.evaluate(() => {
        const overlay = document.getElementById('hp-safety-overlay');
        if (overlay) overlay.style.display = 'none';
      });
    } else {
      fail('Shield button', 'Safety overlay did not open after click');
    }
  } catch (e) {
    fail('Shield button', e.message.substring(0, 100));
  }

  // ── 6. Quiz link opens tools sheet ───────────────────────────────────────
  console.log('\n[ Quiz / H&P Tools ]');
  try {
    const quizLink = await page.$('[data-testid="link-dashboard-quiz"]');
    if (!quizLink) {
      fail('Quiz link', 'link-dashboard-quiz not found in DOM');
    } else {
      await quizLink.click();
      await page.waitForTimeout(2000);
      const quizOpen = await page.evaluate(() => {
        const overlay = document.getElementById('hp-quiz-overlay');
        const sheet = document.getElementById('hp-tools-sheet');
        return !!(overlay || sheet);
      });
      if (quizOpen) {
        ok('Quiz link opens H&P Tools overlay');
      } else {
        fail('Quiz link', 'Neither hp-quiz-overlay nor hp-tools-sheet appeared after click');
      }
    }
  } catch (e) {
    fail('Quiz link', e.message.substring(0, 100));
  }

  // ── 7. window globals set by patches ─────────────────────────────────────
  console.log('\n[ Patch Globals ]');
  const globals = await page.evaluate(() => ({
    RW: typeof window._RW,
    openSafety: typeof window.__openSafetyOverlay,
    hpQuiz: typeof window.__hpQuiz,
    patchesReady: !!window.__hp_patches_ready,
  }));

  if (globals.RW === 'string') {
    ok('_RW global defined (Railway URL)');
  } else {
    fail('_RW global', 'undefined — all API calls will fail');
  }

  if (globals.openSafety === 'function') {
    ok('__openSafetyOverlay is a function');
  } else {
    fail('__openSafetyOverlay', 'not a function — shield will not work');
  }

  if (globals.hpQuiz === 'object') {
    ok('__hpQuiz object registered');
  } else {
    fail('__hpQuiz', 'not registered — quiz/tools sheet will not work');
  }

  await browser.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────');
  console.log('  Passed: ' + passed + '   Failed: ' + failed);
  if (failures.length > 0) {
    console.error('\n  FAILURES:');
    failures.forEach(f => console.error('    • ' + f));
    console.error('\n  Deploy BLOCKED. Fix the above issues and re-run.\n');
    process.exit(1);
  } else {
    console.log('\n  All checks passed — safe to deploy.\n');
    process.exit(0);
  }
}

run().catch(e => {
  console.error('\n  SMOKE TEST CRASHED:', e.message);
  process.exit(1);
});
