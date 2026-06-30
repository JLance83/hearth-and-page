#!/usr/bin/env python3
"""
fill_pdf.py - Fill Ontario court PDF AcroForm fields with user data.
Called by the Node.js server as a child process.
Usage: python3 fill_pdf.py <input_pdf> <output_pdf> <json_data_file>
"""
import sys
import json
import os
from datetime import date

try:
    import pypdf
    from pypdf import PdfWriter, PdfReader
    import pypdf.generic as g
except ImportError:
    sys.stderr.write("pypdf not available\n")
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

def build_address(section):
    parts = []
    if section.get('address'): parts.append(section['address'])
    if section.get('unit'): parts.append(f"Unit {section['unit']}")
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
                val = '/Yes' if checkboxes[fname] else '/Off'
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


if __name__ == '__main__':
    if len(sys.argv) < 4:
        sys.stderr.write(f'Usage: {sys.argv[0]} <input_pdf> <output_pdf> <json_data_file> [form_type]\n')
        sys.exit(1)

    input_pdf = sys.argv[1]
    output_pdf = sys.argv[2]
    json_file = sys.argv[3]
    form_type = sys.argv[4] if len(sys.argv) >= 5 else ''

    with open(json_file, 'r') as f:
        form_data = json.load(f)

    if form_type == 'form8':
        n = fill_form8(input_pdf, output_pdf, form_data)
    else:
        n = fill_pdf(input_pdf, output_pdf, form_data)
    print(f'OK ({n} fields filled)')


# ─────────────────────────────────────────────────────────────────────────────
# FormEngine-aware fill for Form 8 (Application General)
# FormEngine saves data as flat {fieldKey: value} rows (section='form' or stepId)
# This function reads those flat keys and maps them to AcroForm field names.
# ─────────────────────────────────────────────────────────────────────────────

COURTHOUSE_NAMES_FE = {
    'Ontario Court of Justice': 'Ontario Court of Justice',
    'Superior Court of Justice': 'Superior Court of Justice',
    'Superior Court of Justice (Family Court Branch)': 'Superior Court of Justice (Family Court Branch)',
    # legacy keys from old onboarding
    'toronto-university':  'Superior Court of Justice - Toronto (393 University Ave.)',
    'toronto-old':         'Ontario Court of Justice - Toronto (Old City Hall)',
    'ottawa':              'Superior Court of Justice - Ottawa',
    'hamilton':            'Superior Court of Justice - Hamilton',
    'london':              'Superior Court of Justice - London',
    'kitchener':           'Superior Court of Justice - Kitchener (Waterloo Region)',
    'windsor':             'Superior Court of Justice - Windsor',
    'barrie':              'Superior Court of Justice - Barrie',
    'oshawa':              'Superior Court of Justice - Oshawa (Durham Region)',
    'brampton':            'Superior Court of Justice - Brampton',
    'newmarket':           'Superior Court of Justice - Newmarket (York Region)',
    'kingston':            'Superior Court of Justice - Kingston',
    'thunder-bay':         'Superior Court of Justice - Thunder Bay',
    'sudbury':             'Superior Court of Justice - Sudbury',
    'north-york':          'Ontario Court of Justice - North York',
    'scarborough':         'Ontario Court of Justice - Scarborough',
    'etobicoke':           'Ontario Court of Justice - Etobicoke',
}

