#!/usr/bin/env bash
# scripts/rollback-hp-patches.sh
#
# One-command rollback for the frontend patch bundle.
#
# Usage:
#   scripts/rollback-hp-patches.sh                # roll back one commit
#   scripts/rollback-hp-patches.sh --commit <sha> # roll back to a specific commit
#   scripts/rollback-hp-patches.sh --list         # list recent commits that
#                                                 # changed hp-patches.js
#
# What it does:
#   1. Finds the last commit that changed dist/public/assets/hp-patches.js
#      before HEAD (or a user-supplied commit).
#   2. Restores that file's content, no other files touched.
#   3. Stages + commits with a clear "Revert" message on the current branch.
#   4. Reminds you to push.
#
# It does NOT force-push or rewrite history — the rollback is a new commit
# on top of the current branch, so the deploy pipeline will pick it up
# normally and the smoke test will validate the rolled-back version.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="dist/public/assets/hp-patches.js"

cd "$REPO_ROOT"

usage() {
  cat <<EOF
Usage:
  $0                    Roll back hp-patches.js to its state at the previous commit that touched it
  $0 --commit <sha>     Roll back to the version at <sha>
  $0 --list             Show recent commits that changed hp-patches.js
  $0 --help             This help
EOF
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --list)
    echo "Recent commits that changed $FILE:"
    git log --oneline -20 -- "$FILE"
    exit 0
    ;;
  --commit)
    TARGET="${2:-}"
    if [ -z "$TARGET" ]; then
      echo "ERROR: --commit requires a SHA argument" >&2
      exit 2
    fi
    ;;
  "")
    # Find the second-most-recent commit that changed hp-patches.js
    # (most recent = the one shipped now; second most recent = the previous version)
    TARGET="$(git log --format=%H -2 -- "$FILE" | tail -1)"
    if [ -z "$TARGET" ]; then
      echo "ERROR: no previous commit found for $FILE" >&2
      exit 3
    fi
    ;;
  *)
    echo "ERROR: unknown argument: $1" >&2
    usage
    exit 2
    ;;
esac

# Sanity checks
if ! git rev-parse --verify --quiet "$TARGET" >/dev/null; then
  echo "ERROR: $TARGET is not a valid commit" >&2
  exit 4
fi

if ! git cat-file -e "$TARGET:$FILE" 2>/dev/null; then
  echo "ERROR: $FILE does not exist at $TARGET" >&2
  exit 5
fi

CURRENT_SHA="$(git rev-parse HEAD)"
CURRENT_SHORT="$(git rev-parse --short HEAD)"
TARGET_SHORT="$(git rev-parse --short "$TARGET")"

echo ""
echo "== Rollback plan =="
echo "  Current HEAD:     $CURRENT_SHORT"
echo "  Rollback source:  $TARGET_SHORT"
echo "  File:             $FILE"
echo ""
echo "== Commit at rollback source =="
git log -1 --oneline "$TARGET"
echo ""

# Show diff summary
CURRENT_SIZE="$(git cat-file -s "HEAD:$FILE")"
TARGET_SIZE="$(git cat-file -s "$TARGET:$FILE")"
echo "== Size diff =="
echo "  Current:  ${CURRENT_SIZE} bytes"
echo "  Rollback: ${TARGET_SIZE} bytes"
echo ""

read -p "Proceed with rollback? [y/N] " confirm
if [ "${confirm:-N}" != "y" ] && [ "${confirm:-N}" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

# Perform the rollback: restore file from target commit
git checkout "$TARGET" -- "$FILE"

# Syntax-check before committing
echo ""
echo "== Syntax check on rolled-back file =="
if ! node --check "$FILE"; then
  echo ""
  echo "ERROR: the rolled-back file has a syntax error!" >&2
  echo "This shouldn't happen since it was previously deployed." >&2
  echo "Restoring original with: git checkout HEAD -- $FILE" >&2
  git checkout HEAD -- "$FILE"
  exit 6
fi
echo "  OK"

# Commit
git add "$FILE"
git commit -m "Revert $FILE to $TARGET_SHORT

Rolled back via scripts/rollback-hp-patches.sh from $CURRENT_SHORT.
Original commit at rollback source:
$(git log -1 --format='  %s (%h by %an, %ad)' --date=short "$TARGET")

To push this rollback:
  git push origin \$(git branch --show-current)
"

echo ""
echo "== Rollback complete =="
git log -1 --oneline
echo ""
echo "Push with:"
echo "  git push origin $(git branch --show-current)"
