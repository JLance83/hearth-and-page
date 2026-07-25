#!/bin/bash
# HP Deploy — auto-busts cache on hp-patches.js and FormEngine.js
# Usage: bash deploy.sh "commit message"
# Runs a live smoke test AFTER push to verify nothing is broken.
set -e

MSG="${1:-deploy: update patches}"

echo "=== HP Deploy ==="

# 1. Copy source patches to dist
cp hp-patches.js dist/public/assets/hp-patches.js

# 2. Syntax check (catches JS errors before they reach production)
node --check dist/public/assets/hp-patches.js || { echo "SYNTAX ERROR in hp-patches.js — deploy aborted"; exit 1; }

# 3. Generate hashes
PATCHES_HASH=$(md5sum dist/public/assets/hp-patches.js | cut -c1-8)
FORMENGINE_HASH=$(md5sum dist/public/assets/FormEngine.js | cut -c1-8)
echo "hp-patches.js  → v=$PATCHES_HASH"
echo "FormEngine.js  → v=$FORMENGINE_HASH"

# 4. Update index.html with new hashes
python3 -c "
import re, sys
ph = sys.argv[1]
fh = sys.argv[2]
with open('dist/public/index.html', 'r') as f:
    html = f.read()
html = re.sub(r'<script src=\"\./assets/hp-patches\.js[^\"]*\"', '<script src=\"./assets/hp-patches.js?v=' + ph + '\"', html)
html = re.sub(r'<script src=\"\./assets/FormEngine\.js[^\"]*\"', '<script src=\"./assets/FormEngine.js?v=' + fh + '\"', html)
with open('dist/public/index.html', 'w') as f:
    f.write(html)
print('index.html cache-busted')
" "$PATCHES_HASH" "$FORMENGINE_HASH"

# 5. Commit and push
git add hp-patches.js dist/public/assets/hp-patches.js dist/public/assets/index-CNjoTsGP.js dist/public/index.html
git commit -m "$MSG" 2>/dev/null || git commit --allow-empty -m "$MSG"
git push origin HEAD:main

echo ""
echo "=== Push complete — waiting 45s for Cloudflare to propagate ==="
sleep 45

# 6. Run smoke test against live site
echo ""
echo "=== Running post-deploy smoke test ==="
node verify.js
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "!!! SMOKE TEST FAILED — production is broken !!!"
  echo "    Review the failures above and deploy a fix immediately."
  exit 1
fi

echo "=== Deploy verified and complete ==="
