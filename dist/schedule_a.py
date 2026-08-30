#!/usr/bin/env python3
"""
Schedule A generator for Hearth & Page Form 8 filings.

Ontario Family Rules allow applicants to attach a Schedule to Form 8 when
the "Give details of the order that you want the court to make" box is
too small for the full parenting-plan narrative. This is standard family-
law practice and is expected by the court.

Reads the same {fieldKey, fieldValue} rows the fill_pdf.py pipeline uses,
and produces a single-page PDF with:

  - Header:  SCHEDULE A - Parenting Plan and Requested Order
  - Section: Applicant name, respondent name, generated date, case ref
  - Section: "Order requested"                 (otherParentTime)
  - Section: "Facts supporting this claim"     (childcareArrangements)
  - Footer:  Prepared with hearthandpage.ca. Filed with Form 8 (FLR 8).

Usage:
    python3 schedule_a.py OUT.pdf FORM_DATA.json

No external dependencies — the PDF is built by writing PDF 1.4 object
syntax directly. This keeps the deploy footprint identical (no new
vendor wheels needed).
"""

import json
import os
import sys
import glob
import textwrap
from datetime import datetime

# ── Vendored pypdf bootstrap ────────────────────────────────────────────
# Mirrors dist/fill_pdf.py so this script can find pypdf via the same
# wheel-extraction cache. pypdf is only needed when --append-to is used;
# stand-alone generation has no external deps.
_HERE = os.path.dirname(os.path.abspath(__file__))


def _wheel_needs_extract(whl_path):
    import zipfile
    try:
        with zipfile.ZipFile(whl_path) as zf:
            for name in zf.namelist():
                if name.endswith('.so') or name.endswith('.pyd'):
                    return True
    except Exception:
        return True
    return False


def _extract_wheel(whl_path, cache_root):
    import zipfile, hashlib
    key = hashlib.sha1(os.path.abspath(whl_path).encode()).hexdigest()[:12]
    target = os.path.join(cache_root, os.path.basename(whl_path) + '.' + key)
    marker = os.path.join(target, '.hp_ok')
    if os.path.isfile(marker):
        return target
    os.makedirs(target, exist_ok=True)
    with zipfile.ZipFile(whl_path) as zf:
        zf.extractall(target)
    with open(marker, 'w') as f:
        f.write(whl_path)
    return target


_CACHE_ROOT = os.environ.get('HP_VENDOR_CACHE') or os.path.join(
    (os.environ.get('TMPDIR') or '/tmp'), 'hp_vendor_cache'
)

for _candidate in (
    os.path.join(_HERE, 'vendor'),
    os.path.join(_HERE, '..', 'vendor'),
):
    _candidate = os.path.abspath(_candidate)
    if not os.path.isdir(_candidate):
        continue
    for _whl in sorted(glob.glob(os.path.join(_candidate, '*.whl'))):
        try:
            if _wheel_needs_extract(_whl):
                _extracted = _extract_wheel(_whl, _CACHE_ROOT)
                if _extracted not in sys.path:
                    sys.path.insert(0, _extracted)
            else:
                if _whl not in sys.path:
                    sys.path.insert(0, _whl)
        except Exception as _ve:
            sys.stderr.write('[schedule_a][vendor] failed to load {}: {}\n'
                             .format(_whl, _ve))

# ── Page geometry (US Letter, 72 dpi) ───────────────────────────────────
PAGE_W = 612
PAGE_H = 792
MARGIN_L = 54          # 0.75"
MARGIN_R = 54
MARGIN_TOP = 54
MARGIN_BOT = 72

FONT_BODY = 'Helvetica'
FONT_BOLD = 'Helvetica-Bold'
FONT_ITALIC = 'Helvetica-Oblique'
SIZE_TITLE = 16
SIZE_H2 = 12
SIZE_BODY = 11
SIZE_SMALL = 9
LEADING_BODY = 14.5


