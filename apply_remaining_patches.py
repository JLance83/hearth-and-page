import re

# ============================================================
# PATCH 4 RETRY: Form 10A formDef injection
# ============================================================
FORM10A_FORMDEF = r"""
  window.__hp_formDefs['ON-F10A'] = {"formId":"ON-F10A","jurisdiction":"ON","pdfFileName":"form10a.pdf","title":"Form 10A \u2014 Reply","subtitle":"Ontario Family Court \u2014 Family Law Rules","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 10A is filed by the applicant in response to the respondent\u2019s Answer (Form 10). Use this form if the respondent has made claims you disagree with, or if you need to respond to new facts raised in the Answer. If you agree with everything in the Answer, you do not need to file a Reply.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 4","intro":"Confirm the court file details for this reply.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","pdfFieldName":"Court File Number","autoFill":"fileNumber"},{"fieldId":"form_date","label":"Date of this Reply","type":"date","required":true,"pdfFieldName":"Date of Reply"}]},{"partId":"parties","title":"Parties","subtitle":"Step 2 of 4","intro":"Confirm the applicant and respondent details.","fields":[{"fieldId":"applicant_name","label":"Applicant full legal name","type":"text","source":"profile.personal.fullName","required":true,"pdfFieldName":"Applicant Name","autoFill":"applicantName"},{"fieldId":"applicant_address","label":"Applicant address for service","type":"text","required":true,"pdfFieldName":"Applicant Address"},{"fieldId":"applicant_phone","label":"Applicant phone number","type":"text","required":false,"pdfFieldName":"Applicant Phone"},{"fieldId":"applicant_email","label":"Applicant email","type":"email","required":false,"pdfFieldName":"Applicant Email"},{"fieldId":"respondent_name","label":"Respondent full legal name","type":"text","source":"profile.case.respondentName","required":true,"pdfFieldName":"Respondent Name","autoFill":"respondentName"},{"fieldId":"respondent_address","label":"Respondent address for service","type":"text","required":false,"pdfFieldName":"Respondent Address"}]},{"partId":"claims","title":"Claims \u2014 Agree or Disagree","subtitle":"Step 3 of 4","intro":"Review each claim the respondent made in their Answer. Indicate which you agree with and which you dispute. Where you disagree, explain why.","fields":[{"fieldId":"claims_agreed","label":"Claims in the Answer you AGREE with","type":"textarea","required":false,"placeholder":"List paragraph numbers or claims from the Answer that you accept, e.g. \u2018I agree with paragraphs 3 and 5 of the Answer regarding parenting time.\u2019","pdfFieldName":"Claims Agreed"},{"fieldId":"claims_disagreed","label":"Claims in the Answer you DISAGREE with","type":"textarea","required":false,"placeholder":"List paragraph numbers or claims you dispute, e.g. \u2018I disagree with paragraph 7 regarding child support.\u2019","pdfFieldName":"Claims Disagreed"},{"fieldId":"dismiss_request","label":"Are you asking the court to dismiss any of the respondent\u2019s claims?","type":"yesno","required":true},{"fieldId":"dismiss_details","label":"Which claims should be dismissed and why?","type":"textarea","required":false,"conditional":{"dependsOn":"dismiss_request","showWhen":"yes"},"placeholder":"e.g. \u2018The respondent\u2019s claim for spousal support should be dismissed because no agreement was ever made.\u2019","pdfFieldName":"Dismiss Details"},{"fieldId":"supporting_facts","label":"Additional facts supporting your reply","type":"textarea","required":false,"placeholder":"Provide any facts or context that support your position. Be specific and factual. Do not include legal arguments here.","pdfFieldName":"Supporting Facts"}]},{"partId":"review","title":"Review & sign","subtitle":"Step 4 of 4","intro":"Review your Reply carefully before signing. This is a court document.","fields":[{"fieldId":"review_accuracy","label":"I confirm that all information in this Reply is true and accurate to the best of my knowledge.","type":"checkbox","required":true},{"fieldId":"signature_date","label":"Date of signature","type":"date","required":true,"pdfFieldName":"Signature Date"},{"fieldId":"deponent_name","label":"Your full legal name (as it will appear on the signature line)","type":"text","source":"profile.personal.fullName","required":true,"pdfFieldName":"Deponent Name","autoFill":"applicantName"}]}]};
"""

