# Vendored Python wheels

These `.whl` files are added directly to `sys.path` at the top of `fill_pdf.py`
via Python's built-in `zipimport`. **Do not unzip them.**

## Why vendor

Railway cold-starts and CI environments occasionally can't reach PyPI (or the
build-time `pip install` fails silently because the base image doesn't include
`pip`), and the old fallback that ran `pip install` at runtime turned every
first-request-after-deploy into an installer race with an unwritable
filesystem. Vendoring means the app has zero Python install-time dependencies
after `git clone`.

## Contents

| File | Version | Why | Size |
|------|---------|-----|------|
| `pypdf-*.whl` | 6.15.0 | AcroForm fill for Ontario court PDFs. Pure Python, zero deps. | ~378 KB |
| `typing_extensions-*.whl` | 4.16.0 | pypdf 6.x needs this only on Python < 3.11; harmless on newer. | ~45 KB |

## Refresh procedure

```bash
mkdir -p /tmp/wheels && cd /tmp/wheels
python3 -m pip download --no-deps --python-version 3.10 --platform any \
    --only-binary=:all: 'pypdf>=4.0.0,<7.0.0' 'typing_extensions>=4.0'
# Replace both files in this directory with the freshly downloaded wheels.
# Verify with:
python3 -c "import sys; sys.path.insert(0, 'pypdf-*.whl'); import pypdf; print(pypdf.__version__)"
```

## Compatibility

- pypdf 6.x needs Python **≥ 3.9**.
- Wheels are pure Python (`py3-none-any`), so they load unchanged on Linux,
  macOS, and Windows and on any CPython 3.9+.