# ── Content stream helpers ──────────────────────────────────────────────
def _pdf_string(s):
    """Escape a Python str into a PDF literal string (WinAnsi-compatible)."""
    out = []
    for ch in s:
        code = ord(ch)
        if ch == '(':
            out.append('\\(')
        elif ch == ')':
            out.append('\\)')
        elif ch == '\\':
            out.append('\\\\')
        elif 32 <= code < 127:
            out.append(ch)
        elif code < 256:
            # WinAnsi covers Latin-1 accented characters
            out.append('\\%03o' % code)
        else:
            # Best-effort transliteration for Unicode outside Latin-1
            replacements = {
                0x2010: '-',   # hyphen
                0x2011: '-',   # non-breaking hyphen
                0x2012: '-',   # figure dash
                0x2013: '-',   # en-dash
                0x2014: '--',  # em-dash
                0x2015: '--',  # horizontal bar
                0x2018: "'",   # left single quote
                0x2019: "'",   # right single quote (also used as apostrophe)
                0x201A: "'",   # low single quote
                0x201C: '"',   # left double quote
                0x201D: '"',   # right double quote
                0x201E: '"',   # low double quote
                0x2022: '·',   # bullet -> middle dot (WinAnsi 0xB7)
                0x2026: '...', # ellipsis
                0x00A0: ' ',   # nbsp
            }
            repl = replacements.get(code, '?')
            for r in repl:
                out.append(r)
    return '(' + ''.join(out) + ')'


class Stream:
    def __init__(self):
        self.ops = []
        self.y = PAGE_H - MARGIN_TOP

    def text(self, x, y, s, font=FONT_BODY, size=SIZE_BODY):
        self.ops.append('BT')
        self.ops.append('/F-%s %d Tf' % (font, size))
        self.ops.append('%.2f %.2f Td' % (x, y))
        self.ops.append('%s Tj' % _pdf_string(s))
        self.ops.append('ET')

    def multiline(self, x, s, font=FONT_BODY, size=SIZE_BODY,
                  leading=LEADING_BODY, wrap_at=90):
        for para in str(s).split('\n'):
            if not para.strip():
                self.y -= leading * 0.6
                continue
            lines = textwrap.wrap(
                para, width=wrap_at,
                break_long_words=False,
                break_on_hyphens=False,
                replace_whitespace=False,
            ) or ['']
            for line in lines:
                if self.y < MARGIN_BOT + 30:
                    # Truncation guard — cheap ellipsis, prevents page overflow
                    self.text(x, self.y, '(narrative continues; see full copy on file)',
                              font=FONT_ITALIC, size=SIZE_SMALL)
                    self.y -= leading
                    return
                self.text(x, self.y, line, font=font, size=size)
                self.y -= leading
            self.y -= leading * 0.15

    def hline(self, y):
        self.ops.append('q')
        self.ops.append('0.5 w')
        self.ops.append('%d %.2f m' % (MARGIN_L, y))
        self.ops.append('%d %.2f l' % (PAGE_W - MARGIN_R, y))
        self.ops.append('S')
        self.ops.append('Q')

    def gap(self, amount):
        self.y -= amount

    def bytes(self):
        return ('\n'.join(self.ops)).encode('latin-1', errors='replace')


# ── Data extraction ─────────────────────────────────────────────────────
def _first(d, keys):
    for k in keys:
        v = d.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ''


def _flatten_rows(rows):
    if isinstance(rows, dict):
        return rows
    out = {}
    # Collect duplicates in order — needed for applicant vs respondent
    # when both come through as bare `fullName` (wizard snapshots without
    # section markers). Preserve positional lookup as `__ordered__`.
    ordered = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        k = row.get('fieldKey') or row.get('field_key') or ''
        v = row.get('fieldValue', row.get('field_value', ''))
        if k:
            ordered.append((k, v))
            out[k] = v      # Last write wins for the flat dict
    out['__ordered__'] = ordered
    return out


