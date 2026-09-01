#!/usr/bin/env node
/**
 * check-bundle-patches.mjs
 *
 * Health check for the pre-built frontend bundle in dist/public/assets/.
 *
 * WHY THIS EXISTS
 * ---------------
 * Several bug fixes since v3.6.0 were applied as string-replace edits directly
 * to the compiled bundle (`dist/public/assets/index-CNjoTsGP.js`) and to
 * `dist/public/assets/hp-patches.js`, because the frontend source (.tsx files)
 * is not being rebuilt from this repo — the compiled `dist/` was built
 * elsewhere and committed. That's a fine short-term workflow, but it means:
 *   1. Anyone running `npm run build` (once source-based building is wired up)
 *      would produce a fresh bundle that SILENTLY drops all these fixes.
 *   2. There is no simple way to look at the repo and know which fixes are
 *      currently active.
 *
 * This script guards against both problems. It reads the current bundle
 * files and verifies that a distinctive "sentinel" string from each active
 * patch is still present. If any sentinel is missing, it exits with code 1
 * and prints which patch is missing, along with the commit that added it and
 * the sentinel that was expected.
 *
 * WIRING
 * ------
 * The `postbuild` npm script runs this automatically. It can also be run
 * manually at any time:
 *
 *   node scripts/check-bundle-patches.mjs
 *
 * MAINTENANCE
 * -----------
 * When you add a new bundle patch, add a new entry to the PATCHES array
 * below AND to docs/BUNDLE_PATCHES.md. When you port a patch back to source
 * .tsx and rebuild cleanly, remove its entry (the fix is now permanent).
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const assetsDir = join(repoRoot, 'dist', 'public', 'assets');

// Every active bundle patch, in order of application (oldest first).
// Each entry MUST have:
//   - commit:    short SHA of the commit that introduced the patch
//   - name:      human-readable one-liner
//   - file:      which file inside dist/public/assets/ the sentinel is in
//                (use a glob-ish prefix like 'index-' to match the hashed
//                 filename, or the exact name for hp-patches.js)
//   - sentinel:  a distinctive substring that MUST be present in that file
//                for the patch to be considered active. Choose something
//                uncommon enough that a stock rebuild would not accidentally
//                produce it, and short enough to be resilient to minor
//                minifier changes.
const PATCHES = [
  {
    commit: 'bc84024',
    name: 'same-origin API base URL (Batch 1b — fix hp_session cookie)',
    file: 'index-',
    sentinel: 'const IC="",Dg=IC',
  },
  {
    commit: 'bc84024',
    name: 'same-origin _RW in hp-patches (Batch 1b)',
    file: 'hp-patches.js',
    sentinel: "var _RW = '';",
  },
  {
    commit: 'e175ba7',
    name: 'PDF & wizard content fixes (Batch 3 — Form 10 template date)',
    file: 'index-',
    sentinel: 'FLR 8 (June 13, 2025)',
  },
  {
    commit: '313444b',
    name: 'CAD Stripe Price IDs (Batch 2b)',
    file: 'index-',
    sentinel: 'price_1U4j',
  },
  {
    commit: '55a0385',
    name: 'save-tab toast + longer green state (BUG-WIZARD-SAVE-FEEDBACK-01)',
    file: 'index-',
    sentinel: 'Your answers are safe.',
  },
  {
    commit: 'ff9a3cc',
    name: 'email button propagates caseId + formKey (BUG-EMAIL-01)',
    file: 'index-',
    sentinel: '__hp_currentCaseId=r,window.__hp_currentFormKey=n,window.__emailPDF',
  },
  {
    commit: '27b6652',
    name: 'Form 8 claim keys routed to section 4 (BUG-CHECKBOX-GATE-01)',
    file: 'index-',
    sentinel: 'custody:4,child_support:4',
  },
  {
    commit: '27b6652',
    name: 'checkbox label fallback to backend label (BUG-CHECKBOX-GATE-01)',
    file: 'index-',
    sentinel: 'fe=Y.label||EO(Y.name)',
  },
  {
    commit: '58ed91f',
    name: 'hide #hp-ready-fab on mobile (BUG-MOBILE-FAB-OVERLAP-01)',
    file: 'hp-patches.js',
    sentinel: '@media (max-width:768px){#hp-ready-fab{display:none !important;}}',
  },
  {
    commit: '58ed91f',
    name: 'hide #hp-tools-fab on mobile (BUG-MOBILE-FAB-OVERLAP-01)',
    file: 'hp-patches.js',
    sentinel: '@media (max-width:768px){#hp-tools-fab{display:none !important;}}',
  },
  {
    commit: '3956b7e',
    name: 'PLUS_REQUIRED 403 interceptor (BUG-PLUS-GATE-LEAKY)',
    file: 'hp-patches.js',
    sentinel: "data.code === 'PLUS_REQUIRED'",
  },
  {
    commit: '3956b7e',
    name: 'Plus-only modal variant (BUG-PLUS-GATE-LEAKY)',
    file: 'hp-patches.js',
    sentinel: 'Document upload, preview, and Smart Auto-fill (Extract) are Plus features.',
  },
  {
    commit: 'b1c07c5',
    name: 'Documents-tab Upgrade to Plus href → /subscription (BUG-PAYWALL-404)',
    file: 'index-',
    sentinel: 'href:"/#/subscription",className:"inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#A8B4D0] text-white text-sm font-medium hover:bg-[#1E2D4E] transition-colors",children:"Upgrade to Plus \u2192"',
  },
  {
    commit: 'cb292e1',
    name: 'Extract parse-sheet closes on 4xx (BUG-EXTRACT-STUCK-AFTER-403)',
    file: 'hp-patches.js',
    sentinel: 'if (!r.ok) { overlay.remove(); return; }',
  },
  {
    commit: 'cb292e1',
    name: 'Evidence inline-panel banner position:static (BUG-EVIDENCE-BANNER-OVERLAP)',
    file: 'hp-patches.js',
    sentinel: '<div class="hp-ev-upload-bar" style="position:static;"><p style="color:#C9903A',
  },
  {
    commit: '0a91840',
    name: 'Form 35.1 Q6.5 field for discharges and other prior involvement (FEAT-F351-Q65)',
    file: 'index-',
    sentinel: 'key:"criminalOtherInvolvement"',
  },
  {
    commit: '1777e5c',
    name: 'Sensitive-area heads-up card on F351 Legal + Violence (FEAT-F351-HEADSUP)',
    file: 'hp-patches.js',
    sentinel: "var CARD_ID = 'hp-sensitive-heads-up';",
  },
  {
    commit: '837b85a',
    name: 'Wizard content padding below Add/Remove Forms FAB (BUG-FAB-OVERLAP)',
    file: 'hp-patches.js',
    sentinel: 'body:has(#hp-wiz-addforms-bar) main{padding-bottom:5rem;}',
  },
];

function resolveFile(prefixOrName) {
  if (!existsSync(assetsDir)) {
    return null;
  }
  const entries = readdirSync(assetsDir);
  // Exact match first
  if (entries.includes(prefixOrName)) {
    return join(assetsDir, prefixOrName);
  }
  // Prefix match (for hashed bundles like index-XXXXXXXX.js)
  const match = entries.find(
    (name) => name.startsWith(prefixOrName) && name.endsWith('.js'),
  );
  return match ? join(assetsDir, match) : null;
}

function main() {
  if (!existsSync(assetsDir)) {
    console.error(`[bundle-guard] FATAL: assets directory not found: ${assetsDir}`);
    process.exit(1);
  }

  // Cache file contents so we only read each file once.
  const contents = new Map();
  const failures = [];

  for (const patch of PATCHES) {
    const path = resolveFile(patch.file);
    if (!path) {
      failures.push({
        patch,
        reason: `file not found (looked for '${patch.file}' in ${assetsDir})`,
      });
      continue;
    }
    if (!contents.has(path)) {
      contents.set(path, readFileSync(path, 'utf8'));
    }
    const body = contents.get(path);
    if (!body.includes(patch.sentinel)) {
      failures.push({
        patch,
        reason: `sentinel not found in ${path.replace(repoRoot + '/', '')}`,
      });
    }
  }

  const total = PATCHES.length;
  const passed = total - failures.length;

  if (failures.length === 0) {
    console.log(`[bundle-guard] OK — all ${total} bundle patches are present.`);
    return;
  }

  console.error(`[bundle-guard] FAIL — ${failures.length} of ${total} bundle patches missing:\n`);
  for (const f of failures) {
    console.error(`  MISSING: ${f.patch.commit}  ${f.patch.name}`);
    console.error(`  Reason:  ${f.reason}`);
    console.error(`  Sentinel expected: ${f.patch.sentinel.slice(0, 100)}${f.patch.sentinel.length > 100 ? '…' : ''}`);
    console.error('');
  }
  console.error('If this ran after `npm run build`, your build wiped bundle patches.');
  console.error('See docs/BUNDLE_PATCHES.md for the full inventory and how to port to source .tsx.');
  process.exit(1);
}

main();
