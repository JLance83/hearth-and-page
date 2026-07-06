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


# ─────────────────────────────────────────────────────────────────────────────
# FormEngine-aware fill for Form 13 (Financial Statement — Support Claims)
# ─────────────────────────────────────────────────────────────────────────────

def fill_form13(input_path, output_path, form_data_list):
    """Fill Form 13 — Financial Statement (Support Claims).

    FormEngine stores answers as a list of {fieldKey, fieldValue, ...} rows.
    Keys match form13-schema.json fieldIds exactly.
    """
    import pypdf

    d = _fe_flat(form_data_list)

    def _money(key, *fallbacks):
        for k in (key,) + fallbacks:
            v = d.get(k, '')
            if v not in ('', None): return str(v)
        return '0.00'

    fields = {}
    checkboxes = {}

    # ── Court header (pulled from universal profile / case data) ──────────
    file_number = d.get('court_file_number', d.get('fileNumber', ''))
    courthouse  = d.get('courthouse', d.get('court_name', ''))
    courthouse_name = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    courthouse_addr = COURTHOUSE_ADDRESSES_FE.get(courthouse,
                      COURTHOUSE_ADDRESSES_FE.get(courthouse_name, ''))

    for pg in range(1, 7):
        fields[f'Court File Number, page {pg}'] = file_number
    fields['Name of Court']        = courthouse_name
    fields['Court Office Address'] = courthouse_addr

    # ── Parties ──────────────────────────────────────────────────────────
    ap_name  = d.get('applicant_full_name', d.get('applicantFullName', ''))
    ap_addr  = d.get('applicant_address',   d.get('applicantAddress', ''))
    ap_phone = format_phone(d.get('applicant_phone', d.get('applicantPhone', '')))
    ap_email = d.get('applicant_email',     d.get('applicantEmail', ''))
    re_name  = d.get('respondent_full_name',d.get('respondentFullName', ''))
    re_addr  = d.get('respondent_address',  d.get('respondentAddress', ''))
    re_phone = format_phone(d.get('respondent_phone', d.get('respondentPhone', '')))
    re_email = d.get('respondent_email',    d.get('respondentEmail', ''))

    fields['Full legal name - Applicant(s)']  = ap_name
    fields['Address - Applicant(s)']          = ap_addr
    fields['Phone & fax - Applicant(s)']      = ap_phone
    fields['Email - Applicant(s)']            = ap_email
    fields['Full legal name - Respondent(s)'] = re_name
    fields['Address - Respondent(s)']         = re_addr
    fields['Phone & fax - Respondent(s)']     = re_phone
    fields['Email - Respondent(s)']           = re_email

    # Deponent
    filer_name = d.get('filer_full_name', ap_name)
    city       = d.get('city', d.get('applicantCity', ''))
    province   = d.get('province', 'Ontario')
    fields['Applicant']                    = filer_name
    fields['Full legal name']              = filer_name
    fields['Municipality & province']      = f'{city}, {province}' if city else province
    fields['Municipality']                 = city
    fields['Province, state or country']   = province
    fields['Date Sworn/Affirmed']          = d.get('date_sworn', '')
    fields['Date sworn/affirmed']          = d.get('date_sworn', '')

    # ── Employment status ─────────────────────────────────────────────────
    emp_type = d.get('employment_type', d.get('employmentType', '')).lower()
    if emp_type in ('employed', 'employee', 'employed full-time', 'employed part-time'):
        checkboxes['employed by'] = True
        fields['Name and address of employer'] = d.get('employer_name', d.get('employerName', ''))
        fields['Place of work or business']    = d.get('work_address', '')
    elif emp_type in ('self-employed', 'self_employed', 'selfemployed'):
        checkboxes['self-employed'] = True
        fields['Name and address of business'] = d.get('business_name', d.get('businessName', ''))
    elif emp_type in ('unemployed', 'not employed', 'on disability', 'disabled'):
        checkboxes['Unemployed since'] = True
        fields['Date when last employed'] = d.get('last_employed_date', '')

    fields['Last year my gross income (0.00)'] = d.get('gross_income_last_year', '0.00')

    # ── Monthly Income (schema fieldIds → exact PDF field names) ─────────
    fields['Employment income [0.00]']                                          = _money('inc_employment')
    fields['Commissions, tips and bonuses [0.00]']                              = _money('inc_commissions')
    fields['Self-employment income [0.00]']                                     = _money('inc_selfemployment')
    fields['Employment Insurance benefits [0.00]']                              = _money('inc_ei')
    fields["Workers' compensation benefits [0.00]"]                            = _money('inc_wcb')
    fields['Social assistance income [0.00]']                                   = _money('inc_socialassistance')
    fields['Interest and investment income [0.00]']                             = _money('inc_investment')
    fields['Pension income [0.00]']                                             = _money('inc_pension')
    fields['Spousal support received from a former spouse/partner [0.00]']      = _money('inc_spousalsupport')
    fields['Child Tax Benefits or Tax Rebates [0.00]']                          = _money('inc_childtaxbenefit')
    fields['Other sources of income [0.00]']                                    = _money('inc_other')
    fields['Other income (specify source)']                                     = d.get('inc_other_benefits', '')

    inc_keys = ['inc_employment','inc_commissions','inc_selfemployment','inc_ei',
                'inc_wcb','inc_socialassistance','inc_investment','inc_pension',
                'inc_spousalsupport','inc_childtaxbenefit','inc_other']
    inc_total = sum(float(d.get(k,'0') or '0') for k in inc_keys)
    fields['Total monthly income from all sources [0.00]'] = d.get('inc_total_monthly', f'{inc_total:.2f}')

    # ── Monthly Expenses ──────────────────────────────────────────────────
    fields['Rent or mortgage [0.00]']           = _money('exp_rent_mortgage')
    fields['Property taxes [0.00]']             = _money('exp_property_tax')
    fields['Property insurance [0.00]']         = _money('exp_property_insurance')
    fields['Condominium fees [0.00]']           = _money('exp_condo_fees')
    fields['Repairs and maintenance [0.00]']    = _money('exp_home_repairs')
    fields['Water [0.00]']                      = _money('exp_utilities')
    fields['Groceries [0.00]']                  = _money('exp_groceries')
    fields['Meals outside the home [0.00]']     = _money('exp_meals_out')
    fields['Clothing [0.00]']                   = _money('exp_clothing')
    fields['Entertainment/recreation [0.00]']   = _money('exp_personal')
    fields['Vacations [0.00]']                  = _money('exp_vacations')
    fields['Gas and oil [0.00]']                = _money('exp_transit')
    fields['Health insurance premiums [0.00]']  = _money('exp_health')
    fields['Life Insurance premiums [0.00]']    = _money('exp_life_insurance')
    fields['Daycare expense [0.00]']            = _money('exp_childcare')
    fields["Children’s activities [0.00]"]     = _money('exp_children_activities')
    fields['RRSP/RESP withdrawals [0.00]']      = _money('exp_rrsp')
    fields['Debt payments [0.00]']              = _money('exp_debt_payments')
    fields['CPP contributions [0.00]']          = _money('exp_auto_deductions')
    fields['Support paid for other children [0.00]'] = _money('exp_other_support')
    fields['Other expenses [0.00]']             = _money('exp_other')
    fields['Total Amount of Monthly Expenses [0.00]'] = d.get('exp_total_monthly', '0.00')

    # ── Assets ────────────────────────────────────────────────────────────
    # Real estate — slot 1 (the schema stores all RE as one currency + desc)
    re_value = _money('asset_realestate')
    re_desc  = d.get('asset_realestate_desc', '')
    fields['Address and Nature of Ownership 1'] = re_desc
    fields['Value or Amount (0.00) 1']          = re_value

    # Vehicles — slot 1
    fields['Year and Make - Cars, Boats, Vehicles 1'] = d.get('asset_vehicles_desc', '')
    fields['Value or Amount (0.00) 2']                = _money('asset_vehicles')

    # Bank accounts — slot 1
    fields['Name and Address of Institution - Bank Accounts 1'] = d.get('asset_bank_name', '')
    fields['Account Number 1']           = d.get('asset_bank_account', '')
    fields['Value or Amount (0.00) 5']   = _money('asset_bank_accounts')

    # Savings plans (RRSP/TFSA/pension) — slot 1
    fields['Type and Issuer - Savings Plans 1'] = d.get('asset_rrsp_desc', 'RRSP/TFSA/Pension')
    fields['Value or Amount (0.00) 8']          = _money('asset_rrsp_pension')

    # Investments — slot 1
    fields['Investments: Type – Issuer – Due Date – Number of Shares 1'] = d.get('asset_investments_desc', '')
    fields['Value or Amount (0.00) 9']  = _money('asset_investments')

    # Life insurance — slot 1
    fields['Life Insurance: Type – Beneficiary – Face Amount 1'] = d.get('asset_life_insurance_desc', '')
    fields['Cash Surrender Value (0.00) 1'] = _money('asset_life_insurance')

    # Business interests — slot 1
    fields['Name and Address of Business 1'] = d.get('asset_business_desc', '')
    fields['Value or Amount (0.00) 13']      = _money('asset_business')

    # Money owed — slot 1
    fields['Name and Address of Debtors 1'] = d.get('asset_money_owed_desc', '')
    fields['Value or Amount (0.00) 14']     = _money('asset_money_owed')

    # Other assets — slot 1
    fields['Other Assets 1']            = d.get('asset_other_desc', '')
    fields['Value or Amount (0.00) 15'] = _money('asset_other')

    fields['Total Assets (0.00)'] = _money('asset_total')

    # ── Debts ─────────────────────────────────────────────────────────────
    fields['Creditor (name and address) - Mortgages, Lines of Credits, Loans 1'] = d.get('debt_mortgage_desc', '')
    fields['Monthly Payments (0.00) 1']                     = _money('debt_mortgage_loans')
    fields['Creditor (name and address) - Outstanding Credit Card Balances 1'] = d.get('debt_cc_desc', '')
    fields['Monthly Payments (0.00) 4']                     = _money('debt_credit_cards')
    fields['Monthly Payments (0.00) 7']                     = _money('debt_car_loans')
    fields['Monthly Payments (0.00) 9']                     = _money('debt_student_loans')
    fields['Creditor (name and address) - Unpaid Support Amounts 1'] = ''
    fields['Monthly Payments (0.00) 10']                    = _money('debt_unpaid_support')
    fields['Monthly Payments (0.00) 11']                    = _money('debt_taxes_owing')
    fields['Creditor (name and address) - Other Debts 1']   = d.get('debt_other_desc', '')
    fields['Monthly Payments (0.00) 12']                    = _money('debt_other')
    fields['Total Amount of Debts Outstanding (0.00)']      = _money('debt_total')
    fields['Net Worth (0.00)']                              = _money('net_worth')
    fields['Subtract Total Debts (0.00)']                   = _money('debt_total')

    # ── Schedules A / B / C ───────────────────────────────────────────────
    if d.get('schedule_a'):
        fields['Details 1'] = d.get('schedule_a', '')
    if d.get('schedule_b'):
        fields['Details 2'] = d.get('schedule_b', '')
    if d.get('schedule_c'):
        fields['Details 3'] = d.get('schedule_c', '')

    # ── Write PDF ─────────────────────────────────────────────────────────
    reader = pypdf.PdfReader(input_path)
    writer = pypdf.PdfWriter()
    writer.append(reader)

    filled = 0
    for page in writer.pages:
        if '/Annots' not in page:
            continue
        for annot in page['/Annots']:
            obj = annot.get_object()
            if obj.get('/Subtype') == '/Widget':
                ft = obj.get('/FT')
                t  = str(obj.get('/T', ''))
                if ft == '/Tx' and t in fields:
                    val = str(fields[t])
                    obj.update({pypdf.generic.NameObject('/V'): pypdf.generic.create_string_object(val),
                                pypdf.generic.NameObject('/AP'): pypdf.generic.DictionaryObject()})
                    filled += 1
                elif ft == '/Btn' and t in checkboxes:
                    v = '/Yes' if checkboxes[t] else '/Off'
                    obj.update({pypdf.generic.NameObject('/V'): pypdf.generic.NameObject(v),
                                pypdf.generic.NameObject('/AS'): pypdf.generic.NameObject(v)})
                    filled += 1

    with open(output_path, 'wb') as f:
        writer.write(f)

    sys.stderr.write(f'[fill_form13] Filled {filled} fields → {output_path}\n')
    return filled