def _compose_stream(flat):
    s = Stream()

    # Title
    s.text(MARGIN_L, PAGE_H - MARGIN_TOP,
           'SCHEDULE A - Parenting Plan and Requested Order',
           font=FONT_BOLD, size=SIZE_TITLE)
    s.y = PAGE_H - MARGIN_TOP - SIZE_TITLE - 6
    s.hline(s.y)
    s.gap(18)

    # Case reference block. Prefer explicit prefixed keys (produced by
    # the JS adapter when the wizard tags sections). Fall back to bare
    # `fullName` occurrences by position (first = applicant, second =
    # respondent) for wizard snapshots that don't include sections.
    applicant = _first(flat, [
        'applicant_full_name', 'applicantFullName',
        'applicant_name', 'applicantName',
    ])
    respondent = _first(flat, [
        'respondent_full_name', 'respondentFullName',
        'respondent_name', 'respondentName',
    ])

    if not applicant or not respondent:
        # Walk the ordered list for bare fullName duplicates
        bare_names = [
            v.strip() for k, v in flat.get('__ordered__', [])
            if k in ('fullName', 'full_name') and isinstance(v, str) and v.strip()
        ]
        if not applicant and len(bare_names) >= 1:
            applicant = bare_names[0]
        if not respondent and len(bare_names) >= 2:
            respondent = bare_names[1]

    applicant = applicant or 'Applicant'
    respondent = respondent or 'Respondent'

    case_file = _first(flat, [
        'court_file_number', 'courtFileNumber',
        'file_number', 'fileNumber',
    ]) or '(to be assigned)'
    today = datetime.now().strftime('%B %d, %Y')

    # Aug 29 2026: Include separation date in the Schedule A header when
    # available. On non-divorce filings the separation date is suppressed
    # from Form 8 page 5 (see fill_pdf.py BUG-F8-DIVORCE-SECTION-01), but
    # it remains legally relevant context for the parenting plan, so we
    # surface it here.
    sep_date_val = _first(flat, [
        'separation_date', 'separationDate',
        'situation_separation_date', 'situationSeparationDate',
    ])

    header_rows = [
        ('Applicant:', applicant),
        ('Respondent:', respondent),
        ('Court file number:', case_file),
        ('Prepared:', today),
    ]
    if sep_date_val:
        header_rows.insert(3, ('Separation date:', str(sep_date_val).strip()))

    for label, value in header_rows:
        s.text(MARGIN_L, s.y, label, font=FONT_BOLD, size=SIZE_BODY)
        s.text(MARGIN_L + 130, s.y, value, font=FONT_BODY, size=SIZE_BODY)
        s.gap(LEADING_BODY)
    s.gap(6)
    s.hline(s.y)
    s.gap(16)

    # Section 1: Order requested
    order_text = _first(flat, [
        'otherParentTime', 'other_parent_time',
        'childrenPlan_otherParentTime', 'children_plan_other_parent_time',
        'f351_plan_otherParentTime', 'f351_plan_other_parent_time',
        'situationSummary', 'situation_summary',
        'claimOtherDetails', 'claim_other_details',
    ]) or '(Not provided.)'

    s.text(MARGIN_L, s.y, '1. Order requested', font=FONT_BOLD, size=SIZE_H2)
    s.gap(LEADING_BODY)
    s.multiline(MARGIN_L, order_text)
    s.gap(10)

    # Section 2: Supporting facts
    facts_text = _first(flat, [
        'childcareArrangements', 'childcare_arrangements',
        'childrenPlan_childcareArrangements',
        'children_plan_childcare_arrangements',
        'f351_plan_childcareArrangements',
        'f351_plan_childcare_arrangements',
        'factsLegalBasis', 'facts_legal_basis',
    ]) or ''
    if facts_text and s.y > MARGIN_BOT + 60:
        s.text(MARGIN_L, s.y, '2. Facts supporting this claim',
               font=FONT_BOLD, size=SIZE_H2)
        s.gap(LEADING_BODY)
        s.multiline(MARGIN_L, facts_text)

    # Footer
    s.hline(MARGIN_BOT - 18)
    footer = 'Prepared with hearthandpage.ca. Filed with Form 8 (FLR 8).'
    s.text(MARGIN_L, MARGIN_BOT - 32, footer,
           font=FONT_ITALIC, size=SIZE_SMALL)

    return s.bytes()


