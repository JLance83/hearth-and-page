#!/usr/bin/env python3
"""
scripts/unlock_pdfs.py - Strip empty-password encryption from bundled court PDFs.

Ontario court templates are "encrypted" with an empty user password — the
protection is a flag for Adobe Reader ("this is a form, don't edit the
layout"), not real crypto. But pypdf 6.x still calls into the `cryptography`
library to open them, which forces us to vendor a native-code dependency
chain (cryptography + cffi + pycparser) with per-Python-version wheels.

Running this script once in the repo produces unlocked templates. After that,
runtime pypdf can open them WITHOUT cryptography installed. Together with the
vendored pure-Python pypdf wheel under vendor/, this eliminates the entire
Python native-code surface at runtime.

The script prefers `qpdf --decrypt` (byte-for-byte lossless: 240 KB → 242 KB
typical) and only falls back to pypdf's writer round-trip when qpdf is not
available. The pypdf fallback inflates PDFs 2–4x because it expands
compressed cross-reference streams — use qpdf whenever possible.

Idempotent: skips files that are already unlocked.

Usage:
    python3 scripts/unlock_pdfs.py           # unlock dist/public/pdfs/*.pdf in place
    python3 scripts/unlock_pdfs.py --dry-run # report what would change
"""
import argparse
import glob
import os
import sys

# Bootstrap pypdf the same way fill_pdf.py does — from vendor/*.whl. Falls
# back to the system interpreter if nothing is vendored.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
_VENDOR = os.path.join(_ROOT, 'vendor')
if os.path.isdir(_VENDOR):
    for w in sorted(glob.glob(os.path.join(_VENDOR, '*.whl'))):
        if w not in sys.path:
            sys.path.insert(0, w)

import pypdf  # noqa: E402


import shutil
import subprocess

_QPDF = shutil.which('qpdf')


def _unlock_with_qpdf(path: str) -> None:
    tmp = path + '.tmp'
    subprocess.run(
        [_QPDF, '--decrypt', '--password=', path, tmp],
        check=True, capture_output=True,
    )
    os.replace(tmp, path)


def _unlock_with_pypdf(path: str) -> None:
    r = pypdf.PdfReader(path)
    r.decrypt('')
    writer = pypdf.PdfWriter(clone_from=r)
    # Newer pypdf exposes .encrypt() but no unencrypt(); we drop the
    # in-memory encryption state so writer.write() emits a plain PDF.
    if hasattr(writer, '_encryption'):
        writer._encryption = None
    tmp = path + '.tmp'
    with open(tmp, 'wb') as out:
        writer.write(out)
    os.replace(tmp, path)


def unlock_one(path: str, dry_run: bool = False) -> str:
    r = pypdf.PdfReader(path)
    if not r.is_encrypted:
        return 'skip'
    result = r.decrypt('')
    if result == pypdf.PasswordType.NOT_DECRYPTED:
        raise RuntimeError(f'{path}: empty password does NOT unlock this PDF')
    if dry_run:
        return 'would-unlock'

    if _QPDF:
        _unlock_with_qpdf(path)
    else:
        _unlock_with_pypdf(path)

    # Sanity: reopen with a fresh reader; if it is still encrypted, the
    # scrub above did not take effect — fail loudly rather than shipping a
    # file that will crash at runtime.
    verifier = pypdf.PdfReader(path)
    if verifier.is_encrypted:
        raise RuntimeError(
            f'{path}: unlock did not persist — file is still encrypted after rewrite'
        )
    return 'unlocked-qpdf' if _QPDF else 'unlocked-pypdf'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--dir', default='dist/public/pdfs',
                    help='directory of PDFs to unlock (default: dist/public/pdfs)')
    ap.add_argument('--dry-run', action='store_true',
                    help='report what would change, but do not modify files')
    args = ap.parse_args()

    target = os.path.join(_ROOT, args.dir) if not os.path.isabs(args.dir) else args.dir
    pdfs = sorted(glob.glob(os.path.join(target, '*.pdf')))
    if not pdfs:
        print(f'[unlock_pdfs] no PDFs found under {target}')
        return 1

    counts = {'unlocked-qpdf': 0, 'unlocked-pypdf': 0, 'skip': 0, 'would-unlock': 0}
    for p in pdfs:
        try:
            outcome = unlock_one(p, dry_run=args.dry_run)
        except Exception as e:
            print(f'  {os.path.basename(p):20} ERROR: {e}')
            return 1
        counts[outcome] += 1
        print(f'  {os.path.basename(p):20} {outcome}')

    print(f'\n[unlock_pdfs] done: {counts}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