def fill_form13_1(input_path, output_path, form_data_list):
    """Fill Form 13.1 — Financial Statement (Property and Support Claims)."""
    d = _fe_flat(form_data_list)

    fields = {}
    checkboxes = {}

    # ── Court header ──────────────────────────────────────────────────────
    file_number     = d.get('court_file_number', d.get('fileNumber', ''))
    courthouse      = d.get('courthouse', d.get('court_name', ''))
    courthouse_name = COURTHOUSE_NAMES_FE.get(courthouse, courthouse)
    courthouse_addr = COURTHOUSE_ADDRESSES_FE.get(courthouse,
                      COURTHOUSE_ADDRESSES_FE.get(courthouse_name, ''))

    fields['Court File Number']    = file_number
    fields['Name of court']        = courthouse_name
    fields['Court office address'] = courthouse_addr

    # ── Deponent ──────────────────────────────────────────────────────────
    filer_name = d.get('filer_full_name', d.get('applicant_full_name', d.get('applicantFullName', '')))
    city       = d.get('city', d.get('applicantCity', ''))
    province   = d.get('province', 'Ontario')

    fields['full legal name']        = filer_name
    fields['municipality & province']= f'{city}, {province}' if city else province
    fields['municipality']           = city
    fields['date sworn/affirmed']    = d.get('date_sworn', '')
    fields['date']                   = d.get('date_sworn', '')

    # Employment status
    emp_type = d.get('employment_type', d.get('employmentType', '')).lower()
    if emp_type in ('employed', 'employee'):
        checkboxes['employed by (name and address of employer)'] = True
        fields['name and address of employer'] = d.get('employer_name', '')
    elif emp_type in ('self-employed', 'self_employed', 'selfemployed'):
        checkboxes['self-employed, carrying on business under the name of (name and address of business)'] = True
        fields['name and address of business'] = d.get('business_name', '')
    elif emp_type in ('unemployed',):
        checkboxes['unemployed since (date when last employed)'] = True
        fields['date when last employed'] = d.get('last_employed_date', '')

    fields['gross income from all sources (0.00)'] = d.get('gross_income_last_year', '0.00')

    # ── Monthly Income ────────────────────────────────────────────────────
    def _money(key, *fallbacks):
        for k in (key,) + fallbacks:
            v = d.get(k, '')
            if v: return str(v)
        return '0.00'

    fields['Employment income (before deductions) - Amount Received/Month (0.00)'] = _money('inc_employment')
    fields['Commissions, tips and bonuses - Amount Received/Month (0.00)']         = _money('inc_commissions')
    fields['Self-employment income (Monthly amount before expenses) - Amount Received/Month (0.00)'] = _money('inc_self_employment')
    fields['Employment Insurance benefits - Amount Received/Month (0.00)']         = _money('inc_ei')
    fields["Workers' compensation benefits - Amount Received/Month (0.00)"]        = _money('inc_wsib')
    fields['Social assistance income (including ODSP payments) - Amount Received/Month (0.00)'] = _money('inc_social_assistance')
    fields['Interest and investment income - Amount Received/Month (0.00)']        = _money('inc_investment')
    fields['Pension income (including CPP and OAS) - Amount Received/Month (0.00)'] = _money('inc_pension')
    fields['Spousal support received from a former spouse/partner - Amount Received/Month (0.00)'] = _money('inc_spousal_support')
    fields['Child Tax Benefits or Tax Rebates (e.g. GST) - Amount Received/Month (0.00)'] = _money('inc_ctb')
    fields['Other sources of income (e.g. RRSP withdrawals, capital gains) - Amount Received/Month (0.00)'] = _money('inc_other')

    inc_keys = ['inc_employment','inc_commissions','inc_self_employment','inc_ei',
                'inc_wsib','inc_social_assistance','inc_investment','inc_pension',
                'inc_spousal_support','inc_ctb','inc_other']
    inc_total = sum(float(d.get(k,'0') or '0') for k in inc_keys)
    fields['Total monthly income from all sources (0.00)'] = f'{inc_total:.2f}'
    fields['Monthly amount before expenses (0.00)']        = _money('inc_self_employment')

    # ── Deductions ────────────────────────────────────────────────────────
    fields['CPP contributions - Monthly Amount (0.00)']             = _money('exp_cpp')
    fields['EI premiums - Monthly Amount (0.00)']                   = _money('exp_ei')
    fields['Income taxes - Monthly Amount (0.00)']                  = _money('exp_income_tax')
    fields['Employee pension contributions - Monthly Amount (0.00)']= _money('exp_pension')
    fields['Union dues - Monthly Amount (0.00)']                    = _money('exp_union_dues')

    # ── Monthly Expenses ──────────────────────────────────────────────────
    fields['Rent or mortgage - Monthly Amount (0.00)']              = _money('exp_rent_mortgage')
    fields['Property taxes - Monthly Amount (0.00)']                = _money('exp_property_taxes')
    fields['Property insurance - Monthly Amount (0.00)']            = _money('exp_property_insurance')
    fields['Condominium fees - Monthly Amount (0.00)']              = _money('exp_condo_fees')
    fields['Water - Monthly Amount (0.00)']                         = _money('exp_water')
    fields['Heat - Monthly Amount (0.00)']                          = _money('exp_heat')
    fields['Electricity - Monthly Amount (0.00)']                   = _money('exp_electricity')
    fields['Public transit, taxis - Monthly Amount (0.00)']         = _money('exp_transit')
    fields['Gas and oil - Monthly Amount (0.00)']                   = _money('exp_gas_oil')
    fields['Car insurance and license - Monthly Amount (0.00)']     = _money('exp_car_insurance')
    fields['Parking - Monthly Amount (0.00)']                       = _money('exp_parking')
    fields['Car Loan or Lease Payments - Monthly Amount (0.00)']    = _money('exp_car_loan')
    fields['Health insurance premiums - Monthly Amount (0.00)']     = _money('exp_health_insurance')
    fields['Dental expenses - Monthly Amount (0.00)']               = _money('exp_dental')
    fields['Medicine and drugs - Monthly Amount (0.00)']            = _money('exp_medicine')
    fields['Eye care - Monthly Amount (0.00)']                      = _money('exp_eye_care')

    # ── Assets at valuation date (date of separation) ─────────────────────
    # Items 1-8 map to real property, vehicles, bank accounts, investments etc.
    asset_labels = [
        d.get('asset_real_property_1', ''),
        d.get('asset_vehicle_1', ''),
        d.get('asset_bank_1_name', ''),
        d.get('asset_investment_1', ''),
        d.get('asset_savings_1_type', ''),
        d.get('asset_rrsp_1', ''),
        d.get('asset_business_1', ''),
        d.get('asset_other_1', ''),
    ]
    asset_vals = [
        _money('asset_real_property_1_value'),
        _money('asset_vehicle_1_value'),
        _money('asset_bank_1_value'),
        _money('asset_investment_1_value'),
        _money('asset_savings_1_value'),
        _money('asset_rrsp_1_value'),
        _money('asset_business_1_value'),
        _money('asset_other_1_value'),
    ]
    for i, (lbl, val) in enumerate(zip(asset_labels, asset_vals), start=1):
        if i <= 4:
            fields[f'Other non-cash benefits - Item {i}']    = lbl
            fields[f'Other non-cash benefits - Yearly Market Value {i}'] = val

    # ── Debts at valuation date ────────────────────────────────────────────
    # Form 13.1 uses generic rows; map first 6
    for i in range(1, 7):
        fields[f'Other non-cash benefits - Details {i}'] = d.get(f'debt_detail_{i}', '')

    # ── Property at date of marriage ──────────────────────────────────────
    fields['Yearly Market Value 1 [0.00]'] = _money('prop_marriage_value_1')
    fields['Yearly Market Value 2 [0.00]'] = _money('prop_marriage_value_2')
    fields['Yearly Market Value 3 [0.00]'] = _money('prop_marriage_value_3')

    # ── Net Family Property ───────────────────────────────────────────────
    fields['CPP contributions [0.00]']    = _money('nfp_cpp')
    fields['EI premiums [0.00]']          = _money('nfp_ei')
    fields['Income taxes [0.00]']         = _money('nfp_tax')

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
            fname = annot_obj.get('/T', '')
            if hasattr(fname, 'replace'):
                fname = fname.replace('\x00', '')
            if fname in fields and fields[fname] not in (None, ''):
                annot_obj.update({
                    g.NameObject('/V'): g.create_string_object(str(fields[fname])),
                    g.NameObject('/AP'): g.DictionaryObject(),
                })
                filled += 1
            if fname in checkboxes:
                val = '/Yes' if checkboxes[fname] else '/Off'
                annot_obj.update({
                    g.NameObject('/V'):  g.NameObject(val),
                    g.NameObject('/AS'): g.NameObject(val),
                })
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