COURTHOUSE_ADDRESSES_FE = {
    'Superior Court of Justice': '393 University Ave, Toronto, ON M5G 1E6',
    'Ontario Court of Justice': '60 Queen St W, Toronto, ON M5H 2M3',
    'Superior Court of Justice (Family Court Branch)': '393 University Ave, Toronto, ON M5G 1E6',
    'toronto-university': '393 University Ave, Toronto, ON M5G 1E6',
    'toronto-old':        '60 Queen St W, Toronto, ON M5H 2M3',
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


def _fe_flat(form_data_list):
    """Build a flat {fieldKey: value} dict from FormEngine form_data rows."""
    flat = {}
    for row in form_data_list:
        key = row.get('fieldKey', '')
        val = row.get('fieldValue', '')
        if key:
            flat[key] = val
    return flat


def _is_yes(val):
    return str(val).strip().lower() in ('yes', 'true', '1', 'on')


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
    ap_name = d.get('applicantFullName', d.get('applicant_full_name', ''))
    ap_dob  = d.get('applicantDob', d.get('applicant_dob', ''))
    ap_addr_parts = [
        d.get('applicantAddress', d.get('applicant_address', '')),
        d.get('applicantUnit', d.get('applicant_unit', '')),
        d.get('applicantCity', d.get('applicant_city', '')),
        d.get('applicantProvince', 'ON'),
        d.get('applicantPostalCode', d.get('applicant_postal_code', '')),
    ]
    ap_addr = ', '.join(p for p in ap_addr_parts if p)
    ap_phone = format_phone(d.get('applicantPhone', d.get('applicant_phone', '')))
    ap_email = d.get('applicantEmail', d.get('applicant_email', ''))

    fields['Applicant(s) - Full legal name'] = ap_name
    fields['Applicant(s) - Address'] = ap_addr
    fields['Applicant(s) - Phone & fax'] = ap_phone
    fields['Applicant(s) - Email'] = ap_email
    fields['Age - applicant'] = calc_age(ap_dob)
    fields['Birthdate: (d, m, y) - Applicant'] = format_dob(ap_dob)

    city_prov_ap = ', '.join(p for p in [
        d.get('applicantCity', ''), 'ON'] if p)
    fields['Municipality & province - applicant'] = city_prov_ap
    fields['Date - start of residency - applicant'] = d.get('applicantResidencyDate', '')

    ap_name_parts = ap_name.split()
    fields['First name on the day before the marriage date - applicant'] = (
        d.get('applicantPremarriageFirst', ap_name_parts[0] if ap_name_parts else ''))
    fields['Last name on the day before the marriage date - applicant'] = (
        d.get('applicantPremarriageLast', ' '.join(ap_name_parts[1:]) if len(ap_name_parts) > 1 else ''))
    fields['Place and date of previous divorce - applicant'] = d.get('applicantPreviousDivorce', '')

    ap_gender = d.get('applicantGender', '').lower()
    if ap_gender in ('male', 'm'):      checkboxes['Male - applicant'] = True
    elif ap_gender in ('female', 'f'):  checkboxes['Female - applicant'] = True
    elif ap_gender:                     checkboxes['Another gender - applicant'] = True

    ap_prev = d.get('applicantPreviousMarriage', d.get('applicant_previous_marriage', ''))
    if _is_yes(ap_prev):   checkboxes['Yes - applicant'] = True
    elif ap_prev == 'no':  checkboxes['No - applicant'] = True

    # ── Respondent ────────────────────────────────────────────────────────
    re_name = d.get('respondentFullName', d.get('respondent_full_name', ''))
    re_dob  = d.get('respondentDob', d.get('respondent_dob', ''))
    re_addr = d.get('respondentAddress', d.get('respondent_address', ''))
    re_phone = format_phone(d.get('respondentPhone', d.get('respondent_phone', '')))
    re_email = d.get('respondentEmail', d.get('respondent_email', ''))

    fields['Respondent(s) - Full legal name'] = re_name
    fields['Respondent(s) - Address'] = re_addr
    fields['Respondent(s) - Phone & fax'] = re_phone
    fields['Respondent(s) - Email'] = re_email
    fields['Age - respondent'] = calc_age(re_dob)
    fields['Birthdate: (d, m, y) - respondent'] = format_dob(re_dob)
    fields['Municipality & province - respondent'] = d.get('respondentCity', '')
    fields['Date - start of residency - respondent'] = d.get('respondentResidencyDate', '')

    re_name_parts = re_name.split()
    fields['First name on the day before the marriage date - respondent'] = (
        d.get('respondentPremarriageFirst', re_name_parts[0] if re_name_parts else ''))
    fields['Last name on the day before the marriage date - respondent'] = (
        d.get('respondentPremarriageLast', ' '.join(re_name_parts[1:]) if len(re_name_parts) > 1 else ''))
    fields['Place and date of previous divorce - respondent'] = d.get('respondentPreviousDivorce', '')

    re_gender = d.get('respondentGender', '').lower()
    if re_gender in ('male', 'm'):      checkboxes['Male - respondent'] = True
    elif re_gender in ('female', 'f'):  checkboxes['Female - respondent'] = True
    elif re_gender:                     checkboxes['Another gender - respondent'] = True

    re_prev = d.get('respondentPreviousMarriage', d.get('respondent_previous_marriage', ''))
    if _is_yes(re_prev):   checkboxes['Yes - respondent'] = True
    elif re_prev == 'no':  checkboxes['No - respondent'] = True

    re_lawyer_name = d.get('respondentLawyerName', d.get('respondent_lawyer_name', ''))
    re_lawyer_firm = d.get('respondentLawyerFirm', '')
    re_lawyer_phone = format_phone(d.get('respondentLawyerPhone', ''))
    fields['Respondent(s) Lawyer - Full legal name'] = re_lawyer_name
    fields['Respondent(s) Lawyer - Address'] = re_lawyer_firm
    fields['Respondent(s) Lawyer - Phone & fax'] = re_lawyer_phone

    # ── Relationship / marriage dates ─────────────────────────────────────
    marriage_date = d.get('marriageDate', d.get('marriage_date', ''))
    sep_date      = d.get('separationDate', d.get('separation_date', ''))
    rel_type      = d.get('relationshipType', d.get('relationship_type', ''))

    if marriage_date:
        fields['Date - Married on'] = marriage_date
        checkboxes['Married on'] = True

    if sep_date:
        fields['Date - Separated on'] = sep_date
        fields['Date - seperation'] = sep_date
        checkboxes['Separated on'] = True

    # Default: separation is the grounds unless another is set
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
    if _is_yes(d.get('claimCustody', d.get('claim_custody', ''))):
        checkboxes['decision-making responsibility for child(ren) 1'] = True
    if _is_yes(d.get('claimAccess', d.get('claim_access', ''))):
        checkboxes['parenting time with child(ren) 1'] = True
    if _is_yes(d.get('claimChildSupport', d.get('claim_child_support', ''))):
        checkboxes['support for child(ren) \u2013 table amount 1'] = True
    if _is_yes(d.get('claimSpousalSupport', d.get('claim_spousal_support', ''))):
        checkboxes['support for me 1'] = True
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

    # Order details / situation summary
    details = d.get('situationSummary', d.get('claimOtherDetails', d.get('situation_summary', '')))
    if details:
        fields['Details of the order that you want the court to make'] = details
    fields['Facts that form the legal basis for your other claim(s)'] = d.get('factsLegalBasis', '')

    # ── Children ─────────────────────────────────────────────────────────
    child_count_raw = d.get('childrenCount', d.get('children_count', '0'))
    try:
        child_count = int(str(child_count_raw))
    except:
        child_count = 0

    for i in range(1, min(child_count + 1, 7)):
        cn = d.get(f'child{i}Name', d.get(f'child_{i}_name', ''))
        cd = d.get(f'child{i}Dob', d.get(f'child_{i}_dob', ''))
        cr = d.get(f'child{i}Residence', d.get(f'child_{i}_residence', ''))

        residence_label = {
            'applicant': ap_name or 'Applicant',
            'respondent': re_name or 'Respondent',
            'both': f'{ap_name or "Applicant"} and {re_name or "Respondent"}',
            'other': 'Other',
        }.get(str(cr).lower(), cr)

        fields[f'Full legal name {i}'] = cn
        fields[f'Age {i}'] = calc_age(cd)
        fields[f'Birthdate: (d, m, y) {i}'] = format_dob(cd)
        fields[f'Resident in (municipality & province) {i}'] = d.get('applicantCity', '')
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

            field_name = annot_obj.get('/T')
            if not field_name and '/Parent' in annot_obj:
                try:
                    field_name = annot_obj['/Parent'].get_object().get('/T')
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
                val = '/Yes' if checkboxes[fname] else '/Off'
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
