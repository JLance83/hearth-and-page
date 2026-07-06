# Read fill_pdf.py
with open('dist/fill_pdf.py', 'r', encoding='utf-8') as f:
    content = f.read()

# ============================================================
# Form 10A handler — insert before fill_form14
# ============================================================
FORM10A_HANDLER = '''

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
    sys.stderr.write(f'[fill_form10a] Filled {n} fields\\n')
    return n

'''

# ============================================================
# Form 34A handler — insert before fill_form14
# ============================================================
FORM34A_HANDLER = '''

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
    sys.stderr.write(f'[fill_form34a] Filled {n} fields\\n')
    return n

'''

# ============================================================
# Form 37 handler — text generation, no PDF fill needed
# ============================================================
FORM37_HANDLER = '''

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
            Paragraph('Form 37 \u2014 Notice of Hearing', title_style),
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
            Paragraph('\u26a0\ufe0f Note: Form 37 is officially issued by the court clerk. '
                      'This summary is for your reference only. Always refer to the '
                      'official Form 37 issued by the court for legal purposes.', note_style),
            Spacer(1, 0.1*inch),
            Paragraph('<i>Prepared by Hearth &amp; Page &mdash; hearthandpage.ca</i>', note_style),
        ]
        doc.build(story)
        sys.stderr.write(f'[fill_form37] Generated hearing summary PDF\\n')
        return 1
    except Exception as e:
        sys.stderr.write(f'[fill_form37] ReportLab error: {e}\\n')
        # Fallback: copy blank PDF if exists
        import shutil
        if input_path and os.path.exists(input_path):
            shutil.copy2(input_path, output_path)
        return 0

'''

# Insert all three handlers before fill_form14
INSERTION_MARKER = '\n# ─────────────────────────────────────────────────────────────────────────────\n# Form 14 — Notice of Motion\n'

if 'fill_form10a' not in content:
    content = content.replace(INSERTION_MARKER, FORM10A_HANDLER + FORM34A_HANDLER + FORM37_HANDLER + INSERTION_MARKER, 1)
    print("Inserted fill_form10a, fill_form34a, fill_form37 ✓")
else:
    print("Handlers already present, skipping insertion")

# Add dispatch entries
OLD_DISPATCH = "        'form36b':  fill_form36b,\n        'form30a':  fill_form30a,"
NEW_DISPATCH = """        'form36b':  fill_form36b,
        'form30a':  fill_form30a,
        'form10a':  fill_form10a,
        'form34a':  fill_form34a,
        'form37':   fill_form37,"""

if "'form10a'" not in content:
    content = content.replace(OLD_DISPATCH, NEW_DISPATCH, 1)
    print("Dispatch entries added ✓")
else:
    print("Dispatch entries already present")

with open('dist/fill_pdf.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("dist/fill_pdf.py saved ✓")