def _write_pdf(input_path, output_path, fields, checkboxes=None):
    """Generic PDF writer used by all fill functions below."""
    import pypdf
    checkboxes = checkboxes or {}
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
            t  = str(obj.get('/T', ''))
            if ft == '/Tx' and t in fields:
                obj.update({
                    pypdf.generic.NameObject('/V'):  pypdf.generic.create_string_object(str(fields[t])),
                    pypdf.generic.NameObject('/AP'): pypdf.generic.DictionaryObject(),
                })
                filled += 1
            elif ft == '/Btn' and t in checkboxes:
                v = '/Yes' if checkboxes[t] else '/Off'
                obj.update({
                    pypdf.generic.NameObject('/V'):  pypdf.generic.NameObject(v),
                    pypdf.generic.NameObject('/AS'): pypdf.generic.NameObject(v),
                })
                filled += 1
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
    ap_full = f'{ap}\n{ap_addr}\nTel: {ap_ph}\nEmail: {ap_em}' if ap_addr else ap
    re_full = f'{re_name}\n{re_addr}\nTel: {re_ph}\nEmail: {re_em}' if re_addr else re_name
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
def fill_form10(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=5)
    fields['Name of court'] = fields.pop('Name of court', '')  # form10 uses lower-case key
    fields['Full legal name'] = d.get('respondent_full_name', '')
    fields['Address of added party'] = d.get('added_party_address', '')
    fields['Name - Applicant(s) Lawyer'] = d.get('applicant_lawyer_name', '')
    fields['Address - Applicant(s) Lawyer'] = d.get('applicant_lawyer_address', '')
    fields['Phone & fax - Applicant(s) Lawyer'] = d.get('applicant_lawyer_phone', '')
    fields['Email - Applicant(s) Lawyer'] = d.get('applicant_lawyer_email', '')
    fields['Full legal name - Respondent(s)'] = d.get('respondent_full_name', '')
    fields['Address - Respondent(s)'] = d.get('respondent_address', '')
    fields['Phone & fax - Respondent(s)'] = format_phone(d.get('respondent_phone', ''))
    fields['Email - Respondent(s)'] = d.get('respondent_email', '')
    fields['Name - Respondent(s) Lawyer'] = d.get('respondent_lawyer_name', '')
    fields['I do not agree with the following claim(s) made by the applicant: (Refer to the numbers alongside the boxes on page 4 of the application form.)'] = d.get('disagree_claims', '')
    checkboxes = {}
    if d.get('making_own_claim', '').lower() in ('yes', 'true', '1'):
        checkboxes['I am making a claim of my own'] = True
    n = _write_pdf(input_path, output_path, fields, checkboxes)
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
    if d.get('dismiss_request', '').lower() in ('yes', 'true', '1'):
        checkboxes['Dismiss claim'] = True
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
    d = _fe_flat(form_data_list)
    fields = {
        'form1[0].page1[0].body[0].courtDetails[0].courtFileNumber[0]': d.get('court_file_number', ''),
        'form1[0].page1[0].body[0].courtDetails[0].court[0].courtOfficeAddress[0]': COURTHOUSE_ADDRESSES_FE.get(d.get('courthouse',''), ''),
        'form1[0].page1[0].body[0].courtDetails[0].Dated[0]': d.get('date_sworn', ''),
        'form1[0].page1[0].body[0].applicants[0].Recipient[0].textfield[0]': d.get('applicant_full_name', ''),
        'form1[0].page1[0].body[0].applicants[0].Recipient[0].textfield[1]': d.get('applicant_address', ''),
        'form1[0].page1[0].body[0].Payor[0].Payor[0].textfield[0]': d.get('respondent_full_name', ''),
        'form1[0].page1[0].body[0].Payor[0].Payor[0].textfield[1]': d.get('respondent_address', ''),
        'form1[0].page1[0].body[0].conditions[0].Reasons[0]': d.get('affidavit_text', ''),
        'form1[0].page1[0].body[0].Page2[0].Reasons[0]': d.get('affidavit_continued', ''),
        'form1[0].page1[0].body[0].Page2[0].PageHeader[0].#subform[0].courtFileNumber[0]': d.get('court_file_number', ''),
        'form1[0].page1[0].body[0].Page2[0].BottomSection[0].Section3[0].Municipality[0]': d.get('city', ''),
        'form1[0].page1[0].body[0].Page2[0].BottomSection[0].Section3[0].Province[0]': d.get('province', 'Ontario'),
        'form1[0].page1[0].body[0].Page2[0].BottomSection[0].Section3[0].Date[0]': d.get('date_sworn', ''),
        'form1[0].page1[0].body[0].Page2[0].BottomSection[0].Section3[0].Commissioner[0]': d.get('commissioner_name', ''),
        'form1[0].page1[0].body[0].childrensLawyer[0].Name[0]': d.get('childrens_lawyer', ''),
    }
    n = _write_pdf(input_path, output_path, fields)
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
    fields['Name of requesting party'] = d.get('applicant_full_name', '')
    fields['municipality'] = d.get('city', '')
    fields['Date of issue by the clerk of the court'] = d.get('issue_date', '')
    fields['the agreement that you want to change You can only use this form to change support terms in an agreement that'] = d.get('order_or_agreement_desc', '')
    n = _write_pdf(input_path, output_path, fields)
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
        "Applicant's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": f'{ap}\n{ap_addr}',
        "Applicant lawyer's name & address — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": d.get('applicant_lawyer', ''),
        'Respondent full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)': f'{re_name}\n{re_addr}',
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
def fill_form23c(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=4)
    fields['date of birth'] = d.get('applicant_dob', '')
    fields['Date of marriage'] = d.get('date_of_marriage', '')
    fields['Place of marriage'] = d.get('place_of_marriage', '')
    fields['Date - Separation'] = d.get('date_of_separation', '')
    # Children table (up to 5)
    for i in range(1, 6):
        fields[f'Full Legal NameRow{i}'] = d.get(f'child_{i}_name', '')
        fields[f'AgeRow{i}'] = d.get(f'child_{i}_age', '')
        fields[f'Birthdate d m yRow{i}'] = d.get(f'child_{i}_dob', '')
        fields[f'Resident in municipality  provinceRow{i}'] = d.get(f'child_{i}_residence', '')
        fields[f'Now living with name of person and relationship to childRow{i}'] = d.get(f'child_{i}_living_with', '')
    checkboxes = {
        'married on date': d.get('relationship_type', '') == 'married',
        'separated on date': bool(d.get('date_of_separation', '')),
        'never lived together': d.get('relationship_type', '') == 'never_lived_together',
    }
    n = _write_pdf(input_path, output_path, fields, checkboxes)
    sys.stderr.write(f'[fill_form23c] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 25 — Order (General)
# ─────────────────────────────────────────────────────────────────────────────
def fill_form25(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
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
        "Applicant's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": f'{ap}\n{ap_addr}',
        "Respondent's full legal name & address for service — street & number, municipality, postal code, telephone & fax numbers and e-mail address (if any)": f'{re_name}\n{re_addr}',
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
def fill_form35_1(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=5)
    fields['Full legal name'] = d.get('filer_full_name', d.get('applicant_full_name', ''))
    fields['Date of birth (d, m, y)'] = d.get('filer_dob', '')
    fields['Name of city, town or municipality and province, state or country if outside of Ontario'] = d.get('filer_city', d.get('city', ''))
    fields['Court address'] = COURTHOUSE_ADDRESSES_FE.get(d.get('courthouse',''), '')
    # Children (up to 5)
    for i in range(1, 6):
        fields[f'Children in this case - full legal name - child {i}'] = d.get(f'child_{i}_name', '')
        fields[f'Children in this case - Birthdate (d, m, y) - child {i}'] = d.get(f'child_{i}_dob', '')
        fields[f'Children in this case - Age - child {i}'] = d.get(f'child_{i}_age', '')
    checkboxes = {
        'by me': d.get('affidavit_by', '') == 'me',
        'jointly by me and names of persons': d.get('affidavit_by', '') == 'jointly',
        'I work': d.get('employment_status', '') in ('employed','working'),
        'I attend school': d.get('employment_status', '') == 'student',
        'full time': d.get('work_schedule', '') == 'full_time',
        'part time': d.get('work_schedule', '') == 'part_time',
    }
    n = _write_pdf(input_path, output_path, fields, checkboxes)
    sys.stderr.write(f'[fill_form35_1] Filled {n} fields\n')
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Form 36 — Affidavit for Divorce
# ─────────────────────────────────────────────────────────────────────────────
def fill_form36(input_path, output_path, form_data_list):
    d = _fe_flat(form_data_list)
    fields = _header(d, pages=4)
    fields['Full legal name'] = d.get('applicant_full_name', '')
    fields['Municipality & Province'] = f"{d.get('city','')}, {d.get('province','Ontario')}"
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
    n = _write_pdf(input_path, output_path, fields, checkboxes)
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
    if len(sys.argv) < 4:
        sys.stderr.write(f'Usage: {sys.argv[0]} <input_pdf> <output_pdf> <json_data_file> [form_type]\n')
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
        'form34a':  fill_form34a,
        'form37':   fill_form37,
    }
    fn = FORM_DISPATCH.get(form_type.lower().replace('-', '_'))
    if fn:
        n = fn(input_pdf, output_pdf, form_data)
    else:
        n = fill_pdf(input_pdf, output_pdf, form_data)
    print(f'OK ({n} fields filled)')