# ── Raw-bytes PDF assembler ─────────────────────────────────────────────
def build_schedule_a_bytes(rows):
    """
    Return a complete Schedule A PDF as bytes.
    """
    flat = _flatten_rows(rows)
    content_stream = _compose_stream(flat)

    # Object plan:
    #   1 = Catalog
    #   2 = Pages
    #   3 = Page (references 4 for Contents, 5-7 for fonts)
    #   4 = Content stream
    #   5 = Font Helvetica
    #   6 = Font Helvetica-Bold
    #   7 = Font Helvetica-Oblique
    objects = {}

    objects[1] = b'<< /Type /Catalog /Pages 2 0 R >>'
    objects[2] = b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
    objects[3] = (
        b'<< /Type /Page /Parent 2 0 R '
        b'/MediaBox [0 0 %d %d] '
        b'/Contents 4 0 R '
        b'/Resources << /Font << '
        b'/F-Helvetica 5 0 R '
        b'/F-Helvetica-Bold 6 0 R '
        b'/F-Helvetica-Oblique 7 0 R '
        b'>> >> '
        b'>>'
    ) % (PAGE_W, PAGE_H)
    objects[4] = (
        b'<< /Length %d >>\nstream\n' % len(content_stream)
        + content_stream
        + b'\nendstream'
    )
    for i, base in enumerate([FONT_BODY, FONT_BOLD, FONT_ITALIC], start=5):
        objects[i] = (
            b'<< /Type /Font /Subtype /Type1 '
            b'/BaseFont /%s /Encoding /WinAnsiEncoding >>'
        ) % base.encode('ascii')

    # Serialize with cross-reference table
    out = bytearray()
    out += b'%PDF-1.4\n'
    out += b'%\xe2\xe3\xcf\xd3\n'  # binary marker
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += b'%d 0 obj\n' % num
        out += objects[num]
        out += b'\nendobj\n'

    xref_offset = len(out)
    out += b'xref\n'
    out += b'0 %d\n' % (len(objects) + 1)
    out += b'0000000000 65535 f \n'
    for num in sorted(offsets):
        out += b'%010d 00000 n \n' % offsets[num]

    out += b'trailer\n<< /Size %d /Root 1 0 R >>\n' % (len(objects) + 1)
    out += b'startxref\n%d\n' % xref_offset
    out += b'%%EOF\n'
    return bytes(out)


def build_schedule_a(rows, output_path):
    pdf_bytes = build_schedule_a_bytes(rows)
    with open(output_path, 'wb') as f:
        f.write(pdf_bytes)


def append_schedule_a_to(base_pdf_path, output_path, rows):
    """
    Read the filled Form 8 at `base_pdf_path`, append a Schedule A page
    generated from `rows`, and write the combined PDF to `output_path`.

    Uses pypdf for the concatenation. The vendor bootstrap block at the
    top of this file makes pypdf importable from the same wheel cache
    that fill_pdf.py uses.
    """
    from pypdf import PdfReader, PdfWriter
    from io import BytesIO

    schedule_bytes = build_schedule_a_bytes(rows)
    schedule_reader = PdfReader(BytesIO(schedule_bytes))
    base_reader = PdfReader(base_pdf_path)

    writer = PdfWriter()
    for page in base_reader.pages:
        writer.add_page(page)
    for page in schedule_reader.pages:
        writer.add_page(page)
    with open(output_path, 'wb') as f:
        writer.write(f)


def main(argv):
    # Modes:
    #   schedule_a.py OUT.pdf FORM_DATA.json
    #       Write a stand-alone Schedule A PDF.
    #   schedule_a.py --append-to BASE.pdf OUT.pdf FORM_DATA.json
    #       Concatenate BASE + Schedule A into OUT.
    if len(argv) >= 5 and argv[1] == '--append-to':
        base_path = argv[2]
        out_path = argv[3]
        data_path = argv[4]
        with open(data_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        append_schedule_a_to(base_path, out_path, data)
        print('[schedule_a] appended to', out_path)
        return 0

    if len(argv) < 3:
        print('usage: schedule_a.py OUT.pdf FORM_DATA.json', file=sys.stderr)
        print('       schedule_a.py --append-to BASE.pdf OUT.pdf FORM_DATA.json',
              file=sys.stderr)
        return 2
    out_path = argv[1]
    data_path = argv[2]
    with open(data_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    build_schedule_a(data, out_path)
    print('[schedule_a] wrote', out_path)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
