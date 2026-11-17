#!/usr/bin/env python3
"""
fill_pdf.py - Fill Ontario court PDF AcroForm fields with user data.
Called by the Node.js server as a child process.
Usage: python3 fill_pdf.py <input_pdf> <output_pdf> <json_data_file>
"""
import sys
import json
import os
import glob
from datetime import date

# ---------------------------------------------------------------------------
# Vendored dependencies (Aug 12 2026)
# ---------------------------------------------------------------------------
# pypdf and typing_extensions are shipped in `vendor/*.whl` and loaded via
# Python's built-in zipimport. This removes the previous cold-start behaviour
# that shelled out to `pip install pypdf` on the first PDF request — which
# failed on read-only Railway file systems and turned every fresh deploy into
# an installer race.
#
# `vendor/` sits alongside this file (repo root: fill_pdf.py + vendor/; also
# copied to dist/fill_pdf.py + dist/vendor/ if the build did that, but we look
# in both spots either way). See vendor/README.md for refresh instructions.
_HERE = os.path.dirname(os.path.abspath(__file__))

# FIX-FILLER-VERSION: bump on each filler change; reported by --self-check
# (and therefore by /api/pdf-runtime-check).
FILLER_VERSION = 'dist-2026-10-19.69'

def _wheel_needs_extract(whl_path):
    # Wheels with compiled C extensions (.so / .pyd) cannot be zipimported —
    # Python's dynamic-library loader has to open a real file on disk. Pure-
    # Python wheels are fine on sys.path as-is.
    import zipfile
    try:
        with zipfile.ZipFile(whl_path) as zf:
            for name in zf.namelist():
                if name.endswith('.so') or name.endswith('.pyd'):
                    return True
    except Exception:
        # If we can't read it, extract to be safe.
        return True
    return False

def _extract_wheel(whl_path, cache_root):
    # Extract once into a stable per-wheel cache dir (idempotent: reuse if
    # complete). Returns the extracted directory path.
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
            # Never let vendor discovery crash startup — pypdf will surface
            # the DependencyError later if a required wheel is missing.
            sys.stderr.write(f'[vendor] failed to load {_whl}: {_ve}\n')

try:
    import pypdf
    from pypdf import PdfWriter, PdfReader
    import pypdf.generic as g
except ImportError as _e:
    sys.stderr.write(
        f"[fill_pdf] pypdf could not be loaded from vendor/*.whl or the system\n"
        f"           interpreter. Import error: {_e}\n"
        f"           Expected wheels under: {os.path.join(_HERE, 'vendor')}\n"
    )
    sys.exit(1)

def format_phone(raw):
    if not raw:
        return ''
    digits = ''.join(c for c in str(raw) if c.isdigit())
    if len(digits) == 10:
        return f'({digits[:3]}) {digits[3:6]}-{digits[6:]}'
    return raw

def format_dob(raw):
    """'1985-06-15' -> '15/06/1985'"""
    if not raw:
        return ''
    parts = raw.split('-')
    if len(parts) == 3:
        return f'{parts[2]}/{parts[1]}/{parts[0]}'
    return raw

def calc_age(dob_raw):
    if not dob_raw:
        return ''
    try:
        parts = dob_raw.split('-')
        birth = date(int(parts[0]), int(parts[1]), int(parts[2]))
        today = date.today()
        age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
        return str(age)
    except:
        return ''

# FIX-UNIT-NA: the wizard's Unit box is often answered "N/A" / "none" by
# people who have no unit. Treat those as blank so PDFs never print
# "Unit N/A, 3674 Mark St".
_NO_UNIT = {'n/a', 'na', 'n.a.', 'n.a', 'none', 'nil', 'null', 'no', '-', '\u2013', '\u2014', 'not applicable'}

def _real_unit(unit):
    u = str(unit or '').strip()
    return '' if u.lower() in _NO_UNIT else u

# FIX-F13-AMOUNT-SPLIT: Form 13 asset/debt wizard boxes ask for one item per
# line, "start with the value" (e.g. "28000 — 2019 Ford F-150",
# "5000 (2015 Infiniti Q50)", "$4,100.50 KOHO Line Of Credit").
import re as _re_amt
_AMT_LINE = _re_amt.compile(r'^\s*\$?\s*(-?\d[\d,]*(?:\.\d+)?)\s*\$?\s*(?:[-\u2013\u2014:,=]\s*)?(.*)$')
_DOLLAR_ANY = _re_amt.compile(r'\$\s*(-?\d[\d,]*(?:\.\d+)?)')

def _amount_lines(text):
    """Split a multi-line "amount + description" answer into
    [(amount '1234.00' or '', description), ...]. Blank and N/A lines are
    skipped. A leading 4-digit year followed by words ("2015 Infiniti") is
    NOT read as money unless no other amount exists AND it has a $ sign:
    if the line has a $-amount elsewhere, that is used; otherwise the line
    is kept as description with no amount (blank is safer than wrong)."""
    out = []
    for raw in str(text or '').split('\n'):
        ln = raw.strip()
        if not ln or ln.upper() in ('N/A', 'NA', 'NONE', '-'):
            continue
        amt, desc = '', ln
        m = _AMT_LINE.match(ln)
        if m:
            num, rest = m.group(1), m.group(2).strip()
            looks_year = (_re_amt.fullmatch(r'(19|20)\d\d', num) is not None
                          and not ln.lstrip().startswith('$')
                          and rest[:1].isalpha())
            if looks_year:
                d2 = _DOLLAR_ANY.search(ln)
                if d2:
                    amt = d2.group(1)
                    desc = (ln[:d2.start()] + ln[d2.end():]).strip(' -\u2013\u2014:,')
            else:
                amt, desc = num, rest
        if desc.startswith('(') and desc.endswith(')'):
            desc = desc[1:-1].strip()
        if amt:
            try:
                amt = f"{float(amt.replace(',', '')):.2f}"
            except ValueError:
                amt = ''
        out.append((amt, desc))
    return out


def _rows3(entries):
    """Fit entries into the PDF's 3 rows; extra lines are merged into row 3
    (descriptions joined, amounts added) so nothing is silently dropped."""
    if len(entries) <= 3:
        return entries
    extra = entries[2:]
    tot = sum(float(a) for a, _ in extra if a)
    return entries[:2] + [(f'{tot:.2f}' if tot else '', '; '.join(d for _, d in extra if d))]

def build_address(section):
    parts = []
    if section.get('address'): parts.append(section['address'])
    if _real_unit(section.get('unit')): parts.append(f"Unit {_real_unit(section.get('unit'))}")
    if section.get('city'): parts.append(section['city'])
    if section.get('province'): parts.append(section['province'])
    if section.get('postalCode'): parts.append(section['postalCode'])
    return ', '.join(parts)

COURTHOUSE_NAMES = {
    'toronto-university':  'Superior Court of Justice - Toronto (University Ave.)',
    'toronto-old':         'Ontario Court of Justice - Toronto (Old City Hall)',
    'toronto-311':         'Ontario Court of Justice - Toronto (311 Jarvis)',
    'north-york':          'Ontario Court of Justice - North York',
    'scarborough':         'Ontario Court of Justice - Scarborough',
    'etobicoke':           'Ontario Court of Justice - Etobicoke',
    'ottawa':              'Superior Court of Justice - Ottawa',
    'hamilton':            'Superior Court of Justice - Hamilton',
    'london':              'Superior Court of Justice - London',
    'kitchener':           'Superior Court of Justice - Kitchener',
    'windsor':             'Superior Court of Justice - Windsor',
    'barrie':              'Superior Court of Justice - Barrie',
    'oshawa':              'Superior Court of Justice - Oshawa',
    'brampton':            'Superior Court of Justice - Brampton',
    'newmarket':           'Superior Court of Justice - Newmarket',
    'kingston':            'Superior Court of Justice - Kingston',
    'thunder-bay':         'Superior Court of Justice - Thunder Bay',
    'sudbury':             'Superior Court of Justice - Sudbury',
}

COURTHOUSE_ADDRESSES = {
    'toronto-university': '393 University Ave, Toronto, ON M5G 1E6',
    'toronto-old':        '60 Queen St W, Toronto, ON M5H 2M3',
    'toronto-311':        '311 Jarvis St, Toronto, ON M5B 2C4',
    'north-york':         '1000 Finch Ave W, Toronto, ON M3J 2V5',
    'scarborough':        '1530 Markham Rd, Scarborough, ON M1B 3G4',
    'etobicoke':          '2200 Islington Ave, Etobicoke, ON M9W 3W8',
    'ottawa':             '161 Elgin St, Ottawa, ON K2P 2K1',
    'hamilton':           '45 Main St E, Hamilton, ON L8N 2B7',
    'london':             '80 Dundas St, London, ON N6A 6A3',
    'kitchener':          '85 Frederick St, Kitchener, ON N2H 0A7',
    'windsor':            '245 Windsor Ave, Windsor, ON N9A 1J2',
    'barrie':             '75 Mulcaster St, Barrie, ON L4M 3P2',
    'oshawa':             '150 Bond St E, Oshawa, ON L1G 0A2',
    'brampton':           '7755 Hurontario St, Brampton, ON L6W 4T6',
    'newmarket':          '50 Eagle St W, Newmarket, ON L3Y 6B1',
    'kingston':           '5 Court St, Kingston, ON K7L 2N4',
    'thunder-bay':        '277 Camelot St, Thunder Bay, ON P7A 4B3',
    'sudbury':            '155 Elm St, Sudbury, ON P3C 1T9',
}

def build_field_values(form_data_list):
    """Build a dict of {pdf_field_name: value} from the form_data list."""
    d = {}
    for row in form_data_list:
        sec = row.get('section', '')
        key = row.get('fieldKey', '')
        val = row.get('fieldValue', '')
        if sec not in d:
            d[sec] = {}
        d[sec][key] = val

    ap = d.get('applicant', {})
    re = d.get('respondent', {})
    ct = d.get('court', {})
    ma = d.get('marriage', {})
    ch = d.get('children', {})
    claims = d.get('claims', {})
    order_details = d.get('orderDetails', {})

    courthouse_key = ct.get('courthouse', '')
    courthouse_name = COURTHOUSE_NAMES.get(courthouse_key, courthouse_key)
    courthouse_address = COURTHOUSE_ADDRESSES.get(courthouse_key, '')
    court_file_number = ct.get('fileNumber', ct.get('courtFileNumber', ''))

    fields = {}

    # Court header
    fields['Name of court'] = courthouse_name
    fields['Court office address'] = courthouse_address
    fields['Court Address'] = courthouse_address

    for pg in range(1, 7):
        fields[f'Court File Number, page {pg}'] = court_file_number

    # Applicant contact
    fields['Applicant(s) - Full legal name'] = ap.get('fullName', '')
    fields['Applicant(s) - Address'] = build_address(ap)
    fields['Applicant(s) - Phone & fax'] = format_phone(ap.get('phone', ''))
    fields['Applicant(s) - Email'] = ap.get('email', '')

    # Applicant personal history
    fields['Age - applicant'] = calc_age(ap.get('dob'))
    fields['Birthdate: (d, m, y) - Applicant'] = format_dob(ap.get('dob'))
    fields['Municipality & province - applicant'] = ', '.join(filter(None, [ap.get('city'), ap.get('province')]))
    fields['Date - start of residency - applicant'] = ap.get('residencyDate', '')

    ap_name_parts = ap.get('fullName', '').split(' ')
    fields['First name on the day before the marriage date - applicant'] = ap.get('premarriageFirstName', ap_name_parts[0] if ap_name_parts else '')
    fields['Last name on the day before the marriage date - applicant'] = ap.get('premarriageLastName', ' '.join(ap_name_parts[1:]) if len(ap_name_parts) > 1 else '')
    fields['Place and date of previous divorce - applicant'] = ap.get('previousDivorce', '')

    # Respondent contact
    fields['Respondent(s) - Full legal name'] = re.get('fullName', '')
    fields['Respondent(s) - Address'] = build_address(re)
    fields['Respondent(s) - Phone & fax'] = format_phone(re.get('phone', ''))
    fields['Respondent(s) - Email'] = re.get('email', '')

    # Respondent personal history
    fields['Age - respondent'] = calc_age(re.get('dob'))
    fields['Birthdate: (d, m, y) - respondent'] = format_dob(re.get('dob'))
    fields['Municipality & province - respondent'] = ', '.join(filter(None, [re.get('city'), re.get('province')]))
    fields['Date - start of residency - respondent'] = re.get('residencyDate', '')

    re_name_parts = re.get('fullName', '').split(' ')
    fields['First name on the day before the marriage date - respondent'] = re.get('premarriageFirstName', re_name_parts[0] if re_name_parts else '')
    fields['Last name on the day before the marriage date - respondent'] = re.get('premarriageLastName', ' '.join(re_name_parts[1:]) if len(re_name_parts) > 1 else '')
    fields['Place and date of previous divorce - respondent'] = re.get('previousDivorce', '')

    # Marriage dates
    if ma.get('marriageDate'):
        fields['Date - Married on'] = ma['marriageDate']
    if ma.get('cohabitDate'):
        fields['Date - Started living together'] = ma['cohabitDate']
    if ma.get('separationDate'):
        fields['Date - Separated on'] = ma['separationDate']
        fields['Date - seperation'] = ma['separationDate']
    if ma.get('reconciliationDates'):
        fields['Dates - periods of living together'] = ma['reconciliationDates']
    if ma.get('adulteryDetails'):
        fields['Adultery - details'] = ma['adulteryDetails']
    if ma.get('crueltyDetails'):
        fields['Cruelty - details'] = ma['crueltyDetails']

    if order_details.get('details'):
        fields['Details of the order that you want the court to make'] = order_details['details']

    # Children
    child_keys = [k for k in ch.keys() if '_' in k]
    child_nums_raw = []
    for k in child_keys:
        part = k.split('_')[0]
        if part.startswith('child'):
            num = part[5:]
            if num.isdigit():
                child_nums_raw.append(num)
    child_nums = list(dict.fromkeys(child_nums_raw))

    for idx, num in enumerate(child_nums[:6]):
        i = idx + 1
        prefix = f'child{num}_'
        fields[f'Full legal name {i}'] = ch.get(f'{prefix}fullName', '')
        fields[f'Age {i}'] = calc_age(ch.get(f'{prefix}dob', ''))
        fields[f'Birthdate: (d, m, y) {i}'] = format_dob(ch.get(f'{prefix}dob', ''))
        fields[f'Resident in (municipality & province) {i}'] = ch.get(f'{prefix}municipality', ', '.join(filter(None, [ap.get('city'), ap.get('province')])))
        lw_field = f'Now Living With (name of person and relationship to child) {i if i < 5 else i+1}'
        fields[lw_field] = ch.get(f'{prefix}livingWith', '')

    # Checkboxes
    checkboxes = {}

    ap_gender = ap.get('gender', '').lower()
    if ap_gender == 'male': checkboxes['Male - applicant'] = True
    elif ap_gender == 'female': checkboxes['Female - applicant'] = True
    elif ap_gender in ('other', 'another'): checkboxes['Another gender - applicant'] = True
    if ap.get('previousMarriage') == 'yes': checkboxes['Yes - applicant'] = True
    elif ap.get('previousMarriage') == 'no': checkboxes['No - applicant'] = True

    re_gender = re.get('gender', '').lower()
    if re_gender == 'male': checkboxes['Male - respondent'] = True
    elif re_gender == 'female': checkboxes['Female - respondent'] = True
    elif re_gender in ('other', 'another'): checkboxes['Another gender - respondent'] = True
    if re.get('previousMarriage') == 'yes': checkboxes['Yes - respondent'] = True
    elif re.get('previousMarriage') == 'no': checkboxes['No - respondent'] = True

    if ma.get('marriageDate'): checkboxes['Married on'] = True
    if ma.get('cohabitDate'): checkboxes['Started living together on'] = True
    if ma.get('separationDate'): checkboxes['Separated on'] = True
    if ma.get('neverLived') == 'yes': checkboxes['Never lived together'] = True
    if ma.get('stillLiving') == 'yes': checkboxes['Still living together'] = True

    grounds = ma.get('divorceGrounds', '')
    if grounds == 'separation':
        checkboxes['Separation'] = True
        rec = ma.get('reconciliationAttempt', '')
        if rec == 'not-lived':
            checkboxes['have not lived together again since that date in an unsuccessful attempt to reconcile'] = True
        elif rec == 'lived':
            checkboxes['have lived together again during the following period(s) in an unsuccessful attempt to reconcile'] = True
    elif grounds == 'adultery': checkboxes['Adultery'] = True
    elif grounds == 'cruelty': checkboxes['Cruelty'] = True

    claim_map = {
        'divorce': 'a divorce',
        'annulment': 'annulment of marriage',
        'spousalSupport': 'indexing spousal support',
        'parentageDeclaration': 'declaration of parentage',
        'freezingAssets': 'freezing assets',
        'saleOfProperty': 'sale of family property',
        'costs': 'Costs',
        'prejudgmentInterest': 'prejudgment interest',
        'equalization': 'equalization of net family properties',
        'exclusivePossession': 'exclusive possession of matrimonial home',
        'exclusiveContents': 'exclusive possession of contents of matrimonial home',
        'restrainingOrder': 'restraining/non-harassment order',
        'contactWithChildren': 'contact with child(ren) (this does not require court leave)',
        'decisionMaking1': 'decision-making responsibility for child(ren) 1',
        'parentingTime1': 'parenting time with child(ren) 1',
        'childSupportTable1': 'support for child(ren) \u2013 table amount 1',
        'supportForMe1': 'support for me 1',
    }
    for key, field_name in claim_map.items():
        if claims.get(key) in ('yes', True, '1', 1):
            checkboxes[field_name] = True

    return fields, checkboxes


def fill_pdf(input_path, output_path, form_data_list):
    fields, checkboxes = build_field_values(form_data_list)

    reader = PdfReader(input_path)
    writer = PdfWriter()
    # clone_document_from_reader handles encrypted PDFs (requires cryptography lib)
    writer.clone_document_from_reader(reader)

    filled_count = 0

    for page in writer.pages:
        if '/Annots' not in page:
            continue
        for annot_ref in page['/Annots']:
            try:
                annot_obj = annot_ref.get_object()
            except Exception:
                continue
            if annot_obj.get('/Subtype') != '/Widget':
                continue

            field_name = annot_obj.get('/T')
            if not field_name and '/Parent' in annot_obj:
                try:
                    parent = annot_obj['/Parent'].get_object()
                    field_name = parent.get('/T')
                except:
                    pass

            if not field_name:
                continue
            fname = str(field_name)

            if fname in fields:
                val = str(fields[fname])
                annot_obj.update({
                    g.NameObject('/V'): g.create_string_object(val),
                    g.NameObject('/AP'): g.DictionaryObject(),
                })
                filled_count += 1
            elif fname in checkboxes:
                val = _checkbox_on_state(annot_obj) if checkboxes[fname] else '/Off'
                annot_obj.update({
                    g.NameObject('/V'): g.NameObject(val),
                    g.NameObject('/AS'): g.NameObject(val),
                })
                filled_count += 1

    # Tell PDF viewers to regenerate visual appearance from values
    if '/AcroForm' in writer._root_object:
        try:
            acroform = writer._root_object['/AcroForm']
            if hasattr(acroform, 'update'):
                acroform.update({g.NameObject('/NeedAppearances'): g.BooleanObject(True)})
        except:
            pass

    with open(output_path, 'wb') as f:
        writer.write(f)

    sys.stderr.write(f'[fill_pdf] Filled {filled_count} fields → {output_path}\n')
    return filled_count



# ─────────────────────────────────────────────────────────────────────────────
# FormEngine-aware fill for Form 8 (Application General)
# FormEngine saves data as flat {fieldKey: value} rows (section='form' or stepId)
# This function reads those flat keys and maps them to AcroForm field names.
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Courthouse lookups (FormEngine values)
#
# The intake picker has changed shape twice:
#   v1 (legacy):  slug only            → 'sudbury', 'toronto-university'
#   v2 (legacy):  slug + court suffix   → 'sudbury-ocj', 'sudbury-scj'
#   v3 (current): full display string   → 'Sudbury — Superior Court of Justice'
#
# All three must resolve to a canonical Ontario courthouse name & address, or
# the header on every generated PDF is blank (D1/D2 audit finding, Aug 12 2026).
# ─────────────────────────────────────────────────────────────────────────────

# (slug, city_display, scj_address, ocj_address)
# Any city missing an OCJ family courthouse still lists SCJ address as fallback.
_ON_COURTHOUSES = [
    ('barrie',         'Barrie',         '75 Mulcaster St, Barrie, ON L4M 3P2',              '75 Mulcaster St, Barrie, ON L4M 3P2'),
    ('brampton',       'Brampton',       '7755 Hurontario St, Brampton, ON L6W 4T6',         '7755 Hurontario St, Brampton, ON L6W 4T6'),
    ('brantford',      'Brantford',      '70 Wellington St, Brantford, ON N3T 2L9',          '70 Wellington St, Brantford, ON N3T 2L9'),
    ('cornwall',       'Cornwall',       '29 Second St W, Cornwall, ON K6J 1G6',             '29 Second St W, Cornwall, ON K6J 1G6'),
    ('etobicoke',      'Etobicoke',      '2201 Finch Ave W, Etobicoke, ON M9M 2Y9',          '2201 Finch Ave W, Etobicoke, ON M9M 2Y9'),
    ('hamilton',       'Hamilton',       '45 Main St E, Hamilton, ON L8N 2B7',               '45 Main St E, Hamilton, ON L8N 2B7'),
    ('kingston',       'Kingston',       '5 Court St, Kingston, ON K7L 2N4',                 '5 Court St, Kingston, ON K7L 2N4'),
    ('kitchener',      'Kitchener',      '85 Frederick St, Kitchener, ON N2H 0A7',           '85 Frederick St, Kitchener, ON N2H 0A7'),
    ('london',         'London',         '80 Dundas St, London, ON N6A 6A3',                 '80 Dundas St, London, ON N6A 6A3'),
    ('milton',         'Milton',         '491 Steeles Ave E, Milton, ON L9T 1Y7',            '491 Steeles Ave E, Milton, ON L9T 1Y7'),
    ('newmarket',      'Newmarket',      '50 Eagle St W, Newmarket, ON L3Y 6B1',             '50 Eagle St W, Newmarket, ON L3Y 6B1'),
    ('north-york',     'North York',     '47 Sheppard Ave E, North York, ON M2N 5N1',        '47 Sheppard Ave E, North York, ON M2N 5N1'),
    ('oshawa',         'Oshawa',         '150 Bond St E, Oshawa, ON L1G 0A2',                '150 Bond St E, Oshawa, ON L1G 0A2'),
    ('ottawa',         'Ottawa',         '161 Elgin St, Ottawa, ON K2P 2K1',                 '161 Elgin St, Ottawa, ON K2P 2K1'),
    ('peterborough',   'Peterborough',   '470 Water St, Peterborough, ON K9H 3M3',           '470 Water St, Peterborough, ON K9H 3M3'),
    ('scarborough',    'Scarborough',    '1911 Eglinton Ave E, Scarborough, ON M1L 4P4',     '1911 Eglinton Ave E, Scarborough, ON M1L 4P4'),
    ('st-catharines',  'St. Catharines', '59 Church St, St. Catharines, ON L2R 7N8',         '59 Church St, St. Catharines, ON L2R 7N8'),
    ('sudbury',        'Sudbury',        '155 Elm St, Sudbury, ON P3C 1T9',                  '155 Elm St, Sudbury, ON P3C 1T9'),
    ('thunder-bay',    'Thunder Bay',    '277 Camelot St, Thunder Bay, ON P7A 4B3',          '277 Camelot St, Thunder Bay, ON P7A 4B3'),
    ('toronto',        'Toronto',        '393 University Ave, Toronto, ON M5G 1E6',          '60 Queen St W, Toronto, ON M5H 2M3'),
    ('windsor',        'Windsor',        '245 Windsor Ave, Windsor, ON N9A 1J2',             '245 Windsor Ave, Windsor, ON N9A 1J2'),
]

def _build_courthouse_tables():
    names, addrs = {}, {}
    for slug, city, scj_addr, ocj_addr in _ON_COURTHOUSES:
        scj_name = f'Superior Court of Justice - {city}'
        ocj_name = f'Ontario Court of Justice - {city}'
        # bare slug → default SCJ
        names[slug] = scj_name
        addrs[slug] = scj_addr
        # slug + court suffix (v2 picker)
        names[f'{slug}-scj'] = scj_name
        addrs[f'{slug}-scj'] = scj_addr
        names[f'{slug}-ocj'] = ocj_name
        addrs[f'{slug}-ocj'] = ocj_addr
        # v3 display strings (from hp-patches.js current picker)
        names[f'{city} \u2014 Superior Court of Justice'] = scj_name
        addrs[f'{city} \u2014 Superior Court of Justice'] = scj_addr
        names[f'{city} \u2014 Ontario Court of Justice']  = ocj_name
        addrs[f'{city} \u2014 Ontario Court of Justice']  = ocj_addr
        # canonical name → address
        addrs[scj_name] = scj_addr
        addrs[ocj_name] = ocj_addr
    return names, addrs

COURTHOUSE_NAMES_FE, COURTHOUSE_ADDRESSES_FE = _build_courthouse_tables()

# Legacy explicit entries kept for back-compat with any older DB rows
COURTHOUSE_NAMES_FE.update({
    'Ontario Court of Justice': 'Ontario Court of Justice',
    'Superior Court of Justice': 'Superior Court of Justice',
    'Superior Court of Justice (Family Court Branch)': 'Superior Court of Justice (Family Court Branch)',
    'toronto-university':  'Superior Court of Justice - Toronto (393 University Ave.)',
    'toronto-old':         'Ontario Court of Justice - Toronto (Old City Hall)',
})
COURTHOUSE_ADDRESSES_FE.update({
    'Superior Court of Justice': '393 University Ave, Toronto, ON M5G 1E6',
    'Ontario Court of Justice':  '60 Queen St W, Toronto, ON M5H 2M3',
    'Superior Court of Justice (Family Court Branch)': '393 University Ave, Toronto, ON M5G 1E6',
    'toronto-university': '393 University Ave, Toronto, ON M5G 1E6',
    'toronto-old':        '60 Queen St W, Toronto, ON M5H 2M3',
})

# ─── React picker (frontend rg[] array) IDs — 64 courthouses ─────────────
# The React bundle ships a rich per-courthouse list with compound IDs (e.g.
# "toronto-university", "sudbury-ocj", "brampton-scj-family"). These IDs are
# what the wizard writes into cases.form_data.courthouse. Prior to this
# extension, only "toronto-university" existed here (with a mistranslated
# entry pointing to 393 University Ave — actually the "toronto-361" address).
# This block overrides and completes the lookup so PDFs render the correct
# courthouse name and address for every picker option.
# FIX-UFC-COURT-NAME: the 25 Family Court Branch sites (Unified Family
# Court) print the court's name as it appears on court documents there,
# "Superior Court of Justice Family Court" (was "Family Court Branch –
# <street>", which is not the court's name; the street is already in the
# court address box).
COURTHOUSE_NAMES_FE.update({
    'toronto-university': 'Ontario Court of Justice – 311 Jarvis',
    'toronto-361': 'Superior Court of Justice – 361 University Ave',
    'toronto-393': 'Superior Court of Justice – 393 University Ave',
    'toronto-47-sheppard': 'Ontario Court of Justice – 47 Sheppard Ave E',
    'toronto-finch': 'Ontario Court of Justice – 2201 Finch Ave W',
    'toronto-jarvis': 'Ontario Court of Justice – 10 Armoury Street',
    'barrie': 'Superior Court of Justice Family Court',
    'bracebridge': 'Superior Court of Justice Family Court',
    'cobourg': 'Superior Court of Justice Family Court',
    'durham-oshawa': 'Superior Court of Justice Family Court',
    'lindsay': 'Superior Court of Justice Family Court',
    'newmarket': 'Superior Court of Justice Family Court',
    'peterborough': 'Superior Court of Justice Family Court',
    'markham': 'Ontario Court of Justice – 8500 Leslie Street',
    'richmond-hill': 'Superior Court of Justice – 855 Major Mackenzie Drive E',
    'brantford': 'Superior Court of Justice – 44 Queen Street',
    'cayuga': 'Superior Court of Justice Family Court',
    'hamilton': 'Superior Court of Justice Family Court',
    'kitchener': 'Superior Court of Justice Family Court',
    'simcoe': 'Superior Court of Justice Family Court',
    'st-catharines': 'Superior Court of Justice Family Court',
    'welland': 'Superior Court of Justice Family Court',
    'brampton': 'Ontario Court of Justice – 7755 Hurontario Street',
    'brampton-scj': 'Superior Court of Justice – 7765 Hurontario Street',
    'burlington': 'Ontario Court of Justice – 2021 Plains Road E',
    'guelph': 'Superior Court of Justice – 74 Woolwich Street',
    'milton': 'Superior Court of Justice – 491 Steeles Avenue E',
    'orangeville': 'Superior Court of Justice – 10 Louisa Street',
    'owen-sound': 'Superior Court of Justice – 611 9th Avenue E',
    'walkerton': 'Superior Court of Justice – 207 Cayley Street',
    'belleville': 'Superior Court of Justice Family Court',
    'brockville': 'Superior Court of Justice Family Court',
    'cornwall': 'Superior Court of Justice Family Court',
    'kingston': 'Superior Court of Justice Family Court',
    'lorignal': 'Superior Court of Justice Family Court',
    'napanee': 'Superior Court of Justice Family Court',
    'ottawa': 'Superior Court of Justice Family Court',
    'pembroke': 'Superior Court of Justice Family Court',
    'perth': 'Superior Court of Justice Family Court',
    'picton': 'Superior Court of Justice Family Court',
    'north-bay': 'Superior Court of Justice – 360 Plouffe Street',
    'parry-sound': 'Superior Court of Justice – 89 James Street',
    'sault-ste-marie': 'Superior Court of Justice – 426 Queen Street E',
    'sudbury': 'Superior Court of Justice – 155 Elm Street',
    'sudbury-ocj': 'Ontario Court of Justice – 159 Cedar Street',
    'timmins': 'Superior Court of Justice – 38 Pine Street N',
    'gore-bay': 'Superior Court of Justice – 27 Phipps Street',
    'haileybury': 'Superior Court of Justice – 393 Main Street',
    'espanola': 'Ontario Court of Justice – 100 Tudhope Street',
    'elliot-lake': 'Ontario Court of Justice – 200 Ontario Avenue',
    'fort-frances': 'Superior Court of Justice – 333 Church Street',
    'kenora': 'Superior Court of Justice – 216 Water Street',
    'thunder-bay': 'Superior Court of Justice – 125 Brodie Street N',
    'dryden': 'Ontario Court of Justice – 479 Government Street',
    'sioux-lookout': 'Ontario Court of Justice – 18 4th Avenue S',
    'chatham': 'Superior Court of Justice – 425 Grand Ave W',
    'goderich': 'Superior Court of Justice – 1 Courthouse Square',
    'london': 'Superior Court of Justice Family Court',
    'sarnia': 'Superior Court of Justice – 700 N. Christina Street',
    'st-thomas': 'Superior Court of Justice Family Court',
    'stratford': 'Superior Court of Justice – 1 Huron Street',
    'windsor': 'Superior Court of Justice – 245 Windsor Avenue',
    'woodstock': 'Superior Court of Justice – 415 Hunter Street',
    'leamington': 'Ontario Court of Justice – 7 Clark Street West',
})
COURTHOUSE_ADDRESSES_FE.update({
    'toronto-university': '311 Jarvis Street, Toronto, Ontario, M5B 2C4',
    'toronto-361': '361 University Avenue, Toronto, Ontario, M5G 1T3',
    'toronto-393': '393 University Avenue, Toronto, Ontario, M5G 1E6',
    'toronto-47-sheppard': '47 Sheppard Avenue East, Toronto, Ontario, M2N 5X5',
    'toronto-finch': '2201 Finch Avenue West, Toronto, Ontario, M9M 2Y9',
    'toronto-jarvis': '10 Armoury Street, Toronto, Ontario, M5G 1T3',
    'barrie': '75 Mulcaster Street, Barrie, Ontario, L4M 3P2',
    'bracebridge': '3A Dominion Street, Bracebridge, Ontario, P1L 2E4',
    'cobourg': '860 William Street, Cobourg, Ontario, K9A 3A9',
    'durham-oshawa': '150 Bond Street East, Oshawa, Ontario, L1G 0A2',
    'lindsay': '440 Kent Street West, Lindsay, Ontario, K9V 3Z5',
    'newmarket': '50 Eagle Street West, Newmarket, Ontario, L3Y 6B1',
    'peterborough': '470 Water Street, Peterborough, Ontario, K9H 3M3',
    'markham': '8500 Leslie Street, Suite 395, Markham, Ontario, L3T 7M8',
    'richmond-hill': '855 Major Mackenzie Drive East, Richmond Hill, Ontario, L4C 4V6',
    'brantford': '44 Queen Street, Brantford, Ontario, N3T 3B6',
    'cayuga': '55 Munsee Street North, Cayuga, Ontario, N0A 1E0',
    'hamilton': '55 Main Street West, Hamilton, Ontario, L8P 1H4',
    'kitchener': '85 Frederick Street, Kitchener, Ontario, N2H 0A7',
    'simcoe': 'Suite 301, 50 Frederick Hobson VC Drive, Simcoe, Ontario, N3Y 0B8',
    'st-catharines': '59 Church Street, St. Catharines, Ontario, L2R 3C4',
    'welland': '102 East Main Street, Welland, Ontario, L3B 3X1',
    'brampton': '7755 Hurontario Street, Brampton, Ontario, L6W 4T6',
    'brampton-scj': '7765 Hurontario Street, Brampton, Ontario, L6W 4T6',
    'burlington': '2021 Plains Road East, Burlington, Ontario, L7R 3Z3',
    'guelph': '74 Woolwich Street, Guelph, Ontario, N1H 3T9',
    'milton': '491 Steeles Avenue East, Milton, Ontario, L9T 1Y7',
    'orangeville': '10 Louisa Street, Orangeville, Ontario, L9W 3P9',
    'owen-sound': '611 9th Avenue East, Owen Sound, Ontario, N4K 3E5',
    'walkerton': '207 Cayley Street, Walkerton, Ontario, N0G 2V0',
    'belleville': '15 Bridge Street West, Belleville, Ontario, K8P 5J9',
    'brockville': '41 Court House Square, Brockville, Ontario, K6V 7A8',
    'cornwall': '29 Second Street West, Cornwall, Ontario, K6J 1G3',
    'kingston': '469 Montreal Street, Kingston, Ontario, K7K 3H9',
    'lorignal': "59 Court Street, 2nd Floor, L'Orignal, Ontario, K0B 1K0",
    'napanee': '41 Dundas Street West, Napanee, Ontario, K7R 1Z5',
    'ottawa': '161 Elgin Street, 2nd Floor, Ottawa, Ontario, K2P 2K1',
    'pembroke': '297 Pembroke Street East, Pembroke, Ontario, K8A 3K4',
    'perth': '43 Drummond Street East, Perth, Ontario, K7H 1G2',
    'picton': '44 Union Street, Picton, Ontario, K0K 2T0',
    'north-bay': '360 Plouffe Street, North Bay, Ontario, P1B 9L5',
    'parry-sound': '89 James Street, Parry Sound, Ontario, P2A 1T7',
    'sault-ste-marie': '426 Queen Street East, Sault Ste. Marie, Ontario, P6A 1Z7',
    'sudbury': '155 Elm Street, Sudbury, Ontario, P3C 1T9',
    'sudbury-ocj': '201-159 Cedar Street, Sudbury, Ontario, P3E 6A5',
    'timmins': '38 Pine Street North, Timmins, Ontario, P4N 6K6',
    'gore-bay': '27 Phipps Street, Gore Bay, Ontario, P0P 1H0',
    'haileybury': '393 Main Street, Haileybury, Ontario, P0J 1K0',
    'espanola': '100 Tudhope Street, 2nd Floor, Suite 3, Espanola, Ontario, P5E 1S6',
    'elliot-lake': '200 Ontario Avenue, Elliot Lake, Ontario, P5A 1Y9',
    'fort-frances': '333 Church Street, Fort Frances, Ontario, P9A 1C9',
    'kenora': '216 Water Street, Kenora, Ontario, P9N 1S4',
    'thunder-bay': '125 Brodie Street North, Thunder Bay, Ontario, P7C 0A3',
    'dryden': '479 Government Street, Dryden, Ontario, P8N 2P3',
    'sioux-lookout': '18 4th Avenue South, Sioux Lookout, Ontario, P8T 1G7',
    'chatham': '425 Grand Avenue West, Chatham, Ontario, N7L 1C7',
    'goderich': '1 Courthouse Square, Goderich, Ontario, N7A 1M2',
    'london': '80 Dundas Street, London, Ontario, N6A 6A3',
    'sarnia': '700 North Christina Street, Sarnia, Ontario, N7V 3C2',
    'st-thomas': '4 Wellington Street, St. Thomas, Ontario, N5R 6H8',
    'stratford': '1 Huron Street, Stratford, Ontario, N5A 5S4',
    'windsor': '245 Windsor Avenue, Windsor, Ontario, N9A 1J2',
    'woodstock': '415 Hunter Street, Woodstock, Ontario, N4S 4G9',
    'leamington': '7 Clark Street West, Leamington, Ontario, N8H 1P2',
})


def _fe_flat(form_data_list):
    """Build a flat {fieldKey: value} dict from FormEngine form_data rows."""
    flat = {}
    for row in form_data_list:
        key = row.get('fieldKey', '')
        val = row.get('fieldValue', '')
        if key:
            flat[key] = val
    # FIX-F10-COURT: the shared "Court information" screen saves fileNumber,
    # which the server turns into 'file_number'. Every form reads
    # 'court_file_number', so copy it across (never overwrite a real value).
    if not str(flat.get('court_file_number') or '').strip() and str(flat.get('file_number') or '').strip():
        flat['court_file_number'] = flat['file_number']
    return flat


def _is_yes(val):
    return str(val).strip().lower() in ('yes', 'true', '1', 'on')


def _checkbox_on_state(annot_obj):
    """Return this checkbox widget's real "on" state name.

    Different PDF templates use different on-state names for checkboxes:
    /Yes, /On, /1, /Choice1, etc. The state names are the KEYS of the
    annotation's /AP/N appearance dictionary (excluding /Off). Preview and
    other strict viewers only render a check when /AS matches one of these
    exact names — hardcoding /Yes silently fails on templates that use /On.

    Returns the discovered on-state Name (e.g. '/On'), falling back to
    '/Yes' when the appearance dictionary is unreadable.
    """
    try:
        ap = annot_obj.get('/AP')
        if ap is None:
            return '/Yes'
        try:
            ap = ap.get_object()
        except Exception:
            pass
        n = ap.get('/N') if hasattr(ap, 'get') else None
        if n is None:
            return '/Yes'
        try:
            n = n.get_object()
        except Exception:
            pass
        for key in n.keys():
            key_str = str(key)
            if key_str != '/Off':
                return key_str
    except Exception:
        pass
    return '/Yes'


# ─── Small helpers introduced during the Aug 12 2026 audit (Fix 4) ───────────
def _pick(d, *keys):
    """Return the first non-empty stripped value from d for the given keys.

    Frontend now writes section-prefixed snake_case (e.g. `respondent_city`),
    but legacy cases used camelCase (`respondentCity`). Callers pass both
    spellings so old data still fills.
    """
    for k in keys:
        v = d.get(k, '')
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ''


def _fmt_addr(street, unit, city, province, postal):
    """Compose a single-line address; drops empty pieces without doubled commas.

    Unit is prefixed as 'Unit N, <street>' so it lands where humans expect it.
    """
    street = (street or '').strip()
    unit   = _real_unit(unit)
    city   = (city   or '').strip()
    province = (province or '').strip()
    postal = (postal or '').strip()
    head = f'Unit {unit}, {street}' if unit and street else (street or (f'Unit {unit}' if unit else ''))
    parts = [head, city, province, postal]
    return ', '.join(p for p in parts if p)


def _fmt_muni(city, province):
    """'City, Province' — omits pieces that are blank."""
    city = (city or '').strip()
    province = (province or '').strip()
    return ', '.join(p for p in [city, province] if p)


def _split_first_last(full_name):
    """Split a full name into (first+middle, last).

    Ontario court forms expect the surname alone in the 'last name' box,
    with any middle names kept with the given name. The prior code did
    `parts[0], ' '.join(parts[1:])` which mis-labelled 'Joshua Daniel Lance'
    as first='Joshua', last='Daniel Lance'. Fix 4 (D5) uses the
    surname-is-last-token convention instead.
    """
    parts = (full_name or '').strip().split()
    if not parts:
        return '', ''
    if len(parts) == 1:
        return parts[0], ''
    return ' '.join(parts[:-1]), parts[-1]


def fill_form8(input_path, output_path, form_data_list):
    """
    Fill Form 8 (Application General) from FormEngine-saved data.
    FormEngine stores flat fieldKey/fieldValue rows; this maps them
    to the 165 AcroForm fields in the official Ontario court PDF.
    """
    d = _fe_flat(form_data_list)

    # ── Court header ──────────────────────────────────────────────────────
    courthouse_raw = d.get('courthouse', d.get('court_name', ''))
    courthouse_name = COURTHOUSE_NAMES_FE.get(courthouse_raw, courthouse_raw)
    courthouse_addr = COURTHOUSE_ADDRESSES_FE.get(courthouse_raw,
                      COURTHOUSE_ADDRESSES_FE.get(courthouse_name, ''))
    file_number = d.get('fileNumber', d.get('court_file_number', ''))

    fields = {}
    checkboxes = {}

    fields['Name of court'] = courthouse_name
    fields['Court Address'] = courthouse_addr
    fields['Court office address'] = courthouse_addr
    for pg in range(1, 7):
        fields[f'Court File Number, page {pg}'] = file_number

    # ── Applicant ─────────────────────────────────────────────────────────
    # NOTE (Aug 12 2026 audit — Fix 4):
    #   Frontend now writes section-prefixed snake_case keys (applicant_city,
    #   respondent_province, situation_were_married, situation_separation_date).
    #   Legacy camelCase keys are still checked as fallbacks so older cases
    #   continue to fill.
    ap_name = _pick(d, 'applicantFullName', 'applicant_full_name')
    ap_dob  = _pick(d, 'applicantDob', 'applicant_dob')
    ap_unit = _pick(d, 'applicantUnit', 'applicant_unit')
    ap_street = _pick(d, 'applicantAddress', 'applicant_address')
    ap_city = _pick(d, 'applicantCity', 'applicant_city')
    ap_prov = _pick(d, 'applicantProvince', 'applicant_province') or 'ON'
    ap_postal = _pick(d, 'applicantPostalCode', 'applicant_postal_code')
    ap_addr = _fmt_addr(ap_street, ap_unit, ap_city, ap_prov, ap_postal)
    ap_phone = format_phone(_pick(d, 'applicantPhone', 'applicant_phone'))
    ap_email = _pick(d, 'applicantEmail', 'applicant_email')

    fields['Applicant(s) - Full legal name'] = ap_name
    fields['Applicant(s) - Address'] = ap_addr
    fields['Applicant(s) - Phone & fax'] = ap_phone
    fields['Applicant(s) - Email'] = ap_email
    fields['Age - applicant'] = calc_age(ap_dob)
    fields['Birthdate: (d, m, y) - Applicant'] = format_dob(ap_dob)

    fields['Municipality & province - applicant'] = _fmt_muni(ap_city, ap_prov)
    fields['Date - start of residency - applicant'] = _pick(d, 'applicantResidencyDate', 'applicant_residency_date')

    ap_gender = _pick(d, 'applicantGender', 'applicant_gender').lower()
    if ap_gender in ('male', 'm'):      checkboxes['Male - applicant'] = True
    elif ap_gender in ('female', 'f'):  checkboxes['Female - applicant'] = True
    elif ap_gender:                     checkboxes['Another gender - applicant'] = True

    ap_prev = _pick(d, 'applicantPreviousMarriage', 'applicant_previous_marriage')
    if _is_yes(ap_prev):   checkboxes['Yes - applicant'] = True
    elif ap_prev == 'no':  checkboxes['No - applicant'] = True

    # ── Respondent ────────────────────────────────────────────────────────
    re_name = _pick(d, 'respondentFullName', 'respondent_full_name')
    re_dob  = _pick(d, 'respondentDob', 'respondent_dob')
    re_unit = _pick(d, 'respondentUnit', 'respondent_unit')
    re_street = _pick(d, 'respondentAddress', 'respondent_address')
    re_city = _pick(d, 'respondentCity', 'respondent_city')
    re_prov = _pick(d, 'respondentProvince', 'respondent_province') or 'ON'
    re_postal = _pick(d, 'respondentPostalCode', 'respondent_postal_code')
    re_addr = _fmt_addr(re_street, re_unit, re_city, re_prov, re_postal)
    re_phone = format_phone(_pick(d, 'respondentPhone', 'respondent_phone'))
    re_email = _pick(d, 'respondentEmail', 'respondent_email')

    fields['Respondent(s) - Full legal name'] = re_name
    fields['Respondent(s) - Address'] = re_addr
    fields['Respondent(s) - Phone & fax'] = re_phone
    fields['Respondent(s) - Email'] = re_email
    fields['Age - respondent'] = calc_age(re_dob)
    fields['Birthdate: (d, m, y) - respondent'] = format_dob(re_dob)
    fields['Municipality & province - respondent'] = _fmt_muni(re_city, re_prov)
    fields['Date - start of residency - respondent'] = _pick(d, 'respondentResidencyDate', 'respondent_residency_date')

    re_gender = _pick(d, 'respondentGender', 'respondent_gender').lower()
    if re_gender in ('male', 'm'):      checkboxes['Male - respondent'] = True
    elif re_gender in ('female', 'f'):  checkboxes['Female - respondent'] = True
    elif re_gender:                     checkboxes['Another gender - respondent'] = True

    re_prev = _pick(d, 'respondentPreviousMarriage', 'respondent_previous_marriage')
    if _is_yes(re_prev):   checkboxes['Yes - respondent'] = True
    elif re_prev == 'no':  checkboxes['No - respondent'] = True

    re_lawyer_name = _pick(d, 'respondentLawyerName', 'respondent_lawyer_name')
    re_lawyer_firm = _pick(d, 'respondentLawyerFirm', 'respondent_lawyer_firm')
    re_lawyer_phone = format_phone(_pick(d, 'respondentLawyerPhone', 'respondent_lawyer_phone'))
    fields['Respondent(s) Lawyer - Full legal name'] = re_lawyer_name
    fields['Respondent(s) Lawyer - Address'] = re_lawyer_firm
    fields['Respondent(s) Lawyer - Phone & fax'] = re_lawyer_phone

    # ── Relationship / marriage dates ─────────────────────────────────────
    # D4: pre-marriage name / marriage-date / previous-divorce fields must be
    # left blank when the parties were never married. situation_were_married
    # is the frontend answer ('yes' / 'no'); we treat missing as 'no' so old
    # never-married cases stop leaking today's surname into the marriage
    # panel.
    were_married = _is_yes(_pick(d, 'situationWereMarried', 'situation_were_married',
                                    'wereMarried', 'were_married'))

    # FIX-F8-MARRIAGE-DATE: the main case "Your situation" screen saves the
    # marriage date as situation_marriage_date (server toFillRows adds the
    # section prefix). This only read the old bare names, so "Married on"
    # never printed on a divorce application. Old names still read first.
    marriage_date = _pick(d, 'marriageDate', 'marriage_date',
                             'situationMarriageDate', 'situation_marriage_date')
    sep_date      = _pick(d, 'separationDate', 'separation_date',
                             'situationSeparationDate', 'situation_separation_date')
    rel_type      = _pick(d, 'relationshipType', 'relationship_type')

    # Aug 29 2026 fix (BUG-F8-DIVORCE-SECTION-01):
    # The "IMPORTANT FACTS SUPPORTING MY CLAIM FOR DIVORCE" section on page 5
    # (marriage date, separation date, Separation / Adultery / Cruelty checkboxes,
    # "have not lived together again" checkbox) is ONLY legally meaningful when
    # the applicant is asking the court for a divorce. On parenting-only or
    # support-only cases the whole section must remain blank.
    #
    # Previously this code:
    #   1. Ticked "Married on" any time a marriage date existed.
    #   2. Ticked "Separated on" any time a separation date existed — which
    #      is filled for every case (the wizard collects it for cohab / support
    #      calculations, not just divorce).
    #   3. Defaulted `grounds` to 'separation' when unset, then unconditionally
    #      ticked the "Separation" and "have not lived together again" boxes.
    # The combined effect was a Form 8 that looked like it was claiming
    # divorce on every filing, including pure custody / parenting cases.
    #
    # We now compute `is_divorce_case` up front and gate the entire block.
    # is_divorce_case checks the three signals the wizard actually produces:
    #   - claims CSV includes 'divorce'
    #   - claimDivorce flag is yes
    #   - askingDivorce flag is yes (wizard's explicit question)
    # If askingDivorce is explicitly 'no' we treat that as a hard override.
    claims_csv_early = str(d.get('claims', '') or '')
    # FIX-F8-MARRIAGE-DATE: also read situation_asking_divorce (the name the
    # main case screen saves), so an explicit "No" keeps the divorce section blank.
    asking_divorce = str(_pick(d, 'askingDivorce', 'asking_divorce',
                               'situationAskingDivorce', 'situation_asking_divorce') or '').lower()
    is_divorce_case = (
        asking_divorce not in ('no', 'false', '0')
        and (
            'divorce' in [t.strip() for t in claims_csv_early.split(',') if t.strip()]
            or _is_yes(d.get('claimDivorce', d.get('claim_divorce', '')))
            or asking_divorce in ('yes', 'true', '1')
        )
    )

    if were_married:
        # D5: pre-marriage first/last names — accept an explicit override,
        # else split the full name using the surname-is-last-token rule
        # ("Joshua Daniel Lance" → first="Joshua Daniel", last="Lance").
        ap_pm_first_default, ap_pm_last_default = _split_first_last(ap_name)
        re_pm_first_default, re_pm_last_default = _split_first_last(re_name)
        fields['First name on the day before the marriage date - applicant'] = _pick(
            d, 'applicantPremarriageFirst', 'applicant_premarriage_first') or ap_pm_first_default
        fields['Last name on the day before the marriage date - applicant'] = _pick(
            d, 'applicantPremarriageLast', 'applicant_premarriage_last') or ap_pm_last_default
        fields['First name on the day before the marriage date - respondent'] = _pick(
            d, 'respondentPremarriageFirst', 'respondent_premarriage_first') or re_pm_first_default
        fields['Last name on the day before the marriage date - respondent'] = _pick(
            d, 'respondentPremarriageLast', 'respondent_premarriage_last') or re_pm_last_default
        fields['Place and date of previous divorce - applicant'] = _pick(
            d, 'applicantPreviousDivorce', 'applicant_previous_divorce')
        fields['Place and date of previous divorce - respondent'] = _pick(
            d, 'respondentPreviousDivorce', 'respondent_previous_divorce')
        if marriage_date and is_divorce_case:
            # Marriage date + "Married on" checkbox only appear when this
            # is a divorce filing. On parenting-only cases the marriage
            # date lives elsewhere (e.g. relationship history).
            fields['Date - Married on'] = marriage_date
            checkboxes['Married on'] = True

    if sep_date and is_divorce_case:
        # Separation date + "Separated on" checkbox only appear when this
        # is a divorce filing. Parenting-only cases collect a separation
        # date for cohabitation history but must not populate the divorce
        # section fields.
        fields['Date - Separated on'] = sep_date
        fields['Date - seperation'] = sep_date
        checkboxes['Separated on'] = True

    if is_divorce_case:
        # Divorce grounds: default to 'separation' unless the wizard
        # explicitly set another grounds. Ticks the corresponding checkboxes
        # only inside a divorce claim.
        grounds = d.get('divorceGrounds', d.get('divorce_grounds', 'separation'))
        if grounds == 'separation' or not grounds:
            checkboxes['Separation'] = True
            checkboxes['have not lived together again since that date in an unsuccessful attempt to reconcile'] = True
        elif grounds == 'adultery':
            checkboxes['Adultery'] = True
            fields['Adultery - details'] = d.get('adulteryDetails', d.get('adultery_details', ''))
        elif grounds == 'cruelty':
            checkboxes['Cruelty'] = True
            fields['Cruelty - details'] = d.get('crueltyDetails', d.get('cruelty_details', ''))

    # ── Claims (checkboxes) ───────────────────────────────────────────────
    # Aug 28 2026 fix (BUG-F8-OFFICIAL-01, BUG-F8-CLAIMS-COLUMN-01):
    # Wizard stores selected claims as a single comma-separated string in the
    # `claims` fieldKey (e.g. "decisionMaking,parentingTime").
    #
    # Form 8 splits child-related claims across THREE columns:
    #   - Divorce Act column      → field names ending in " 1"
    #   - Family Law Act / CLRA   → field names ending in " 2"
    #   - Property (SCJ only)     → bare property field names
    # Non-child-related and property claims have a single field name and
    # go in one specific column regardless.
    #
    # We decide the child-claim column by checking if a divorce is being
    # requested. If yes, child claims travel with the divorce under the
    # Divorce Act (" 1" suffix). If no, they go under the FLA/CLRA (" 2").
    # `is_divorce_case` was computed earlier (before the divorce-facts
    # block) using the same three signals plus askingDivorce, so we
    # reuse it here for column selection.
    claims_csv_raw = d.get('claims', '')
    claims_csv = str(claims_csv_raw) if isinstance(claims_csv_raw, str) else ''
    # Tokens with a suffixed field name: pick " 1" (Divorce Act) or " 2" (FLA/CLRA)
    suffix = '1' if is_divorce_case else '2'
    CLAIMS_CSV_MAP = {
        'divorce':                 'a divorce',
        'supportForMe':            f'support for me {suffix}',
        'childSupportTable':       f'support for child(ren) \u2013 table amount {suffix}',
        'childSupportOther':       f'support for child(ren) \u2013 other than table amount {suffix}',
        'decisionMaking':          f'decision-making responsibility for child(ren) {suffix}',
        'parentingTime':           f'parenting time with child(ren) {suffix}',
        # Claims with a single field name (column is intrinsic to the field)
        'restrainingOrder':        'restraining/non-harassment order',
        'spousalSupportIndexing':  'indexing spousal support',
        'parentageDeclaration':    'declaration of parentage',
        'contactWithChildren':     'contact with child(ren) (this does not require court leave)',
        'equalization':            'equalization of net family properties',
        'exclusivePossession':     'exclusive possession of matrimonial home',
        'exclusiveContents':       'exclusive possession of contents of matrimonial home',
        'freezingAssets':          'freezing assets',
        'saleOfProperty':          'sale of family property',
        'annulment':               'annulment of marriage',
        'costs':                   'Costs',
        'prejudgmentInterest':     'prejudgment interest',
    }
    if claims_csv.strip():
        for token in claims_csv.split(','):
            token = token.strip()
            field_name = CLAIMS_CSV_MAP.get(token)
            if field_name:
                checkboxes[field_name] = True

    # Legacy per-key flags (kept for backward compatibility)
    if _is_yes(d.get('claimCustody', d.get('claim_custody', ''))):
        checkboxes[f'decision-making responsibility for child(ren) {suffix}'] = True
    if _is_yes(d.get('claimAccess', d.get('claim_access', ''))):
        checkboxes[f'parenting time with child(ren) {suffix}'] = True
    if _is_yes(d.get('claimChildSupport', d.get('claim_child_support', ''))):
        checkboxes[f'support for child(ren) \u2013 table amount {suffix}'] = True
    if _is_yes(d.get('claimSpousalSupport', d.get('claim_spousal_support', ''))):
        checkboxes[f'support for me {suffix}'] = True
    if _is_yes(d.get('claimPropertyDivision', d.get('claim_property_division', ''))):
        checkboxes['equalization of net family properties'] = True
    if _is_yes(d.get('claimRestrainingOrder', d.get('claim_restraining_order', ''))):
        checkboxes['restraining/non-harassment order'] = True
    if _is_yes(d.get('claimCosts', d.get('claim_costs', ''))):
        checkboxes['Costs'] = True
    if _is_yes(d.get('claimAnnulment', '')):
        checkboxes['annulment of marriage'] = True
    if _is_yes(d.get('claimDivorce', d.get('claim_divorce', ''))):
        checkboxes['a divorce'] = True

    # FIX-F8-NOTICE: page 2 tells the other party which financial form to
    # file. The two boxes contradict each other, so at most one is ticked.
    # Property or the home wins, even if support is also claimed. Support
    # alone ticks the support note. Children-only claims tick neither.
    # Josh confirmed this rule Oct 19 2026.
    _tokens = {t.strip() for t in claims_csv.split(',') if t.strip()}
    _support = _tokens & {'supportForMe', 'childSupportTable', 'childSupportOther', 'spousalSupportIndexing'}
    _support = _support or _is_yes(d.get('claimChildSupport', d.get('claim_child_support', ''))) or _is_yes(d.get('claimSpousalSupport', d.get('claim_spousal_support', '')))
    _property = _tokens & {'equalization', 'exclusivePossession', 'exclusiveContents', 'saleOfProperty'}
    _property = _property or _is_yes(d.get('claimPropertyDivision', d.get('claim_property_division', '')))
    if _property:
        checkboxes['This case includes a claim for property or exclusive possession of the matrimonial home and its contents. You MUST fill out a Financial Statement (Form 13.1 – a blank copy attached), serve a copy on the applicant(s) and file a copy in the court office with an Affidavit of Service even if you do not answer this case'] = True
    elif _support:
        checkboxes['This case includes a claim for support. It does not include a claim for property or exclusive possession of the matrimonial home and its contents. You MUST fill out a Financial Statement (Form 13 – a blank copy attached), serve a copy on the applicant(s) and file a copy in the court office with an Affidavit of Service even if you do not answer this case'] = True

    # Order details / situation summary
    # Aug 29 2026 fix (BUG-F8-OFFICIAL-02, BUG-F8-OFFICIAL-03):
    # The wizard's parenting plan step collects two narrative fields that
    # map naturally to the two blank narrative sections on Form 8 page 5:
    #   - otherParentTime           → what the applicant is asking the court
    #                                 to order (the "details of the order").
    #   - childcareArrangements     → the factual basis: current arrangement,
    #                                 who does what, why the order is needed.
    # Legacy keys (situationSummary / claimOtherDetails / factsLegalBasis)
    # are still honoured for older cases that populated them directly.
    # Accept multiple key shapes because the adapter (dist/index.cjs
    # toFillRows) snake_cases keys and may prefix them with the wizard
    # section name. Case 17 arrives as `other_parent_time` /
    # `childcare_arrangements` (snake, no prefix). Other cases may arrive
    # section-prefixed. Legacy keys are also honoured.
    def _first_nonblank(keys):
        for k in keys:
            v = d.get(k)
            if v is not None and str(v).strip():
                return str(v).strip()
        return ''

    order_details = _first_nonblank([
        'otherParentTime', 'other_parent_time',
        'childrenPlan_otherParentTime', 'children_plan_other_parent_time',
        'f351_plan_otherParentTime', 'f351_plan_other_parent_time',
        # Legacy
        'situationSummary', 'situation_summary', 'claimOtherDetails', 'claim_other_details',
    ])
    if order_details:
        # Aug 29 2026 fix (BUG-F8-DETAILS-TRUNCATED):
        # The Form 8 "Details of the order that you want the court to make"
        # widget is only ~40pt tall (2 lines) — too small for a full
        # parenting-plan narrative. Ontario Family Rules permit attaching a
        # Schedule to Form 8 for content that does not fit in the printed
        # boxes; a Schedule A page is appended to the download by the
        # download endpoint (fillPDFWithSchedule in dist/index.cjs). Point
        # the reader at the Schedule from the small on-form box.
        fields['Details of the order that you want the court to make'] = (
            'See attached Schedule A — Parenting Plan and Requested Order.'
        )

    facts_text = _first_nonblank([
        'childcareArrangements', 'childcare_arrangements',
        'childrenPlan_childcareArrangements', 'children_plan_childcare_arrangements',
        'f351_plan_childcareArrangements', 'f351_plan_childcare_arrangements',
        # Legacy
        'factsLegalBasis', 'facts_legal_basis',
    ])
    if facts_text:
        fields['Facts that form the legal basis for your other claim(s)'] = facts_text

    # ── Children ─────────────────────────────────────────────────────────
    child_count_raw = d.get('childrenCount', d.get('children_count', '0'))
    try:
        child_count = int(str(child_count_raw))
    except:
        child_count = 0

    for i in range(1, min(child_count + 1, 7)):
        cn = d.get(f'child{i}Name', d.get(f'child_{i}_name', ''))
        cd = d.get(f'child{i}Dob', d.get(f'child_{i}_dob', ''))
        # Wizard writes `livesWith` → adapter emits `child_{i}_lives_with`.
        # Legacy keys `child_{i}_residence` / `child{i}Residence` kept for
        # older cases that predate the wizard change.
        cr_raw = d.get(f'child_{i}_lives_with',
                       d.get(f'child_{i}_residence',
                             d.get(f'child{i}Residence', '')))
        cr_norm = str(cr_raw).strip().lower()

        # Human-readable value for the "Now living with" column.
        # Handles both structured legacy tokens ('applicant', 'respondent',
        # 'both', 'other') and the free-text values the current wizard
        # writes (e.g. "With Other Parent", "With me", "With grandparent").
        if cr_norm in ('applicant', 'with me', 'with the applicant', 'me'):
            residence_label = ap_name or 'Applicant'
            lives_with_other = False
        elif cr_norm in ('respondent', 'with other parent',
                         'with the other parent', 'with the respondent'):
            residence_label = f'{re_name} (other parent)' if re_name else 'Other parent'
            lives_with_other = True
        elif cr_norm == 'both':
            residence_label = f'{ap_name or "Applicant"} and {re_name or "Respondent"}'
            lives_with_other = False
        elif cr_norm in ('other', ''):
            residence_label = ''
            lives_with_other = False
        else:
            # Free text we don't recognise — pass through as-is
            residence_label = str(cr_raw)
            lives_with_other = False

        # Municipality: explicit per-child overrides win.
        # If none, and the child lives with the other parent, use the
        # respondent's city/province. Otherwise fall back to the applicant's
        # (kids-with-applicant is still the most common single-parent case).
        explicit_city = d.get(f'child_{i}_city', d.get(f'child{i}City', ''))
        explicit_prov = d.get(f'child_{i}_province', d.get(f'child{i}Province', ''))
        if explicit_city or explicit_prov:
            child_city = explicit_city
            child_prov = explicit_prov
        elif lives_with_other:
            child_city = re_city
            child_prov = re_prov
        else:
            child_city = ap_city
            child_prov = ap_prov

        fields[f'Full legal name {i}'] = cn
        fields[f'Age {i}'] = calc_age(cd)
        fields[f'Birthdate: (d, m, y) {i}'] = format_dob(cd)
        fields[f'Resident in (municipality & province) {i}'] = _fmt_muni(child_city, child_prov)
        lw_key = f'Now Living With (name of person and relationship to child) {i if i < 5 else i + 1}'
        fields[lw_key] = residence_label

    # ── Footer watermark ──────────────────────────────────────────────────
    # Hearth & Page notice goes in the "Date of signature" field
    # (the actual signing date is left blank — user signs at court)
    fields['Date of signature'] = ''  # user signs physically

    # ── Write the PDF ─────────────────────────────────────────────────────
    from pypdf import PdfWriter, PdfReader
    import pypdf.generic as g

    reader = PdfReader(input_path)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)

    filled_count = 0
    for page in writer.pages:
        if '/Annots' not in page:
            continue
        for annot_ref in page['/Annots']:
            try:
                annot_obj = annot_ref.get_object()
            except Exception:
                continue
            if annot_obj.get('/Subtype') != '/Widget':
                continue

            # FIX-F8-WRITER-FULLNAME: a "." in a field name splits it, so the
            # widget's own /T is only the tail ("m" for a.m., or the end of the
            # page-2 notice). Match the widget's own /T first, so every existing
            # mapping keeps working, then the full dotted name.
            own_t = annot_obj.get('/T')
            if not own_t and '/Parent' in annot_obj:
                try:
                    own_t = annot_obj['/Parent'].get_object().get('/T')
                except Exception:
                    pass
            full_t = _get_field_full_path(annot_obj)
            own_s = str(own_t) if own_t else ''
            fname = own_s if own_s and (own_s in fields or own_s in checkboxes) else full_t
            if not fname:
                continue

            if fname in fields:
                val = str(fields[fname])
                annot_obj.update({
                    g.NameObject('/V'): g.create_string_object(val),
                    g.NameObject('/AP'): g.DictionaryObject(),
                })
                filled_count += 1
            elif fname in checkboxes:
                val = _checkbox_on_state(annot_obj) if checkboxes[fname] else '/Off'
                annot_obj.update({
                    g.NameObject('/V'): g.NameObject(val),
                    g.NameObject('/AS'): g.NameObject(val),
                })
                filled_count += 1

    if '/AcroForm' in writer._root_object:
        try:
            acroform = writer._root_object['/AcroForm']
            if hasattr(acroform, 'update'):
                acroform.update({g.NameObject('/NeedAppearances'): g.BooleanObject(True)})
        except:
            pass

    with open(output_path, 'wb') as fout:
        writer.write(fout)

    sys.stderr.write(f'[fill_form8] Filled {filled_count} fields → {output_path}\n')
    return filled_count


# ─────────────────────────────────────────────────────────────────────────────
# FormEngine-aware fill for Form 13 (Financial Statement — Support Claims)
# ─────────────────────────────────────────────────────────────────────────────

def _fe_part2_expenses(money, val, to_float):
    """FIX-F131-B3: Part 2 (monthly expenses) shared by Forms 13 and 13.1.

    Both forms ask the same 54 expense lines in the same 9 groups, so one
    function works out every line, every group subtotal and the totals.
    Returns {'lines': {...}, 'subtotals': {...}, 'education_desc',
    'other_desc', 'total_monthly', 'total_yearly'}. Blank stays blank.

    Rules (from FIX-F13-AUTO-DEDUCTIONS / -COMBINED / -TOTALS):
    - Automatic deductions: per-line answers if given, otherwise the
      wizard's one monthly total goes in the subtotal only. Pay-stub
      amounts are per pay period and are never used here.
    - Combined wizard answers (utilities, transportation, health,
      personal) belong to the group subtotal, not to any single line.
    - Totals are always the sum of the printed subtotals; saved wizard
      totals are not used, because a sworn form must add up.
    """
    L = {}
    L['cpp']        = money('f13_expenses_exp_auto_cpp', 'exp_auto_cpp', 'cpp_contributions')
    L['ei']         = money('f13_expenses_exp_auto_ei', 'exp_auto_ei', 'ei_premiums')
    L['income_tax'] = money('f13_expenses_exp_auto_incometax', 'exp_auto_incometax', 'income_taxes')
    L['pension']    = money('f13_expenses_exp_auto_pension', 'exp_auto_pension',
                            'employee_pension_contributions')
    L['union_dues'] = money('f13_expenses_exp_auto_uniondues', 'exp_auto_uniondues', 'union_dues')
    L['rent_mortgage']      = money('f13_expenses_exp_rent_mortgage', 'exp_rent_mortgage')
    L['property_tax']       = money('f13_expenses_exp_property_tax', 'exp_property_tax')
    L['property_insurance'] = money('f13_expenses_exp_property_insurance', 'exp_property_insurance')
    L['condo']              = money('f13_expenses_exp_condo_fees', 'exp_condo_fees')
    L['home_repairs']       = money('f13_expenses_exp_home_repairs', 'exp_home_repairs')
    L['water']       = money('f13_expenses_exp_water', 'exp_water')
    L['heat']        = money('f13_expenses_exp_heat', 'exp_heat')
    L['electricity'] = money('f13_expenses_exp_electricity', 'exp_electricity')
    L['telephone']   = money('f13_expenses_exp_telephone', 'exp_telephone')
    L['cell']        = money('f13_expenses_exp_cell_phone', 'exp_cell_phone', 'exp_cellphone')
    L['cable']       = money('f13_expenses_exp_cable', 'exp_cable')
    L['internet']    = money('f13_expenses_exp_internet', 'exp_internet')
    L['groceries']          = money('f13_expenses_exp_groceries', 'exp_groceries')
    L['household_supplies'] = money('f13_expenses_exp_household_supplies', 'exp_household_supplies')
    L['meals_out']          = money('f13_expenses_exp_meals_out', 'exp_meals_out')
    L['pet_care']           = money('f13_expenses_exp_pet_care', 'exp_pet_care')
    L['laundry']            = money('f13_expenses_exp_laundry', 'exp_laundry')
    L['daycare']     = money('f13_expenses_exp_childcare', 'exp_childcare', 'daycare_expense')
    L['babysitting'] = money('f13_expenses_exp_babysitting', 'exp_babysitting')
    L['transit']       = money('f13_expenses_exp_public_transit', 'exp_public_transit', 'public_transit')
    L['gas_oil']       = money('f13_expenses_exp_gas_oil', 'exp_gas_oil')
    L['car_insurance'] = money('f13_expenses_exp_car_insurance', 'exp_car_insurance')
    L['car_repairs']   = money('f13_expenses_exp_car_repairs', 'exp_car_repairs')
    L['parking']       = money('f13_expenses_exp_parking', 'exp_parking')
    L['car_loan']      = money('f13_expenses_exp_car_loan', 'exp_car_loan',
                               'debt_car_loans')  # debts-side value as fallback
    L['health_insurance'] = money('f13_expenses_exp_health_insurance', 'exp_health_insurance',
                                  'exp_health')
    L['dental']   = money('f13_expenses_exp_dental', 'exp_dental')
    L['medicine'] = money('f13_expenses_exp_medicine', 'exp_medicine')
    L['eye_care'] = money('f13_expenses_exp_eye_care', 'exp_eye_care')
    L['clothing']      = money('f13_expenses_exp_clothing', 'exp_clothing')
    L['hair_beauty']   = money('f13_expenses_exp_hair_beauty', 'exp_hair_beauty', 'exp_personal_care')
    L['alcohol']       = money('f13_expenses_exp_alcohol', 'exp_alcohol')
    L['education']     = money('f13_expenses_exp_education', 'exp_education')
    L['entertainment'] = money('f13_expenses_exp_entertainment', 'exp_entertainment')
    L['gifts']         = money('f13_expenses_exp_gifts', 'exp_gifts')
    L['life_insurance']      = money('f13_expenses_exp_life_insurance', 'exp_life_insurance')
    L['rrsp']                = money('f13_expenses_exp_rrsp', 'exp_rrsp')
    L['vacations']           = money('f13_expenses_exp_vacations', 'exp_vacations')
    L['school_fees']         = money('f13_expenses_exp_school_fees', 'exp_school_fees')
    L['children_clothing']   = money('f13_expenses_exp_children_clothing', 'exp_children_clothing')
    L['children_activities'] = money('f13_expenses_exp_children_activities', 'exp_children_activities')
    L['summer_camp']         = money('f13_expenses_exp_summer_camp', 'exp_summer_camp')
    L['debt_payments']       = money('f13_expenses_exp_debt_payments', 'exp_debt_payments')
    L['other_support']       = money('f13_expenses_exp_other_support', 'exp_other_support')
    L['other']               = money('f13_expenses_exp_other', 'exp_other')

    def _sum(*ks):
        return sum(to_float(L[k]) for k in ks)

    # FIX-F13-EXP-LINES (Nov 17 2026): the wizard now asks every line.
    # Older cases may still have a one-number group total from the earlier
    # combined questions. That total counts only while none of the group's
    # lines has an answer; once any line is answered, the lines win and the
    # old total is ignored (and logged), so nothing is counted twice.
    def _group(name, keys, legacy_keys):
        answered = any(L[k] not in (None, '') for k in keys)
        legacy = money(*legacy_keys) if legacy_keys else ''
        if answered:
            if legacy:
                sys.stderr.write(f'[part2] {name}: line answers used; earlier group total {legacy} ignored\n')
            return _sum(*keys)
        return to_float(legacy)

    S = {}
    S['auto'] = _group('auto', ('cpp', 'ei', 'income_tax', 'pension', 'union_dues'),
                       ('f13_expenses_exp_auto_deductions', 'exp_auto_deductions'))
    S['housing'] = _sum('rent_mortgage', 'property_tax', 'property_insurance', 'condo', 'home_repairs')
    S['utilities'] = _group('utilities', ('water', 'heat', 'electricity', 'telephone', 'cell', 'cable', 'internet'),
                            ('f13_expenses_exp_utilities', 'exp_utilities'))
    S['household'] = _sum('groceries', 'household_supplies', 'meals_out', 'pet_care', 'laundry')
    S['childcare'] = _sum('daycare', 'babysitting')
    S['transport'] = _group('transport', ('transit', 'gas_oil', 'car_insurance', 'car_repairs', 'parking', 'car_loan'),
                            ('f13_expenses_exp_transit', 'exp_transit'))
    S['health'] = _group('health', ('health_insurance', 'dental', 'medicine', 'eye_care'),
                         ('f13_expenses_exp_health', 'exp_health'))
    # The earlier "Personal (hair, entertainment, gifts, alcohol, tobacco)"
    # total never covered clothing or education, which were asked apart.
    S['personal'] = (_sum('clothing', 'education')
                     + _group('personal', ('hair_beauty', 'alcohol', 'entertainment', 'gifts'),
                              ('f13_expenses_exp_personal', 'exp_personal')))
    S['other'] = _sum('life_insurance', 'rrsp', 'vacations', 'school_fees', 'children_clothing',
                      'children_activities', 'summer_camp', 'debt_payments', 'other_support', 'other')
    total = (S['auto'] + S['housing'] + S['utilities'] + S['household'] + S['childcare']
             + S['transport'] + S['health'] + S['personal'] + S['other'])
    total_m = f'{total:.2f}' if total else ''
    return {
        'lines': L,
        'subtotals': S,
        'education_desc': val('f13_expenses_exp_education_desc', 'exp_education_desc'),
        'other_desc': val('f13_expenses_exp_other_desc', 'exp_other_desc'),
        'total_monthly': total_m,
        'total_yearly': f'{to_float(total_m) * 12:.2f}' if total_m else '',
    }


def fill_form13(input_path, output_path, form_data_list):
    """Fill Form 13 — Financial Statement (Support Claims).

    Full-coverage fill covering all 8 pages:
      Part 1 (Income)     — parties, employment block, monthly income table, YTD, pay-period detail
      Part 2 (Expenses)   — 26 monthly line items + 9 group subtotals + monthly & yearly totals
      Part 3 (Assets)     — 18-slot asset table across 9 categories + total value
      Part 4 (Debts)      — 12-slot debt table (creditor / amount / monthly / yes-no) + total
      Part 5 (Summary)    — total assets, subtract debts, net worth, affidavit block
      Schedule A          — additional income sources + subtotal
      Schedule B          — spouse/partner living arrangement + contribution
      Schedule C          — 10-slot child extraordinary-expense table + totals

    Reads both bare fieldIds (e.g. `inc_employment`) AND the section-prefixed
    variants written by toFillRows() (`f13_income_inc_employment`,
    `f13_employment_gross_pay`, `f13_assets_asset_vehicles`, etc.). Case-17
    baseline was 12 of 342 fillable fields (3.5 %); this brings it to the
    full extent case-17's populated data supports.
    """
    import pypdf

    d = _fe_flat(form_data_list)

    # ── Helpers ───────────────────────────────────────────────────────────
    def val(*keys):
        """First non-empty, non-'N/A' value across the given keys."""
        for k in keys:
            v = d.get(k, '')
            if v in (None, '', 'N/A', 'n/a'):
                continue
            s = str(v).strip()
            if s and s.upper() != 'N/A':
                return s
        return ''

    def money(*keys):
        """First non-empty numeric value across keys, formatted to 2 decimals.
        Skips 'N/A'. Non-numeric text is returned as-is (caller decides)."""
        v = val(*keys)
        if not v:
            return ''
        raw = v.replace('$', '').replace(',', '').strip()
        # If it parses as a number, format with 2 decimals; otherwise pass through
        try:
            return f'{float(raw):.2f}'
        except (ValueError, TypeError):
            return raw

    def to_float(s):
        try:
            return float(str(s).replace('$', '').replace(',', '').strip())
        except Exception:
            return 0.0

    def sum_money(*keys):
        return sum(to_float(d.get(k, '')) for k in keys)

    def annualize(monthly_val):
        try:
            return f'{to_float(monthly_val) * 12:.2f}' if monthly_val else ''
        except Exception:
            return ''

    fields = {}
    checkboxes = {}

    # ── Court header ──────────────────────────────────────────────────────
    file_number = val('court_file_number', 'fileNumber', 'court_file_number')
    courthouse  = val('courthouse', 'court_courthouse', 'court_name')
    courthouse_name = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    courthouse_addr = COURTHOUSE_ADDRESSES_FE.get(courthouse,
                      COURTHOUSE_ADDRESSES_FE.get(courthouse_name, ''))
    for pg in range(1, 7):
        fields[f'Court File Number, page {pg}'] = file_number
    fields['Name of Court']        = courthouse_name
    fields['Court Office Address'] = courthouse_addr

    # ── Parties ──────────────────────────────────────────────────────────
    ap_name  = val('applicant_full_name', 'applicantFullName')
    ap_addr_composed = _fmt_addr(
        val('applicant_address'),
        val('applicant_unit'),
        val('applicant_city'),
        val('applicant_province'),
        val('applicant_postal_code'),
    )
    ap_addr  = ap_addr_composed or val('applicant_address', 'applicantAddress')
    ap_phone = format_phone(val('applicant_phone', 'applicantPhone'))
    ap_email = val('applicant_email', 'applicantEmail')

    re_name  = val('respondent_full_name', 'respondentFullName')
    re_addr_composed = _fmt_addr(
        val('respondent_address'),
        val('respondent_unit'),
        val('respondent_city'),
        val('respondent_province'),
        val('respondent_postal_code'),
    )
    re_addr  = re_addr_composed or val('respondent_address', 'respondentAddress')
    re_phone = format_phone(val('respondent_phone', 'respondentPhone'))
    re_email = val('respondent_email', 'respondentEmail')

    fields['Full legal name - Applicant(s)']  = ap_name
    fields['Address - Applicant(s)']          = ap_addr
    fields['Phone & fax - Applicant(s)']      = ap_phone
    fields['Email - Applicant(s)']            = ap_email
    fields['Full legal name - Respondent(s)'] = re_name
    fields['Address - Respondent(s)']         = re_addr
    fields['Phone & fax - Respondent(s)']     = re_phone
    fields['Email - Respondent(s)']           = re_email

    # Deponent (assumed = applicant unless overridden)
    filer_name = val('filer_full_name') or ap_name
    city       = val('applicant_city', 'city', 'applicantCity')
    province   = val('applicant_province', 'province', 'applicantProvince') or 'Ontario'
    # FIX-F13-FILED-BY: "This form is filed by: [ ] applicant [ ] respondent".
    # In this PDF the applicant box is a tiny TEXT field named 'Applicant'
    # (the respondent box is a real checkbox), so writing the filer's full
    # name there showed nothing. Mark it with "X". The app's filer is the
    # applicant on every form (Form 8 etc.), matching the deponent rule below.
    fields['Applicant']                    = 'X' if filer_name else ''
    fields['Full legal name']              = filer_name
    fields['Municipality & province']      = _fmt_muni(city, province)
    fields['Municipality']                 = city
    fields['Province, state or country']   = province
    date_sworn = val('date_sworn', 'dateSworn')
    fields['Date Sworn/Affirmed']          = date_sworn
    fields['Date sworn/affirmed']          = date_sworn

    # ── Part 1: Employment status (Q2) ────────────────────────────────────
    emp_type = val('f13_employment_employment_status', 'employment_type',
                   'employmentType', 'employmentStatus').lower()

    employer_name = val(
        'f13_employment_employer_name', 'employer_name', 'employerName',
    )
    employer_addr = val(
        'f13_employment_employer_address', 'employer_address', 'employerAddress',
        'work_address',
    )
    business_name = val(
        'f13_employment_business_name', 'business_name', 'businessName',
    )
    last_employed = val(
        'f13_employment_unemployed_since', 'last_employed_date', 'lastEmployedDate',
    )

    # The employer field in the PDF is a single 'name and address' box.
    employer_full = ''
    if employer_name and employer_addr and employer_addr not in employer_name:
        employer_full = f'{employer_name}\n{employer_addr}'
    else:
        employer_full = employer_name or employer_addr

    if emp_type in ('employed', 'employee', 'employed full-time', 'employed part-time'):
        checkboxes['employed by'] = True
        fields['Name and address of employer'] = employer_full
        # FIX-F13-SPOUSE-WORKPLACE: 'Place of work or business' is Schedule B
        # item 5 ("My spouse/partner works at"). The filer's own employer
        # must never be written there - it is filled only from the Schedule B
        # partner answer below.
    elif emp_type in ('self-employed', 'self_employed', 'selfemployed', 'selfEmployed'.lower()):
        checkboxes['self-employed'] = True
        fields['Name and address of business'] = business_name
    elif emp_type in ('unemployed', 'not employed', 'on disability', 'disabled', 'not_employed'):
        checkboxes['Unemployed since'] = True
        fields['Date when last employed'] = last_employed

    # ── Part 1: Proof-of-income doc checkboxes (Q3) ──────────────────────
    proof = val('f13_employment_proof_documents', 'proof_documents',
                'proofDocuments').lower()
    if 'paystub' in proof or 'pay cheque' in proof or 'pay stub' in proof:
        checkboxes['pay cheque stub'] = True
    if 'record of employment' in proof or 'roe' in proof:
        checkboxes['employment insurance stub and last Record of Employment'] = True
    if 'social assistance' in proof or 'ontario works' in proof or 'odsp' in proof:
        checkboxes['social assistance stub'] = True
    if 'pension' in proof:
        checkboxes['pension stub'] = True
    if "worker" in proof or 'wsib' in proof:
        checkboxes['workers compensation stub'] = True
    if 'income and expenses' in proof or 'professional activities' in proof:
        checkboxes['statement of income and expenses / professional activities (for self-employed individuals)'] = True
    if ('t4' in proof or 'noa' in proof or 'letter from' in proof
            or 'notice of assessment' in proof):
        checkboxes['other (e.g. a letter from your employer confirming all income received to date this year)'] = True

    # FIX-F13-INDIAN-ACT-LIST: 'List doucments provided' (sic, PDF name) is
    # the document list for the Indian Act option in item 5 ("I am an Indian
    # within the meaning of the Indian Act ... I am attaching the following
    # proof"). The wizard's proof-of-income list belongs to item 3 (handled
    # by the checkboxes above), so it is NOT written here - doing so put
    # the user's list under a declaration they never made. The wizard has
    # no Indian Act question, so this field and its box stay blank.
    # FIX-F131-B1 (Nov 16 2026): item 5 now has its own question on the Form
    # 13 employment screen (taxDocs, shared with Form 13.1). 'attaching' ticks
    # the tax-returns box; 'indian_act' ticks the Indian Act box and prints
    # that option's own document list. No answer: both stay blank.
    _tax = val('f13_employment_tax_docs').lower()
    if _tax == 'attaching':
        checkboxes['I am attaching all of the following required documents to this financial statement as proof of my income over the past three years, if they have not already been provided'] = True
    elif _tax == 'indian_act':
        checkboxes['I am an Indian within the meaning of the Indian Act (Canada) and I have chosen not to file income tax returns for the past three years. I am attaching the following proof of income for the last three years'] = True
        fields['List doucments provided'] = val('f13_employment_indian_act_docs')

    # ── Part 1: Last-year gross (Q4) ─────────────────────────────────────
    # FIX-F13-LAST-YEAR: read the wizard's real key
    # (f13_employment.last_year_gross_income). No fallback to year-to-date
    # gross: printing this year's partial income as "last year" would be a
    # false statement on a sworn form. Blank is safer than wrong.
    last_year_gross = money(
        'f13_employment_last_year_gross_income', 'last_year_gross_income',
        'gross_income_last_year', 'lastYearGross', 'f13_income_last_year_gross',
    )
    fields['Last year my gross income (0.00)'] = last_year_gross

    # ── Part 1: Monthly income table (Q5-12) ─────────────────────────────
    fields['Employment income [0.00]'] = money(
        'f13_income_inc_employment', 'inc_employment',
    )
    fields['Commissions, tips and bonuses [0.00]'] = money(
        'f13_income_inc_commissions', 'inc_commissions',
    )
    fields['Self-employment income [0.00]'] = money(
        'f13_income_inc_selfemployment', 'inc_selfemployment',
    )
    fields['Monthly amount before expenses (0.00)'] = money(
        'f13_income_inc_selfemployment_gross', 'inc_selfemployment_gross',
    )
    fields['Employment Insurance benefits [0.00]'] = money(
        'f13_income_inc_ei', 'inc_ei',
    )
    fields["Workers' compensation benefits [0.00]"] = money(
        'f13_income_inc_wcb', 'inc_wcb',
    )
    fields['Social assistance income [0.00]'] = money(
        'f13_income_inc_socialassistance', 'inc_socialassistance',
    )
    fields['Interest and investment income [0.00]'] = money(
        'f13_income_inc_investment', 'inc_investment',
    )
    fields['Pension income [0.00]'] = money(
        'f13_income_inc_pension', 'inc_pension',
    )
    fields['Spousal support received from a former spouse/partner [0.00]'] = money(
        'f13_income_inc_spousalsupport', 'inc_spousalsupport',
    )
    fields['Child Tax Benefits or Tax Rebates [0.00]'] = money(
        'f13_income_inc_childtaxbenefit', 'inc_childtaxbenefit',
    )
    fields['Other sources of income [0.00]'] = money(
        'f13_income_inc_other', 'inc_other',
    )
    fields['Other income (specify source)'] = val(
        'f13_income_inc_other_benefits', 'inc_other_benefits', 'other_income_source',
    )

    # FIX-F13-TOTALS: = sum of the 11 income lines printed above (page 2,
    # lines 5-15), not a saved total.
    _INC_LINE_FIELDS = (
        'Employment income [0.00]', 'Commissions, tips and bonuses [0.00]',
        'Self-employment income [0.00]', 'Employment Insurance benefits [0.00]',
        "Workers' compensation benefits [0.00]", 'Social assistance income [0.00]',
        'Interest and investment income [0.00]', 'Pension income [0.00]',
        'Spousal support received from a former spouse/partner [0.00]',
        'Child Tax Benefits or Tax Rebates [0.00]', 'Other sources of income [0.00]',
    )
    _inc_printed = sum(to_float(fields.get(k, '')) for k in _INC_LINE_FIELDS)
    inc_total = f'{_inc_printed:.2f}' if _inc_printed else ''
    fields['Total monthly income from all sources [0.00]'] = inc_total
    fields['Total annual income [0.00]'] = annualize(inc_total)

    # ── Part 1: Non-cash benefits table (Q14 — 4 rows) ───────────────────
    # Case-17 has no data for these; the schema exposes only inc_other_benefits
    # as free text. Route it into Details 1 with a stubbed Item label.
    # FIX-F131-B2 (Nov 16 2026): the income screen now asks line 14 as up
    # to 4 rows (otherBenefitRows: item / details / yearly value). Rows win;
    # the old free-text answer below is only used when there are no rows.
    _ben_rows = []
    for _i in range(4):
        _r = tuple(val(f'f13_income_other_benefit_rows_{_i}_{c}') for c in ('item', 'details', 'value'))
        if any(_r):
            _ben_rows.append(_r)
    for _n, (_it, _de, _va) in enumerate(_ben_rows, start=1):
        fields[f'Item {_n}'] = _it
        fields[f'Details {_n}'] = _de
        fields['Yearly Market Value 4' if _n == 4 else f'Yearly Market Value {_n} [0.00]'] = money(f'f13_income_other_benefit_rows_{_n - 1}_value')
    benefits_note = '' if _ben_rows else val('f13_income_inc_other_benefits', 'inc_other_benefits')
    if benefits_note:
        fields['Item 1']    = 'Non-cash benefits'
        fields['Details 1'] = benefits_note

    # ── Part 2: Monthly expenses (page 3-4) ───────────────────────────────
    # FIX-F131-B3: the Part 2 math lives in _fe_part2_expenses(), shared with
    # Form 13.1 so both sworn statements always print the same numbers.
    # Notes kept from the earlier fixes:
    # FIX-F13-AUTO-DEDUCTIONS (option A): one monthly total, never pay-stub
    #   per-period amounts. FIX-F13-COMBINED: combined wizard answers go to
    #   the group subtotal, not a single line. FIX-F13-TOTALS: printed totals
    #   are always the sum of printed lines and subtotals.
    # FIX-F13-SUBTOTAL-BOXES: the PDF's subtotal numbering does not follow
    # the printed order. Verified by position (box vs group heading):
    #   Subtotal 1 Automatic deductions  2 Housing   3 Transportation
    #   4 Health   5 Utilities   6 Household   7 Childcare   8 Personal   9 Other
    _p2 = _fe_part2_expenses(money, val, to_float)
    _L, _S = _p2['lines'], _p2['subtotals']
    def _st(x):
        return f'{x:.2f}' if x else ''
    fields['CPP contributions [0.00]']            = _L['cpp']
    fields['EI premiums [0.00]']                  = _L['ei']
    fields['Income taxes [0.00]']                 = _L['income_tax']
    fields['Employee pension contributions [0.00]']= _L['pension']
    fields['Union dues [0.00]']                   = _L['union_dues']
    fields['Subtotal 1 [0.00]'] = _st(_S['auto'])
    fields['Rent or mortgage [0.00]']        = _L['rent_mortgage']
    fields['Property taxes [0.00]']          = _L['property_tax']
    fields['Property insurance [0.00]']      = _L['property_insurance']
    fields['Condominium fees [0.00]']        = _L['condo']
    fields['Repairs and maintenance [0.00]'] = _L['home_repairs']
    fields['Subtotal 2 [0.00]'] = _st(_S['housing'])
    fields['Water [0.00]']       = _L['water']
    fields['Heat [0.00]']        = _L['heat']
    fields['Electricity [0.00]'] = _L['electricity']
    fields['Telephone [0.00]']   = _L['telephone']
    fields['Cell phone [0.00]']  = _L['cell']
    fields['Cable [0.00]']       = _L['cable']
    fields['Internet [0.00]']    = _L['internet']
    fields['Subtotal 5 [0.00]'] = _st(_S['utilities'])      # Utilities box
    fields['Groceries [0.00]']         = _L['groceries']
    fields['Household supplies [0.00]']= _L['household_supplies']
    fields['Meals outside the home [0.00]'] = _L['meals_out']
    fields['Pet care [0.00]']          = _L['pet_care']
    fields['Laundry and Dry Cleaning'] = _L['laundry']  # note: PDF has no [0.00] suffix on this one
    fields['Subtotal 6 [0.00]'] = _st(_S['household'])  # Household box
    fields['Daycare expense [0.00]']   = _L['daycare']
    fields['Babysitting costs [0.00]'] = _L['babysitting']
    fields['Subtotal 7 [0.00]'] = _st(_S['childcare'])  # Childcare box
    fields['Public transit, taxis [0.00]'] = _L['transit']
    fields['Gas and oil [0.00]']           = _L['gas_oil']
    fields['Car insurance and license [0.00]'] = _L['car_insurance']
    # "Repairs and maintenance" appears TWICE in the PDF (Housing + Transport)
    # but only one leaf widget carries the name, so transport repairs are
    # counted in Subtotal 3 but not printed on their own line here.
    fields['Parking [0.00]'] = _L['parking']
    fields['Car Loan or Lease Payments [0.00]'] = _L['car_loan']
    fields['Subtotal 3 [0.00]'] = _st(_S['transport'])  # Transportation box
    fields['Health insurance premiums [0.00]'] = _L['health_insurance']
    fields['Dental expenses [0.00]']  = _L['dental']
    fields['Medicine and drugs [0.00]'] = _L['medicine']
    fields['Eye care [0.00]']         = _L['eye_care']
    fields['Subtotal 4 [0.00]'] = _st(_S['health'])      # Health box
    fields['Clothing [0.00]']              = _L['clothing']
    fields['Hair care and beauty [0.00]']  = _L['hair_beauty']
    fields['Alcohol and tobacco [0.00]']   = _L['alcohol']
    fields['Education (specify)']          = _p2['education_desc']
    fields['Education [0.00]']             = _L['education']
    fields['Entertainment/recreation [0.00]'] = _L['entertainment']
    fields['Gifts [0.00]']                 = _L['gifts']
    fields['Subtotal 8'] = _st(_S['personal'])  # no [0.00] suffix in the PDF
    fields['Life Insurance premiums [0.00]']    = _L['life_insurance']
    fields['RRSP/RESP withdrawals [0.00]']      = _L['rrsp']
    fields['Vacations [0.00]']                  = _L['vacations']
    fields['School fees and supplies [0.00]']   = _L['school_fees']
    fields['Clothing for children [0.00]']      = _L['children_clothing']
    fields['Children\u2019s activities [0.00]'] = _L['children_activities']
    fields['Summer camp expenses [0.00]']       = _L['summer_camp']
    fields['Debt payments [0.00]']              = _L['debt_payments']
    fields['Support paid for other children [0.00]'] = _L['other_support']
    fields['Other expenses [0.00]']             = _L['other']
    fields['Other expenses (specify)']          = _p2['other_desc']
    fields['Subtotal 9 [0.00]'] = _st(_S['other'])
    fields['Total Amount of Monthly Expenses [0.00]'] = _p2['total_monthly']
    fields['Total Amount of Yearly Expenses [0.00]']  = _p2['total_yearly']

    # ── Part 3: Assets ───────────────────────────────────────────────────
    # FIX-F13-ASSET-ROWS (Oct 19 2026): value boxes verified by pairing each
    # box with the description box on the same row of the official PDF:
    #   Real estate 1-3 -> Value 1-3      Vehicles 1-3   -> Value 4-6
    #   Other possessions -> Value 7-9    Investments    -> Value 10-12
    #   Bank accounts -> Value 13-15      Savings plans  -> Value 16-18
    #   Life insurance -> Cash Surrender 1-3   Business -> Cash Surrender 4-6
    #   Money owed -> Cash Surrender 7-9       Other    -> Cash Surrender 10-12
    # ("Yearly Market Value" is the page-3 non-cash benefits table, not assets.)
    # The older slot notes below are superseded by this table.
    # PDF slot numbering (Value or Amount (0.00) N):
    #   1-3  = Real Estate           (Address and Nature of Ownership 1-3)
    #   4-6  = Cars, Boats, Vehicles (Year and Make - Cars, Boats, Vehicles 1-3)
    #   7-9  = "Other Possessions"   (Address - Other Possessions 1-3)  [via Yearly Market Value]
    #                                → In practice mapped as Investments in schema. We use
    #                                  the Address slots for "Other Possessions" separately.
    #   The actual mapping is:
    #     Value 1-3   = Real Estate
    #     Value 4-6   = Vehicles
    #     Value 5-6-7?  Bank Accounts uses Value 5-6-7 in the OLD code, but a fresh
    #     look at the PDF's field indices shows Value 1-18 covers ALL asset rows in order.
    # Rather than guess, we follow the numbering used by the earlier fill_form13()
    # (which was hand-verified against the shipped form):
    #   Real Estate 1        →  Value 1
    #   Vehicles 1           →  Value 2      (index 2 in old code but PDF shows 4)
    # The earlier code was mapping slot#1 of each category to Value(1..) in order —
    # which means "Vehicles slot 1" landed in Value 2 (position 2 in the sequential
    # ordering of the AcroForm). We preserve that convention because it was
    # verified visually in the previous session.
    #
    # FIX-F13-AMOUNT-SPLIT: every asset section uses the same rule - one
    # line per item, leading amount -> value box, rest -> description box,
    # up to 3 rows (row map verified in FIX-F13-ASSET-ROWS above).
    _ASSET_SECTIONS = [
        # (wizard key, legacy desc key, description field fmt, value field fmt, value offset)
        ('asset_realestate',     'asset_realestate_desc',     'Address and Nature of Ownership {i}', 'Value or Amount (0.00) {n}', 0),
        ('asset_vehicles',       'asset_vehicles_desc',       'Year and Make - Cars, Boats, Vehicles {i}', 'Value or Amount (0.00) {n}', 3),
        ('asset_possessions',    'asset_possessions_desc',    'Address - Other Possessions {i}', 'Value or Amount (0.00) {n}', 6),
        ('asset_investments',    'asset_investments_desc',    'Investments: Type \u2013 Issuer \u2013 Due Date \u2013 Number of Shares {i}', 'Value or Amount (0.00) {n}', 9),
        ('asset_bank_accounts',  'asset_bank_name',           'Name and Address of Institution - Bank Accounts {i}', 'Value or Amount (0.00) {n}', 12),
        ('asset_rrsp_pension',   'asset_rrsp_desc',           'Type and Issuer - Savings Plans {i}', 'Value or Amount (0.00) {n}', 15),
        ('asset_life_insurance', 'asset_life_insurance_desc', 'Life Insurance: Type \u2013 Beneficiary \u2013 Face Amount {i}', 'Cash Surrender Value (0.00) {n}', 0),
        ('asset_business',       'asset_business_desc',       'Name and Address of Business {i}', 'Cash Surrender Value (0.00) {n}', 3),
        ('asset_money_owed',     'asset_money_owed_desc',     'Name and Address of Debtors {i}', 'Cash Surrender Value (0.00) {n}', 6),
        ('asset_other',          'asset_other_desc',          'Other Assets {i}', 'Cash Surrender Value (0.00) {n}', 9),
    ]
    asset_split_total = 0.0
    for key, desc_key, dfmt, vfmt, off in _ASSET_SECTIONS:
        rows = _rows3(_amount_lines(d.get(f'f13_assets_{key}', d.get(key, ''))))
        legacy_desc = val(f'f13_assets_{desc_key}', desc_key)
        for i, (amt, desc) in enumerate(rows, start=1):
            if i == 1 and not desc and legacy_desc:
                desc = legacy_desc
            fields[dfmt.format(i=i)] = desc
            fields[vfmt.format(n=off + i)] = amt
            asset_split_total += to_float(amt)
    fields['Account Number 1'] = val('f13_assets_asset_bank_account', 'asset_bank_account')

    # ─── Total assets ─────────────────────────────────────────────────
    # FIX-F13-TOTALS: = sum of the asset values printed above.
    asset_total_str = f'{asset_split_total:.2f}' if asset_split_total else ''
    fields['Total Assets (0.00)']            = asset_total_str
    fields['Total Value of All Property (0.00)'] = asset_total_str

    # ── Part 4: Debts ────────────────────────────────────────────────────
    # FIX-F13-DEBTS (Oct 19 2026): rows verified against the official PDF
    # (each "Full amount now owing" box paired with the creditor box on its
    # row): Mortgages/lines of credit/loans 1-3, Credit cards 4-6,
    # Unpaid support 7-9, Other debts 10-12. Wizard answers are one debt per
    # line, amount first ("4100.50 KOHO Line Of Credit") -> amount + creditor.
    # Legacy keys without a wizard question are folded into the right group
    # (car/student loans -> loans; taxes owing -> other debts).
    _DEBT_GROUPS = [
        (['debt_mortgage_loans', 'debt_car_loans', 'debt_student_loans'], 'debt_mortgage_desc', 'debt_mortgage_monthly',
         'Creditor (name and address) - Mortgages, Lines of Credits, Loans {i}', 0),
        (['debt_credit_cards'], 'debt_cc_desc', 'debt_cc_monthly',
         'Creditor (name and address) - Outstanding Credit Card Balances {i}', 3),
        (['debt_unpaid_support'], 'debt_unpaid_support_desc', 'debt_unpaid_support_monthly',
         'Creditor (name and address) - Unpaid Support Amounts {i}', 6),
        (['debt_other', 'debt_taxes_owing'], 'debt_other_desc', 'debt_other_monthly',
         'Creditor (name and address) - Other Debts {i}', 9),
    ]
    debt_split_total = 0.0
    for keys, desc_key, monthly_key, cfmt, off in _DEBT_GROUPS:
        entries = []
        for k in keys:
            entries += _amount_lines(d.get(f'f13_debts_{k}', d.get(k, '')))
        rows = _rows3(entries)
        legacy_desc = val(f'f13_debts_{desc_key}', desc_key)
        for i, (amt, desc) in enumerate(rows, start=1):
            if i == 1 and not desc and legacy_desc:
                desc = legacy_desc
            fields[cfmt.format(i=i)] = desc
            fields[f'Full amount now owing (0.00) {off + i}'] = amt
            debt_split_total += to_float(amt)
        fields[f'Monthly Payments (0.00) {off + 1}'] = money(f'f13_debts_{monthly_key}', monthly_key)

    # FIX-F13-TOTALS: = sum of the debt amounts printed above.
    debt_total_str = f'{debt_split_total:.2f}' if debt_split_total else ''

    fields['Total Amount of Debts Outstanding (0.00)'] = debt_total_str
    fields['Subtract Total Debts (0.00)']              = debt_total_str

    # ── Part 5: Net worth ────────────────────────────────────────────────
    # FIX-F13-TOTALS: net worth = printed total assets - printed total debts.
    net_worth_str = ''
    if asset_total_str or debt_total_str:
        nw_calc = to_float(asset_total_str) - to_float(debt_total_str)
        net_worth_str = f'{nw_calc:.2f}'
    fields['Net Worth (0.00)'] = net_worth_str

    # ── Schedule A: Additional income sources ─────────────────────────────
    # Annual Amount (0.00) 1-7 rows. Order matches the PDF (page 7):
    #   1 = Partnership   2 = Rental   3 = Dividends  4 = Capital gains
    #   5 = RRSP withdrawal  6 = RRIF/annuity  7 = Other
    sched_a_partnership = money('f13_scheduleA_partnership', 'sched_a_partnership')
    sched_a_rental      = money('f13_scheduleA_rental', 'sched_a_rental')
    sched_a_rental_gross= money('f13_scheduleA_rental_gross', 'sched_a_rental_gross')
    sched_a_dividends   = money('f13_scheduleA_dividends', 'sched_a_dividends')
    sched_a_cap_gains   = money('f13_scheduleA_capital_gains', 'sched_a_capital_gains')
    sched_a_cap_losses  = money('f13_scheduleA_capital_losses', 'sched_a_capital_losses')
    sched_a_rrsp        = money('f13_scheduleA_rrsp_withdrawal', 'sched_a_rrsp_withdrawal')
    sched_a_rrif        = money('f13_scheduleA_rrif', 'sched_a_rrif')
    sched_a_other       = money('f13_scheduleA_other', 'sched_a_other')
    sched_a_other_desc  = val('f13_scheduleA_other_desc', 'sched_a_other_desc')

    fields['Annual Amount (0.00) 1'] = sched_a_partnership
    fields['Annual Amount (0.00) 2'] = sched_a_rental
    fields['Gross annual rental income (0.00)'] = sched_a_rental_gross
    fields['Annual Amount (0.00) 3'] = sched_a_dividends
    # Capital gains row: total cap gains and losses go into separate boxes,
    # the net into Annual Amount (0.00) 4.
    fields['Total capital gains (0.00)'] = sched_a_cap_gains
    fields['Capital losses (0.00)']      = sched_a_cap_losses
    net_cap = to_float(sched_a_cap_gains) - to_float(sched_a_cap_losses)
    fields['Annual Amount (0.00) 4'] = f'{net_cap:.2f}' if (sched_a_cap_gains or sched_a_cap_losses) else ''
    fields['Annual Amount (0.00) 5'] = sched_a_rrsp
    fields['Annual Amount (0.00) 6'] = sched_a_rrif
    fields['Annual Amount (0.00) 7'] = sched_a_other

    sched_a_total = sum(to_float(x) for x in (sched_a_partnership, sched_a_rental,
                                              sched_a_dividends,
                                              sched_a_rrsp, sched_a_rrif,
                                              sched_a_other)) + net_cap
    fields['Additional Sources of Income - Subtotal'] = f'{sched_a_total:.2f}' if sched_a_total else ''

    # Schedule A free-text detail (backwards-compat with the old textarea path)
    if val('schedule_a'):
        fields['Details 2'] = d.get('schedule_a', '') or d.get('f13_schedules_schedule_a', '')

    # ── Schedule B: Other income earners in the home ─────────────────────
    live_arrangement = val('f13_scheduleB_living_arrangement', 'sched_b_living',
                           'schedule_b_living').lower()
    spouse_name    = val('f13_scheduleB_partner_name', 'sched_b_partner_name',
                         'schedule_b_partner_name')
    other_adults   = val('f13_scheduleB_other_adults', 'sched_b_other_adults')
    # FIX-F13-CHILDREN-AT-HOME: Schedule B asks how many children live in
    # YOUR home - not how many children you have. Use an explicit Schedule B
    # answer if one exists; otherwise count only children whose "lives with"
    # answer says they live with the filer (with me / shared / equal time).
    # Children with the other parent, a grandparent, or unrecognised text are
    # not counted (never guess on a sworn form).
    children_count = val('f13_scheduleB_children_count', 'sched_b_children_count')
    if not children_count:
        try:
            _n_kids = int(float(str(d.get('children_count', '0') or '0')))
        except ValueError:
            _n_kids = 0
        _home = 0
        for _i in range(1, min(_n_kids, 10) + 1):
            _lw = str(d.get(f'child_{_i}_lives_with',
                            d.get(f'child_{_i}_residence', '')) or '').strip().lower()
            if not _lw or any(x in _lw for x in ('other parent', 'respondent', 'grandparent', 'father', 'mother')):
                continue
            if _lw in ('me', 'applicant', 'both', 'both_equal') or any(
                    x in _lw for x in ('with me', 'shared', 'equal', '50/50', 'both parents', 'with the applicant')):
                _home += 1
        children_count = str(_home) if _home else ''
    spouse_workplace = val('f13_scheduleB_partner_workplace', 'sched_b_partner_workplace')
    spouse_earnings  = money('f13_scheduleB_partner_earnings', 'sched_b_partner_earnings')
    spouse_earn_period = val('f13_scheduleB_partner_earn_period', 'sched_b_partner_earn_period')
    contribution     = money('f13_scheduleB_contribution', 'sched_b_contribution')
    contribution_period = val('f13_scheduleB_contribution_period', 'sched_b_contribution_period')

    if live_arrangement in ('alone', 'live_alone', 'live alone'):
        checkboxes['I live alone'] = True
    if spouse_name:
        checkboxes['I am living with'] = True
        fields['Full legal name of person you are married to or cohabiting with'] = spouse_name
    if other_adults:
        checkboxes['I/we live with'] = True
        fields['Name(s) - Adult(s) living with'] = other_adults
    if children_count:
        checkboxes['I/we have children living at home'] = True
        fields['Number of child(ren) living at home'] = children_count

    if spouse_workplace:
        checkboxes['My spouse/partner works at'] = True
        fields['Place of work or business'] = spouse_workplace
    elif live_arrangement:
        # If we know partner status but no workplace, don't check "does not work"
        # blindly — only when explicitly indicated.
        if val('f13_scheduleB_partner_no_work', 'sched_b_partner_no_work') in ('true', 'yes', '1'):
            checkboxes['My spouse/partner does not work outside the home'] = True

    if spouse_earnings:
        checkboxes['My spouse/partner earns'] = True
        fields['Amount (0.00) - spouse/partner earnings'] = spouse_earnings
        fields['Time period (e.g. week, month, year)'] = spouse_earn_period or 'month'
    elif val('f13_scheduleB_partner_no_income', 'sched_b_partner_no_income') in ('true', 'yes', '1'):
        checkboxes['My spouse/partner does not earn any income'] = True

    if contribution:
        checkboxes['My spouse/partner or other adult residing in the home contributes about'] = True
        fields['Contributions to household (0.00)'] = contribution
        fields['Time period (e.g. week, month, year) 2'] = contribution_period or 'month'

    if val('schedule_b'):
        fields['Details 3'] = d.get('schedule_b', '') or d.get('f13_schedules_schedule_b', '')

    # ── Schedule C: Special/Extraordinary expenses (10 slots) ────────────
    for i in range(1, 11):
        name = val(f'f13_scheduleC_child_{i}_name', f'sched_c_child_{i}_name')
        expense = val(f'f13_scheduleC_expense_{i}', f'sched_c_expense_{i}')
        amount  = money(f'f13_scheduleC_amount_{i}', f'sched_c_amount_{i}')
        credits = money(f'f13_scheduleC_credits_{i}', f'sched_c_credits_{i}')
        fields[f'Child\u2019s Name {i}']                  = name
        fields[f'Expense {i}']                            = expense
        fields[f'Amount (0.00)/year {i}']                 = amount
        fields[f'Available Tax Credits or Deductions (0.00) {i}'] = credits

    sched_c_total_ann = sum(
        to_float(d.get(f'f13_scheduleC_amount_{i}',
                       d.get(f'sched_c_amount_{i}', '')))
        - to_float(d.get(f'f13_scheduleC_credits_{i}',
                         d.get(f'sched_c_credits_{i}', '')))
        for i in range(1, 11)
    )
    if sched_c_total_ann:
        fields['Total Net Annual Amount (0.00)']  = f'{sched_c_total_ann:.2f}'
        fields['Total Net Monthly Amount (0.00)'] = f'{sched_c_total_ann/12:.2f}'
        fields['Earnings per year (0.00)'] = money(
            'f13_scheduleC_own_earnings', 'sched_c_own_earnings',
        ) or annualize(inc_total)

    if val('schedule_c'):
        fields['Details 4'] = d.get('schedule_c', '') or d.get('f13_schedules_schedule_c', '')

    # ── Write PDF ─────────────────────────────────────────────────────────
    from pypdf import PdfReader, PdfWriter
    import pypdf.generic as g

    reader = PdfReader(input_path)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)

    # Drop empty entries so we don't wipe defaults
    fields     = {k: v for k, v in fields.items() if v not in (None, '')}
    checkboxes = {k: v for k, v in checkboxes.items() if v}

    # Text fields: use pypdf's built-in walker — it handles child
    # widgets whose value lives on the parent field object (Form 13
    # uses this pattern extensively for numbered slots).
    if fields:
        writer.update_page_form_field_values(None, fields, auto_regenerate=True)

    # Checkboxes/radios still need manual handling because
    # update_page_form_field_values only supports text-field /V writes.
    filled_checkboxes = 0
    for page in writer.pages:
        if '/Annots' not in page:
            continue
        for annot_ref in page['/Annots']:
            try:
                obj = annot_ref.get_object()
            except Exception:
                continue
            if obj.get('/Subtype') != '/Widget':
                continue
            # FIX-F13-CHECKBOX-PARENT: 34 Form 13 boxes (all of Schedule B,
            # the page-6 debt Yes/No boxes, "I earn") keep /FT and /T on a
            # parent field, not on the widget. Read both from the parent
            # when missing, and set /V on the parent too.
            parent = None
            if '/Parent' in obj:
                try:
                    parent = obj['/Parent'].get_object()
                except Exception:
                    parent = None
            ft = obj.get('/FT') or (parent.get('/FT') if parent is not None else None)
            if ft != '/Btn':
                continue
            # FIX-F13-CHECKBOX-FULLNAME: a "." in a field name splits it into
            # nested parts (e.g. "other (e" > "g" > " a letter from ..."), so
            # match on the fully-qualified name built from every /T up the
            # parent chain, joined with "." - the name viewers show.
            parts, node, hops = [], obj, 0
            while node is not None and hops < 10:
                t_part = node.get('/T')
                if t_part is not None:
                    parts.append(str(t_part))
                nxt = node.get('/Parent')
                node = nxt.get_object() if nxt is not None else None
                hops += 1
            if not parts:
                continue
            fname = '.'.join(reversed(parts))
            if fname in checkboxes:
                # FIX-F13-CHECKBOX-ON: use the widget's real on-state
                # (Form 13 boxes are mostly /On, not /Yes).
                v = _checkbox_on_state(obj) if checkboxes[fname] else '/Off'
                obj.update({
                    g.NameObject('/V'):  g.NameObject(v),
                    g.NameObject('/AS'): g.NameObject(v),
                })
                if parent is not None and '/T' not in obj:
                    parent.update({g.NameObject('/V'): g.NameObject(v)})
                filled_checkboxes += 1

    # Force viewers to regenerate appearance streams so filled values show up
    if '/AcroForm' in writer._root_object:
        try:
            acroform = writer._root_object['/AcroForm']
            if hasattr(acroform, 'update'):
                acroform.update({g.NameObject('/NeedAppearances'): g.BooleanObject(True)})
        except Exception:
            pass

    with open(output_path, 'wb') as f:
        writer.write(f)

    total_filled = len(fields) + filled_checkboxes
    sys.stderr.write(
        f'[fill_form13] Filled {total_filled} fields '
        f'({len(fields)} text + {filled_checkboxes} check) \u2192 {output_path}\n'
    )
    return total_filled

def fill_form13_1(input_path, output_path, form_data_list):
    """Fill Form 13.1 — Financial Statement (Property and Support Claims)."""
    d = _fe_flat(form_data_list)

    fields = {}
    checkboxes = {}

    # FIX-F131-B1 (Nov 16 2026, Form 13.1 plan brick 1): pages 1-2 top.
    # Pages 1-4 of Form 13.1 ask exactly what Form 13 asks, so they read
    # Form 13's answers (f13_employment_*), with the old Form 13.1 screen
    # keys (f13_1_employment_*) only filling a gap. Main-case answers give
    # the court, file number and both parties. Blank answers stay blank.
    def _v(*keys):
        for k in keys:
            s = str(d.get(k, '') or '').strip()
            if s and s.upper() != 'N/A':
                return s
        return ''

    def _m(*keys):
        s = _v(*keys)
        if not s:
            return ''
        raw = s.replace('$', '').replace(',', '').strip()
        try:
            return f'{float(raw):.2f}'
        except (ValueError, TypeError):
            return raw

    # ── Court header (every page) ─────────────────────────────────────────
    file_number     = _v('court_file_number', 'fileNumber')
    courthouse      = _v('courthouse', 'court_courthouse', 'court_name')
    courthouse_name = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    courthouse_addr = COURTHOUSE_ADDRESSES_FE.get(courthouse,
                      COURTHOUSE_ADDRESSES_FE.get(courthouse_name, ''))
    fields['Court File Number']    = file_number
    for _pg in range(2, 10):
        fields[f'Court file number - Page {_pg}'] = file_number
    fields['Name of court']        = courthouse_name
    fields['Court office address'] = courthouse_addr

    # ── Parties (main case) ───────────────────────────────────────────────
    def _party(side):
        addr = _fmt_addr(_v(f'{side}_address'), _v(f'{side}_unit'), _v(f'{side}_city'),
                         _v(f'{side}_province'), _v(f'{side}_postal_code'))
        return {
            'name':  _v(f'{side}_full_name', f'{side}FullName'),
            'addr':  addr,
            'phone': format_phone(_v(f'{side}_phone')),
            'email': _v(f'{side}_email'),
            'city':  _v(f'{side}_city'),
            'prov':  _v(f'{side}_province'),
        }
    _ap, _re = _party('applicant'), _party('respondent')
    for _who, _box in ((_ap, 'Applicant(s)'), (_re, 'Respondent(s)')):
        fields[f'{_box} — Full legal name'] = _who['name']
        fields[f'{_box} — Address']         = _who['addr']
        fields[f'{_box} — Phone & fax']     = _who['phone']
        fields[f'{_box} — Email']           = _who['email']
    # Lawyer boxes only when that party has a lawyer and a name was given.
    if _is_yes(_v('respondent_has_lawyer')) and _v('respondent_lawyer_name'):
        fields['Respondent(s) — Lawyer Full legal name'] = _v('respondent_lawyer_name')
        fields['Respondent(s) — Lawyer Address']         = _v('respondent_lawyer_firm', 'respondent_lawyer_address')
        fields['Respondent(s) — Lawyer Phone & fax']     = format_phone(_v('respondent_lawyer_phone'))
        fields['Respondent(s) — Lawyer Email']           = _v('respondent_lawyer_email')
    if _v('applicant_lawyer_name'):
        fields['Applicant(s) — Lawyer Full legal name'] = _v('applicant_lawyer_name')
        fields['Applicant(s) — Lawyer Address']         = _v('applicant_lawyer_firm', 'applicant_lawyer_address')
        fields['Applicant(s) — Lawyer Phone & fax']     = format_phone(_v('applicant_lawyer_phone'))
        fields['Applicant(s) — Lawyer Email']           = _v('applicant_lawyer_email')

    # ── Filed by + para 1 (who swears it) ─────────────────────────────────
    # The case-role answer says which side the user is. With no role answer
    # the filer is the applicant (same rule as Form 13), and only when an
    # applicant name exists. The filed-by box is ticked to match.
    _role = _v('case_role_case_role', 'case_role').lower()
    if _role == 'respondent':
        _filer, _side = _re, 'respondent'
    elif _role in ('applicant', 'agreement') or _ap['name']:
        _filer, _side = _ap, 'applicant'
    else:
        _filer, _side = {'name': '', 'city': '', 'prov': ''}, ''
    if _filer['name'] and _side:
        checkboxes[f'This form is filed by the {_side}'] = True
    fields['full legal name'] = _filer['name']
    _city = _filer['city'] or _v('f13_1_identity_city')
    _prov = _filer['prov'] or _v('f13_1_identity_province')
    if _prov.upper() in ('ON', 'ONT', 'ONT.'):
        _prov = 'Ontario'
    fields['municipality & province'] = _fmt_muni(_city, _prov)
    # 'date sworn/affirmed' (page 1) and the page 9 sworn block are filled in
    # by hand when the statement is sworn; they stay blank.

    # ── Para 2: employment ────────────────────────────────────────────────
    emp_type = _v('f13_employment_employment_status', 'f13_1_employment_employment_status').lower()
    if emp_type in ('employed', 'employee'):
        checkboxes['employed by (name and address of employer)'] = True
        fields['name and address of employer'] = _v('f13_employment_employer_name', 'f13_1_employment_employer_name')
    elif emp_type in ('self-employed', 'self_employed', 'selfemployed'):
        checkboxes['self-employed, carrying on business under the name of (name and address of business)'] = True
        fields['name and address of business'] = _v('f13_employment_business_name', 'f13_1_employment_business_name')
    elif emp_type == 'unemployed':
        checkboxes['unemployed since (date when last employed)'] = True
        fields['date when last employed'] = _v('f13_employment_unemployed_since')

    # ── Para 3: proof of year-to-date income ──────────────────────────────
    # Ticked from the proof-of-income list the user typed. T4s and notices
    # of assessment are past-year documents (para 5), not year-to-date
    # proof, so they don't tick "other".
    proof = _v('f13_employment_proof_documents').lower()
    if any(w in proof for w in ('pay stub', 'paystub', 'pay cheque', 'pay check')):
        checkboxes['pay cheque stub'] = True
    if any(w in proof for w in ('social assistance', 'ontario works', 'odsp')):
        checkboxes['social assistance stub'] = True
    if 'pension' in proof:
        checkboxes['pension stub'] = True
    if any(w in proof for w in ('worker', 'wsib')):
        checkboxes["workers' compensation stub"] = True
    if 'record of employment' in proof or 'employment insurance' in proof:
        checkboxes['employment insurance stub and last Record of Employment'] = True
    if 'income and expenses' in proof or 'professional activities' in proof:
        checkboxes['statement of income and expenses/ professional activities (for self-employed individuals)'] = True
    if 'letter from' in proof:
        checkboxes['other (e.g. a letter from your employer confirming all income received to date this year)'] = True

    # ── Para 4: last year's gross income ──────────────────────────────────
    fields['gross income from all sources (0.00)'] = _m(
        'f13_employment_last_year_gross_income', 'f13_1_employment_last_year_gross_income')

    # ── Para 5: tax documents for the past three years ────────────────────
    # New Form 13 question (taxDocs). No answer: both boxes stay blank.
    _tax = _v('f13_employment_tax_docs').lower()
    if _tax == 'attaching':
        checkboxes['I am attaching all of the following required documents to this financial statement as proof of my income over the past three years, if they have not already been provided'] = True
    elif _tax == 'indian_act':
        checkboxes['I am an Indian within the meaning of the Indian Act Canada and I have chosen not to file income tax returnsfor the past three years. I am attaching the following proof of income for the last three years'] = True
        fields['list documents you have provided'] = _v('f13_employment_indian_act_docs')

    # ── Part 1 income table, lines 1-14 ───────────────────────────────────
    # FIX-F131-B2 (Nov 16 2026, Form 13.1 plan brick 2): lines 1-11 read
    # Form 13's income answers (f13_income_*), old Form 13.1 keys only as a
    # fallback. Line 12 is the sum of the lines printed above and line 13 is
    # line 12 x 12; both stay blank when no line has an amount. The saved
    # "total" answer is not used (it can disagree with the lines).
    def _inc(key):
        return _m(f'f13_income_{key}', f'f13_1_income_{key}')
    _INC = (
        ('Employment income (before deductions) - Amount Received/Month (0.00)', 'inc_employment'),
        ('Commissions, tips and bonuses - Amount Received/Month (0.00)', 'inc_commissions'),
        ('Self-employment income (Monthly amount before expenses) - Amount Received/Month (0.00)', 'inc_selfemployment'),
        ('Employment Insurance benefits - Amount Received/Month (0.00)', 'inc_ei'),
        ("Workers' compensation benefits - Amount Received/Month (0.00)", 'inc_wcb'),
        ('Social assistance income (including ODSP payments) - Amount Received/Month (0.00)', 'inc_socialassistance'),
        ('Interest and investment income - Amount Received/Month (0.00)', 'inc_investment'),
        ('Pension income (including CPP and OAS) - Amount Received/Month (0.00)', 'inc_pension'),
        ('Spousal support received from a former spouse/partner - Amount Received/Month (0.00)', 'inc_spousalsupport'),
        ('Child Tax Benefits or Tax Rebates (e.g. GST) - Amount Received/Month (0.00)', 'inc_childtaxbenefit'),
        ('Other sources of income (e.g. RRSP withdrawals, capital gains) - Amount Received/Month (0.00)', 'inc_other'),
    )
    def _f(s):
        try:
            return float(str(s).replace('$', '').replace(',', '').strip())
        except (ValueError, TypeError):
            return None
    _inc_sum, _inc_any = 0.0, False
    for _box, _key in _INC:
        _val = _inc(_key)
        fields[_box] = _val
        if _f(_val) is not None:
            _inc_sum += _f(_val)
            _inc_any = True
    if _inc_any:
        fields['Total monthly income from all sources (0.00)'] = f'{_inc_sum:.2f}'
        fields['Total monthly income times 12 = Total annual income (0.00)'] = f'{_inc_sum * 12:.2f}'
    # Line 3 bracket: self-employment income before expenses (new Form 13
    # question). Blank when not answered.
    fields['Monthly amount before expenses (0.00)'] = _m('f13_income_inc_selfemployment_gross')

    # Line 14 other (non-cash) benefits: up to 4 rows (Form 13 income screen,
    # otherBenefitRows: item / details / yearly value). With no rows, an old
    # free-text answer goes in the first Details box.
    _ben = []
    for _i in range(4):
        _r = tuple(_v(f'f13_income_other_benefit_rows_{_i}_{c}') for c in ('item', 'details', 'value'))
        if any(_r):
            _ben.append(_r)
    if _ben:
        for _n, (_it, _de, _va) in enumerate(_ben, start=1):
            fields[f'Other non-cash benefits - Item {_n}'] = _it
            fields[f'Other non-cash benefits - Details {_n}'] = _de
            fields[f'Other non-cash benefits - Yearly Market Value {_n}'] = _m(f'f13_income_other_benefit_rows_{_n - 1}_value')
    else:
        fields['Other non-cash benefits - Details 1'] = _v('f13_income_inc_other_benefits')

    # ── Part 2: Expenses (pages 3-4) ──────────────────────────────────────
    # FIX-F131-B3 (Form 13.1 plan brick 3): same math as Form 13 via the
    # shared _fe_part2_expenses(), so the two sworn statements always agree.
    # Form 13's answers (f13_expenses_*) come first; the old Form 13.1 screen
    # (f13_1_expenses_*) only fills a gap. Unlike Form 13, Form 13.1 has its
    # own Transportation "Repairs and maintenance" box, so that line prints.
    def _m131(*keys):
        alt = tuple(k.replace('f13_expenses_', 'f13_1_expenses_', 1)
                    for k in keys if k.startswith('f13_expenses_'))
        return _m(*(keys + alt))

    def _v131(*keys):
        alt = tuple(k.replace('f13_expenses_', 'f13_1_expenses_', 1)
                    for k in keys if k.startswith('f13_expenses_'))
        return _v(*(keys + alt))

    def _f(x):
        try:
            return float(str(x).replace('$', '').replace(',', '').strip())
        except Exception:
            return 0.0

    _p2 = _fe_part2_expenses(_m131, _v131, _f)
    _L, _S = _p2['lines'], _p2['subtotals']

    def _st(x):
        return f'{x:.2f}' if x else ''

    _MA = ' - Monthly Amount (0.00)'
    for _label, _key in (
        ('CPP contributions', 'cpp'), ('EI premiums', 'ei'),
        ('Income taxes', 'income_tax'), ('Employee pension contributions', 'pension'),
        ('Union dues', 'union_dues'),
        ('Rent or mortgage', 'rent_mortgage'), ('Property taxes', 'property_tax'),
        ('Property insurance', 'property_insurance'), ('Condominium fees', 'condo'),
        ('Housing Repairs and maintenance', 'home_repairs'),
        ('Water', 'water'), ('Heat', 'heat'), ('Electricity', 'electricity'),
        ('Telephone', 'telephone'), ('Cell phone', 'cell'), ('Cable', 'cable'),
        ('Internet', 'internet'),
        ('Groceries', 'groceries'), ('Household supplies', 'household_supplies'),
        ('Meals outside the home', 'meals_out'), ('Pet care', 'pet_care'),
        ('Laundry and Dry Cleaning', 'laundry'),
        ('Daycare expense', 'daycare'), ('Babysitting costs', 'babysitting'),
        ('Public transit, taxis', 'transit'), ('Gas and oil', 'gas_oil'),
        ('Car insurance and license', 'car_insurance'),
        ('Transportation Repairs and maintenance', 'car_repairs'),
        ('Parking', 'parking'), ('Car Loan or Lease Payments', 'car_loan'),
        ('Health insurance premiums', 'health_insurance'), ('Dental expenses', 'dental'),
        ('Medicine and drugs', 'medicine'), ('Eye care', 'eye_care'),
        ('Clothing', 'clothing'), ('Hair care and beauty', 'hair_beauty'),
        ('Alcohol and tobacco', 'alcohol'), ('Education', 'education'),
        ('Entertainment/recreation (including children)', 'entertainment'),
        ('Gifts', 'gifts'),
        ('Life Insurance premiums', 'life_insurance'), ('RRSP/RESP withdrawals', 'rrsp'),
        ('Vacations', 'vacations'), ('School fees and supplies', 'school_fees'),
        ('Clothing for children', 'children_clothing'),
        ('Children\u2019s activities', 'children_activities'),
        ('Summer camp expenses', 'summer_camp'), ('Debt payments', 'debt_payments'),
        ('Support paid for other children', 'other_support'),
        ('Other expenses not shown above', 'other'),
    ):
        fields[_label + _MA] = _L[_key]
    fields['specify education expenses'] = _p2['education_desc']
    fields['specify other expenses']     = _p2['other_desc']
    # Subtotal boxes, named by group (verified by position on the PDF; the
    # Household subtotal box is the one named "Household Expenses").
    fields['Automatic Deductions Subtotal' + _MA] = _st(_S['auto'])
    fields['Housing Subtotal' + _MA]              = _st(_S['housing'])
    fields['Utilities Subtotal' + _MA]            = _st(_S['utilities'])
    fields['Household Expenses' + _MA]            = _st(_S['household'])
    fields['Childcare Costs Subtotal' + _MA]      = _st(_S['childcare'])
    fields['Transportation Subtotal- Monthly Amount (0.00)'] = _st(_S['transport'])  # PDF name has no space before '-'
    fields['Health Subtotal' + _MA]               = _st(_S['health'])
    fields['Personal Expenses Subtotal- Monthly Amount (0.00)'] = _st(_S['personal'])  # same
    fields['Other Expenses Subtotal' + _MA]       = _st(_S['other'])
    fields['Total Amount of Monthly Expenses (0.00)'] = _p2['total_monthly']
    fields['Total Amount of Yearly Expenses (0.00)']  = _p2['total_yearly']

    # FIX-F131-B1: the old asset, debt, date-of-marriage and net-family-
    # property lines wrote into the wrong boxes ("Other non-cash benefits",
    # "CPP contributions"). They are removed; Parts 4-9 come in later bricks.

    # ── Write PDF ─────────────────────────────────────────────────────────
    import pypdf.generic as g
    reader = pypdf.PdfReader(input_path)
    writer = pypdf.PdfWriter()
    writer.append(reader)

    filled = 0
    for page in writer.pages:
        if '/Annots' not in page:
            continue
        for annot_ref in page['/Annots']:
            annot_obj = annot_ref.get_object() if hasattr(annot_ref, 'get_object') else annot_ref
            if not hasattr(annot_obj, 'get'):
                continue
            # FIX-F131-WRITER (same two bugs fixed for Form 13 and the shared writer):
            # a "." in a field name splits it, so the widget's own /T is only the
            # tail ("00)") and the real name is the full parent chain. Some widgets
            # also keep /T and /FT on the parent. Match the widget's own /T first,
            # then the full dotted name. Set /V on the parent when the widget has no /T.
            parent = None
            if '/Parent' in annot_obj:
                try:
                    parent = annot_obj['/Parent'].get_object()
                except Exception:
                    parent = None
            own_t = annot_obj.get('/T')
            if hasattr(own_t, 'replace'):
                own_t = own_t.replace('\x00', '')
            full_t = _get_field_full_path(annot_obj)
            ft = annot_obj.get('/FT') or (parent.get('/FT') if parent is not None else None)
            fname = str(own_t) if own_t is not None and str(own_t) in (fields if ft == '/Tx' else checkboxes) else full_t
            if ft == '/Tx' and fname in fields and fields[fname] not in (None, ''):
                annot_obj.update({
                    g.NameObject('/V'): g.create_string_object(str(fields[fname])),
                    g.NameObject('/AP'): g.DictionaryObject(),
                })
                if own_t is None and parent is not None:
                    parent.update({g.NameObject('/V'): g.create_string_object(str(fields[fname]))})
                filled += 1
            elif ft == '/Btn' and fname in checkboxes:
                val = _checkbox_on_state(annot_obj) if checkboxes[fname] else '/Off'
                annot_obj.update({
                    g.NameObject('/V'):  g.NameObject(val),
                    g.NameObject('/AS'): g.NameObject(val),
                })
                if own_t is None and parent is not None:
                    parent.update({g.NameObject('/V'): g.NameObject(val)})
                filled += 1

    if '/AcroForm' in writer._root_object:
        try:
            acroform = writer._root_object['/AcroForm']
            if hasattr(acroform, 'update'):
                acroform.update({g.NameObject('/NeedAppearances'): g.BooleanObject(True)})
        except:
            pass

    with open(output_path, 'wb') as fout:
        writer.write(fout)

    sys.stderr.write(f'[fill_form13_1] Filled {filled} fields → {output_path}\n')
    return filled


# =============================================================================
# BATCH FILL FUNCTIONS — Forms 4, 6B, 10, 14, 14A, 14B, 14C,
#                        15, 15B, 15C, 17, 17E, 17F,
#                        13B, 23C, 25, 25A, 25F, 25G, 35_1, 36, 36B
# =============================================================================

def _fit_font_da(obj, parent, value, short_line_pt=None):
    """FIX-FIT-TEXT: for a multi-line value, return a /DA string with an
    explicit font size so every line fits inside the box. With the
    template's auto size (0), viewers disagree - some shrink to fit,
    others keep ~12pt and clip lines (e.g. the phone/email lines of an
    "address for service" block).

    short_line_pt (FIX-F36-FIT-LINE): a caller can ask for the same
    treatment on a short single-line box. iPhone and other strict
    viewers draw a 12pt (or auto-as-12pt) value in a 16pt box and clip
    it against the underline. Only forms that pass short_line_pt are
    affected; every other form keeps the template size."""
    import re as _re_da
    text = str(value or '')
    if '\n' not in text:
        if not short_line_pt:
            return None
        try:
            r = [float(x) for x in obj.get('/Rect')]
            h = abs(r[3] - r[1])
        except Exception:
            return None
        if h >= 17:
            return None
        size = min(float(short_line_pt), max(7.0, round((h - 7.0) * 2) / 2))
        da = str(obj.get('/DA') or (parent.get('/DA') if parent is not None else '') or '/Helv 0 Tf 0 g')
        if _re_da.search(r'[\d.]+\s+Tf', da):
            return _re_da.sub(r'[\d.]+(\s+Tf)', f'{size:g}\\1', da, count=1)
        return f'/Helv {size:g} Tf 0 g'

    try:
        r = [float(x) for x in obj.get('/Rect')]
        h, w = abs(r[3] - r[1]), abs(r[2] - r[0])
    except Exception:
        return None
    lines = text.split('\n')
    longest = max(len(x) for x in lines) or 1
    size = min(10.0, (h - 3.0) / (len(lines) * 1.17), (w - 6.0) / (0.52 * longest))
    size = max(5.0, round(size * 2) / 2)   # half-point steps, never below 5pt
    da = str(obj.get('/DA') or (parent.get('/DA') if parent is not None else '') or '/Helv 0 Tf 0 g')
    if _re_da.search(r'[\d.]+\s+Tf', da):
        return _re_da.sub(r'[\d.]+(\s+Tf)', f'{size:g}\\1', da, count=1)
    return f'/Helv {size:g} Tf 0 g'

# FIX-WRAP-FIT: wrap-aware text size for big multi-line boxes.
# _fit_font_da (above) only sizes answers that contain line breaks and
# treats each line as one unwrapped line, so a normal paragraph answer
# keeps the template's auto size. iPhone and other strict viewers then
# draw it at about 12pt and cut off the bottom. This measures the text
# with the real Helvetica letter widths, wraps it word by word the way a
# viewer does, and picks the largest size (max_pt down to min_pt, half
# points) whose wrapped lines fit the box. Callers opt in per box (only
# Form 15 for now), so no other form changes.
_HELV_W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
           556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
           1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
           667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
           333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
           556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]


def _helv_width(s, pt):
    """Width of s in points, Helvetica at pt (unknown letters count as 556)."""
    return sum(_HELV_W[ord(c) - 32] if 32 <= ord(c) < 127 else 556 for c in s) * pt / 1000.0


def _wrapped_line_count(text, width, pt):
    """Lines needed to show text in a box `width` points wide at pt."""
    lines = 0
    for para in str(text).replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        words = para.split(' ')
        cur = ''
        n = 1
        for word in words:
            trial = word if not cur else cur + ' ' + word
            if _helv_width(trial, pt) <= width:
                cur = trial
                continue
            # A word longer than the whole line is broken letter by letter.
            if _helv_width(word, pt) > width:
                piece = cur + (' ' if cur else '')
                for ch in word:
                    if _helv_width(piece + ch, pt) > width and piece.strip():
                        n += 1
                        piece = ch
                    else:
                        piece += ch
                cur = piece
            else:
                n += 1
                cur = word
        lines += n
    return lines


def _wrap_fit_pt(text, box_w, box_h, max_pt=10.0, min_pt=7.0):
    """Largest size (half points) at which text, wrapped, fits the box.
    Returns (size, fits). If it can't fit even at min_pt, returns
    (min_pt, False) - the caller decides what to do (log it; a screen
    warning is a separate step)."""
    usable_w = (box_w - 6.0) * 0.95   # 2pt padding each side + 1pt border, 5% safety
    usable_h = box_h - 4.0
    pt = float(max_pt)
    while pt >= min_pt:
        if _wrapped_line_count(text, usable_w, pt) * pt * 1.2 <= usable_h:
            return pt, True
        pt -= 0.5
    return float(min_pt), False


def _box_sizes(input_path, names):
    """{field name: (width, height)} for the named text boxes in a template."""
    import pypdf
    out = {}
    try:
        for page in pypdf.PdfReader(input_path).pages:
            for annot in page.get('/Annots') or []:
                obj = annot.get_object()
                t = obj.get('/T')
                if (t is None or str(t) not in names) and '/Parent' in obj:
                    # Some boxes keep all or part of their name on parent
                    # objects; a "." in a name splits it into levels, e.g.
                    # Form 15 page 2 "income (0.00) 1". Also try the full
                    # joined name, the same match _write_pdf uses.
                    t = _get_field_full_path(obj)
                if t is not None and str(t) in names and '/Rect' in obj:
                    r = [float(x) for x in obj['/Rect']]
                    out[str(t)] = (abs(r[2] - r[0]), abs(r[3] - r[1]))
    except Exception:
        pass
    return out


def _set_need_appearances(writer):
    """FIX-NEED-APPEARANCES: the shared writers clear each filled field's
    stored appearance (/AP) so the new value can be drawn - but never told
    viewers to redraw. Strict viewers (Poppler, often Adobe Acrobat) then
    show the field EMPTY even though the value is in the file. Set the
    AcroForm /NeedAppearances flag, exactly as the Form 8 / Form 13 /
    Form 13.1 / generic writers already do."""
    import pypdf
    try:
        root = writer._root_object
        if '/AcroForm' in root:
            root['/AcroForm'].get_object().update({
                pypdf.generic.NameObject('/NeedAppearances'): pypdf.generic.BooleanObject(True)})
    except Exception:
        pass


# FIX-CONTINUATION-PAGE: some court forms have small answer boxes and say
# "Attach extra pages if you need more space". This builds plain
# continuation pages (US Letter, Helvetica, no extra libraries) that a
# filler appends after the form, so a long answer is printed in full
# instead of being shrunk or cut off. Used by Form 35.1 first.
_WINANSI_EXTRA = {0x20AC: 128, 0x2026: 133, 0x2018: 145, 0x2019: 146, 0x201C: 147,
                  0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2122: 153}
_WINANSI_SUBST = {0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '-', 0x00A0: ' ',
                  0x201A: "'", 0x201E: '"', 0x2032: "'", 0x2033: '"'}


def _winansi_text(s):
    """Escaped PDF string body for s in WinAnsi (unknown letters -> '?')."""
    out = []
    for ch in str(s):
        c = ord(ch)
        if ch in '()\\':
            out.append('\\' + ch)
        elif 32 <= c < 127:
            out.append(ch)
        elif c in _WINANSI_EXTRA:
            out.append('\\%03o' % _WINANSI_EXTRA[c])
        elif c in _WINANSI_SUBST:
            out.append(_WINANSI_SUBST[c])
        elif 160 <= c < 256:
            out.append('\\%03o' % c)
        elif ch == '\t':
            out.append('    ')
        else:
            out.append('?')
    return ''.join(out)


def _wrap_lines(text, width, pt):
    """Wrap text into lines no wider than width at pt (Helvetica)."""
    lines = []
    for para in str(text).replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        if not para.strip():
            lines.append('')
            continue
        cur = ''
        for word in para.split(' '):
            trial = word if not cur else cur + ' ' + word
            if _helv_width(trial, pt) <= width:
                cur = trial
                continue
            if cur:
                lines.append(cur)
            cur = ''
            # A word longer than the line is broken letter by letter.
            for ch in word:
                if _helv_width(cur + ch, pt) > width and cur:
                    lines.append(cur)
                    cur = ch
                else:
                    cur += ch
        lines.append(cur)
    return lines


def _continuation_pdf_bytes(title, header_rows, items):
    """PDF bytes for continuation pages.
    title: list of lines (bold) at the top of every page.
    header_rows: [(label, value)] printed on the first page.
    items: [(heading, text)] printed in order, each heading in bold."""
    W, H, L, R, TOP, BOT = 612, 792, 54, 54, 54, 60
    body_w = W - L - R
    BODY, LEAD = 11, 14.5
    pages, ops = [], []
    state = {'y': 0}

    def text(x, y, s, font='F1', size=BODY):
        ops.append('BT /%s %g Tf %.2f %.2f Td (%s) Tj ET' % (font, size, x, y, _winansi_text(s)))

    def new_page():
        if ops:
            pages.append(list(ops))
            ops.clear()
        y = H - TOP
        for t in title:
            text(L, y, t, 'F2', 12)
            y -= 15
        ops.append('0.5 w %d %.2f m %d %.2f l S' % (L, y + 6, W - R, y + 6))
        state['y'] = y - 14

    def need(h):
        if state['y'] - h < BOT:
            new_page()

    new_page()
    for label, value in header_rows:
        if not str(value or '').strip():
            continue
        need(LEAD)
        text(L, state['y'], label, 'F2')
        text(L + 140, state['y'], str(value))
        state['y'] -= LEAD
    state['y'] -= 8
    for heading, body in items:
        hl = _wrap_lines(heading, body_w * 0.9, BODY)   # bold letters are ~8% wider
        need(LEAD * (len(hl) + 2))
        for ln in hl:
            text(L, state['y'], ln, 'F2')
            state['y'] -= LEAD
        for ln in _wrap_lines(body, body_w, BODY):
            need(LEAD)
            if ln:
                text(L, state['y'], ln)
            state['y'] -= LEAD
        state['y'] -= 10
    pages.append(list(ops))

    n = len(pages)
    objs = {1: b'<< /Type /Catalog /Pages 2 0 R >>',
            3: b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
            4: b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'}
    kids = []
    for i, pops in enumerate(pages):
        pops = pops + ['BT /F1 9 Tf %d %d Td (%s) Tj ET' % (W - R - 150, 36, 'Continuation page %d of %d' % (i + 1, n))]
        stream = '\n'.join(pops).encode('latin-1', errors='replace')
        pn, cn = 5 + i * 2, 6 + i * 2
        kids.append(pn)
        objs[pn] = (b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Contents %d 0 R '
                    b'/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>') % (W, H, cn)
        objs[cn] = b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream'
    objs[2] = ('<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join('%d 0 R' % k for k in kids), n)).encode()
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offs = {}
    for k in sorted(objs):
        offs[k] = len(out)
        out += b'%d 0 obj\n' % k + objs[k] + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (max(objs) + 1)
    for k in range(1, max(objs) + 1):
        out += b'%010d 00000 n \n' % offs[k]
    out += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (max(objs) + 1, xref)
    return bytes(out)


def _append_continuation(output_path, title, header_rows, items):
    """Append continuation pages to the filled PDF at output_path."""
    import io
    extra = pypdf.PdfReader(io.BytesIO(_continuation_pdf_bytes(title, header_rows, items)))
    base = pypdf.PdfReader(output_path)
    wr = pypdf.PdfWriter()
    wr.append(base)
    for pg in extra.pages:
        wr.add_page(pg)
    _set_need_appearances(wr)
    with open(output_path, 'wb') as fh:
        wr.write(fh)
    return len(extra.pages)


def _write_pdf(input_path, output_path, fields, checkboxes=None, short_line_pt=None, font_pt=None):
    """Generic PDF writer used by all fill functions below."""
    import pypdf
    checkboxes = checkboxes or {}
    font_pt = font_pt or {}
    reader = pypdf.PdfReader(input_path)
    writer = pypdf.PdfWriter()
    writer.append(reader)
    filled = 0
    for page in writer.pages:
        if '/Annots' not in page:
            continue
        for annot in page['/Annots']:
            obj = annot.get_object()
            if obj.get('/Subtype') != '/Widget':
                continue
            # FIX-WRITER-FULLNAME (Oct 19 2026, same two bugs fixed for Form 13):
            # (a) some widgets keep /FT (and /T) on a parent field - inherit it;
            # (b) a "." in a field name splits it into nested parts, so also
            #     match on the fully-qualified name (all /T up the parent chain
            #     joined with "."). The widget's own /T still matches, so every
            #     existing mapping keeps working.
            parent = None
            if '/Parent' in obj:
                try:
                    parent = obj['/Parent'].get_object()
                except Exception:
                    parent = None
            ft = obj.get('/FT') or (parent.get('/FT') if parent is not None else None)
            own_t = obj.get('/T')
            full_t = _get_field_full_path(obj)
            t = str(own_t) if own_t is not None and str(own_t) in (fields if ft == '/Tx' else checkboxes) else full_t
            if ft == '/Tx' and t in fields:
                obj.update({
                    pypdf.generic.NameObject('/V'):  pypdf.generic.create_string_object(str(fields[t])),
                    pypdf.generic.NameObject('/AP'): pypdf.generic.DictionaryObject(),
                })
                _da = _fit_font_da(obj, parent, fields[t], short_line_pt=short_line_pt)
                if t in font_pt:
                    _da = f'/Helv {float(font_pt[t]):g} Tf 0 g'
                if _da:
                    obj.update({pypdf.generic.NameObject('/DA'): pypdf.generic.create_string_object(_da)})
                if own_t is None and parent is not None:
                    parent.update({pypdf.generic.NameObject('/V'): pypdf.generic.create_string_object(str(fields[t]))})
                    # FIX-F351-Q6Q7-ROWS: a box whose name sits on a parent
                    # object (Form 35.1 Q6 "Sentence received 1") was drawn
                    # with the parent's auto size by some viewers. A size
                    # chosen to fit goes on the parent too.
                    if t in font_pt:
                        parent.update({pypdf.generic.NameObject('/DA'): pypdf.generic.create_string_object(_da)})
                filled += 1
            elif ft == '/Btn' and t in checkboxes:
                v = _checkbox_on_state(obj) if checkboxes[t] else '/Off'
                obj.update({
                    pypdf.generic.NameObject('/V'):  pypdf.generic.NameObject(v),
                    pypdf.generic.NameObject('/AS'): pypdf.generic.NameObject(v),
                })
                if own_t is None and parent is not None:
                    parent.update({pypdf.generic.NameObject('/V'): pypdf.generic.NameObject(v)})
                filled += 1
    _set_need_appearances(writer)
    with open(output_path, 'wb') as f:
        writer.write(f)
    return filled


def _get_field_full_path(widget_obj):
    """Walk /Parent chain to build the full dotted path for a LiveCycle field widget."""
    parts = []
    cur = widget_obj
    while cur is not None:
        t = cur.get('/T')
        if t is not None:
            parts.append(str(t))
        parent_ref = cur.get('/Parent')
        if parent_ref is None:
            break
        try:
            cur = parent_ref.get_object()
        except Exception:
            break
    parts.reverse()
    return '.'.join(parts)


def _write_pdf_lc(input_path, output_path, fields):
    """
    LiveCycle-aware PDF writer.
    Resolves each widget's full dotted path via /Parent chain before matching
    against the supplied fields dict.  Also handles /Ch (choice) fields.
    Returns the number of fields filled.
    """
    reader = pypdf.PdfReader(input_path)
    writer = pypdf.PdfWriter()
    writer.append(reader)
    filled = 0
    for page in writer.pages:
        if '/Annots' not in page:
            continue
        for annot in page['/Annots']:
            obj = annot.get_object()
            if obj.get('/Subtype') != '/Widget':
                continue
            ft = obj.get('/FT')
            if ft not in ('/Tx', '/Ch'):
                continue
            full_path = _get_field_full_path(obj)
            if full_path in fields:
                val = str(fields[full_path])
                obj.update({
                    pypdf.generic.NameObject('/V'):  pypdf.generic.create_string_object(val),
                    pypdf.generic.NameObject('/AP'): pypdf.generic.DictionaryObject(),
                })
                filled += 1
    _set_need_appearances(writer)
    with open(output_path, 'wb') as f:
        writer.write(f)
    return filled


def _header(d, pages=1):
    """Build standard court-header fields dict shared across most forms."""
    courthouse = d.get('courthouse', d.get('court_name', ''))
    cn = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    ca = COURTHOUSE_ADDRESSES_FE.get(courthouse, COURTHOUSE_ADDRESSES_FE.get(cn, ''))
    fnum = d.get('court_file_number', d.get('fileNumber', ''))
    ap = d.get('applicant_full_name', d.get('applicantFullName', ''))
    ap_addr = d.get('applicant_address', d.get('applicantAddress', ''))
    ap_ph   = format_phone(d.get('applicant_phone', d.get('applicantPhone', '')))
    ap_em   = d.get('applicant_email', d.get('applicantEmail', ''))
    ap_law  = d.get('applicant_lawyer', '')
    re_name = d.get('respondent_full_name', d.get('respondentFullName', ''))
    re_addr = d.get('respondent_address', d.get('respondentAddress', ''))
    re_ph   = format_phone(d.get('respondent_phone', d.get('respondentPhone', '')))
    re_em   = d.get('respondent_email', d.get('respondentEmail', ''))
    re_law  = d.get('respondent_lawyer', '')
    h = {
        'Name of court': cn, 'Name of Court': cn,
        'Court office address': ca, 'Court Office Address': ca,
        'Court File Number': fnum,
    }
    for pg in range(1, pages + 1):
        h[f'Court File Number, page {pg}'] = fnum
        h[f'Court File Number, Page {pg}'] = fnum
        h[f'Court File Number - page {pg}'] = fnum
        h[f'Court File Number - Page {pg}'] = fnum
        h[f'Court File Number, page {pg}'] = fnum
    # FIX-HEADER-FULL-ADDRESS: the "address for service" block must include
    # street & number, municipality, province and postal code (the form's own
    # label says so). It used the street line only. Unit and "N/A" handling
    # come from _real_unit(); empty Tel/Email lines are left out.
    def _party_block(name, street, unit, city, prov, postal, phone, email):
        street_line = _fmt_addr(street, unit, '', '', '')
        place_line = ', '.join(x for x in [(city or '').strip(),
                                           ' '.join(y for y in [(prov or '').strip(), (postal or '').strip()] if y)] if x)
        lines = [name, street_line, place_line]
        if phone: lines.append(f'Tel: {phone}')
        if email: lines.append(f'Email: {email}')
        has_addr = bool(street_line or place_line)
        return '\n'.join(x for x in lines if x) if has_addr else name
    ap_full = _party_block(ap, ap_addr,
                           d.get('applicant_unit', ''), d.get('applicant_city', d.get('applicantCity', '')),
                           d.get('applicant_province', d.get('applicantProvince', '')),
                           d.get('applicant_postal_code', d.get('applicantPostalCode', '')), ap_ph, ap_em)
    re_full = _party_block(re_name, re_addr,
                           d.get('respondent_unit', ''), d.get('respondent_city', d.get('respondentCity', '')),
                           d.get('respondent_province', d.get('respondentProvince', '')),
                           d.get('respondent_postal_code', d.get('respondentPostalCode', '')), re_ph, re_em)
    h["Applicant's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = ap_full
    h["Applicant(s) - Full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = ap_full
    h["Full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = ap_full
    h['Applicant - Full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)'] = ap_full
    h["Respondent's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = re_full
    h["Respondent(s) - Full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = re_full
    h['Respondent full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)'] = re_full
    h['Respondent - Full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)'] = re_full
    h["Applicant lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = ap_law
    h["Applicant(s) - Lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = ap_law
    h["Applicant(s) Lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = ap_law
    h["Respondent lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = re_law
    h["Respondent(s) - Lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = re_law
    h["Respondent(s) Lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"] = re_law
    h['Name & address of Children\'s Lawyer\'s agent (street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)) and name of person represented'] = d.get('childrens_lawyer', '')
    return h


# ─────────────────────────────────────────────────────────────────────────────
# Form 4 — Notice of Change in Representation
# ─────────────────────────────────────────────────────────────────────────────
def fill_form4(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=2)
    fields['Name'] = d.get('filer_full_name', d.get('applicant_full_name', ''))
    fields['Date of signature'] = d.get('date_signed', '')
    fields['Name, address, telephone & fax numbers and e-mail address'] = d.get('new_rep_address', '')
    fields['Additional text'] = d.get('additional_info', '')
    checkboxes = {}
    rep_change = d.get('representation_change', '').lower()
    if 'new representative' in rep_change or 'new lawyer' in rep_change:
        checkboxes['I have chosen a new licensed representative'] = True
    elif 'acting in person' in rep_change or 'self' in rep_change:
        checkboxes['I have decided to act in person'] = True
    else:
        checkboxes['I have chosen to be represented by a licensed representative'] = True
    n = _write_pdf(input_path, output_path, fields, checkboxes)
    sys.stderr.write(f'[fill_form4] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 6B — Affidavit of Service
# ─────────────────────────────────────────────────────────────────────────────
def fill_form6b(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', d.get('court_name', ''))
    ca = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    fnum = d.get('court_file_number', d.get('fileNumber', ''))
    ap   = d.get('applicant_full_name', d.get('applicantFullName', ''))
    ap_a = d.get('applicant_address', '')
    re_n = d.get('respondent_full_name', d.get('respondentFullName', ''))
    re_a = d.get('respondent_address', '')
    ap_law = d.get('applicant_lawyer_name', '')
    ap_law_a = d.get('applicant_lawyer_address', '')
    re_law = d.get('respondent_lawyer_name', '')
    re_law_a = d.get('respondent_lawyer_address', '')
    server = d.get('serverFullName', d.get('server_full_name', ''))
    server_a = d.get('serverAddress', d.get('server_address', ''))
    person_served = d.get('personServed', d.get('person_served', ''))
    svc_date = d.get('serviceDate', d.get('service_date', ''))
    svc_method = d.get('serviceMethod', d.get('service_method', ''))
    docs = d.get('documentsList', d.get('documents_list', ''))
    svc_addr = d.get('serviceAddress', d.get('service_address', ''))
    email_served = d.get('emailAddress', d.get('email_address', ''))
    comm_date = d.get('commissioningDate', d.get('commissioning_date', ''))
    comm_muni = d.get('commissioningMunicipality', d.get('commissioning_municipality', ''))
    fields = {
        # Page 1 header
        'form1[0].page1[0].body[0].courtDetails[0].courtFileNumber[0]': fnum,
        'form1[0].page1[0].body[0].courtDetails[0].court[0].#subform[0].courtOfficeAddress[0]': ca,
        'form1[0].page1[0].body[0].courtDetails[0].date[0]': svc_date,
        # Applicant / Respondent party boxes
        'form1[0].page1[0].body[0].applicants[0].appliant[0].textfield[0]': ap,
        'form1[0].page1[0].body[0].applicants[0].appliant[0].textfield[1]': ap_a,
        'form1[0].page1[0].body[0].applicants[0].applicantLawyer[0].textfield[0]': ap_law,
        'form1[0].page1[0].body[0].applicants[0].applicantLawyer[0].textfield[1]': ap_law_a,
        'form1[0].page1[0].body[0].respondents[0].respondant[0].textfield[0]': re_n,
        'form1[0].page1[0].body[0].respondents[0].respondant[0].textfield[1]': re_a,
        'form1[0].page1[0].body[0].respondents[0].respondantLawyer[0].textfield[0]': re_law,
        'form1[0].page1[0].body[0].respondents[0].respondantLawyer[0].textfield[1]': re_law_a,
        # Section 4 — person serving (deponent identity)
        'form1[0].page1[0].body[0].four[0].liveIn[0]': server,
        'form1[0].page1[0].body[0].four[0].liveIn[1]': server_a,
        'form1[0].page1[0].body[0].four[0].liveIn[2]': person_served,
        'form1[0].page1[0].body[0].four[0].liveIn[3]': svc_addr,
        'form1[0].page1[0].body[0].four[0].liveIn[4]': docs,
        # Service table rows (Row1[N]: date + method)
        'form1[0].page1[0].body[0].#subform[4].Table1[0].Row1[0].Cell1[0]': svc_date,
        'form1[0].page1[0].body[0].#subform[4].Table1[0].Row1[0].Cell2[0]': svc_method,
        # Page 2 header repetitions
        'form1[0].Master[0].Page2[0].#subform[0].courtFileNumber[0]': fnum,
        'form1[0].Master[0].Page2[0].#subform[0].#subform[1].date[0]': svc_date,
        'form1[0].Master[0].Page2[1].#subform[0].courtFileNumber[0]': fnum,
        'form1[0].Master[0].Page2[1].#subform[0].#subform[1].date[0]': svc_date,
        # Page 3 — server name + commissioner
        'form1[0].page3[0].body[0].six[0].applicant[0].#subform[0].fullName[0]': server,
        'form1[0].page3[0].body[0].six[0].#subform[3].liveIn[1]': comm_muni,
        'form1[0].page3[0].body[0].six[0].applicant[0].#subform[1].commissioner[0]': comm_date,
        # Email service
        'form1[0].page2[0].body[0].liveIn[0]': email_served,
    }
    n = _write_pdf_lc(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form6b] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 10 — Answer
# ─────────────────────────────────────────────────────────────────────────────
_F10_FACTS = 'Facts that form the legal basis for my position in paragraph 2'
_F10_GUARD_NAMES = ["guardianship over child's property (claim must be served on the Children\u2019s Lawyer and the child must currently have property)"]


def _f10_pick(d, label, f10_key, generic_keys, phone=False):
    """FIX-F10-ANSWERS: one Form 10 answer. The Form 10 screens save under
    f10_<section>_<key>; other forms in the same case may have saved the
    same fact under the shared applicant_/respondent_ keys. Use whichever is
    answered. If both are answered and differ, leave it blank and log it -
    never guess."""
    import re
    def _v(k):
        return str(d.get(k) or '').strip()
    a = _v(f10_key)
    g = next((_v(k) for k in generic_keys if _v(k)), '')
    if a and g:
        if phone:
            same = re.sub(r'\D', '', a) == re.sub(r'\D', '', g)
        else:
            same = ' '.join(a.casefold().split()) == ' '.join(g.casefold().split())
        if not same:
            sys.stderr.write(f'[fill_form10] conflict, left blank: {label}\n')
            return ''
    return a or g


def _f10_match_odd_boxes(path):
    """FIX-F10-CLAIM-PAGE: two page 4 boxes in the court template (06 contact
    with leave, and 50 Other) draw a tiny tick with no box outline when
    ticked. Give them the same look as the other boxes on that page (a
    framed square), keeping their own /Yes state name."""
    import pypdf
    import pypdf.generic as g
    odd = {'contact with child(ren) (this requires court leave)', 'Other'}
    r = pypdf.PdfReader(path)
    w = pypdf.PdfWriter(clone_from=r)
    page = w.pages[3]
    model = None
    targets = []
    for ref in page.get('/Annots') or []:
        a = ref.get_object()
        t = a.get('/T')
        if t == 'a divorce':
            model = a
        elif t in odd:
            targets.append(a)
    if model is None or not targets:
        return
    n = model['/AP']['/N']
    on_ref = n.raw_get('/On')
    off_ref = n.raw_get('/Off')
    for a in targets:
        a[g.NameObject('/AP')] = g.DictionaryObject({g.NameObject('/N'): g.DictionaryObject({
            g.NameObject('/Yes'): on_ref, g.NameObject('/Off'): off_ref})})
        a[g.NameObject('/MK')] = model['/MK']
    with open(path, 'wb') as fh:
        w.write(fh)


def fill_form10(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=5)
    fields['Name of court'] = fields.pop('Name of court', '')  # form10 uses lower-case key
    fields['Address of added party'] = d.get('added_party_address', '')
    fields['Name - Applicant(s) Lawyer'] = d.get('applicant_lawyer_name', '')
    fields['Address - Applicant(s) Lawyer'] = d.get('applicant_lawyer_address', '')
    fields['Phone & fax - Applicant(s) Lawyer'] = d.get('applicant_lawyer_phone', '')
    fields['Email - Applicant(s) Lawyer'] = d.get('applicant_lawyer_email', '')
    fields['Name - Respondent(s) Lawyer'] = d.get('respondent_lawyer_name', '')

    # FIX-F10-ANSWERS: the parties' details from the Form 10 screens
    # (f10_respondent = the person answering, f10_applicant = the person
    # who started the case), falling back to the shared keys.
    def _party(role):
        P = 'f10_%s_' % role
        name = _f10_pick(d, role + ' name', P + 'full_name', ['%s_full_name' % role, '%sFullName' % role])
        street = _f10_pick(d, role + ' address', P + 'address', ['%s_address' % role, '%sAddress' % role])
        city = _f10_pick(d, role + ' city', P + 'city', ['%s_city' % role, '%sCity' % role])
        prov = _f10_pick(d, role + ' province', P + 'province', ['%s_province' % role, '%sProvince' % role])
        postal = _f10_pick(d, role + ' postal code', P + 'postal_code', ['%s_postal_code' % role, '%sPostalCode' % role])
        phone = _f10_pick(d, role + ' phone', P + 'phone', ['%s_phone' % role, '%sPhone' % role], phone=True)
        email = _f10_pick(d, role + ' email', P + 'email', ['%s_email' % role, '%sEmail' % role])
        place = ' '.join(x for x in [prov, postal] if x)
        addr = ', '.join(x for x in [street, city, place] if x)
        return name, addr, format_phone(phone) if phone else '', email
    re_name, re_addr, re_ph, re_em = _party('respondent')
    ap_name, ap_addr, ap_ph, ap_em = _party('applicant')
    fields['Full legal name - Respondent(s)'] = re_name
    fields['Address - Respondent(s)'] = re_addr
    fields['Phone & fax - Respondent(s)'] = re_ph
    fields['Email - Respondent(s)'] = re_em
    fields['Full legal name - Applicant(s)'] = ap_name
    fields['Address - Applicant(s)'] = ap_addr
    fields['Phone & fax - Applicant(s)'] = ap_ph
    fields['Email - Applicant(s)'] = ap_em
    fields['Full legal name'] = re_name          # "My name is"

    # Paragraphs 1, 2 and 6, and the Claim by Respondent details (page 4).
    def _txt(k):
        return str(d.get(k) or '').replace('\r\n', '\n').replace('\t', ' ').strip()
    big = [
        ('I agree with the following claim(s) made by the applicant',
         _txt('f10_dispute_agreed_claims'), '1', 'Paragraph 1. I agree with the following claim(s) made by the applicant'),
        (')', _txt('f10_dispute_disputed_claims') or _txt('disagree_claims'),
         '2', 'Paragraph 2. I do not agree with the following claim(s) made by the applicant'),
        (_F10_FACTS, _txt('f10_dispute_important_facts'),
         '6', 'Paragraph 6. The important facts that form the legal basis for my position in paragraph 2'),
        ('Details of the order that you want the court to make', _txt('f10_dispute_own_claims'),
         'Claim by Respondent', 'Claim by Respondent. Details of the order that I want the court to make'),
        # FIX-F10-CLAIM-FACTS: page 5, facts supporting the respondent's own claim(s)
        ('Facts that form the legal basis for your claim(s)', _txt('f10_dispute_own_claim_facts'),
         'page 5', 'Page 5. Important facts supporting my claim(s)'),
    ]
    line = ['Full legal name - Respondent(s)', 'Address - Respondent(s)',
            'Phone & fax - Respondent(s)', 'Email - Respondent(s)',
            'Full legal name - Applicant(s)', 'Address - Applicant(s)',
            'Phone & fax - Applicant(s)', 'Email - Applicant(s)', 'Full legal name']
    for k, v, _p, _h in big:
        if v:                     # empty answer: leave the box as the court printed it
            fields[k] = v
    tpl = input_path
    font = {}
    more = []
    want = [k for k in line + [b[0] for b in big] if str(fields.get(k) or '').strip()]
    sz = _box_sizes(tpl, set(want)) if want else {}
    for k in want:
        if k not in sz:
            sys.stderr.write(f'[fill_form10] box not found: {k[:60]}\n')
            continue
        w_, h_ = sz[k]
        if k in line:
            pt = 10.0
            while pt > 7.0 and _wrapped_line_count(fields[k], (w_ - 6.0) * 0.95, pt) > 1:
                pt -= 0.5
            font[k] = pt
            if _wrapped_line_count(fields[k], (w_ - 6.0) * 0.95, pt) > 1:
                sys.stderr.write(f'[fill_form10] tight fit at 7pt: {k[:60]}\n')
            continue
        pt, ok = _wrap_fit_pt(fields[k], w_, h_)
        if ok:
            font[k] = pt
        else:
            b = next(b for b in big if b[0] == k)
            sys.stderr.write(f'[fill_form10] too long for its box, continued on attached page: {b[2]}\n')
            more.append((b[3], fields[k]))
            fields[k] = ('See attached continuation page, %s.' % b[2]) if b[2] in ('Claim by Respondent', 'page 5') \
                else 'See attached continuation page, paragraph %s.' % b[2]
            font[k] = 9.0

    # FIX-F10-TICKS: page 2 tick boxes from the saved answers.
    #   Para 3 (dismiss with costs)  <- f10_dispute_ask_dismiss = yes
    #   Para 4 (claim of my own)     <- f10_dispute_own_claims has text
    #                                   (or the legacy making_own_claim = yes)
    #   Para 5 (family history)      <- f10_dispute_family_history
    #                                   'correct' / 'notCorrect'
    # No answer = no tick (never guessed).
    checkboxes = {}
    if _is_yes(d.get('f10_dispute_ask_dismiss', '')):
        checkboxes['I am asking that the applicant\u2019s claim (except for the parts with which I agree) be dismissed with costs'] = True
    _own_types = [t.strip() for t in str(d.get('f10_dispute_own_claim_types') or '').split(',') if t.strip()]
    if _txt('f10_dispute_own_claims') or _own_types or _is_yes(d.get('making_own_claim', '')):
        checkboxes['I am making a claim of my own'] = True
    fh = str(d.get('f10_dispute_family_history') or '').strip()
    if fh in ('correct', 'notCorrect'):
        checkboxes['The FAMILY HISTORY, as set out in the application'] = True
        checkboxes['is correct' if fh == 'correct' else 'is not correct'] = True
    if fh == 'notCorrect':
        diff = _txt('f10_dispute_family_history_differences')
        if diff:
            # The form says to attach your own Family History page; it goes on
            # the continuation pages, in paragraph order (before para 6).
            entry = ("Paragraph 5. Respondent's Family History: the parts of the "
                     "applicant's Family History that are not correct, with the correct information", diff)
            at = next((i for i, m in enumerate(more)
                       if m[0].startswith('Paragraph 6') or m[0].startswith('Claim by Respondent')), len(more))
            more.insert(at, entry)
        else:
            sys.stderr.write('[fill_form10] family history marked not correct but no details given\n')

    # FIX-F10-CLAIM-PAGE: page 4 (Claim by Respondent) from the saved answers.
    if checkboxes.get('I am making a claim of my own'):
        # Para 7: who the claim is against. The two "boxes" are tiny text
        # fields in the template, so they get an X.
        against = str(d.get('f10_dispute_own_claim_against') or '').strip()
        added = str(d.get('f10_dispute_own_claim_added_party') or '').strip()
        if not against and not added and not str(d.get('added_party_address') or '').strip():
            # No added party anywhere in the case: the only other party is
            # the applicant, so this is not a guess.
            against = 'applicant'
        if against == 'applicant':
            fields['the applicant'] = 'X'
        elif against == 'addedParty':
            fields['an added party'] = 'X'
            fields['Full legal name - added party'] = added
            if not added:
                sys.stderr.write('[fill_form10] claim against an added party but no name given\n')
        # Para 8: the claim boxes. Divorce and property claims are only for
        # a Superior Court of Justice (the form's own column notes); at an
        # Ontario Court of Justice they are left unticked and logged.
        court = str(fields.get('Name of court') or '')
        ocj = 'Ontario Court of Justice' in court
        divorce = 'divorce' in _own_types and not ocj
        sfx = '1' if divorce else '2'     # Divorce Act column only with a divorce claim
        M = {
            'divorce': 'a divorce',
            'supportForMe': 'support for me ' + sfx,
            'childSupportTable': 'support for child(ren) \u2013 table amount ' + sfx,
            'childSupportOther': ('support for child(ren) - other than table amount 1' if divorce
                                  else 'support for child(ren) \u2013 other than table amount 2'),
            'decisionMaking': 'decision-making responsibility for child(ren) ' + sfx,
            'parentingTime': 'parenting time with child(ren) ' + sfx,
            'contactWithChildren': ('contact with child(ren) (this requires court leave)' if divorce
                                    else 'contact with child(ren) (this does not require court leave)'),
            'restrainingOrder': 'restraining/non-harassment order',
            'spousalSupportIndexing': 'indexing spousal support',
            'parentageDeclaration': 'declaration of parentage',
            'guardianshipProperty': next((k for k in _F10_GUARD_NAMES), ''),
            'equalization': 'equalization of net family properties',
            'exclusivePossession': 'exclusive possession of matrimonial home',
            'exclusiveContents': 'exclusive possession of contents of matrimonial home',
            'freezingAssets': 'freezing assets',
            'saleOfProperty': 'sale of family property',
            'costs': 'costs',
            'annulment': 'annulment of marriage',
            'prejudgmentInterest': 'prejudgment interest',
            'arbitration': 'claims relating to a family arbitration',
            'other': 'Other',
        }
        scj_only = {'divorce', 'equalization', 'exclusivePossession', 'exclusiveContents',
                    'freezingAssets', 'saleOfProperty'}
        for t in _own_types:
            if ocj and t in scj_only:
                sys.stderr.write(f'[fill_form10] claim {t} is only for a Superior Court of Justice; left unticked\n')
                continue
            name = M.get(t)
            if name:
                checkboxes[name] = True
            else:
                sys.stderr.write(f'[fill_form10] unknown claim type: {t}\n')
        if 'other' in _own_types:
            other = _txt('f10_dispute_own_claim_other')
            fields['Other - Specify'] = other
            if other:
                font['Other - Specify'] = 8.0
    n = _write_pdf(tpl, output_path, fields, checkboxes, font_pt=font)
    try:
        _f10_match_odd_boxes(output_path)
    except Exception as e:
        sys.stderr.write(f'[fill_form10] box style fix skipped: {e}\n')
    if more:
        try:
            np_ = _append_continuation(
                output_path,
                ['Form 10: Answer', 'Continuation of answers that did not fit on the form'],
                [('Court file number:', (d.get('court_file_number') or d.get('fileNumber') or '').strip()),
                 ('Applicant(s):', ap_name),
                 ('Respondent(s):', re_name)],
                more)
            sys.stderr.write(f'[fill_form10] appended {np_} continuation page(s)\n')
        except Exception as e:
            sys.stderr.write(f'[fill_form10] continuation page failed: {e}\n')
    sys.stderr.write(f'[fill_form10] Filled {n} fields\n')
    return n



# ─────────────────────────────────────────────────────────────────────────────
# Form 10A — Reply
# ─────────────────────────────────────────────────────────────────────────────
def fill_form10a(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', '')
    cn = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    ca = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    ap = d.get('applicant_name', d.get('applicant_full_name', ''))
    ap_addr = d.get('applicant_address', '')
    ap_ph = format_phone(d.get('applicant_phone', ''))
    ap_em = d.get('applicant_email', '')
    re_name = d.get('respondent_name', d.get('respondent_full_name', ''))
    re_addr = d.get('respondent_address', '')
    fields = {
        'Name of court': cn,
        'Court office address': ca,
        'Court File Number': d.get('fileNumber', d.get('court_file_number', '')),
        'Full legal name': ap,
        'Address for service': ap_addr,
        'Phone number': format_phone(ap_ph),
        'Email': ap_em,
        "Respondent's full legal name": re_name,
        "Respondent's address": re_addr,
        'Claims Agreed': d.get('claims_agreed', ''),
        'Claims Disagreed': d.get('claims_disagreed', ''),
        'Dismiss Details': d.get('dismiss_details', ''),
        'Supporting Facts': d.get('supporting_facts', ''),
        'Signature Date': d.get('signature_date', d.get('form_date', '')),
        'Date of Reply': d.get('form_date', ''),
        'Deponent Name': d.get('deponent_name', ap),
    }
    checkboxes = {}
    # FIX-F10A-DISMISS: there is no box named 'Dismiss claim'. The real box
    # is the dotted LiveCycle name under the sentence "I am asking that the
    # respondent's claim ... be dismissed with costs." The shared writer
    # matches that full name (FIX-WRITER-FULLNAME).
    if d.get('dismiss_request', '').lower() in ('yes', 'true', '1'):
        checkboxes['form1[0].page1[0].body[0].instrunctionFinancial[0].applicant[0].q4[0].claim[0]'] = True
    n = _write_pdf(input_path, output_path, fields, checkboxes)
    sys.stderr.write(f'[fill_form10a] Filled {n} fields\n')
    return n



# ─────────────────────────────────────────────────────────────────────────────
# Form 34A — Affidavit of Parentage
# ─────────────────────────────────────────────────────────────────────────────
def fill_form34a(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', '')
    cn = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    ca = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    ap = d.get('applicant_name', d.get('applicant_full_name', ''))
    re_name = d.get('respondent_name', d.get('respondent_full_name', ''))
    deponent = d.get('deponent_name', ap)
    relationship = d.get('relationship_to_child', '')
    marital_status = d.get('marital_status_at_birth', '')
    spouse_partner = d.get('spouse_partner_name', '')
    child_name = d.get('child_full_legal_name', '')
    child_dob = d.get('child_date_of_birth', '')
    child_sex = d.get('child_sex', '')
    birth_reg = d.get('birth_registration_number', '')
    birth_place = d.get('birth_place', '')
    municipality = d.get('municipality', '')
    fields = {
        'Name of court': cn,
        'Court office address': ca,
        'Court File Number': d.get('fileNumber', d.get('court_file_number', '')),
        "Applicant's full legal name": ap,
        "Respondent's full legal name": re_name,
        "Applicant's address": d.get('applicant_address', ''),
        'Child full legal name': child_name,
        'Child date of birth': child_dob,
        'Child sex': child_sex,
        'Birth registration number': birth_reg,
        'Place of birth': birth_place,
        'Deponent name': deponent,
        'Municipality': municipality,
        'Relationship to child': relationship,
        'Marital status at birth': marital_status,
        'Spouse or partner name': spouse_partner,
        'Signature date': d.get('signature_date', ''),
    }
    checkboxes = {}
    # Parentage circumstance checkboxes
    circ = d.get('parentage_circumstance', '')
    if circ == 'married': checkboxes['Married at time of birth'] = True
    elif circ == 'common_law': checkboxes['Common-law at time of birth'] = True
    elif circ == 'donor': checkboxes['Known donor'] = True
    elif circ == 'unknown': checkboxes['Other parent unknown'] = True
    n = _write_pdf(input_path, output_path, fields, checkboxes)
    sys.stderr.write(f'[fill_form34a] Filled {n} fields\n')
    return n



# ─────────────────────────────────────────────────────────────────────────────
# Form 37 — Notice of Hearing (clerk-issued, text generation only)
# ─────────────────────────────────────────────────────────────────────────────
def fill_form37(input_path, output_path, form_data_list):
    """Form 37 is clerk-issued. Generate a structured hearing summary PDF."""
    import textwrap
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', '')
    cn = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    ca = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    hearing_date = d.get('hearing_date', '')
    hearing_time = d.get('hearing_time', '')
    courtroom = d.get('courtroom', '')
    file_num = d.get('fileNumber', d.get('court_file_number', ''))
    hearing_type = d.get('hearing_type', '')
    notes = d.get('hearing_notes', '')
    # Build a plain-text summary and write to a simple one-page PDF
    try:
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.units import inch
        doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                                leftMargin=inch, rightMargin=inch,
                                topMargin=inch, bottomMargin=inch,
                                title='Form 37 — Notice of Hearing Summary',
                                author='Perplexity Computer')
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle('title', parent=styles['Heading1'], fontSize=16, spaceAfter=12)
        head_style = ParagraphStyle('head', parent=styles['Heading2'], fontSize=12, spaceAfter=6)
        body_style = ParagraphStyle('body', parent=styles['Normal'], fontSize=11, spaceAfter=8, leading=16)
        note_style = ParagraphStyle('note', parent=styles['Normal'], fontSize=9, textColor=colors.grey, spaceAfter=6)
        story = [
            Paragraph('Form 37 — Notice of Hearing', title_style),
            Paragraph('Hearing Summary (prepared by Hearth &amp; Page)', note_style),
            Spacer(1, 0.15*inch),
            Paragraph('Court Details', head_style),
            Paragraph(f'<b>Court:</b> {cn}', body_style),
            Paragraph(f'<b>Address:</b> {ca}', body_style),
            Paragraph(f'<b>Court File Number:</b> {file_num}', body_style),
            Spacer(1, 0.1*inch),
            Paragraph('Hearing Information', head_style),
            Paragraph(f'<b>Date:</b> {hearing_date}', body_style),
            Paragraph(f'<b>Time:</b> {hearing_time}', body_style),
            Paragraph(f'<b>Courtroom:</b> {courtroom}', body_style),
            Paragraph(f'<b>Type:</b> {hearing_type}', body_style),
        ]
        if notes:
            story += [Spacer(1, 0.1*inch), Paragraph('Special Instructions', head_style),
                      Paragraph(notes, body_style)]
        story += [
            Spacer(1, 0.2*inch),
            Paragraph('⚠️ Note: Form 37 is officially issued by the court clerk. '
                      'This summary is for your reference only. Always refer to the '
                      'official Form 37 issued by the court for legal purposes.', note_style),
            Spacer(1, 0.1*inch),
            Paragraph('<i>Prepared by Hearth &amp; Page &mdash; hearthandpage.ca</i>', note_style),
        ]
        doc.build(story)
        sys.stderr.write(f'[fill_form37] Generated hearing summary PDF\n')
        return 1
    except Exception as e:
        sys.stderr.write(f'[fill_form37] ReportLab error: {e}\n')
        # Fallback: copy blank PDF if exists
        import shutil
        if input_path and os.path.exists(input_path):
            shutil.copy2(input_path, output_path)
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# Form 14 — Notice of Motion
# ─────────────────────────────────────────────────────────────────────────────
def fill_form14(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', '')
    cn = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    ca = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    ap = d.get('applicant_full_name', '')
    ap_addr = d.get('applicant_address', '')
    ap_ph = format_phone(d.get('applicant_phone', ''))
    ap_em = d.get('applicant_email', '')
    ap_full = f'{ap}\n{ap_addr}\nTel: {ap_ph}\nEmail: {ap_em}' if ap_addr else ap
    re_name = d.get('respondent_full_name', '')
    re_addr = d.get('respondent_address', '')
    re_ph = format_phone(d.get('respondent_phone', ''))
    re_em = d.get('respondent_email', '')
    re_full = f'{re_name}\n{re_addr}\nTel: {re_ph}\nEmail: {re_em}' if re_addr else re_name
    fields = {
        'Court File Number': d.get('court_file_number', ''),
        'Court office address': ca,
        'date': d.get('hearing_date', ''),
        'time': d.get('hearing_time', ''),
        'place of hearing': d.get('hearing_location', cn),
        'name of person making the motion': d.get('moving_party_name', ap),
        'State the order or orders requested on this motion': d.get('orders_requested', ''),
        'list documents': d.get('documents_served', ''),
        'date of signature': d.get('date_signed', ''),
        'Typed or printed name of person or of persons lawyer address for service, telephone & fax numbers and e-mail address (if any)': d.get('filer_contact', ap_full),
        "Applicant's full legal name & address for servce \xad\xad\u2010 street & number, municipality, postal code, telephone & fax numers and e-mail address (if any)": ap_full,
        "Applicant lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": d.get('applicant_lawyer', ''),
        "Respondent's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": re_full,
        "Respondent lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": d.get('respondent_lawyer', ''),
    }
    n = _write_pdf(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form14] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 14A — Affidavit (General)
# ─────────────────────────────────────────────────────────────────────────────
def fill_form14a(input_path, output_path, form_data_list):
    # D8 fix (Aug 12 2026 audit): source keys were unprefixed (`city`, `province`,
    # `applicant_full_name`) but after toFillRows() these live under section
    # prefixes. Look up the prefixed keys, fall back to the legacy bare names,
    # and resolve `courthouse` through the same COURTHOUSE_NAMES_FE table used
    # by _header() so v1/v2/v3 picker values all work.
    d = _fe_flat(form_data_list)
    courthouse_raw  = d.get('courthouse', d.get('court_name', ''))
    courthouse_name = COURTHOUSE_NAMES_FE.get(courthouse_raw, courthouse_raw)
    courthouse_addr = COURTHOUSE_ADDRESSES_FE.get(courthouse_raw,
                      COURTHOUSE_ADDRESSES_FE.get(courthouse_name, ''))
    ap_city     = d.get('applicant_city', d.get('city', ''))
    ap_province = d.get('applicant_province', d.get('province', 'Ontario'))
    fields = {
        'form1[0].page1[0].body[0].courtDetails[0].courtFileNumber[0]': d.get('court_file_number', d.get('file_number', '')),
        'form1[0].page1[0].body[0].courtDetails[0].court[0].nameOfCourt[0]': courthouse_name,
        'form1[0].page1[0].body[0].courtDetails[0].court[0].courtOfficeAddress[0]': courthouse_addr,
        'form1[0].page1[0].body[0].courtDetails[0].Dated[0]': d.get('date_sworn', ''),
        'form1[0].page1[0].body[0].applicants[0].Recipient[0].textfield[0]': d.get('applicant_full_name', ''),
        'form1[0].page1[0].body[0].applicants[0].Recipient[0].textfield[1]': d.get('applicant_address', ''),
        'form1[0].page1[0].body[0].Payor[0].Payor[0].textfield[0]': d.get('respondent_full_name', ''),
        'form1[0].page1[0].body[0].Payor[0].Payor[0].textfield[1]': d.get('respondent_address', ''),
        'form1[0].page1[0].body[0].conditions[0].Reasons[0]': d.get('affidavit_text', ''),
        'form1[0].page1[0].body[0].Page2[0].Reasons[0]': d.get('affidavit_continued', ''),
        'form1[0].page1[0].body[0].Page2[0].PageHeader[0].#subform[0].courtFileNumber[0]': d.get('court_file_number', d.get('file_number', '')),
        'form1[0].page1[0].body[0].Page2[0].BottomSection[0].Section3[0].Municipality[0]': ap_city,
        'form1[0].page1[0].body[0].Page2[0].BottomSection[0].Section3[0].Province[0]': ap_province,
        'form1[0].page1[0].body[0].Page2[0].BottomSection[0].Section3[0].Date[0]': d.get('date_sworn', ''),
        'form1[0].page1[0].body[0].Page2[0].BottomSection[0].Section3[0].Commissioner[0]': d.get('commissioner_name', ''),
        'form1[0].page1[0].body[0].childrensLawyer[0].Name[0]': d.get('childrens_lawyer', ''),
    }
    # form14a is a LiveCycle form — must resolve widgets by full dotted path.
    n = _write_pdf_lc(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form14a] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 14B — Motion Form (Procedural)
# ─────────────────────────────────────────────────────────────────────────────
def fill_form14b(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=3)
    fields['Applicant'] = d.get('applicant_full_name', '')
    fields['Respondent'] = d.get('respondent_full_name', '')
    fields['Next scheduled court date (if any)'] = d.get('next_court_date', '')
    fields['Name of case management judge (if any)'] = d.get('judge_name', '')
    fields['Procedural, uncomplicated or unopposed order that you want the court to make'] = d.get('order_requested', '')
    fields['Reasons why the court should make this order'] = d.get('reasons', '')
    fields['name of statute and section numbers; name of regulation and section numbers; and rule numbers'] = d.get('legal_authority', '')
    fields['Date of signature'] = d.get('date_signed', '')
    fields['Names of parties'] = f"{d.get('applicant_full_name','')} and {d.get('respondent_full_name','')}"
    fields['Specify other'] = d.get('other_party', '')
    fields['Persons without notice'] = d.get('without_notice_party', '')
    fields["other party's lawyer's name, firm, telephone & fax number and e-mail address (if any)"] = d.get('other_lawyer_contact', '')
    fields["This party's lawyer's name, firm, telephone & fax number and e-mail address (if any)"] = d.get('filer_lawyer_contact', '')
    checkboxes = {
        'Making this motion': d.get('role', '').lower() in ('applicant', 'making'),
        'Responding to a motion Form 14B already filed': d.get('role', '').lower() == 'responding',
        'with the consent of all persons affected': d.get('motion_type', '') == 'consent',
        'with notice to all persons affected': d.get('motion_type', '') == 'notice',
        'without notice to': d.get('motion_type', '') == 'without_notice',
        'form filled by applicant': d.get('filed_by', '').lower() == 'applicant',
        'form filled by respondent': d.get('filed_by', '').lower() == 'respondent',
    }
    n = _write_pdf(input_path, output_path, fields, checkboxes)
    sys.stderr.write(f'[fill_form14b] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 14C — Confirmation of Motion
# ─────────────────────────────────────────────────────────────────────────────
def fill_form14c(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=2)
    fields['Full legal name'] = d.get('filer_full_name', d.get('applicant_full_name', ''))
    fields['Date and time for this motion'] = d.get('motion_date_time', '')
    fields['Name of Justice'] = d.get('judge_name', '')
    fields['Name of Justice (case managment judge)'] = d.get('judge_name', '')
    fields['List the specific orders below'] = d.get('orders_sought', '')
    fields['pages / tabs'] = d.get('document_pages', '')
    fields['total minutes'] = d.get('time_estimate', '')
    fields['event'] = d.get('adjournment_event', '')
    fields['reasons for adjournment'] = d.get('adjournment_reason', '')
    fields['date of contested adjournment'] = d.get('contested_adj_date', '')
    fields['name of person asking for adjournment'] = d.get('adj_party_name', '')
    fields['Reasons for contested adjournment'] = d.get('contested_adj_reason', '')
    fields['Provide reasons'] = d.get('no_case_conf_reason', '')
    fields['Specify'] = d.get('other_role', '')
    checkboxes = {
        'the applicant in this case': d.get('filer_role', '') == 'applicant',
        'the respondent in this case': d.get('filer_role', '') == 'respondent',
        'the lawyer': d.get('filer_is_lawyer', '') in ('yes','true','1'),
        'going ahead on the issues listed in paragraph 7 below': d.get('motion_status', '') == 'going_ahead',
        'going ahead for a consent order': d.get('motion_status', '') == 'consent',
        'being adjourned on consent': d.get('motion_status', '') == 'adj_consent',
        'going ahead for a contested adjournment': d.get('motion_status', '') == 'adj_contested',
        'I confirm that I will bring a draft order to the motion': d.get('draft_order', '') in ('yes','true','1'),
        'I confirm that the parties have discussed costs': d.get('costs_discussed', '') in ('yes','true','1'),
        'Yes': d.get('case_conf_held', '') in ('yes','true','1'),
        'No a case conference has not been held on the substantive issues in this case': d.get('case_conf_held', '') not in ('yes','true','1'),
    }
    n = _write_pdf(input_path, output_path, fields, checkboxes)
    sys.stderr.write(f'[fill_form14c] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 15 — Motion to Change
# ─────────────────────────────────────────────────────────────────────────────
def fill_form15(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=6)
    # FIX-F15-PAGE1-PARTIES: page 1 party boxes. On a motion to change the
    # Applicant and Respondent stay as in the original case, whoever asks
    # for the change (Family Law Rules). case_role (Form 15's first screen)
    # says which one the user was: 'applicant' or 'agreement' (filed
    # agreement, no court case: the person asking is the Applicant) puts the
    # user in the Applicant boxes; 'respondent' puts the user in the
    # Respondent boxes. No answer: the party boxes stay blank (no guessing).
    # FIX-F15-MAIN-FIRST (Nov 13 2026, Form 15 duplicates plan brick 1,
    # Josh D3-A): each piece is the MAIN CASE answer first; an old Form 15
    # answer only fills a gap (no conflict blanking - "Mark St" vs "Mark
    # Street" is not a reason to leave the address off). The unit goes with
    # the street it came from. Lawyer boxes only when that party's Form 15
    # "has a lawyer" answer is yes.
    def _g(*keys):
        for k in keys:
            v = str(d.get(k, '') or '').strip()
            if v:
                return v
        return ''
    def _party(f15, main):
        main_street = _g(f'{main}_address')
        street = main_street or _g(f'{f15}_address')
        unit = _g(f'{main}_unit') if main_street else ''
        prov = _g(f'{main}_province', f'{f15}_province')
        if prov.upper() in ('ON', 'ONT', 'ONT.'):
            prov = 'Ontario'
        addr = _fmt_addr(street, unit, _g(f'{main}_city', f'{f15}_city'), prov,
                         _g(f'{main}_postal_code', f'{f15}_postal_code'))
        # FIX-F15-THEIR-LAWYER (Nov 13 2026, Josh D2-A): the main case asks
        # about the other party's lawyer (has lawyer, name, firm, phone), so
        # for the respondent those come from the main case first; the old
        # Form 15 answers only fill a gap. Form 15 still asks the lawyer's
        # address and email (the main case doesn't); the firm name goes in
        # front of that address. Your own lawyer is Form 15 only (the main
        # case never asks), so nothing changes there.
        if main == 'respondent':
            _hl = _g('respondent_has_lawyer', f'{f15}_has_lawyer').lower()
            has_law = _hl in ('yes', 'true', '1')
            firm = _g('respondent_lawyer_firm')
            law_addr = ', '.join(x for x in (firm, _g(f'{f15}_lawyer_address')) if x)
            law_name = _g('respondent_lawyer_name', f'{f15}_lawyer_name')
            law_phone = _g('respondent_lawyer_phone', f'{f15}_lawyer_phone')
        else:
            has_law = _g(f'{f15}_has_lawyer').lower() in ('yes', 'true', '1')
            law_addr = _g(f'{f15}_lawyer_address')
            law_name = _g(f'{f15}_lawyer_name')
            law_phone = _g(f'{f15}_lawyer_phone')
        return {
            'name': _g(f'{main}_full_name', f'{f15}_full_name'),
            'address': addr,
            'phone': format_phone(_g(f'{main}_phone', f'{f15}_phone')),
            'email': _g(f'{main}_email', f'{f15}_email'),
            'law_name': law_name if has_law else '',
            'law_address': law_addr if has_law else '',
            'law_phone': format_phone(law_phone) if has_law else '',
            'law_email': _g(f'{f15}_lawyer_email') if has_law else '',
        }
    _me = _party('f15_requesting_party', 'applicant')
    _them = _party('f15_responding_party', 'respondent')
    fields['Name of requesting party'] = _me['name']
    fields['Name(s) of responding party(ies)'] = _them['name']
    # FIX-F15-LAWYER-CERT: page 4 "Lawyer's Certificate - My name is ___".
    # The requesting party is always the user filing Form 15, so this is the
    # user's own lawyer: printed only when "Do you have a lawyer?" = yes and
    # a name was given (same rule as page 1). The lawyer signs and dates it
    # by hand, so those boxes stay blank.
    if _me['law_name']:
        fields['Name of requesting party\u2019s lawyer'] = _me['law_name']
    _role = _g('case_role').lower()
    if _role in ('applicant', 'agreement', 'respondent'):
        _ap, _re = (_them, _me) if _role == 'respondent' else (_me, _them)
        for _who, _box, _law in ((_ap, 'Applicant(s)', 'Applicant(s) Lawyer'),
                                 (_re, 'Respondent(s)', 'Responndent(s) Lawyer')):
            fields[f'{_box} - full legal name'] = _who['name']
            fields[f'{_box} - address'] = _who['address']
            fields[f'{_box} - phone & fax'] = _who['phone']
            fields[f'{_box} - email'] = _who['email']
            fields[f'{_law} - name'] = _who['law_name']
            fields[f'{_law} - address'] = _who['law_address']
            fields[f'{_law} - phone & fax'] = _who['law_phone']
            fields[f'{_law} - email'] = _who['law_email']
    # FIX-F15-SWORN-BLANK (Nov 13 2026): page 7 "Sworn/Affirmed before me at
    # (municipality) in (province, state or country) on (date)" is where the
    # commissioner takes the oath, not where the user lives. It used to
    # print the user's home city/province (FIX-F15-CITY), which is wrong
    # whenever they swear it somewhere else. The whole sworn block now stays
    # blank for the commissioner, the same rule as Form 23C (D4).
    # FIX-F15-LIVES-IN: page 2 "where you live" boxes were never filled.
    # Party boxes ask for the municipality only. The child column asks for
    # municipality and province. A child living with the other parent uses
    # that parent's city, same rule as Form 8. ON is written out as Ontario.
    def _prov_name(v):
        v = (v or '').strip()
        return 'Ontario' if v.upper() in ('ON', 'ONT', 'ONT.') else v
    ap_city = (d.get('applicant_city') or d.get('applicantCity') or d.get('city') or '').strip()
    re_city = (d.get('respondent_city') or d.get('respondentCity') or '').strip()
    ap_prov = _prov_name(d.get('applicant_province') or d.get('applicantProvince') or d.get('province') or '')
    re_prov = _prov_name(d.get('respondent_province') or d.get('respondentProvince') or '')
    # FIX-F15-PLACE-MAIN (Nov 13 2026, Josh: "Main case wins"): page 2 used
    # the Form 15 "where you currently live" answers for the party boxes but
    # the main case city for the child rows, so one household could show two
    # towns. Now both use the main case city first (same rule as Form 23C).
    # The Form 15 answers ("Municipality where you currently live" / "...the
    # other party currently lives") only fill a gap when the main city is
    # blank. If both exist and name a different place, the box is left blank
    # and logged. The Form 15 "City / town" (mailing address, requesting
    # party) is used only when both of those are blank; it is never treated
    # as a conflict, since a mailing city can differ ("Greater Sudbury").
    # "Val Caron, Ontario" vs main "Val Caron" / "ON" is the same place.
    def _f15_place(label, m_city, m_prov, alt):
        alt = (alt or '').strip()
        a_city, _, a_prov = alt.partition(',')
        a_city, a_prov = a_city.strip(), _prov_name(a_prov)
        if m_city and alt:
            same = a_city.lower() == m_city.lower() and (
                not a_prov or not m_prov or a_prov.lower() == m_prov.lower())
            if not same:
                sys.stderr.write(f'[fill_form15] {label}: case answer and Form 15 answer differ - left blank\n')
                return '', ''
        if m_city:
            return m_city, m_prov
        if alt:
            return a_city, a_prov or m_prov
        return '', m_prov
    _me_alt = _g('f15_existing_order_requesting_party_municipality')
    _me_fallback = not ap_city and not _me_alt
    ap_city, ap_prov = _f15_place('where you live', ap_city, ap_prov, _me_alt)
    if _me_fallback:
        ap_city, ap_prov = _f15_place('where you live', '', ap_prov, _g('f15_requesting_party_city'))
    re_city, re_prov = _f15_place('where the other party lives', re_city, re_prov,
        _g('f15_existing_order_responding_party_municipality'))
    if ap_city:
        fields['Municipality requesting party lives in'] = ap_city
    if re_city:
        fields['Municipality responding party lives in'] = re_city
    # FIX-F15-P2-DATES: page 2 items 1-5 (living together, married,
    # separated, both birth dates) were never filled. Main case answer
    # first, then the old Form 15 answer as gap-fill (FIX-F15-MAIN-FIRST),
    # printed d/m/y. The form says to write
    # "N/A" if not applicable: that is printed only when the user's own
    # answer says so (typed "N/A", or "Were the two of you married?" = no).
    # No answer at all stays blank. No question asks "never lived
    # together", so item 1 is never N/A unless typed.
    def _p2_date(*keys):
        v = _g(*keys)
        if v.lower() in ('n/a', 'na', 'n.a.', 'not applicable'):
            return 'N/A'
        return format_dob(v)
    _married = _g('situation_were_married').lower()
    _p2 = {
        'Date parties started living together': _p2_date('f15_existing_order_cohabitation_start_date'),
        'Date parties married': ('N/A' if _married in ('no', 'false', '0') else '')
            or (_p2_date('situation_marriage_date') if _married in ('yes', 'true', '1') else '')
            or _p2_date('f15_existing_order_marriage_date'),
        'Date parties separated': _p2_date('situation_separation_date', 'f15_existing_order_separation_date'),
        'Requesting party’s birth date': _p2_date('applicant_dob', 'f15_requesting_party_dob'),
        'Responding party’s birth date': _p2_date('respondent_dob', 'f15_responding_party_dob'),
    }
    for _k, _v in _p2.items():
        if _v:
            fields[_k] = _v
    try:
        _n_kids = int(str(d.get('children_count', d.get('childrenCount', '0')) or '0'))
    except Exception:
        _n_kids = 0
    _live_fonts = {}
    for i in range(1, 5):
        has = any(str(d.get(k, '')).strip() for k in (
            f'child_{i}_name', f'child{i}Name', f'child_{i}_dob', f'child{i}Dob',
            f'child_{i}_lives_with'))
        if not has and i > _n_kids:
            continue
        cr = str(d.get(f'child_{i}_lives_with', d.get(f'child_{i}_residence', d.get(f'child{i}Residence', ''))) or '').strip().lower()
        lives_with_other = cr in ('respondent', 'with other parent', 'with the other parent', 'with the respondent')
        explicit_city = (d.get(f'child_{i}_city') or d.get(f'child{i}City') or '').strip()
        explicit_prov = _prov_name(d.get(f'child_{i}_province') or d.get(f'child{i}Province') or '')
        if explicit_city or explicit_prov:
            c_city, c_prov = explicit_city, explicit_prov
        elif lives_with_other:
            c_city, c_prov = re_city, re_prov
        else:
            c_city, c_prov = ap_city, ap_prov
        place = ', '.join(x for x in (c_city, c_prov) if x)
        if place:
            fields[f'Child {i} - Municipality & province'] = place
        # FIX-F15-CHILD-ID: name and birthdate on the same child row.
        # Birthdate is day/month/year, the same format as Form 8.
        _cname = (d.get(f'child_{i}_name') or d.get(f'child{i}Name') or '').strip()
        _cdob = format_dob(d.get(f'child_{i}_dob') or d.get(f'child{i}Dob') or '')
        if _cname:
            fields[f'Child {i} - Full legal name'] = _cname
        if _cdob:
            fields[f'Child {i} - Birthdate (d, m, y)'] = _cdob
        # FIX-F15-LIVES-WITH: same wording as Form 8. The box is only about
        # 96pt wide, so a long "Name (other parent)" is sized down to fit.
        _ap_name = (d.get('applicant_full_name') or d.get('applicant_name') or '').strip()
        _re_name = (d.get('respondent_full_name') or d.get('respondent_name') or '').strip()
        if cr in ('applicant', 'with me', 'with the applicant', 'me'):
            _who = _ap_name or 'Applicant'
        elif lives_with_other:
            _who = f'{_re_name} (other parent)' if _re_name else 'Other parent'
        elif cr == 'both':
            _who = ' and '.join(x for x in (_ap_name or 'Applicant', _re_name or 'Respondent') if x)
        elif cr in ('other', ''):
            _who = ''
        else:
            _who = str(d.get(f'child_{i}_lives_with') or '').strip()
        if _who:
            _key = f'Child {i} - Now living with (name of person and relationship to child)'
            fields[_key] = _who
            # FIX-F15-LIVES-WITH-FONT: size belongs with the name, not the support answer.
            _size = (95.6 - 6.0) / (0.52 * max(len(_who), 1))
            _size = max(6.0, min(9.0, round(_size * 2) / 2))
            if _size < 9:
                _live_fonts[_key] = _size
        # FIX-F15-SUPPORT-YN: print YES or NO only when this child has an answer.
        # Do not guess from the case-level support question or from other claims.
        _ans = str(d.get(f'child_{i}_support_change') or d.get(f'child_{i}_supportChange') or '').strip().lower()
        if _ans in ('yes', 'true', '1'):
            fields[f'Child {i} - Change of support being requested, yes or no'] = 'YES'
        elif _ans in ('no', 'false', '0'):
            fields[f'Child {i} - Change of support being requested, yes or no'] = 'NO'
    fields['Date of issue by the clerk of the court'] = d.get('issue_date', '')
    # FIX-F15-PAGE8-CLEANUP: page 8 "YOU MUST attach" is the filer's own
    # checklist, so its boxes stay blank (plan decision D4). A leftover line
    # here wrote 'order_or_agreement_desc' into one page 8 box; no screen
    # saves that answer, so it always wrote nothing. Removed.
    # FIX-F15-ORDER-TYPE: page 1 "has brought a motion to change" ticks the
    # one box the user picked on "The order or agreement you want to change"
    # (existingDocType) and prints that choice's details if answered
    # (recalculation date: see FIX-F15-RECALC-DATE below).
    _doc = str(d.get('f15_existing_order_existing_doc_type', '') or '').strip().lower()
    _cbs = {
        'the final order': _doc == 'final_order',
        'the agreement': _doc == 'agreement',
        'the orderagreement recalculated by the online Child Support Service': _doc == 'recalculated',
    }
    if _doc == 'final_order':
        # The form already prints "the final order of Justice", and the
        # screen's example is "Justice A. Brown"; drop a leading "Justice".
        fields['Name of Justice'] = _re_amt.sub(r'^\s*justice\.?\s+', '', _g('f15_existing_order_justice_name'), flags=_re_amt.I)
        fields['Date of final order'] = format_dob(_g('f15_existing_order_order_date'))
    elif _doc == 'agreement':
        fields['Name of agreement'] = _g('f15_existing_order_agreement_name')
        fields['Date of agreement'] = format_dob(_g('f15_existing_order_agreement_date'))
    elif _doc == 'recalculated':
        # FIX-F15-RECALC-DATE: "...recalculated by the online Child Support
        # Service on ___" - the new "Date of the recalculation" question
        # (shown only for this choice). Blank stays blank.
        fields['Date of order/agreement'] = format_dob(_g('f15_existing_order_recalculation_date'))
    # FIX-F15-CHANGE-TYPES: page 2 item 10 "I want to change the following"
    # ticks one box per choice on "What do you want the court to change?"
    # (saved as a comma list, e.g. "parenting_time,decision_making"; a JSON
    # list is also accepted). Expense types print only when the special
    # expenses box is ticked; other details only when "other" is ticked.
    _ct_raw = _g('f15_changes_requested_change_types')
    try:
        _ct = json.loads(_ct_raw) if _ct_raw.startswith('[') else _ct_raw.split(',')
    except Exception:
        _ct = _ct_raw.split(',')
    _ct = {str(x).strip().lower() for x in _ct if str(x).strip()}
    for _box, _val in (
        ('decision-making responsibility', 'decision_making'),
        ('child support - table amount', 'child_support_table'),
        ('child support - special or extraordinary expenses', 'child_support_special'),
        ('parenting time', 'parenting_time'),
        ('spousal support', 'spousal_support'),
        ('contact', 'contact'),
        ('other', 'other'),
    ):
        _cbs[_box] = _val in _ct
    if 'child_support_special' in _ct and _g('f15_changes_requested_special_expenses_types'):
        fields['List types of expenses'] = _g('f15_changes_requested_special_expenses_types')
    if 'other' in _ct and _g('f15_changes_requested_other_change_details'):
        fields['Details of other change'] = _g('f15_changes_requested_other_change_details')
    # FIX-F15-CHILD-SUPPORT-YN: page 2 child rows, last column "Change of
    # support being requested, yes or no". Only when a child support box is
    # ticked on item 10, and only from the user's own answer:
    #   "Is the child support change for every child listed?" Yes -> YES on
    #   every child row. No -> the user lists the children (one full name per
    #   line). Rows whose name matches exactly (ignoring capitals and extra
    #   spaces) get YES, the other rows NO. If any listed name matches no
    #   child, or matches two, nothing is printed (never guess) and it is
    #   logged. A per-child answer from FIX-F15-SUPPORT-YN wins if present.
    if _ct & {'child_support_table', 'child_support_special'}:
        _yn_key = 'Child {} - Change of support being requested, yes or no'
        _norm = lambda x: ' '.join(str(x or '').split()).casefold()
        _rows = [i for i in range(1, 5)
                 if any(k.startswith(f'Child {i} - ') for k in fields)
                 and _yn_key.format(i) not in fields]
        _all = _g('f15_changes_requested_support_all_children').lower()
        _marks = {}
        if _all in ('yes', 'true', '1'):
            _marks = {i: 'YES' for i in _rows}
        elif _all in ('no', 'false', '0'):
            _want = [_norm(x) for x in _g('f15_changes_requested_support_children_names').splitlines() if _norm(x)]
            _names = {}
            for i in range(1, max(_n_kids, 4) + 1):
                _nm = _norm(d.get(f'child_{i}_name') or d.get(f'child{i}Name') or '')
                if _nm:
                    _names.setdefault(_nm, []).append(i)
            _bad = [w for w in _want if len(_names.get(w, [])) != 1]
            if _want and not _bad:
                _hit = {_names[w][0] for w in _want}
                _marks = {i: ('YES' if i in _hit else 'NO') for i in _rows}
            elif _want:
                print(f'[fill_form15] child support names not matched exactly, column left blank: {_bad}', file=sys.stderr)
        for i, _v in _marks.items():
            fields[_yn_key.format(i)] = _v
    # FIX-F15-PAGE5: page 5 item 12 "Are you and the responding party
    # following the current order/agreement?" and item 13 facts were never
    # filled. On the official PDF the Yes/No marks are tiny 8pt text boxes
    # (not checkboxes), so an "X" is printed at 7pt in the one that matches
    # the answer. Item 12 details print only when the answer is No. Item 13
    # prints the "significant change in circumstances" answer.
    _follow = _g('f15_circumstances_following_current_order').lower()
    if _follow in ('yes', 'true', '1'):
        fields['Yes 1'] = 'X'
        _live_fonts['Yes 1'] = 7
    elif _follow in ('no', 'false', '0'):
        fields['No 1'] = 'X'
        _live_fonts['No 1'] = 7
        if _g('f15_circumstances_not_following_details'):
            fields['Details - Are you and the responding party following the current order/agreement'] = \
                _g('f15_circumstances_not_following_details')
    if _g('f15_circumstances_change_in_circumstances'):
        fields['Facts that show why the court should change the order/agreement'] = \
            _g('f15_circumstances_change_in_circumstances')
    # FIX-F15-TERMS-TABLE: page 3 item 11 has 7 one-line rows (a-g), each a
    # "Current term" line and a "Requested change" line. The app asks with
    # two big boxes, so (Josh, plan D2-A) each line the user typed becomes
    # one row: line 1 -> row a, line 2 -> row b, ... Empty lines are skipped.
    # A line too wide for its row shrinks (10pt down to 7pt). More than 7
    # lines: lines 7+ are joined into row g with "; " so nothing is silently
    # dropped (the on-screen warning to shorten is a later step). Text is
    # printed as typed - no rewording.
    def _f15_rows(v):
        rows = [ln.strip() for ln in str(v or '').replace('\r\n', '\n').replace('\r', '\n').split('\n')]
        rows = [ln for ln in rows if ln]
        if len(rows) > 7:
            rows = rows[:6] + ['; '.join(rows[6:])]
        return rows
    _row_names = {
        'Current term': [f'Current term {i}' for i in range(1, 8)],
        'Requested change': [f'Requested change {i}' for i in range(1, 8)],
    }
    _row_fill = {}
    for _label, _key in (('Current term', 'f15_changes_requested_current_terms'),
                         ('Requested change', 'f15_changes_requested_requested_changes')):
        for _i, _line in enumerate(_f15_rows(_g(_key))):
            _row_fill[_row_names[_label][_i]] = _line
    if _row_fill:
        _rsz = _box_sizes(input_path, set(_row_fill))
        for _k, _line in _row_fill.items():
            fields[_k] = _line
            if _k not in _rsz:
                continue
            _usable = (_rsz[_k][0] - 6.0) * 0.95
            _pt = 10.0
            while _pt > 7.0 and _helv_width(_line, _pt) > _usable:
                _pt -= 0.5
            _live_fonts[_k] = _pt
            if _helv_width(_line, _pt) > _usable:
                sys.stderr.write(f'[fill_form15] too long to fit at {_pt:g}pt: {_k}\n')
    # FIX-F15-SUPPORT-PART: pages 6-7 (items 14-17) were never filled. The
    # form says this part is completed only if asking to change child or
    # spousal support, so nothing prints unless item 10 has a support box
    # ticked (Josh, plan D1), even if the questions were answered.
    # - 14 support owed Yes/No; 15 the four amounts only when owed = yes,
    #   printed as 1,234.56 when the answer is a number (else as typed).
    # - 16 Today / Before today; exact date only for Before today.
    # - 17 a-d (17d is on page 7) say "if you are asking to change support
    #   starting on a date before today", so they print only for Before today.
    def _f15_money(v):
        s = str(v or '').strip()
        n = s.replace('$', '').replace(',', '').strip()
        if _re_amt.fullmatch(r'\d+(\.\d+)?', n):
            return f'{float(n):,.2f}'
        return s
    # FIX-F15-INCOME-TABLE: page 2 item 9 income table (3 rows: year, the
    # requesting party's income and sources, the responding party's income
    # and sources). The form says "If you are asking to change support", so
    # it prints only when item 10 has a support box ticked (same rule as
    # D1). The requesting party is always the user. Amounts print as
    # 1,234.56 when the answer is a number (else as typed); years and
    # sources print as typed. Each box shrinks 10pt -> 7pt to fit its line.
    if _ct & {'child_support_table', 'child_support_special', 'spousal_support'}:
        _inc = {}
        for _i in (1, 2, 3):
            for _box, _key, _money in (
                (f'Year {_i}', f'income_year{_i}', False),
                (f'Requesting party\u2019s income (0.00) {_i}', f'my_income{_i}', True),
                (f'Requesting party\u2019s income source {_i}', f'my_income_sources{_i}', False),
                (f'Responding party\u2019s income (0.00) {_i}', f'other_income{_i}', True),
                (f'Responding party\u2019s income source {_i}', f'other_income_sources{_i}', False),
            ):
                _v = _g(f'f15_changes_requested_{_key}')
                if _v:
                    _inc[_box] = _f15_money(_v) if _money else _v
        if _inc:
            _isz = _box_sizes(input_path, set(_inc))
            for _k, _v in _inc.items():
                fields[_k] = _v
                if _k not in _isz:
                    continue
                _usable = (_isz[_k][0] - 6.0) * 0.95
                _pt = 10.0
                while _pt > 7.0 and _helv_width(_v, _pt) > _usable:
                    _pt -= 0.5
                _live_fonts[_k] = _pt
                if _helv_width(_v, _pt) > _usable:
                    sys.stderr.write(f'[fill_form15] too long to fit at {_pt:g}pt: {_k}\n')
    if _ct & {'child_support_table', 'child_support_special', 'spousal_support'}:
        _owed = _g('f15_circumstances_support_owed_today').lower()
        if _owed in ('yes', 'true', '1'):
            _cbs['Yes 2'], _cbs['No 2'] = True, False
            for _box, _key in (
                ('Child support owed to recipient (0.00)', 'f15_circumstances_child_support_owed_recipient'),
                ('Child support owed to any assignee(s) (0.00)', 'f15_circumstances_child_support_owed_assignee'),
                ('Spousal support owed to recipient (0.00)', 'f15_circumstances_spousal_support_owed_recipient'),
                ('Spousal support owed to any assignee(s) (0.00)', 'f15_circumstances_spousal_support_owed_assignee'),
            ):
                if _g(_key):
                    fields[_box] = _f15_money(_g(_key))
        elif _owed in ('no', 'false', '0'):
            _cbs['Yes 2'], _cbs['No 2'] = False, True
        _when = _g('f15_circumstances_change_start_when').lower()
        if _when == 'today':
            _cbs['Today'], _cbs['Before today'] = True, False
        elif _when == 'before_today':
            _cbs['Today'], _cbs['Before today'] = False, True
            if _g('f15_circumstances_change_start_date'):
                fields['Give exact date (d, m, y)'] = format_dob(_g('f15_circumstances_change_start_date'))
            if _g('f15_circumstances_date_asked_other_party'):
                fields['Date you first asked the responding party for updated income information or to change support'] = \
                    format_dob(_g('f15_circumstances_date_asked_other_party'))
            _hard = _g('f15_circumstances_other_party_made_it_difficult').lower()
            if _hard in ('yes', 'true', '1'):
                _cbs['Yes 3'], _cbs['No 3'] = True, False
                if _g('f15_circumstances_other_party_difficult_details'):
                    fields['Details - Did the responding party do anything to make it difficult for you to know if support should change'] = \
                        _g('f15_circumstances_other_party_difficult_details')
            elif _hard in ('no', 'false', '0'):
                _cbs['Yes 3'], _cbs['No 3'] = False, True
            if _g('f15_circumstances_why_not_sooner_details'):
                fields['Details - Why didn’t you ask the court to change support sooner'] = \
                    _g('f15_circumstances_why_not_sooner_details')
            if _g('f15_circumstances_your_circumstances_child_support'):
                fields['Your circumstances and the childs circumstances that support this request'] = \
                    _g('f15_circumstances_your_circumstances_child_support')
    # FIX-WRAP-FIT: every filled big written-answer box gets a size that
    # fits its wrapped text (10pt down to 7pt). Too long even at 7pt: logged
    # here; the on-screen warning is a later step.
    _big = (
        'List types of expenses',
        'Details of other change',
        'Details - Are you and the responding party following the current order/agreement',
        'Facts that show why the court should change the order/agreement',
        'Details - Did the responding party do anything to make it difficult for you to know if support should change',
        'Details - Why didn’t you ask the court to change support sooner',
        'Your circumstances and the childs circumstances that support this request',
    )
    _filled_big = [k for k in _big if str(fields.get(k, '') or '').strip()]
    if _filled_big:
        _sizes = _box_sizes(input_path, set(_filled_big))
        for _k in _filled_big:
            if _k not in _sizes:
                continue
            _pt, _ok = _wrap_fit_pt(fields[_k], *_sizes[_k])
            _live_fonts[_k] = _pt
            if not _ok:
                sys.stderr.write(f'[fill_form15] too long to fit at {_pt:g}pt: {_k}\n')
    n = _write_pdf(input_path, output_path, fields, _cbs, font_pt=_live_fonts)
    sys.stderr.write(f'[fill_form15] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 15B — Response to Motion to Change
# ─────────────────────────────────────────────────────────────────────────────
def fill_form15b(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=5)
    # Income table rows (up to 3 years)
    fields['YearRow1'] = d.get('income_year_1', '')
    fields['Income sources for example employer self employment social assistance etc'] = d.get('income_source_1', '')
    fields['YearRow2'] = d.get('income_year_2', '')
    fields['Income sources for example employer self employment social assistance etc_3'] = d.get('income_source_2', '')
    fields['YearRow3'] = d.get('income_year_3', '')
    fields['Income sources for example employer self employment social assistance etc_5'] = d.get('income_source_3', '')
    # Change table
    fields['Current term'] = d.get('current_term_1', '')
    fields['Requested change'] = d.get('requested_change_1', '')
    fields['Current term_2'] = d.get('current_term_2', '')
    fields['Requested change_2'] = d.get('requested_change_2', '')
    fields['Current term_3'] = d.get('current_term_3', '')
    fields['Requested change_3'] = d.get('requested_change_3', '')
    checkboxes = {
        'I agree with the following claims made by the requesting party at paragraph 11 of their Motion to Change Form': d.get('agree_claims', '') in ('yes','true','1'),
        'I disagree with the following claims made by the requesting party at paragraph 11 of their Motion to Change': d.get('disagree_claims', '') in ('yes','true','1'),
        'I am asking that the motion to change except the parts that I agree with be dismissed with costs': d.get('dismiss_motion', '') in ('yes','true','1'),
    }
    n = _write_pdf(input_path, output_path, fields, checkboxes)
    sys.stderr.write(f'[fill_form15b] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 15C — Consent Motion to Change
# ─────────────────────────────────────────────────────────────────────────────
def fill_form15c(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=5)
    fields['name of party'] = d.get('applicant_full_name', '')
    # Children table (up to 4)
    for i in range(1, 5):
        suffix = f'Row{i}'
        fields[f'Childs full legal name{suffix}'] = d.get(f'child_{i}_name', '')
        fields[f'Birthdate d m y{suffix}'] = d.get(f'child_{i}_dob', '')
        fields[f'Age{suffix}'] = d.get(f'child_{i}_age', '')
        fields[f'Sex{suffix}'] = d.get(f'child_{i}_sex', '')
    # Special expenses table
    for i in range(1, 4):
        suffix = '' if i == 1 else f'_{i}'
        fields[f"Childs name{'Row' + str(i) if i>1 else 'Row1'}"] = d.get(f'expense_child_{i}', '')
        fields[f"Type of expense{'Row' + str(i) if i>1 else 'Row1'}"] = d.get(f'expense_type_{i}', '')
    n = _write_pdf(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form15c] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 17 — Conference Notice
# ─────────────────────────────────────────────────────────────────────────────
def fill_form17(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    # FIX-F17-F25-FULL-ADDRESS: same full address-for-service block as _header()
    _hb = _header(d)
    courthouse = d.get('courthouse', '')
    cn = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    ca = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    ap = d.get('applicant_full_name', '')
    re_name = d.get('respondent_full_name', '')
    ap_addr = d.get('applicant_address', '')
    re_addr = d.get('respondent_address', '')
    fields = {
        'Court File Number': d.get('court_file_number', ''),
        'Court office address': ca,
        'TO name of party or parties or lawyers': d.get('to_parties', f'{ap}, {re_name}'),
        'place of conference': d.get('conference_location', cn),
        'date': d.get('conference_date', ''),
        'time': d.get('conference_time', ''),
        'to deal with the following issues:': d.get('conference_issues', ''),
        'Date of signature': d.get('date_signed', ''),
        'location of video terminal or telephone': d.get('video_location', ''),
        'name of person': d.get('contact_person', ''),
        'other; specify': d.get('other_instructions', ''),
        "Applicant's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": _hb["Applicant's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"],
        "Applicant lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": d.get('applicant_lawyer', ''),
        'Respondent full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)': _hb['Respondent full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)'],
        "Respondent lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": d.get('respondent_lawyer', ''),
        "Name & address of Children's Lawyer's agent (street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)) and name of person represented": d.get('childrens_lawyer', ''),
    }
    n = _write_pdf(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form17] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 17E — Trial Management Brief
# ─────────────────────────────────────────────────────────────────────────────
def fill_form17e(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=5)
    fields['Name of party filing this brief'] = d.get('filer_full_name', d.get('applicant_full_name', ''))
    fields['Date of trial management conference'] = d.get('conference_date', '')
    fields['Full name(s)'] = d.get('filer_full_name', d.get('applicant_full_name', ''))
    n = _write_pdf(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form17e] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 17F — Confirmation of Conference
# ─────────────────────────────────────────────────────────────────────────────
def fill_form17f(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=2)
    fields['Full legal name'] = d.get('filer_full_name', d.get('applicant_full_name', ''))
    fields["Name of lawyer's client"] = d.get('client_name', d.get('applicant_full_name', ''))
    fields['Reasons for not conferring with the opposing counsel or party'] = d.get('no_confer_reason', '')
    fields['Time (00:00)'] = d.get('conference_time', '')
    fields['Name of case management judge'] = d.get('judge_name', '')
    fields['Other (Specify)'] = d.get('other_role', '')
    checkboxes = {
        'case conference': d.get('conference_type', '') == 'case',
        'settlement conference': d.get('conference_type', '') == 'settlement',
        'trial management conference': d.get('conference_type', '') == 'trial_management',
        'I am the lawyer': d.get('filer_is_lawyer', '') in ('yes','true','1'),
        'I am the applicant': d.get('filer_role', '') == 'applicant',
        'I am the respondent': d.get('filer_role', '') == 'respondent',
        'going ahead on the issues listed in paragraph 6 below': d.get('conf_status', '') == 'going_ahead',
        'going ahead for a consent order': d.get('conf_status', '') == 'consent',
        'being adjourned on consent': d.get('conf_status', '') == 'adj_consent',
        'I confirm that the parties have discussed costs': d.get('costs_discussed', '') in ('yes','true','1'),
    }
    n = _write_pdf(input_path, output_path, fields, checkboxes)
    sys.stderr.write(f'[fill_form17f] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 13B — Net Family Property Statement
# ─────────────────────────────────────────────────────────────────────────────
def fill_form13b(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', d.get('court_name', ''))
    ca   = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    fnum = d.get('court_file_number', '')
    ap   = d.get('applicant_full_name', '')
    re_n = d.get('respondent_full_name', '')
    ap_a = d.get('applicant_address', '')
    re_a = d.get('respondent_address', '')
    ap_law = d.get('applicant_lawyer_name', '')
    re_law = d.get('respondent_lawyer_name', '')
    completing  = d.get('completing_party', ap)
    valuation_date = d.get('valuation_date', '')
    sig_date = d.get('signature_date', '')

    def fmt(key, default=''):
        v = d.get(key, default)
        if v in ('', None):
            return ''
        try:
            return f'{float(str(v).replace(",","")):.2f}'
        except Exception:
            return str(v)

    # Asset rows for Table1 (p1) — up to 13 rows
    asset_rows = [
        (d.get('asset_family_home_address', 'Family home'),     fmt('asset_family_home_value')),
        (d.get('asset_other_real_estate_description', 'Other real estate'), fmt('asset_other_real_estate')),
        (d.get('asset_bank_accounts_description', 'Bank accounts / GICs'),  fmt('asset_bank_accounts')),
        ('RRSPs / RRIFs / LIRAs',                               fmt('asset_rrsp_rrif')),
        (d.get('asset_pension_description', 'Pension plans'),   fmt('asset_pension')),
        ('Non-registered investments',                           fmt('asset_investments')),
        (d.get('asset_business_description', 'Business interests'), fmt('asset_business_interest')),
        ('Vehicles',                                             fmt('asset_vehicles')),
        ('Life insurance (CSV)',                                 fmt('asset_life_insurance')),
        ('Household contents',                                   fmt('asset_household_contents')),
        ('Money owed to you',                                    fmt('asset_money_owed_to_you')),
        (d.get('asset_other_description', 'Other assets'),      fmt('asset_other')),
    ]
    total_assets_vd = fmt('total_assets_valuation_date')

    # Debt rows for Table2 (p2) — up to 13 rows
    debt_rows = [
        ('Mortgage — family home',    fmt('debt_mortgage_family_home')),
        ('Mortgage — other',          fmt('debt_mortgage_other')),
        ('Vehicle loans',             fmt('debt_vehicle_loans')),
        ('Credit card balances',      fmt('debt_credit_cards')),
        ('Lines of credit',           fmt('debt_lines_of_credit')),
        ('Student loans',             fmt('debt_student_loans')),
        ('Personal loans',            fmt('debt_personal_loans')),
        ('Business debts',            fmt('debt_business_debts')),
        ('Income taxes owing',        fmt('debt_tax_owing')),
        (d.get('debt_other_description', 'Other debts'), fmt('debt_other')),
    ]
    total_debts_vd = fmt('total_debts_valuation_date')
    net_vd = fmt('net_on_valuation_date')

    # DOM asset rows for Table4 (p3) — up to 12 rows
    dom_asset_rows = [
        ('Bank accounts / savings',   fmt('dom_bank_accounts')),
        ('RRSPs / investments',       fmt('dom_rrsp')),
        ('Real estate (excl. mat. home)', fmt('dom_real_estate')),
        ('Business interests',        fmt('dom_business')),
        ('Pension',                   fmt('dom_pension')),
        ('Vehicles',                  fmt('dom_vehicles')),
        (d.get('dom_other_assets_description', 'Other assets'), fmt('dom_other_assets')),
    ]
    total_assets_dom = fmt('total_assets_dom')

    # DOM debt rows for Table3b
    dom_debt_rows = [
        ('Mortgage(s)',               fmt('dom_debt_mortgage')),
        ('Vehicle loans',             fmt('dom_debt_vehicle')),
        ('Student loans',             fmt('dom_debt_student')),
        ('Credit cards / LOC',        fmt('dom_debt_credit_cards')),
        (d.get('dom_debt_other_desc', 'Other debts'), fmt('dom_debt_other')),
    ]
    total_debts_dom = fmt('total_debts_dom')
    net_dom = fmt('net_dom')
    total_excluded = fmt('total_excluded_property')
    nfp_result = fmt('nfp_result')
    nfp_final  = fmt('nfp_final')

    fields = {
        # Header (p1)
        'form1[0].page1[0].body[0].p1[0].courtDetails[0].courtFileNumber[0]': fnum,
        'form1[0].page1[0].body[0].p1[0].courtDetails[0].court[0].courtOfficeAddress[0]': ca,
        'form1[0].page1[0].body[0].p1[0].applicants[0].appliant[0].textfield[0]': ap,
        'form1[0].page1[0].body[0].p1[0].applicants[0].appliant[0].textfield[1]': ap_a,
        'form1[0].page1[0].body[0].p1[0].applicants[0].applicantLawyer[0].textfield[0]': ap_law,
        'form1[0].page1[0].body[0].p1[0].respondents[0].respondant[0].textfield[0]': re_n,
        'form1[0].page1[0].body[0].p1[0].respondents[0].respondant[0].textfield[1]': re_a,
        'form1[0].page1[0].body[0].p1[0].respondents[0].respondantLawyer[0].textfield[0]': re_law,
        'form1[0].page1[0].body[0].p1[0].text[0].name[0]': completing,
        'form1[0].page1[0].body[0].p1[0].text[0].name[1]': valuation_date,
        # Table1 — assets at valuation date
        **{f'form1[0].page1[0].body[0].p1[0].Table1[0].Row1[{i}].Cell1[0]': r[0]
           for i, r in enumerate(asset_rows[:13])},
        **{f'form1[0].page1[0].body[0].p1[0].Table1[0].Row1[{i}].Cell2[0]': r[1]
           for i, r in enumerate(asset_rows[:13])},
        'form1[0].page1[0].body[0].p1[0].Table1[0].total[0].Cell2[0]': total_assets_vd,
        # p2 header
        'form1[0].page1[0].body[0].p2[0].title[0].courtFileNumber[0]': fnum,
        # Table2 — debts at valuation date
        **{f'form1[0].page1[0].body[0].p2[0].Table2[0].Row1[{i}].Cell1[0]': r[0]
           for i, r in enumerate(debt_rows[:13])},
        **{f'form1[0].page1[0].body[0].p2[0].Table2[0].Row1[{i}].Cell2[0]': r[1]
           for i, r in enumerate(debt_rows[:13])},
        'form1[0].page1[0].body[0].p2[0].Table2[0].to[0].Cell2[0]': total_debts_vd,
        # Table3 — net at valuation date summary
        'form1[0].page1[0].body[0].p2[0].table3[0].Table3[0].Row1[0].Cell1[0]': 'Total assets (valuation date)',
        'form1[0].page1[0].body[0].p2[0].table3[0].Table3[0].Row1[0].Cell2[0]': total_assets_vd,
        'form1[0].page1[0].body[0].p2[0].table3[0].Table3[0].Row1[1].Cell1[0]': 'Less: Total debts (valuation date)',
        'form1[0].page1[0].body[0].p2[0].table3[0].Table3[0].Row1[1].Cell2[0]': total_debts_vd,
        'form1[0].page1[0].body[0].p2[0].table3[0].Table3[0].to[0].Cell2[0]': net_vd,
        # Table3b — DOM debts
        **{f'form1[0].page1[0].body[0].p2[0].table3[0].Table3b[0].Row1[{i}].Cell1[0]': r[0]
           for i, r in enumerate(dom_debt_rows[:6])},
        **{f'form1[0].page1[0].body[0].p2[0].table3[0].Table3b[0].Row1[{i}].Cell2[0]': r[1]
           for i, r in enumerate(dom_debt_rows[:6])},
        'form1[0].page1[0].body[0].p2[0].table3[0].Table3b[0].to[0].Cell2[0]': total_debts_dom,
        # p3 header
        'form1[0].page1[0].body[0].p3[0].title[0].courtFileNumber[0]': fnum,
        # Table4 — DOM assets
        **{f'form1[0].page1[0].body[0].p3[0].Table4[0].Row1[{i}].Cell1[0]': r[0]
           for i, r in enumerate(dom_asset_rows[:12])},
        **{f'form1[0].page1[0].body[0].p3[0].Table4[0].Row1[{i}].Cell2[0]': r[1]
           for i, r in enumerate(dom_asset_rows[:12])},
        'form1[0].page1[0].body[0].p3[0].Table4[0].to[0].Cell2[0]': total_assets_dom,
        # table5 — NFP summary
        'form1[0].page1[0].body[0].p3[0].table5[0].total4[0].Row1[0].Cell2[0]': net_vd,
        'form1[0].page1[0].body[0].p3[0].table5[0].total4[0].Row1[1].Cell2[0]': net_dom,
        'form1[0].page1[0].body[0].p3[0].table5[0].total4[0].Row1[2].Cell2[0]': total_excluded,
        'form1[0].page1[0].body[0].p3[0].table5[0].total4[0].to[0].Cell2[0]': nfp_result,
        # table6 — equalization
        'form1[0].page1[0].body[0].p3[0].table6[0].total4[0].Row1[0].Cell2[0]': nfp_final,
        'form1[0].page1[0].body[0].p3[0].table6[0].total4[0].Row1[1].Cell2[0]': fmt('equalization_payment_estimate'),
        'form1[0].page1[0].body[0].p3[0].table6[0].total4[0].to[0].Cell2[0]': fmt('equalization_payment_estimate'),
        # Signature
        'form1[0].page1[0].body[0].p3[0].signature[0].Date[0]': sig_date,
    }
    n = _write_pdf_lc(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form13b] Filled {n} fields\n')
    return n



# ─────────────────────────────────────────────────────────────────────────────
# Form 23C — Affidavit (Divorce)
# ─────────────────────────────────────────────────────────────────────────────
def _set_radio_kids(path, groups, court_choice=None, unhide=None):
    """FIX-F23C-PAGE1-6: tick several buttons of one radio group.

    `groups` is {group name: (wanted on-names, split)}. FIX-F23C-REASONS
    added pick-one groups (split=False): the chosen button is turned on
    and the group stays a normal radio group.

    Some official forms (Form 23C para 3) build a "tick all that apply" list
    as ONE radio group. Viewers show only one button of a radio group as
    ticked, so a person asking for several orders would see one tick. In the
    OUTPUT file only, each button of `group` becomes its own tick box (own
    name, no parent), turned on when its "on" name (export value), trimmed
    and lower-cased, is in `wanted`. The blank template is not changed.
    `court_choice`, when given, is written into the "Name of court"
    drop-down (the shared writer only fills text boxes and tick boxes).
    `unhide` (FIX-F23C-CS-FILL): names of filled boxes the template marks
    "hidden on screen" (NoView flag); the flag is cleared so viewers show
    the answer, not only printers.
    Returns how many boxes were set.
    """
    import pypdf
    from pypdf.generic import NameObject, NumberObject, ArrayObject, create_string_object
    reader = pypdf.PdfReader(path)
    writer = pypdf.PdfWriter()
    writer.append(reader)
    acro = writer._root_object['/AcroForm'].get_object()
    fields_arr = acro.get('/Fields')
    on = 0
    idx = 0
    parents = []
    for page in writer.pages:
        for ref in page.get('/Annots') or []:
            obj = ref.get_object()
            if obj.get('/Subtype') != '/Widget':
                continue
            if court_choice and str(obj.get('/T')) == 'Name of court' and obj.get('/FT') == '/Ch':
                obj.update({NameObject('/V'): create_string_object(court_choice)})
                obj.pop('/AP', None)
                on += 1
                continue
            if unhide and str(obj.get('/T')) in unhide:
                obj.update({NameObject('/F'): NumberObject((int(obj.get('/F', 0)) & ~32) | 4)})
            if obj.get('/T') is not None or '/Parent' not in obj:
                continue
            pref = obj['/Parent']
            par = pref.get_object()
            group = str(par.get('/T'))
            if group not in groups:
                continue
            gw, split = groups[group]
            want = {str(w).strip().lower() for w in gw if str(w).strip()}
            names = [str(k) for k in (obj.get('/AP', {}).get('/N', {}) or {}).keys() if str(k) != '/Off']
            state = '/Off'
            for nm in names:
                if nm[1:].strip().lower() in want:
                    state = nm
            if not split:
                obj.update({NameObject('/AS'): NameObject(state)})
                if state != '/Off':
                    par.update({NameObject('/V'): NameObject(state)})
                    on += 1
                continue
            if pref not in parents:
                parents.append(pref)
            idx += 1
            del obj['/Parent']
            obj.update({
                NameObject('/T'): create_string_object(f'{group} {idx}'),
                NameObject('/FT'): NameObject('/Btn'),
                NameObject('/Ff'): NumberObject(0),
                NameObject('/V'): NameObject(state),
                NameObject('/AS'): NameObject(state),
            })
            if fields_arr is not None:
                fields_arr.append(ref)
            if state != '/Off':
                on += 1
    if fields_arr is not None:
        for pref in parents:
            pref.get_object()[NameObject('/Kids')] = ArrayObject()
            keep = [f for f in fields_arr if f != pref]
            fields_arr.clear()
            fields_arr.extend(keep)
    _set_need_appearances(writer)
    with open(path, 'wb') as f:
        writer.write(f)
    return on


def fill_form23c(input_path, output_path, form_data_list):
    # FIX-F23C-PAGE1-6 (Nov 13 2026, Form 23C plan brick 2 + decision D3):
    # page 1 and page 6 come from the main case answers wherever the case
    # already has them, so nobody types their name, city or children twice.
    # The 23C screens only add what the case cannot know (which orders,
    # "other", not-served reasons, other issues). Sworn block stays blank
    # for the commissioner (D4). Blank stays blank; when the main case and
    # a 23C answer disagree the box is left blank and logged.
    d = _fe_flat(form_data_list)

    def g(*keys):
        for k in keys:
            v = str(d.get(k) or '').strip()
            if v:
                return v
        return ''

    def prov(v):
        v = (v or '').strip()
        return 'Ontario' if v.upper() in ('ON', 'ONT', 'ONT.') else v

    def one(label, main, alt):
        main, alt = (main or '').strip(), (alt or '').strip()
        if main and alt and main != alt:
            sys.stderr.write(f'[fill_form23c] {label}: case answer and 23C answer differ - left blank\n')
            return ''
        return main or alt

    fields = _header(d, pages=6)
    ap = g('applicant_full_name', 'applicantFullName')
    re_name = g('respondent_full_name', 'respondentFullName')
    ap_city, ap_prov = g('applicant_city', 'applicantCity'), prov(g('applicant_province', 'applicantProvince'))
    re_city, re_prov = g('respondent_city', 'respondentCity'), prov(g('respondent_province', 'respondentProvince'))

    # "My name is" / "I live in"
    fields['full legal name'] = ap
    fields['municipality & province'] = _fmt_muni(ap_city, ap_prov)

    # Para 2: children (main case children, same rules as Forms 8 and 15)
    try:
        n_kids = int(g('children_count', 'childrenCount') or '0')
    except Exception:
        n_kids = 0
    kid_names = []
    for i in range(1, 6):
        cn = g(f'child_{i}_name', f'child{i}Name')
        cd = g(f'child_{i}_dob', f'child{i}Dob')
        cr = g(f'child_{i}_lives_with', f'child_{i}_living_with', f'child_{i}_residence').lower()
        if not (cn or cd or cr):
            continue
        if cn:
            kid_names.append(cn)
        other = cr in ('respondent', 'with other parent', 'with the other parent', 'with the respondent')
        if cr in ('applicant', 'with me', 'with the applicant', 'me'):
            who = ap or 'Applicant'
        elif other:
            who = f'{re_name} (other parent)' if re_name else 'Other parent'
        elif cr == 'both':
            who = f'{ap or "Applicant"} and {re_name or "Respondent"}'
        elif cr in ('other', ''):
            who = ''
        else:
            who = g(f'child_{i}_lives_with', f'child_{i}_living_with', f'child_{i}_residence')
        ex_city, ex_prov = g(f'child_{i}_city'), prov(g(f'child_{i}_province'))
        if ex_city or ex_prov:
            c_city, c_prov = ex_city, ex_prov
        elif other:
            c_city, c_prov = re_city, re_prov
        else:
            c_city, c_prov = ap_city, ap_prov
        fields[f'Full Legal NameRow{i}'] = cn
        fields[f'AgeRow{i}'] = calc_age(cd)
        fields[f'Birthdate d m yRow{i}'] = format_dob(cd)
        fields[f'Resident in municipality  provinceRow{i}'] = _fmt_muni(c_city, c_prov)
        fields[f'Now living with name of person and relationship to childRow{i}'] = who
    count = n_kids or len(kid_names)
    if count:
        fields['number of children'] = str(count)

    # Para 3: orders asked for (23C "Which orders" tick boxes)
    orders = {x.strip() for x in g('f23c_claims_order_sought').split(',') if x.strip()}
    radio = {
        'decision_making': 'decision-making responsibility for the child(ren) named above',
        'parenting_time': 'parenting time with the child(ren) named above',
        'contact': 'contact with the child(ren) named above',
        'child_support': 'support for (name of recipient(s))',
        'spousal_support': 'support for (name of recipient(s))',
        'restraining_order': 'restraining order against the respondent',
        'other': 'other (specify)',
    }
    wanted = {radio[o] for o in orders if o in radio}
    recips = []
    if 'child_support' in orders:
        recips += kid_names
    if 'spousal_support' in orders and ap:
        recips.append(ap)
    if recips:
        fields['name of recipient(s)'] = recips[0] if len(recips) == 1 else ', '.join(recips[:-1]) + ' and ' + recips[-1]
    if 'restraining_order' in orders:
        fields['name of respondent'] = re_name
        fields['date of birth'] = format_dob(g('respondent_dob'))
    if 'other' in orders:
        fields['other (specify)'] = g('f23c_claims_other_order_details')

    # Para 4: relationship (main case first, 23C answer only fills a gap)
    st = g('f23c_identity_relationship_status')
    married_main = g('situation_were_married').lower()
    if married_main and st and (_is_yes(married_main) != (st in ('married', 'separated'))):
        sys.stderr.write('[fill_form23c] married: case answer and 23C answer differ - left blank\n')
        married = False
        st = ''
    else:
        married = _is_yes(married_main) or (not married_main and st in ('married', 'separated'))
    mdate = one('marriage date', g('situation_marriage_date'), g('f23c_identity_marriage_date')) if married else ''
    sdate = one('separation date', g('situation_separation_date'), g('f23c_identity_separation_date'))
    cdate = g('f23c_identity_cohabitation_date')
    checkboxes = {}
    if married:
        checkboxes['married on date'] = True
        fields['married on (date)'] = format_dob(mdate)
    if sdate:
        checkboxes['separated on date'] = True
        fields['separated on (date)'] = format_dob(sdate)
    if cdate:
        checkboxes['started living together on date'] = True
        fields['started living together on (date)'] = format_dob(cdate)
    if st == 'never_lived_together':
        if married or sdate or cdate:
            sys.stderr.write('[fill_form23c] "never lived together" conflicts with marriage/separation/cohabitation answers - left blank\n')
        else:
            checkboxes['never lived together'] = True

    # FIX-F23C-REASONS (brick 3): paras 5, 6, 7, 9, 13, 14. Only printed
    # when the matching order is ticked (unticking hides an answer on screen
    # but keeps it saved). Several of these boxes have the short name ")"
    # on the template; their FULL names differ, so they are always written
    # by full name and ")" is never used as a key.
    radio_groups = {'I am asking for the following order:': (wanted, True)}
    big = {}
    if 'decision_making' in orders:
        big['An order giving me decision-making responsibility for the child(ren) is in the best interests of the child(ren) because (Give reasons)'] = g('f23c_claims_decision_making_reasons')
    if 'parenting_time' in orders:
        big['An order giving me parenting time with the child(ren) is in the best interests of the child(ren) because: (Give reasons.)'] = g('f23c_claims_parenting_time_reasons')
    if orders & {'decision_making', 'parenting_time'}:
        yn = g('f23c_claims_respondent_parenting_time_yes_no').lower()
        if yn in ('yes', 'no'):
            radio_groups['An order giving the respondent parenting time with the children'] = ([{'yes': 'is', 'no': 'is not'}[yn]], False)
        big['An order giving the respondent parenting time with the children is or is not in the best interests of the child(ren) because: (Give reasons)'] = g('f23c_claims_respondent_parenting_time_reasons')
        # FIX-F23C-PT-TERMS (brick 4): para 8 schedule choice and the
        # fixed terms. Terms only print for "including ... the terms below"
        # or "on the following terms". Each term's blanks only print when
        # that term is ticked. A ticked term with an empty blank is logged.
        sched = g('f23c_claims_parenting_time_schedule').lower()
        sched_on = {
            'reasonable': 'reasonable parenting time on reasonable notice; ',
            'reasonable_plus': 'reasonable parenting time on reasonable notice including but not limited to the terms below;',
            'terms': 'on the following terms',
        }
        if sched in sched_on:
            radio_groups['If an order for parenting time is made, it should be:'] = ([sched_on[sched]], False)
        if sched in ('reasonable_plus', 'terms'):
            terms = {x.strip() for x in g('f23c_claims_pt_terms').split(',') if x.strip()}

            def _pm(raw):
                # The form prints "p.m." after these blanks. Drop a typed
                # p.m.; an a.m. time would contradict the form, so blank it.
                t = str(raw or '').strip()
                if _re_amt.search(r'a\.?\s*m\.?$', t, _re_amt.I):
                    sys.stderr.write('[fill_form23c] para 8 weekend time is a.m. but the form prints p.m. - left blank\n')
                    return ''
                return _re_amt.sub(r'\s*p\.?\s*m\.?$', '', t, flags=_re_amt.I).strip()

            def _blanks(term, vals):
                for v in vals:
                    if not str(v).strip():
                        sys.stderr.write(f'[fill_form23c] para 8 "{term}" ticked but a blank is empty\n')
                        break

            if 'weekends' in terms:
                checkboxes['every other weekend from'] = True
                vals = (_pm(g('f23c_claims_pt_weekend_from')), _pm(g('f23c_claims_pt_weekend_until')), format_dob(g('f23c_claims_pt_weekend_start')))
                fields['time'], fields['time_2'], fields['date'] = vals
                _blanks('every other weekend', vals)
            if 'spring_break' in terms:
                checkboxes['alternate spring breaks starting in year'] = True
                fields['year'] = g('f23c_claims_pt_spring_year').strip()
                _blanks('alternate spring breaks', (fields['year'],))
            if 'summer' in terms:
                checkboxes['numbe of weeks during the summer vacation, to be decided by the parties before April 1 of each year'] = True
                fields['number of weeks'] = g('f23c_claims_pt_summer_weeks').strip()
                _blanks('summer weeks', (fields['number of weeks'],))
            if 'winter_break' in terms:
                checkboxes['one half of the winter break starting on date'] = True
                vals = (format_dob(g('f23c_claims_pt_winter_start')), format_dob(g('f23c_claims_pt_winter_end')), g('f23c_claims_pt_winter_shared'))
                fields['date_2'], fields['date_3'] = vals[0], vals[1]
                big['shared as follows'] = vals[2]
                _blanks('winter break', vals)
            if 'special_days' in terms:
                checkboxes['List any other special days such as religious festivals Christmas Day birthdays Mothers Day Fathers'] = True
                big['List any other special days such as religious festivals, Christmas Day, birthdays, Mother’s Day, Father’s Day, etc., and indicate with which person the children will be on each day. (Specify dates and times.)'] = g('f23c_claims_pt_special_days')
                _blanks('special days', (g('f23c_claims_pt_special_days'),))
            if 'other' in terms:
                checkboxes['other Specify'] = True
                big['other (specify)_2'] = g('f23c_claims_parenting_time_details')
                _blanks('other terms', (g('f23c_claims_parenting_time_details'),))
    if 'contact' in orders:
        big['An order giving me contact with the child(ren) is in the best interests of the child(ren) because:  (Give reasons.)'] = g('f23c_claims_contact_reasons')
        # FIX-F23C-CONTACT-FILL (brick 5): para 10 contact order type and
        # terms box. Terms only print for "including ... the terms below" or
        # "on the following terms". Terms saved with no type are not
        # guessed: left blank and logged.
        ctype = g('f23c_claims_contact_order_type').lower()
        c_terms_box = 'on the following terms:  (Specify when, where, and how you want to have contact with the children, including dates and times, whether by phone or in-person, etc.)'
        ctype_on = {
            'reasonable': 'reasonable contact on reasonable notice; ',
            'reasonable_plus': 'reasonable contact on reasonable notice including but not limited to the terms below; ',
            'terms': c_terms_box,
        }
        csched = g('f23c_claims_contact_schedule')
        if ctype in ctype_on:
            radio_groups['The contact order should be:'] = ([ctype_on[ctype]], False)
        if ctype in ('reasonable_plus', 'terms'):
            big[c_terms_box] = csched
            if not csched.strip():
                sys.stderr.write('[fill_form23c] para 10 terms chosen but the contact terms box is empty\n')
        elif csched.strip() and not ctype:
            sys.stderr.write('[fill_form23c] para 10 contact terms saved but no contact order type chosen - left blank\n')
    one_line = {}
    if 'child_support' in orders:
        # FIX-F23C-CS-FILL (brick 6): para 11 number of children (the same
        # children listed on page 1 and named as support recipients) and
        # para 12 income sources. A detail saved without its tick box is
        # not guessed: left blank and logged.
        if count:
            fields['number of children_2'] = str(count)
        srcs = {x.strip() for x in g('f23c_claims_respondent_income_source').split(',') if x.strip()}
        for src, box, txt_key, txt_box in (
            ('employment', 'employment income at employers name and address', 'f23c_claims_respondent_employer', 'employment income at (employer’s name and address)'),
            ('commission', 'commissions tips overtime bonuses etc', None, None),
            ('self_employment', 'selfemployment as name or nature of respondents business', 'f23c_claims_respondent_business', 'self-employment as (name or nature of respondent’s business)'),
            ('other', 'other specify_2', 'f23c_claims_respondent_other_income_source', 'other (specify)_3'),
        ):
            txt = g(txt_key).strip() if txt_key else ''
            if src in srcs:
                checkboxes[box] = True
                if txt_box:
                    if txt:
                        one_line[txt_box] = txt
                    else:
                        sys.stderr.write(f'[fill_form23c] para 12 "{src}" ticked but its detail is empty\n')
            elif txt:
                sys.stderr.write(f'[fill_form23c] para 12 "{src}" detail saved but not ticked - left blank\n')
        amt = g('f23c_claims_respondent_income').replace('$', '').strip()
        if amt:
            fields['dollar amount'] = amt
        big['I believe that the respondent’s current annual income from all income sources is a given amount for the following reasons: (Give your reasons for believing the dollar amount set out.)'] = g('f23c_claims_respondent_income_reasons')
    if 'spousal_support' in orders:
        big['I need spousal support for the following reasons:  (Give details of your financial needs.)'] = g('f23c_claims_spousal_support_reasons')
    if 'restraining_order' in orders:
        # FIX-F23C-RO-FILL (brick 7): para 15. The person restrained is the
        # respondent from the main case; the older 23C name/birth date
        # answers only fill a gap (a conflict is left blank and logged).
        # Protected people "me" and "the children" come from the main case.
        def _iso_dmy(v):
            v = (v or '').strip()
            return format_dob(v) if len(v) == 10 and v[4] == '-' and v[7] == '-' else v
        one_line['full legal name of person restrained'] = one('restrained person name', re_name, g('f23c_claims_restrained_person_name'))
        fields['date of birth of person restrained'] = one('restrained person birth date', format_dob(g('respondent_dob')), _iso_dmy(g('f23c_claims_restrained_person_dob')))
        ro_terms = {x.strip() for x in g('f23c_claims_ro_terms').split(',') if x.strip()}
        kids = []
        for i in range(1, 6):
            cn = g(f'child_{i}_name', f'child{i}Name')
            if cn:
                kids.append((cn, format_dob(g(f'child_{i}_dob', f'child{i}Dob'))))
        if 'no_contact' in ro_terms:
            checkboxes['contacting or communicating directly or indirectly with the following people full legal name and dates of'] = True
            prot = {x.strip() for x in g('f23c_claims_ro_protect').split(',') if x.strip()}
            people = []
            if 'me' in prot and ap:
                people.append((ap, format_dob(g('applicant_dob'))))
            if 'children' in prot:
                people += kids
            if 'other' in prot:
                for j in (1, 2):
                    on_ = g(f'f23c_claims_ro_other_name{j}')
                    od_ = g(f'f23c_claims_ro_other_dob{j}')
                    if on_:
                        people.append((on_, format_dob(od_)))
                    elif od_:
                        sys.stderr.write(f'[fill_form23c] para 15 other person {j}: birth date with no name - left blank\n')
            if not people:
                sys.stderr.write('[fill_form23c] para 15 no-contact ticked but no protected people\n')
            if len(people) > 5:
                sys.stderr.write(f'[fill_form23c] para 15 has {len(people)} protected people; the form has 5 rows - first 5 printed\n')
            for i, (pn, pd) in enumerate(people[:5], 1):
                one_line[f'NameRow{i}'] = pn
                fields[f'Birthdate dmyRow{i}'] = pd
            exc = {x.strip() for x in g('f23c_claims_ro_contact_exceptions').split(',') if x.strip()}
            if 'through_person' in exc:
                checkboxes['except through name of person or agency'] = True
                one_line['name of person or agency'] = g('f23c_claims_ro_through_person')
            if 'parenting_time' in exc:
                checkboxes['except to permit parenting time with the children names and birth dates'] = True
                one_line['names and birth dates'] = ', '.join(f'{n} ({b})' if b else n for n, b in kids)
                one_line['dates/days and times'] = g('f23c_claims_ro_pt_when')
            if 'counsel' in exc:
                checkboxes['except through or in the presence of counsel'] = True
            if 'counsel_ocl' in exc:
                checkboxes['except through or in the presence of counsel or a clinical investigator from the Office of the'] = True
        if 'distance' in ro_terms:
            checkboxes['coming within'] = True
            fields['distance (in numbers)'] = g('f23c_claims_ro_distance')
            unit = g('f23c_claims_ro_distance_unit').lower()
            if unit in ('metres', 'yards', 'feet'):
                radio_groups['unit of distance'] = ([unit], False)
            one_line['locations and addresses'] = g('f23c_claims_ro_locations')
            cond = g('f23c_claims_ro_distance_conditions')
            if cond:
                checkboxes['except under the following conditions provide details of conditions including times purposes of'] = True
                big['provide details of conditions, including time(s), purpose(s) of  exception(s) and address(es) as applicable'] = cond
        if 'additional' in ro_terms:
            checkboxes['any additional terms'] = True
            big['any additional terms_2'] = g('f23c_claims_ro_additional_terms')
        big['I need a restraining order for the following reasons:'] = g('f23c_claims_restraining_reasons')
    # FIX-F23C-P6-FIT: page 6 boxes use the same wrap-aware size (they were
    # left at the template's auto size and printed very large).
    if g('f23c_service_respondent_served').lower() == 'no':
        big['My application/motion is not being served on the respondent for the following reasons:'] = g('f23c_service_not_served_reasons')
    big['other issues'] = g('f23c_service_other_issues')
    big = {k: v for k, v in big.items() if v}
    font_pt = {}
    if big:
        sizes = _box_sizes(input_path, set(big))
        for k, v in big.items():
            if k not in sizes:
                sys.stderr.write(f'[fill_form23c] box not found: {k[:60]}\n')
                continue
            pt, ok = _wrap_fit_pt(v, *sizes[k])
            font_pt[k] = pt
            if not ok:
                sys.stderr.write(f'[fill_form23c] too long to fit at {pt:g}pt: {k[:60]}\n')
        fields.update(big)
    # Para 12 detail blanks are single-line (no wrapping): largest size,
    # 10pt down to 7pt, at which the text fits on one line.
    one_line = {k: v for k, v in one_line.items() if str(v).strip()}
    if one_line:
        sizes = _box_sizes(input_path, set(one_line))
        for k, v in one_line.items():
            if k not in sizes:
                sys.stderr.write(f'[fill_form23c] box not found: {k[:60]}\n')
                continue
            w = sizes[k][0]
            pt = 10.0
            while pt > 7.0 and _wrapped_line_count(v, (w - 6.0) * 0.95, pt) > 1:
                pt -= 0.5
            if _wrapped_line_count(v, (w - 6.0) * 0.95, pt) > 1:
                sys.stderr.write(f'[fill_form23c] too long to fit at {pt:g}pt: {k[:60]}\n')
            font_pt[k] = pt
        fields.update(one_line)
    # Para 8 one-line blanks: 10pt like the rest of the form (the template's
    # auto size prints them oversized).
    for k in ('time', 'time_2', 'date', 'year', 'number of weeks', 'date_2', 'date_3', 'number of children_2', 'distance (in numbers)',
              'date of birth of person restrained') + tuple(f'Birthdate dmyRow{i}' for i in range(1, 6)):
        if str(fields.get(k, '')).strip():
            font_pt[k] = 10

    # Page 6: para 16 (not served) and other issues. Sworn block left blank (D4).
    # (para 16 and other issues are filled with the reasons boxes above)

    # Court office address box is lower-case on this template. The court
    # name is a drop-down with three choices; pick the one that matches.
    fields['court office address'] = fields.get('Court office address', '')
    cn = str(fields.get('Name of court', ''))
    if 'Family Court Branch' in cn or cn.startswith('Superior Court of Justice Family Court'):  # FIX-UFC-COURT-NAME
        court_choice = 'Superior Court of Justice, Family Branch'
    elif cn.startswith('Superior Court of Justice'):
        court_choice = 'Superior Court of Justice'
    elif cn.startswith('Ontario Court of Justice'):
        court_choice = 'Ontario Court of Justice'
    else:
        court_choice = None

    fields = {k: v for k, v in fields.items() if str(v).strip()}
    fields.pop(')', None)
    n = _write_pdf(input_path, output_path, fields, checkboxes, font_pt=font_pt)
    # The template marks the self-employment blank "hidden on screen"
    # (only form-wide box with this flag); show it when it has an answer.
    unhide = {k for k in ('self-employment as (name or nature of respondent’s business)',) if k in fields}
    n += _set_radio_kids(output_path, radio_groups, court_choice, unhide=unhide)
    sys.stderr.write(f'[fill_form23c] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 25 — Order (General)
# ─────────────────────────────────────────────────────────────────────────────
def fill_form25(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    # FIX-F17-F25-FULL-ADDRESS: same full address-for-service block as _header()
    _hb = _header(d)
    courthouse = d.get('courthouse', '')
    cn = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    ca = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    ap = d.get('applicant_full_name', '')
    ap_addr = d.get('applicant_address', '')
    re_name = d.get('respondent_full_name', '')
    re_addr = d.get('respondent_address', '')
    fields = {
        'Court File Number': d.get('court_file_number', ''),
        'Court office address': ca,
        'Date of order': d.get('order_date', ''),
        "Judge's name": d.get('judge_name', ''),
        'name of person or persons': d.get('present_parties', f'{ap} and {re_name}'),
        'name of parties and lawyers in court': d.get('parties_in_court', ''),
        'name or names': d.get('other_parties', ''),
        'This court orders that': d.get('order_terms', ''),
        'pursuant to the Divorce Act (Canada), this court order that': d.get('divorce_act_terms', ''),
        "Pursuant to the Children's Law Reform Act, this court orders that": d.get('clra_terms', ''),
        'Pursuant to the Family Law Act, this court orders that': d.get('fla_terms', ''),
        'Date of signature': d.get('date_signed', ''),
        "Applicant's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": _hb["Applicant's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"],
        "Respondent's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": _hb["Respondent's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)"],
        "Applicant lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": d.get('applicant_lawyer', ''),
        "Respondent lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": d.get('respondent_lawyer', ''),
    }
    n = _write_pdf(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form25] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 25A — Divorce Order
# ─────────────────────────────────────────────────────────────────────────────
def fill_form25a(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', d.get('court_name', ''))
    ca   = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    fnum = d.get('court_file_number', '')
    ap   = d.get('applicant_full_name', '')
    ap_a = d.get('applicant_address', '')
    ap_law = d.get('applicant_lawyer_name', d.get('applicant_lawyer', ''))
    ap_law_a = d.get('applicant_lawyer_address', '')
    re_n = d.get('respondent_full_name', '')
    re_a = d.get('respondent_address', '')
    re_law = d.get('respondent_lawyer_name', d.get('respondent_lawyer', ''))
    re_law_a = d.get('respondent_lawyer_address', '')
    fields = {
        'form1[0].page1[0].p1[0].courtDetails[0].courtFileNumber[0]': fnum,
        'form1[0].page1[0].p1[0].courtDetails[0].court[0].courtOfficeAddress[0]': ca,
        'form1[0].page1[0].p1[0].appl[0].#subform[0].judge[0]': d.get('judge_name', ''),
        'form1[0].page1[0].p1[0].appl[0].#subform[0].dateofOrder[0]': d.get('order_date', ''),
        'form1[0].page1[0].p1[0].appl[0].start[0].applicants[0].appliant[0].textfield[0]': ap,
        'form1[0].page1[0].p1[0].appl[0].start[0].applicants[0].appliant[0].textfield[1]': ap_a,
        'form1[0].page1[0].p1[0].appl[0].start[0].applicants[0].applicantLawyer[0].textfield[0]': ap_law,
        'form1[0].page1[0].p1[0].appl[0].start[0].applicants[0].applicantLawyer[0].textfield[1]': ap_law_a,
        'form1[0].page1[0].p1[0].appl[0].start[0].respondents[0].respondant[0].textfield[0]': re_n,
        'form1[0].page1[0].p1[0].appl[0].start[0].respondents[0].respondant[0].textfield[1]': re_a,
        'form1[0].page1[0].p1[0].appl[0].start[0].respondents[0].respondantLawyer[0].textfield[0]': re_law,
        'form1[0].page1[0].p1[0].appl[0].start[0].respondents[0].respondantLawyer[0].textfield[1]': re_law_a,
        'form1[0].page1[0].p1[0].line1[0].application[0]': d.get('divorce_order_terms', ''),
        'form1[0].page1[0].p1[0].onDate[0].textfield[0]': d.get('divorce_effective_date', ''),
        'form1[0].page1[0].p1[0].line2[0].specify[0]': d.get('waive_waiting_period_reason', ''),
        'form1[0].page1[0].p1[0].names[0].textfield[0]': d.get('children_names', ''),
        'form1[0].page1[0].p1[0].orders[0].textfield[0]': d.get('child_support_term', ''),
        'form1[0].page1[0].p1[0].orders[0].textfield[1]': d.get('spousal_support_term', ''),
        'form1[0].page1[0].p1[0].orders[0].textfield[2]': d.get('custody_parenting_term', ''),
        'form1[0].page1[0].p1[0].textfield[0]': d.get('applicant_former_name', ''),
        # Page 2
        'form1[0].page1[0].p2[0].#subform[0].courtFileNumber[0]': fnum,
        'form1[0].page1[0].p2[0].textfield[0]': d.get('court_stamp_text', ''),
        'form1[0].page1[0].p2[0].dateofSignature[0]': d.get('date_signed', ''),
    }
    n = _write_pdf_lc(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form25a] Filled {n} fields\n')
    return n



# ─────────────────────────────────────────────────────────────────────────────
# Form 25F — Support Deduction Order
# ─────────────────────────────────────────────────────────────────────────────
def fill_form25f(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', d.get('court_name', ''))
    ca   = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    fnum = d.get('court_file_number', '')
    ap   = d.get('applicant_full_name', '')
    ap_a = d.get('applicant_address', '')
    ap_law = d.get('applicant_lawyer_name', d.get('applicant_lawyer', ''))
    ap_law_a = d.get('applicant_lawyer_address', '')
    re_n = d.get('respondent_full_name', '')
    re_a = d.get('respondent_address', '')
    re_law = d.get('respondent_lawyer_name', d.get('respondent_lawyer', ''))
    re_law_a = d.get('respondent_lawyer_address', '')
    payor = d.get('payor_full_name', re_n)
    sig_date = d.get('signature_date', d.get('date_signed', ''))
    fields = {
        'form1[0].page1[0].courtDetails[0].courtFileNo[0]': fnum,
        'form1[0].page1[0].courtDetails[0].court[0].courtOfficeAddress[0]': ca,
        'form1[0].page1[0].appl[0].#subform[0].judge[0]': d.get('judge_name', ''),
        'form1[0].page1[0].appl[0].#subform[0].dateofOrder[0]': d.get('order_date', ''),
        'form1[0].page1[0].appl[0].start[0].applicants[0].appliant[0].textfield[0]': ap,
        'form1[0].page1[0].appl[0].start[0].applicants[0].appliant[0].textfield[1]': ap_a,
        'form1[0].page1[0].appl[0].start[0].applicants[0].applicantLawyer[0].textfield[0]': ap_law,
        'form1[0].page1[0].appl[0].start[0].applicants[0].applicantLawyer[0].textfield[1]': ap_law_a,
        'form1[0].page1[0].appl[0].start[0].respondents[0].respondant[0].textfield[0]': re_n,
        'form1[0].page1[0].appl[0].start[0].respondents[0].respondant[0].textfield[1]': re_a,
        'form1[0].page1[0].appl[0].start[0].respondents[0].respondantLawyer[0].textfield[0]': re_law,
        'form1[0].page1[0].appl[0].start[0].respondents[0].respondantLawyer[0].textfield[1]': re_law_a,
        # Support order body fields
        'form1[0].page1[0].q1[0].legalname[0]': payor,
        'form1[0].page1[0].q1[0].born[0]': d.get('payor_dob', d.get('respondent_dob', '')),
        'form1[0].page1[0].q1[0].clauses[0]': d.get('support_order_clauses', ''),
        'form1[0].page1[0].q2[0].order[0]': d.get('support_amount_monthly', ''),
        'form1[0].page1[0].q3[0].order[0]': d.get('support_recipient_name', ap),
        'form1[0].page1[0].#subform[6].heard[0]': d.get('court_date', ''),
        'form1[0].page1[0].#subform[6].heard[1]': d.get('court_location', ''),
        'form1[0].page1[0].#subform[6].legalname[0]': d.get('represented_by', ''),
        'form1[0].page1[0].#subform[7].the[0]': d.get('service_on', ''),
        'form1[0].page1[0].#subform[7].notice[0]': d.get('service_method', ''),
        'form1[0].page1[0].line1[0].documents[0]': d.get('attached_doc_1', ''),
        'form1[0].page1[0].line2[0].documents[0]': d.get('attached_doc_2', ''),
        'form1[0].page1[0].line3[0].documents[0]': d.get('attached_doc_3', ''),
        # Page 2 file number repeat
        'form1[0].Master[0].Page2[0].courtFileNo[0]': fnum,
        # Signature
        'form1[0].signature[0].Date[0]': sig_date,
    }
    n = _write_pdf_lc(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form25f] Filled {n} fields\n')
    return n



# ─────────────────────────────────────────────────────────────────────────────
# Form 25G — Restraining Order
# ─────────────────────────────────────────────────────────────────────────────
def fill_form25g(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', d.get('court_name', ''))
    ca   = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    fnum = d.get('court_file_number', '')
    ap   = d.get('applicant_full_name', '')
    ap_a = d.get('applicant_address', '')
    ap_law = d.get('applicant_lawyer_name', d.get('applicant_lawyer', ''))
    ap_law_a = d.get('applicant_lawyer_address', '')
    re_n = d.get('respondent_full_name', '')
    re_a = d.get('respondent_address', '')
    re_law = d.get('respondent_lawyer_name', d.get('respondent_lawyer', ''))
    re_law_a = d.get('respondent_lawyer_address', '')
    sig_date = d.get('signature_date', d.get('date_signed', ''))
    fields = {
        'form1[0].page1[0].courtDetails[0].courtFileNo[0]': fnum,
        'form1[0].page1[0].courtDetails[0].court[0].courtOfficeAddress[0]': ca,
        'form1[0].page1[0].appl[0].#subform[0].judge[0]': d.get('judge_name', ''),
        'form1[0].page1[0].appl[0].#subform[0].dateofOrder[0]': d.get('order_date', ''),
        'form1[0].page1[0].appl[0].start[0].applicants[0].appliant[0].textfield[0]': ap,
        'form1[0].page1[0].appl[0].start[0].applicants[0].appliant[0].textfield[1]': ap_a,
        'form1[0].page1[0].appl[0].start[0].applicants[0].applicantLawyer[0].textfield[0]': ap_law,
        'form1[0].page1[0].appl[0].start[0].applicants[0].applicantLawyer[0].textfield[1]': ap_law_a,
        'form1[0].page1[0].appl[0].start[0].respondents[0].respondant[0].textfield[0]': re_n,
        'form1[0].page1[0].appl[0].start[0].respondents[0].respondant[0].textfield[1]': re_a,
        'form1[0].page1[0].appl[0].start[0].respondents[0].respondantLawyer[0].textfield[0]': re_law,
        'form1[0].page1[0].appl[0].start[0].respondents[0].respondantLawyer[0].textfield[1]': re_law_a,
        # Restraining order body
        'form1[0].page1[0].q1[0].legalname[0]': re_n,
        'form1[0].page1[0].q1[0].born[0]': d.get('respondent_dob', ''),
        'form1[0].page1[0].q1[0].clauses[0]': d.get('restraining_order_terms', ''),
        'form1[0].page1[0].q2[0].order[0]': d.get('restraining_address', ''),
        'form1[0].page1[0].q3[0].order[0]': d.get('exclusion_zone', ''),
        'form1[0].page1[0].q4[0].order[0]': d.get('review_date', ''),
        'form1[0].page1[0].q5[0].dated[0]': d.get('affidavit_date', ''),
        'form1[0].page1[0].q5[0].affidavit[0]': d.get('affidavit_person', ap),
        'form1[0].page1[0].q5[0].sworn[0]': d.get('affidavit_sworn_before', ''),
        'form1[0].page1[0].q5[0].legalName[0]': d.get('affidavit_legalname', ''),
        'form1[0].page1[0].q5[0].service[0]': d.get('affidavit_service_method', ''),
        'form1[0].page1[0].#subform[8].heard[0]': d.get('court_date', ''),
        'form1[0].page1[0].#subform[8].restrain[0]': re_n,
        'form1[0].page1[0].#subform[9].the[0]': d.get('service_on', ''),
        'form1[0].page1[0].line1[0].documents[0]': d.get('attached_doc_1', ''),
        'form1[0].page1[0].line2[0].documents[0]': d.get('attached_doc_2', ''),
        'form1[0].page1[0].line3[0].documents[0]': d.get('attached_doc_3', ''),
        'form1[0].page1[0].#subform[14].date[0]': d.get('order_effective_date', ''),
        'form1[0].page1[0].#subform[14].dated[0]': d.get('order_expiry_date', ''),
        'form1[0].Master[0].Page2[0].courtFileNo[0]': fnum,
        'form1[0].page1[0].signature[0].Date[0]': sig_date,
    }
    n = _write_pdf_lc(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form25g] Filled {n} fields\n')
    return n



# ─────────────────────────────────────────────────────────────────────────────
# Form 35.1 — Affidavit (Best Interests of Child)
# ─────────────────────────────────────────────────────────────────────────────
# FIX-F351-CONTINUATION: paragraph number and wording for each Form 35.1
# answer box, in form order (used on the continuation page).
_F351_PARA = {
    'Names you have been known by': ('1', 'During my life, I have also used or been known by the following names'),
    'Describe incident(s) or episode(s) and provide information about the nature of the violence or abuse, who committed the violence and who the victim(s) was/were':
        ('8', 'Violence or abuse the court should consider'),
    'Details of civil protection order': ('9', 'Civil protection order or proceeding involving the other party'),
    'Details of criminal offence or any criminal orders that relate to you or to a member of your family':
        ('10', 'Criminal charges or orders involving the other party'),
    'address': ('12(a)', 'I plan to live at the following address'),
    # FIX-F351-Q12C-WHO
    'Names of person(s) making decisions for the child(ren) jointly with me':
        ('12(c)', 'Decisions for the child(ren) will be made jointly by me and'),
    'Names of person(s) making decisions for the child(ren)':
        ('12(c)', 'Decisions for the child(ren) will be made by'),
    'Decisions for the child(ren) - further details':
        ('12(c)', 'Decisions for the child(ren) - additional details'),
    'Name of your place of work or school': ('12(d)', 'Name of my place of work or school'),
    'Changes to plans for work and/or school':
        ('12(d)', 'I anticipate that my plans for work and/or school may change as follows'),
    'child(ren) will attend school, daycare or be cared for by others on a regular basis - details':
        ('12(e)', 'The child(ren) will attend school, daycare or be cared for by others on a regular basis as follows'),
    'plan for the other parent’s time with the child - details':
        ('12(f)', "My plan for the other parent's time with the child, which is in the child's best interests"),
    'plan for the child(ren) to have contact with others, including other family members - details':
        ('12(g)', 'My plan for the child(ren) to have contact with others, including other family members'),
    'Relatives, friends or community services supporting care of the child(ren)':
        ('12(i)', 'I will have support from the following relatives, friends or community services'),
    # FIX-F351-PARTB
    'Name of local police force': ('17', 'I sent a request for a police records check to'),
    'Date of report from local police force': ('17', 'My police records check is dated'),
    'Date of request to local police force': ('17', 'I sent a request for a police records check on'),
    'Q17 offences since police records check':
        ('17', 'Since the date that the attached police records check was completed, I have been found guilty of or charged with the following offence(s)'),
}
_F351_ORDER = list(_F351_PARA)
# FIX-F351-Q1-NAMES: the form says "Write N/A if any of the paragraphs do
# not apply". Answers that only say none / no / not applicable print "N/A".
_F351_NA_WORDS = {'n/a', 'na', 'n.a.', 'none', 'no', 'nil', 'nothing',
                  'not applicable', 'does not apply', 'no other names'}


def _f351_na(v):
    v = str(v or '').strip()
    return 'N/A' if v.rstrip('.').strip().lower() in _F351_NA_WORDS else v


def _f351_today():
    try:
        from zoneinfo import ZoneInfo
        from datetime import datetime as _dtm
        return _dtm.now(ZoneInfo('America/Toronto')).date()
    except Exception:
        return date.today()


def _f351_children(d):
    """FIX-F351-Q2-CHILDREN: one dict per child for Form 35.1 Q2."""
    def g(k):
        return str(d.get(k) or '').strip()
    def count(k):
        try:
            return max(0, min(10, int(float(g(k)))))
        except ValueError:
            return 0
    n = max(count('children_count'), count('f351_children_count'))
    for j in range(10):  # answers present beyond the count still count
        if g(f'child_{j+1}_name') or g(f'f351_children_child_{j}_full_name'):
            n = max(n, j + 1)
    today = _f351_today()
    kids = []
    for j in range(n):
        m = f'child_{j+1}_'           # main case children (1-based)
        f = f'f351_children_child_{j}_'  # Form 35.1 children screen (0-based)
        dob_raw = g(m + 'dob') or g(f + 'dob')
        age = ''
        try:
            y, mo, dd = (int(x) for x in dob_raw.split('-'))
            b = date(y, mo, dd)
            if b <= today:
                yrs = today.year - y - ((today.month, today.day) < (mo, dd))
                if yrs >= 1:
                    age = str(yrs)
                else:
                    mos = (today.year - y) * 12 + today.month - mo - (today.day < dd)
                    age = '%d mo' % mos
        except (ValueError, TypeError):
            pass
        kids.append({
            'name': g(m + 'name') or g(f + 'full_name'),
            'dob': format_dob(dob_raw),
            'age': age or g(f + 'age'),
            'parents': g(f + 'parents'),
            'lives_with': g(m + 'lives_with') or g(f + 'lives_with'),
            'relationship': g(f + 'relationship'),
        })
    return kids


def _f351_prep_template(input_path, q17_box=False):
    """FIX-F351-Q2-CHILDREN: a working copy of the Form 35.1 template for
    this fill only (the template file is never changed).
    - The page 1 Q2 "My relationship to the child" boxes are named
      ') - child N', the same name as the page 2 Q3 boxes, so filling one
      filled both. The page 1 ones are renamed 'Q2 relationship - child N'.
    - The Q2 name, parents and relationship boxes are only one line tall
      inside a row that is two lines tall. They are made as tall as the
      row's "lives with" box (same printed row) and allowed to wrap, so a
      name like "Jordan Smith and Alex Lee" fits.
    Returns the copy's path, or the original path if anything goes wrong."""
    import tempfile
    from pypdf.generic import NameObject as _N, NumberObject as _Num, \
        ArrayObject as _A, FloatObject as _F, create_string_object as _S
    try:
        r = pypdf.PdfReader(input_path)
        w = pypdf.PdfWriter()
        w.append(r)
        pg = w.pages[0]
        rows = {}
        widgets = []
        for a in pg.get('/Annots') or []:
            o = a.get_object()
            t = str(o.get('/T') or '')
            for i in range(1, 6):
                if t == 'Children in this case - Name(s) of all people child lives with now (include address if child does not live with you) - child %d' % i:
                    rows[i] = (float(o['/Rect'][1]), float(o['/Rect'][3]))
            widgets.append((t, o))
        for t, o in widgets:
            for i in range(1, 6):
                grow = t in ('Children in this case - full legal name - child %d' % i,
                             'Children in this case - Full legal name(s) of parent(s) - child %d' % i,
                             ') - child %d' % i)
                if not grow:
                    continue
                if t == ') - child %d' % i:
                    o[_N('/T')] = _S('Q2 relationship - child %d' % i)
                if i in rows:
                    x1, x2 = float(o['/Rect'][0]), float(o['/Rect'][2])
                    o[_N('/Rect')] = _A([_F(x1), _F(rows[i][0]), _F(x2), _F(rows[i][1])])
                    o[_N('/Ff')] = _Num(int(o.get('/Ff') or 0) | 4096)  # multiline
        # FIX-F351-Q4Q5-ROWS: in the paragraph 4 and 5 tables the "Court
        # location" box is one line tall inside a row that is three lines
        # tall. It is made as tall as the next box in the same printed row
        # and allowed to wrap, so "Ontario Court of Justice, Sudbury" fits.
        _grow = {}
        for _i in range(1, 4):
            _grow['Family court case(s) - Court location %d' % _i] = \
                'Family court case(s) - Names of parties in the case %d' % _i
            _grow['Civil protection proceedings - Court location %d' % _i] = \
                'Civil protection proceedings - Names of people involved in the case %d' % _i
        # FIX-F351-Q3-ROWS: same for the paragraph 3 name and relationship
        # boxes (one line tall, the row's "lives with" box is two lines).
        for _i in range(1, 4):
            _lw = 'Not listed in paragraph 2 - Name(s) of person(s) with whom child lives now (if child is under 18 years old) - child %d' % _i
            _grow['Not listed in paragraph 2 - Full Legal Name - child %d' % _i] = _lw
            _grow[') - child %d' % _i] = _lw
            _grow['Not listed in paragraph 2 - Birthdate (d, m, y) - child %d' % _i] = _lw
        # FIX-F351-Q11-ROWS: paragraph 11 child name boxes (page 4).
        for _i in range(1, 6):
            _grow["Child's Name %d" % _i] = \
                'Name(s) of Caregiver(s) or children\u2019s aid society) %d' % _i
        # FIX-F351-Q12B-ROWS: paragraph 12(b) birthdate and relationship
        # boxes (page 4) made row-height so the row lines up at the top.
        for _i in range(1, 5):
            _grow['Birthdate (d, m, y) %d' % _i] = \
                'Full legal name and other names this person has used %d' % _i
            _grow['Relationship to you %d' % _i] = \
                'Full legal name and other names this person has used %d' % _i
        # FIX-F351-Q12H-ROWS: paragraph 12(h) child name boxes (page 5).
        for _i in range(1, 5):
            _grow['Name of child %d' % _i] = 'Child %d - Description of needs' % _i
        _tall = set(_grow.values())
        for _pg in w.pages:
            _rects, _short = {}, []
            for a in _pg.get('/Annots') or []:
                o = a.get_object()
                t = str(o.get('/T') or '')
                if t in _tall:
                    _rects[t] = (float(o['/Rect'][1]), float(o['/Rect'][3]))
                elif t in _grow:
                    _short.append((t, o))
            for t, o in _short:
                if _grow[t] in _rects:
                    y1, y2 = _rects[_grow[t]]
                    x1, x2 = float(o['/Rect'][0]), float(o['/Rect'][2])
                    o[_N('/Rect')] = _A([_F(x1), _F(y1), _F(x2), _F(y2)])
                    o[_N('/Ff')] = _Num(int(o.get('/Ff') or 0) | 4096)  # multiline
        # FIX-F351-PARTB: Q17 offences line (page 7) has no box. Only when
        # there is an answer to print, a one-line box is added in the blank
        # space under "...charged with the following offence(s):".
        if q17_box and len(w.pages) >= 7:
            from pypdf.generic import DictionaryObject as _D
            _p7 = w.pages[6]
            _bx = _D({
                _N('/Type'): _N('/Annot'), _N('/Subtype'): _N('/Widget'),
                _N('/FT'): _N('/Tx'), _N('/F'): _Num(4),
                _N('/T'): _S(_F351_Q17_BOX), _N('/TU'): _S(_F351_Q17_BOX),
                _N('/Rect'): _A([_F(80), _F(116), _F(575), _F(133)]),
                _N('/DA'): _S('/Helv 10 Tf 0 g'), _N('/P'): _p7.indirect_reference,
            })
            _ref = w._add_object(_bx)
            if '/Annots' in _p7:
                _p7['/Annots'].append(_ref)
            else:
                _p7[_N('/Annots')] = _A([_ref])
            _af = w._root_object.get('/AcroForm')
            if _af is not None:
                _af = _af.get_object()
                if '/Fields' in _af:
                    _af['/Fields'].append(_ref)
        fd, path = tempfile.mkstemp(suffix='.pdf', prefix='f351tpl_')
        with os.fdopen(fd, 'wb') as fh:
            w.write(fh)
        return path
    except Exception as e:
        sys.stderr.write(f'[fill_form35_1] template prep skipped: {e}\n')
        return input_path


# FIX-F351-Q4Q5-ROWS: Form 35.1 tables filled from the app's "rows"
# questions (one card per row on the screen). Each table: paragraph number,
# the paragraph's words for the continuation page, the yes/no answer key,
# the older free-text answer key (before rows existed), the row answer key
# prefix (0-based rows), the number of rows printed on the form, and the
# columns (answer name, label, form box name with the 1-based row number).
_F351_TABLES = (
    # FIX-F351-Q3-ROWS: page 2 relationship boxes are named ') - child N'
    # (the page 1 boxes of the same name are renamed in the working copy).
    ('3', 'I am also the parent of or have acted as a parent to the following child(ren)',
     'f351_other_children_other_children_any', 'f351_other_children_other_children',
     'f351_other_children_other_child_rows', 3, (
         ('name', "Child's full legal name", 'Not listed in paragraph 2 - Full Legal Name - child %d'),
         ('dob', 'Birthdate (d, m, y)', 'Not listed in paragraph 2 - Birthdate (d, m, y) - child %d'),
         ('relationship', 'My relationship to the child', ') - child %d'),
         ('lives_with', 'Name(s) of the person(s) with whom the child lives now',
          'Not listed in paragraph 2 - Name(s) of person(s) with whom child lives now (if child is under 18 years old) - child %d'),
     )),
    ('4', 'I am or have been a party in the following family court case(s)',
     'f351_history_family_cases_any', 'f351_history_family_cases',
     'f351_history_family_case_rows', 3, (
         ('location', 'Court location', 'Family court case(s) - Court location %d'),
         ('parties', 'Names of parties in the case', 'Family court case(s) - Names of parties in the case %d'),
         ('children', 'Name(s) of child(ren)', 'Family court case(s) - Name(s) of child(ren) %d'),
         ('orders', 'Court orders made (include dates of orders)', 'Family court case(s) - Court orders made (include dates) %d'),
     )),
    ('5', 'I am or have been involved in the following civil protection proceedings',
     'f351_history_civil_protection_any', 'f351_history_civil_protection',
     'f351_history_civil_protection_rows', 3, (
         ('location', 'Court location', 'Civil protection proceedings - Court location %d'),
         ('people', 'Names of people involved in the case', 'Civil protection proceedings - Names of people involved in the case %d'),
         ('orders', 'Civil protection orders made (include dates of orders)', 'Civil protection proceedings - Civil protection orders made (include dates) %d'),
     )),
    # FIX-F351-Q6Q7-ROWS
    ('6', 'I have been found guilty of the following criminal offence(s) for which I have not received a pardon',
     'f351_history_convictions_any', 'f351_history_criminal_convictions',
     'f351_history_conviction_rows', 3, (
         ('charge', 'Charge', 'Found guilty - Charge %d'),
         ('date', 'Approximate date of finding of guilt', 'Found guilty - Approximate date of finding of guilt %d'),
         ('sentence', 'Sentence received', 'Found guilty - Sentence received %d'),
     )),
    ('7', 'I am now charged with the following criminal offence(s)',
     'f351_history_current_charges_any', 'f351_history_current_charges',
     'f351_history_current_charge_rows', 3, (
         ('charge', 'Charge', 'Charged with criminal offence(s) - Charge %d'),
         ('next_date', 'Date of next court appearance', 'Charged with criminal offence(s) - Date of next court appearance %d'),
         ('release', 'Terms of release while waiting for trial', 'Charged with criminal offence(s) - Terms of release while waiting for trial %d'),
     )),
    # FIX-F351-Q11-ROWS: no Yes/No (every child has had a caregiver).
    # Rows are built by _f351_q11_rows from child / caregivers / from / to.
    ('11', 'To the best of my knowledge, since birth, the child(ren) in this case has/have lived with the following caregiver(s)',
     None, 'f351_care_history_care_history',
     'f351_care_history_care_rows', 5, (
         ('child', "Child's name", "Child's Name %d"),
         ('caregivers', 'Name(s) of caregiver(s) or children\u2019s aid society',
          'Name(s) of Caregiver(s) or children\u2019s aid society) %d'),
         ('period', 'Period(s) of time with caregiver(s) (d,m,y to d,m,y)',
          'Period(s) of Time with Caregiver(s) (d,m,y to d,m,y) %d'),
     )),
    # FIX-F351-Q12B-ROWS: people (other than the children in this case) who
    # will live with the user. Rows are built by _f351_q12b_rows.
    ('12(b)', 'The following people (other than the child(ren) involved in this case) will be living with me',
     'f351_plan_household_any', 'f351_plan_household_members',
     'f351_plan_household_rows', 4, (
         ('name', 'Full legal name and other names this person has used',
          'Full legal name and other names this person has used %d'),
         ('dob', 'Birthdate (d,m,y)', 'Birthdate (d, m, y) %d'),
         ('relationship', 'Relationship to you', 'Relationship to you %d'),
         ('cas', 'Has a child of this person ever been in the care of a children\u2019s aid society?',
          'Has a child of this person ever been in the care of a children\u2019s aid society? (if yes, give details) %d'),
         ('crim', 'Has this person been found guilty of a criminal offence (no pardon) or is he/she currently facing criminal charges?',
          'Has this person been found guilty of a criminal offence (for which he/she has not received a pardon) or is he/she currently facing criminal charges? (if yes, give details) %d'),
     )),
    # FIX-F351-PARTB: Part B (pages 7-8), only for a non-parent (the
    # "Part B applies to you" answer is Yes). Paragraph 18 has no yes/no
    # (everyone has lived somewhere); neither does 19.
    ('16', 'To the best of my knowledge, the child(ren) in this case has/have been involved in the following decision-making, parenting time, or contact cases',
     'f351_partb_child_cases_any', 'f351_partb_child_involvement_cases',
     'f351_partb_child_case_rows', 5, (
         ('children', 'Child(ren)\u2019s name(s)', 'Child(ren)\u2019s name(s) %d'),
         ('type', 'Type of case', 'Type of Case %d'),
         ('details', 'Details of case', 'Details of Case %d'),
     )),
    ('18', 'Since I turned 18 years old or became a parent, whichever was earlier, I have lived in the following places',
     None, 'f351_partb_address_history',
     'f351_partb_address_rows', 7, (
         ('dates', 'Approximate dates (month/year to month/year)', 'Approximate dates (month/year to month/year) %d'),
         ('place', 'City, town or municipality where I lived',
          'City, town or municipality where you lived (if outside of Ontario, give name of province, state or country) %d'),
     )),
    ('19', 'I have provided a signed consent form to the court, which authorizes each of the children\u2019s aid societies listed below to send a report to me and to the court',
     None, 'f351_partb_cas_consent_societies',
     'f351_partb_cas_society_rows', 6, (
         ('name', 'Name of children\u2019s aid society', 'Name of children\u2019s aid society %d'),
     )),
)
# FIX-F351-PARTB: Part B tables are filled only for a non-parent.
_F351_PART_B = {'16', '18', '19'}
# FIX-F351-PARTB: Q17 "offences since the police records check" has a
# printed line on page 7 but no box. When the user lists offences (or says
# none), a one-line box is added to this fill's working copy in that space.
_F351_Q17_BOX = 'Q17 offences since police records check'
# FIX-F351-Q6Q7-ROWS: date-picker answers (yyyy-mm-dd) print dd/mm/yyyy.
_F351_DATE_COLS = {('3', 'dob'), ('7', 'next_date')}
# Columns kept to one line even when their box is made row-height (so the
# row's text lines up at the top).
_F351_ONE_LINE_COLS = {('3', 'dob'), ('12(b)', 'dob')}
# FIX-F351-Q6Q7-ROWS (decision D8): the app's question 6.5 (discharges,
# withdrawn charges, other prior involvement) has no box of its own on the
# form. It is printed under paragraph 6 as "Other involvement: ..." in the
# Charge box of the next empty row, or on the continuation page if there is
# no empty row or it doesn't fit on one line.
_F351_TABLE_EXTRA = {
    '6': ('f351_history_criminal_other_involvement', 'Other involvement',
          'Other involvement (discharges, withdrawn charges and other prior involvement)'),
}
# Order of paragraphs on the continuation page.
_F351_PARA_SEQ = ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
                  '12(a)', '12(b)', '12(c)', '12(d)', '12(e)', '12(f)',
                  '12(g)', '12(h)', '12(i)', '13', '14', '15', '16',
                  '17', '18', '19')


def _f351_para_pos(para):
    return _F351_PARA_SEQ.index(para) if para in _F351_PARA_SEQ else len(_F351_PARA_SEQ)


def _f351_q11_rows(d):
    """FIX-F351-Q11-ROWS: paragraph 11 rows. The screen asks From and To
    dates; the form has one "d,m,y to d,m,y" box. A blank To date means the
    child still lives with that caregiver (the screen says so) and prints
    "present". A blank child name is filled in only when the case has
    exactly one child (the name from the children answers)."""
    def g(k):
        return str(d.get(k) or '').strip()
    kids = [k['name'] for k in _f351_children(d) if k.get('name')]
    out = []
    for i in range(10):
        p = 'f351_care_history_care_rows_%d_' % i
        child, cg, fr, to = g(p + 'child'), g(p + 'caregivers'), g(p + 'from'), g(p + 'to')
        if not (child or cg or fr or to):
            continue
        fr, to = format_dob(fr), format_dob(to)
        if fr:
            period = '%s to %s' % (fr, to or 'present')
        elif to:
            period = 'until %s' % to
        else:
            period = ''
        if not child and len(kids) == 1:
            child = kids[0]
        out.append({'child': child, 'caregivers': cg, 'period': period})
    return out


def _f351_q12b_rows(d):
    """FIX-F351-Q12B-ROWS: paragraph 12(b) rows. The children's aid and
    criminal columns are a Yes/No question plus details on the screen; the
    form box prints "No", or "Yes" followed by the details. Details are
    printed only when the answer is Yes (a stale detail left after changing
    to No is not printed). Unanswered stays blank."""
    def g(k):
        return str(d.get(k) or '').strip()

    def yn_cell(ans, det):
        a = _f351_yn_val(ans)
        if a == 'yes':
            return ('Yes. ' + det) if det else 'Yes'
        if a == 'no':
            return 'No'
        return ''
    out = []
    for i in range(10):
        p = 'f351_plan_household_rows_%d_' % i
        raw = {c: g(p + c) for c in ('name', 'dob', 'relationship', 'cas_any',
                                     'cas_details', 'crim_any', 'crim_details')}
        if not any(raw.values()):
            continue
        out.append({'name': raw['name'], 'dob': format_dob(raw['dob']),
                    'relationship': raw['relationship'],
                    'cas': yn_cell(raw['cas_any'], raw['cas_details']),
                    'crim': yn_cell(raw['crim_any'], raw['crim_details'])})
    return out


def _f351_yn_val(v):
    v = str(v or '').strip().lower()
    return 'yes' if v in ('yes', 'true', '1') else ('no' if v in ('no', 'false', '0') else '')


# FIX-F351-Q12H-ROWS: paragraph 12(h) need types -> page 5 tick boxes.
_F351_NEED_TYPES = (('medical', 'medical', 'Medical'),
                    ('educational', 'educational', 'Educational'),
                    ('mental', 'mental health', 'Mental health'),
                    ('developmental', 'developmental', 'Developmental'),
                    ('other', 'other', 'Other'))
_F351_NEED_TITLE = ('The child or one or more of the children has/have the following special needs '
                    'and will receive support and services for those needs')


def _f351_fill_needs(d, tpl, fields, checkboxes, font, more):
    """FIX-F351-Q12H-ROWS: paragraph 12(h) table (4 printed rows, page 5).
    The "does not / has special needs" ticks come from the Yes/No answer
    (set by the caller). One row per child with special needs: name, need
    type ticks, description, support. A blank child name is filled only
    when the case has exactly one child. Rows 5+ and text too long for its
    box go to the continuation page. Before the rows existed, a single
    text answer was saved; until rows are filled it is printed in full on
    the continuation page."""
    def g(k):
        return str(d.get(k) or '').strip()
    yn = g('f351_plan_special_needs').lower()
    if yn in ('no', 'false', '0'):
        return
    kids = [k['name'] for k in _f351_children(d) if k.get('name')]
    rows = []
    for i in range(10):
        p = 'f351_plan_special_needs_rows_%d_' % i
        r = {c: g(p + c) for c in ('child', 'types', 'description', 'support')}
        if not any(r.values()):
            continue
        if not r['child'] and len(kids) == 1:
            r['child'] = kids[0]
        r['types'] = {t.strip() for t in r['types'].split(',') if t.strip()}
        rows.append(r)
    if not rows:
        old = g('f351_plan_special_needs_details')
        if old and _f351_na(old) != 'N/A':
            fields['Name of child 1'] = 'See continuation page'
            font['Name of child 1'] = 7.0
            more.append(('12(h)', 'Paragraph 12(h). ' + _F351_NEED_TITLE, old))
        return
    boxes = []
    for i in range(1, min(4, len(rows)) + 1):
        boxes += ['Name of child %d' % i, 'Child %d - Description of needs' % i,
                  'Support or service child %d will be receiving' % i]
    sz = _box_sizes(tpl, set(boxes))
    cap = 4 if len(rows) <= 4 else 3  # FIX-F351-MORE-ROWS
    for i, r in enumerate(rows, start=1):
        overflow = i > cap
        if not overflow:
            for c, k in (('child', 'Name of child %d' % i),
                         ('description', 'Child %d - Description of needs' % i),
                         ('support', 'Support or service child %d will be receiving' % i)):
                if not r[c]:
                    continue
                fields[k] = r[c]
                if k not in sz:
                    sys.stderr.write(f'[fill_form35_1] box not found: {k[:60]}\n')
                    continue
                pt, ok = _wrap_fit_pt(r[c], *sz[k])
                if ok:
                    font[k] = pt
                else:
                    sys.stderr.write(f'[fill_form35_1] paragraph 12(h) row {i} {c} too long, continued on attached page\n')
                    fields[k] = 'See continuation page'
                    font[k] = 7.0
                    overflow = True
            for v, box, _lbl in _F351_NEED_TYPES:
                checkboxes['Child %d - %s special needs' % (i, box)] = v in r['types']
        if overflow:
            lines = [("Name of child", r['child']),
                     ('Special need(s)', ', '.join(l for v, _b, l in _F351_NEED_TYPES if v in r['types'])),
                     ("Description of child's needs", r['description']),
                     ('Support or service child will be receiving', r['support'])]
            more.append(('12(h)', 'Paragraph 12(h). %s: row %d' % (_F351_NEED_TITLE, i),
                         '\n'.join('%s: %s' % (l, v) for l, v in lines if v)))
    if len(rows) > 4:
        sys.stderr.write(f'[fill_form35_1] paragraph 12(h): rows 4-{len(rows)} continued on attached page\n')
        _f351_more_note(fields, font, 'Name of child 4', 4, len(rows), sz)


def _f351_more_note(fields, font, box, first, last, sz):
    """FIX-F351-MORE-ROWS: when a table has more rows than the form prints,
    the last printed row says where the rest are, so nobody reading the
    form thinks the list ends there. Rows first..last are printed in full
    on the continuation page. The note is sized to fit its box."""
    note = ('Row %d continued on attached continuation page' % first if first == last
            else 'Rows %d to %d continued on attached continuation page' % (first, last))
    fields[box] = note
    w, h = sz.get(box, (0.0, 0.0))
    if not w:
        font[box] = 7.0
        return
    if h < 20:
        pt = 10.0
        while pt > 7.0 and _wrapped_line_count(note, (w - 4.0) * 0.95, pt) > 1:
            pt -= 0.5
        if _wrapped_line_count(note, (w - 4.0) * 0.95, pt) > 1:
            fields[box] = 'See continuation page'
            pt = 7.0
    else:
        pt, ok = _wrap_fit_pt(note, w, h)
        if not ok:
            fields[box] = 'See continuation page'
            pt = 7.0
    font[box] = pt


def _f351_rows(d, prefix, cols, limit=10):
    """Rows the user filled in (any cell not blank), in screen order.
    Every row index is checked, so a stale row count never loses a row."""
    out = []
    for i in range(limit):
        row = {c: str(d.get('%s_%d_%s' % (prefix, i, c)) or '').strip() for c, _l, _b in cols}
        if any(row.values()):
            out.append(row)
    return out


def _f351_fill_tables(d, tpl, fields, font, more):
    """Fill the Form 35.1 tables in _F351_TABLES.
    - "No" prints N/A in the first box of row 1 (the form says write N/A).
    - "Yes" prints each row the user filled. Each box is sized to fit
      (10pt down to 7pt). A box too long even at 7pt says "See continuation
      page" and that whole row is printed on the continuation page. Rows
      past the printed rows go on the continuation page too.
    - Not answered: blank, unless the older single free-text answer exists
      (saved before the rows questions): none-type words print N/A, other
      text is printed in full on the continuation page.
    more: list of (paragraph, title, text) for the continuation page."""
    _np = str(d.get('f351_partb_is_non_parent') or '').strip().lower() in ('yes', 'true', '1')
    for para, title, any_key, old_key, prefix, nrows, cols in _F351_TABLES:
        if para in _F351_PART_B and not _np:
            continue
        used = _f351_fill_one_table(d, tpl, fields, font, more, para, title, any_key,
                                    old_key, prefix, nrows, cols)
        if para in _F351_TABLE_EXTRA:
            _f351_table_extra(d, tpl, fields, font, more, para, nrows, cols, used)


def _f351_table_extra(d, tpl, fields, font, more, para, nrows, cols, used):
    key, lead, title = _F351_TABLE_EXTRA[para]
    v = _f351_na(d.get(key))
    if not v or v == 'N/A':
        return
    line = '%s: %s' % (lead, v)
    if used < nrows:
        k = cols[0][2] % (used + 1)
        w, _h = _box_sizes(tpl, {k}).get(k, (0.0, 0.0))
        pt = 10.0
        while pt > 7.0 and _wrapped_line_count(line, (w - 4.0) * 0.95, pt) > 1:
            pt -= 0.5
        if w and _wrapped_line_count(line, (w - 4.0) * 0.95, pt) == 1:
            fields[k] = line
            font[k] = pt
            return
        fields[k] = '%s: see continuation page' % lead
        font[k] = 7.0
    sys.stderr.write(f'[fill_form35_1] paragraph {para} {lead.lower()} continued on attached page\n')
    more.append((para, 'Paragraph %s. %s' % (para, title), v))


def _f351_fill_one_table(d, tpl, fields, font, more, para, title, any_key,
                         old_key, prefix, nrows, cols):
    """Fill one table. Returns how many printed rows are now used (the
    whole table counts as used when rows went past the printed rows)."""
    yn = str(d.get(any_key) or '').strip().lower() if any_key else ''
    yn = 'yes' if yn in ('yes', 'true', '1') else ('no' if yn in ('no', 'false', '0') else '')
    if para == '11':
        rows = _f351_q11_rows(d)
    elif para == '12(b)':
        rows = _f351_q12b_rows(d)
    else:
        rows = _f351_rows(d, prefix, cols)
    old = str(d.get(old_key) or '').strip()
    first_box = cols[0][2] % 1
    if yn == 'no':
        fields[first_box] = 'N/A'
        font[first_box] = 10.0
        return 1
    if not rows:
        if yn == 'yes':
            sys.stderr.write(f'[fill_form35_1] paragraph {para}: answered yes but no rows filled\n')
            return 0
        elif old:
            if _f351_na(old) == 'N/A':
                fields[first_box] = 'N/A'
                font[first_box] = 10.0
            else:
                fields[first_box] = 'See continuation page'
                font[first_box] = 7.0
                more.append((para, 'Paragraph %s. %s' % (para, title), old))
            return 1
        return 0
    for row in rows:
        for c, _l, _b in cols:
            if (para, c) in _F351_DATE_COLS and _re_amt.match(r'^\d{4}-\d{2}-\d{2}$', row[c]):
                row[c] = format_dob(row[c])
    boxes = [b % i for i in range(1, min(nrows, len(rows)) + 1) for _c, _l, b in cols]
    sz = _box_sizes(tpl, set(boxes))
    # FIX-F351-MORE-ROWS: more rows than the form prints: the last printed
    # row becomes the note and it and the rest go on the continuation page.
    cap = nrows if len(rows) <= nrows else nrows - 1
    for i, row in enumerate(rows, start=1):
        overflow = i > cap
        if not overflow:
            for c, _l, b in cols:
                k = b % i
                if not row[c]:
                    continue
                fields[k] = row[c]
                if k not in sz:
                    sys.stderr.write(f'[fill_form35_1] box not found: {k[:60]}\n')
                    continue
                w, h = sz[k]
                if h < 20 or (para, c) in _F351_ONE_LINE_COLS:
                    pt = 10.0
                    while pt > 7.0 and _wrapped_line_count(row[c], (w - 4.0) * 0.95, pt) > 1:
                        pt -= 0.5
                    ok = _wrapped_line_count(row[c], (w - 4.0) * 0.95, pt) == 1
                else:
                    pt, ok = _wrap_fit_pt(row[c], w, h)
                if ok:
                    font[k] = pt
                else:
                    sys.stderr.write(f'[fill_form35_1] paragraph {para} row {i} {c} too long, continued on attached page\n')
                    fields[k] = 'See continuation page'
                    font[k] = 7.0
                    overflow = True
        if overflow:
            more.append((para, 'Paragraph %s. %s: row %d' % (para, title, i),
                         '\n'.join('%s: %s' % (l, row[c]) for c, l, _b in cols if row[c])))
    if len(rows) > nrows:
        sys.stderr.write(f'[fill_form35_1] paragraph {para}: rows {nrows}-{len(rows)} continued on attached page\n')
        _f351_more_note(fields, font, cols[0][2] % nrows, nrows, len(rows), sz)
    return nrows if len(rows) > nrows else len(rows)


def fill_form35_1(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    # FIX-F351-PARTB: Part B (pages 7-8) only for a non-parent.
    _np = str(d.get('f351_partb_is_non_parent') or '').strip().lower() in ('yes', 'true', '1')
    _pc17 = str(d.get('f351_partb_police_check') or '').strip().lower() if _np else ''
    _off_yn = str(d.get('f351_partb_police_new_offences_any') or '').strip().lower()
    _off_yn = 'yes' if _off_yn in ('yes', 'true', '1') else ('no' if _off_yn in ('no', 'false', '0') else '')
    _off = ''
    if _pc17 == 'attached':
        if _off_yn == 'no':
            _off = 'N/A'
        elif _off_yn == 'yes':
            _off = str(d.get('f351_partb_police_new_offences') or '').strip()
    _tpl = _f351_prep_template(input_path, q17_box=bool(_off))
    # FIX-F351-PAGE1: the form has 8 pages, so the court file number goes on
    # pages 1-8 (was 1-5). Name, birthdate and "I live in" read the Form 35.1
    # identity answers first (asked when Form 35.1 is on its own), then the
    # main case answers (combined cases hide the identity screen). The old
    # names filer_dob / filer_city are never saved by any screen.
    fields = _header(d, pages=8)
    fields['Full legal name'] = (
        d.get('f351_identity_full_name') or d.get('filer_full_name')
        or d.get('applicant_full_name') or '').strip()
    fields['Date of birth (d, m, y)'] = format_dob(
        (d.get('f351_identity_dob') or d.get('filer_dob')
         or d.get('applicant_dob') or '').strip())
    _f351_city = (d.get('f351_identity_city') or '').strip()
    if not _f351_city:
        # Main case: city + province. ON is written out as Ontario. No
        # province is printed if none was given (never assumed).
        _c = (d.get('applicant_city') or '').strip()
        _p = (d.get('applicant_province') or '').strip()
        if _p.upper() in ('ON', 'ONT', 'ONT.'):
            _p = 'Ontario'
        _f351_city = ', '.join(x for x in (_c, _p) if x)
    fields['Name of city, town or municipality and province, state or country if outside of Ontario'] = _f351_city
    fields['Court address'] = COURTHOUSE_ADDRESSES_FE.get(d.get('courthouse',''), '')
    # FIX-F351-Q1-NAMES: Q1 other names used, from the Form 35.1 identity
    # screen (now also asked in combined cases). Blank stays blank.
    fields['Names you have been known by'] = _f351_na(d.get('f351_identity_other_names'))
    # FIX-F351-Q2-CHILDREN: Q2 children table. Name, birthdate and who
    # the child lives with come from the main case "Your children" answers
    # (children section) when given, otherwise from the Form 35.1 children
    # screen. Parents and relationship come from the Form 35.1 children
    # screen (asked in combined cases too). Birthdate dd/mm/yyyy; age worked
    # out from the birthdate on the day the PDF is made (Toronto date),
    # else the age the user typed. Blank stays blank.
    _f351_kids = _f351_children(d)
    _q2_cols = (
        ('name', 'Children in this case - full legal name - child %d'),
        ('dob', 'Children in this case - Birthdate (d, m, y) - child %d'),
        ('age', 'Children in this case - Age - child %d'),
        ('parents', 'Children in this case - Full legal name(s) of parent(s) - child %d'),
        ('lives_with', 'Children in this case - Name(s) of all people child lives with now (include address if child does not live with you) - child %d'),
        ('relationship', 'Q2 relationship - child %d'),
    )
    for _i, _kid in enumerate(_f351_kids[:5], start=1):
        for _col, _box in _q2_cols:
            if _kid.get(_col):
                fields[_box % _i] = _kid[_col]
    # FIX-F351-ONE-BOX: answers from the Form 35.1 screens that match one
    # box on the form. Printed as the user typed them (trimmed). Blank stays
    # blank. Yes/no questions tick only when answered.
    def _f351(key):
        return str(d.get(key) or '').strip()
    def _f351_yn(key):
        v = _f351(key).lower()
        return 'yes' if v in ('yes', 'true', '1') else ('no' if v in ('no', 'false', '0') else '')
    # Q8 violence or abuse the court should consider
    fields['Describe incident(s) or episode(s) and provide information about the nature of the violence or abuse, who committed the violence and who the victim(s) was/were'] = _f351('f351_violence_violence_history')
    # Q9 / Q10: "If yes, provide details." A "No" answer prints "No."
    for _yn, _det, _box in (
        ('f351_violence_other_party_protection', 'f351_violence_other_party_protection_details',
         'Details of civil protection order'),
        ('f351_violence_other_party_criminal', 'f351_violence_other_party_criminal_details',
         'Details of criminal offence or any criminal orders that relate to you or to a member of your family'),
    ):
        _a = _f351_yn(_yn)
        if _a == 'yes':
            fields[_box] = _f351(_det)
        elif _a == 'no':
            fields[_box] = 'No.'
    # Q12a planned address. The app's "use my address" button joins the
    # Unit answer even when it is "N/A"; drop those parts (same rule as
    # FIX-UNIT-NA).
    _pa = [x.strip() for x in _f351('f351_plan_plan_address').split(',')]
    fields['address'] = ', '.join(x for x in _pa if x and x.lower() not in _NO_UNIT)
    # Q12d-i text boxes
    # FIX-F351-Q12D-WORK: Q12d. Ticks from the "work or school right now"
    # choices (more than one allowed, as on the form); full/part time only
    # under the choice it belongs to. The workplace name prints when work
    # or school is chosen, or when the question is not answered yet (older
    # answers). "Plans may change" ticks only on Yes, with its details.
    _ws = {x.strip() for x in _f351('f351_plan_work_status').split(',') if x.strip()}
    _wt = _f351('f351_plan_work_time').lower()
    _st = _f351('f351_plan_school_time').lower()
    _pc = _f351_yn('f351_plan_plans_change')
    if not _ws or _ws & {'work', 'school'}:
        fields['Name of your place of work or school'] = _f351('f351_plan_workplace_name')
    if _pc == 'yes':
        fields['Changes to plans for work and/or school'] = _f351('f351_plan_plans_change_details')
    fields['child(ren) will attend school, daycare or be cared for by others on a regular basis - details'] = _f351('f351_plan_childcare_arrangements')
    fields['plan for the other parent’s time with the child - details'] = _f351('f351_plan_other_parent_time')
    fields['plan for the child(ren) to have contact with others, including other family members - details'] = _f351('f351_plan_contact_with_others')
    fields['Relatives, friends or community services supporting care of the child(ren)'] = _f351('f351_plan_support_network')
    # FIX-F351-Q12C-WHO: Q12c. One tick from the "who decides" choice. The
    # names box is printed only for the choice it belongs to (a name left
    # over from an earlier choice is not printed). The older free-text
    # answer is kept as "additional details". Nothing is ticked from the
    # old free text (it is not guessed).
    _who = str(d.get('f351_plan_decision_who') or '').strip().lower()
    if _who == 'jointly':
        fields['Names of person(s) making decisions for the child(ren) jointly with me'] = _f351('f351_plan_decision_joint_with')
    elif _who == 'other':
        fields['Names of person(s) making decisions for the child(ren)'] = _f351('f351_plan_decision_others')
    fields['Decisions for the child(ren) - further details'] = _f351('f351_plan_decision_making_plan')
    # FIX-F351-PARTB: Q17 police records check. One tick from the choice;
    # the date and police force print only under the option they belong to.
    # Date-picker answers print dd/mm/yyyy.
    def _f351_date(v):
        v = str(v or '').strip()
        return format_dob(v) if _re_amt.match(r'^\d{4}-\d{2}-\d{2}$', v) else v
    if _pc17 == 'attached':
        fields['Date of report from local police force'] = _f351_date(d.get('f351_partb_police_check_date'))
    elif _pc17 == 'requested':
        fields['Date of request to local police force'] = _f351_date(d.get('f351_partb_police_request_date'))
        fields['Name of local police force'] = _f351('f351_partb_police_force')
    if _off:
        fields[_F351_Q17_BOX] = _off
    _sn = _f351_yn('f351_plan_special_needs')
    _cas = _f351_yn('f351_care_history_cas_involved')
    checkboxes = {
        # Q12h special needs Yes/No (the per-child table: _f351_fill_needs)
        'The child(ren) does not/do not have any special medical, educational, mental health or developmental needs': _sn == 'no',
        'The child or one or more of the children has/have the following special needs and will receive support and services for those needs': _sn == 'yes',
        # Q14 children's aid involvement (page 6 Yes / No)
        'Yes': _cas == 'yes',
        'No': _cas == 'no',
        # FIX-F351-Q12C-WHO: Q12c who makes decisions (one tick)
        'jointly by me and names of persons': _who == 'jointly',
        'by me': _who == 'me',
        'by (name(s) of person(s))': _who == 'other',
        # FIX-F351-Q12D-WORK
        'I am a stay-at-home parent': 'home' in _ws,
        'I work': 'work' in _ws,
        'full time': 'work' in _ws and _wt == 'full',
        'part time': 'work' in _ws and _wt == 'part',
        'I attend school': 'school' in _ws,
        'attend school full time': 'school' in _ws and _st == 'full',
        'attend school part time': 'school' in _ws and _st == 'part',
        'I anticipate that my plans for work and/or school may change as follows': _pc == 'yes',
        # FIX-F351-PARTB: Q17 (one tick)
        'I have attached to this affidavit a copy of my police records check': _pc17 == 'attached',
        'On (date), I sent a request to': _pc17 == 'requested',
    }
    # FIX-F351-ONE-BOX: size each filled answer box so its wrapped text
    # fits (10pt down to 7pt, real Helvetica widths, same as Forms 15/23C).
    # An answer too long to fit even at 7pt is left blank and logged, never
    # cut off part-way.
    _f351_big = (
        'Describe incident(s) or episode(s) and provide information about the nature of the violence or abuse, who committed the violence and who the victim(s) was/were',
        'Details of civil protection order',
        'Details of criminal offence or any criminal orders that relate to you or to a member of your family',
        'child(ren) will attend school, daycare or be cared for by others on a regular basis - details',
        'plan for the other parent’s time with the child - details',
        'plan for the child(ren) to have contact with others, including other family members - details',
        'Relatives, friends or community services supporting care of the child(ren)',
        'Decisions for the child(ren) - further details',
        'Changes to plans for work and/or school',
    )
    _f351_line = (_F351_Q17_BOX, 'Name of local police force',
                  'Date of report from local police force', 'Date of request to local police force',
                  'Names you have been known by', 'address', 'Name of your place of work or school',
                  'Names of person(s) making decisions for the child(ren) jointly with me',
                  'Names of person(s) making decisions for the child(ren)')
    _f351_font = {}
    _f351_too_long = []
    _want = [k for k in _f351_big + _f351_line if str(fields.get(k) or '').strip()]
    if _want:
        _sz = _box_sizes(_tpl, set(_want))
        for _k in _want:
            if _k not in _sz:
                sys.stderr.write(f'[fill_form35_1] box not found: {_k[:60]}\n')
                continue
            _w, _h = _sz[_k]
            if _k in _f351_line:
                _pt = 10.0
                while _pt > 7.0 and _wrapped_line_count(fields[_k], (_w - 6.0) * 0.95, _pt) > 1:
                    _pt -= 0.5
                _ok = _wrapped_line_count(fields[_k], (_w - 6.0) * 0.95, _pt) == 1
            else:
                _pt, _ok = _wrap_fit_pt(fields[_k], _w, _h)
            if _ok:
                _f351_font[_k] = _pt
            else:
                # FIX-F351-CONTINUATION: printed in full on an attached
                # continuation page; the box points the reader to it.
                sys.stderr.write(f'[fill_form35_1] too long for its box, continued on attached page: {_k[:60]}\n')
                _f351_too_long.append((_k, fields[_k]))
                fields[_k] = 'See attached continuation page, paragraph %s.' % _F351_PARA[_k][0]
                _f351_font[_k] = 9.0
    # FIX-F351-Q2-CHILDREN: size each Q2 table cell (one line, 10pt down
    # to 7pt; the "lives with" cell is two lines tall). If any cell of a
    # child's row does not fit, that cell says "See continuation page" and
    # the child's full row is printed on the continuation page. Children
    # after the 5th row go on the continuation page too.
    _q2_more = []
    # FIX-F351-MORE-ROWS: more than 5 children: row 5 becomes the note and
    # children 5+ go on the continuation page.
    _q2_cap = 5
    if len(_f351_kids) > 5:
        _q2_cap = 4
        for _c, _box in _q2_cols:
            fields.pop(_box % 5, None)
        fields[_q2_cols[0][1] % 5] = 'x'
    _q2_boxes = [_box % _i for _i in range(1, min(5, len(_f351_kids)) + 1) for _c, _box in _q2_cols
                 if str(fields.get(_box % _i) or '').strip()]
    _q2_sz = _box_sizes(_tpl, set(_q2_boxes)) if _q2_boxes else {}
    for _i, _kid in enumerate(_f351_kids, start=1):
        _overflow = _i > _q2_cap
        if not _overflow:
            for _col, _box in _q2_cols:
                _k = _box % _i
                if not str(fields.get(_k) or '').strip() or _k not in _q2_sz:
                    continue
                _w, _h = _q2_sz[_k]
                if _col in ('name', 'parents', 'lives_with', 'relationship'):
                    _pt, _ok = _wrap_fit_pt(fields[_k], _w, _h)
                else:
                    _pt = 10.0
                    while _pt > 7.0 and _wrapped_line_count(fields[_k], (_w - 4.0) * 0.95, _pt) > 1:
                        _pt -= 0.5
                    _ok = _wrapped_line_count(fields[_k], (_w - 4.0) * 0.95, _pt) == 1
                if _ok:
                    _f351_font[_k] = _pt
                else:
                    sys.stderr.write(f'[fill_form35_1] Q2 child {_i} {_col} too long, continued on attached page\n')
                    fields[_k] = 'See continuation page'
                    _f351_font[_k] = 7.0
                    _overflow = True
        if _overflow:
            _q2_more.append((
                'Paragraph 2. The child(ren) in this case: child %d' % _i,
                '\n'.join('%s: %s' % (_lbl, _kid[_c]) for _lbl, _c in (
                    ("Child's full legal name", 'name'), ('Birthdate (d, m, y)', 'dob'),
                    ('Age', 'age'), ('Full legal name(s) of parent(s)', 'parents'),
                    ('Name(s) of all people child lives with now', 'lives_with'),
                    ('My relationship to the child', 'relationship')) if _kid.get(_c))))
    if len(_f351_kids) > 5:
        sys.stderr.write(f'[fill_form35_1] Q2: children 5-{len(_f351_kids)} continued on attached page\n')
        _f351_more_note(fields, _f351_font, _q2_cols[0][1] % 5, 5, len(_f351_kids), _q2_sz)
    # FIX-F351-Q4Q5-ROWS: paragraph 4 and 5 tables.
    _tbl_more = []
    _f351_fill_tables(d, _tpl, fields, _f351_font, _tbl_more)
    _f351_fill_needs(d, _tpl, fields, checkboxes, _f351_font, _tbl_more)
    # FIX-F351-Q12D-WORK: the older free-text work/school answer has no box
    # on the form. Until the new question is answered it is printed in full
    # on the continuation page (nothing is ticked from it).
    _old_ws = _f351('f351_plan_work_situation')
    if not _ws and _old_ws and _f351_na(_old_ws) != 'N/A':
        _tbl_more.append(('12(d)', 'Paragraph 12(d). My work or school situation', _old_ws))
    n = _write_pdf(_tpl, output_path, fields, checkboxes, font_pt=_f351_font)
    # FIX-F351-ONE-BOX: the page 6 Q14 "Yes" / "No" boxes, unlike every
    # other tick box on this form, carry their own border/background and no
    # text style. Viewers that redraw filled forms then show a broken
    # outline and a solid square instead of a tick. Give them the same
    # style as the other boxes (tick mark, the printed square is the border).
    try:
        from pypdf.generic import NameObject as _N, DictionaryObject as _D, create_string_object as _S
        _r = pypdf.PdfReader(output_path)
        _wr = pypdf.PdfWriter()
        _wr.append(_r)
        for _pg in _wr.pages:
            for _an in _pg.get('/Annots') or []:
                _o = _an.get_object()
                if _o.get('/FT') == '/Btn' and str(_o.get('/T', '')) in ('Yes', 'No'):
                    _o[_N('/DA')] = _S('/ZaDb 0 Tf 0 g')
                    _o[_N('/MK')] = _D({_N('/CA'): _S('4')})
        _set_need_appearances(_wr)
        with open(output_path, 'wb') as _fh:
            _wr.write(_fh)
    except Exception as _e:
        sys.stderr.write(f'[fill_form35_1] Q14 box style skipped: {_e}\n')
    # FIX-F351-Q4Q5-ROWS: continuation items in paragraph order (Python's
    # sort keeps the order within a paragraph).
    _cont = sorted(
        [(_F351_PARA[_k][0], 'Paragraph %s. %s' % _F351_PARA[_k], _v) for _k, _v in
         sorted(_f351_too_long, key=lambda kv: _F351_ORDER.index(kv[0]))]
        + [('2', _t, _v) for _t, _v in _q2_more]
        + _tbl_more,
        key=lambda it: _f351_para_pos(it[0]))
    if _cont:
        try:
            _cfn = (d.get('court_file_number') or d.get('fileNumber') or '').strip()
            _np = _append_continuation(
                output_path,
                ['Form 35.1: Affidavit (decision-making responsibility, parenting time, contact)',
                 'Continuation of answers that did not fit on the form'],
                [('Court file number:', _cfn),
                 ('Applicant(s):', (d.get('applicant_full_name') or '').strip()),
                 ('Respondent(s):', (d.get('respondent_full_name') or '').strip()),
                 ('Affidavit of:', fields.get('Full legal name', ''))],
                [(_t, _v) for _p, _t, _v in _cont])
            sys.stderr.write(f'[fill_form35_1] appended {_np} continuation page(s)\n')
        except Exception as _e:
            sys.stderr.write(f'[fill_form35_1] continuation page failed: {_e}\n')
    if _tpl != input_path:
        try:
            os.unlink(_tpl)
        except OSError:
            pass
    sys.stderr.write(f'[fill_form35_1] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 36 — Affidavit for Divorce
# ─────────────────────────────────────────────────────────────────────────────
def fill_form36(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=4)
    fields['Full legal name'] = d.get('applicant_full_name', '')
    # FIX-F36-LIVE-IN: wizard saves applicant_city / applicant_province, not
    # city / province, so this line printed ", Ontario". ON is written out as
    # Ontario (the line asks for the province). No leading comma if city is blank.
    _city = (d.get('applicant_city') or d.get('applicantCity') or d.get('city') or '').strip()
    _prov = (d.get('applicant_province') or d.get('applicantProvince') or d.get('province') or 'Ontario').strip()
    if _prov.upper() in ('ON', 'ONT', 'ONT.'):
        _prov = 'Ontario'
    fields['Municipality & Province'] = ', '.join(x for x in (_city, _prov) if x)
    fields['Title of certificate'] = d.get('marriage_cert_title', 'Certificate of Marriage')
    fields['Place of issue'] = d.get('marriage_cert_place', '')
    fields['Date of issue'] = d.get('marriage_cert_date', '')
    fields['Name and title of person who issued certificate'] = d.get('marriage_cert_issuer', '')
    fields['Date of marriage'] = d.get('date_of_marriage', '')
    fields['Place of marriage'] = d.get('place_of_marriage', '')
    fields['Name and title of person who performed the marriage'] = d.get('marriage_officiant', '')
    fields['Date - Separation'] = d.get('date_of_separation', '')
    fields['Other - Specify'] = d.get('other_divorce_ground', '')
    fields['Commissioner for taking affidavits'] = d.get('commissioner_name', '')
    fields['State any corrections or changes to the information in the application.  Write "NONE" if there are no corrections or changes'] = d.get('corrections', 'NONE')
    checkboxes = {
        'that the respondent and I have been separated for at least one year': d.get('separation_one_year', '') in ('yes','true','1'),
        'has been filed with the application': d.get('cert_filed_with_app', '') in ('yes','true','1'),
        'is attached to this affidavit': d.get('cert_attached', '') in ('yes','true','1'),
    }
    # FIX-F36-FIT-LINE: these underline boxes are 16pt tall. A 12pt value
    # (the name box's own setting, and what a phone viewer uses for auto
    # size) is clipped against the line. 9pt fits inside the box.
    n = _write_pdf(input_path, output_path, fields, checkboxes, short_line_pt=9)
    sys.stderr.write(f'[fill_form36] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 36B — Certificate of Divorce
# ─────────────────────────────────────────────────────────────────────────────
def fill_form36b(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', d.get('court_name', ''))
    ca   = COURTHOUSE_ADDRESSES_FE.get(courthouse, '')
    fnum = d.get('court_file_number', '')
    ap   = d.get('applicant_full_name', '')
    ap_a = d.get('applicant_address', '')
    ap_law = d.get('applicant_lawyer_name', d.get('applicant_lawyer', ''))
    re_n = d.get('respondent_full_name', '')
    re_a = d.get('respondent_address', '')
    re_law = d.get('respondent_lawyer_name', d.get('respondent_lawyer', ''))
    spouses = f'{ap} and {re_n}' if ap and re_n else (ap or re_n)
    fields = {
        'form1[0].page1[0].header[0].middle[0].courtOfficeAddress[0]': ca,
        'form1[0].page1[0].header[0].rigth[0].courtFileNumber[0]': fnum,
        # Recipient (applicant) side
        'form1[0].page1[0].body[0].recipient[0].persons[0].person1[0]': ap,
        'form1[0].page1[0].body[0].recipient[0].persons[0].person2[0]': ap_a,
        'form1[0].page1[0].body[0].recipient[0].lawyers[0].laywer1[0]': ap_law,
        'form1[0].page1[0].body[0].recipient[0].lawyers[0].laywer2[0]': d.get('applicant_lawyer_address', ''),
        # Payor (respondent) side
        'form1[0].page1[0].body[0].payor[0].persons[0].person1[0]': re_n,
        'form1[0].page1[0].body[0].payor[0].persons[0].person2[0]': re_a,
        'form1[0].page1[0].body[0].payor[0].lawyers[0].laywer1[0]': re_law,
        'form1[0].page1[0].body[0].payor[0].lawyers[0].laywer2[0]': d.get('respondent_lawyer_address', ''),
        # Body fields
        'form1[0].page1[0].body[0].#subform[2].spouses[0]': spouses,
        'form1[0].page1[0].body[0].#subform[3].place[0]': d.get('marriage_place', ''),
        'form1[0].page1[0].body[0].#subform[4].place[1]': d.get('divorce_granted_location', ''),
        'form1[0].page1[0].body[0].#subform[5].date[0]': d.get('divorce_order_date', d.get('divorce_order_date_confirm', '')),
        'form1[0].page1[0].body[0].#subform[6].date[1]': d.get('divorce_effective_date', ''),
        'form1[0].page1[0].body[0].#subform[7].dateSignature[0]': d.get('date_signed', ''),
    }
    n = _write_pdf_lc(input_path, output_path, fields)
    sys.stderr.write(f'[fill_form36b] Filled {n} fields\n')
    return n



# ─────────────────────────────────────────────────────────────────────────────
# Form 30A — Request for Default Hearing
# ─────────────────────────────────────────────────────────────────────────────
def fill_form30a(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    courthouse = d.get('courthouse', d.get('court_name', ''))
    ca   = COURTHOUSE_ADDRESSES_FE.get(courthouse, d.get('court_office_address', ''))
    fnum = d.get('court_file_number', '')
    recipient = d.get('recipient_full_name', d.get('applicant_full_name', ''))
    recipient_a = d.get('recipient_address', d.get('applicant_address', ''))
    rec_law  = d.get('recipient_lawyer_name', d.get('applicant_lawyer_name', ''))
    rec_law_a = d.get('recipient_lawyer_address', d.get('applicant_lawyer_address', ''))
    payor    = d.get('payor_full_name', d.get('respondent_full_name', ''))
    payor_a  = d.get('payor_address', d.get('respondent_address', ''))
    pay_law  = d.get('payor_lawyer_name', d.get('respondent_lawyer_name', ''))
    pay_law_a = d.get('payor_lawyer_address', d.get('respondent_lawyer_address', ''))
    payor_dob   = d.get('payor_dob', '')
    arrears     = d.get('arrears_amount', '')
    filer_role  = d.get('filer_role', 'recipient_self')
    filer_name  = d.get('filer_name', recipient)
    sig_date    = d.get('signature_date', '')

    # Checkbox values — /Btn fields use /Yes or /Off
    check0 = pypdf.generic.NameObject('/Yes') if filer_role == 'recipient_self'   else pypdf.generic.NameObject('/Off')
    check1 = pypdf.generic.NameObject('/Yes') if filer_role == 'recipient_lawyer' else pypdf.generic.NameObject('/Off')
    check2 = pypdf.generic.NameObject('/Yes') if filer_role == 'other'            else pypdf.generic.NameObject('/Off')

    fields = {
        'form1[0].page1[0].body[0].courtDetails[0].courtFileNumber[0]':            fnum,
        'form1[0].page1[0].body[0].courtDetails[0].court[0].nameOfCourt[0]':       courthouse,
        'form1[0].page1[0].body[0].courtDetails[0].court[0].courtOfficeAddress[0]': ca,
        # Recipient
        'form1[0].page1[0].body[0].applicants[0].Recipient[0].textfield[0]':       recipient,
        'form1[0].page1[0].body[0].applicants[0].Recipient[0].textfield[1]':       recipient_a,
        'form1[0].page1[0].body[0].applicants[0].Lawyer[0].textfield[0]':          rec_law,
        'form1[0].page1[0].body[0].applicants[0].Lawyer[0].textfield[1]':          rec_law_a,
        # Payor
        'form1[0].page1[0].body[0].Payor[0].Payor[0].textfield[0]':               payor,
        'form1[0].page1[0].body[0].Payor[0].Payor[0].textfield[1]':               payor_a,
        'form1[0].page1[0].body[0].Payor[0].PayorLawyer[0].textfield[0]':         pay_law,
        'form1[0].page1[0].body[0].Payor[0].PayorLawyer[0].textfield[1]':         pay_law_a,
        # Arrears body
        'form1[0].page1[0].body[0].allParties[0].conditions[0].#subform[0].BornDate[0]': payor_dob,
        'form1[0].page1[0].body[0].allParties[0].conditions[0].Amount[0]':        str(arrears),
        # Signature
        'form1[0].page1[0].body[0].signature[0].sig[0]':                          filer_name,
        'form1[0].page1[0].body[0].signature[0].Date[0]':                         sig_date,
    }

    # Write text + choice fields via _write_pdf_lc, then handle checkboxes manually
    n = _write_pdf_lc(input_path, output_path, fields)

    # Patch checkboxes in the already-written output
    reader = pypdf.PdfReader(output_path)
    writer = pypdf.PdfWriter()
    writer.append(reader)
    btn_map = {
        'form1[0].page1[0].body[0].allParties[0].conditions[0].check[0]': check0,
        'form1[0].page1[0].body[0].allParties[0].conditions[0].check[1]': check1,
        'form1[0].page1[0].body[0].allParties[0].conditions[0].check[2]': check2,
    }

    def get_path(obj):
        parts = []
        cur = obj
        while cur:
            t = cur.get('/T')
            if t:
                parts.append(str(t))
            pr = cur.get('/Parent')
            if pr is None:
                break
            try:
                cur = pr.get_object()
            except Exception:
                break
        parts.reverse()
        return '.'.join(parts)

    for page in writer.pages:
        if '/Annots' not in page:
            continue
        for annot in page['/Annots']:
            obj = annot.get_object()
            if obj.get('/Subtype') == '/Widget' and obj.get('/FT') == '/Btn':
                fp = get_path(obj)
                if fp in btn_map:
                    obj.update({pypdf.generic.NameObject('/V'): btn_map[fp],
                                pypdf.generic.NameObject('/AS'): btn_map[fp]})
                    n += 1

    with open(output_path, 'wb') as fh:
        writer.write(fh)

    sys.stderr.write(f'[fill_form30a] Filled {n} fields\n')
    return n


if __name__ == '__main__':
    # Self-check mode: prints a small JSON payload proving pypdf loads from the
    # vendored wheel. Used by /api/pdf-runtime-check to verify runtime health
    # without needing an authenticated PDF request.
    if len(sys.argv) >= 2 and sys.argv[1] == '--self-check':
        try:
            # FIX-FILLER-VERSION: prove which filler file production runs.
            # fillerSha256 is computed from this file's own bytes, so it
            # changes automatically on every edit and can be compared with
            # `sha256sum dist/fill_pdf.py` in the repo.
            import hashlib as _hl
            with open(os.path.abspath(__file__), 'rb') as _fh:
                _self_sha = _hl.sha256(_fh.read()).hexdigest()
            payload = {
                'ok': True,
                'fillerVersion': FILLER_VERSION,
                'fillerSha256': _self_sha[:16],
                'pypdfVersion': getattr(pypdf, '__version__', None),
                'pypdfPath': pypdf.__file__,
                'python': sys.version.split()[0],
                'vendorDir': [p for p in sys.path if p.endswith('.whl')],
            }
            print(json.dumps(payload))
            sys.exit(0)
        except Exception as _e:
            print(json.dumps({'ok': False, 'error': str(_e)}))
            sys.exit(1)

    if len(sys.argv) < 4:
        sys.stderr.write(f'Usage: {sys.argv[0]} <input_pdf> <output_pdf> <json_data_file> [form_type]\n')
        sys.stderr.write(f'   or: {sys.argv[0]} --self-check\n')
        sys.exit(1)

    input_pdf = sys.argv[1]
    output_pdf = sys.argv[2]
    json_file = sys.argv[3]
    form_type = sys.argv[4] if len(sys.argv) >= 5 else ''

    with open(json_file, 'r') as f:
        form_data = json.load(f)

    FORM_DISPATCH = {
        'form4':    fill_form4,
        'form6b':   fill_form6b,
        'form8':    fill_form8,
        'form10':   fill_form10,
        'form13':   fill_form13,
        'form13_1': fill_form13_1,
        'form13-1': fill_form13_1,
        'form13b':  fill_form13b,
        'form14':   fill_form14,
        'form14a':  fill_form14a,
        'form14b':  fill_form14b,
        'form14c':  fill_form14c,
        'form15':   fill_form15,
        'form15b':  fill_form15b,
        'form15c':  fill_form15c,
        'form17':   fill_form17,
        'form17e':  fill_form17e,
        'form17f':  fill_form17f,
        'form23c':  fill_form23c,
        'form25':   fill_form25,
        'form25a':  fill_form25a,
        'form25f':  fill_form25f,
        'form25g':  fill_form25g,
        'form35_1': fill_form35_1,
        'form35-1': fill_form35_1,
        'form36':   fill_form36,
        'form36b':  fill_form36b,
        'form30a':  fill_form30a,
        'form10a':  fill_form10a,
        # form34a and form37 have handlers in this file but no PDF template
        # shipped in dist/public/pdfs/. The server's COMING_SOON_FORMS guard
        # intercepts these requests with a 501 before they reach the dispatch,
        # but they are also omitted here as defense in depth (D3, Aug 12 2026).
        # 'form34a':  fill_form34a,
        # 'form37':   fill_form37,
    }
    fn = FORM_DISPATCH.get(form_type.lower().replace('-', '_'))
    if fn:
        n = fn(input_pdf, output_pdf, form_data)
    else:
        n = fill_pdf(input_pdf, output_pdf, form_data)
    print(f'OK ({n} fields filled)')