# ============================================================
# PATCH 6: Form 37 formDef injection (text-generation, no PDF)
# ============================================================
FORM37_FORMDEF = r"""
  window.__hp_formDefs['ON-F37'] = {"formId":"ON-F37","jurisdiction":"ON","pdfFileName":null,"title":"Form 37 \u2014 Notice of Hearing","subtitle":"Ontario Family Court \u2014 Family Law Rules","requiredPlan":"standard","freeForm":true,"textGenerationForm":true,"helpIntro":"Form 37 is a Notice of Hearing issued by the court clerk \u2014 it is NOT filled out by the parties. The court generates and issues this notice to inform all parties of a scheduled hearing date, time, and location. Hearth \u0026 Page will help you understand what to expect and prepare a personal hearing checklist for your file.","clerkIssuedNotice":{"enabled":true,"message":"Form 37 is ISSUED by the court clerk, not completed by you. The clerk sends this notice automatically after a hearing is scheduled by the court or by order. Your role is to review the notice when received and attend the hearing as directed.","howToRespond":["Review the hearing date, time, and courtroom listed on the form","Confirm you can attend \u2014 if you cannot, contact the court clerk immediately to request an adjournment","Serve any required materials on the other party before the hearing deadline","Bring all relevant documents, affidavits, and evidence to the hearing"]},"parts":[{"partId":"hearing_info","title":"Your Upcoming Hearing","subtitle":"Step 1 of 2","intro":"Enter the details from the Form 37 Notice of Hearing you received from the court.","fields":[{"fieldId":"hearing_date","label":"Hearing date (from your Form 37)","type":"date","required":true,"pdfFieldName":"Hearing Date"},{"fieldId":"hearing_time","label":"Hearing time","type":"text","required":false,"placeholder":"e.g. 9:30 AM","pdfFieldName":"Hearing Time"},{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","autoFill":"courthouse"},{"fieldId":"courtroom","label":"Courtroom number (if shown on notice)","type":"text","required":false,"placeholder":"e.g. Courtroom 3","pdfFieldName":"Courtroom"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","autoFill":"fileNumber"},{"fieldId":"hearing_type","label":"Type of hearing","type":"select","required":false,"options":["Case Conference","Settlement Conference","Trial Management Conference","Motion","Trial","Other"],"pdfFieldName":"Hearing Type"},{"fieldId":"hearing_notes","label":"Any special instructions on your notice?","type":"textarea","required":false,"placeholder":"e.g. \u2018Bring proof of income\u2019 or \u2018Attendance by phone permitted\u2019"}]},{"partId":"checklist","title":"Hearing Preparation Checklist","subtitle":"Step 2 of 2","intro":"Check off each item to make sure you\u2019re ready for your hearing.","type":"checklist","fields":[{"fieldId":"chk_serve","label":"I have served all required documents on the other party at least the required number of days before the hearing","type":"checkbox","required":false},{"fieldId":"chk_confirm_attend","label":"I have confirmed I can attend (or arranged an adjournment if I cannot)","type":"checkbox","required":false},{"fieldId":"chk_documents","label":"I have gathered all documents, affidavits, and evidence I need to bring","type":"checkbox","required":false},{"fieldId":"chk_review_orders","label":"I have reviewed all previous court orders relevant to this hearing","type":"checkbox","required":false},{"fieldId":"chk_childcare","label":"I have arranged childcare or accommodations for the day of the hearing (if needed)","type":"checkbox","required":false},{"fieldId":"chk_id","label":"I have photo ID to bring to the courthouse","type":"checkbox","required":false},{"fieldId":"chk_arrive_early","label":"I plan to arrive at least 30 minutes early to clear security and find the courtroom","type":"checkbox","required":false}]}]};
"""

# ============================================================
# Read the file
# ============================================================
with open('hp-patches.js', 'r', encoding='utf-8') as f:
    content = f.read()

original_len = len(content)

# --- PATCH 4 RETRY: inject ON-F10A before ON-F13 (3 spaces before =) ---
marker_10a = "  window.__hp_formDefs['ON-F13']   = "
if "window.__hp_formDefs['ON-F10A']" in content:
    print("PATCH 4: ON-F10A already present, skipping")
elif marker_10a in content:
    content = content.replace(marker_10a, FORM10A_FORMDEF + "\n" + marker_10a, 1)
    print("PATCH 4: ON-F10A formDef injected before ON-F13 ✓")
else:
    print(f"PATCH 4 FAIL: marker not found. Searching for alternatives...")
    # Try to find the actual marker
    idx = content.find("__hp_formDefs['ON-F13']")
    if idx >= 0:
        print(f"  Found ON-F13 at char {idx}, context: {repr(content[idx-10:idx+40])}")
    else:
        print("  ON-F13 not found at all in file!")

# --- PATCH 6: inject ON-F37 formDef ---
# Inject before ON-F36 formDef (Form 37 goes near end, after F36)
marker_37 = "  window.__hp_formDefs['ON-F36']   = "
if "window.__hp_formDefs['ON-F37']" in content:
    print("PATCH 6: ON-F37 already present, skipping")
elif marker_37 in content:
    content = content.replace(marker_37, FORM37_FORMDEF + "\n" + marker_37, 1)
    print("PATCH 6: ON-F37 formDef injected before ON-F36 ✓")
else:
    # Try alternate spacing
    marker_37b = "  window.__hp_formDefs['ON-F36'] = "
    if marker_37b in content:
        content = content.replace(marker_37b, FORM37_FORMDEF + "\n" + marker_37b, 1)
        print("PATCH 6: ON-F37 formDef injected before ON-F36 (alt marker) ✓")
    else:
        # Inject before the closing of the formDefs block
        marker_37c = "  window.__hp_formDefs['ON-F36B']"
        if marker_37c in content:
            content = content.replace(marker_37c, FORM37_FORMDEF + "\n" + marker_37c, 1)
            print("PATCH 6: ON-F37 formDef injected before ON-F36B ✓")
        else:
            print("PATCH 6 FAIL: No suitable marker found for Form 37")

print(f"\nFile size: {original_len} → {len(content)} (+{len(content)-original_len} bytes)")

with open('hp-patches.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("hp-patches.js saved ✓")
