// Hearth & Page — hp-patches.js
// Self-contained: works on any build of the app (Railway or Perplexity)
// Strategy:
//   1. Auth token helper
//   2. PDF patching (Form 35.1 and Form 13)
//   3. Email PDF to user
//   4. MutationObserver to inject "Email me this PDF" button into the download dialog

// ─── Auth token ───────────────────────────────────────────────────────────────
function __getFlap35Token() {
  try {
    var parts = (window.name || '').split('|');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf('flap:') === 0) return parts[i].slice(5);
    }
  } catch(e) {}
  try {
    var m = document.cookie.match(/(?:^|;\s*)flap_token=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch(e) {}
  return null;
}

function __authHdr() {
  // Try all known token sources: in-memory window.__hp_token (set by React bundle at login),
  // then optional getter function, then cookie/window.name fallback
  var t = window.__hp_token
       || (typeof window.__hp_getToken === 'function' && window.__hp_getToken())
       || __getFlap35Token();
  return t ? {'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json'} : {'Content-Type': 'application/json'};
}

// ─── Form 35.1 PDF patcher ────────────────────────────────────────────────────
window.__patchForm35PDF_real = async function(pdfBlob, caseId) {
  try {
    if (!window.PDFLib) return null;
    var resp = await fetch('/api/cases/' + caseId + '/form-data', {headers: __authHdr()});
    if (!resp.ok) return null;
    var rows = await resp.json();
    var data = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!data[row.section]) data[row.section] = {};
      data[row.section][row.fieldKey] = row.fieldValue;
    }
    var id = data['f351_identity'] || {};
    var ap = data['applicant'] || {};
    var pl = data['f351_plan'] || {};
    var ch = data['children'] || {};
    var caregiverName = id.fullName || ap.fullName || '';
    var planAddress = pl.planAddress || '';
    var workplace = pl.workplaceName || '';
    if (!caregiverName && !planAddress && !workplace) return null;
    var pdfDoc = await window.PDFLib.PDFDocument.load(await pdfBlob.arrayBuffer(), {ignoreEncryption: true});
    var form = pdfDoc.getForm();
    var count = Math.max(1, Math.min(parseInt(ch.count) || 0, 3));
    var cgFields = [
      'Name(s) of Caregiver(s) or children\'s aid society) 1',
      'Name(s) of Caregiver(s) or children\'s aid society) 2',
      'Name(s) of Caregiver(s) or children\'s aid society) 3'
    ];
    for (var j = 0; j < count; j++) {
      try { var f = form.getTextField(cgFields[j]); if (f && caregiverName) f.setText(caregiverName); } catch(e) {}
    }
    try { var fa = form.getTextField('address'); if (fa && planAddress) fa.setText(planAddress); } catch(e) {}
    try { var fw = form.getTextField('Name of your place of work or school'); if (fw && workplace) fw.setText(workplace); } catch(e) {}
    var bytes = await pdfDoc.save({updateFieldAppearances: true});
    return new Blob([bytes], {type: 'application/pdf'});
  } catch(err) { console.warn('Form 35.1 patch error:', err); return null; }
};

// ─── Form 13 PDF patcher ──────────────────────────────────────────────────────
window.__patchForm13PDF_real = async function(pdfBlob, caseId) {
  try {
    if (!window.PDFLib) return null;
    var resp = await fetch('/api/cases/' + caseId + '/form-data', {headers: __authHdr()});
    if (!resp.ok) return null;
    var rows = await resp.json();
    var data = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!data[row.section]) data[row.section] = {};
      data[row.section][row.fieldKey] = row.fieldValue;
    }
    var exp = data['f13_expenses'] || {};
    function v(val) { return (val != null && val !== '') ? String(val) : ''; }
    var fm = [
      ['CPP contributions [0.00]', v(exp.exp_auto_deductions)],
      ['Rent or mortgage [0.00]', v(exp.exp_rent_mortgage)],
      ['Property taxes [0.00]', v(exp.exp_property_tax)],
      ['Property insurance [0.00]', v(exp.exp_property_insurance)],
      ['Condominium fees [0.00]', v(exp.exp_condo_fees)],
      ['Repairs and maintenance [0.00]', v(exp.exp_home_repairs)],
      ['Water [0.00]', v(exp.exp_utilities)],
      ['Gas and oil [0.00]', v(exp.exp_transit)],
      ['Health insurance premiums [0.00]', v(exp.exp_health)],
      ['Clothing [0.00]', v(exp.exp_clothing)],
      ['Groceries [0.00]', v(exp.exp_groceries)],
      ['Meals outside the home [0.00]', v(exp.exp_meals_out)],
      ['Daycare expense [0.00]', v(exp.exp_childcare)],
      ['Entertainment/recreation [0.00]', v(exp.exp_personal)],
      ['Life Insurance premiums [0.00]', v(exp.exp_life_insurance)],
      ['RRSP/RESP withdrawals [0.00]', v(exp.exp_rrsp)],
      ['Vacations [0.00]', v(exp.exp_vacations)],
      ["Children's activities [0.00]", v(exp.exp_children_activities)],
      ['Debt payments [0.00]', v(exp.exp_debt_payments)],
      ['Support paid for other children [0.00]', v(exp.exp_other_support)],
      ['Other expenses [0.00]', v(exp.exp_other)],
      ['Total Amount of Monthly Expenses [0.00]', v(exp.exp_total_monthly)]
    ];
    var hasData = fm.some(function(p) { return p[1]; });
    if (!hasData) return null;
    var pdfDoc = await window.PDFLib.PDFDocument.load(await pdfBlob.arrayBuffer(), {ignoreEncryption: true});
    var form = pdfDoc.getForm();
    for (var k = 0; k < fm.length; k++) {
      if (!fm[k][1]) continue;
      try { var fld = form.getTextField(fm[k][0]); if (fld) fld.setText(fm[k][1]); } catch(e) {}
    }
    var bytes = await pdfDoc.save({updateFieldAppearances: true});
    return new Blob([bytes], {type: 'application/pdf'});
  } catch(err) { console.warn('Form 13 patch error:', err); return null; }
};

// ─── Email PDF ────────────────────────────────────────────────────────────────
// New approach: generate a 24hr secure download link, email that instead of
// attaching the PDF. iCloud (and most providers) block large PDF attachments
// from new domains — a plain link email always delivers.
window.__emailPDF_real = async function(pdfBlob, filename, userEmail, formLabel) {
  try {
    var RAILWAY = 'https://api-production-2334.up.railway.app';
    var token = window.__hp_getToken ? window.__hp_getToken() : null;
    if (!token) { console.warn('No auth token for email'); return false; }

    // Get caseId and formType from global state set by the bundle
    var caseId = window.__hp_currentCaseId || '1';
    var formType = window.__hp_currentFormKey || 'form8';

    // Step 1: Generate a secure 24hr download link
    var linkResp = await fetch(RAILWAY + '/api/cases/' + caseId + '/pdf-link/' + formType, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: '{}'
    });
    if (!linkResp.ok) {
      console.warn('[emailPDF] pdf-link failed:', linkResp.status);
      return false;
    }
    var linkData = await linkResp.json();
    var downloadUrl = linkData.url;

    // Step 2: Build a clean HTML email with the download link (no attachment)
    var expiryDate = new Date(linkData.expiresAt).toLocaleDateString('en-CA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    var html = [
      '<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f7f4;color:#1a2a30">',
      '<h2 style="color:#1E2D4E;margin-bottom:4px">Hearth &amp; Page</h2>',
      '<p style="color:#6b8a99;font-size:13px;margin-top:0">Ontario Family Law Forms</p>',
      '<hr style="border:none;border-top:1px solid #d0dde2;margin:20px 0">',
      '<p style="font-size:16px">Your <strong>' + formLabel + '</strong> is ready to download.</p>',
      '<p style="margin:24px 0">',
      '<a href="' + downloadUrl + '" style="display:inline-block;padding:14px 28px;background:#1E2D4E;color:#ffffff;text-decoration:none;border-radius:8px;font-family:Georgia,serif;font-size:16px">',
      '&#8595; Download Your PDF',
      '</a>',
      '</p>',
      '<p style="color:#4a6470;font-size:14px">This link expires on <strong>' + expiryDate + '</strong>. After that, you can generate a new one from the app.</p>',
      '<p style="color:#4a6470;font-size:14px">Print it or save it &mdash; then bring it to the courthouse or share it with your lawyer.</p>',
      '<hr style="border:none;border-top:1px solid #d0dde2;margin:24px 0">',
      '<p style="font-size:12px;color:#8a9fa8">Generated by <a href="https://hearthandpage.ca" style="color:#A8B4D0;text-decoration:none">Hearth &amp; Page</a> &bull; Your file is private and secure.</p>',
      '</div>'
    ].join('');

    var text = [
      'Your ' + formLabel + ' is ready.',
      '',
      'Download it here: ' + downloadUrl,
      '',
      'This link expires on ' + expiryDate + '.',
      'Print it or save it, then bring it to the courthouse or share it with your lawyer.',
      '',
      '— Hearth & Page | hearthandpage.ca'
    ].join('\n');

    var payload = {
      to: [userEmail],
      subject: 'Your ' + formLabel + ' is ready – Hearth & Page',
      html: html,
      text: text
    };

    // Step 3: Send via Railway (no attachment — just a link)
    var r = await fetch(RAILWAY + '/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return r.ok;
  } catch(err) { console.warn('Email PDF error:', err); return false; }
};

// ─── Inject "Email me this PDF" button via MutationObserver ──────────────────
// This works even when the bundle doesn’t have the button (e.g. Railway build)
(function() {
  var injected = false;

  function tryInjectEmailButton() {
    // The download button in the Official PDF dialog
    var dlBtn = document.querySelector('[data-testid="button-review-download"]');
    if (!dlBtn) return;
    if (document.querySelector('[data-testid="button-email-pdf"]')) return; // already there

    var emailBtn = document.createElement('button');
    emailBtn.setAttribute('data-testid', 'button-email-pdf');
    emailBtn.textContent = 'Email me this PDF';
    emailBtn.style.cssText = [
      'padding: 8px 16px',
      'border: 1.5px solid #1E2D4E',
      'border-radius: 6px',
      'background: transparent',
      'color: #1E2D4E',
      'font-family: inherit',
      'font-size: 14px',
      'font-weight: 500',
      'cursor: pointer',
      'white-space: nowrap',
      'flex-shrink: 0'
    ].join(';');

    emailBtn.addEventListener('click', async function() {
      if (emailBtn.disabled) return;
      emailBtn.textContent = 'Sending…';
      emailBtn.disabled = true;

      try {
        var RAILWAY_BASE = 'https://api-production-2334.up.railway.app';

        // Resolve caseId from URL hash — handles #/case/1/review and #/cases/1/review
        var caseIdMatch = window.location.hash.match(/case[s]?\/([0-9]+)/);
        var caseId = caseIdMatch ? caseIdMatch[1] : null;
        if (!caseId) {
          var allLinks = document.querySelectorAll('[href*="cases/"], [href*="case/"]');
          for (var i = 0; i < allLinks.length; i++) {
            var m2 = allLinks[i].getAttribute('href').match(/case[s]?\/([0-9]+)/);
            if (m2) { caseId = m2[1]; break; }
          }
        }
        // Store globally so __emailPDF_real can use it
        window.__hp_currentCaseId = caseId || '1';

        // Get user email
        var userEmail = (window.__hp_user && window.__hp_user.email);
        if (!userEmail) {
          var me = await fetch(RAILWAY_BASE + '/api/auth/me', {headers: __authHdr()})
            .then(function(r) { return r.json(); }).catch(function() { return null; });
          userEmail = (me && me.user && me.user.email) || (me && me.email);
        }

        var formKey = window.__hp_currentFormKey || 'form8';
        var formLabel = window.__hp_currentFormLabel || 'Court Form';

        if (!userEmail) {
          emailBtn.textContent = 'No email on account';
          emailBtn.disabled = false;
          return;
        }
        if (!caseId) {
          emailBtn.textContent = 'Could not detect case';
          emailBtn.disabled = false;
          return;
        }

        // Generate secure 24hr download link + send email with the link (no attachment)
        // iCloud silently discards PDF attachments from new/untrusted sending domains
        var ok = await window.__emailPDF_real(null, formKey + '.pdf', userEmail, formLabel);

        if (ok) {
          emailBtn.textContent = '\u2713 Sent to ' + userEmail;
          setTimeout(function() {
            emailBtn.textContent = 'Email me this PDF';
            emailBtn.disabled = false;
          }, 5000);
        } else {
          emailBtn.textContent = 'Failed \u2014 try again';
          emailBtn.disabled = false;
        }
      } catch(err) {
        console.warn('Email button error:', err);
        emailBtn.textContent = 'Error \u2014 try again';
        emailBtn.disabled = false;
      }
    });

    // Insert before the download button
    dlBtn.parentNode.insertBefore(emailBtn, dlBtn);
  }

  // Also patch the bundle's download handler to expose formKey for the email button
  var _origOpen = window.XMLHttpRequest ? window.XMLHttpRequest.prototype.open : null;

  // Watch for the dialog to appear
  var observer = new MutationObserver(function() {
    tryInjectEmailButton();
  });
  observer.observe(document.body, {childList: true, subtree: true});

  // Also try on click of any "Official Court PDF" or similar trigger
  document.addEventListener('click', function(e) {
    setTimeout(tryInjectEmailButton, 300);
  }, true);

  // Expose a way for the bundle to tell us the current form
  window.__hp_setCurrentForm = function(formKey, formLabel) {
    window.__hp_currentFormKey = formKey;
    window.__hp_currentFormLabel = formLabel;
  };
})();

// --- SCJ-Compliant PDF Filename Generator ---
// Format: [Form Label] – [Applicant/Respondent] – [Last Name] – [DD-MM-YYYY]
// Matches Superior Court of Justice Case Center naming convention (June 2026 notice)
window.__hp_scjFilename = async function(formLabel, caseId, role) {
  try {
    var today = new Date();
    var dd    = String(today.getDate()).padStart(2, '0');
    var mm    = String(today.getMonth() + 1).padStart(2, '0');
    var yyyy  = today.getFullYear();
    var dateStr = dd + '-' + mm + '-' + yyyy;
    var party = role || 'Applicant';

    // Try to get applicant last name from form_data
    var lastName = '';
    try {
      if (caseId) {
        var RAILWAY_EP = 'https://api-production-2334.up.railway.app';
        var r = await fetch(RAILWAY_EP + '/api/cases/' + caseId + '/form-data', {
          headers: window.__authHdr ? window.__authHdr() : {}
        });
        if (r.ok) {
          var rows = await r.json();
          // Look for applicant full name field
          var nameRow = rows.find(function(row) {
            return row.field_key === 'applicantFullName' ||
                   row.field_key === 'applicant_full_name' ||
                   row.field_key === 'fullName';
          });
          if (nameRow && nameRow.field_value) {
            var parts = String(nameRow.field_value).trim().split(/\s+/);
            lastName = parts[parts.length - 1] || '';
          }
        }
      }
    } catch(e) { /* fall through to no-name version */ }

    // Build SCJ-compliant filename
    var parts = [formLabel, party];
    if (lastName) parts.push(lastName);
    parts.push(dateStr);
    // Clean each segment, join with en-dash, add .pdf
    return parts.map(function(p) { return p.replace(/[/\\:*?"<>|]/g, ''); }).join(' \u2013 ') + '.pdf';
  } catch(e) {
    // Fallback to basic name if anything goes wrong
    return 'HearthAndPage-' + formLabel.replace(/\s+/g, '-') + '.pdf';
  }
};

// --- Export Panel (called by FormEngine when user hits "Review & Export") ----
// window.__openExportPanel(caseId, formId) -- shows a modal with Download PDF
// button for paid users, or an upsell prompt for free users.
(function() {
  var RAILWAY_EP = 'https://api-production-2334.up.railway.app';

  // Map FormEngine formId to backend PDF file key (stored in /pdfs/)
  // ON-F8 => form8, ON-F13_1 => form13_1, ON-F13B => form13b, etc.
  function formIdToPdfKey(formId) {
    if (!formId) return 'form8';
    var m = formId.match(/^ON-F(\d+[A-Z_0-9]*)$/i);
    if (!m) return formId.toLowerCase().replace(/[^a-z0-9_]/g, '');
    return 'form' + m[1].toLowerCase();
  }

  function formIdToLabel(formId) {
    if (!formId) return 'Court Form';
    var m = formId.match(/^ON-F(\d+[A-Z_0-9]*)$/i);
    if (m) return 'Form ' + m[1].replace('_', '.');
    return formId;
  }

  window.__openExportPanel = function(caseId, formId) {
    if (document.getElementById('hp-export-panel')) return;

    var pdfKey    = formIdToPdfKey(formId);
    var label     = formIdToLabel(formId);
    var isPaid    = false;
    var userEmail = null;

    // Store for email helper
    window.__hp_currentFormKey   = pdfKey;
    window.__hp_currentFormLabel = label;
    window.__hp_currentCaseId    = caseId || '1';

    // Determine paid status
    if (window.__hp_sub_status === 'active' && window.__hp_plan !== 'free') {
      isPaid = true;
    } else if (window.__hp_currentUser) {
      var u = window.__hp_currentUser;
      isPaid    = (u.subscriptionStatus === 'active') && u.plan !== 'free';
      userEmail = u.email || null;
    }

    var TEAL_D = '#1E2D4E';
    var BURG   = '#1E2D4E';

    var overlay = document.createElement('div');
    overlay.id  = 'hp-export-panel';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';

    var paidButtons = isPaid ? [
      '<button id="hp-ep-download" data-testid="button-review-download" style="background:' + TEAL_D + ';color:#fff;border:none;border-radius:10px;padding:14px 20px;font-size:15px;font-weight:600;cursor:pointer;width:100%;">',
        'Download Official Court PDF',
      '</button>',
      '<button id="hp-ep-email" data-testid="button-email-pdf" style="background:transparent;color:' + TEAL_D + ';border:1.5px solid ' + TEAL_D + ';border-radius:10px;padding:12px 20px;font-size:15px;font-weight:500;cursor:pointer;width:100%;">Email me this PDF</button>'
    ].join('') : [
      '<p style="color:#555;font-size:14px;line-height:1.5;margin:0 0 16px;">You\'ve completed <strong>' + label + '</strong> \u2014 great work!<br>Subscribe to download your court-ready PDF and unlock all 35 Ontario family court forms.</p>',
      '<button id="hp-ep-std" style="background:' + TEAL_D + ';color:#fff;border:none;border-radius:10px;padding:14px 20px;font-size:15px;font-weight:600;cursor:pointer;width:100%;">Standard \u2014 $9.99/mo CAD</button>',
      '<button id="hp-ep-plus" style="background:' + BURG + ';color:#fff;border:none;border-radius:10px;padding:14px 20px;font-size:15px;font-weight:600;cursor:pointer;width:100%;margin-top:8px;">Plus \u2014 $19.99/mo CAD</button>'
    ].join('');

    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:32px 28px;max-width:460px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,0.25);">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">' +
          '<div style="width:44px;height:44px;border-radius:10px;background:' + TEAL_D + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.08em;">Hearth &amp; Page</div>' +
            '<div style="font-size:18px;font-weight:700;color:' + TEAL_D + ';">' + label + ' Complete</div>' +
          '</div>' +
        '</div>' +
        '<div id="hp-ep-status" style="display:none;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;"></div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
          paidButtons +
          '<button id="hp-ep-close" style="background:transparent;color:#888;border:1px solid #e5e7eb;border-radius:10px;padding:11px 20px;font-size:14px;cursor:pointer;width:100%;margin-top:4px;">Close</button>' +
        '</div>' +
        '<p style="margin:14px 0 0;font-size:11px;color:#bbb;text-align:center;">Generated by Hearth &amp; Page &bull; hearthandpage.ca</p>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('hp-ep-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    if (!isPaid) {
      document.getElementById('hp-ep-std').addEventListener('click', function() {
        overlay.remove();
        fetch(RAILWAY_EP + '/api/stripe/create-checkout', {
          method: 'POST',
          headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
          body: JSON.stringify({ priceId: 'price_1Tduf0DyokC7Tv7bDRAZBk57', successUrl: window.location.href + '?checkout=success', cancelUrl: window.location.href })
        }).then(function(r){ return r.json(); }).then(function(d){ if (d && d.url) window.location.href = d.url; }).catch(function(){});
      });
      document.getElementById('hp-ep-plus').addEventListener('click', function() {
        overlay.remove();
        fetch(RAILWAY_EP + '/api/stripe/create-checkout', {
          method: 'POST',
          headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
          body: JSON.stringify({ priceId: 'price_1TduyXDyokC7Tv7bKKoeeh1v', successUrl: window.location.href + '?checkout=success', cancelUrl: window.location.href })
        }).then(function(r){ return r.json(); }).then(function(d){ if (d && d.url) window.location.href = d.url; }).catch(function(){});
      });
      return;
    }

    // ---- Paid user: wire up Download button ----
    var dlBtn    = document.getElementById('hp-ep-download');
    var statusEl = document.getElementById('hp-ep-status');

    function showStatus(msg, type) {
      statusEl.style.display    = 'block';
      statusEl.style.background = type === 'error' ? '#fef2f2' : '#f0fdf4';
      statusEl.style.border     = '1px solid ' + (type === 'error' ? '#fecaca' : '#bbf7d0');
      statusEl.style.color      = type === 'error' ? '#dc2626' : '#15803d';
      statusEl.textContent      = msg;
    }

    dlBtn.addEventListener('click', async function() {
      if (dlBtn.disabled) return;

      // ---- Route through Review & Patch screen ----
      var resolvedCaseId = caseId;
      if (!resolvedCaseId) {
        var hm = window.location.hash.match(/case[s]?\/([0-9]+)/);
        resolvedCaseId = hm ? hm[1] : '1';
      }

      // Close the export overlay so Review & Patch can take the screen
      if (overlay && overlay.parentNode) overlay.remove();

      if (typeof window.__hp_showReviewPatch === 'function') {
        window.__hp_showReviewPatch({
          caseId:    resolvedCaseId,
          formType:  pdfKey,
          pdfKey:    pdfKey,
          formLabel: label,
          onDownload: async function(patches) {
            // After user saves patches, do the actual download
            try {
              var resp = await fetch(RAILWAY_EP + '/api/cases/' + resolvedCaseId + '/official-pdf/' + pdfKey, {
                method: 'POST',
                headers: __authHdr()
              });
              if (resp.status === 403) {
                if (typeof showUpgradeModal === 'function') showUpgradeModal('pdf');
                return;
              }
              if (!resp.ok) {
                alert('Could not generate PDF. Please try again.');
                return;
              }
              var blob = await resp.blob();
              var url  = URL.createObjectURL(blob);
              var a    = document.createElement('a');
              a.href     = url;
              a.download = await window.__hp_scjFilename(label, resolvedCaseId, 'Applicant');
              document.body.appendChild(a);
              a.click();
              setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 3000);
            } catch(err) {
              console.warn('[hp-export] Download error:', err);
              alert('Network error. Please try again.');
            }
          }
        });
        return;
      }

      // ---- Fallback: direct download if Review & Patch not available ----
      dlBtn.disabled    = true;
      dlBtn.textContent = 'Generating PDF\u2026';
      statusEl.style.display = 'none';
      try {
        var resp2 = await fetch(RAILWAY_EP + '/api/cases/' + resolvedCaseId + '/official-pdf/' + pdfKey, {
          method: 'POST',
          headers: __authHdr()
        });
        if (resp2.status === 403) {
          if (typeof showUpgradeModal === 'function') showUpgradeModal('pdf');
          dlBtn.disabled    = false;
          dlBtn.textContent = 'Download Official Court PDF';
          return;
        }
        if (!resp2.ok) {
          showStatus('Could not generate PDF. Please try again.', 'error');
          dlBtn.disabled    = false;
          dlBtn.textContent = 'Download Official Court PDF';
          return;
        }
        var blob2 = await resp2.blob();
        var url2  = URL.createObjectURL(blob2);
        var a2    = document.createElement('a');
        a2.href     = url2;
        a2.download = await window.__hp_scjFilename(label, resolvedCaseId, 'Applicant');
        document.body.appendChild(a2);
        a2.click();
        setTimeout(function() { URL.revokeObjectURL(url2); a2.remove(); }, 3000);
        showStatus('\u2713 Your PDF has been downloaded!', 'success');
        dlBtn.textContent = '\u2713 Downloaded';
        setTimeout(function() {
          dlBtn.disabled    = false;
          dlBtn.textContent = 'Download Official Court PDF';
        }, 4000);
      } catch(err2) {
        console.warn('[hp-export] Download error:', err2);
        showStatus('Network error. Please try again.', 'error');
        dlBtn.disabled    = false;
        dlBtn.textContent = 'Download Official Court PDF';
      }
    });

    // ---- Email button ----
    var emailBtn2 = document.getElementById('hp-ep-email');
    if (emailBtn2) {
      emailBtn2.addEventListener('click', async function() {
        if (emailBtn2.disabled) return;
        emailBtn2.disabled    = true;
        emailBtn2.textContent = 'Sending\u2026';
        var resolvedCaseId2 = caseId;
        if (!resolvedCaseId2) {
          var hm2 = window.location.hash.match(/case[s]?\/([0-9]+)/);
          resolvedCaseId2 = hm2 ? hm2[1] : '1';
        }
        window.__hp_currentCaseId = resolvedCaseId2;
        if (!userEmail && window.__hp_currentUser) userEmail = window.__hp_currentUser.email;
        if (!userEmail) {
          var me = await fetch(RAILWAY_EP + '/api/auth/me', { headers: __authHdr() })
            .then(function(r){ return r.json(); }).catch(function(){ return null; });
          userEmail = (me && (me.user && me.user.email || me.email)) || null;
        }
        if (!userEmail) {
          emailBtn2.textContent = 'No email on account';
          emailBtn2.disabled    = false;
          return;
        }
        var ok = await window.__emailPDF_real(null, pdfKey + '.pdf', userEmail, label);
        if (ok) {
          emailBtn2.textContent = '\u2713 Sent to ' + userEmail;
          setTimeout(function() { emailBtn2.textContent = 'Email me this PDF'; emailBtn2.disabled = false; }, 5000);
        } else {
          emailBtn2.textContent = 'Failed \u2014 try again';
          emailBtn2.disabled    = false;
        }
      });
    }
  };
})();


// ─── Phone number auto-format ─────────────────────────────────────────────────
// Formats as (416) 555-0123 while user types
(function() {
  function formatPhone(raw) {
    var digits = raw.replace(/\D/g, '');
    digits = digits.slice(0, 10);
    if (digits.length === 0) return '';
    if (digits.length <= 3) return '(' + digits;
    if (digits.length <= 6) return '(' + digits.slice(0,3) + ') ' + digits.slice(3);
    return '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
  }

  // Helper: trigger React's synthetic onChange on a controlled input
  function triggerReactChange(input, value) {
    // React tracks the last value set — we must use the native setter to bypass it
    var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSet.call(input, value);
    // Dispatch both input and change so React picks it up regardless of version
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function attachPhoneFormat(input) {
    if (input.__hpPhoneAttached) return;
    input.__hpPhoneAttached = true;
    // On each keystroke: only update the visual display locally (native setter)
    // Do NOT trigger React change here — partial values like "(22" would get saved to DB mid-type
    input.addEventListener('input', function() {
      if (input.__hpFormatting) return; // prevent re-entry
      input.__hpFormatting = true;
      var pos = input.selectionStart;
      var oldLen = input.value.length;
      var formatted = formatPhone(input.value);
      var newLen = formatted.length;
      var newPos = Math.max(0, pos + (newLen - oldLen));
      // Use native setter only (no React event) so no save is triggered mid-typing
      var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSet.call(input, formatted);
      try { input.setSelectionRange(newPos, newPos); } catch(e) {}
      input.__hpFormatting = false;
    });
    // On blur: now trigger React change with the final formatted value
    input.addEventListener('blur', function() {
      var formatted = formatPhone(input.value);
      if (input.value !== formatted) {
        triggerReactChange(input, formatted);
      } else {
        // Even if already formatted, trigger React so it registers the final value
        triggerReactChange(input, formatted);
      }
    });
  }

  function scanPhoneInputs() {
    // Match by type=tel, id/name/data-testid containing "phone" or "mobile" or "tel"
    var candidates = document.querySelectorAll(
      'input[type="tel"], input[id*="phone" i], input[name*="phone" i], ' +
      'input[placeholder*="phone" i], input[id*="mobile" i], input[name*="mobile" i], ' +
      'input[data-testid*="phone" i], input[data-testid*="mobile" i], input[data-testid*="tel" i]'
    );
    for (var i = 0; i < candidates.length; i++) attachPhoneFormat(candidates[i]);
  }

  // Run immediately
  scanPhoneInputs();

  // MutationObserver for dynamically added inputs
  var phoneObs = new MutationObserver(function() { scanPhoneInputs(); });
  function startPhoneObs() {
    if (document.body) phoneObs.observe(document.body, {childList: true, subtree: true});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPhoneObs);
  } else {
    startPhoneObs();
  }

  // Fallback interval — React renders async so MutationObserver can miss the exact moment
  var _scanCount = 0;
  var _interval = setInterval(function() {
    scanPhoneInputs();
    _scanCount++;
    if (_scanCount >= 30) clearInterval(_interval); // stop after 30s
  }, 1000);
})();

// ─── Required field validation scroll ────────────────────────────────────────
// Scroll to first invalid field on form submit / Next button click
(function() {
  var style = document.createElement('style');
  style.textContent = [
    '@keyframes hp-field-pulse {',
    '  0%   { box-shadow: 0 0 0 0 rgba(123,45,62,0.6); }',
    '  60%  { box-shadow: 0 0 0 8px rgba(123,45,62,0); }',
    '  100% { box-shadow: 0 0 0 0 rgba(123,45,62,0); }',
    '}',
    '.hp-field-error {',
    '  border-color: #1E2D4E !important;',
    '  animation: hp-field-pulse 0.7s ease-out 2;',
    '}'
  ].join('\n');
  document.head.appendChild(style);

  function scrollToFirstInvalid() {
    var invalid = document.querySelectorAll('input:invalid, select:invalid, textarea:invalid');
    for (var i = 0; i < invalid.length; i++) {
      var el = invalid[i];
      if (el.offsetParent === null) continue;
      el.classList.add('hp-field-error');
      el.scrollIntoView({behavior: 'smooth', block: 'center'});
      el.focus();
      setTimeout(function(e) { e.classList.remove('hp-field-error'); }, 1800, el);
      return true;
    }
    return false;
  }

  document.addEventListener('submit', function() {
    setTimeout(function() {
      if (document.querySelector('input:invalid, select:invalid, textarea:invalid')) {
        scrollToFirstInvalid();
      }
    }, 50);
  }, true);

  document.addEventListener('click', function(e) {
    var el = e.target;
    if (!el || el.tagName !== 'BUTTON') return;
    var txt = (el.textContent || '').trim().toLowerCase();
    var isActionBtn = (el.type === 'submit' ||
      ['next', 'continue', 'submit', 'save'].some(function(k) { return txt.indexOf(k) !== -1; }));
    if (!isActionBtn) return;
    setTimeout(function() {
      if (document.querySelector('input:invalid, select:invalid, textarea:invalid')) {
        scrollToFirstInvalid();
      }
    }, 100);
  }, true);

  window.__hp_scrollToFirstError = scrollToFirstInvalid;
})();

// ─── Email auto-populate ──────────────────────────────────────────────────────
// When the user reaches the "About you" step, auto-fill the email field
// with their account email if it's empty — they're already logged in,
// no reason to make them type it again.
(function() {
  function triggerReactChange(input, value) {
    var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSet.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function tryAutoFillEmail() {
    // Only run in the wizard (#/case/*/wizard)
    if (!window.location.hash.includes('wizard')) return;

    var userEmail = (window.__hp_user && window.__hp_user.email) || null;
    if (!userEmail) return; // not logged in yet

    // Find the email input that belongs to "About you" / applicant section
    // It has id="field-email" or type=email and is NOT in a lawyer section
    var emailInputs = document.querySelectorAll('input[type="email"]');
    for (var i = 0; i < emailInputs.length; i++) {
      var el = emailInputs[i];
      if (el.value && el.value.trim() !== '') continue; // already filled
      if (el.__hpEmailFilled) continue; // already auto-filled by us

      // Only fill the applicant's own email, not a lawyer's email field
      // Check label text nearby
      var labelEl = document.querySelector('label[for="' + el.id + '"]') ||
                    el.closest('[class*="field"]')?.querySelector('label');
      var labelTxt = (labelEl ? labelEl.innerText : '').toLowerCase();
      if (labelTxt.includes('lawyer') || labelTxt.includes('representative')) continue;

      el.__hpEmailFilled = true;
      triggerReactChange(el, userEmail);
    }
  }

  // Run on a short interval so it catches when the step renders
  var emailFillInterval = setInterval(tryAutoFillEmail, 800);
  // Stop after 5 minutes
  setTimeout(function() { clearInterval(emailFillInterval); }, 300000);

  // Also run when hash changes (user navigates between steps)
  window.addEventListener('hashchange', function() {
    // Reset filled flags so re-navigation re-triggers
    document.querySelectorAll('input[type="email"]').forEach(function(el) {
      el.__hpEmailFilled = false;
    });
    setTimeout(tryAutoFillEmail, 500);
  });
})();

// ─── Block auto-complete status change ───────────────────────────────────────
// The bundle marks a case "complete" when the user clicks "Generate my forms".
// This permanently switches the dashboard card from "Continue" to "Download PDF"
// with no way back. We intercept that specific PATCH and downgrade it to
// "in_progress" so the case always stays resumable.
(function() {
  var _originalFetch = window.fetch;
  window.fetch = function(url, opts) {
    try {
      if (opts && opts.method === 'PATCH' && typeof url === 'string' && url.includes('/api/cases/')) {
        var body = opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : {};
        if (body.status === 'complete') {
          // Replace with in_progress so the case stays resumable
          opts = Object.assign({}, opts, { body: JSON.stringify(Object.assign({}, body, { status: 'in_progress' })) });
        }
      }
    } catch(e) {}
    return _originalFetch.apply(this, arguments);
  };
})();


// ─── Form 17A Coming Soon Card Injector ───────────────────────────────────────
(function() {
  var INJECTED_ID = 'hp-form17a-coming-soon';

  function injectForm17ACard() {
    // Don't inject twice
    if (document.getElementById(INJECTED_ID)) return;

    // Find the Form 17F card (last Form 17-series card) - we inject after it
    var allFormBtns = document.querySelectorAll('[data-testid^="button-form-"]');
    var form17fBtn = null;
    var form17eBtn = null;
    var form17cBtn = null;

    allFormBtns.forEach(function(btn) {
      var tid = btn.getAttribute('data-testid');
      if (tid === 'button-form-form17f-confirmation-conference') form17fBtn = btn;
      if (tid === 'button-form-form17e-trial-mgmt-brief') form17eBtn = btn;
      if (tid === 'button-form-form17c-settlement-brief') form17cBtn = btn;
    });

    // Use the last available Form 17 sibling as anchor
    var anchor = form17fBtn || form17eBtn || form17cBtn;
    if (!anchor) return;

    // Build the coming-soon card matching the existing form card style
    var card = document.createElement('div');
    card.id = INJECTED_ID;
    card.style.cssText = [
      'width:100%',
      'text-align:left',
      'border-radius:0.75rem',
      'border:1px dashed rgba(30,45,78,0.45)',
      'padding:1.25rem',
      'background:rgba(27,65,80,0.08)',
      'opacity:0.75',
      'cursor:default',
      'user-select:none',
      'position:relative',
      'overflow:hidden'
    ].join(';');

    card.innerHTML = [
      '<div style="display:flex;align-items:flex-start;gap:1rem;">',
        // Lock icon column
        '<div style="flex-shrink:0;margin-top:0.125rem;">',
          '<div style="height:1.25rem;width:1.25rem;border-radius:9999px;border:2px solid rgba(30,45,78,0.50);display:flex;align-items:center;justify-content:center;">',
            '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="rgba(30,45,78,0.80)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">',
              '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>',
              '<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
            '</svg>',
          '</div>',
        '</div>',
        // Content column
        '<div style="flex:1;min-width:0;">',
          '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">',
            '<span style="display:inline-flex;align-items:center;border-radius:9999px;padding:0.125rem 0.625rem;font-size:0.75rem;font-weight:600;background:rgba(30,45,78,0.25);color:rgba(30,45,78,0.85);">Form 17A</span>',
            '<h3 style="font-family:\'Playfair Display\',serif;font-size:1rem;color:var(--foreground,#ede8df);margin:0;">Case Conference Brief</h3>',
            '<span style="display:inline-flex;align-items:center;gap:0.25rem;border-radius:9999px;padding:0.125rem 0.625rem;font-size:0.7rem;font-weight:500;background:rgba(246,173,85,0.15);color:rgba(246,173,85,0.85);border:1px solid rgba(246,173,85,0.25);">',
              '<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
              'Coming soon',
            '</span>',
          '</div>',
          '<p style="font-size:0.875rem;color:var(--muted-foreground,rgba(237,232,223,0.6));line-height:1.5;margin:0 0 0.5rem 0;">',
            'Required for every case conference. Each party prepares their own brief at least 7 days in advance, outlining the issues, background, and what orders they are asking the judge to consider.',
          '</p>',
          '<p style="font-size:0.75rem;color:rgba(30,45,78,0.80);margin:0;">',
            'Ontario currently provides this form as a Word document only — a fillable PDF version is coming soon.',
          '</p>',
        '</div>',
      '</div>'
    ].join('');

    // Insert after the anchor card
    if (anchor.nextSibling) {
      anchor.parentNode.insertBefore(card, anchor.nextSibling);
    } else {
      anchor.parentNode.appendChild(card);
    }
  }

  // Watch for DOM changes (React re-renders)
  var observer = new MutationObserver(function() {
    if (!document.getElementById(INJECTED_ID)) {
      injectForm17ACard();
    }
  });

  function startObserver() {
    observer.observe(document.body, { childList: true, subtree: true });
    injectForm17ACard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(startObserver, 400); });
  } else {
    setTimeout(startObserver, 400);
  }
})();

// ─── Add / Edit Forms on Existing Case ───────────────────────────────────────
(function() {

  // ── Full form catalogue (matches React bundle) ───────────────────────────
  var ALL_FORMS = [
    {id:'form8-general',      badge:'Form 8',    title:'Application (General)',                    tag:'Most cases start here'},
    {id:'form8a-divorce',     badge:'Form 8A',   title:'Application (Divorce)',                    tag:'Divorce proceedings'},
    {id:'form10-answer',      badge:'Form 10',   title:'Answer',                                   tag:'For Respondents'},
    {id:'form10a-reply',      badge:'Form 10A',  title:'Reply',                                    tag:'Reply to Answer/Cross'},
    {id:'form12-withdrawal',  badge:'Form 12',   title:'Notice of Withdrawal',                     tag:'Withdrawing a filed document'},
    {id:'form35-affidavit',   badge:'Form 35.1', title:'Parenting Affidavit',                      tag:'Required for parenting claims'},
    {id:'form36-divorce-affidavit', badge:'Form 36',  title:'Affidavit for Divorce',              tag:'Filed with Form 8A'},
    {id:'form36a-certificate-clerk-divorce', badge:'Form 36A', title:'Certificate of Clerk (Divorce)', tag:'Clerk certificate — divorce file'},
    {id:'form13-financial',          badge:'Form 13',   title:'Financial Statement (Support Claims)',  tag:'Required for support claims'},
    {id:'form13_1-financial-property',badge:'Form 13.1',title:'Financial Statement (Property & Support)',tag:'Property division & equalization'},
    {id:'form13b-net-family-property',badge:'Form 13B', title:'Net Family Property Statement',        tag:'Filed with Form 13.1'},
    {id:'form4-change-representation',badge:'Form 4',   title:'Change in Representation',             tag:'Changing your lawyer'},
    {id:'form6-acknowledgment-service',badge:'Form 6',  title:'Acknowledgment of Service',            tag:'Confirm you received documents'},
    {id:'form6b-service',     badge:'Form 6B',   title:'Affidavit of Service',                     tag:'Required after serving documents'},
    {id:'form6c-certificate-service',badge:'Form 6C',   title:'Certificate of Service',              tag:'Alternative proof of service'},
    {id:'form14-notice-of-motion',    badge:'Form 14',  title:'Notice of Motion',                    tag:'Temporary orders'},
    {id:'form14a-affidavit',          badge:'Form 14A', title:'Affidavit (General)',                  tag:'Supports motions'},
    {id:'form14b-motion',             badge:'Form 14B', title:'Motion Form (Procedural / Consent)',   tag:'Procedural & consent orders'},
    {id:'form14c-confirmation',       badge:'Form 14C', title:'Confirmation of Motion',              tag:'Due 3 days before motion'},
    {id:'form14d-costs',              badge:'Form 14D', title:'Offer to Settle',                     tag:'Settlement offers'},
    {id:'form15-motion-to-change',    badge:'Form 15',  title:'Motion to Change',                    tag:'Changing existing orders'},
    {id:'form15b-response-motion-change',badge:'Form 15B',title:'Response to Motion to Change',      tag:'Responding to a Motion to Change'},
    {id:'form15c-consent-motion-change',badge:'Form 15C',title:'Consent Motion to Change',           tag:'Agreed change to an order'},
    {id:'form15d-consent-child-support',badge:'Form 15D',title:'Consent Motion to Change Child Support',tag:'Child support change by consent'},
    {id:'form17-conference-notice',     badge:'Form 17', title:'Conference Notice',                  tag:'Conference scheduling'},
    {id:'form17c-settlement-brief',     badge:'Form 17C',title:'Settlement Conference Brief',        tag:'Required for settlement conference'},
    {id:'form17e-trial-mgmt-brief',     badge:'Form 17E',title:'Trial Management Conference Brief',  tag:'Required for trial management conference'},
    {id:'form17f-confirmation-conference',badge:'Form 17F',title:'Confirmation of Conference',      tag:'Due 3 business days before conference'},
    {id:'form36b-certificate-divorce',      badge:'Form 36B',title:'Certificate of Divorce',                tag:'Request after 31-day waiting period'},
    {id:'form23c-uncontested-trial',    badge:'Form 23C',title:'Affidavit for Uncontested Trial',   tag:'Uncontested / no response from other party'},
    {id:'form25-order-general',         badge:'Form 25', title:'Order (General)',                    tag:'General court order'},
    {id:'form25a-order-divorce',        badge:'Form 25A',title:'Order (Divorce)',                    tag:'Divorce order'},
    {id:'form25f-restraining-order-fla',  badge:'Form 25F', title:'Restraining Order',                    tag:'Protection from harassment or threats'},
    {id:'form25g-restraining-order-clra', badge:'Form 25G', title:'Emergency Restraining Order',             tag:'Urgent — no prior notice to respondent'},
    {id:'form34a-parentage',              badge:'Form 34A', title:'Affidavit of Parentage',                  tag:'Establishing legal parentage'},
    {id:'form37-notice-of-hearing',       badge:'Form 37',  title:'Notice of Hearing',                       tag:'Schedules a court hearing date'},
    {id:'form26-money-owed',            badge:'Form 26', title:'Statement of Money Owed',           tag:'Starting enforcement of support'},
    {id:'form26a-enforcement-expenses', badge:'Form 26A',title:'Affidavit of Enforcement Expenses', tag:'Claiming enforcement costs'},
    {id:'form27-request-financial-statement',badge:'Form 27',title:'Request for Financial Statement',tag:'Enforcement — financial disclosure'},
    {id:'form27a-request-income-statement',badge:'Form 27A',title:'Request for Statement of Income',tag:'Enforcement — employer/bank income request'},
    {id:'form29-request-garnishment',   badge:'Form 29', title:'Request for Garnishment',           tag:'Garnishing wages or bank accounts'},
    {id:'form30-default-hearing',       badge:'Form 30', title:'Notice of Default Hearing',         tag:'Payor in default of support order'},
    {id:'form30a-default-hearing',     badge:'Form 30A', title:'Request for Default Hearing',         tag:'Enforce missed support payments'},
  ];

  // ── CSS injected once ─────────────────────────────────────────────────────
  var STYLE_ID = 'hp-edit-forms-style';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#hp-ef-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;}',
      '@media(min-width:640px){#hp-ef-overlay{align-items:center;}}',
      '#hp-ef-sheet{width:100%;max-width:580px;max-height:92vh;background:#0d1520;border:1px solid rgba(255,255,255,0.08);border-radius:1.25rem 1.25rem 0 0;display:flex;flex-direction:column;overflow:hidden;animation:hp-ef-slidein 0.22s cubic-bezier(0.32,0.72,0,1);}',
      '@media(min-width:640px){#hp-ef-sheet{border-radius:1.25rem;}}',
      '@keyframes hp-ef-slidein{from{transform:translateY(24px);opacity:0;}to{transform:translateY(0);opacity:1;}}',
      '#hp-ef-header{padding:1.25rem 1.25rem 1rem;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;}',
      '#hp-ef-search{width:100%;background:#0d1520;border:1px solid rgba(255,255,255,0.1);border-radius:0.625rem;padding:0.625rem 0.875rem;color:#ede8df;font-size:0.875rem;outline:none;margin-top:0.75rem;font-family:DM Sans,system-ui,sans-serif;}',
      '#hp-ef-search::placeholder{color:rgba(237,232,223,0.35);}',
      '#hp-ef-search:focus{border-color:rgba(30,45,78,0.70);}',
      '#hp-ef-list{flex:1;overflow-y:auto;padding:0.75rem 1rem;}',
      '.hp-ef-row{display:flex;align-items:flex-start;gap:0.75rem;padding:0.75rem 0.875rem;border-radius:0.625rem;border:1px solid rgba(255,255,255,0.07);background:#0d1520;margin-bottom:0.5rem;cursor:pointer;transition:border-color 0.12s,background 0.12s;}',
      '.hp-ef-row:hover{border-color:rgba(30,45,78,0.50);background:rgba(30,45,78,0.12);}',
      '.hp-ef-row.selected{border-color:rgba(30,45,78,0.80);background:rgba(30,45,78,0.18);}',
      '.hp-ef-row.current{border-color:rgba(30,45,78,0.45);background:rgba(30,45,78,0.10);cursor:default;}',
      '.hp-ef-check{width:1.125rem;height:1.125rem;border-radius:0.25rem;border:2px solid rgba(237,232,223,0.25);flex-shrink:0;margin-top:0.125rem;display:flex;align-items:center;justify-content:center;transition:border-color 0.12s,background 0.12s;}',
      '.hp-ef-row.selected .hp-ef-check,.hp-ef-row.current .hp-ef-check{background:#A8B4D0;border-color:#A8B4D0;}',
      '.hp-ef-badge{display:inline-flex;align-items:center;border-radius:9999px;padding:0.1rem 0.5rem;font-size:0.7rem;font-weight:600;background:rgba(168,180,208,0.20);color:rgba(237,232,223,0.90);margin-bottom:0.25rem;}',
      '.hp-ef-row.selected .hp-ef-badge,.hp-ef-row.current .hp-ef-badge{background:rgba(168,180,208,0.30);color:#ede8df;}',
      '#hp-ef-footer{padding:1rem 1.25rem;border-top:1px solid rgba(255,255,255,0.07);flex-shrink:0;display:flex;gap:0.625rem;}',
      '#hp-ef-save{flex:1;background:#A8B4D0;color:#fff;border:none;border-radius:0.625rem;padding:0.75rem 1rem;font-size:0.9375rem;font-weight:600;cursor:pointer;font-family:DM Sans,system-ui,sans-serif;transition:background 0.12s;}',
      '#hp-ef-save:hover{background:#1E2D4E;}',
      '#hp-ef-save:disabled{opacity:0.5;cursor:default;}',
      '#hp-ef-cancel{background:transparent;color:rgba(237,232,223,0.6);border:1px solid rgba(255,255,255,0.1);border-radius:0.625rem;padding:0.75rem 1rem;font-size:0.9375rem;cursor:pointer;font-family:DM Sans,system-ui,sans-serif;transition:background 0.12s;}',
      '#hp-ef-cancel:hover{background:rgba(255,255,255,0.05);}',
      '.hp-ef-current-tag{font-size:0.65rem;color:#ede8df;font-weight:600;margin-left:0.25rem;opacity:0.95;}',
      '.hp-ef-addbtn{display:inline-flex;align-items:center;gap:0.25rem;padding:0.25rem 0.625rem;border-radius:6px;border:1px solid rgba(30,45,78,0.50);background:transparent;color:rgba(30,45,78,0.90);font-size:0.75rem;font-weight:500;cursor:pointer;font-family:DM Sans,system-ui,sans-serif;transition:background 0.12s,border-color 0.12s;white-space:nowrap;}',
      '.hp-ef-addbtn:hover{background:rgba(30,45,78,0.25);border-color:rgba(30,45,78,0.80);}',
      '#hp-ef-saving-msg{font-size:0.8rem;color:rgba(30,45,78,0.90);text-align:center;padding:0.25rem 0;display:none;}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Open the modal for a specific case ────────────────────────────────────
  window.openEditForms = function openEditForms(caseId, currentTypeStr) {
    injectStyle();

    var currentSet = new Set(
      (currentTypeStr || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean)
    );
    var selectedSet = new Set(currentSet); // starts as copy of current
    var searchVal = '';

    // ── Build overlay ──────────────────────────────────────────────────────
    var overlay = document.createElement('div');
    overlay.id = 'hp-ef-overlay';

    overlay.innerHTML = [
      '<div id="hp-ef-sheet">',
        '<div id="hp-ef-header">',
          '<div style="display:flex;align-items:center;justify-content:space-between;">',
            '<div>',
              '<h2 style="font-family:\'Playfair Display\',serif;font-size:1.125rem;color:#ede8df;margin:0 0 0.125rem;">Add or Remove Forms</h2>',
              '<p style="font-size:0.8rem;color:rgba(237,232,223,0.5);margin:0;">Currently checked forms are on your case. Tick new ones to add them.</p>',
            '</div>',
            '<button id="hp-ef-x" style="background:transparent;border:none;color:rgba(237,232,223,0.5);cursor:pointer;padding:0.25rem;line-height:1;" aria-label="Close">',
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
            '</button>',
          '</div>',
          '<input id="hp-ef-search" type="text" placeholder="Search forms — e.g. \'divorce\' or \'Form 13\'" autocomplete="off" />',
        '</div>',
        '<div id="hp-ef-list"></div>',
        '<div id="hp-ef-footer">',
          '<button id="hp-ef-cancel">Cancel</button>',
          '<button id="hp-ef-save">Save Changes</button>',
        '</div>',
        '<div id="hp-ef-saving-msg">Saving…</div>',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);

    // ── Render list ────────────────────────────────────────────────────────
    function renderList() {
      var list = document.getElementById('hp-ef-list');
      if (!list) return;
      var q = searchVal.toLowerCase().trim();
      var filtered = ALL_FORMS.filter(function(f) {
        if (!q) return true;
        return f.badge.toLowerCase().includes(q) || f.title.toLowerCase().includes(q) || f.tag.toLowerCase().includes(q);
      });

      list.innerHTML = filtered.map(function(f) {
        var isCurrent = currentSet.has(f.id);
        var isSelected = selectedSet.has(f.id);
        var cls = 'hp-ef-row' + (isCurrent ? ' current' : '') + (isSelected ? ' selected' : '');
        var checkMark = (isSelected || isCurrent)
          ? '<svg width="11" height="11" viewBox="0 0 10 8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4l3 3 5-6"/></svg>'
          : '';
        var currentTag = isCurrent ? '<span class="hp-ef-current-tag">on your case</span>' : '';
        return [
          '<div class="'+cls+'" data-id="'+f.id+'" data-current="'+(isCurrent?'1':'0')+'">',
            '<div class="hp-ef-check">'+checkMark+'</div>',
            '<div style="flex:1;min-width:0;">',
              '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.375rem;margin-bottom:0.2rem;">',
                '<span class="hp-ef-badge">'+f.badge+'</span>',
                currentTag,
              '</div>',
              '<div style="font-size:0.875rem;font-weight:500;color:#ede8df;font-family:\'Playfair Display\',serif;">'+f.title+'</div>',
              '<div style="font-size:0.75rem;color:rgba(237,232,223,0.70);margin-top:0.125rem;">'+f.tag+'</div>',
            '</div>',
          '</div>'
        ].join('');
      }).join('');

      // Attach click handlers
      list.querySelectorAll('.hp-ef-row').forEach(function(row) {
        row.addEventListener('click', function() {
          var id = row.getAttribute('data-id');
          if (selectedSet.has(id)) {
            selectedSet.delete(id);
          } else {
            selectedSet.add(id);
          }
          renderList();
          updateSaveBtn();
        });
      });
    }

    function updateSaveBtn() {
      var btn = document.getElementById('hp-ef-save');
      if (!btn) return;
      // Count newly added forms (not in current)
      var added = 0;
      selectedSet.forEach(function(id) { if (!currentSet.has(id)) added++; });
      // Count removed forms (were current, now unchecked)
      var removed = 0;
      currentSet.forEach(function(id) { if (!selectedSet.has(id)) removed++; });

      if (added === 0 && removed === 0) {
        btn.textContent = 'No Changes';
        btn.disabled = true;
      } else {
        var parts = [];
        if (added > 0) parts.push('Add ' + added + ' form' + (added > 1 ? 's' : ''));
        if (removed > 0) parts.push('Remove ' + removed);
        btn.textContent = parts.join(' · ');
        btn.disabled = false;
      }
    }

    renderList();
    updateSaveBtn();

    // ── Search ─────────────────────────────────────────────────────────────
    var searchEl = document.getElementById('hp-ef-search');
    if (searchEl) {
      searchEl.addEventListener('input', function() {
        searchVal = searchEl.value;
        renderList();
      });
    }

    // ── Close ──────────────────────────────────────────────────────────────
    function closeModal() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    document.getElementById('hp-ef-x').addEventListener('click', closeModal);
    document.getElementById('hp-ef-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    // ── Save ───────────────────────────────────────────────────────────────
    document.getElementById('hp-ef-save').addEventListener('click', function() {
      var newType = Array.from(selectedSet).join(',');
      var saveBtn = document.getElementById('hp-ef-save');
      var savingMsg = document.getElementById('hp-ef-saving-msg');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      if (savingMsg) savingMsg.style.display = 'block';

      var _RAILWAY = 'https://api-production-2334.up.railway.app';
      fetch(_RAILWAY + '/api/cases/' + caseId, {
        method: 'PATCH',
        headers: __authHdr(),
        body: JSON.stringify({ caseType: newType })
      })
      .then(function(r) {
        if (!r.ok) throw new Error('Server error ' + r.status);
        return r.json();
      })
      .then(function() {
        closeModal();
        // Trigger React to re-fetch cases by reloading the page data
        // Dispatch a custom event that React's query client might pick up,
        // and fall back to a soft reload
        try {
          window.dispatchEvent(new CustomEvent('hp:casesChanged'));
        } catch(e) {}
        // Soft reload: just reload the page staying on dashboard
        setTimeout(function() {
          window.location.reload();
        }, 120);
      })
      .catch(function() {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Error — Try Again';
        if (savingMsg) savingMsg.style.display = 'none';
      });
    });
  }

  // ── Inject "+ Add Forms" button on each case card ─────────────────────────
  var ATTR = 'data-hp-ef-injected';

  function injectButtons() {
    // Find all case cards by data-testid pattern
    var cards = document.querySelectorAll('[data-testid^="card-case-"]');
    cards.forEach(function(card) {
      if (card.getAttribute(ATTR)) return; // already done
      var testId = card.getAttribute('data-testid'); // e.g. card-case-3
      var caseId = testId.replace('card-case-', '');

      // Find the delete button — we’ll insert our button right before it
      var deleteBtn = card.querySelector('[data-testid="button-delete-' + caseId + '"]');
      if (!deleteBtn) return;

      // Read caseType from the "Form X + Form Y" label text on the card
      // It's stored in the badge next to the completion badge — or we can read from
      // the data attribute we’ll attach
      card.setAttribute(ATTR, '1');

      // Build the button
      var addBtn = document.createElement('button');
      addBtn.className = 'hp-ef-addbtn';
      addBtn.setAttribute('data-testid', 'button-add-forms-' + caseId);
      addBtn.setAttribute('title', 'Add or remove forms on this case');
      addBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Forms';

      addBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        // Fetch the case to get its current caseType
        fetch('https://api-production-2334.up.railway.app/api/cases', { headers: __authHdr() })
          .then(function(r) { return r.json(); })
          .then(function(cases) {
            var thisCase = cases.find(function(c) { return String(c.id) === String(caseId); });
            var currentType = thisCase ? (thisCase.caseType || '') : '';
            openEditForms(caseId, currentType);
          })
          .catch(function() {
            openEditForms(caseId, '');
          });
      });

      // Insert before the delete button
      deleteBtn.parentNode.insertBefore(addBtn, deleteBtn);
    });
  }

  // ── Watch for React renders ───────────────────────────────────────────────
  var observer = new MutationObserver(function() {
    injectButtons();
  });

  function init() {
    observer.observe(document.body, { childList: true, subtree: true });
    injectButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 500); });
  } else {
    setTimeout(init, 500);
  }

})();


// ─── Fix 2: Correct pricing page form count text ──────────────────────────────
(function() {
  var STYLE_ID = 'hp-pricing-fix-style';

  // We can’t change the React bundle text directly, so we inject a MutationObserver
  // that rewrites specific text nodes on the subscription/pricing page
  var TARGET_PHRASES = {
    'Form 8, 35.1, 13 wizards': 'All 35 Ontario court forms',
    'All Free features': 'All Free features'   // keep this one
  };

  function fixPricingText() {
    // Only run on the subscription page
    var hash = window.location.hash || '';
    if (!hash.includes('/subscription') && !hash.includes('/pricing')) return;

    // Walk text nodes and replace
    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    var node;
    while ((node = walker.nextNode())) {
      var val = node.nodeValue;
      if (val && val.includes('Form 8, 35.1, 13 wizards')) {
        node.nodeValue = val.replace('Form 8, 35.1, 13 wizards', 'All 35 Ontario court forms');
      }
    }
  }

  window.addEventListener('hashchange', function() {
    setTimeout(fixPricingText, 400);
  });

  setTimeout(fixPricingText, 800);

  var pricingObserver = new MutationObserver(function() {
    var hash = window.location.hash || '';
    if (hash.includes('/subscription') || hash.includes('/pricing')) {
      fixPricingText();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      pricingObserver.observe(document.body, { childList: true, subtree: true });
      setTimeout(fixPricingText, 800);
    });
  } else {
    pricingObserver.observe(document.body, { childList: true, subtree: true });
    setTimeout(fixPricingText, 800);
  }
})();

// ─── Fix 3: Add Forms button also inside the wizard (inside an open case) ────
(function() {
  var INJECTED_ATTR = 'data-hp-wiz-ef-injected';
  var STYLE_ID = 'hp-wiz-ef-style';

  function injectWizardStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.hp-wiz-addbtn{display:inline-flex;align-items:center;gap:0.35rem;padding:0.375rem 0.75rem;border-radius:8px;border:1px solid rgba(30,45,78,0.50);background:transparent;color:rgba(30,45,78,0.90);font-size:0.8rem;font-weight:500;cursor:pointer;font-family:DM Sans,system-ui,sans-serif;transition:background 0.12s,border-color 0.12s;white-space:nowrap;text-decoration:none;}',
      '.hp-wiz-addbtn:hover{background:rgba(30,45,78,0.25);border-color:rgba(30,45,78,0.80);}',
      '#hp-wiz-addforms-bar{position:fixed;bottom:0;left:0;right:0;z-index:9998;display:flex;justify-content:center;padding:0.625rem 1rem;pointer-events:none;}',
      '#hp-wiz-addforms-bar .hp-wiz-addbtn{pointer-events:all;box-shadow:0 2px 12px rgba(0,0,0,0.35);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);background:rgba(27,65,80,0.92);border-color:rgba(30,45,78,0.60);color:#ede8df;}',
      '#hp-wiz-addforms-bar .hp-wiz-addbtn:hover{background:rgba(30,45,78,0.95);}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function getCaseIdFromHash() {
    var hash = window.location.hash || '';
    var m = hash.match(/case[s]?\/([0-9]+)/);
    return m ? m[1] : null;
  }

  function isWizardPage() {
    var hash = window.location.hash || '';
    return hash.includes('/wizard');
  }

  function injectWizardAddFormsBtn() {
    var existing = document.getElementById('hp-wiz-addforms-bar');

    if (!isWizardPage()) {
      // Remove bar if we navigated away from wizard
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    var caseId = getCaseIdFromHash();
    if (!caseId) return;

    if (existing) return; // already injected

    injectWizardStyle();

    var bar = document.createElement('div');
    bar.id = 'hp-wiz-addforms-bar';

    var btn = document.createElement('button');
    btn.className = 'hp-wiz-addbtn';
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add / Remove Forms';

    btn.addEventListener('click', function() {
      // Fetch cases to get current caseType
      fetch('https://api-production-2334.up.railway.app/api/cases', { headers: __authHdr() })
        .then(function(r) { return r.json(); })
        .then(function(cases) {
          var thisCase = cases.find(function(c) { return String(c.id) === String(caseId); });
          var currentType = thisCase ? (thisCase.caseType || '') : '';
          // openEditForms is exposed globally from the Add/Edit Forms IIFE above
          if (typeof window.openEditForms === 'function') {
            window.openEditForms(caseId, currentType);
          }
        })
        .catch(function() {
          if (typeof window.openEditForms === 'function') window.openEditForms(caseId, '');
        });
    });

    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  // Watch for navigation to/from wizard
  window.addEventListener('hashchange', function() {
    setTimeout(injectWizardAddFormsBtn, 300);
  });

  var wizObserver = new MutationObserver(function() {
    if (isWizardPage() && !document.getElementById('hp-wiz-addforms-bar')) {
      injectWizardAddFormsBtn();
    } else if (!isWizardPage() && document.getElementById('hp-wiz-addforms-bar')) {
      var bar = document.getElementById('hp-wiz-addforms-bar');
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    }
  });

  function initWiz() {
    wizObserver.observe(document.body, { childList: true, subtree: true });
    injectWizardAddFormsBtn();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(initWiz, 600); });
  } else {
    setTimeout(initWiz, 600);
  }
})();

// ─── Safety Overlay (shield icon in navbar calls window.__openSafetyOverlay) ──
(function() {
  var _RW = 'https://api-production-2334.up.railway.app';

  function makeResourceCard(number, label, desc, href, isUrgent) {
    var borderColor = isUrgent ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.07)';
    var numColor = isUrgent ? 'rgba(239,68,68,0.9)' : '#7EB8F7';
    return [
      '<a href="'+href+'" style="display:flex;align-items:flex-start;gap:0.75rem;padding:0.875rem;border-radius:0.625rem;border:1px solid '+borderColor+';background:#0d1520;text-decoration:none;margin-bottom:0.5rem;">',
        '<div style="flex:1;min-width:0;">',
          '<p style="font-size:0.875rem;font-weight:600;color:#ede8df;margin:0 0 0.125rem;">'+label+'</p>',
          '<p style="font-size:0.9375rem;font-weight:700;color:'+numColor+';margin:0 0 0.125rem;">'+number+'</p>',
          '<p style="font-size:0.75rem;color:rgba(237,232,223,0.5);margin:0;">'+desc+'</p>',
        '</div>',
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(237,232,223,0.3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:0.25rem;"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
      '</a>'
    ].join('');
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function openSafetyOverlay() {
    if (document.getElementById('hp-safety-overlay')) return;

    // Inject slide-in animation if not already present
    if (!document.getElementById('hp-safety-anim-style')) {
      var anim = document.createElement('style');
      anim.id = 'hp-safety-anim-style';
      anim.textContent = '@keyframes hp-sft-slidein{from{transform:translateY(32px);opacity:0;}to{transform:translateY(0);opacity:1;}}';
      document.head.appendChild(anim);
    }

    var overlay = document.createElement('div');
    overlay.id = 'hp-safety-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;';

    var sheet = document.createElement('div');
    sheet.style.cssText = 'width:100%;max-width:540px;background:#0d1520;border:1px solid rgba(255,255,255,0.08);border-radius:1.25rem 1.25rem 0 0;overflow-y:auto;max-height:88vh;animation:hp-sft-slidein 0.22s cubic-bezier(0.32,0.72,0,1);';

    sheet.innerHTML = [
      // Header
      '<div style="padding:1.25rem 1.25rem 0.75rem;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#0d1520;z-index:1;">',
        '<div>',
          '<h2 style="font-family:Playfair Display,serif;font-size:1.125rem;color:#ede8df;margin:0 0 0.2rem;">Safety & Emergency</h2>',
          '<p style="font-size:0.78rem;color:rgba(237,232,223,0.5);margin:0;">Resources and your personal silent alert</p>',
        '</div>',
        '<button id="hp-safety-close" style="background:rgba(255,255,255,0.06);border:none;color:rgba(237,232,223,0.7);cursor:pointer;padding:0.5rem;border-radius:8px;display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;" aria-label="Close">',
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        '</button>',
      '</div>',
      // Tabs
      '<div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.07);">',
        '<button id="hp-sft-tab-resources" data-tab="resources" style="flex:1;padding:0.75rem;font-size:0.8125rem;font-weight:600;font-family:DM Sans,system-ui,sans-serif;background:transparent;border:none;border-bottom:2px solid #A8B4D0;cursor:pointer;color:#ede8df;min-height:44px;">Helplines</button>',
        '<button id="hp-sft-tab-alert" data-tab="alert" style="flex:1;padding:0.75rem;font-size:0.8125rem;font-weight:500;font-family:DM Sans,system-ui,sans-serif;background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;color:rgba(237,232,223,0.5);min-height:44px;">Safe Word Alert</button>',
      '</div>',
      // Helplines panel
      '<div id="hp-sft-panel-resources" style="padding:1rem 1.25rem 1.5rem;">',
        makeResourceCard('911','Emergency','Call immediately if you or your children are in danger','tel:911',true),
        makeResourceCard('1-866-863-0511','Assaulted Women\u2019s Helpline','24/7, all languages, anonymous, TTY available','tel:18668630511',false),
        makeResourceCard('1-800-668-6868','Kids Help Phone','24/7 support for youth','tel:18006686868',false),
        makeResourceCard('sheltersafe.ca','Sheltersafe.ca','Find emergency shelter near you','https://sheltersafe.ca',false),
        makeResourceCard('1-888-579-2888','Victim Crisis Assistance','24/7 Ontario crisis support line','tel:18885792888',false),
        // Men's Resources Section
        '<div style="margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid rgba(255,255,255,0.08);">',
          '<p style="font-size:0.7rem;font-weight:700;color:rgba(168,180,208,0.7);text-transform:uppercase;letter-spacing:0.08em;margin:0 0 0.75rem;">Men\u2019s Resources</p>',
        '</div>',
        makeResourceCard('1-866-625-4357','Assaulted Men\u2019s Helpline','24/7, confidential, Ontario-wide crisis line for men experiencing abuse','tel:18666254357',false),
        makeResourceCard('1-866-531-2600','Connex Ontario','24/7 mental health, addiction and crisis referrals for men','tel:18665312600',false),
        makeResourceCard('416-766-3000','Canadian Centre for Men & Families','Counselling, advocacy and family court navigation for men \u2014 Toronto','tel:4167663000',false),
        makeResourceCard('1-800-668-8258','Legal Aid Ontario','Free and low-cost family law legal help','tel:18006688258',false),
        makeResourceCard('1-855-255-7256','Pro Bono Ontario','Free legal advice for self-represented litigants','tel:18552557256',false),
        makeResourceCard('1-833-456-4566','Talk Suicide Canada','24/7 crisis and suicide prevention line','tel:18334564566',false),
        makeResourceCard('211','211 Ontario','Dial 2-1-1 to be routed to any local men\u2019s support service','tel:211',false),
        '<div style="border-radius:0.75rem;border:1px solid rgba(30,45,78,0.28);background:rgba(30,45,78,0.12);padding:1rem;margin-top:0.5rem;">',
          '<p style="font-size:0.8125rem;color:#ede8df;line-height:1.6;margin:0;"><strong>You can also ask for an emergency court order</strong> \u2014 called a \u201cwithout notice\u201d or \u201cex parte\u201d motion \u2014 that keeps the other person away without them being told first. This app will help you with those forms.</p>',
        '</div>',
      '</div>',
      // Safe Word panel (hidden)
      '<div id="hp-sft-panel-alert" style="padding:1rem 1.25rem 1.5rem;display:none;">',
        // Code word
        '<p style="font-size:0.75rem;font-weight:600;color:rgba(237,232,223,0.6);text-transform:uppercase;letter-spacing:0.05em;margin:0 0 0.375rem;">Your Secret Code Word</p>',
        '<p style="font-size:0.8rem;color:rgba(237,232,223,0.5);line-height:1.5;margin:0 0 0.625rem;">Set a secret word. If you ever type it into any field in the app, a silent alert fires to your contacts without any visible sign on screen.</p>',
        '<div style="display:flex;gap:0.5rem;margin-bottom:0.375rem;">',
          '<input id="hp-sft-codeword-input" type="password" placeholder="Enter a secret word\u2026" autocomplete="new-password" style="flex:1;background:#0d1520;border:1px solid rgba(255,255,255,0.1);border-radius:0.5rem;padding:0.625rem 0.875rem;color:#ede8df;font-size:0.875rem;font-family:DM Sans,system-ui,sans-serif;outline:none;min-height:44px;" />',
          '<button id="hp-sft-codeword-save" style="background:#A8B4D0;color:#fff;border:none;border-radius:0.5rem;padding:0.625rem 1rem;font-size:0.875rem;font-weight:600;cursor:pointer;font-family:DM Sans,system-ui,sans-serif;white-space:nowrap;min-height:44px;">Save</button>',
        '</div>',
        '<p id="hp-sft-codeword-status" style="font-size:0.75rem;color:rgba(30,45,78,0.85);margin:0 0 1.25rem;min-height:1rem;"></p>',
        // Contacts
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.375rem;">',
          '<p style="font-size:0.75rem;font-weight:600;color:rgba(237,232,223,0.6);text-transform:uppercase;letter-spacing:0.05em;margin:0;">Alert Contacts</p>',
          '<button id="hp-sft-contact-add-btn" style="background:transparent;border:1px solid rgba(30,45,78,0.50);color:rgba(30,45,78,0.90);border-radius:6px;padding:0.25rem 0.625rem;font-size:0.75rem;font-weight:500;cursor:pointer;font-family:DM Sans,system-ui,sans-serif;min-height:36px;">+ Add Contact</button>',
        '</div>',
        '<p style="font-size:0.8rem;color:rgba(237,232,223,0.5);line-height:1.5;margin:0 0 0.75rem;">Family, friends, or a lawyer. They get an <strong style="color:rgba(237,232,223,0.75);">email or text message</strong> when your code word is typed or the alert button is tapped.</p>',
        '<div id="hp-sft-contact-form" style="display:none;background:#0d1520;border-radius:0.625rem;padding:0.875rem;margin-bottom:0.75rem;border:1px solid rgba(255,255,255,0.07);">',
          '<input id="hp-sft-cf-name" placeholder="Name (e.g. Mom, Lawyer)" autocomplete="off" style="width:100%;box-sizing:border-box;background:#0d1520;border:1px solid rgba(255,255,255,0.1);border-radius:0.375rem;padding:0.5rem 0.75rem;color:#ede8df;font-size:0.8rem;font-family:DM Sans,system-ui,sans-serif;outline:none;margin-bottom:0.5rem;min-height:40px;" />',
          '<div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;">',
            '<button id="hp-sft-cf-type-email" style="flex:1;background:#1c2440;border:2px solid #A8B4D0;color:#A8B4D0;border-radius:0.375rem;padding:0.4rem 0.25rem;font-size:0.78rem;font-weight:600;cursor:pointer;font-family:DM Sans,system-ui,sans-serif;min-height:38px;" data-type="email">✉ Email</button>',
            '<button id="hp-sft-cf-type-sms" style="flex:1;background:#0d1520;border:2px solid rgba(255,255,255,0.12);color:rgba(237,232,223,0.5);border-radius:0.375rem;padding:0.4rem 0.25rem;font-size:0.78rem;font-weight:600;cursor:pointer;font-family:DM Sans,system-ui,sans-serif;min-height:38px;" data-type="sms">📱 Text / SMS</button>',
          '</div>',
          '<input id="hp-sft-cf-email" type="email" placeholder="Email address" autocomplete="off" style="width:100%;box-sizing:border-box;background:#0d1520;border:1px solid rgba(255,255,255,0.1);border-radius:0.375rem;padding:0.5rem 0.75rem;color:#ede8df;font-size:0.8rem;font-family:DM Sans,system-ui,sans-serif;outline:none;margin-bottom:0.5rem;min-height:40px;display:block;" />',
          '<input id="hp-sft-cf-phone" type="tel" placeholder="Mobile number (e.g. 416-555-0123)" autocomplete="off" style="width:100%;box-sizing:border-box;background:#0d1520;border:1px solid rgba(255,255,255,0.1);border-radius:0.375rem;padding:0.5rem 0.75rem;color:#ede8df;font-size:0.8rem;font-family:DM Sans,system-ui,sans-serif;outline:none;margin-bottom:0.5rem;min-height:40px;display:none;" />',
          '<p id="hp-sft-cf-sms-note" style="font-size:0.72rem;color:rgba(168,180,208,0.7);margin:0 0 0.5rem;line-height:1.4;display:none;">📲 When your alert fires, this person gets a text message immediately, then a follow-up with your courthouse location.</p>',
          '<button id="hp-sft-cf-save" style="width:100%;background:#A8B4D0;color:#fff;border:none;border-radius:0.375rem;padding:0.5rem;font-size:0.8rem;font-weight:600;cursor:pointer;font-family:DM Sans,system-ui,sans-serif;min-height:40px;">Add Contact</button>',
        '</div>',
        '<div id="hp-sft-contacts-list"></div>',
        // Manual trigger
        '<div style="margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid rgba(255,255,255,0.07);">',
          '<p style="font-size:0.8rem;color:rgba(237,232,223,0.5);margin:0 0 0.625rem;">Or send the alert right now if you need help immediately:</p>',
          '<button id="hp-sft-trigger-btn" style="width:100%;background:rgba(123,45,62,0.15);border:1px solid rgba(123,45,62,0.5);color:rgba(237,140,140,0.9);border-radius:0.625rem;padding:0.875rem;font-size:0.9375rem;font-weight:600;cursor:pointer;font-family:DM Sans,system-ui,sans-serif;min-height:50px;">Send Silent Alert Now</button>',
          '<p id="hp-sft-trigger-status" style="font-size:0.75rem;text-align:center;color:rgba(30,45,78,0.85);margin:0.375rem 0 0;min-height:1rem;"></p>',
        '</div>',
      '</div>',
    ].join('');

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Close
    function closeOverlay() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    document.getElementById('hp-safety-close').addEventListener('click', closeOverlay);
    document.getElementById('hp-safety-close').addEventListener('touchend', function(e){ e.preventDefault(); closeOverlay(); });
    overlay.addEventListener('click', function(e){ if(e.target===overlay) closeOverlay(); });

    // Tabs
    var tabs = sheet.querySelectorAll('[data-tab]');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = tab.getAttribute('data-tab');
        tabs.forEach(function(t) {
          var active = t.getAttribute('data-tab') === target;
          t.style.borderBottomColor = active ? '#A8B4D0' : 'transparent';
          t.style.color = active ? '#ede8df' : 'rgba(237,232,223,0.5)';
          t.style.fontWeight = active ? '600' : '500';
        });
        document.getElementById('hp-sft-panel-resources').style.display = target === 'resources' ? 'block' : 'none';
        document.getElementById('hp-sft-panel-alert').style.display = target === 'alert' ? 'block' : 'none';
        if (target === 'alert') loadSafetyData();
      });
    });

    // Load data immediately on every open (not just tab switch)
    // Small delay so DOM is fully ready
    setTimeout(loadSafetyData, 300);

    // Load data
    function loadSafetyData() {
      fetch(_RW + '/api/safety/settings', { headers: __authHdr() })
        .then(function(r){ return r.json(); })
        .then(function(d){
          var inp = document.getElementById('hp-sft-codeword-input');
          if (inp && d.codeWord) inp.placeholder = 'Code word set \u2014 enter new to change';
        }).catch(function(){});
      fetch(_RW + '/api/safety/contacts', { headers: __authHdr() })
        .then(function(r){ return r.json(); })
        .then(function(contacts){ renderContacts(contacts); })
        .catch(function(){ renderContacts([]); });
    }

    function renderContacts(contacts) {
      var list = document.getElementById('hp-sft-contacts-list');
      if (!list) return;
      if (!contacts.length) {
        list.innerHTML = '<p style="font-size:0.8rem;color:rgba(237,232,223,0.3);text-align:center;padding:0.5rem;">No contacts yet</p>';
        return;
      }
      list.innerHTML = contacts.map(function(c) {
        var contactIcon = (c.contactType === 'sms' || c.contactType === 'phone') ? '\ud83d\udcf1' : '\u2709\ufe0f';
        var contactBadge = (c.contactType === 'sms' || c.contactType === 'phone') ? '<span style="font-size:0.65rem;background:rgba(168,180,208,0.12);color:#A8B4D0;border-radius:4px;padding:1px 5px;margin-left:4px;vertical-align:middle;">SMS</span>' : '<span style="font-size:0.65rem;background:rgba(168,180,208,0.08);color:rgba(168,180,208,0.6);border-radius:4px;padding:1px 5px;margin-left:4px;vertical-align:middle;">Email</span>';
        return '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0.875rem;background:#0d1520;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.07);margin-bottom:0.5rem;"><div style="flex:1;min-width:0;"><p style="font-size:0.875rem;font-weight:500;color:#ede8df;margin:0;">'+contactIcon+' '+escHtml(c.name)+contactBadge+'</p><p style="font-size:0.75rem;color:rgba(237,232,223,0.5);margin:0;">'+escHtml(c.contactValue)+'</p></div><button data-contact-id="'+c.id+'" class="hp-sft-del-contact" style="background:transparent;border:none;color:rgba(237,232,223,0.35);cursor:pointer;padding:0.375rem;min-width:36px;min-height:36px;" title="Remove"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button></div>';
      }).join('');
      list.querySelectorAll('.hp-sft-del-contact').forEach(function(btn) {
        btn.addEventListener('click', function() {
          fetch(_RW + '/api/safety/contacts/' + btn.getAttribute('data-contact-id'), { method:'DELETE', headers:__authHdr() })
            .then(function(){ loadSafetyData(); }).catch(function(){});
        });
      });
    }

    // Save code word
    document.getElementById('hp-sft-codeword-save').addEventListener('click', function() {
      var inp = document.getElementById('hp-sft-codeword-input');
      var status = document.getElementById('hp-sft-codeword-status');
      var word = inp ? inp.value.trim() : '';
      if (!word) { if(status) status.textContent='Please enter a code word.'; return; }
      fetch(_RW + '/api/safety/settings', { method:'PUT', headers:__authHdr(), body:JSON.stringify({codeWord:word}) })
        .then(function(r){ return r.json(); })
        .then(function(){
          if(status) status.textContent = 'Code word saved \u2713';
          if(inp){ inp.value=''; inp.placeholder='Code word set \u2014 enter new to change'; }
          startCodeWordMonitor();
        }).catch(function(){ if(status) status.textContent='Error saving. Try again.'; });
    });

    // Toggle add contact form
    document.getElementById('hp-sft-contact-add-btn').addEventListener('click', function() {
      var form = document.getElementById('hp-sft-contact-form');
      if(form) form.style.display = form.style.display==='none' ? 'block' : 'none';
    });

    // Contact type toggle (Email / SMS)
    var _sftContactType = 'email';
    function _sftSetType(type) {
      _sftContactType = type;
      var btnEmail = document.getElementById('hp-sft-cf-type-email');
      var btnSms   = document.getElementById('hp-sft-cf-type-sms');
      var inEmail  = document.getElementById('hp-sft-cf-email');
      var inPhone  = document.getElementById('hp-sft-cf-phone');
      var smsNote  = document.getElementById('hp-sft-cf-sms-note');
      var activeStyle  = 'background:#1c2440;border:2px solid #A8B4D0;color:#A8B4D0;';
      var inactiveStyle= 'background:#0d1520;border:2px solid rgba(255,255,255,0.12);color:rgba(237,232,223,0.5);';
      if (type === 'email') {
        if(btnEmail) btnEmail.style.cssText += activeStyle;
        if(btnSms)   btnSms.style.cssText   += inactiveStyle;
        if(inEmail)  inEmail.style.display  = 'block';
        if(inPhone)  inPhone.style.display  = 'none';
        if(smsNote)  smsNote.style.display  = 'none';
      } else {
        if(btnEmail) btnEmail.style.cssText += inactiveStyle;
        if(btnSms)   btnSms.style.cssText   += activeStyle;
        if(inEmail)  inEmail.style.display  = 'none';
        if(inPhone)  inPhone.style.display  = 'block';
        if(smsNote)  smsNote.style.display  = 'block';
      }
    }
    var _btnTypeEmail = document.getElementById('hp-sft-cf-type-email');
    var _btnTypeSms   = document.getElementById('hp-sft-cf-type-sms');
    if(_btnTypeEmail) _btnTypeEmail.addEventListener('click', function(){ _sftSetType('email'); });
    if(_btnTypeSms)   _btnTypeSms.addEventListener('click',   function(){ _sftSetType('sms'); });

    // Save contact
    document.getElementById('hp-sft-cf-save').addEventListener('click', function() {
      var name = (document.getElementById('hp-sft-cf-name')||{}).value||'';
      var contactVal = _sftContactType === 'sms'
        ? ((document.getElementById('hp-sft-cf-phone')||{}).value||'')
        : ((document.getElementById('hp-sft-cf-email')||{}).value||'');
      if (!name.trim() || !contactVal.trim()) return;
      fetch(_RW + '/api/safety/contacts', { method:'POST', headers:__authHdr(), body:JSON.stringify({name:name.trim(),contactType:_sftContactType,contactValue:contactVal.trim()}) })
        .then(function(r){ return r.json(); })
        .then(function(){
          document.getElementById('hp-sft-cf-name').value='';
          document.getElementById('hp-sft-cf-email').value='';
          var ph = document.getElementById('hp-sft-cf-phone'); if(ph) ph.value='';
          var form=document.getElementById('hp-sft-contact-form');
          if(form) form.style.display='none';
          _sftContactType = 'email'; _sftSetType('email');
          loadSafetyData();
        }).catch(function(){});
    });

    // Manual trigger
    document.getElementById('hp-sft-trigger-btn').addEventListener('click', function() {
      var btn=document.getElementById('hp-sft-trigger-btn');
      var status=document.getElementById('hp-sft-trigger-status');
      if(btn){btn.disabled=true;btn.textContent='Sending\u2026';}
      fetch(_RW + '/api/safety/trigger', { method:'POST', headers:__authHdr(), body:JSON.stringify({method:'button'}) })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if(btn){btn.textContent='Alert Sent \u2713';btn.style.background='rgba(30,45,78,0.30)';btn.style.borderColor='rgba(30,45,78,0.60)';btn.style.color='rgba(30,45,78,0.95)';}
          if(status) status.textContent='Alert sent to '+(d.sent||0)+' contact(s).';
        }).catch(function(){
          if(btn){btn.disabled=false;btn.textContent='Send Silent Alert Now';}
          if(status) status.textContent='Error. Make sure contacts are set up first.';
        });
    });
  }

  // Code word monitor — listens for code word typed ANYWHERE on page
  // Uses a rolling buffer and checks if the buffer CONTAINS the code word
  // Does NOT reset on backspace/non-printable keys so typing in form fields works
  var _codeWordActive = false;
  // Use window so the cooldown survives React re-renders and script re-evals
  function _cwIsOnCooldown() {
    return window.__hp_cw_lastTrigger && (Date.now() - window.__hp_cw_lastTrigger) < 65000;
  }
  var _cwFiring = false; // in-flight guard — only one trigger attempt at a time
  function startCodeWordMonitor() {
    if (_codeWordActive) return;
    _codeWordActive = true;
    var buffer = '';
    document.addEventListener('keydown', function(e) {
      // Only collect printable single characters — don’t reset on non-printable keys
      if (!e.key || e.key.length !== 1) return;
      if (_cwIsOnCooldown()) return; // skip all processing during cooldown
      buffer += e.key.toLowerCase();
      if (buffer.length > 80) buffer = buffer.slice(-80);
      clearTimeout(window._hp_cwTimeout);
      window._hp_cwTimeout = setTimeout(function() {
        // Double-check cooldown and in-flight guard before fetching
        if (_cwIsOnCooldown() || _cwFiring) return;
        var checkWord = buffer; // snapshot buffer before any async
        _cwFiring = true; // block any concurrent debounce from also fetching
        fetch(_RW + '/api/safety/check-codeword', { method:'POST', headers:__authHdr(), body:JSON.stringify({word:checkWord}) })
          .then(function(r){ return r.json(); })
          .then(function(d){
            if (d.match && !_cwIsOnCooldown()) {
              // Set cooldown IMMEDIATELY before firing trigger — prevents race
              window.__hp_cw_lastTrigger = Date.now();
              buffer = ''; // clear buffer so it can’t match again
              clearTimeout(window._hp_cwTimeout); // cancel any pending debounce
              fetch(_RW + '/api/safety/trigger', { method:'POST', headers:__authHdr(), body:JSON.stringify({method:'codeword'}) }).catch(function(){});
            } else {
              _cwFiring = false; // no match — release guard so future keystrokes can check
            }
          }).catch(function(){ _cwFiring = false; }); // network error — release guard
      }, 800);
    }, true);
  }

  // Expose globally — use _real suffix so the bootstrap stub can forward to us
  window.__openSafetyOverlay_real = openSafetyOverlay;
  // Also set directly in case patches load before React bundle shield click
  window.__openSafetyOverlay = openSafetyOverlay;

  // ── Robust shield click wiring ──────────────────────────────────────────────
  // MutationObserver watches for the shield button in the navbar and ensures
  // the click handler is always wired, even after React re-renders.
  (function wireShieldButton() {
    function attachShield() {
      // Target by exact aria-label set in the React component
      var btn = document.querySelector('button[aria-label="Safety & emergency"]');
      if (!btn || btn.getAttribute('data-hp-shield-wired')) return;
      btn.setAttribute('data-hp-shield-wired', '1');
      // Use mousedown so we fire before React's onClick synthetic event
      btn.addEventListener('mousedown', function() {
        setTimeout(function() { openSafetyOverlay(); }, 50);
      });
      // Also handle touchstart for mobile
      btn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        setTimeout(function() { openSafetyOverlay(); }, 50);
      }, { passive: false });
    }
    // Run immediately and on every DOM mutation
    setTimeout(attachShield, 500);
    var obs = new MutationObserver(function() { setTimeout(attachShield, 100); });
    obs.observe(document.body, { childList: true, subtree: true });
  })();

  // ── Pricing page text fix ───────────────────────────────────────────────────
  // Patch the in-app pricing/upgrade screen to show accurate form availability
  // instead of the outdated "Form 8, 35.1, 13 wizards" bullet.
  (function patchPricingText() {
    var INTERVAL_ID = setInterval(function() {
      var changed = 0;

      // Fix 1: Standard plan feature bullet
      document.querySelectorAll('li, span, p, div').forEach(function(el) {
        if (el.children.length === 0 && el.textContent.trim() === 'Form 8, 35.1, 13 wizards') {
          el.textContent = 'All 35 Ontario court forms';
          changed++;
        }
      });

      // Fix 2: Hero/landing strip bullet inside the app
      document.querySelectorAll('li, span, p, div').forEach(function(el) {
        if (el.children.length === 0 && el.textContent.trim() === 'Step-by-step wizards for Form 8, 35.1, 13, and more') {
          el.textContent = 'Step-by-step wizards for all 35 Ontario court forms';
          changed++;
        }
      });

      if (changed > 0) clearInterval(INTERVAL_ID);
    }, 600);
    // Stop polling after 20 seconds regardless
    setTimeout(function() { clearInterval(INTERVAL_ID); }, 20000);
  })();

  // Auto-start code word monitor on login
  setTimeout(function() {
    if (!window.__hp_token) return;
    fetch(_RW + '/api/safety/settings', { headers:__authHdr() })
      .then(function(r){ return r.json(); })
      .then(function(d){ if(d && d.codeWord) startCodeWordMonitor(); })
      .catch(function(){});
  }, 2500);


  // ── Subscription Enforcement UI ──────────────────────────────────────────────

  var TEAL   = '#A8B4D0';
  var TEAL_D = '#1E2D4E';
  var BURG   = '#1E2D4E';
  var FREE_FORM_IDS = ['form8','form8general','form8a','form8adivorce'];

  // ── Upgrade Modal ─────────────────────────────────────────────────────────────
  function showUpgradeModal(reason) {
    // Prefer the React upgrade wall (UpgradeWallHP) if available
    if (window.__hp_upgradeWallReady) {
      window.dispatchEvent(new CustomEvent('hp:upgrade-required'));
      return;
    }
    if (document.getElementById('hp-upgrade-modal')) return;
    var heading = reason === 'pdf'
      ? 'Subscribe to Download Your PDF'
      : 'Subscribe to Access This Form';
    var body = reason === 'pdf'
      ? 'You\u2019ve completed Form 8 \u2014 great work! Subscribe to download your court-ready PDF and unlock all 35 Ontario family court forms.'
      : 'This form is available on Standard and Plus plans. Subscribe to access all 35 Ontario court forms and download court-ready PDFs.';

    var overlay = document.createElement('div');
    overlay.id = 'hp-upgrade-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:32px 28px;max-width:440px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,0.25);text-align:center;">' +
        '<div style="width:56px;height:56px;border-radius:50%;background:' + TEAL_D + ';display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">' +
          '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
        '</div>' +
        '<h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:' + TEAL_D + ';">' + heading + '</h2>' +
        '<p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.5;">' + body + '</p>' +
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<button id="hp-upgrade-std" style="background:' + TEAL_D + ';color:#fff;border:none;border-radius:10px;padding:14px 20px;font-size:15px;font-weight:600;cursor:pointer;width:100%;">Standard \u2014 $9.99/mo CAD</button>' +
          '<button id="hp-upgrade-plus" style="background:' + BURG + ';color:#fff;border:none;border-radius:10px;padding:14px 20px;font-size:15px;font-weight:600;cursor:pointer;width:100%;">Plus \u2014 $19.99/mo CAD</button>' +
          '<button id="hp-upgrade-close" style="background:transparent;color:#888;border:1px solid #ddd;border-radius:10px;padding:11px 20px;font-size:14px;cursor:pointer;width:100%;">Not right now</button>' +
        '</div>' +
        '<p style="margin:16px 0 0;font-size:11px;color:#aaa;">Billed monthly. Cancel anytime from account settings.</p>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('hp-upgrade-std').addEventListener('click', function() { launchCheckout('standard'); });
    document.getElementById('hp-upgrade-plus').addEventListener('click', function() { launchCheckout('plus'); });
    document.getElementById('hp-upgrade-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  function launchCheckout(plan) {
    var priceId = plan === 'plus' ? 'price_1TduyXDyokC7Tv7bKKoeeh1v' : 'price_1Tduf0DyokC7Tv7bDRAZBk57';
    fetch(_RW + '/api/stripe/create-checkout', {
      method: 'POST',
      headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
      body: JSON.stringify({ priceId: priceId, successUrl: window.location.href + '?checkout=success', cancelUrl: window.location.href })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){ if (d && d.url) window.location.href = d.url; else alert('We couldn\'t open the checkout page. If your card was declined, check with your bank that online purchases are enabled — this is common with debit Visa and Mastercard. No charge has been made. Please try again or use a different card.'); })
    .catch(function(){ alert('We couldn\'t connect to our payment processor. Please check your internet connection and try again. If the issue continues, your bank may be blocking the transaction — contact them to enable online purchases.'); });
  }

  // Handle Stripe checkout success redirect
  (function checkCheckoutReturn() {
    if (window.location.search.indexOf('checkout=success') === -1) return;
    var clean = window.location.href.replace(/[?&]checkout=success/, '');

    function doSync() {
      fetch(_RW + '/api/stripe/sync', { method: 'POST', headers: __authHdr() })
        .then(function(r){ return r.json(); })
        .then(function(d) {
          window.history.replaceState({}, '', clean);
          // Update token with new plan info if returned
          if (d && d.token) { window.__hp_token = d.token; }
          // Show a success toast before reload
          var toast = document.createElement('div');
          toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a3a2a;color:#6fcf97;padding:14px 24px;border-radius:12px;font-size:15px;font-weight:600;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
          toast.textContent = '\u2714 Plan activated! Welcome to Plus.';
          document.body.appendChild(toast);
          setTimeout(function() { window.location.reload(); }, 1800);
        })
        .catch(function() { window.history.replaceState({}, '', clean); window.location.reload(); });
    }

    // Wait for token to be available (React app may take a moment to restore session)
    if (window.__hp_token) {
      doSync();
    } else {
      var attempts = 0;
      var poll = setInterval(function() {
        attempts++;
        if (window.__hp_token) {
          clearInterval(poll);
          doSync();
        } else if (attempts > 20) {
          // Token never appeared — clean URL and reload anyway
          clearInterval(poll);
          window.history.replaceState({}, '', clean);
          window.location.reload();
        }
      }, 300);
    }
  })();

  // ── Past-due payment banner ───────────────────────────────────────────────────
  function showPastDueBanner() {
    if (document.getElementById('hp-pastdue-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'hp-pastdue-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:#1E2D4E;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-family:inherit;gap:12px;';
    banner.innerHTML =
      '<span>\u26a0\ufe0f Your last payment couldn\'t be processed. This is common with debit Visa/Mastercard — your bank may need to enable online purchases. Update your card to keep access.</span>' +
      '<a id="hp-pastdue-fix" href="#" style="color:#ffd0d8;font-weight:700;white-space:nowrap;text-decoration:none;">Update Card &rarr;</a>';
    document.body.prepend(banner);
    document.body.style.paddingTop = (parseInt(document.body.style.paddingTop || '0') + 44) + 'px';
    document.getElementById('hp-pastdue-fix').addEventListener('click', function(e) {
      e.preventDefault(); openBillingPortal();
    });
  }

  function openBillingPortal() {
    fetch(_RW + '/api/stripe/billing-portal', {
      method: 'POST',
      headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
      body: JSON.stringify({ returnUrl: window.location.href })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){ if (d && d.url) window.location.href = d.url; })
    .catch(function(){});
  }

  // ── Lock non-free form cards on form selector ─────────────────────────────────
  function applyFormLocks(subStatus, plan) {
    var isPaid = (subStatus === 'active' || subStatus === 'past_due') && plan !== 'free';
    if (isPaid) return;
    var LOCK_IV = setInterval(function() {
      var cards = document.querySelectorAll('[data-form-id],[href*="/wizard/"],[href*="form"]');
      if (!cards.length) return;
      var found = 0;
      cards.forEach(function(card) {
        var formId = card.getAttribute('data-form-id') || '';
        if (!formId) {
          var m = (card.href || card.getAttribute('href') || '').match(/form[0-9a-z_]+/i);
          formId = m ? m[0] : '';
        }
        if (!formId) return;
        var fid = formId.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (FREE_FORM_IDS.includes(fid)) return;
        if (card.getAttribute('data-hp-locked')) return;
        card.setAttribute('data-hp-locked', '1');
        card.style.position = 'relative';
        var badge = document.createElement('span');
        badge.textContent = 'SUBSCRIBE';
        badge.style.cssText = 'position:absolute;top:8px;right:8px;background:' + TEAL_D + ';color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;pointer-events:none;z-index:10;';
        card.appendChild(badge);
        card.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); showUpgradeModal('form'); }, true);
        found++;
      });
      if (found > 0) clearInterval(LOCK_IV);
    }, 900);
    setTimeout(function(){ clearInterval(LOCK_IV); }, 15000);
  }

  // ── Boot: fetch user plan and apply UI ────────────────────────────────────────
  function bootSubscriptionUI() {
    if (!window.__hp_token) return;
    fetch(_RW + '/api/auth/me', { headers: __authHdr() })
      .then(function(r){ return r.json(); })
      .then(function(user) {
        var status = user.subscriptionStatus || 'free';
        var plan   = user.plan || 'free';
        window.__hp_sub_status = status;
        window.__hp_plan = plan;
        if (status === 'past_due') showPastDueBanner();
        if (status !== 'active' || plan === 'free') {
          setTimeout(function(){ applyFormLocks(status, plan); }, 1500);
        }
      })
      .catch(function(){});
  }

  // Intercept 403 responses from fetch to show upgrade modal
  (function interceptApiLock() {
    var origFetch = window.fetch;
    window.fetch = function() {
      return origFetch.apply(this, arguments).then(function(resp) {
        if (resp.status === 403) {
          resp.clone().json().then(function(data) {
            if (data && data.code === 'PDF_LOCKED') showUpgradeModal('pdf');
            else if (data && data.code === 'SUBSCRIPTION_REQUIRED') showUpgradeModal('form');
          }).catch(function(){});
        }
        return resp;
      });
    };
  })();

  setTimeout(bootSubscriptionUI, 1800);

  // ── Account Settings Page ────────────────────────────────────────────────────

  window.__openAccountSettings_real = function() {
    if (document.getElementById('hp-account-settings')) return;

    var overlay = document.createElement('div');
    overlay.id = 'hp-account-settings';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:99990;',
      'background:rgba(11,20,25,0.92);',
      'display:flex;align-items:flex-start;justify-content:center;',
      'padding:0;overflow-y:auto;'
    ].join('');

    function formatDate(ms) {
      if (!ms) return 'N/A';
      return new Date(ms).toLocaleDateString('en-CA', { year:'numeric', month:'long', day:'numeric' });
    }

    function planLabel(plan, status) {
      if (!plan || plan === 'free') return 'Free';
      if (plan === 'plus') return 'Plus';
      if (plan === 'standard') return 'Standard';
      return plan.charAt(0).toUpperCase() + plan.slice(1);
    }

    function statusBadge(status) {
      var map = {
        'active':   ['#edf7ed','#2d6a2d','Active'],
        'past_due': ['#fff4e5','#7a3e00','Payment Failed'],
        'canceled': ['#fdecea','#8c1c13','Cancelled'],
        'free':     ['#dff0f3','#1E2D4E','Free'],
      };
      var s = map[status] || map['free'];
      return '<span style="background:'+s[0]+';color:'+s[1]+';font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:0.03em;">'+s[2]+'</span>';
    }

    // Build the panel shell immediately with a loading state
    overlay.innerHTML =
      '<div id="hp-acc-panel" style="'+
        'background:#0d1520;border-radius:0;min-height:100vh;width:100%;max-width:560px;'+
        'margin:0 auto;display:flex;flex-direction:column;'+
        'font-family:DM Sans,system-ui,sans-serif;color:#ede8df;'+
      '">'+
        // Header
        '<div style="background:#1E2D4E;padding:20px 24px 18px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:10;">'+
          '<button id="hp-acc-back" style="background:rgba(255,255,255,0.1);border:none;border-radius:8px;color:#fff;width:36px;height:36px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">&#8592;</button>'+
          '<div>'+
            '<h1 style="margin:0;font-size:19px;font-weight:700;color:#fff;">Account Settings</h1>'+
            '<p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,0.6);">Manage your profile and subscription</p>'+
          '</div>'+
        '</div>'+
        // Body
        '<div id="hp-acc-body" style="padding:24px;flex:1;display:flex;flex-direction:column;gap:20px;">'+
          '<div style="color:#7fb8c4;font-size:13px;text-align:center;padding:40px 0;">Loading your account&#8230;</div>'+
        '</div>'+
      '</div>';

    document.body.appendChild(overlay);

    // Back button
    document.getElementById('hp-acc-back').addEventListener('click', function() {
      overlay.remove();
    });

    // Load user data then render
    fetch(_RW + '/api/auth/me', { headers: __authHdr() })
      .then(function(r){ return r.json(); })
      .then(function(resp) {
        var user = resp.user || resp;
        var plan   = user.plan || 'free';
        var status = user.subscriptionStatus || 'free';
        var periodEnd = user.subscriptionCurrentPeriodEnd;
        var isPaid = (status === 'active' || status === 'past_due') && plan !== 'free';

        var planName = planLabel(plan, status);
        var body = document.getElementById('hp-acc-body');

        body.innerHTML =

          // ── Profile section ──
          '<div style="background:#0d1520;border-radius:14px;padding:20px;border:1px solid #131e30;">'+
            '<h2 style="margin:0 0 16px;font-size:14px;font-weight:700;color:#A8B4D0;text-transform:uppercase;letter-spacing:0.06em;">Profile</h2>'+

            '<label style="display:block;font-size:12px;color:#A8B4D0;margin-bottom:6px;font-weight:600;">Email Address</label>'+
            '<div style="display:flex;gap:8px;align-items:center;">'+
              '<input id="hp-acc-email" type="email" value="'+user.email+'" style="'+
                'flex:1;background:#0d1520;border:1.5px solid #131e30;border-radius:9px;'+
                'color:#ede8df;font-size:14px;padding:11px 14px;outline:none;'+
                'font-family:inherit;transition:border-color 0.2s;'+
              '" />'+
              '<button id="hp-acc-save-email" style="'+
                'background:#A8B4D0;color:#fff;border:none;border-radius:9px;'+
                'padding:11px 18px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;'+
                'font-family:inherit;flex-shrink:0;'+
              '">Save</button>'+
            '</div>'+
            '<div id="hp-acc-email-msg" style="margin-top:8px;font-size:12px;min-height:16px;"></div>'+

            '<div style="border-top:1px solid #131e30;margin:18px 0;"></div>'+

            '<label style="display:block;font-size:12px;color:#A8B4D0;margin-bottom:6px;font-weight:600;">Change Password</label>'+
            '<input id="hp-acc-curpw" type="password" placeholder="Current password" style="'+
              'width:100%;box-sizing:border-box;background:#0d1520;border:1.5px solid #131e30;border-radius:9px;'+
              'color:#ede8df;font-size:14px;padding:11px 14px;outline:none;font-family:inherit;margin-bottom:8px;'+
            '" />'+
            '<input id="hp-acc-newpw" type="password" placeholder="New password (min 8 characters)" style="'+
              'width:100%;box-sizing:border-box;background:#0d1520;border:1.5px solid #131e30;border-radius:9px;'+
              'color:#ede8df;font-size:14px;padding:11px 14px;outline:none;font-family:inherit;margin-bottom:8px;'+
            '" />'+
            '<button id="hp-acc-save-pw" style="'+
              'background:#1E2D4E;color:#fff;border:none;border-radius:9px;'+
              'padding:11px 20px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;'+
            '">Update Password</button>'+
            '<div id="hp-acc-pw-msg" style="margin-top:8px;font-size:12px;min-height:16px;"></div>'+
          '</div>'+

          // ── Subscription section ──
          '<div style="background:#0d1520;border-radius:14px;padding:20px;border:1px solid #131e30;">'+
            '<h2 style="margin:0 0 16px;font-size:14px;font-weight:700;color:#A8B4D0;text-transform:uppercase;letter-spacing:0.06em;">Subscription</h2>'+

            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'+
              '<div>'+
                '<div style="font-size:16px;font-weight:700;color:#ede8df;">'+planName+' Plan</div>'+
                (isPaid && periodEnd ?
                  '<div style="font-size:12px;color:#A8B4D0;margin-top:3px;">Next billing: '+formatDate(periodEnd)+'</div>' :
                  '<div style="font-size:12px;color:#A8B4D0;margin-top:3px;">Form 8 free &mdash; subscribe for all 35 forms</div>'
                )+
              '</div>'+
              statusBadge(isPaid ? status : 'free')+
            '</div>'+

            (status === 'past_due' ?
              '<div style="background:#3d1020;border:1px solid #1E2D4E;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:13px;color:#ffd0d8;">'+
                '&#9888;&#65039; Your last payment couldn\'t be processed. This is common with debit Visa/Mastercard — your bank may need to enable online purchases. Update your card to restore access.'+
              '</div>' : ''
            )+

            (isPaid ?
              // Paid user — billing portal button
              '<button id="hp-acc-portal" style="'+
                'width:100%;background:#1E2D4E;color:#fff;border:none;border-radius:10px;'+
                'padding:14px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;'+
                'display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;'+
              '">'+
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>'+
                'Manage Billing &amp; Subscription'+
              '</button>'+
              '<p style="font-size:11px;color:#C8C0B0;text-align:center;margin:0;">Update payment method, download invoices, or cancel your plan</p>'
            :
              // Free user — upgrade buttons
              '<div style="display:flex;flex-direction:column;gap:10px;">'+
                '<button id="hp-acc-std" style="'+
                  'background:#1E2D4E;color:#fff;border:none;border-radius:10px;'+
                  'padding:14px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;'+
                '">Standard &mdash; $9.99/mo CAD</button>'+
                '<button id="hp-acc-plus" style="'+
                  'background:#1E2D4E;color:#fff;border:none;border-radius:10px;'+
                  'padding:14px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;'+
                '">Plus &mdash; $19.99/mo CAD</button>'+
                '<p style="font-size:11px;color:#C8C0B0;text-align:center;margin:4px 0 0;">Billed monthly. Cancel anytime.</p>'+
              '</div>'
            )+
          '</div>'+

          // ── Danger zone ──
          '<div style="background:#0d1520;border-radius:14px;padding:20px;border:1px solid #2a1520;">'+
            '<h2 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1E2D4E;text-transform:uppercase;letter-spacing:0.06em;">Account</h2>'+
            '<button id="hp-acc-logout" style="'+
              'width:100%;background:transparent;color:#1E2D4E;border:1.5px solid #1E2D4E;border-radius:10px;'+
              'padding:13px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;'+
            '">Sign Out</button>'+
          '</div>'+

          '<div style="height:32px;"></div>';

        // ── Wire events ──

        // Focus styling on inputs
        ['hp-acc-email','hp-acc-curpw','hp-acc-newpw'].forEach(function(id) {
          var el = document.getElementById(id);
          if (!el) return;
          el.addEventListener('focus', function() { this.style.borderColor = '#A8B4D0'; });
          el.addEventListener('blur',  function() { this.style.borderColor = '#131e30'; });
        });

        // Save email
        document.getElementById('hp-acc-save-email').addEventListener('click', function() {
          var newEmail = document.getElementById('hp-acc-email').value.trim();
          var msg = document.getElementById('hp-acc-email-msg');
          if (!newEmail || !newEmail.includes('@')) {
            msg.style.color = '#e57373'; msg.textContent = 'Please enter a valid email address.'; return;
          }
          var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
          fetch(_RW + '/api/auth/me', {
            method: 'PATCH',
            headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
            body: JSON.stringify({ email: newEmail })
          })
          .then(function(r){ return r.json(); })
          .then(function(d) {
            if (d.user) {
              msg.style.color = '#66bb6a'; msg.textContent = 'Email updated successfully.';
            } else {
              msg.style.color = '#e57373'; msg.textContent = d.message || 'Update failed.';
            }
          })
          .catch(function(){ msg.style.color = '#e57373'; msg.textContent = 'Update failed. Please try again.'; })
          .finally(function(){ btn.disabled = false; btn.textContent = 'Save'; });
        });

        // Change password
        document.getElementById('hp-acc-save-pw').addEventListener('click', function() {
          var cur = document.getElementById('hp-acc-curpw').value;
          var nw  = document.getElementById('hp-acc-newpw').value;
          var msg = document.getElementById('hp-acc-pw-msg');
          if (!cur || !nw) { msg.style.color='#e57373'; msg.textContent='Both fields are required.'; return; }
          if (nw.length < 8) { msg.style.color='#e57373'; msg.textContent='New password must be at least 8 characters.'; return; }
          var btn = this; btn.disabled = true; btn.textContent = 'Updating…';
          fetch(_RW + '/api/auth/change-password', {
            method: 'POST',
            headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
            body: JSON.stringify({ currentPassword: cur, newPassword: nw })
          })
          .then(function(r){ return r.json(); })
          .then(function(d) {
            if (d.ok) {
              msg.style.color='#66bb6a'; msg.textContent='Password updated successfully.';
              document.getElementById('hp-acc-curpw').value = '';
              document.getElementById('hp-acc-newpw').value = '';
            } else {
              msg.style.color='#e57373'; msg.textContent = d.message || 'Update failed.';
            }
          })
          .catch(function(){ msg.style.color='#e57373'; msg.textContent='Update failed. Please try again.'; })
          .finally(function(){ btn.disabled=false; btn.textContent='Update Password'; });
        });

        // Billing portal (paid users)
        var portalBtn = document.getElementById('hp-acc-portal');
        if (portalBtn) {
          portalBtn.addEventListener('click', function() {
            portalBtn.disabled = true; portalBtn.textContent = 'Opening…';
            fetch(_RW + '/api/stripe/billing-portal', {
              method: 'POST',
              headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
              body: JSON.stringify({ returnUrl: window.location.href })
            })
            .then(function(r){ return r.json(); })
            .then(function(d){ if (d.url) window.location.href = d.url; })
            .catch(function(){})
            .finally(function(){ portalBtn.disabled=false; portalBtn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Manage Billing &amp; Subscription'; });
          });
        }

        // Upgrade buttons (free users)
        var stdBtn = document.getElementById('hp-acc-std');
        var plusBtn = document.getElementById('hp-acc-plus');
        if (stdBtn) stdBtn.addEventListener('click', function() { launchCheckout('standard'); });
        if (plusBtn) plusBtn.addEventListener('click', function() { launchCheckout('plus'); });

        // Sign out
        document.getElementById('hp-acc-logout').addEventListener('click', function() {
          fetch(_RW + '/api/auth/logout', { method:'POST', headers: __authHdr() })
            .finally(function() {
              window.__hp_token = null;
              overlay.remove();
              window.location.reload();
            });
        });
      })
      .catch(function() {
        document.getElementById('hp-acc-body').innerHTML =
          '<div style="color:#e57373;text-align:center;padding:40px 0;">Failed to load account. Please try again.</div>';
      });
  };
  // Alias so bootstrap stub can call _real version
  window.__openAccountSettings = window.__openAccountSettings_real;

  // ── Inject Account Settings button into navbar ──────────────────────────────
  // Uses MutationObserver to re-inject after React re-renders the navbar on route change
  (function injectAccountBtn() {
    function makeAccBtn() {
      var btn = document.createElement('button');
      btn.setAttribute('data-testid', 'button-account');
      btn.setAttribute('aria-label', 'Account settings');
      btn.setAttribute('title', 'Account settings');
      btn.style.cssText = [
        'display:inline-flex;align-items:center;justify-content:center;',
        'height:2.25rem;width:2.25rem;min-width:44px;min-height:44px;',
        'border-radius:0.375rem;background:transparent;border:none;cursor:pointer;',
        'color:rgba(237,232,223,0.6);flex-shrink:0;'
      ].join('');
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+
          '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>'+
          '<circle cx="12" cy="7" r="4"/>'+
        '</svg>';
      btn.addEventListener('click', function() {
        if (typeof window.__openAccountSettings_real === 'function') window.__openAccountSettings_real();
        else if (typeof window.__openAccountSettings === 'function') window.__openAccountSettings();
      });
      return btn;
    }

    function tryInject() {
      var logoutBtn = document.querySelector('[data-testid="button-logout"]');
      if (!logoutBtn) return;
      if (document.querySelector('[data-testid="button-account"]')) return; // already there
      logoutBtn.parentNode.insertBefore(makeAccBtn(), logoutBtn);
      console.log('[HP] Account button injected');
    }

    // Initial injection attempt with polling
    var IV = setInterval(function() {
      if (document.querySelector('[data-testid="button-logout"]')) {
        tryInject();
        clearInterval(IV);
      }
    }, 400);
    setTimeout(function(){ clearInterval(IV); }, 20000);

    // MutationObserver — re-inject whenever React re-renders the navbar
    var observer = new MutationObserver(function() {
      tryInject();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  })();

  // Signal the bootstrap that hp-patches.js has fully loaded and all functions are ready
  window.__hp_patches_ready = true;
  // Drain any queued calls that arrived before we finished loading
  if (Array.isArray(window.__hp_patches_queue)) {
    var _q = window.__hp_patches_queue;
    window.__hp_patches_queue = [];
    for (var _i = 0; _i < _q.length; _i++) { try { _q[_i](); } catch(e) {} }
  }
  console.log('[HP] hp-patches.js ready');

  // ── Email Verification Screen ────────────────────────────────
  function checkAndHandleVerification() {
    var user = window.__hp_currentUser;
    if (!user) return;
    if (user.emailVerified) {
      // Check if this is a brand new user (0 cases) — show onboarding
      checkAndShowOnboarding();
      return;
    }

    // User is not verified — show verification gate
    var existing = document.getElementById('__hp_verify_gate');
    if (existing) return;

    var overlay = document.createElement('div');
    overlay.id = '__hp_verify_gate';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0a0f1e;display:flex;align-items:center;justify-content:center;padding:20px;';

    overlay.innerHTML = [
      '<div style="background:#111827;border-radius:16px;padding:40px;max-width:440px;width:100%;text-align:center;border:1px solid #1f2937;">',
        '<div style="font-size:40px;margin-bottom:16px;">📬</div>',
        '<h2 style="color:#f9fafb;font-size:20px;margin:0 0 12px;font-family:DM Sans,sans-serif;">Check your email</h2>',
        '<p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 24px;">',
          'We sent a verification link to <strong style="color:#e5e7eb;">' + (user.email || '') + '</strong>. ',
          'Click the link in that email to activate your account.',
        '</p>',
        '<div id="__hp_verify_status" style="min-height:20px;margin-bottom:16px;"></div>',
        '<button id="__hp_verify_check" style="width:100%;padding:13px;background:#1E2D4E;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:12px;">I\u2019ve verified \u2014 continue</button>',
        '<button id="__hp_verify_resend" style="width:100%;padding:13px;background:transparent;color:#6b7280;border:1px solid #374151;border-radius:10px;font-size:14px;cursor:pointer;">Resend verification email</button>',
        '<p style="color:#4b5563;font-size:12px;margin-top:20px;">Check your spam folder if you don’t see it. The link expires in 24 hours.</p>',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);

    // Handle URL token on load (user clicked link, came back to app)
    var hash = window.location.hash || '';
    var tokenMatch = hash.match(/[?&]token=([a-f0-9]+)/);
    if (tokenMatch) {
      var urlToken = tokenMatch[1];
      fetch(_RW + '/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: urlToken })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          if (window.__hp_currentUser) window.__hp_currentUser.emailVerified = true;
          overlay.remove();
          showVerifySuccess();
          checkAndShowOnboarding();
        }
      }).catch(function() {});
    }

    // "I’ve verified" button — re-check server
    document.getElementById('__hp_verify_check').addEventListener('click', function() {
      var btn = document.getElementById('__hp_verify_check');
      var status = document.getElementById('__hp_verify_status');
      btn.textContent = 'Checking...';
      btn.disabled = true;
      fetch(_RW + '/api/auth/me', { headers: __authHdr() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          var u = d.user || d;
          if (u.emailVerified) {
            if (window.__hp_currentUser) window.__hp_currentUser.emailVerified = true;
            overlay.remove();
            showVerifySuccess();
            checkAndShowOnboarding();
          } else {
            btn.textContent = 'I’ve verified — continue';
            btn.disabled = false;
            status.innerHTML = '<p style="color:#f87171;font-size:13px;">Email not verified yet. Check your inbox and click the link first.</p>';
          }
        }).catch(function() {
          btn.textContent = 'I’ve verified — continue';
          btn.disabled = false;
        });
    });

    // Resend button
    document.getElementById('__hp_verify_resend').addEventListener('click', function() {
      var btn = document.getElementById('__hp_verify_resend');
      var status = document.getElementById('__hp_verify_status');
      btn.textContent = 'Sending...';
      btn.disabled = true;
      fetch(_RW + '/api/auth/resend-verify', { method: 'POST', headers: __authHdr() })
        .then(function(r) { return r.json(); })
        .then(function() {
          status.innerHTML = '<p style="color:#A8B4D0;font-size:13px;">✓ New verification email sent — check your inbox.</p>';
          btn.textContent = 'Resend verification email';
          btn.disabled = false;
        }).catch(function() {
          btn.textContent = 'Resend verification email';
          btn.disabled = false;
        });
    });
  }

  function showVerifySuccess() {
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1E2D4E;color:#A8B4D0;padding:14px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
    toast.textContent = '✓ Email verified — welcome to Hearth & Page!';
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 4000);
  }

  // ── New User Onboarding ───────────────────────────────────────
  function checkAndShowOnboarding() {
    // Only show if user has 0 cases
    fetch(_RW + '/api/cases', { headers: __authHdr() })
      .then(function(r) { return r.json(); })
      .then(function(cases) {
        if (!Array.isArray(cases) || cases.length > 0) return; // has cases — skip
        showOnboarding();
      }).catch(function() {});
  }


  function showOnboarding() {
    if (document.getElementById('__hp_onboarding')) return;

    var overlay = document.createElement('div');
    overlay.id = '__hp_onboarding';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;padding:16px;font-family:DM Sans,sans-serif;';

    var ROUTING = {'married|divorce':{label:"Divorce",caseType:"form8-general,form36-divorce,form25a-divorce-order,form36b-certificate-divorce",icon:"\ud83d\udcc4"},'married|support':{label:"Child or spousal support",caseType:"form8-general,form13-financial",icon:"\ud83d\udcb0"},'married|property':{label:"Property & equalization",caseType:"form8-general,form13_1-property,form13b-net-family-property",icon:"\ud83c\udfe0"},'married|parenting':{label:"Custody & parenting time",caseType:"form8-general,form35_1-custody-affidavit",icon:"\ud83d\udc76"},'married|motion':{label:"Bring a motion",caseType:"form14-motion,form14a-affidavit,form14c-confirmation",icon:"\u2696\ufe0f"},'married|respond':{label:"Respond to an application",caseType:"form10-answer,form6b-service",icon:"\ud83d\udcec"},'married|change':{label:"Change an existing order",caseType:"form15-motion-to-change,form15c-consent-change,form15b-response-motion-change",icon:"\ud83d\udd04"},'married|conference':{label:"Prepare for a conference",caseType:"form17-conference-notice,form17e-trial-brief,form17f-confirmation-conference",icon:"\ud83d\udccb"},'common_law|support':{label:"Child or spousal support",caseType:"form8-general,form13-financial",icon:"\ud83d\udcb0"},'common_law|parenting':{label:"Custody & parenting time",caseType:"form8-general,form35_1-custody-affidavit",icon:"\ud83d\udc76"},'common_law|property':{label:"Property & equalization",caseType:"form8-general,form13_1-property",icon:"\ud83c\udfe0"},'common_law|motion':{label:"Bring a motion",caseType:"form14-motion,form14a-affidavit,form14c-confirmation",icon:"\u2696\ufe0f"},'common_law|respond':{label:"Respond to an application",caseType:"form10-answer,form6b-service",icon:"\ud83d\udcec"},'common_law|change':{label:"Change an existing order",caseType:"form15-motion-to-change,form15c-consent-change,form15b-response-motion-change",icon:"\ud83d\udd04"},'common_law|conference':{label:"Prepare for a conference",caseType:"form17-conference-notice,form17e-trial-brief,form17f-confirmation-conference",icon:"\ud83d\udccb"},'never_together|conference':{label:"Prepare for a conference",caseType:"form17-conference-notice,form17e-trial-brief,form17f-confirmation-conference",icon:"\ud83d\udccb"},'never_together|parenting':{label:"Custody & parenting time",caseType:"form8-general,form35_1-custody-affidavit",icon:"\ud83d\udc76"},'never_together|support':{label:"Child or spousal support",caseType:"form8-general,form13-financial",icon:"\ud83d\udcb0"},'never_together|motion':{label:"Bring a motion",caseType:"form14-motion,form14a-affidavit,form14c-confirmation",icon:"\u2696\ufe0f"},'never_together|respond':{label:"Respond to an application",caseType:"form10-answer,form6b-service",icon:"\ud83d\udcec",'married|safety':{label:"Protect myself or my children",caseType:"form25f-restraining-order-fla,form25g-restraining-order-clra",icon:"🛡️"},'married|enforcement':{label:"Enforce missed support payments",caseType:"form30a-default-hearing,form26-money-owed",icon:"⚖️"},'common_law|safety':{label:"Protect myself or my children",caseType:"form25f-restraining-order-fla,form25g-restraining-order-clra",icon:"🛡️"},'common_law|enforcement':{label:"Enforce missed support payments",caseType:"form30a-default-hearing,form26-money-owed",icon:"⚖️"},'never_together|safety':{label:"Protect myself or my children",caseType:"form25f-restraining-order-fla,form25g-restraining-order-clra",icon:"🛡️"},'never_together|enforcement':{label:"Enforce missed support payments",caseType:"form30a-default-hearing,form26-money-owed",icon:"⚖️"}}};

    // State
    var q1 = null, q2 = null;

    // ── Shared helpers ────────────────────────────────────────────────────
    function card(style) {
      var d = document.createElement('div');
      d.style.cssText = 'background:#111827;border-radius:18px;padding:36px 32px;max-width:540px;width:100%;border:1px solid #1f2937;position:relative;' + (style||'');
      return d;
    }

    function label(text) {
      var d = document.createElement('div');
      d.style.cssText = 'font-size:11px;color:#A8B4D0;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:12px;';
      d.textContent = text;
      return d;
    }

    function heading(text) {
      var h = document.createElement('h2');
      h.style.cssText = 'color:#f9fafb;font-size:22px;margin:0 0 8px;font-weight:700;line-height:1.3;';
      h.textContent = text;
      return h;
    }

    function sub(text) {
      var p = document.createElement('p');
      p.style.cssText = 'color:#6b7280;font-size:14px;margin:0 0 28px;line-height:1.6;';
      p.textContent = text;
      return p;
    }

    function optBtn(icon, title, desc, onClick) {
      var b = document.createElement('button');
      b.style.cssText = 'background:#1f2937;border:1.5px solid #374151;border-radius:12px;padding:16px 18px;text-align:left;cursor:pointer;width:100%;transition:border-color 0.15s,background 0.15s;display:flex;align-items:flex-start;gap:14px;margin-bottom:10px;';
      b.innerHTML = '<span style="font-size:26px;line-height:1;flex-shrink:0;margin-top:2px;">' + icon + '</span>'
        + '<span style="flex:1;">'
        + '<span style="display:block;font-weight:700;color:#f9fafb;font-size:15px;margin-bottom:3px;">' + title + '</span>'
        + (desc ? '<span style="display:block;color:#9ca3af;font-size:13px;line-height:1.45;">' + desc + '</span>' : '')
        + '</span>';
      b.addEventListener('mouseenter', function() { b.style.borderColor='#A8B4D0'; b.style.background='#1a2e35'; });
      b.addEventListener('mouseleave', function() { b.style.borderColor='#374151'; b.style.background='#1f2937'; });
      b.addEventListener('click', onClick);
      return b;
    }

    function backBtn(onClick) {
      var b = document.createElement('button');
      b.style.cssText = 'background:transparent;border:none;color:#4b5563;font-size:13px;cursor:pointer;margin-top:16px;padding:0;display:flex;align-items:center;gap:6px;';
      b.innerHTML = '<span style="font-size:16px;">←</span> Back';
      b.addEventListener('click', onClick);
      return b;
    }

    function skipBtn() {
      var b = document.createElement('button');
      b.style.cssText = 'background:transparent;border:none;color:#4b5563;font-size:13px;cursor:pointer;text-decoration:underline;margin-top:20px;display:block;';
      b.textContent = 'Skip — I\'ll choose forms myself';
      b.addEventListener('click', function() { overlay.remove(); });
      return b;
    }

    function progressDots(active) {
      var d = document.createElement('div');
      d.style.cssText = 'display:flex;gap:6px;margin-bottom:24px;';
      [0,1,2].forEach(function(i) {
        var dot = document.createElement('div');
        dot.style.cssText = 'width:' + (i===active?'20px':'6px') + ';height:6px;border-radius:3px;background:' + (i===active?'#A8B4D0':'#374151') + ';transition:all 0.2s;';
        d.appendChild(dot);
      });
      return d;
    }

    function setScreen(el) {
      overlay.innerHTML = '';
      overlay.appendChild(el);
    }

    // ── Screen 0: Welcome ─────────────────────────────────────────────────
    function showWelcome() {
      var c = card();
      c.innerHTML = [
        '<div style="width:44px;height:44px;background:linear-gradient(135deg,#1E2D4E,#2a3a5c);border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:24px;">',
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A8B4D0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
        '</div>',
        '<div style="font-size:11px;color:#A8B4D0;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:12px;">Welcome to Hearth & Page</div>',
        '<h2 style="color:#f9fafb;font-size:24px;margin:0 0 14px;font-weight:700;line-height:1.3;">You\'re not alone in this.</h2>',
        '<p style="color:#9ca3af;font-size:15px;margin:0 0 12px;line-height:1.7;">Family court paperwork can feel overwhelming. This tool walks you through Ontario\'s forms one step at a time — in plain language, at your own pace.</p>',
        '<p style="color:#9ca3af;font-size:15px;margin:0 0 28px;line-height:1.7;">We\'ll ask you three quick questions to find the right forms for your situation. It takes about 60 seconds.</p>',
        '<div style="background:rgba(30,45,78,0.25);border:1px solid rgba(30,45,78,0.40);border-radius:10px;padding:14px 16px;margin-bottom:28px;display:flex;gap:12px;align-items:flex-start;">',
          '<span style="color:#A8B4D0;font-size:18px;flex-shrink:0;">🔒</span>',
          '<span style="color:#6b7280;font-size:13px;line-height:1.5;">Everything you enter is saved privately to your account. Only you can see it.</span>',
        '</div>',
      ].join('');

      var startBtn = document.createElement('button');
      startBtn.style.cssText = 'background:#1E2D4E;color:#fff;border:none;border-radius:10px;padding:15px 28px;font-size:16px;font-weight:700;cursor:pointer;width:100%;transition:background 0.15s;';
      startBtn.textContent = "Let's get started →";
      startBtn.addEventListener('mouseenter', function() { startBtn.style.background='#2a3a5c'; });
      startBtn.addEventListener('mouseleave', function() { startBtn.style.background='#1E2D4E'; });
      startBtn.addEventListener('click', showQ1);
      c.appendChild(startBtn);

      var sk = document.createElement('button');
      sk.style.cssText = 'background:transparent;border:none;color:#4b5563;font-size:13px;cursor:pointer;text-decoration:underline;margin-top:16px;display:block;width:100%;text-align:center;';
      sk.textContent = 'Skip — I\'ll choose forms myself';
      sk.addEventListener('click', function() { overlay.remove(); });
      c.appendChild(sk);

      setScreen(c);
    }

    // ── Screen 1: Q1 — Relationship type ─────────────────────────────────
    function showQ1() {
      var c = card();
      c.appendChild(progressDots(0));
      c.appendChild(label('Step 1 of 3'));
      c.appendChild(heading('What was your relationship with the other person?'));
      c.appendChild(sub('This helps us show you the right forms. You can always change this later.'));

      c.appendChild(optBtn('💍', 'Married', 'We were legally married', function() { q1='married'; showQ2(); }));
      c.appendChild(optBtn('🏡', 'Common-law', 'We lived together but were not married', function() { q1='common_law'; showQ2(); }));
      c.appendChild(optBtn('👤', 'Never lived together', 'We share a child but were never in a relationship', function() { q1='never_together'; showQ2(); }));

      var bk = backBtn(showWelcome);
      c.appendChild(bk);
      c.appendChild(skipBtn());
      setScreen(c);
    }

    // ── Screen 2: Q2 — What do you need help with ─────────────────────────
    function showQ2() {
      var c = card();
      c.appendChild(progressDots(1));
      c.appendChild(label('Step 2 of 3'));
      c.appendChild(heading('What do you need help with?'));
      c.appendChild(sub('Pick the one that fits best. You can add more forms to your case later.'));

      var opts = [];
      if (q1 === 'married') {
        opts = [
          ['📄','Divorce','Apply for a divorce','divorce'],
          ['👶','Parenting & custody','Decide where children live, schedules & decision-making','parenting'],
          ['💰','Child or spousal support','Set, calculate, or change support payments','support'],
          ['🏠','Property & assets','Divide property, debts, and equalization','property'],
          ['🛡️','Protect myself or my children','Restraining order against harassment or danger','safety'],
          ['🔄','Change an existing order','Support, parenting, or other terms have changed','change'],
          ['📬','Respond to paperwork','Someone filed against me','respond'],
          ['⚖️','Bring a motion','Ask the court for a temporary or urgent order','motion'],
          ['📋','Prepare for a conference','Case, settlement, or trial management conference','conference'],
          ['⚖️','Enforce missed support payments','Payor has missed payments — default hearing','enforcement'],
        ];
      } else if (q1 === 'common_law') {
        opts = [
          ['👶','Parenting & custody','Decide where children live, schedules & decision-making','parenting'],
          ['💰','Child or spousal support','Set, calculate, or change support payments','support'],
          ['🏠','Property & assets','Divide shared property or debts','property'],
          ['🛡️','Protect myself or my children','Restraining order against harassment or danger','safety'],
          ['🔄','Change an existing order','Support, parenting, or other terms have changed','change'],
          ['📬','Respond to paperwork','Someone filed against me','respond'],
          ['⚖️','Bring a motion','Ask the court for a temporary or urgent order','motion'],
          ['📋','Prepare for a conference','Case, settlement, or trial management conference','conference'],
          ['⚖️','Enforce missed support payments','Payor has missed payments — default hearing','enforcement'],
        ];
      } else {
        opts = [
          ['👶','Parenting & custody','Decide where children live, schedules & decision-making','parenting'],
          ['💰','Child support','Set or change child support payments','support'],
          ['🛡️','Protect myself or my children','Restraining order against harassment or danger','safety'],
          ['🔄','Change an existing order','Support, parenting, or other terms have changed','change'],
          ['📬','Respond to paperwork','Someone filed against me','respond'],
          ['⚖️','Bring a motion','Ask the court for a temporary or urgent order','motion'],
          ['📋','Prepare for a conference','Case, settlement, or trial management conference','conference'],
          ['⚖️','Enforce missed support payments','Payor has missed payments — default hearing','enforcement'],
        ];
      }

      var scroll = document.createElement('div');
      scroll.style.cssText = 'max-height:420px;overflow-y:auto;margin-bottom:4px;padding-right:4px;-webkit-overflow-scrolling:touch;';
      // Scroll hint label
      var scrollHint = document.createElement('p');
      scrollHint.style.cssText = 'font-size:11px;color:rgba(156,163,175,0.6);text-align:center;margin:0 0 6px;';
      scrollHint.textContent = 'Scroll to see all options ↓';
      c.appendChild(scrollHint);
      opts.forEach(function(o) {
        scroll.appendChild(optBtn(o[0], o[1], o[2], function(val) { return function() { q2=val; showQ3(); }; }(o[3])));
      });
      c.appendChild(scroll);

      c.appendChild(backBtn(showQ1));
      c.appendChild(skipBtn());
      setScreen(c);
    }

    // ── Screen 3: Q3 — Has the other party filed? ─────────────────────────
    function showQ3() {
      var c = card();
      c.appendChild(progressDots(2));
      c.appendChild(label('Step 3 of 3'));
      c.appendChild(heading('Has the other person already filed paperwork with the court?'));
      c.appendChild(sub('If they filed first, you will need to file an Answer (Form 10) as well.'));

      c.appendChild(optBtn('📬','Yes — I received court documents from them','I need to respond', function() {
        // Override: if they've been served, always lead with Answer
        q2 = 'respond';
        finalize(true);
      }));
      c.appendChild(optBtn('📝','No — I am filing first','I am starting the process', function() { finalize(false); }));
      c.appendChild(optBtn('🤷','I\'m not sure','I\'ll figure it out with the forms', function() { finalize(false); }));

      c.appendChild(backBtn(showQ2));
      c.appendChild(skipBtn());
      setScreen(c);
    }

    // ── Finalize: resolve route and create case ────────────────────────────
    function finalize(theyFiled) {
      var key = q1 + '|' + q2;
      var route = ROUTING[key];

      if (!route) {
        // Fallback — open form selector
        overlay.remove();
        return;
      }

      var caseType = route.caseType;
      // If they were served first, prepend Answer if not already there
      if (theyFiled && caseType.indexOf('form10-answer') === -1) {
        caseType = 'form10-answer,form6b-service,' + caseType;
      }

      // ── Show the package screen as the conversion hook ──────────────────
      // Store pending package details so we can create the case after subscribe
      var pkgObj = window.__hp_packageScreen && window.__hp_packageScreen.PACKAGES
        ? (window.__hp_packageScreen.PACKAGES.find(function(p){ return p.id === window.__hp_packageScreen.inferPackage(caseType); }) ||
           window.__hp_packageScreen.PACKAGES.find(function(p){ return p.id === 'PKG-FULL-APP'; }))
        : null;

      window.__hp_pendingPackage = {
        title: route.label,
        caseType: caseType,
        pkgId: pkgObj ? pkgObj.id : null
      };

      var isPaid = (function() {
        var u = window.__hp_currentUser;
        if (!u) return false;
        return (u.subscriptionStatus === 'active' || u.subscriptionStatus === 'past_due') && u.plan !== 'free';
      })();

      overlay.remove();

      if (isPaid) {
        // Paid user — create case immediately (no gate)
        createFirstCase(route.label, caseType);
        return;
      }

      // Free user — show the full package screen with a subscribe CTA
      if (window.__hp_packageScreen && window.__hp_packageScreen.mountForQuiz) {
        window.__hp_packageScreen.mountForQuiz(caseType, route.label);
      } else {
        // Fallback: go straight to subscription page
        window.location.hash = '#/subscription';
      }
    }

    // ── Boot ──────────────────────────────────────────────────────────────
    document.body.appendChild(overlay);
    showWelcome();
  }

    function createFirstCase(title, caseType) {
    fetch(_RW + '/api/cases', {
      method: 'POST',
      headers: __authHdr(),
      body: JSON.stringify({ title: 'My ' + title + ' case', caseType: caseType })
    }).then(function(r) { return r.json(); })
      .then(function(newCase) {
        if (newCase.id) {
          // Show success toast
          var toast = document.createElement('div');
          toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1E2D4E;color:#A8B4D0;padding:14px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;';
          toast.textContent = '✓ Case created — let\u2019s get started';
          document.body.appendChild(toast);
          setTimeout(function() { toast.remove(); }, 3000);
          // Trigger React to refresh dashboard
          setTimeout(function() { window.dispatchEvent(new Event('hp:casecreated')); }, 300);
        } else if (newCase.code === 'SUBSCRIPTION_REQUIRED') {
          // Free user picked a locked form type — redirect to subscription
          if (window.location.hash !== '#/subscription') {
            window.location.hash = '#/subscription';
          }
        }
      }).catch(function() {});
  }

  // ── Free-to-paid conversion banner ────────────────────────────
  function injectConversionBanner() {
    var user = window.__hp_currentUser;
    if (!user) return;
    var isPaid = (user.subscriptionStatus === 'active' || user.subscriptionStatus === 'past_due') && user.plan !== 'free';
    if (isPaid) return; // paid users don’t see it
    if (document.getElementById('__hp_conversion_banner')) return;

    var banner = document.createElement('div');
    banner.id = '__hp_conversion_banner';
    banner.style.cssText = 'background:linear-gradient(135deg,#1E2D4E,#0284c7);padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;';
    banner.innerHTML = [
      '<div style="color:#fff;font-size:13px;line-height:1.4;">',
        '<strong>Form 8 is free.</strong> Subscribe to export court-ready PDFs and access all 35 Ontario forms.',
      '</div>',
      '<a href="#/subscription" style="background:#fff;color:#1E2D4E;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;white-space:nowrap;">See plans →</a>'
    ].join('');

    // Inject below navbar
    var navbar = document.querySelector('header,nav,[role=navigation],.navbar') || document.querySelector('#root > div > div');
    if (navbar && navbar.parentNode) {
      navbar.parentNode.insertBefore(banner, navbar.nextSibling);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }

  // ── Hook into app ready ────────────────────────────────────────
  // Watch for user data to appear in the React app
  var _ob_userCheckInterval = null;
  function startUserWatch() {
    if (_ob_userCheckInterval) return;
    _ob_userCheckInterval = setInterval(function() {
      // Try to get user from the auth/me endpoint if we have a token
      if (!window.__hp_token) return;
      if (window.__hp_currentUser) {
        clearInterval(_ob_userCheckInterval);
        _ob_userCheckInterval = null;
        checkAndHandleVerification();
        injectConversionBanner();
        return;
      }
      // Fetch user if not cached
      fetch(_RW + '/api/auth/me', { headers: __authHdr() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.user) {
            window.__hp_currentUser = d.user;
            clearInterval(_ob_userCheckInterval);
            _ob_userCheckInterval = null;
            checkAndHandleVerification();
            injectConversionBanner();
          }
        }).catch(function() {});
    }, 1500);
  }

  // Start watching after patches load
  setTimeout(startUserWatch, 2000);

  // Also trigger on login events
  var _orig_fetch = window.fetch;
  window.fetch = function(url) {
    var result = _orig_fetch.apply(this, arguments);
    if (typeof url === 'string' && (url.includes('/api/auth/login') || url.includes('/api/auth/register'))) {
      result.then(function(r) {
        return r.clone().json().catch(function() { return {}; });
      }).then(function(d) {
        if (d.token) {
          window.__hp_token = d.token;
          if (d.user) window.__hp_currentUser = d.user;
          setTimeout(function() {
            checkAndHandleVerification();
            injectConversionBanner();
          }, 800);
        }
      }).catch(function() {});
    }
    return result;
  };

    // Register FormEngine form definitions
  window.__hp_formDefs = window.__hp_formDefs || {};
  window.__hp_formDefs['ON-F8'] = {"formId":"ON-F8","jurisdiction":"ON","pdfFileName":"form8.pdf","title":"Form 8 \u2014 Application (General)","subtitle":"Ontario Family Court \u2014 Family Law Rules","requiredPlan":"free","freeForm":true,"parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 7","intro":"Choose your local Ontario Family Court. All documents you generate will be addressed to that courthouse.","fields":[{"fieldId":"courthouse","label":"Which courthouse will you be filing at?","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"helpText":"Choose the Ontario courthouse closest to where you or your children live.","pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"hasFile","label":"Is there already a court file open for this matter?","type":"yesno","source":"profile.case.hasFile","required":true,"pdfFieldName":"Has court file"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"conditional":{"dependsOn":"hasFile","showWhen":"yes"},"placeholder":"e.g. FC-2024-12345","helpText":"Found on any previous court documents or orders.","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"hasPriorOrders","label":"Have there been any previous court orders about this family?","type":"yesno","source":"profile.case.hasPriorOrders","required":true,"pdfFieldName":"Has prior orders"},{"fieldId":"priorOrdersDetails","label":"Briefly describe the previous orders","type":"textarea","source":"profile.case.priorOrdersDetails","required":false,"conditional":{"dependsOn":"hasPriorOrders","showWhen":"yes"},"placeholder":"e.g. Temporary custody order dated January 2023 \u2014 child lives with mother","pdfFieldName":"Prior orders details"}]},{"partId":"applicant","title":"About you","subtitle":"Step 2 of 7","intro":"This is information about you \u2014 the person filling this out.","fields":[{"fieldId":"applicantFullName","label":"Your full legal name","type":"text","source":"profile.applicant.fullName","required":true,"placeholder":"First Middle Last","pdfFieldName":"Applicant full name","id":"applicant_full_name","autoFill":"applicant_full_name"},{"fieldId":"applicantDob","label":"Your date of birth","type":"date","source":"profile.applicant.dob","required":true,"pdfFieldName":"Applicant DOB","id":"applicant_dob","autoFill":"user_dob"},{"fieldId":"applicantAddress","label":"Your street address","type":"text","source":"profile.applicant.address","required":true,"pdfFieldName":"Applicant address","id":"applicant_street","autoFill":"user_address"},{"fieldId":"applicantUnit","label":"Apartment / Unit number","type":"text","source":"profile.applicant.unit","required":false,"pdfFieldName":"Applicant unit"},{"fieldId":"applicantCity","label":"City or town","type":"text","source":"profile.applicant.city","required":true,"pdfFieldName":"Applicant city"},{"fieldId":"applicantPostalCode","label":"Postal code","type":"text","source":"profile.applicant.postalCode","required":true,"placeholder":"A1A 1A1","pdfFieldName":"Applicant postal code"},{"fieldId":"applicantPhone","label":"Phone number","type":"tel","source":"profile.applicant.phone","required":true,"pdfFieldName":"Applicant phone","id":"applicant_phone","autoFill":"user_phone"},{"fieldId":"applicantEmail","label":"Email address","type":"email","source":"profile.applicant.email","required":false,"pdfFieldName":"Applicant email","id":"applicant_email","autoFill":"user_email"}]},{"partId":"respondent","title":"About the other person","subtitle":"Step 3 of 7","intro":"This is information about the other party \u2014 your spouse, partner, or co-parent.","fields":[{"fieldId":"respondentFullName","label":"Their full legal name","type":"text","source":"profile.respondent.fullName","required":true,"pdfFieldName":"Respondent full name","id":"respondent_full_name","autoFill":"respondent_full_name"},{"fieldId":"respondentDob","label":"Their date of birth (if you know it)","type":"date","source":"profile.respondent.dob","required":false,"pdfFieldName":"Respondent DOB"},{"fieldId":"respondentAddress","label":"Their address (if you know it)","type":"text","source":"profile.respondent.address","required":false,"pdfFieldName":"Respondent address"},{"fieldId":"respondentPhone","label":"Their phone number (if you know it)","type":"tel","source":"profile.respondent.phone","required":false,"pdfFieldName":"Respondent phone"},{"fieldId":"respondentHasLawyer","label":"Do they have a lawyer?","type":"yesno","source":"profile.respondent.hasLawyer","required":true,"pdfFieldName":"Respondent has lawyer"},{"fieldId":"respondentLawyerName","label":"Lawyer's name","type":"text","source":"profile.respondent.lawyerName","required":false,"conditional":{"dependsOn":"respondentHasLawyer","showWhen":"yes"},"pdfFieldName":"Respondent lawyer name"},{"fieldId":"respondentLawyerFirm","label":"Law firm","type":"text","source":"profile.respondent.lawyerFirm","required":false,"conditional":{"dependsOn":"respondentHasLawyer","showWhen":"yes"},"pdfFieldName":"Respondent lawyer firm"},{"fieldId":"respondentLawyerPhone","label":"Lawyer's phone number","type":"tel","source":"profile.respondent.lawyerPhone","required":false,"conditional":{"dependsOn":"respondentHasLawyer","showWhen":"yes"},"pdfFieldName":"Respondent lawyer phone"}]},{"partId":"children","title":"Your children","subtitle":"Step 4 of 7","intro":"Tell us about the children involved in this case.","fields":[{"fieldId":"childrenCount","label":"How many children are involved?","type":"select","required":true,"options":["1","2","3","4","5","6+"],"pdfFieldName":"Number of children"},{"fieldId":"child1Name","label":"Child 1 \u2014 Full name","type":"text","required":true,"pdfFieldName":"Child 1 name"},{"fieldId":"child1Dob","label":"Child 1 \u2014 Date of birth","type":"date","required":true,"pdfFieldName":"Child 1 DOB"},{"fieldId":"child1Residence","label":"Child 1 \u2014 Currently lives with","type":"select","required":true,"options":["Me (the applicant)","The other party","Both of us (shared)","Other"],"pdfFieldName":"Child 1 residence"},{"fieldId":"child2Name","label":"Child 2 \u2014 Full name","type":"text","required":false,"conditional":{"dependsOn":"childrenCount","showWhen":["2","3","4","5","6+"]},"pdfFieldName":"Child 2 name"},{"fieldId":"child2Dob","label":"Child 2 \u2014 Date of birth","type":"date","required":false,"conditional":{"dependsOn":"childrenCount","showWhen":["2","3","4","5","6+"]},"pdfFieldName":"Child 2 DOB"},{"fieldId":"child2Residence","label":"Child 2 \u2014 Currently lives with","type":"select","required":false,"conditional":{"dependsOn":"childrenCount","showWhen":["2","3","4","5","6+"]},"options":["Me (the applicant)","The other party","Both of us (shared)","Other"],"pdfFieldName":"Child 2 residence"}]},{"partId":"claims","title":"What you're asking for","subtitle":"Step 5 of 7","intro":"Select everything you want the court to decide. You can ask for more than one thing.","fields":[{"fieldId":"claimCustody","label":"Decision-making responsibility (custody) for the children","type":"checkbox","pdfFieldName":"Claim custody"},{"fieldId":"claimAccess","label":"Parenting time (access) with the children","type":"checkbox","pdfFieldName":"Claim access"},{"fieldId":"claimChildSupport","label":"Child support","type":"checkbox","pdfFieldName":"Claim child support"},{"fieldId":"claimSpousalSupport","label":"Spousal support","type":"checkbox","pdfFieldName":"Claim spousal support"},{"fieldId":"claimPropertyDivision","label":"Division of property","type":"checkbox","pdfFieldName":"Claim property division"},{"fieldId":"claimRestrainingOrder","label":"Restraining or non-harassment order","type":"checkbox","pdfFieldName":"Claim restraining order"},{"fieldId":"claimOther","label":"Other (describe below)","type":"checkbox","pdfFieldName":"Claim other"},{"fieldId":"claimOtherDetails","label":"Describe what else you are asking for","type":"textarea","required":false,"conditional":{"dependsOn":"claimOther","showWhen":true},"pdfFieldName":"Claim other details"}]},{"partId":"situation","title":"Your situation","subtitle":"Step 6 of 7","intro":"Tell the court the key facts about your situation. Be factual and brief \u2014 you'll have affidavits to go into more detail.","fields":[{"fieldId":"relationshipType","label":"What was your relationship with the other party?","type":"select","required":true,"options":["Married","Common-law / Cohabiting","Never lived together"],"pdfFieldName":"Relationship type"},{"fieldId":"marriageDate","label":"Date of marriage","type":"date","source":"profile.case.marriageDate","required":false,"conditional":{"dependsOn":"relationshipType","showWhen":"Married"},"pdfFieldName":"Marriage date","id":"date_of_marriage","autoFill":"marriage_date"},{"fieldId":"separationDate","label":"Date of separation","type":"date","source":"profile.case.separationDate","required":true,"helpText":"The date you and the other party stopped living together as a couple.","pdfFieldName":"Separation date","id":"date_of_separation","autoFill":"separation_date"},{"fieldId":"situationSummary","label":"Briefly describe your situation and why you are coming to court","type":"textarea","required":true,"placeholder":"e.g. We separated in March 2024. We have two children. We cannot agree on parenting arrangements. I am seeking a court order for...","helpText":"2\u20135 sentences is enough here. Focus on facts, not feelings.","pdfFieldName":"Situation summary"}]},{"partId":"review","title":"Review and confirm","subtitle":"Step 7 of 7","intro":"Review your answers before generating your documents. You can go back to any step to make changes.","fields":[{"fieldId":"declarationConfirmed","label":"I confirm that the information I have provided is true and accurate to the best of my knowledge.","type":"checkbox","required":true,"helpText":"This form will be sworn or affirmed before a commissioner of oaths before it is filed with the court.","pdfFieldName":"Declaration confirmed"}]}]};
  window.__hp_formDefs['ON-F14'] = {"formId":"ON-F14","jurisdiction":"ON","pdfFileName":"form14.pdf","title":"Form 14 \u2014 Notice of Motion","subtitle":"Ontario Family Court \u2014 Family Law Rules (FLR 14)","requiredPlan":"standard","freeForm":false,"helpIntro":"A Notice of Motion tells the court and the other party that you want to ask for a temporary order \u2014 for example, temporary custody, support, or a restraining order \u2014 before your main case is decided. You must serve this form on the other party at least 6 business days before the motion date.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 6","intro":"We'll use your court information from your existing case file. Confirm or update the details below.","fields":[{"fieldId":"courthouse","label":"Which courthouse will hear this motion?","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"helpText":"This should be the same courthouse as your main case.","pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","helpText":"Found on any documents already filed in your case. Leave blank if you don't have one yet.","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"motionDate","label":"Date of the motion hearing","type":"date","required":true,"helpText":"Contact the court clerk to schedule a date before filling this in. You must serve this form at least 6 business days before this date.","pdfFieldName":"Motion date"},{"fieldId":"motionTime","label":"Time of the motion hearing","type":"text","required":true,"placeholder":"e.g. 9:30 a.m.","pdfFieldName":"Motion time"},{"fieldId":"hearingLocation","label":"Place of the hearing (courthouse address)","type":"text","required":true,"placeholder":"e.g. 393 University Ave, Toronto ON M5G 1E6","helpText":"Usually the same as the courthouse above. Your clerk can confirm the exact courtroom.","pdfFieldName":"Hearing location"}]},{"partId":"parties","title":"The parties","subtitle":"Step 2 of 6","intro":"Confirm your information and the other party's information. This auto-fills from your case profile.","fields":[{"fieldId":"applicantFullName","label":"Your full legal name (person making this motion)","type":"text","source":"profile.applicant.fullName","required":true,"pdfFieldName":"Applicant full name","id":"moving_party_name","autoFill":"applicant_full_name"},{"fieldId":"applicantAddress","label":"Your address for service","type":"text","source":"profile.applicant.address","required":true,"helpText":"This is the address where court documents can be delivered to you.","pdfFieldName":"Applicant address","id":"moving_party_address","autoFill":"user_address"},{"fieldId":"applicantCity","label":"City","type":"text","source":"profile.applicant.city","required":true,"pdfFieldName":"Applicant city"},{"fieldId":"applicantPostalCode","label":"Postal code","type":"text","source":"profile.applicant.postalCode","required":true,"placeholder":"A1A 1A1","pdfFieldName":"Applicant postal code"},{"fieldId":"applicantPhone","label":"Your phone number","type":"tel","source":"profile.applicant.phone","required":true,"pdfFieldName":"Applicant phone","id":"moving_party_phone","autoFill":"user_phone"},{"fieldId":"applicantEmail","label":"Your email address","type":"email","source":"profile.applicant.email","required":false,"pdfFieldName":"Applicant email","id":"moving_party_email","autoFill":"user_email"},{"fieldId":"respondentFullName","label":"Other party's full legal name","type":"text","source":"profile.respondent.fullName","required":true,"pdfFieldName":"Respondent full name","id":"other_party_name","autoFill":"respondent_full_name"},{"fieldId":"respondentAddress","label":"Other party's address for service","type":"text","source":"profile.respondent.address","required":false,"pdfFieldName":"Respondent address"},{"fieldId":"respondentPhone","label":"Other party's phone number","type":"tel","source":"profile.respondent.phone","required":false,"pdfFieldName":"Respondent phone"},{"fieldId":"respondentHasLawyer","label":"Does the other party have a lawyer?","type":"yesno","source":"profile.respondent.hasLawyer","required":true,"pdfFieldName":"Respondent has lawyer"},{"fieldId":"respondentLawyerName","label":"Other party's lawyer name","type":"text","source":"profile.respondent.lawyerName","required":false,"conditional":{"dependsOn":"respondentHasLawyer","showWhen":"yes"},"pdfFieldName":"Respondent lawyer name"},{"fieldId":"respondentLawyerAddress","label":"Lawyer's address","type":"text","required":false,"conditional":{"dependsOn":"respondentHasLawyer","showWhen":"yes"},"pdfFieldName":"Respondent lawyer address"},{"fieldId":"respondentLawyerPhone","label":"Lawyer's phone number","type":"tel","source":"profile.respondent.lawyerPhone","required":false,"conditional":{"dependsOn":"respondentHasLawyer","showWhen":"yes"},"pdfFieldName":"Respondent lawyer phone"}]},{"partId":"orders","title":"Orders you are asking for","subtitle":"Step 3 of 6","intro":"Select all the temporary orders you want the court to make at this motion. These are temporary \u2014 they last until your case is resolved or the court changes them.","fields":[{"fieldId":"orderTempCustody","label":"Temporary decision-making responsibility (custody)","type":"checkbox","pdfFieldName":"Order temp custody"},{"fieldId":"orderTempParentingTime","label":"Temporary parenting time (access) schedule","type":"checkbox","pdfFieldName":"Order temp parenting time"},{"fieldId":"orderTempChildSupport","label":"Temporary child support","type":"checkbox","pdfFieldName":"Order temp child support"},{"fieldId":"orderTempSpousalSupport","label":"Temporary spousal support","type":"checkbox","pdfFieldName":"Order temp spousal support"},{"fieldId":"orderRestrainingOrder","label":"Restraining or non-harassment order","type":"checkbox","pdfFieldName":"Order restraining order"},{"fieldId":"orderExclusivePossession","label":"Exclusive possession of the family home","type":"checkbox","pdfFieldName":"Order exclusive possession"},{"fieldId":"orderChangeExisting","label":"Change or set aside an existing order","type":"checkbox","pdfFieldName":"Order change existing"},{"fieldId":"orderOther","label":"Other order (describe below)","type":"checkbox","pdfFieldName":"Order other"},{"fieldId":"orderOtherDetails","label":"Describe the other order you are asking for","type":"textarea","required":false,"conditional":{"dependsOn":"orderOther","showWhen":true},"placeholder":"Describe clearly what you want the court to order.","pdfFieldName":"Order other details"},{"fieldId":"ordersDetailedDescription","label":"In your own words, describe the specific orders you are asking for (Page 2 of Form 14)","type":"textarea","required":true,"placeholder":"e.g. 1. That the Applicant have temporary decision-making responsibility for the child Alex Lance, born April 12, 2015.\n2. That the Respondent pay child support of $X per month commencing [date].\n3. That the Respondent be restrained from attending at [address].","helpText":"Write each order you want as a numbered sentence. Be specific \u2014 include names, amounts, and dates where possible. A judge will read exactly what you write here.","pdfFieldName":"Orders detailed description"}]},{"partId":"evidence","title":"Supporting evidence","subtitle":"Step 4 of 6","intro":"Tell the court what documents you are attaching to support this motion.","fields":[{"fieldId":"hasAffidavit","label":"Are you filing a Form 14A Affidavit with this motion?","type":"yesno","required":true,"helpText":"Almost always yes. The affidavit is where you explain the facts behind your motion in detail.","pdfFieldName":"Has affidavit"},{"fieldId":"hasCaseConferenceNotice","label":"Are you also serving a Notice of Case Conference with this motion?","type":"yesno","required":true,"helpText":"Required if you are asking to change an existing order.","pdfFieldName":"Has case conference notice"},{"fieldId":"continuingRecordDocuments","label":"List any other documents in the Continuing Record you are relying on","type":"textarea","required":false,"placeholder":"e.g. Volume 1, Tab 3 \u2014 Financial Statement dated January 2024\nVolume 1, Tab 5 \u2014 Prior Order dated March 2023","helpText":"Leave blank if this is your first court document. The Continuing Record is the binder of all documents filed in your case.","pdfFieldName":"Continuing record documents"},{"fieldId":"urgencyReason","label":"Is this an urgent motion? If yes, briefly explain why.","type":"textarea","required":false,"placeholder":"e.g. The child is at risk of harm. I am asking for an emergency order without notice because...","helpText":"Only fill this in if you are asking the court to hear this motion on an urgent basis or without notifying the other party first (ex parte).","pdfFieldName":"Urgency reason"}]},{"partId":"service","title":"Serving the other party","subtitle":"Step 5 of 6","intro":"You must give the other party a copy of this Notice of Motion and all supporting documents at least 6 business days before the motion date. After you serve them you must fill out Form 6B (Affidavit of Service).","fields":[{"fieldId":"serviceMethod","label":"How will you serve the other party?","type":"select","required":true,"options":["By hand (personal service)","By mail","By email (if they have agreed or if the court has ordered it)","Through their lawyer","By courier"],"helpText":"If the other party has a lawyer, serve the lawyer \u2014 not the person directly.","pdfFieldName":"Service method"},{"fieldId":"servicePlannedDate","label":"When do you plan to serve the other party?","type":"date","required":false,"helpText":"Must be at least 6 business days before your motion date.","pdfFieldName":"Service planned date"},{"fieldId":"form14cReminder","label":"I understand I must file Form 14C (Confirmation of Motion) no later than 2:00 p.m., 3 business days before the motion date.","type":"checkbox","required":true,"helpText":"If you do not file Form 14C on time, your motion may be removed from the list and you will have to reschedule.","pdfFieldName":"Form 14C reminder acknowledged"}]},{"partId":"review","title":"Review and sign","subtitle":"Step 6 of 6","intro":"Review your Notice of Motion below. When you are ready, confirm and generate your form.","fields":[{"fieldId":"signatureDate","label":"Date you are signing this form","type":"date","required":true,"pdfFieldName":"Signature date"},{"fieldId":"declarationConfirmed","label":"I confirm the information in this Notice of Motion is accurate. I understand this document will be filed with the Ontario court.","type":"checkbox","required":true,"pdfFieldName":"Declaration confirmed"}]}]};
  window.__hp_formDefs['ON-F14A'] = {"formId":"ON-F14A","jurisdiction":"ON","pdfFileName":"form14a.pdf","title":"Form 14A \u2014 Affidavit (General)","subtitle":"Ontario Family Court \u2014 Family Law Rules (FLR 14A)","requiredPlan":"standard","freeForm":false,"helpIntro":"An Affidavit is a sworn statement of facts that supports your motion. You write out the facts \u2014 the who, what, when, and where \u2014 and then sign it in front of a commissioner of oaths (available at the courthouse or at most lawyers' offices, often for free). This is the document where you tell your story to the judge.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 7","intro":"This pulls from your existing case file. Confirm the court details.","fields":[{"fieldId":"courthouse","label":"Courthouse name","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","id":"courthouse_name","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"affidavitDate","label":"Date of this affidavit","type":"date","required":true,"helpText":"The date you will sign this in front of the commissioner of oaths.","pdfFieldName":"Affidavit date"}]},{"partId":"parties","title":"The parties","subtitle":"Step 2 of 7","intro":"Confirm both parties' information. This auto-fills from your profile.","fields":[{"fieldId":"applicantFullName","label":"Applicant's full legal name","type":"text","source":"profile.applicant.fullName","required":true,"pdfFieldName":"Applicant full name","id":"applicant_full_name","autoFill":"applicant_full_name"},{"fieldId":"applicantAddress","label":"Applicant's address for service","type":"text","source":"profile.applicant.address","required":true,"pdfFieldName":"Applicant address"},{"fieldId":"applicantCity","label":"City","type":"text","source":"profile.applicant.city","required":true,"pdfFieldName":"Applicant city"},{"fieldId":"applicantPostalCode","label":"Postal code","type":"text","source":"profile.applicant.postalCode","required":true,"pdfFieldName":"Applicant postal code"},{"fieldId":"applicantPhone","label":"Phone number","type":"tel","source":"profile.applicant.phone","required":true,"pdfFieldName":"Applicant phone"},{"fieldId":"respondentFullName","label":"Respondent's full legal name","type":"text","source":"profile.respondent.fullName","required":true,"pdfFieldName":"Respondent full name","id":"respondent_full_name","autoFill":"respondent_full_name"},{"fieldId":"respondentAddress","label":"Respondent's address (if known)","type":"text","source":"profile.respondent.address","required":false,"pdfFieldName":"Respondent address"}]},{"partId":"deponent","title":"About you (the deponent)","subtitle":"Step 3 of 7","intro":"The 'deponent' is the person swearing or affirming this affidavit \u2014 that's you. These details go at the top of the affidavit.","fields":[{"fieldId":"deponentFullName","label":"Your full legal name","type":"text","source":"profile.applicant.fullName","required":true,"helpText":"As it will appear on the sworn affidavit.","pdfFieldName":"Deponent full name","id":"deponent_name","autoFill":"applicant_full_name"},{"fieldId":"deponentMunicipality","label":"Municipality and province where you live","type":"text","required":true,"placeholder":"e.g. Toronto, Ontario","helpText":"The form reads: 'I live in [municipality & province]'.","pdfFieldName":"Deponent municipality"},{"fieldId":"swearOrAffirm","label":"Will you swear (religious oath) or affirm (non-religious)?","type":"select","required":true,"options":["Swear","Affirm"],"helpText":"Both are legally equal. Choose whichever you are comfortable with.","pdfFieldName":"Swear or affirm"}]},{"partId":"background","title":"Background facts","subtitle":"Step 4 of 7","intro":"Provide the factual background of your situation. Write clearly and stick to facts \u2014 not opinions or emotions. Each paragraph should cover one fact.","fields":[{"fieldId":"relationshipBackground","label":"Describe your relationship with the other party","type":"textarea","required":true,"placeholder":"e.g. I was married to the Respondent Jane Doe on June 15, 2012. We lived together at 123 Main Street, Toronto, Ontario. We separated on March 1, 2024.","helpText":"Include: how you are related, when the relationship started, when and how it ended.","pdfFieldName":"Relationship background"},{"fieldId":"childrenBackground","label":"Describe the children involved (if any)","type":"textarea","required":false,"placeholder":"e.g. We have one child together: Alex Lance, born April 12, 2015. Alex currently lives with me at 123 Main Street, Toronto.","helpText":"Include: each child's name, date of birth, and where they are currently living. Leave blank if there are no children.","pdfFieldName":"Children background"},{"fieldId":"currentArrangements","label":"What is happening right now? (current living/parenting arrangements)","type":"textarea","required":true,"placeholder":"e.g. Since our separation, Alex has been living with me. The Respondent sees Alex every other weekend. There is no formal court order in place.","helpText":"Describe the current situation \u2014 where everyone is living, what parenting time looks like, what support if any is being paid.","pdfFieldName":"Current arrangements"}]},{"partId":"motionFacts","title":"Facts supporting your motion","subtitle":"Step 5 of 7","intro":"This is the most important part. Explain the facts that make your motion necessary. Be specific \u2014 include dates, names, and what happened. Write in numbered paragraphs.","fields":[{"fieldId":"whyMotionNeeded","label":"Why are you bringing this motion? What has happened that makes a court order necessary?","type":"textarea","required":true,"placeholder":"e.g. 1. On May 1, 2026, the Respondent informed me that she intended to move with Alex to Calgary, Alberta without my consent.\n2. I attempted to discuss this with the Respondent on May 5, 2026, but she refused to communicate.\n3. I am concerned that if the Respondent moves, I will be denied parenting time with Alex.","helpText":"Number each paragraph. Each paragraph = one fact. Include who did what, when, and where. Do not include opinions \u2014 only facts you personally know or witnessed.","pdfFieldName":"Why motion needed"},{"fieldId":"ordersRequested","label":"What specific orders are you asking the court to make?","type":"textarea","required":true,"placeholder":"e.g. 1. An order that the Applicant have temporary decision-making responsibility for Alex Lance.\n2. An order that the Respondent not relocate with Alex outside of Toronto without court permission.\n3. An order for child support of $X per month.","helpText":"These should match the orders listed on your Form 14. Be specific about what you want.","pdfFieldName":"Orders requested in affidavit"},{"fieldId":"bestInterestsExplanation","label":"Why are these orders in the best interests of the children? (if children are involved)","type":"textarea","required":false,"placeholder":"e.g. Alex is enrolled in school in Toronto and has a strong support network of family and friends here. Relocating to Calgary would disrupt Alex's education and my ongoing relationship with Alex.","helpText":"The court's primary concern is always what is best for the children. Explain why your requested orders serve the children's needs.","pdfFieldName":"Best interests explanation"},{"fieldId":"urgencyExplanation","label":"Is this urgent? If yes, explain why it cannot wait.","type":"textarea","required":false,"placeholder":"e.g. The Respondent has stated she plans to move on July 1, 2026. Without an emergency order, the move will happen before this matter can be heard in the normal course.","helpText":"Only fill this in if you need the court to hear this motion on an urgent basis.","pdfFieldName":"Urgency explanation"}]},{"partId":"exhibits","title":"Exhibits (attachments)","subtitle":"Step 6 of 7","intro":"List any documents you are attaching to this affidavit as exhibits. Label them Exhibit A, B, C, etc. in the order you mention them.","fields":[{"fieldId":"hasExhibits","label":"Are you attaching any documents to this affidavit?","type":"yesno","required":true,"helpText":"Examples: text messages, emails, photos, prior court orders, letters.","pdfFieldName":"Has exhibits"},{"fieldId":"exhibitsList","label":"List your exhibits","type":"textarea","required":false,"conditional":{"dependsOn":"hasExhibits","showWhen":"yes"},"placeholder":"Exhibit A \u2014 Text messages between myself and the Respondent dated May 1\u201310, 2026\nExhibit B \u2014 Prior court order dated March 15, 2023\nExhibit C \u2014 Alex's school enrollment records","helpText":"For each exhibit: write the letter, then what it is and the date. Attach the actual document behind the affidavit when you file.","pdfFieldName":"Exhibits list"},{"fieldId":"exhibitsReferenced","label":"Have you referenced each exhibit by letter in the facts section above?","type":"yesno","required":false,"conditional":{"dependsOn":"hasExhibits","showWhen":"yes"},"helpText":"e.g. 'Attached as Exhibit A is a copy of the text messages.' The form requires you to identify each exhibit where it is first mentioned.","pdfFieldName":"Exhibits referenced in body"}]},{"partId":"swearing","title":"Swearing / commissioning","subtitle":"Step 7 of 7","intro":"This section will be completed in front of a commissioner of oaths. You cannot sign this affidavit without a commissioner present \u2014 doing so makes it invalid.","fields":[{"fieldId":"commissionerLocation","label":"Where will you swear/affirm this affidavit?","type":"select","required":false,"options":["At the courthouse","At a lawyer's office","At a notary public's office","At a Service Ontario location","Other"],"helpText":"Commissioners of oaths are available free of charge at most Ontario courthouses.","pdfFieldName":"Commissioner location"},{"fieldId":"commissionerMunicipality","label":"Municipality where it will be sworn","type":"text","required":false,"placeholder":"e.g. Toronto","pdfFieldName":"Commissioner municipality"},{"fieldId":"commissionerProvince","label":"Province","type":"text","required":false,"placeholder":"Ontario","pdfFieldName":"Commissioner province"},{"fieldId":"commissioningDate","label":"Date to be commissioned (leave blank to fill at the courthouse)","type":"date","required":false,"pdfFieldName":"Commissioning date"},{"fieldId":"declarationConfirmed","label":"I understand I must sign this affidavit in front of a commissioner of oaths for it to be valid. I confirm the facts I have written are true.","type":"checkbox","required":true,"helpText":"Swearing a false affidavit is perjury \u2014 a criminal offence. Only include facts you know to be true.","pdfFieldName":"Declaration confirmed"}]}]};
  window.__hp_formDefs['ON-F6B'] = {"formId":"ON-F6B","jurisdiction":"ON","pdfFileName":"form6b.pdf","title":"Form 6B \u2014 Affidavit of Service","subtitle":"Ontario Family Court \u2014 Family Law Rules (FLR 6)","requiredPlan":"standard","freeForm":false,"helpIntro":"After you serve any court document on the other party, you must file an Affidavit of Service (Form 6B) with the court to prove the documents were delivered. You swear or affirm this form in front of a commissioner of oaths. You need one Form 6B for each time you serve documents.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 5","intro":"Confirm the court file this service relates to.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"applicantFullName","label":"Applicant's full legal name","type":"text","source":"profile.applicant.fullName","required":true,"pdfFieldName":"Applicant full name","id":"applicant_full_name","autoFill":"applicant_full_name"},{"fieldId":"respondentFullName","label":"Respondent's full legal name","type":"text","source":"profile.respondent.fullName","required":true,"pdfFieldName":"Respondent full name","id":"respondent_full_name","autoFill":"respondent_full_name"}]},{"partId":"server","title":"Who served the documents?","subtitle":"Step 2 of 5","intro":"The person who physically delivered or sent the documents fills out this section. That can be you, or someone you asked to serve on your behalf (a friend, process server, etc.).","fields":[{"fieldId":"serverFullName","label":"Full name of the person who served the documents","type":"text","source":"profile.applicant.fullName","required":true,"helpText":"If you served the documents yourself, enter your own name. If someone else served them, enter their name \u2014 they will need to sign this affidavit.","pdfFieldName":"Server full name"},{"fieldId":"serverAge","label":"Age of the person who served the documents","type":"text","required":true,"placeholder":"e.g. 34","helpText":"Must be 18 years of age or older to serve court documents in Ontario.","pdfFieldName":"Server age"},{"fieldId":"serverAddress","label":"Server's address","type":"text","required":true,"helpText":"The home or business address of the person who did the serving.","pdfFieldName":"Server address"},{"fieldId":"serverCity","label":"City","type":"text","required":true,"pdfFieldName":"Server city"},{"fieldId":"serverProvince","label":"Province","type":"text","required":true,"placeholder":"Ontario","pdfFieldName":"Server province"},{"fieldId":"serverPostalCode","label":"Postal code","type":"text","required":true,"pdfFieldName":"Server postal code"}]},{"partId":"documents","title":"Documents that were served","subtitle":"Step 3 of 5","intro":"List every document you delivered to the other party in this batch of service.","fields":[{"fieldId":"documentsList","label":"List the documents that were served","type":"textarea","required":true,"placeholder":"Form 8 \u2014 Application (dated June 1, 2026)\nForm 14 \u2014 Notice of Motion (dated June 15, 2026)\nForm 14A \u2014 Affidavit (dated June 15, 2026)","helpText":"List each document on a separate line. Include the form number, the document name, and the date on it.","pdfFieldName":"Documents list"}]},{"partId":"serviceDetails","title":"How and where the documents were served","subtitle":"Step 4 of 5","intro":"Describe exactly how you delivered the documents. The method of service affects when the other party is considered to have received them.","fields":[{"fieldId":"personServed","label":"Full name of the person who was served","type":"text","source":"profile.respondent.fullName","required":true,"helpText":"Usually the other party. If they have a lawyer, you may serve the lawyer instead.","pdfFieldName":"Person served"},{"fieldId":"serviceMethod","label":"How were the documents served?","type":"select","required":true,"options":["Personal service \u2014 handed directly to the person","Leaving with adult at residence \u2014 left with another adult at their home","Leaving with adult at business \u2014 left with person in charge or adult employee","Regular mail \u2014 sent by Canada Post","Courier \u2014 sent by courier service","Email \u2014 sent by email (with prior agreement or court order)","Fax \u2014 sent by fax","Acceptance by lawyer \u2014 lawyer accepted on their client's behalf","Other (describe below)"],"pdfFieldName":"Service method"},{"fieldId":"serviceMethodOther","label":"Describe the other method of service","type":"textarea","required":false,"conditional":{"dependsOn":"serviceMethod","showWhen":"Other (describe below)"},"placeholder":"Describe how the documents were served.","pdfFieldName":"Service method other"},{"fieldId":"serviceDate","label":"Date the documents were served","type":"date","required":true,"helpText":"The actual date you handed over, mailed, emailed, or couriered the documents.","pdfFieldName":"Service date"},{"fieldId":"serviceTime","label":"Time the documents were served (if personal service)","type":"text","required":false,"placeholder":"e.g. 2:30 p.m.","helpText":"Only required for personal service (hand delivery).","pdfFieldName":"Service time"},{"fieldId":"serviceAddress","label":"Address where service took place","type":"text","required":true,"placeholder":"e.g. 456 Oak Street, Toronto, ON M4B 1B2","helpText":"For mail/email, use the address it was sent to. For personal service, the place where documents were handed over.","pdfFieldName":"Service address"},{"fieldId":"personReceivedDescription","label":"If you served a person other than the named party, describe who received the documents","type":"textarea","required":false,"placeholder":"e.g. A woman who identified herself as the Respondent's spouse, approximately 40 years old.","helpText":"For example, if you left documents with an adult at the respondent's home, describe that person.","pdfFieldName":"Person received description"},{"fieldId":"emailAddress","label":"Email address documents were sent to (if served by email)","type":"email","required":false,"conditional":{"dependsOn":"serviceMethod","showWhen":"Email \u2014 sent by email (with prior agreement or court order)"},"pdfFieldName":"Email address served to"},{"fieldId":"emailConfirmationReceived","label":"Did you receive confirmation the email was delivered or opened?","type":"yesno","required":false,"conditional":{"dependsOn":"serviceMethod","showWhen":"Email \u2014 sent by email (with prior agreement or court order)"},"pdfFieldName":"Email confirmation received"}]},{"partId":"swearing","title":"Swearing / commissioning","subtitle":"Step 5 of 5","intro":"This affidavit must be signed in front of a commissioner of oaths. The commissioner will complete the bottom section. Commissioners are available free at most Ontario courthouses.","fields":[{"fieldId":"swearOrAffirm","label":"Will you swear or affirm?","type":"select","required":true,"options":["Swear","Affirm"],"helpText":"Both are legally equal. Swearing is a religious oath; affirming is a non-religious promise.","pdfFieldName":"Swear or affirm"},{"fieldId":"commissioningMunicipality","label":"Municipality where it will be commissioned","type":"text","required":false,"placeholder":"e.g. Toronto","pdfFieldName":"Commissioning municipality"},{"fieldId":"commissioningDate","label":"Date it will be commissioned (leave blank to fill at courthouse)","type":"date","required":false,"pdfFieldName":"Commissioning date"},{"fieldId":"declarationConfirmed","label":"I confirm the service described above took place as stated, and I understand this must be signed in front of a commissioner of oaths.","type":"checkbox","required":true,"pdfFieldName":"Declaration confirmed"}]}]};
  window.__hp_formDefs['ON-F10'] = {"formId":"ON-F10","jurisdiction":"ON","pdfFileName":"form10.pdf","title":"Form 10 \u2014 Answer","subtitle":"Ontario Family Court \u2014 Family Law Rules (FLR 10)","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 10 is the Answer \u2014 it is how you formally respond when someone has filed a court application against you (Form 8). You use it to agree with or disagree with what the applicant is asking for, and to ask for your own orders from the court. You must serve your Answer on the applicant and file it with the court within 30 days of being served with the Application.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 7","intro":"Enter the court file information from the Application (Form 8) you received.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number (from the Application you received)","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","helpText":"This is printed on the Form 8 Application that was served on you.","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"applicationDate","label":"Date printed on the Application you received","type":"date","required":false,"helpText":"Found at the top of the Form 8 Application.","pdfFieldName":"Application date"}]},{"partId":"respondentInfo","title":"Your information (the respondent)","subtitle":"Step 2 of 7","intro":"You are the respondent \u2014 the person responding to the application. Fill in your details.","fields":[{"fieldId":"respondentFullName","label":"Your full legal name","type":"text","source":"profile.applicant.fullName","required":true,"helpText":"In the Answer form, you are called the 'Respondent'. Your name auto-fills from your profile.","pdfFieldName":"Respondent full name","id":"respondent_full_name","autoFill":"respondent_full_name"},{"fieldId":"respondentDateOfBirth","label":"Your date of birth","type":"date","source":"profile.applicant.dateOfBirth","required":false,"pdfFieldName":"Respondent date of birth","id":"respondent_dob","autoFill":"user_dob"},{"fieldId":"respondentAddress","label":"Your address for service","type":"text","source":"profile.applicant.address","required":true,"helpText":"This is where court documents can be delivered to you.","pdfFieldName":"Respondent address","id":"respondent_address","autoFill":"user_address"},{"fieldId":"respondentCity","label":"City","type":"text","source":"profile.applicant.city","required":true,"pdfFieldName":"Respondent city"},{"fieldId":"respondentProvince","label":"Province","type":"text","required":true,"placeholder":"Ontario","pdfFieldName":"Respondent province"},{"fieldId":"respondentPostalCode","label":"Postal code","type":"text","source":"profile.applicant.postalCode","required":true,"pdfFieldName":"Respondent postal code"},{"fieldId":"respondentPhone","label":"Phone number","type":"tel","source":"profile.applicant.phone","required":true,"pdfFieldName":"Respondent phone","id":"respondent_phone","autoFill":"user_phone"},{"fieldId":"respondentEmail","label":"Email address","type":"email","source":"profile.applicant.email","required":false,"pdfFieldName":"Respondent email","id":"respondent_email","autoFill":"user_email"},{"fieldId":"respondentHasLawyer","label":"Do you have a lawyer representing you?","type":"yesno","required":true,"pdfFieldName":"Respondent has lawyer"},{"fieldId":"respondentLawyerName","label":"Your lawyer's full name","type":"text","required":false,"conditional":{"dependsOn":"respondentHasLawyer","showWhen":"yes"},"pdfFieldName":"Respondent lawyer name"},{"fieldId":"respondentLawyerAddress","label":"Your lawyer's address","type":"text","required":false,"conditional":{"dependsOn":"respondentHasLawyer","showWhen":"yes"},"pdfFieldName":"Respondent lawyer address"},{"fieldId":"respondentLawyerPhone","label":"Your lawyer's phone number","type":"tel","required":false,"conditional":{"dependsOn":"respondentHasLawyer","showWhen":"yes"},"pdfFieldName":"Respondent lawyer phone"}]},{"partId":"applicantInfo","title":"The other party (the applicant)","subtitle":"Step 3 of 7","intro":"Confirm the details of the person who filed the Application against you.","fields":[{"fieldId":"applicantFullName","label":"The applicant's full legal name","type":"text","source":"profile.respondent.fullName","required":true,"pdfFieldName":"Applicant full name","id":"applicant_full_name","autoFill":"applicant_full_name"},{"fieldId":"applicantAddress","label":"The applicant's address for service","type":"text","source":"profile.respondent.address","required":false,"pdfFieldName":"Applicant address"},{"fieldId":"applicantHasLawyer","label":"Does the applicant have a lawyer?","type":"yesno","required":false,"pdfFieldName":"Applicant has lawyer"},{"fieldId":"applicantLawyerName","label":"Applicant's lawyer's name","type":"text","required":false,"conditional":{"dependsOn":"applicantHasLawyer","showWhen":"yes"},"pdfFieldName":"Applicant lawyer name"},{"fieldId":"applicantLawyerAddress","label":"Applicant's lawyer's address","type":"text","required":false,"conditional":{"dependsOn":"applicantHasLawyer","showWhen":"yes"},"pdfFieldName":"Applicant lawyer address"}]},{"partId":"responseToApplication","title":"Your response to the Application","subtitle":"Step 4 of 7","intro":"Go through each thing the applicant is asking for and say whether you agree or disagree. You can also ask for your own orders in the next step.","fields":[{"fieldId":"overallPosition","label":"Overall, what is your position on the Application?","type":"select","required":true,"options":["I disagree with everything the applicant is asking for","I agree with some things and disagree with others","I agree with everything the applicant is asking for","I agree with most things but want to add my own requests"],"pdfFieldName":"Overall position"},{"fieldId":"agreeCustody","label":"Do you agree with the applicant's request about custody / decision-making?","type":"select","required":false,"options":["Yes \u2014 I agree","No \u2014 I disagree","Partly agree","This was not requested","I have my own proposal (describe below)"],"pdfFieldName":"Agree custody"},{"fieldId":"custodyPosition","label":"Describe your position on custody / decision-making","type":"textarea","required":false,"conditional":{"dependsOn":"agreeCustody","showWhen":"No \u2014 I disagree"},"placeholder":"e.g. I disagree. I am the primary caregiver and the children should reside primarily with me. I propose that both parents share decision-making but that the children live with me.","helpText":"Be specific. What arrangement do you propose instead?","pdfFieldName":"Custody position"},{"fieldId":"agreeParentingTime","label":"Do you agree with the applicant's request about parenting time / access?","type":"select","required":false,"options":["Yes \u2014 I agree","No \u2014 I disagree","Partly agree","This was not requested","I have my own proposal (describe below)"],"pdfFieldName":"Agree parenting time"},{"fieldId":"parentingTimePosition","label":"Describe your proposed parenting time schedule","type":"textarea","required":false,"conditional":{"dependsOn":"agreeParentingTime","showWhen":"No \u2014 I disagree"},"placeholder":"e.g. I propose that the children live with me week-on, week-off. The Applicant would have parenting time every other weekend.","pdfFieldName":"Parenting time position"},{"fieldId":"agreeChildSupport","label":"Do you agree with the applicant's request about child support?","type":"select","required":false,"options":["Yes \u2014 I agree","No \u2014 I disagree","Partly agree","This was not requested","I have my own proposal (describe below)"],"pdfFieldName":"Agree child support"},{"fieldId":"childSupportPosition","label":"Describe your position on child support","type":"textarea","required":false,"conditional":{"dependsOn":"agreeChildSupport","showWhen":"No \u2014 I disagree"},"placeholder":"e.g. I disagree with the amount requested. Based on my income of $X per year, the correct amount under the Child Support Guidelines is $Y per month.","pdfFieldName":"Child support position"},{"fieldId":"agreeSpousalSupport","label":"Do you agree with the applicant's request about spousal support?","type":"select","required":false,"options":["Yes \u2014 I agree","No \u2014 I disagree","Partly agree","This was not requested","Not applicable"],"pdfFieldName":"Agree spousal support"},{"fieldId":"spousalSupportPosition","label":"Describe your position on spousal support","type":"textarea","required":false,"conditional":{"dependsOn":"agreeSpousalSupport","showWhen":"No \u2014 I disagree"},"placeholder":"e.g. I disagree. We were together for only 2 years and I should not be required to pay spousal support.","pdfFieldName":"Spousal support position"},{"fieldId":"agreeProperty","label":"Do you agree with the applicant's request about property / equalization?","type":"select","required":false,"options":["Yes \u2014 I agree","No \u2014 I disagree","Partly agree","This was not requested","Not applicable"],"pdfFieldName":"Agree property"},{"fieldId":"propertyPosition","label":"Describe your position on property or equalization","type":"textarea","required":false,"conditional":{"dependsOn":"agreeProperty","showWhen":"No \u2014 I disagree"},"placeholder":"e.g. I disagree with the applicant's valuation of the matrimonial home. The correct value is $X not $Y.","pdfFieldName":"Property position"},{"fieldId":"disagreeOtherDetails","label":"Is there anything else in the Application you disagree with? Explain.","type":"textarea","required":false,"placeholder":"e.g. I dispute the applicant's claim that I was the primary breadwinner. I was laid off in January 2024.","pdfFieldName":"Disagree other details"}]},{"partId":"ownOrders","title":"Orders you are asking for","subtitle":"Step 5 of 7","intro":"If you want orders of your own \u2014 not just to respond to the applicant's requests \u2014 list them here. This is your chance to ask the court for what YOU want.","fields":[{"fieldId":"requestingOwnOrders","label":"Are you asking the court for any orders of your own?","type":"yesno","required":true,"helpText":"Even if the applicant is the one who started the case, you can use your Answer to ask for orders that benefit you.","pdfFieldName":"Requesting own orders"},{"fieldId":"ownOrdersCustody","label":"Are you asking for custody / decision-making responsibility?","type":"checkbox","conditional":{"dependsOn":"requestingOwnOrders","showWhen":"yes"},"pdfFieldName":"Own order custody"},{"fieldId":"ownOrdersParentingTime","label":"Are you asking for a specific parenting time schedule?","type":"checkbox","conditional":{"dependsOn":"requestingOwnOrders","showWhen":"yes"},"pdfFieldName":"Own order parenting time"},{"fieldId":"ownOrdersChildSupport","label":"Are you asking the other party to pay child support to you?","type":"checkbox","conditional":{"dependsOn":"requestingOwnOrders","showWhen":"yes"},"pdfFieldName":"Own order child support"},{"fieldId":"ownOrdersSpousalSupport","label":"Are you asking the other party to pay spousal support to you?","type":"checkbox","conditional":{"dependsOn":"requestingOwnOrders","showWhen":"yes"},"pdfFieldName":"Own order spousal support"},{"fieldId":"ownOrdersProperty","label":"Are you asking for a property / equalization payment?","type":"checkbox","conditional":{"dependsOn":"requestingOwnOrders","showWhen":"yes"},"pdfFieldName":"Own order property"},{"fieldId":"ownOrdersRestrainingOrder","label":"Are you asking for a restraining or non-harassment order?","type":"checkbox","conditional":{"dependsOn":"requestingOwnOrders","showWhen":"yes"},"pdfFieldName":"Own order restraining order"},{"fieldId":"ownOrdersOther","label":"Any other orders (describe below)?","type":"checkbox","conditional":{"dependsOn":"requestingOwnOrders","showWhen":"yes"},"pdfFieldName":"Own order other"},{"fieldId":"ownOrdersFullDescription","label":"Describe all the orders you are asking for in detail","type":"textarea","required":false,"conditional":{"dependsOn":"requestingOwnOrders","showWhen":"yes"},"placeholder":"e.g. 1. An order that I have primary decision-making responsibility for our child Alex Lance, born April 12, 2015.\n2. An order that the Applicant pay child support of $X per month pursuant to the Child Support Guidelines.\n3. An order that the Applicant pay costs of this proceeding.","helpText":"Number each order. Be specific \u2014 include names, amounts, and dates where possible.","pdfFieldName":"Own orders full description"}]},{"partId":"children","title":"Children (if applicable)","subtitle":"Step 6 of 7","intro":"If children are involved in this case, provide their details. The court needs this information to assess their best interests.","fields":[{"fieldId":"hasChildren","label":"Are there children involved in this case?","type":"yesno","required":true,"pdfFieldName":"Has children"},{"fieldId":"childrenDetails","label":"List the children (name, date of birth, where they currently live)","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildren","showWhen":"yes"},"source":"profile.children.list","placeholder":"Alex Lance \u2014 born April 12, 2015 \u2014 living with me at 123 Main Street, Toronto\nSam Lance \u2014 born September 3, 2018 \u2014 living with me at 123 Main Street, Toronto","helpText":"One child per line: full name, date of birth, and where they currently live.","pdfFieldName":"Children details"},{"fieldId":"childrenLivingArrangement","label":"Describe where the children have been living since the parents separated","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildren","showWhen":"yes"},"placeholder":"e.g. Since our separation in March 2024, both children have lived primarily with me. The Applicant sees them every other weekend.","pdfFieldName":"Children living arrangement"},{"fieldId":"childrenBestInterests","label":"Why is your proposal in the best interests of the children?","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildren","showWhen":"yes"},"placeholder":"e.g. I am the primary caregiver. I take the children to school, medical appointments, and activities. They have a stable home with me and are enrolled in school nearby.","helpText":"The court always focuses on what is best for the children \u2014 not what is best for either parent.","pdfFieldName":"Children best interests"}]},{"partId":"review","title":"Review and sign","subtitle":"Step 7 of 7","intro":"Review your Answer. Once filed, serve a copy on the applicant (or their lawyer) within 30 days of being served with the Application. Then file proof of service (Form 6B).","fields":[{"fieldId":"importantFactsOmitted","label":"Is there anything else important the court should know that you haven't mentioned?","type":"textarea","required":false,"placeholder":"e.g. There is a prior agreement between the parties dated January 2023 that the Applicant has not disclosed.","pdfFieldName":"Important facts omitted"},{"fieldId":"signatureDate","label":"Date you are signing this Answer","type":"date","required":true,"pdfFieldName":"Signature date"},{"fieldId":"declarationConfirmed","label":"I confirm the information in this Answer is accurate and complete to the best of my knowledge.","type":"checkbox","required":true,"pdfFieldName":"Declaration confirmed"}]}]};
  window.__hp_formDefs['ON-F13_1'] = {"formId":"ON-F13_1","jurisdiction":"ON","pdfFileName":"form13_1.pdf","title":"Form 13.1 \u2014 Financial Statement (Property and Support Claims)","subtitle":"Ontario Family Court \u2014 Family Law Rules (FLR 13.1)","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 13.1 is a detailed financial statement required when your case involves property claims (like dividing the family home or other assets), equalization of net family property, or both support AND property. It is more detailed than Form 13 because it includes a full list of your assets, debts, and a calculation of your net family property. Both parties must file this form.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 9","intro":"Confirm the court file details.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"applicantFullName","label":"Applicant's full legal name","type":"text","source":"profile.applicant.fullName","required":true,"pdfFieldName":"Applicant full name","id":"applicant_full_name","autoFill":"applicant_full_name"},{"fieldId":"respondentFullName","label":"Respondent's full legal name","type":"text","source":"profile.respondent.fullName","required":true,"pdfFieldName":"Respondent full name","id":"respondent_full_name","autoFill":"respondent_full_name"},{"fieldId":"statementDate","label":"Date of this financial statement","type":"date","required":true,"helpText":"Use today's date or the date your situation is accurate as of.","pdfFieldName":"Statement date"},{"fieldId":"marriageDate","label":"Date of marriage","type":"date","required":false,"helpText":"Required for equalization calculations.","pdfFieldName":"Marriage date","id":"date_of_marriage","autoFill":"marriage_date"},{"fieldId":"separationDate","label":"Date of separation","type":"date","required":true,"helpText":"The valuation date for net family property is usually the date of separation.","pdfFieldName":"Separation date","id":"date_of_separation","autoFill":"separation_date"}]},{"partId":"employment","title":"Your employment and income","subtitle":"Step 2 of 9","intro":"Describe your current employment situation and sources of income.","fields":[{"fieldId":"employmentStatus","label":"What is your current employment status?","type":"select","required":true,"options":["Employed full-time","Employed part-time","Self-employed","Unemployed","On disability","Retired","Student","Other"],"pdfFieldName":"Employment status"},{"fieldId":"employerName","label":"Employer's name (if employed)","type":"text","required":false,"pdfFieldName":"Employer name"},{"fieldId":"employerAddress","label":"Employer's address","type":"text","required":false,"pdfFieldName":"Employer address"},{"fieldId":"occupation","label":"Your occupation or job title","type":"text","required":false,"placeholder":"e.g. Registered Nurse, Truck Driver, Project Manager","pdfFieldName":"Occupation"},{"fieldId":"annualEmploymentIncome","label":"Annual employment income (gross, before taxes)","type":"currency","required":true,"placeholder":"0.00","helpText":"Enter your yearly gross income from employment. Found on your T4 or pay stub.","pdfFieldName":"Annual employment income"},{"fieldId":"selfEmploymentIncome","label":"Annual self-employment income (net after business expenses)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Self employment income"},{"fieldId":"rentalIncome","label":"Annual rental income","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Rental income"},{"fieldId":"investmentIncome","label":"Annual investment / dividend income","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Investment income"},{"fieldId":"governmentBenefits","label":"Annual government benefits (EI, CPP, OAS, ODSP, Ontario Works, etc.)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Government benefits"},{"fieldId":"otherIncomeSources","label":"Other income sources (describe and amount)","type":"textarea","required":false,"placeholder":"e.g. Child tax benefit: $3,600/yr\nSpouse's support payments received: $12,000/yr","pdfFieldName":"Other income sources"},{"fieldId":"totalAnnualIncome","label":"Total annual income from ALL sources","type":"currency","required":true,"placeholder":"0.00","helpText":"Add up all the income amounts above.","pdfFieldName":"Total annual income"}]},{"partId":"monthlyExpenses","title":"Monthly expenses","subtitle":"Step 3 of 9","intro":"List your monthly living expenses. Include only what you actually pay \u2014 not expenses shared with the other party.","fields":[{"fieldId":"expenseRent","label":"Rent or mortgage payment","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense rent mortgage"},{"fieldId":"expensePropertyTax","label":"Property taxes (monthly)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense property tax"},{"fieldId":"expenseUtilities","label":"Utilities (hydro, gas, water, internet, phone)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense utilities"},{"fieldId":"expenseFood","label":"Food and groceries","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense food"},{"fieldId":"expenseTransportation","label":"Transportation (car payment, gas, insurance, transit)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense transportation"},{"fieldId":"expenseChildcare","label":"Childcare / daycare","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense childcare"},{"fieldId":"expenseHealthInsurance","label":"Health and dental insurance premiums","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense health insurance"},{"fieldId":"expenseMedical","label":"Medical and dental expenses not covered by insurance","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense medical"},{"fieldId":"expenseChildren","label":"Children's expenses (school, activities, clothing)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense children"},{"fieldId":"expenseDebtPayments","label":"Debt payments (credit cards, loans \u2014 minimum payments)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense debt payments"},{"fieldId":"expenseOther","label":"Other monthly expenses (describe)","type":"textarea","required":false,"placeholder":"e.g. Life insurance: $80/mo\nGym membership: $45/mo","pdfFieldName":"Expense other"},{"fieldId":"totalMonthlyExpenses","label":"Total monthly expenses","type":"currency","required":true,"placeholder":"0.00","helpText":"Add up all monthly expenses above.","pdfFieldName":"Total monthly expenses"}]},{"partId":"assetsAtSeparation","title":"Assets on the date of separation (valuation date)","subtitle":"Step 4 of 9","intro":"List every asset you owned on the date of separation. These values are used to calculate your net family property (NFP). Be as accurate as possible \u2014 you may need appraisals for real estate and businesses.","fields":[{"fieldId":"realEstateAtSeparation","label":"Real estate owned on separation date (address and estimated value)","type":"textarea","required":false,"placeholder":"123 Main Street, Toronto ON \u2014 Family home \u2014 Value: $850,000\n456 Oak Avenue, Barrie ON \u2014 Rental property \u2014 Value: $420,000","helpText":"Include the matrimonial home and any other real estate. Use the fair market value on the date of separation.","pdfFieldName":"Real estate at separation"},{"fieldId":"bankAccountsAtSeparation","label":"Bank accounts on separation date (bank, account type, balance)","type":"textarea","required":false,"placeholder":"TD Bank \u2014 Chequing \u2014 $4,200\nRBC \u2014 Savings \u2014 $12,500\nTD Bank \u2014 Joint savings \u2014 $8,000 (my 50% share: $4,000)","pdfFieldName":"Bank accounts at separation"},{"fieldId":"investmentsAtSeparation","label":"Investments on separation date (RRSPs, TFSAs, stocks, GICs, etc.)","type":"textarea","required":false,"placeholder":"RBC RRSP \u2014 $45,000\nTD TFSA \u2014 $22,000\nFidelity stock portfolio \u2014 $15,000","pdfFieldName":"Investments at separation"},{"fieldId":"pensionAtSeparation","label":"Pension value on separation date","type":"currency","required":false,"placeholder":"0.00","helpText":"Get the commuted value from your pension administrator as of the separation date.","pdfFieldName":"Pension at separation"},{"fieldId":"vehiclesAtSeparation","label":"Vehicles on separation date (make, year, estimated value)","type":"textarea","required":false,"placeholder":"2019 Toyota Camry \u2014 $18,000\n2021 Honda Civic \u2014 $22,500","pdfFieldName":"Vehicles at separation"},{"fieldId":"businessInterestAtSeparation","label":"Business interests on separation date (name, your share, estimated value)","type":"textarea","required":false,"placeholder":"Lance Contracting Ltd. \u2014 100% owner \u2014 Value: $75,000","helpText":"Businesses should be professionally valuated. Use a reasonable estimate if a valuation has not been done.","pdfFieldName":"Business interest at separation"},{"fieldId":"otherAssetsAtSeparation","label":"Other assets on separation date (jewellery, art, furniture, life insurance cash value, etc.)","type":"textarea","required":false,"placeholder":"Life insurance (cash surrender value): $8,500\nBoat and trailer: $12,000\nFurniture and household goods: $5,000","pdfFieldName":"Other assets at separation"},{"fieldId":"totalAssetsAtSeparation","label":"TOTAL value of all assets on date of separation","type":"currency","required":true,"placeholder":"0.00","helpText":"Add up all the asset values listed above.","pdfFieldName":"Total assets at separation"}]},{"partId":"debtsAtSeparation","title":"Debts on the date of separation","subtitle":"Step 5 of 9","intro":"List every debt you owed on the date of separation. Debts are subtracted from your assets to calculate your net family property.","fields":[{"fieldId":"mortgagesAtSeparation","label":"Mortgages on separation date (property, lender, balance owing)","type":"textarea","required":false,"placeholder":"123 Main Street \u2014 TD Bank mortgage \u2014 Balance: $420,000\n456 Oak Avenue \u2014 RBC mortgage \u2014 Balance: $210,000","pdfFieldName":"Mortgages at separation"},{"fieldId":"carLoansAtSeparation","label":"Car loans on separation date","type":"textarea","required":false,"placeholder":"2021 Honda Civic \u2014 TD Auto Finance \u2014 Balance: $14,500","pdfFieldName":"Car loans at separation"},{"fieldId":"creditCardsAtSeparation","label":"Credit card balances on separation date","type":"textarea","required":false,"placeholder":"TD Visa \u2014 $3,200\nRBC Mastercard \u2014 $1,800","pdfFieldName":"Credit cards at separation"},{"fieldId":"studentLoansAtSeparation","label":"Student loans on separation date","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Student loans at separation"},{"fieldId":"otherDebtsAtSeparation","label":"Other debts on separation date (lines of credit, personal loans, taxes owing, etc.)","type":"textarea","required":false,"placeholder":"HELOC \u2014 RBC \u2014 Balance: $25,000\nPersonal loan \u2014 BMO \u2014 Balance: $8,000","pdfFieldName":"Other debts at separation"},{"fieldId":"totalDebtsAtSeparation","label":"TOTAL debts on date of separation","type":"currency","required":true,"placeholder":"0.00","helpText":"Add up all debt balances listed above.","pdfFieldName":"Total debts at separation"}]},{"partId":"propertyAtMarriage","title":"Property owned on date of marriage","subtitle":"Step 6 of 9","intro":"List assets and debts you had on the date of marriage. This amount is excluded from your net family property calculation (it was yours before the marriage).","fields":[{"fieldId":"assetsAtMarriage","label":"Assets you owned on the date of marriage (describe and value)","type":"textarea","required":false,"placeholder":"RBC savings account \u2014 $8,000\n2015 Dodge Ram \u2014 $25,000\nRRSP balance \u2014 $12,000","helpText":"These amounts will be deducted from your NFP calculation. Include only assets you personally owned on the wedding day.","pdfFieldName":"Assets at marriage"},{"fieldId":"debtsAtMarriage","label":"Debts you owed on the date of marriage","type":"textarea","required":false,"placeholder":"Student loan \u2014 $22,000\nVisa credit card \u2014 $1,500","helpText":"Debts at marriage are also excluded \u2014 they reduce your deduction from assets at marriage.","pdfFieldName":"Debts at marriage"},{"fieldId":"netPropertyAtMarriage","label":"Net value of property owned on date of marriage (assets minus debts)","type":"currency","required":false,"placeholder":"0.00","helpText":"Assets at marriage minus debts at marriage = this number. If negative, enter 0.","pdfFieldName":"Net property at marriage"}]},{"partId":"excludedProperty","title":"Excluded property","subtitle":"Step 7 of 9","intro":"Certain property received during the marriage is excluded from net family property under the Family Law Act. List any excluded property you have.","fields":[{"fieldId":"hasExcludedProperty","label":"Do you have any excluded property?","type":"yesno","required":true,"helpText":"Excluded property includes: gifts or inheritances received during marriage, damages from a personal injury lawsuit, life insurance proceeds, and property traced to any of the above.","pdfFieldName":"Has excluded property"},{"fieldId":"inheritances","label":"Inheritances received during marriage (amount and description)","type":"textarea","required":false,"conditional":{"dependsOn":"hasExcludedProperty","showWhen":"yes"},"placeholder":"Received from estate of John Smith (father) in 2019 \u2014 $45,000 cash\nInherited cottage in Muskoka \u2014 Value on date received: $180,000","pdfFieldName":"Inheritances"},{"fieldId":"giftsReceived","label":"Gifts received from third parties during marriage (not from spouse)","type":"textarea","required":false,"conditional":{"dependsOn":"hasExcludedProperty","showWhen":"yes"},"placeholder":"Gift from parents \u2014 $25,000 used as down payment \u2014 2018","pdfFieldName":"Gifts received"},{"fieldId":"personalInjuryDamages","label":"Damages for personal injuries received during marriage","type":"currency","required":false,"conditional":{"dependsOn":"hasExcludedProperty","showWhen":"yes"},"placeholder":"0.00","helpText":"General damages for pain and suffering only \u2014 not for lost income.","pdfFieldName":"Personal injury damages"},{"fieldId":"totalExcludedProperty","label":"Total value of excluded property","type":"currency","required":false,"conditional":{"dependsOn":"hasExcludedProperty","showWhen":"yes"},"placeholder":"0.00","pdfFieldName":"Total excluded property"}]},{"partId":"netFamilyProperty","title":"Net Family Property calculation","subtitle":"Step 8 of 9","intro":"Net Family Property (NFP) is what the court uses to determine equalization. It is calculated as: Assets at separation \u2212 Debts at separation \u2212 Property owned at marriage \u2212 Excluded property = NFP. The spouse with the higher NFP pays the other half the difference.","fields":[{"fieldId":"nfpAssetsAtSeparation","label":"Total assets on date of separation (from Step 4)","type":"currency","source":"form.assetsAtSeparation.totalAssetsAtSeparation","required":true,"placeholder":"0.00","pdfFieldName":"NFP assets at separation"},{"fieldId":"nfpDebtsAtSeparation","label":"Total debts on date of separation (from Step 5)","type":"currency","source":"form.debtsAtSeparation.totalDebtsAtSeparation","required":true,"placeholder":"0.00","pdfFieldName":"NFP debts at separation"},{"fieldId":"nfpPropertyAtMarriage","label":"Net property owned on date of marriage (from Step 6)","type":"currency","source":"form.propertyAtMarriage.netPropertyAtMarriage","required":false,"placeholder":"0.00","pdfFieldName":"NFP property at marriage"},{"fieldId":"nfpExcludedProperty","label":"Total excluded property (from Step 7)","type":"currency","source":"form.excludedProperty.totalExcludedProperty","required":false,"placeholder":"0.00","pdfFieldName":"NFP excluded property"},{"fieldId":"nfpMatrimonialHomeDeduction","label":"Matrimonial home exclusion deduction (enter 0 if home is being claimed as part of equalization)","type":"currency","required":false,"placeholder":"0.00","helpText":"The matrimonial home cannot be excluded from NFP even if owned before marriage \u2014 enter 0 unless a special exception applies.","pdfFieldName":"NFP matrimonial home deduction"},{"fieldId":"netFamilyPropertyTotal","label":"YOUR Net Family Property total","type":"currency","required":true,"placeholder":"0.00","helpText":"Formula: Assets at Separation \u2212 Debts at Separation \u2212 Property at Marriage \u2212 Excluded Property = NFP. If the result is negative, enter 0.","pdfFieldName":"Net family property total"},{"fieldId":"equalizationPaymentClaimed","label":"Equalization payment you are claiming (if any)","type":"currency","required":false,"placeholder":"0.00","helpText":"If your NFP is lower than the other party's, you may claim half the difference. Leave blank if you are the party with the higher NFP.","pdfFieldName":"Equalization payment claimed"}]},{"partId":"currentAssets","title":"Current assets and debts (today)","subtitle":"Step 9 of 9","intro":"In addition to the valuation-date figures, the court also needs your current financial picture. This section covers where things stand today.","fields":[{"fieldId":"currentRealEstate","label":"Real estate you own today (address and current estimated value)","type":"textarea","required":false,"placeholder":"123 Main Street, Toronto ON \u2014 Current value: $920,000","pdfFieldName":"Current real estate"},{"fieldId":"currentBankAccounts","label":"Bank accounts today (bank, type, balance)","type":"textarea","required":false,"placeholder":"TD Bank \u2014 Chequing \u2014 $2,100\nRBC \u2014 Savings \u2014 $9,800","pdfFieldName":"Current bank accounts"},{"fieldId":"currentInvestments","label":"Investments today (RRSPs, TFSAs, stocks, etc.)","type":"textarea","required":false,"placeholder":"RBC RRSP \u2014 $52,000\nTD TFSA \u2014 $24,500","pdfFieldName":"Current investments"},{"fieldId":"currentDebts","label":"Debts you owe today (type, lender, balance)","type":"textarea","required":false,"placeholder":"TD Bank mortgage \u2014 $398,000\nRBC Mastercard \u2014 $2,100","pdfFieldName":"Current debts"},{"fieldId":"declarationConfirmed","label":"I swear or affirm that the information in this financial statement is accurate and complete to the best of my knowledge.","type":"checkbox","required":true,"helpText":"This form must be sworn or affirmed before a commissioner of oaths. Providing false information is contempt of court.","pdfFieldName":"Declaration confirmed"},{"fieldId":"signatureDate","label":"Date of signature","type":"date","required":true,"pdfFieldName":"Signature date"}]}]};
  window.__hp_formDefs['ON-F15C'] = {"formId":"ON-F23","jurisdiction":"ON","pdfFileName":"form15c.pdf","title":"Consent Motion to Change","subtitle":"Ontario Family Court \u2014 Family Law Rules (FLR 15)","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 23 is used when both parties agree to change an existing court order \u2014 for example, changing a support amount, a parenting schedule, or another term \u2014 without having to go to a full court hearing. Both parties must sign this form. If one party does not agree, you must use Form 14 (Notice of Motion) instead.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 6","intro":"Enter the court file information from the existing order you want to change.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number (from the existing order)","type":"text","source":"profile.case.fileNumber","required":true,"placeholder":"e.g. FC-2024-12345","helpText":"This is printed on the court order you want to change.","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"existingOrderDate","label":"Date of the existing order you want to change","type":"date","required":true,"helpText":"The date printed at the top or bottom of the order.","pdfFieldName":"Existing order date"},{"fieldId":"existingOrderJudge","label":"Name of the judge or officer who made the existing order (if known)","type":"text","required":false,"placeholder":"e.g. Justice Smith","pdfFieldName":"Existing order judge"}]},{"partId":"parties","title":"The parties","subtitle":"Step 2 of 6","intro":"Confirm both parties' names and contact information.","fields":[{"fieldId":"applicantFullName","label":"Applicant's full legal name","type":"text","source":"profile.applicant.fullName","required":true,"pdfFieldName":"Applicant full name","id":"applicant_full_name","autoFill":"applicant_full_name"},{"fieldId":"applicantAddress","label":"Applicant's address for service","type":"text","source":"profile.applicant.address","required":true,"pdfFieldName":"Applicant address","id":"applicant_address","autoFill":"user_address"},{"fieldId":"applicantCity","label":"City","type":"text","source":"profile.applicant.city","required":true,"pdfFieldName":"Applicant city"},{"fieldId":"applicantPostalCode","label":"Postal code","type":"text","source":"profile.applicant.postalCode","required":true,"pdfFieldName":"Applicant postal code"},{"fieldId":"applicantPhone","label":"Phone number","type":"tel","source":"profile.applicant.phone","required":true,"pdfFieldName":"Applicant phone","id":"applicant_phone","autoFill":"user_phone"},{"fieldId":"respondentFullName","label":"Respondent's full legal name","type":"text","source":"profile.respondent.fullName","required":true,"pdfFieldName":"Respondent full name","id":"respondent_full_name","autoFill":"respondent_full_name"},{"fieldId":"respondentAddress","label":"Respondent's address for service","type":"text","source":"profile.respondent.address","required":false,"pdfFieldName":"Respondent address"},{"fieldId":"respondentPhone","label":"Respondent's phone number","type":"tel","source":"profile.respondent.phone","required":false,"pdfFieldName":"Respondent phone"}]},{"partId":"whatToChange","title":"What you want to change","subtitle":"Step 3 of 6","intro":"Describe exactly what terms of the existing order you both agree to change. Be specific \u2014 the judge will make the new order based on exactly what you write here.","fields":[{"fieldId":"changeChildSupport","label":"Are you changing child support?","type":"yesno","required":true,"pdfFieldName":"Change child support"},{"fieldId":"childSupportCurrentAmount","label":"Current child support amount in the existing order","type":"currency","required":false,"conditional":{"dependsOn":"changeChildSupport","showWhen":"yes"},"placeholder":"0.00","pdfFieldName":"Child support current amount"},{"fieldId":"childSupportNewAmount","label":"New child support amount you both agree to","type":"currency","required":false,"conditional":{"dependsOn":"changeChildSupport","showWhen":"yes"},"placeholder":"0.00","pdfFieldName":"Child support new amount"},{"fieldId":"childSupportChangeDate","label":"Start date for the new child support amount","type":"date","required":false,"conditional":{"dependsOn":"changeChildSupport","showWhen":"yes"},"helpText":"Usually the first of the month following the agreed change.","pdfFieldName":"Child support change date"},{"fieldId":"childSupportChangeReason","label":"Why are you changing child support?","type":"textarea","required":false,"conditional":{"dependsOn":"changeChildSupport","showWhen":"yes"},"placeholder":"e.g. The payor's income has changed. The payor now earns $X per year. The new amount reflects the applicable Child Support Guidelines table amount.","helpText":"The court needs to know there has been a material change in circumstances.","pdfFieldName":"Child support change reason"},{"fieldId":"changeSpousalSupport","label":"Are you changing spousal support?","type":"yesno","required":true,"pdfFieldName":"Change spousal support"},{"fieldId":"spousalSupportCurrentAmount","label":"Current spousal support amount in the existing order","type":"currency","required":false,"conditional":{"dependsOn":"changeSpousalSupport","showWhen":"yes"},"placeholder":"0.00","pdfFieldName":"Spousal support current amount"},{"fieldId":"spousalSupportNewAmount","label":"New spousal support amount you both agree to","type":"currency","required":false,"conditional":{"dependsOn":"changeSpousalSupport","showWhen":"yes"},"placeholder":"0.00","helpText":"Enter 0 if you are agreeing to terminate spousal support.","pdfFieldName":"Spousal support new amount"},{"fieldId":"spousalSupportChangeDate","label":"Start date for the new spousal support amount","type":"date","required":false,"conditional":{"dependsOn":"changeSpousalSupport","showWhen":"yes"},"pdfFieldName":"Spousal support change date"},{"fieldId":"spousalSupportChangeReason","label":"Why are you changing spousal support?","type":"textarea","required":false,"conditional":{"dependsOn":"changeSpousalSupport","showWhen":"yes"},"placeholder":"e.g. The recipient has become self-sufficient and both parties agree support should end.","pdfFieldName":"Spousal support change reason"},{"fieldId":"changeParenting","label":"Are you changing parenting time or decision-making?","type":"yesno","required":true,"pdfFieldName":"Change parenting"},{"fieldId":"parentingCurrentArrangement","label":"Current parenting arrangement in the existing order","type":"textarea","required":false,"conditional":{"dependsOn":"changeParenting","showWhen":"yes"},"placeholder":"e.g. Currently: children live primarily with Applicant, Respondent has parenting time every other weekend.","pdfFieldName":"Parenting current arrangement"},{"fieldId":"parentingNewArrangement","label":"New parenting arrangement you both agree to","type":"textarea","required":false,"conditional":{"dependsOn":"changeParenting","showWhen":"yes"},"placeholder":"e.g. New arrangement: children alternate weekly between both homes (week-on, week-off). Each parent to have the children on their respective weeks from Sunday at 6:00 p.m. to the following Sunday at 6:00 p.m.","helpText":"Be as specific as possible \u2014 include days, times, holiday schedules, and any special provisions.","pdfFieldName":"Parenting new arrangement"},{"fieldId":"changeParentingReason","label":"Why are you changing the parenting arrangement?","type":"textarea","required":false,"conditional":{"dependsOn":"changeParenting","showWhen":"yes"},"placeholder":"e.g. The children are older and both parties agree a week-on, week-off schedule better meets the children's current needs and schedules.","pdfFieldName":"Change parenting reason"},{"fieldId":"changeOther","label":"Are you changing any other terms of the existing order?","type":"yesno","required":true,"pdfFieldName":"Change other"},{"fieldId":"otherChangeDescription","label":"Describe the other changes you both agree to","type":"textarea","required":false,"conditional":{"dependsOn":"changeOther","showWhen":"yes"},"placeholder":"e.g. Paragraph 4 of the existing order regarding the family pet is deleted. The parties agree that the dog 'Max' shall reside primarily with the Applicant.","pdfFieldName":"Other change description"}]},{"partId":"children","title":"Children (if applicable)","subtitle":"Step 4 of 6","intro":"If the changes affect children, provide their details.","fields":[{"fieldId":"hasChildren","label":"Do the changes involve children?","type":"yesno","required":true,"pdfFieldName":"Has children"},{"fieldId":"childrenDetails","label":"List the children (name and date of birth)","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildren","showWhen":"yes"},"source":"profile.children.list","placeholder":"Alex Lance \u2014 born April 12, 2015\nSam Lance \u2014 born September 3, 2018","pdfFieldName":"Children details"},{"fieldId":"childrenBestInterests","label":"Why are the proposed changes in the best interests of the children?","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildren","showWhen":"yes"},"placeholder":"e.g. Both parties agree that the children are old enough to benefit from equal time with each parent. Both parents live within the same school district so the children's routines will not be disrupted.","pdfFieldName":"Children best interests"}]},{"partId":"consent","title":"Consent of both parties","subtitle":"Step 5 of 6","intro":"Both parties must consent to the changes. This section confirms that both of you agree freely and without pressure.","fields":[{"fieldId":"applicantConsents","label":"I (the applicant) freely consent to the changes described in this form.","type":"checkbox","required":true,"pdfFieldName":"Applicant consents"},{"fieldId":"applicantConsentDate","label":"Date of applicant's consent","type":"date","required":true,"pdfFieldName":"Applicant consent date"},{"fieldId":"respondentConsentConfirmed","label":"I confirm the respondent has also agreed to these changes and will sign this form.","type":"checkbox","required":true,"helpText":"The respondent must physically sign the printed form before it is filed. Both signatures are required.","pdfFieldName":"Respondent consent confirmed"},{"fieldId":"neitherPartyHasCounsel","label":"Have both parties had an opportunity to get legal advice before signing?","type":"yesno","required":false,"helpText":"You are not required to have a lawyer, but the court will want to know you both understood what you were agreeing to.","pdfFieldName":"Legal advice opportunity"}]},{"partId":"review","title":"Review and finalize","subtitle":"Step 6 of 6","intro":"Review the consent motion. Once both parties sign the printed version, file it with the court clerk. You do not need a hearing \u2014 the clerk will submit it to a judge for approval.","fields":[{"fieldId":"effectiveDate","label":"When should the new order take effect?","type":"date","required":false,"helpText":"Leave blank if you want it to take effect immediately upon the court's approval.","pdfFieldName":"Effective date"},{"fieldId":"costsAgreement","label":"Agreement on costs","type":"select","required":false,"options":["No order as to costs \u2014 each party pays their own","Costs to be determined by the court","Other arrangement (describe below)"],"pdfFieldName":"Costs agreement"},{"fieldId":"additionalTerms","label":"Any additional terms both parties agree to include","type":"textarea","required":false,"placeholder":"e.g. The parties shall communicate regarding the children via the OurFamilyWizard app only.","pdfFieldName":"Additional terms"},{"fieldId":"declarationConfirmed","label":"I confirm this Consent Motion accurately reflects the agreement of both parties and I am signing freely and voluntarily.","type":"checkbox","required":true,"pdfFieldName":"Declaration confirmed"}]}],"formCode":"form15c-consent-change","formNumber":"Form 15C","version":"December 2020","description":"Used when both parties agree to change an existing court order and want to do so by consent, without a hearing. Must be signed by both parties or their lawyers. Used for changes to child support, spousal support, or parenting arrangements."};
  window.__hp_formDefs['ON-F34A'] = {"formId":"ON-F34A","jurisdiction":"ON","pdfFileName":"form34a.pdf","title":"Form 34A — Affidavit of Parentage","subtitle":"Ontario Family Court — Family Law Rules (FLR 34A)","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 34A is used to establish legal parentage of a child. It is required in support and parenting cases involving unmarried parents, or where the parentage of a child is in question. You swear or affirm this form in front of a commissioner of oaths. Note: while Form 34A also appears in adoption proceedings, here it is used for establishing parentage in ordinary family law cases (support, parenting time, decision-making).","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 4","intro":"Enter the court file details.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie — Superior Court of Justice","Brampton — Superior Court of Justice","Brantford — Superior Court of Justice","Cornwall — Superior Court of Justice","Hamilton — Superior Court of Justice","Kingston — Superior Court of Justice","Kitchener — Superior Court of Justice","London — Superior Court of Justice","Milton — Superior Court of Justice","Newmarket — Superior Court of Justice","Oshawa — Superior Court of Justice","Ottawa — Superior Court of Justice","Peterborough — Superior Court of Justice","St. Catharines — Superior Court of Justice","Sudbury — Superior Court of Justice","Thunder Bay — Superior Court of Justice","Toronto — Superior Court of Justice","Windsor — Superior Court of Justice"],"pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"applicantFullName","label":"Applicant's full legal name","type":"text","source":"profile.applicant.fullName","required":true,"pdfFieldName":"Applicant full name","id":"applicant_full_name","autoFill":"applicant_full_name"},{"fieldId":"respondentFullName","label":"Respondent's full legal name (first letter of surname only, if preferred)","type":"text","source":"profile.respondent.fullName","required":false,"pdfFieldName":"Respondent full name","id":"respondent_full_name","autoFill":"respondent_full_name"}]},{"partId":"child","title":"Child's information","subtitle":"Step 2 of 4","intro":"Provide details about the child whose parentage is being established.","fields":[{"fieldId":"childFullName","label":"Child's full legal name","type":"text","required":true,"placeholder":"e.g. Emily Rose Smith","pdfFieldName":"Child full name"},{"fieldId":"childDob","label":"Child's date of birth","type":"date","required":true,"pdfFieldName":"Child date of birth"},{"fieldId":"childSex","label":"Child's sex","type":"select","required":true,"options":["Female","Male","Non-binary / Other"],"pdfFieldName":"Child sex"},{"fieldId":"childBirthRegistration","label":"Child's birth registration number (if known)","type":"text","required":false,"placeholder":"e.g. 2018-123456","pdfFieldName":"Birth registration number"},{"fieldId":"childBirthPlace","label":"Municipality and province where the child was born","type":"text","required":true,"placeholder":"e.g. Toronto, Ontario","pdfFieldName":"Birth place"},{"fieldId":"deponentRelationship","label":"Your relationship to the child","type":"text","required":true,"placeholder":"e.g. Birth mother, Father, Legal guardian","pdfFieldName":"Deponent relationship"}]},{"partId":"parentage","title":"Parentage circumstances","subtitle":"Step 3 of 4","intro":"Describe the circumstances around the child's birth and parentage. This is required for the court record.","fields":[{"fieldId":"birthParentMaritalStatus","label":"At the time of the child's birth, the birth parent was:","type":"select","required":true,"options":["Not married and not in a common-law relationship","Married to another person","In a common-law relationship with another person"],"pdfFieldName":"Birth parent marital status"},{"fieldId":"spouseOrPartnerName","label":"Name of spouse or common-law partner at the time of birth (if applicable)","type":"text","required":false,"placeholder":"e.g. John Robert Smith","pdfFieldName":"Spouse partner name"},{"fieldId":"birthParentConceptionStatus","label":"At the time of conception (if assisted reproduction was used), the birth parent was:","type":"select","required":false,"options":["Not applicable — natural conception","Not married and not in a common-law relationship","Married to another person","In a common-law relationship with another person"],"pdfFieldName":"Conception status"},{"fieldId":"otherParentKnown","label":"Is the other parent of this child known?","type":"yesno","required":true,"pdfFieldName":"Other parent known"},{"fieldId":"otherParentName","label":"Full name of the other parent","type":"text","required":false,"conditional":{"dependsOn":"otherParentKnown","showWhen":"yes"},"placeholder":"e.g. James Michael Brown","pdfFieldName":"Other parent name"},{"fieldId":"parentageNote","label":"Any additional information about parentage the court should know (optional)","type":"textarea","required":false,"placeholder":"e.g. The child was conceived through assisted reproduction. The birth parent's spouse has agreed to be registered as a parent under the Children's Law Reform Act.","pdfFieldName":"Parentage note"}]},{"partId":"review","title":"Sign and file","subtitle":"Step 4 of 4","intro":"You must sign this affidavit in front of a commissioner of oaths (such as a lawyer, notary public, or court clerk) before filing.","fields":[{"fieldId":"municipality","label":"Municipality and province where you will sign","type":"text","required":true,"placeholder":"e.g. Toronto, Ontario","pdfFieldName":"Municipality"},{"fieldId":"signatureDate","label":"Date of signature","type":"date","required":true,"pdfFieldName":"Signature date"},{"fieldId":"declarationConfirmed","label":"I confirm the information in this Affidavit of Parentage is true and complete to the best of my knowledge.","type":"checkbox","required":true,"pdfFieldName":"Declaration confirmed"}]}]};

  window.__hp_formDefs['ON-F37'] = {"formId":"ON-F37","jurisdiction":"ON","pdfFileName":null,"title":"Form 37 \u2014 Notice of Hearing","subtitle":"Ontario Family Court \u2014 Family Law Rules","requiredPlan":"standard","freeForm":true,"textGenerationForm":true,"helpIntro":"Form 37 is a Notice of Hearing issued by the court clerk \u2014 it is NOT filled out by the parties. The court generates and issues this notice to inform all parties of a scheduled hearing date, time, and location. Hearth \u0026 Page will help you understand what to expect and prepare a personal hearing checklist for your file.","clerkIssuedNotice":{"enabled":true,"message":"Form 37 is ISSUED by the court clerk, not completed by you. The clerk sends this notice automatically after a hearing is scheduled by the court or by order. Your role is to review the notice when received and attend the hearing as directed.","howToRespond":["Review the hearing date, time, and courtroom listed on the form","Confirm you can attend \u2014 if you cannot, contact the court clerk immediately to request an adjournment","Serve any required materials on the other party before the hearing deadline","Bring all relevant documents, affidavits, and evidence to the hearing"]},"parts":[{"partId":"hearing_info","title":"Your Upcoming Hearing","subtitle":"Step 1 of 2","intro":"Enter the details from the Form 37 Notice of Hearing you received from the court.","fields":[{"fieldId":"hearing_date","label":"Hearing date (from your Form 37)","type":"date","required":true,"pdfFieldName":"Hearing Date"},{"fieldId":"hearing_time","label":"Hearing time","type":"text","required":false,"placeholder":"e.g. 9:30 AM","pdfFieldName":"Hearing Time"},{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","autoFill":"courthouse"},{"fieldId":"courtroom","label":"Courtroom number (if shown on notice)","type":"text","required":false,"placeholder":"e.g. Courtroom 3","pdfFieldName":"Courtroom"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","autoFill":"fileNumber"},{"fieldId":"hearing_type","label":"Type of hearing","type":"select","required":false,"options":["Case Conference","Settlement Conference","Trial Management Conference","Motion","Trial","Other"],"pdfFieldName":"Hearing Type"},{"fieldId":"hearing_notes","label":"Any special instructions on your notice?","type":"textarea","required":false,"placeholder":"e.g. \u2018Bring proof of income\u2019 or \u2018Attendance by phone permitted\u2019"}]},{"partId":"checklist","title":"Hearing Preparation Checklist","subtitle":"Step 2 of 2","intro":"Check off each item to make sure you\u2019re ready for your hearing.","type":"checklist","fields":[{"fieldId":"chk_serve","label":"I have served all required documents on the other party at least the required number of days before the hearing","type":"checkbox","required":false},{"fieldId":"chk_confirm_attend","label":"I have confirmed I can attend (or arranged an adjournment if I cannot)","type":"checkbox","required":false},{"fieldId":"chk_documents","label":"I have gathered all documents, affidavits, and evidence I need to bring","type":"checkbox","required":false},{"fieldId":"chk_review_orders","label":"I have reviewed all previous court orders relevant to this hearing","type":"checkbox","required":false},{"fieldId":"chk_childcare","label":"I have arranged childcare or accommodations for the day of the hearing (if needed)","type":"checkbox","required":false},{"fieldId":"chk_id","label":"I have photo ID to bring to the courthouse","type":"checkbox","required":false},{"fieldId":"chk_arrive_early","label":"I plan to arrive at least 30 minutes early to clear security and find the courtroom","type":"checkbox","required":false}]}]};

  window.__hp_formDefs['ON-F36'] = {"formId":"ON-F36","jurisdiction":"ON","pdfFileName":"form36.pdf","title":"Form 36 \u2014 Affidavit for Divorce","subtitle":"Ontario Family Court \u2014 Family Law Rules (FLR 36)","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 36 is the sworn affidavit you file to support your divorce application. It proves to the court that the legal requirements for a divorce are met \u2014 mainly that you have been separated for at least one year and that there is no reasonable chance of reconciliation. This form is sworn before a commissioner of oaths.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 7","intro":"Enter the court file details from your divorce application.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"applicantFullName","label":"Applicant's full legal name","type":"text","source":"profile.applicant.fullName","required":true,"pdfFieldName":"Applicant full name","id":"applicant_full_name","autoFill":"applicant_full_name"},{"fieldId":"respondentFullName","label":"Respondent's full legal name","type":"text","source":"profile.respondent.fullName","required":true,"pdfFieldName":"Respondent full name","id":"respondent_full_name","autoFill":"respondent_full_name"}]},{"partId":"marriage","title":"The marriage","subtitle":"Step 2 of 7","intro":"Provide details about your marriage. This information is needed to verify that a valid marriage took place.","fields":[{"fieldId":"marriageDate","label":"Date of marriage","type":"date","source":"profile.case.marriageDate","required":true,"pdfFieldName":"Marriage date","id":"date_of_marriage","autoFill":"marriage_date"},{"fieldId":"marriageCity","label":"City or town where you were married","type":"text","required":true,"placeholder":"e.g. Toronto","pdfFieldName":"Marriage city"},{"fieldId":"marriageProvince","label":"Province or country where you were married","type":"text","required":true,"placeholder":"e.g. Ontario, Canada","pdfFieldName":"Marriage province"},{"fieldId":"marriageCertificateAvailable","label":"Do you have a marriage certificate?","type":"yesno","required":true,"helpText":"You must file a certified copy of your marriage certificate with the court. If you don't have one, contact ServiceOntario or the vital statistics office where you were married.","pdfFieldName":"Marriage certificate available"},{"fieldId":"marriageCertificateNotes","label":"If you do not have a marriage certificate, explain why","type":"textarea","required":false,"conditional":{"dependsOn":"marriageCertificateAvailable","showWhen":"no"},"placeholder":"e.g. We were married in another country and have been unable to obtain a certified copy. We are in the process of requesting one from the registry office.","pdfFieldName":"Marriage certificate notes"},{"fieldId":"applicantNameAtMarriage","label":"Your full name at the time of marriage (if different from current name)","type":"text","required":false,"placeholder":"Leave blank if your name has not changed","pdfFieldName":"Applicant name at marriage"},{"fieldId":"respondentNameAtMarriage","label":"Other party's full name at the time of marriage (if different from current name)","type":"text","required":false,"placeholder":"Leave blank if their name has not changed","pdfFieldName":"Respondent name at marriage"}]},{"partId":"separation","title":"The separation","subtitle":"Step 3 of 7","intro":"The Divorce Act requires that spouses have lived separate and apart for at least one year before a divorce can be granted. Answer the questions below to confirm this requirement is met.","fields":[{"fieldId":"separationDate","label":"Date you and your spouse separated","type":"date","source":"profile.case.separationDate","required":true,"helpText":"This is the date one or both of you decided the marriage was over and began living separate lives \u2014 even if you remained in the same house.","pdfFieldName":"Separation date","id":"date_of_separation","autoFill":"separation_date"},{"fieldId":"separatedOneYear","label":"Have you lived separate and apart for at least one year as of today?","type":"yesno","required":true,"helpText":"If you separated less than one year ago, you cannot apply for a divorce yet. You must wait until the full year has passed.","pdfFieldName":"Separated one year"},{"fieldId":"reconciliationAttempts","label":"Did you and your spouse attempt to reconcile after separating?","type":"yesno","required":true,"helpText":"Short periods of attempted reconciliation (totalling 90 days or less) do not reset the one-year clock.","pdfFieldName":"Reconciliation attempts"},{"fieldId":"reconciliationDetails","label":"Describe the reconciliation attempt(s)","type":"textarea","required":false,"conditional":{"dependsOn":"reconciliationAttempts","showWhen":"yes"},"placeholder":"e.g. We reconciled from April 1 to April 30, 2024 (30 days). We then separated again permanently on May 1, 2024.","helpText":"Include dates. If total reconciliation attempts were 90 days or less combined, your one-year clock continues from the original separation date.","pdfFieldName":"Reconciliation details"},{"fieldId":"noReasonableChanceReconciliation","label":"Is there any reasonable chance you and your spouse will reconcile?","type":"yesno","required":true,"helpText":"Almost always 'No' \u2014 the court needs this confirmed to grant the divorce.","pdfFieldName":"Reasonable chance reconciliation"},{"fieldId":"separatedInSameHome","label":"Did you and your spouse live in the same home after separating?","type":"yesno","required":true,"helpText":"It is possible to be 'separated' while living under the same roof if you were living separate lives (separate bedrooms, separate finances, no intimate relationship).","pdfFieldName":"Separated in same home"},{"fieldId":"separatedInSameHomeDetails","label":"Describe how you lived separately while in the same home","type":"textarea","required":false,"conditional":{"dependsOn":"separatedInSameHome","showWhen":"yes"},"placeholder":"e.g. From March 1, 2024 we slept in separate bedrooms, had no intimate relationship, ate separately, managed our own finances, and informed family and friends that we were separated.","helpText":"The court needs specific details to accept an in-home separation.","pdfFieldName":"Same home separation details"}]},{"partId":"children","title":"Children of the marriage","subtitle":"Step 4 of 7","intro":"Under the Divorce Act, the court must be satisfied that reasonable arrangements have been made for the support of any children of the marriage before granting a divorce.","fields":[{"fieldId":"hasChildrenOfMarriage","label":"Do you have any children of the marriage under 18, or over 18 but still dependent?","type":"yesno","required":true,"helpText":"Children of the marriage include biological children, adopted children, and stepchildren who were treated as a child of the family.","pdfFieldName":"Has children of marriage"},{"fieldId":"childrenDetails","label":"List the children (full name, date of birth, where they live now)","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildrenOfMarriage","showWhen":"yes"},"source":"profile.children.list","placeholder":"Alex Lance \u2014 born April 12, 2015 \u2014 lives with Applicant at 123 Main St, Toronto\nSam Lance \u2014 born September 3, 2018 \u2014 lives with Applicant at 123 Main St, Toronto","pdfFieldName":"Children details"},{"fieldId":"childSupportArranged","label":"Have reasonable arrangements been made for child support?","type":"yesno","required":false,"conditional":{"dependsOn":"hasChildrenOfMarriage","showWhen":"yes"},"helpText":"The court will not grant the divorce if it is not satisfied that proper support arrangements exist for the children.","pdfFieldName":"Child support arranged"},{"fieldId":"childSupportArrangementDetails","label":"Describe the child support arrangements","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildrenOfMarriage","showWhen":"yes"},"placeholder":"e.g. The Respondent pays child support of $1,200 per month pursuant to the Child Support Guidelines based on an annual income of $72,000. This is set out in a separation agreement dated March 15, 2025.","helpText":"Reference any existing court orders, separation agreements, or FRO arrangements.","pdfFieldName":"Child support arrangement details"},{"fieldId":"custodyArrangementDetails","label":"Describe the current parenting / custody arrangement","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildrenOfMarriage","showWhen":"yes"},"placeholder":"e.g. The children live primarily with the Applicant. The Respondent has parenting time every other weekend pursuant to a separation agreement dated March 15, 2025.","pdfFieldName":"Custody arrangement details"}]},{"partId":"collusion","title":"Collusion and condonation","subtitle":"Step 5 of 7","intro":"The court must be satisfied that the divorce is not the result of any agreement to deceive the court, and that no matrimonial offence has been condoned. These are standard legal declarations.","fields":[{"fieldId":"noCollusion","label":"I confirm that there has been no collusion in relation to this divorce application","type":"checkbox","required":true,"helpText":"Collusion means a secret agreement to deceive the court \u2014 for example, fabricating grounds for divorce or agreeing to hide the truth. This is extremely rare in modern no-fault divorces based on separation.","pdfFieldName":"No collusion"},{"fieldId":"noCondonation","label":"I confirm that I have not condoned any conduct that might be raised as a ground for divorce","type":"checkbox","required":true,"helpText":"Condonation means forgiving a matrimonial offence (like adultery or cruelty) and resuming the marriage with full knowledge of it. For separation-based divorces, this is generally not applicable but must be declared.","pdfFieldName":"No condonation"},{"fieldId":"divorceGrounds","label":"Grounds for divorce","type":"select","required":true,"options":["Separation \u2014 we have lived separate and apart for at least one year (most common)","Adultery \u2014 my spouse committed adultery","Physical or mental cruelty \u2014 my spouse treated me with physical or mental cruelty"],"helpText":"Almost all divorces in Canada are granted on the grounds of separation. Adultery and cruelty are rarely used because they are harder to prove and require additional evidence.","pdfFieldName":"Divorce grounds"},{"fieldId":"adulteryDetails","label":"If claiming adultery \u2014 describe the circumstances","type":"textarea","required":false,"conditional":{"dependsOn":"divorceGrounds","showWhen":"Adultery \u2014 my spouse committed adultery"},"placeholder":"e.g. My spouse committed adultery with a person known to me from approximately January 2024 onwards.","helpText":"You do not need to name the third party, but you must have sufficient evidence. Consider whether to proceed on this ground vs. separation.","pdfFieldName":"Adultery details"},{"fieldId":"crueltyDetails","label":"If claiming cruelty \u2014 describe the conduct","type":"textarea","required":false,"conditional":{"dependsOn":"divorceGrounds","showWhen":"Physical or mental cruelty \u2014 my spouse treated me with physical or mental cruelty"},"placeholder":"e.g. From 2022 to 2024, my spouse subjected me to physical violence on multiple occasions, including...","helpText":"Must be conduct that made continued cohabitation intolerable. Provide specific incidents with dates.","pdfFieldName":"Cruelty details"}]},{"partId":"previousProceedings","title":"Previous court proceedings","subtitle":"Step 6 of 7","intro":"The court needs to know if there are any other divorce or family law proceedings anywhere in Canada or internationally.","fields":[{"fieldId":"hasPreviousProceedings","label":"Have there been any previous divorce or family law court proceedings between you and your spouse in any court?","type":"yesno","required":true,"pdfFieldName":"Has previous proceedings"},{"fieldId":"previousProceedingsDetails","label":"Describe the previous proceedings","type":"textarea","required":false,"conditional":{"dependsOn":"hasPreviousProceedings","showWhen":"yes"},"placeholder":"e.g. There is an existing Ontario Superior Court proceeding (File No. FC-2024-12345) which includes this divorce application. There are no other proceedings.","helpText":"Include the court, file number, and type of proceeding. Include proceedings in other provinces or countries.","pdfFieldName":"Previous proceedings details"},{"fieldId":"hasExistingSeparationAgreement","label":"Do you have a signed separation agreement?","type":"yesno","required":true,"helpText":"If yes, attach a copy to your affidavit. The court will want to see how issues like support and property have been resolved.","pdfFieldName":"Has separation agreement"},{"fieldId":"separationAgreementDate","label":"Date of the separation agreement","type":"date","required":false,"conditional":{"dependsOn":"hasExistingSeparationAgreement","showWhen":"yes"},"pdfFieldName":"Separation agreement date"},{"fieldId":"separationAgreementCoversChildren","label":"Does the separation agreement address the children?","type":"yesno","required":false,"conditional":{"dependsOn":"hasExistingSeparationAgreement","showWhen":"yes"},"pdfFieldName":"Agreement covers children"}]},{"partId":"swearing","title":"Declaration and signing","subtitle":"Step 7 of 7","intro":"This affidavit must be sworn or affirmed before a commissioner of oaths. Do not sign it until you are in front of the commissioner.","fields":[{"fieldId":"swearOrAffirm","label":"Will you swear or affirm?","type":"select","required":true,"options":["Swear","Affirm"],"pdfFieldName":"Swear or affirm"},{"fieldId":"deponentMunicipality","label":"Municipality where you will sign this affidavit","type":"text","required":true,"placeholder":"e.g. Toronto","pdfFieldName":"Deponent municipality"},{"fieldId":"commissioningDate","label":"Date of commissioning (leave blank to complete at courthouse)","type":"date","required":false,"pdfFieldName":"Commissioning date"},{"fieldId":"declarationAccurate","label":"I confirm that everything stated in this affidavit is true, and I understand that swearing a false affidavit is perjury.","type":"checkbox","required":true,"pdfFieldName":"Declaration accurate"}]}]};
  window.__hp_formDefs['ON-F25A'] = {"formId":"ON-F25A","jurisdiction":"ON","pdfFileName":"form25a.pdf","title":"Form 25A \u2014 Order for Divorce","subtitle":"Ontario Family Court \u2014 Family Law Rules (FLR 25A)","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 25A is the actual divorce order that the judge signs. You prepare it in advance and submit it with your divorce application \u2014 if the judge approves your divorce, they sign this form and it becomes the legal divorce order. It is one of the most important documents in the process. Prepare it carefully.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 5","intro":"Enter the court file details. This must exactly match your application.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":true,"placeholder":"e.g. FC-2024-12345","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"hearingDate","label":"Date of hearing (if known, otherwise leave blank)","type":"date","required":false,"helpText":"The clerk will fill this in if left blank.","pdfFieldName":"Hearing date"}]},{"partId":"parties","title":"The parties","subtitle":"Step 2 of 5","intro":"Enter both parties' full legal names exactly as they appear on the marriage certificate.","fields":[{"fieldId":"applicantFullName","label":"Applicant's full legal name","type":"text","source":"profile.applicant.fullName","required":true,"helpText":"Must match the marriage certificate exactly.","pdfFieldName":"Applicant full name","id":"applicant_full_name","autoFill":"applicant_full_name"},{"fieldId":"respondentFullName","label":"Respondent's full legal name","type":"text","source":"profile.respondent.fullName","required":true,"helpText":"Must match the marriage certificate exactly.","pdfFieldName":"Respondent full name","id":"respondent_full_name","autoFill":"respondent_full_name"},{"fieldId":"applicantBirthDate","label":"Applicant's date of birth","type":"date","source":"profile.applicant.dateOfBirth","required":false,"pdfFieldName":"Applicant birth date"},{"fieldId":"respondentBirthDate","label":"Respondent's date of birth","type":"date","source":"profile.respondent.dateOfBirth","required":false,"pdfFieldName":"Respondent birth date"}]},{"partId":"divorceOrder","title":"The divorce order","subtitle":"Step 3 of 5","intro":"This section sets out the terms of the divorce order itself \u2014 what the judge will be signing.","fields":[{"fieldId":"marriageDate","label":"Date of marriage","type":"date","source":"profile.case.marriageDate","required":true,"helpText":"Must match the marriage certificate.","pdfFieldName":"Marriage date","id":"date_of_marriage","autoFill":"marriage_date"},{"fieldId":"marriagePlace","label":"Place of marriage (city and province/country)","type":"text","required":true,"placeholder":"e.g. Toronto, Ontario, Canada","pdfFieldName":"Marriage place"},{"fieldId":"separationDate","label":"Date of separation","type":"date","source":"profile.case.separationDate","required":true,"pdfFieldName":"Separation date","id":"date_of_separation","autoFill":"separation_date"},{"fieldId":"divorceEffectiveDate","label":"When should the divorce take effect?","type":"select","required":true,"options":["31 days after the divorce order is made (standard \u2014 allows appeal period)","Immediately \u2014 I am asking the court to waive the 31-day waiting period"],"helpText":"The standard is 31 days. The divorce becomes final 31 days after the judge signs the order, unless an appeal is filed. The 31-day period can only be waived in very limited circumstances (e.g. one party is remarrying imminently).","pdfFieldName":"Divorce effective date"},{"fieldId":"waiveWaitingPeriodReason","label":"Reason for waiving the 31-day waiting period","type":"textarea","required":false,"conditional":{"dependsOn":"divorceEffectiveDate","showWhen":"Immediately \u2014 I am asking the court to waive the 31-day waiting period"},"placeholder":"e.g. Both parties consent to the divorce being effective immediately as one party plans to remarry on [date].","pdfFieldName":"Waive waiting period reason"}]},{"partId":"corollaryRelief","title":"Additional orders (corollary relief)","subtitle":"Step 4 of 5","intro":"A divorce order can also include other orders \u2014 such as support or custody \u2014 if they are not already set out in a separate agreement or order. Only include items here that you need the divorce order itself to address.","fields":[{"fieldId":"includeChildSupport","label":"Should the divorce order include a child support term?","type":"yesno","required":true,"helpText":"Select 'No' if child support is already covered by a separation agreement or a separate court order.","pdfFieldName":"Include child support"},{"fieldId":"childSupportTerm","label":"Child support term to include in the order","type":"textarea","required":false,"conditional":{"dependsOn":"includeChildSupport","showWhen":"yes"},"placeholder":"e.g. The Respondent shall pay to the Applicant child support for the children Alex Lance and Sam Lance in the amount of $1,200 per month commencing July 1, 2025, pursuant to the Child Support Guidelines.","helpText":"Write the exact wording you want the judge to sign. Be specific \u2014 include names, amounts, and start dates.","pdfFieldName":"Child support term"},{"fieldId":"includeSpousalSupport","label":"Should the divorce order include a spousal support term?","type":"yesno","required":true,"helpText":"Select 'No' if spousal support is already covered by a separation agreement or separate order.","pdfFieldName":"Include spousal support"},{"fieldId":"spousalSupportTerm","label":"Spousal support term to include in the order","type":"textarea","required":false,"conditional":{"dependsOn":"includeSpousalSupport","showWhen":"yes"},"placeholder":"e.g. The Respondent shall pay to the Applicant spousal support in the amount of $800 per month commencing July 1, 2025, for a period of 5 years.","pdfFieldName":"Spousal support term"},{"fieldId":"includeCustodyParenting","label":"Should the divorce order include parenting / custody terms?","type":"yesno","required":true,"helpText":"Select 'No' if parenting is already addressed in a separation agreement or a prior court order.","pdfFieldName":"Include custody parenting"},{"fieldId":"custodyParentingTerm","label":"Parenting / custody term to include in the order","type":"textarea","required":false,"conditional":{"dependsOn":"includeCustodyParenting","showWhen":"yes"},"placeholder":"e.g. The children Alex Lance and Sam Lance shall reside primarily with the Applicant. The Respondent shall have parenting time as set out in the Separation Agreement dated March 15, 2025.","pdfFieldName":"Custody parenting term"},{"fieldId":"noOrderCosts","label":"No order as to costs (each party pays their own legal costs)","type":"checkbox","required":false,"helpText":"In uncontested divorces, courts typically make no order as to costs. Check this box if that is your intention.","pdfFieldName":"No order costs"},{"fieldId":"costsTerm","label":"If a costs order is requested, describe it","type":"textarea","required":false,"placeholder":"e.g. The Respondent shall pay costs of this proceeding to the Applicant fixed at $X.","pdfFieldName":"Costs term"}]},{"partId":"review","title":"Review and confirmation","subtitle":"Step 5 of 5","intro":"Review the draft Order for Divorce carefully. The judge will sign exactly what you have prepared here. Once signed, it is a binding court order.","fields":[{"fieldId":"namChangeApplicant","label":"Is the applicant resuming a former surname after the divorce?","type":"yesno","required":false,"helpText":"You can resume a name you used before the marriage. This can be included in the divorce order itself.","pdfFieldName":"Name change applicant"},{"fieldId":"applicantFormerName","label":"Applicant's former surname to be resumed","type":"text","required":false,"conditional":{"dependsOn":"namChangeApplicant","showWhen":"yes"},"placeholder":"e.g. Smith","helpText":"You will use the divorce order as proof of name change \u2014 no other process required.","pdfFieldName":"Applicant former name"},{"fieldId":"bothPartiesConsent","label":"Is this an uncontested (joint or sole) divorce where both parties agree?","type":"yesno","required":true,"helpText":"If the other party is contesting the divorce, the order terms will be determined by the court at a hearing.","pdfFieldName":"Both parties consent"},{"fieldId":"declarationConfirmed","label":"I confirm this Order for Divorce accurately reflects what I am asking the court to order.","type":"checkbox","required":true,"pdfFieldName":"Declaration confirmed"}]}]};
  window.__hp_formDefs['ON-F15'] = {"formId":"ON-F15","jurisdiction":"ON","pdfFileName":"form15.pdf","title":"Form 15 \u2014 Motion to Change","subtitle":"Ontario Family Court \u2014 Family Law Rules (FLR 15)","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 15 is used when you want to change an existing court order or agreement and the other party does NOT agree to the change. If both parties agree, use Form 23 (Consent Motion to Change) instead. To bring a Motion to Change, you must show the court there has been a 'material change in circumstances' since the original order was made \u2014 something significant has changed that was not anticipated at the time.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 7","intro":"Enter the court file details from the original order you want to change.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":true,"placeholder":"e.g. FC-2024-12345","helpText":"The file number from the original order. If you are registering an agreement to change, this may be a new file.","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"applicantFullName","label":"Your full legal name (the person asking for the change)","type":"text","source":"profile.applicant.fullName","required":true,"pdfFieldName":"Applicant full name","id":"moving_party_name","autoFill":"applicant_full_name"},{"fieldId":"respondentFullName","label":"Other party's full legal name","type":"text","source":"profile.respondent.fullName","required":true,"pdfFieldName":"Respondent full name","id":"other_party_name","autoFill":"respondent_full_name"}]},{"partId":"existingOrder","title":"The existing order or agreement","subtitle":"Step 2 of 7","intro":"Describe the existing order or agreement you want to change. Attach a copy when you file.","fields":[{"fieldId":"orderType","label":"What are you asking to change?","type":"select","required":true,"options":["A court order","A separation agreement","A domestic contract","A paternity agreement","A combined court order and agreement"],"pdfFieldName":"Order type"},{"fieldId":"orderDate","label":"Date of the existing order or agreement","type":"date","required":true,"helpText":"Found at the top or signature block of the original document.","pdfFieldName":"Order date"},{"fieldId":"orderMadeBy","label":"Name of the judge or officer who made the order (if a court order)","type":"text","required":false,"placeholder":"e.g. Justice Patel","pdfFieldName":"Order made by"},{"fieldId":"orderCurrentTerms","label":"What does the existing order or agreement currently say?","type":"textarea","required":true,"placeholder":"e.g. The Respondent pays child support of $950 per month for the child Alex Lance, born April 12, 2015.\n\nThe parties share decision-making responsibility for Alex. Alex lives primarily with the Applicant with the Respondent having parenting time every other weekend.","helpText":"Copy the relevant paragraphs from the existing order. Attach the full order when you file.","pdfFieldName":"Order current terms"}]},{"partId":"materialChange","title":"Material change in circumstances","subtitle":"Step 3 of 7","intro":"This is the most critical part. You must convince the court that something significant has changed since the original order was made. Without a material change, the court will not reopen the matter.","fields":[{"fieldId":"materialChangeType","label":"What type of change has occurred?","type":"select","required":true,"options":["Change in income \u2014 mine has decreased significantly","Change in income \u2014 the other party's has increased significantly","Change in income \u2014 mine has increased significantly","Job loss or layoff","Child's needs have changed (age, health, education, special needs)","Parenting arrangement is no longer working","One party plans to relocate","New partner / remarriage affecting support","Child has reached age of majority or become independent","Health issue \u2014 mine","Health issue \u2014 the other party's","Other significant change"],"pdfFieldName":"Material change type"},{"fieldId":"materialChangeDescription","label":"Describe the material change in detail","type":"textarea","required":true,"placeholder":"e.g. Since the order was made in March 2023, my employment circumstances have changed significantly. I was laid off from my position as a project manager in January 2026. My annual income has dropped from $95,000 to approximately $32,000 in employment insurance benefits. This change was not anticipated at the time of the original order.","helpText":"Be specific: what changed, when it changed, why it was not anticipated in the original order, and how it affects the existing terms. The court needs to see that this is a real, lasting change \u2014 not a temporary setback.","pdfFieldName":"Material change description"},{"fieldId":"whenChangeOccurred","label":"When did this change occur?","type":"date","required":true,"helpText":"The approximate date the change began.","pdfFieldName":"When change occurred"},{"fieldId":"changeNotAnticipated","label":"Explain why this change was not anticipated when the original order was made","type":"textarea","required":true,"placeholder":"e.g. At the time of the order in March 2023, I was employed full-time and my income was stable. The layoff in January 2026 was unexpected and due to company-wide restructuring beyond my control.","pdfFieldName":"Change not anticipated"}]},{"partId":"changesRequested","title":"Changes you are asking for","subtitle":"Step 4 of 7","intro":"Describe exactly what you want the court to change. Be as specific as possible about the new terms you are proposing.","fields":[{"fieldId":"changeChildSupport","label":"Are you asking to change child support?","type":"yesno","required":true,"pdfFieldName":"Change child support"},{"fieldId":"childSupportCurrentAmount","label":"Current child support amount","type":"currency","required":false,"conditional":{"dependsOn":"changeChildSupport","showWhen":"yes"},"placeholder":"0.00","pdfFieldName":"Child support current amount"},{"fieldId":"childSupportProposedAmount","label":"New child support amount you are proposing","type":"currency","required":false,"conditional":{"dependsOn":"changeChildSupport","showWhen":"yes"},"placeholder":"0.00","helpText":"Child support is set by the Child Support Guidelines based on the payor's income. Use the federal child support tables at canada.ca to find the guideline amount for your income and number of children.","pdfFieldName":"Child support proposed amount"},{"fieldId":"childSupportEffectiveDate","label":"Date you want the new amount to start","type":"date","required":false,"conditional":{"dependsOn":"changeChildSupport","showWhen":"yes"},"helpText":"Courts often make changes retroactive to the date of the motion or the date circumstances changed.","pdfFieldName":"Child support effective date"},{"fieldId":"childSupportChangeDetails","label":"Describe the full child support change you are requesting","type":"textarea","required":false,"conditional":{"dependsOn":"changeChildSupport","showWhen":"yes"},"placeholder":"e.g. I am requesting that child support be reduced from $950 per month to $385 per month, which is the Child Support Guidelines amount for one child based on my current annual income of $32,000. I am requesting this change be effective January 1, 2026.","pdfFieldName":"Child support change details"},{"fieldId":"changeSpousalSupport","label":"Are you asking to change spousal support?","type":"yesno","required":true,"pdfFieldName":"Change spousal support"},{"fieldId":"spousalSupportCurrentAmount","label":"Current spousal support amount","type":"currency","required":false,"conditional":{"dependsOn":"changeSpousalSupport","showWhen":"yes"},"placeholder":"0.00","pdfFieldName":"Spousal support current amount"},{"fieldId":"spousalSupportProposedAmount","label":"New spousal support amount you are proposing (enter 0 to terminate)","type":"currency","required":false,"conditional":{"dependsOn":"changeSpousalSupport","showWhen":"yes"},"placeholder":"0.00","pdfFieldName":"Spousal support proposed amount"},{"fieldId":"spousalSupportChangeDetails","label":"Describe the spousal support change you are requesting","type":"textarea","required":false,"conditional":{"dependsOn":"changeSpousalSupport","showWhen":"yes"},"placeholder":"e.g. I am requesting that spousal support be terminated effective June 1, 2026, as the recipient has become self-sufficient, earning $68,000 per year, and the original basis for support no longer exists.","pdfFieldName":"Spousal support change details"},{"fieldId":"changeParenting","label":"Are you asking to change parenting time or decision-making?","type":"yesno","required":true,"pdfFieldName":"Change parenting"},{"fieldId":"parentingCurrentArrangement","label":"Current parenting arrangement","type":"textarea","required":false,"conditional":{"dependsOn":"changeParenting","showWhen":"yes"},"placeholder":"e.g. Alex lives primarily with the Applicant. The Respondent has parenting time every other weekend from Friday at 6 p.m. to Sunday at 6 p.m.","pdfFieldName":"Parenting current arrangement"},{"fieldId":"parentingProposedArrangement","label":"Proposed new parenting arrangement","type":"textarea","required":false,"conditional":{"dependsOn":"changeParenting","showWhen":"yes"},"placeholder":"e.g. I am requesting equal parenting time on a week-on, week-off schedule. Alex is now 11 years old and has expressed a strong preference to spend more time with both parents.","helpText":"Be specific about days, times, and holiday schedules. Always frame changes in terms of the child's best interests.","pdfFieldName":"Parenting proposed arrangement"},{"fieldId":"changeOther","label":"Are you asking to change any other term of the order?","type":"yesno","required":true,"pdfFieldName":"Change other"},{"fieldId":"otherChangeDetails","label":"Describe the other change you are requesting","type":"textarea","required":false,"conditional":{"dependsOn":"changeOther","showWhen":"yes"},"placeholder":"e.g. I am requesting that the requirement to maintain life insurance be removed, as the child support obligation is being reduced.","pdfFieldName":"Other change details"}]},{"partId":"children","title":"Children","subtitle":"Step 5 of 7","intro":"If the changes involve children, provide their current details.","fields":[{"fieldId":"hasChildren","label":"Do the requested changes involve children?","type":"yesno","required":true,"pdfFieldName":"Has children"},{"fieldId":"childrenDetails","label":"List the children (name, date of birth, where they live now)","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildren","showWhen":"yes"},"source":"profile.children.list","placeholder":"Alex Lance \u2014 born April 12, 2015 \u2014 living with Applicant\nSam Lance \u2014 born September 3, 2018 \u2014 living with Applicant","pdfFieldName":"Children details"},{"fieldId":"childrenCurrentSituation","label":"Describe how the children's situation has changed since the original order","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildren","showWhen":"yes"},"placeholder":"e.g. Alex is now 11 years old and in Grade 6. Since the order was made, Alex has started a competitive hockey program that runs on weekends, which conflicts with the current parenting schedule.","pdfFieldName":"Children current situation"},{"fieldId":"bestInterestsBasis","label":"Why are the proposed changes in the best interests of the children?","type":"textarea","required":false,"conditional":{"dependsOn":"hasChildren","showWhen":"yes"},"placeholder":"e.g. Alex has expressed a clear preference (at age 11) to spend more time with the Respondent. Equal parenting time will strengthen Alex's relationship with both parents and is consistent with Alex's wishes.","pdfFieldName":"Best interests basis"}]},{"partId":"temporaryOrder","title":"Temporary order (if needed urgently)","subtitle":"Step 6 of 7","intro":"If you need the court to make a temporary change right away \u2014 while your full Motion to Change is being scheduled \u2014 you can ask for a temporary order.","fields":[{"fieldId":"seekingTemporaryOrder","label":"Are you asking for a temporary order in addition to the final change?","type":"yesno","required":true,"helpText":"A temporary order provides immediate relief while you wait for the full hearing, which can be months away.","pdfFieldName":"Seeking temporary order"},{"fieldId":"temporaryOrderDetails","label":"Describe the temporary order you are asking for","type":"textarea","required":false,"conditional":{"dependsOn":"seekingTemporaryOrder","showWhen":"yes"},"placeholder":"e.g. I am asking for a temporary reduction in child support from $950 to $385 per month, effective immediately, until the full motion is heard. I cannot afford the current amount on my reduced income.","pdfFieldName":"Temporary order details"},{"fieldId":"urgencyReason","label":"Why is a temporary order needed urgently?","type":"textarea","required":false,"conditional":{"dependsOn":"seekingTemporaryOrder","showWhen":"yes"},"placeholder":"e.g. I have been unable to meet the current support obligation since my layoff in January 2026. I am accumulating arrears and face enforcement action by the Family Responsibility Office.","pdfFieldName":"Urgency reason"}]},{"partId":"review","title":"Review and sign","subtitle":"Step 7 of 7","intro":"Review your Motion to Change. After filing, you must serve the other party and file a Form 15A (Change Information) and a supporting affidavit.","fields":[{"fieldId":"form15aReminder","label":"I understand I must file a supporting affidavit (Form 14A) and Financial Statement (Form 13) with this motion.","type":"checkbox","required":true,"helpText":"Form 15A was revoked in May 2020. You now support a Motion to Change with a Form 14A affidavit and, if support is at issue, a Form 13 or 13.1 Financial Statement.","pdfFieldName":"Form 15A reminder"},{"fieldId":"serviceReminder","label":"I understand I must serve the other party with this motion and file proof of service (Form 6B).","type":"checkbox","required":true,"pdfFieldName":"Service reminder"},{"fieldId":"signatureDate","label":"Date of signature","type":"date","required":true,"pdfFieldName":"Signature date"},{"fieldId":"declarationConfirmed","label":"I confirm the information in this Motion to Change is accurate and complete.","type":"checkbox","required":true,"pdfFieldName":"Declaration confirmed"}]}]};
  window.__hp_formDefs['ON-F15A'] = {"formId":"ON-F15A",
  "pdfFileName": "form15c.pdf","formCode":"form15a-change-info","title":"Form 15A \u2014 Change Information (Retired — revoked May 2020)","jurisdiction":"Ontario","version":"RETIRED","description":"\u26a0\ufe0f This form was revoked effective May 1, 2020 under O. Reg. 373/20. Its content was folded into the redesigned Form 15 (Motion to Change). Do not file this form — courts will reject it. Use Form 15 instead. Former description: Financial and personal disclosure companion to Form 15 (Motion to Change). Provides current income, expenses, reason for change, comparison of old vs proposed order terms, and children's current circumstances.","autoPopulateFrom":["form8-general","form13-financial","form15-motion-to-change"],"steps":[{"stepId":"ci-step1","title":"Party Information","description":"Confirm the names of the parties involved in the original order.","fields":[{"id":"applicant_full_name","label":"Your full legal name (Applicant/Moving Party)","type":"text","required":true,"placeholder":"e.g. Jane Marie Smith","autoPopulate":"applicant_full_name","helpText":"Enter your name exactly as it appears on the existing court order."},{"id":"respondent_full_name","label":"Other party's full legal name (Respondent)","type":"text","required":true,"placeholder":"e.g. John Robert Smith","autoPopulate":"respondent_full_name"},{"id":"court_file_number","label":"Court file number","type":"text","required":true,"placeholder":"e.g. FC-2022-12345","autoPopulate":"court_file_number","helpText":"Found on your existing order or any court documents for this case."},{"id":"courthouse_name","label":"Name of courthouse","type":"text","required":true,"placeholder":"e.g. Ontario Court of Justice \u2013 Toronto","autoPopulate":"courthouse_name"},{"id":"original_order_date","label":"Date of the order you want to change","type":"date","required":true,"helpText":"The date shown on the existing order or agreement being varied."},{"id":"original_order_type","label":"Type of original order","type":"select","required":true,"options":[{"value":"court_order","label":"Court order"},{"value":"consent_order","label":"Consent order"},{"value":"separation_agreement","label":"Separation agreement"},{"value":"minutes_of_settlement","label":"Minutes of settlement"},{"value":"other","label":"Other"}]},{"id":"original_order_type_other","label":"Describe the type of original order","type":"text","required":false,"conditionalOn":{"field":"original_order_type","value":"other"},"placeholder":"Describe the type of order or agreement"}]},{"stepId":"ci-step2","title":"Your Current Income","description":"Provide your current income details. This information is used to assess whether a change to support is warranted.","fields":[{"id":"applicant_employment_status","label":"Your current employment status","type":"select","required":true,"options":[{"value":"employed_full_time","label":"Employed full-time"},{"value":"employed_part_time","label":"Employed part-time"},{"value":"self_employed","label":"Self-employed"},{"value":"unemployed","label":"Unemployed"},{"value":"on_disability","label":"On disability benefits"},{"value":"on_employment_insurance","label":"On employment insurance (EI)"},{"value":"retired","label":"Retired"},{"value":"student","label":"Full-time student"}]},{"id":"applicant_employer_name","label":"Name of your employer","type":"text","required":false,"placeholder":"e.g. ABC Company Inc.","conditionalOn":{"field":"applicant_employment_status","value":"employed_full_time","orValues":["employed_full_time","employed_part_time"]}},{"id":"applicant_annual_income","label":"Your current annual income (before taxes, in CAD)","type":"number","required":true,"placeholder":"e.g. 55000","prefix":"$","helpText":"Include all sources: employment, self-employment, government benefits, investment income, etc."},{"id":"applicant_income_sources","label":"Sources of your income","type":"checkbox-group","required":true,"options":[{"value":"employment","label":"Employment wages or salary"},{"value":"self_employment","label":"Self-employment income"},{"value":"ei","label":"Employment insurance (EI)"},{"value":"ontario_disability","label":"Ontario Disability Support Program (ODSP)"},{"value":"ontario_works","label":"Ontario Works (OW)"},{"value":"cpp","label":"Canada Pension Plan (CPP)"},{"value":"oas","label":"Old Age Security (OAS)"},{"value":"rental","label":"Rental income"},{"value":"investment","label":"Investment or dividend income"},{"value":"other","label":"Other income"}]},{"id":"applicant_income_change_since_order","label":"Has your income changed significantly since the original order?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"applicant_income_at_order","label":"What was your annual income at the time of the original order?","type":"number","required":false,"prefix":"$","conditionalOn":{"field":"applicant_income_change_since_order","value":"yes"},"placeholder":"e.g. 70000"},{"id":"applicant_income_change_explanation","label":"Briefly explain the change in your income","type":"textarea","required":false,"conditionalOn":{"field":"applicant_income_change_since_order","value":"yes"},"placeholder":"e.g. I was laid off in March 2024 and have been unable to find equivalent employment. My current income is from part-time work and EI benefits."}]},{"stepId":"ci-step3","title":"Other Party's Current Income","description":"Provide what you know about the other party's current income. If you don't have exact figures, provide your best estimate and explain.","fields":[{"id":"respondent_employment_status_known","label":"Do you know the other party's current employment status?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No \u2014 I don't have this information"}]},{"id":"respondent_employment_status","label":"Other party's current employment status","type":"select","required":false,"conditionalOn":{"field":"respondent_employment_status_known","value":"yes"},"options":[{"value":"employed_full_time","label":"Employed full-time"},{"value":"employed_part_time","label":"Employed part-time"},{"value":"self_employed","label":"Self-employed"},{"value":"unemployed","label":"Unemployed"},{"value":"on_disability","label":"On disability benefits"},{"value":"on_employment_insurance","label":"On employment insurance (EI)"},{"value":"retired","label":"Retired"},{"value":"student","label":"Full-time student"},{"value":"unknown","label":"Unknown / Not certain"}]},{"id":"respondent_annual_income_estimate","label":"Other party's estimated current annual income (before taxes, in CAD)","type":"number","required":false,"prefix":"$","placeholder":"e.g. 80000","helpText":"Provide your best estimate. You may request financial disclosure through the court if needed."},{"id":"respondent_income_basis","label":"How do you know or estimate the other party's income?","type":"textarea","required":false,"placeholder":"e.g. Based on their LinkedIn profile, they are still working as an engineer at the same company. I estimate their salary is approximately $80,000\u2013$90,000 per year."},{"id":"respondent_income_changed","label":"Do you believe the other party's income has changed significantly since the original order?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 their income has increased or decreased significantly"},{"value":"no","label":"No \u2014 their income appears similar to what it was"},{"value":"unknown","label":"I don't know"}]},{"id":"respondent_income_change_explanation","label":"Explain what you believe changed about the other party's income","type":"textarea","required":false,"conditionalOn":{"field":"respondent_income_changed","value":"yes"},"placeholder":"e.g. I understand they received a significant promotion and are now earning considerably more than at the time of our original order."}]},{"stepId":"ci-step4","title":"Your Current Monthly Expenses","description":"List your current monthly expenses. This helps the court understand your financial need and ability to pay.","fields":[{"id":"expense_rent_mortgage","label":"Rent or mortgage","type":"number","required":true,"prefix":"$","placeholder":"0.00","helpText":"Monthly amount. Enter 0 if not applicable."},{"id":"expense_utilities","label":"Utilities (hydro, gas, water, internet, phone)","type":"number","required":true,"prefix":"$","placeholder":"0.00"},{"id":"expense_food_groceries","label":"Food and groceries","type":"number","required":true,"prefix":"$","placeholder":"0.00"},{"id":"expense_transportation","label":"Transportation (car payment, insurance, gas, transit)","type":"number","required":true,"prefix":"$","placeholder":"0.00"},{"id":"expense_childcare","label":"Childcare or daycare","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"expense_medical","label":"Medical, dental, prescriptions (not covered by insurance)","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"expense_children_activities","label":"Children's activities, school supplies, clothing","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"expense_insurance","label":"Life or health insurance premiums","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"expense_debt_payments","label":"Debt payments (credit card minimums, loans, lines of credit)","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"expense_other","label":"Other significant monthly expenses","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"expense_other_description","label":"Describe the other expenses","type":"text","required":false,"placeholder":"e.g. tutoring, therapy, union dues"},{"id":"expense_total_monthly","label":"Total monthly expenses","type":"number","required":true,"prefix":"$","placeholder":"0.00","helpText":"Add up all the monthly expenses listed above.","autoCalculate":{"operation":"sum","fields":["expense_rent_mortgage","expense_utilities","expense_food_groceries","expense_transportation","expense_childcare","expense_medical","expense_children_activities","expense_insurance","expense_debt_payments","expense_other"]}}]},{"stepId":"ci-step5","title":"Reason for Requested Change","description":"Explain why you are asking the court to change the existing order. There must be a material change in circumstances since the original order was made.","fields":[{"id":"material_change_categories","label":"What material changes have occurred? (select all that apply)","type":"checkbox-group","required":true,"helpText":"A 'material change' means a significant change that was not anticipated when the original order was made.","options":[{"value":"income_loss","label":"My income has significantly decreased (e.g. job loss, reduced hours, illness)"},{"value":"income_increase_other","label":"The other party's income has significantly increased"},{"value":"child_needs_changed","label":"The children's needs have changed significantly"},{"value":"parenting_arrangement_changed","label":"Parenting time or custody arrangements have changed in practice"},{"value":"child_relocation","label":"A child has changed residence"},{"value":"child_disability","label":"A child has developed special needs or a disability"},{"value":"child_adult","label":"A child is approaching or has reached the age of majority"},{"value":"remarriage_cohabitation","label":"I or the other party has remarried or begun cohabiting"},{"value":"health_change","label":"A significant health change affecting ability to work or care for children"},{"value":"new_child","label":"A new child has been born"},{"value":"other","label":"Other material change"}]},{"id":"material_change_details","label":"Describe the material change(s) in detail","type":"textarea","required":true,"placeholder":"e.g. In January 2025 I was laid off from my position as a logistics coordinator due to company downsizing. Despite actively seeking new employment, I have been unable to secure comparable work. My income has dropped from $72,000 per year to approximately $24,000 in EI benefits. This is a significant and unanticipated change that has made it impossible to continue paying the original support amount.","helpText":"Be specific. Include dates, amounts, and any supporting facts. This narrative is central to your motion."},{"id":"change_in_custody_parenting","label":"Has the actual parenting or custody arrangement changed since the original order?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 the arrangement has changed from what the order says"},{"value":"no","label":"No \u2014 the arrangement follows the order"}]},{"id":"change_in_custody_parenting_details","label":"Describe how the parenting arrangement differs from the order","type":"textarea","required":false,"conditionalOn":{"field":"change_in_custody_parenting","value":"yes"},"placeholder":"e.g. The children have been living primarily with me for the past 8 months rather than following the 50/50 schedule in the order. The other party agreed to this informally but has not consented to changing the order."},{"id":"arrears_owing","label":"Are there any outstanding arrears (unpaid support) under the current order?","type":"radio","required":true,"options":[{"value":"yes_i_owe","label":"Yes \u2014 I owe arrears"},{"value":"yes_they_owe","label":"Yes \u2014 the other party owes me arrears"},{"value":"no","label":"No \u2014 payments are current"}]},{"id":"arrears_amount","label":"Total amount of arrears","type":"number","required":false,"prefix":"$","conditionalOn":{"field":"arrears_owing","value":"yes_i_owe","orValues":["yes_i_owe","yes_they_owe"]},"placeholder":"e.g. 4500"},{"id":"arrears_explanation","label":"Explain the arrears","type":"textarea","required":false,"conditionalOn":{"field":"arrears_owing","value":"yes_i_owe","orValues":["yes_i_owe","yes_they_owe"]},"placeholder":"e.g. I fell behind on payments starting in February 2025 when I was laid off. I owe approximately $4,500 in arrears. I am requesting that the court consider suspending or reducing arrears enforcement while my income situation is resolved."}]},{"stepId":"ci-step6","title":"Comparison: Current Order vs. Proposed Change","description":"Provide the specific terms of the current order and what you are asking the court to change them to.","fields":[{"id":"current_child_support_amount","label":"Child support \u2014 current monthly amount under the order","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Enter 0 if the current order does not include child support."},{"id":"proposed_child_support_amount","label":"Child support \u2014 proposed new monthly amount","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Enter the amount you are asking the court to set. Enter 0 if you are asking for child support to be terminated."},{"id":"child_support_change_reason","label":"Briefly explain why you are asking for this child support change","type":"textarea","required":false,"placeholder":"e.g. Based on my current income of $24,000 per year, the Federal Child Support Guidelines table amount for one child is $198/month, compared to the current order of $650/month which was based on my prior income of $72,000."},{"id":"current_spousal_support_amount","label":"Spousal support \u2014 current monthly amount under the order","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Enter 0 if the current order does not include spousal support."},{"id":"proposed_spousal_support_amount","label":"Spousal support \u2014 proposed new monthly amount","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"spousal_support_change_reason","label":"Briefly explain why you are asking for this spousal support change","type":"textarea","required":false,"placeholder":"e.g. My income has decreased significantly and I can no longer afford the existing spousal support payments. Alternatively, the other party's income has increased substantially since the order was made."},{"id":"current_parenting_schedule","label":"Parenting time \u2014 current schedule as stated in the order","type":"textarea","required":false,"placeholder":"e.g. Equal shared parenting \u2014 children reside with each parent on alternating weeks."},{"id":"proposed_parenting_schedule","label":"Parenting time \u2014 proposed new schedule","type":"textarea","required":false,"placeholder":"e.g. Children to reside primarily with me, with parenting time for the other parent every other weekend and Wednesday evenings."},{"id":"other_order_terms_to_change","label":"Are there any other terms in the order you want changed?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"other_order_terms_details","label":"Describe the other terms you want changed and your proposed changes","type":"textarea","required":false,"conditionalOn":{"field":"other_order_terms_to_change","value":"yes"},"placeholder":"e.g. I am asking the court to change the section requiring both parents to attend family therapy together, as the relationship between the parties makes this unworkable."},{"id":"proposed_effective_date","label":"From what date should the new order take effect?","type":"date","required":false,"helpText":"Courts may backdate changes to the date you filed or the date the change in circumstances began. Leave blank if you want the court to decide."}]},{"stepId":"ci-step7","title":"Children's Current Circumstances","description":"Describe the current situation of the children affected by this motion.","fields":[{"id":"has_children","label":"Are there children affected by this motion?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No \u2014 this motion only affects spousal support or other terms"}]},{"id":"number_of_children","label":"How many children are affected?","type":"number","required":false,"conditionalOn":{"field":"has_children","value":"yes"},"placeholder":"e.g. 2"},{"id":"children_details","label":"Children's names and ages","type":"repeatable-group","required":false,"conditionalOn":{"field":"has_children","value":"yes"},"maxItems":8,"addLabel":"Add another child","fields":[{"id":"child_name","label":"Child's full name","type":"text","required":true,"placeholder":"e.g. Emily Rose Smith"},{"id":"child_dob","label":"Date of birth","type":"date","required":true},{"id":"child_current_residence","label":"Currently living primarily with","type":"select","required":true,"options":[{"value":"applicant","label":"Me (the applicant)"},{"value":"respondent","label":"The other party"},{"value":"equal_shared","label":"Equal shared \u2014 both parents equally"},{"value":"other","label":"Other arrangement"}]},{"id":"child_special_needs","label":"Does this child have any special needs or circumstances to bring to the court's attention?","type":"text","required":false,"placeholder":"e.g. diagnosed ADHD, requires weekly therapy; or 'None'"}]},{"id":"children_circumstances_narrative","label":"Describe the children's current circumstances and needs","type":"textarea","required":false,"conditionalOn":{"field":"has_children","value":"yes"},"placeholder":"e.g. Our two children, ages 7 and 10, are currently thriving in school. The older child has begun playing competitive hockey which involves significant equipment and travel costs. The younger child was recently assessed and requires speech-language therapy three times per week, which is not covered by our benefits plans.","helpText":"Include anything relevant to why the existing order no longer meets the children's needs or how your proposed change better serves them."},{"id":"children_views","label":"Have the children expressed views or preferences about the proposed change? (if age-appropriate)","type":"radio","required":false,"conditionalOn":{"field":"has_children","value":"yes"},"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No \u2014 not applicable or they have not expressed views"}]},{"id":"children_views_details","label":"Describe the children's views or preferences","type":"textarea","required":false,"conditionalOn":{"field":"children_views","value":"yes"},"placeholder":"e.g. My 13-year-old has expressed a clear preference to live primarily with me, which aligns with the arrangement that has existed in practice for the past year."}]},{"stepId":"ci-step8","title":"Review & Declaration","description":"Review your information and confirm its accuracy before generating your form.","fields":[{"id":"supporting_documents","label":"What supporting documents do you have? (select all that apply)","type":"checkbox-group","required":false,"helpText":"You will need to attach relevant documents to your motion. Check what you have available.","options":[{"value":"recent_tax_return","label":"Recent income tax return (Notice of Assessment)"},{"value":"pay_stubs","label":"Recent pay stubs (last 3 months)"},{"value":"ei_statement","label":"EI or ODSP/OW benefit statement"},{"value":"layoff_letter","label":"Letter of termination / layoff"},{"value":"medical_letter","label":"Doctor's letter or medical documentation"},{"value":"bank_statements","label":"Bank statements showing income/expenses"},{"value":"child_records","label":"School records, medical records for children"},{"value":"original_order_copy","label":"Copy of the existing court order"},{"value":"correspondence","label":"Relevant emails or correspondence with other party"}]},{"id":"previous_court_attempts","label":"Have you tried to resolve this matter with the other party before bringing this motion?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"previous_attempts_details","label":"Describe your attempts to resolve this without court","type":"textarea","required":false,"conditionalOn":{"field":"previous_court_attempts","value":"yes"},"placeholder":"e.g. I contacted the other party in March 2025 by email and again by phone to propose a temporary reduction in child support. They did not respond to my emails and refused to discuss the matter by phone. I also contacted a mediator but the other party declined to participate."},{"id":"sworn_declaration","label":"Declaration","type":"declaration","required":true,"text":"I declare that the information provided in this form is true and complete to the best of my knowledge and belief. I understand that providing false information to the court is a serious matter.","checkboxLabel":"I confirm this declaration is true and accurate."}]}],"pdfMapping":{"notes":"Form 15A Change Information \u2014 fields map to Ontario Court Services form fields. Courts may use various versions; consult the current form at ontario.ca/page/family-law-forms before filing.","party_court_header":["applicant_full_name","respondent_full_name","court_file_number","courthouse_name"],"original_order_section":["original_order_date","original_order_type"],"applicant_income_section":["applicant_employment_status","applicant_annual_income","applicant_income_sources"],"respondent_income_section":["respondent_employment_status","respondent_annual_income_estimate"],"expenses_section":["expense_rent_mortgage","expense_utilities","expense_food_groceries","expense_transportation","expense_childcare","expense_medical","expense_total_monthly"],"material_change_section":["material_change_categories","material_change_details"],"order_comparison_section":["current_child_support_amount","proposed_child_support_amount","current_spousal_support_amount","proposed_spousal_support_amount"],"children_section":["number_of_children","children_details","children_circumstances_narrative"],"declaration_section":["sworn_declaration"]}};
  window.__hp_formDefs['ON-F17'] = {"formId":"ON-F17",
  "pdfFileName": "form17.pdf","formCode":"form17-conference-notice","title":"Form 17 \u2014 Notice of Case Conference, Settlement Conference, or Trial Management Conference","jurisdiction":"Ontario","version":"2024","description":"Used to schedule and give notice of a case conference, settlement conference, or trial management conference in an Ontario family law proceeding. Required under Family Law Rules Rule 17.","autoPopulateFrom":["form8-general"],"steps":[{"stepId":"cn-step1","title":"Court & Case Information","description":"Enter the court file details. This form tells the court and the other party when and where the conference is scheduled.","fields":[{"id":"courthouse","label":"Courthouse","type":"select","required":true,"autoPopulate":"courthouse","options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"helpText":"Select the courthouse where your family law case is being heard."},{"id":"court_file_number","label":"Court file number","type":"text","required":false,"autoPopulate":"court_file_number","placeholder":"e.g. FC-2024-12345","helpText":"Leave blank if you do not yet have one. It will be assigned when you file your application."},{"id":"applicant_full_name","label":"Applicant's full legal name","type":"text","required":true,"autoPopulate":"applicant_full_name","placeholder":"e.g. Jane Marie Smith"},{"id":"respondent_full_name","label":"Respondent's full legal name","type":"text","required":true,"autoPopulate":"respondent_full_name","placeholder":"e.g. John Robert Smith"}]},{"stepId":"cn-step2","title":"Type of Conference","description":"Select which type of conference you are scheduling. Each serves a different purpose in the family law process.","fields":[{"id":"conference_type","label":"What type of conference are you scheduling?","type":"select","required":true,"options":[{"value":"case_conference","label":"Case Conference"},{"value":"settlement_conference","label":"Settlement Conference"},{"value":"trial_management_conference","label":"Trial Management Conference"}],"helpText":"Not sure which type? See the descriptions below."},{"id":"conference_type_explainer","label":"What does each type mean?","type":"info-box","content":"**Case Conference** \u2014 Usually the first meeting with a judge. The judge helps identify the issues, encourages settlement, and gives directions on next steps. Required before most motions can be brought.\n\n**Settlement Conference** \u2014 A more focused meeting where a judge actively helps both parties try to resolve the case. Usually held after a case conference. Both parties must come prepared with their best settlement offer.\n\n**Trial Management Conference** \u2014 Held just before trial to make sure both parties are ready. The judge reviews the issues going to trial, identifies witnesses, and makes procedural orders. Required before any trial."},{"id":"first_conference","label":"Is this your first conference in this case?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 this is the first conference"},{"value":"no","label":"No \u2014 there have been previous conferences"}]},{"id":"previous_conference_summary","label":"Briefly describe what happened at the last conference","type":"textarea","required":false,"conditionalOn":{"field":"first_conference","value":"no"},"placeholder":"e.g. At the case conference on March 15, 2025, Justice Smith made a temporary order for child support of $800/month. The parties were directed to exchange financial disclosure and attend a settlement conference."}]},{"stepId":"cn-step3","title":"Conference Date & Details","description":"Enter the date, time, and location for the conference. Contact the court clerk to schedule the date before completing this form.","fields":[{"id":"conference_date","label":"Date of the conference","type":"date","required":true,"helpText":"Contact the court clerk first to book a date. You must serve this notice on the other party at least 6 days before the conference."},{"id":"conference_time","label":"Time of the conference","type":"text","required":true,"placeholder":"e.g. 9:30 a.m.","helpText":"As confirmed by the court clerk."},{"id":"conference_location","label":"Location (courtroom or room number, if known)","type":"text","required":false,"placeholder":"e.g. Room 4B, 393 University Ave, Toronto ON M5G 1E6","helpText":"Leave blank if the court clerk has not yet assigned a room. The courthouse address is enough."},{"id":"conference_format","label":"Format of the conference","type":"select","required":true,"options":[{"value":"in_person","label":"In person \u2014 at the courthouse"},{"value":"video","label":"By video (e.g. Zoom)"},{"value":"telephone","label":"By telephone"},{"value":"hybrid","label":"Hybrid \u2014 some in person, some remote"}],"helpText":"Confirm the format with the court clerk. Many Ontario courts now offer video conferences."},{"id":"video_link","label":"Video conference link or dial-in information","type":"text","required":false,"conditionalOn":{"field":"conference_format","value":"video","orValues":["video","telephone","hybrid"]},"placeholder":"e.g. Zoom link: https://ontario.zoom.us/j/123456789 or call-in: 1-647-374-4685"}]},{"stepId":"cn-step4","title":"Issues for the Conference","description":"List the issues you want the conference to address. The judge will focus on what you identify here.","fields":[{"id":"issues_to_resolve","label":"What issues do you want to address at this conference? (select all that apply)","type":"checkbox-group","required":true,"helpText":"Check everything that applies. You don't need to resolve all issues \u2014 just identify what is in dispute.","options":[{"value":"decision_making","label":"Decision-making responsibility (custody)"},{"value":"parenting_time","label":"Parenting time (access schedule)"},{"value":"child_support","label":"Child support"},{"value":"spousal_support","label":"Spousal support"},{"value":"property_division","label":"Property division / equalization"},{"value":"family_home","label":"Who stays in the family home"},{"value":"restraining_order","label":"Restraining order or non-harassment order"},{"value":"relocation","label":"Relocation of a child"},{"value":"disclosure","label":"Financial disclosure obligations"},{"value":"procedural_matters","label":"Procedural matters (timetable, next steps)"},{"value":"enforcement","label":"Enforcement of an existing order"},{"value":"arrears","label":"Child or spousal support arrears"},{"value":"other","label":"Other issue"}]},{"id":"other_issue_description","label":"Describe the other issue","type":"text","required":false,"conditionalOn":{"field":"issues_to_resolve","value":"other"},"placeholder":"e.g. Division of a specific pension, passport for child travel"},{"id":"issues_agreed","label":"Are there any issues that are already agreed between the parties?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 some issues are settled"},{"value":"no","label":"No \u2014 all listed issues are still in dispute"}]},{"id":"agreed_issues_description","label":"Describe what has already been agreed","type":"textarea","required":false,"conditionalOn":{"field":"issues_agreed","value":"yes"},"placeholder":"e.g. The parties have agreed that the children will continue to attend the same school. Parenting time and child support amounts are still in dispute."}]},{"stepId":"cn-step5","title":"Orders You Are Seeking","description":"Tell the court what you want the judge to order or direct at this conference.","fields":[{"id":"seeking_temporary_order","label":"Are you asking the judge to make any temporary orders at this conference?","type":"radio","required":true,"helpText":"At a case conference or settlement conference, a judge can make temporary orders on consent or on a motion. Identify if you need something in the short term.","options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No \u2014 just asking for directions and next steps"}]},{"id":"temporary_orders_sought","label":"Describe the temporary order(s) you are asking for","type":"textarea","required":false,"conditionalOn":{"field":"seeking_temporary_order","value":"yes"},"placeholder":"e.g. A temporary order that the children reside primarily with me pending trial, and that the Respondent pay interim child support of $750/month."},{"id":"directions_sought","label":"What procedural directions are you asking the judge to give?","type":"checkbox-group","required":false,"helpText":"Directions are instructions from the judge about how the case should proceed.","options":[{"value":"timetable","label":"Set a timetable for exchanging documents and evidence"},{"value":"financial_disclosure","label":"Order the other party to provide financial disclosure"},{"value":"valuations","label":"Order property or business valuations"},{"value":"expert_report","label":"Order an expert report (e.g. parenting assessment)"},{"value":"mediation","label":"Refer to mediation"},{"value":"trial_date","label":"Set a trial date"},{"value":"other_direction","label":"Other procedural direction"}]},{"id":"other_direction_description","label":"Describe the other direction you are seeking","type":"text","required":false,"conditionalOn":{"field":"directions_sought","value":"other_direction"},"placeholder":"e.g. Order that both parties complete parenting education program before next conference"}]},{"stepId":"cn-step6","title":"Background Facts","description":"Provide a brief summary of the facts. The judge reads this before the conference to understand your situation.","fields":[{"id":"relationship_summary","label":"Brief history of the relationship and family","type":"textarea","required":true,"placeholder":"e.g. The parties were married on June 12, 2015 in Toronto and separated on February 1, 2024. There are two children: Alex (age 10) and Sam (age 7). The parties lived in the family home at 123 Main St, Toronto until separation. The Applicant remains in the family home with the children. The Respondent moved to an apartment nearby.","helpText":"Keep it factual and brief \u2014 3 to 5 sentences. The judge uses this to understand the basics of your case before the conference."},{"id":"current_arrangements","label":"What are the current arrangements for the children and finances?","type":"textarea","required":true,"placeholder":"e.g. The children currently live primarily with the Applicant on a temporary basis. The Respondent has parenting time every other weekend. No support is currently being paid. There is no existing court order \u2014 these are informal arrangements only.","helpText":"Describe what is actually happening right now, even if there is no formal order."},{"id":"main_concern","label":"What is your main concern going into this conference?","type":"textarea","required":true,"placeholder":"e.g. My main concern is stabilizing the children's living situation and getting a temporary support order in place. The other party has been refusing to provide any financial disclosure, which is preventing us from resolving support amounts.","helpText":"Be honest and specific. This helps the judge understand what matters most to you."}]},{"stepId":"cn-step7","title":"Service & Confirmation","description":"You must serve this notice on the other party before the conference.","fields":[{"id":"service_method","label":"How will you serve this notice on the other party?","type":"select","required":true,"options":[{"value":"by_hand","label":"By hand (personal service)"},{"value":"by_mail","label":"By mail"},{"value":"by_email","label":"By email (if agreed or court-ordered)"},{"value":"via_lawyer","label":"Through the other party's lawyer"},{"value":"by_courier","label":"By courier"}],"helpText":"You must serve at least 6 days before the conference."},{"id":"service_planned_date","label":"When do you plan to serve the other party?","type":"date","required":false,"helpText":"Must be at least 6 days before the conference date."},{"id":"conference_brief_reminder","label":"Conference brief reminder","type":"info-box","content":"**Important:** You must also prepare and serve a **conference brief** at least 7 days before the conference. The brief summarizes your position on each issue. Ask the court clerk which brief form is required for your type of conference (usually Form 17A for case conferences, Form 17C for settlement conferences, or Form 17E for trial management conferences)."},{"id":"brief_prepared","label":"Have you prepared your conference brief?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 my brief is ready"},{"value":"in_progress","label":"In progress \u2014 I am preparing it now"},{"value":"no","label":"Not yet \u2014 I will prepare it before the deadline"}]},{"id":"declaration_confirmed","label":"Declaration","type":"checkbox","required":true,"checkboxLabel":"I confirm the information in this Notice of Conference is accurate. I understand this form will be filed with the Ontario court and served on the other party."}]}],"pdfMapping":{"notes":"Form 17 \u2014 used for case conference, settlement conference, and trial management conference notices. Filed with the court and served on the other party. See ontario.ca/page/family-law-forms for current version.","court_header":["courthouse","court_file_number","applicant_full_name","respondent_full_name"],"conference_section":["conference_type","conference_date","conference_time","conference_location","conference_format"],"issues_section":["issues_to_resolve","issues_agreed","agreed_issues_description"],"orders_section":["seeking_temporary_order","temporary_orders_sought","directions_sought"],"facts_section":["relationship_summary","current_arrangements","main_concern"],"service_section":["service_method","service_planned_date"],"declaration_section":["declaration_confirmed"]}};
  window.__hp_formDefs['ON-F17E'] = {"formId":"ON-F17E",
  "pdfFileName": "form17e.pdf","formCode":"form17e-trial-brief","title":"Form 17E \u2014 Trial Management Conference Brief","jurisdiction":"Ontario","version":"2024","description":"Prepared by each party before a trial management conference. Summarizes the issues going to trial, witnesses, evidence, time estimate, and any remaining settlement possibilities. Required under Family Law Rules Rule 17(13).","autoPopulateFrom":["form8-general","form13-financial","form17-conference-notice"],"steps":[{"stepId":"tb-step1","title":"Case Identification","description":"Confirm the court and case details. This brief must be filed and served at least 7 days before the trial management conference.","fields":[{"id":"courthouse","label":"Courthouse","type":"select","required":true,"autoPopulate":"courthouse","options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"]},{"id":"court_file_number","label":"Court file number","type":"text","required":true,"autoPopulate":"court_file_number","placeholder":"e.g. FC-2024-12345"},{"id":"applicant_full_name","label":"Applicant's full legal name","type":"text","required":true,"autoPopulate":"applicant_full_name","placeholder":"e.g. Jane Marie Smith"},{"id":"respondent_full_name","label":"Respondent's full legal name","type":"text","required":true,"autoPopulate":"respondent_full_name","placeholder":"e.g. John Robert Smith"},{"id":"party_role","label":"You are completing this brief as","type":"select","required":true,"options":[{"value":"applicant","label":"The Applicant"},{"value":"respondent","label":"The Respondent"}]},{"id":"tmc_date","label":"Date of the trial management conference","type":"date","required":true,"helpText":"This brief must be served on the other party and filed with the court at least 7 days before this date."},{"id":"trial_date","label":"Scheduled trial date (if set)","type":"date","required":false,"helpText":"If a trial date has already been scheduled, enter it here. Leave blank if not yet set."}]},{"stepId":"tb-step2","title":"Issues Going to Trial","description":"List every issue that has NOT been resolved and must be decided by the judge at trial. Be thorough \u2014 issues not listed here may not be raised at trial.","fields":[{"id":"trial_issues","label":"Issues remaining for trial (select all that apply)","type":"checkbox-group","required":true,"helpText":"Only check issues that are still genuinely in dispute. Settled issues should not be listed.","options":[{"value":"decision_making","label":"Decision-making responsibility (custody)"},{"value":"parenting_time","label":"Parenting time schedule"},{"value":"relocation","label":"Relocation of a child"},{"value":"child_support_amount","label":"Amount of child support"},{"value":"child_support_arrears","label":"Child support arrears"},{"value":"special_extraordinary_expenses","label":"Special or extraordinary expenses (Section 7)"},{"value":"spousal_support_entitlement","label":"Whether spousal support should be paid (entitlement)"},{"value":"spousal_support_amount","label":"Amount of spousal support"},{"value":"spousal_support_duration","label":"Duration of spousal support"},{"value":"spousal_support_arrears","label":"Spousal support arrears"},{"value":"equalization","label":"Property equalization (net family property)"},{"value":"possession_family_home","label":"Possession of the family home"},{"value":"specific_property","label":"Division of a specific asset (pension, business, investment)"},{"value":"restraining_order","label":"Restraining or non-harassment order"},{"value":"costs","label":"Costs of the proceeding"},{"value":"other_trial_issue","label":"Other issue"}]},{"id":"other_trial_issue_description","label":"Describe the other trial issue","type":"text","required":false,"conditionalOn":{"field":"trial_issues","value":"other_trial_issue"},"placeholder":"e.g. Interpretation of a term in the separation agreement"},{"id":"issues_resolved_before_trial","label":"Have any issues been resolved since the last conference?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No \u2014 all listed issues remain in dispute"}]},{"id":"resolved_issues_description","label":"Describe what has been resolved","type":"textarea","required":false,"conditionalOn":{"field":"issues_resolved_before_trial","value":"yes"},"placeholder":"e.g. Child support has been agreed at $850/month effective September 1, 2025. Only the issue of parenting time and spousal support remain for trial."}]},{"stepId":"tb-step3","title":"Your Position on Each Issue","description":"For each issue going to trial, state your position clearly. The judge will read this to understand what you are asking for and why.","fields":[{"id":"position_decision_making","label":"Your position on decision-making responsibility (custody)","type":"textarea","required":false,"placeholder":"e.g. I am asking for sole decision-making responsibility. The other party and I are unable to communicate effectively about the children's medical and educational decisions. The children's school records show I have been their primary caregiver throughout the relationship and since separation.","helpText":"State clearly what you are asking for and the key facts that support your position. Keep it to the point."},{"id":"position_parenting_time","label":"Your position on parenting time","type":"textarea","required":false,"placeholder":"e.g. I am asking that the children reside primarily with me on a schedule of: school weeks with me, alternating weekends with the other party (Friday 6 p.m. to Sunday 6 p.m.), and equal sharing of statutory holidays. This mirrors the arrangement that has been in place since separation and is working well for the children."},{"id":"position_child_support","label":"Your position on child support","type":"textarea","required":false,"placeholder":"e.g. Based on the other party's annual income of $82,000 (as disclosed in their financial statement), the Child Support Guidelines amount for two children is $1,340/month. I am asking for this amount plus contribution to the children's extracurricular and medical expenses (Section 7)."},{"id":"position_spousal_support","label":"Your position on spousal support","type":"textarea","required":false,"placeholder":"e.g. I am asking for spousal support of $1,200/month for a period of 8 years. I left full-time employment in 2018 to care for the children at the other party's request, losing significant career advancement. The Spousal Support Advisory Guidelines range is $900\u2013$1,500/month for 6\u201312 years based on our incomes."},{"id":"position_property","label":"Your position on property division / equalization","type":"textarea","required":false,"placeholder":"e.g. I am asking for an equalization payment of $47,000 based on my net family property calculation. The main assets in dispute are the RRSP ($62,000), the car ($18,000), and a business interest the other party has not fully disclosed."},{"id":"position_other_issues","label":"Your position on any other trial issues","type":"textarea","required":false,"placeholder":"e.g. Regarding costs: the other party has consistently refused to disclose financial information and rejected reasonable settlement offers. I am asking for full recovery costs on a substantial indemnity basis."}]},{"stepId":"tb-step4","title":"Witnesses","description":"List every witness you plan to call at trial. Include yourself. Failing to list a witness here may prevent you from calling them at trial.","fields":[{"id":"witnesses","label":"Witnesses you plan to call at trial","type":"repeatable-group","required":true,"maxItems":15,"addLabel":"Add another witness","helpText":"List all witnesses including yourself. You do not need to list the other party \u2014 they are not your witness.","fields":[{"id":"witness_name","label":"Witness name","type":"text","required":true,"placeholder":"e.g. Jane Smith (myself) or Dr. Sarah Lee"},{"id":"witness_role","label":"Role or relationship to the case","type":"text","required":true,"placeholder":"e.g. Applicant / Mother, Treating physician, Teacher at child's school, Accountant"},{"id":"witness_testimony_summary","label":"What will this witness testify about?","type":"textarea","required":true,"placeholder":"e.g. Will testify about the children's daily routine, the parenting arrangements since separation, and the Respondent's involvement (or lack thereof) in school and medical appointments."},{"id":"witness_time_estimate","label":"Estimated time for this witness (examination + cross-examination)","type":"select","required":true,"options":[{"value":"30_min","label":"30 minutes"},{"value":"1_hour","label":"1 hour"},{"value":"1.5_hours","label":"1.5 hours"},{"value":"2_hours","label":"2 hours"},{"value":"half_day","label":"Half day (3 hours)"},{"value":"full_day","label":"Full day"}]},{"id":"witness_is_expert","label":"Is this an expert witness?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 qualified expert (e.g. psychologist, appraiser, accountant)"},{"value":"no","label":"No \u2014 fact witness or party"}]},{"id":"expert_report_served","label":"Has the expert's report been served on the other party?","type":"radio","required":false,"conditionalOn":{"field":"witness_is_expert","value":"yes"},"options":[{"value":"yes","label":"Yes \u2014 served"},{"value":"no","label":"No \u2014 not yet served"}]}]}]},{"stepId":"tb-step5","title":"Evidence & Documents","description":"Identify the key documents and evidence you plan to use at trial.","fields":[{"id":"key_documents","label":"Key documents you plan to use at trial (select all that apply)","type":"checkbox-group","required":true,"options":[{"value":"financial_statements","label":"Financial statements (Form 13 or 13.1)"},{"value":"tax_returns","label":"Income tax returns and Notices of Assessment"},{"value":"pay_stubs","label":"Pay stubs and employment records"},{"value":"bank_statements","label":"Bank statements"},{"value":"property_valuations","label":"Property appraisals or valuations"},{"value":"business_records","label":"Business financial records"},{"value":"pension_records","label":"Pension and retirement account records"},{"value":"medical_records","label":"Medical records"},{"value":"school_records","label":"School and daycare records"},{"value":"parenting_records","label":"Parenting logs, photographs, communications"},{"value":"police_records","label":"Police reports or CAS records"},{"value":"text_email_records","label":"Text messages or emails"},{"value":"existing_orders","label":"Prior court orders or agreements"},{"value":"expert_reports","label":"Expert reports (parenting assessment, valuation, etc.)"},{"value":"other_documents","label":"Other documents"}]},{"id":"other_documents_description","label":"Describe the other documents","type":"text","required":false,"conditionalOn":{"field":"key_documents","value":"other_documents"},"placeholder":"e.g. Social media posts, travel records, immigration documents"},{"id":"continuing_record_complete","label":"Is your portion of the Continuing Record up to date?","type":"radio","required":true,"helpText":"The Continuing Record is the official binder of all documents filed in your case. You are responsible for keeping your section organized and filed with the court.","options":[{"value":"yes","label":"Yes \u2014 my portion of the Continuing Record is up to date"},{"value":"no","label":"No \u2014 I need to add documents before trial"},{"value":"unsure","label":"I'm not sure \u2014 I will confirm with the court clerk"}]},{"id":"documents_still_needed","label":"Are there any documents you still need from the other party or a third party?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No \u2014 I have all the documents I need"}]},{"id":"documents_still_needed_details","label":"Describe what documents you still need and from whom","type":"textarea","required":false,"conditionalOn":{"field":"documents_still_needed","value":"yes"},"placeholder":"e.g. I am still waiting for the other party's business financial records for 2022\u20132024, which they have not produced despite being ordered to do so. I may need to bring a motion to compel production before trial."}]},{"stepId":"tb-step6","title":"Time Estimate for Trial","description":"The judge needs to know how long trial will take to allocate court time properly.","fields":[{"id":"your_time_estimate","label":"How many days do you estimate your case will take (your witnesses + your cross-examinations of the other party's witnesses)?","type":"select","required":true,"options":[{"value":"1_day","label":"1 day"},{"value":"2_days","label":"2 days"},{"value":"3_days","label":"3 days"},{"value":"4_days","label":"4 days"},{"value":"5_days","label":"5 days (1 week)"},{"value":"6_to_10_days","label":"6\u201310 days (2 weeks)"},{"value":"more_than_10_days","label":"More than 10 days"}]},{"id":"total_trial_estimate","label":"What is your estimate for the total length of trial (both parties combined)?","type":"select","required":true,"options":[{"value":"1_day","label":"1 day"},{"value":"2_days","label":"2 days"},{"value":"3_days","label":"3 days"},{"value":"4_days","label":"4 days"},{"value":"5_days","label":"5 days (1 week)"},{"value":"6_to_10_days","label":"6\u201310 days"},{"value":"more_than_10_days","label":"More than 10 days"}],"helpText":"This is your estimate for the whole trial \u2014 your side and the other party's side combined."},{"id":"scheduling_constraints","label":"Are there any scheduling constraints the court should know about?","type":"textarea","required":false,"placeholder":"e.g. The expert witness (Dr. Sarah Lee) is not available in August. One of the parties has pre-booked travel July 10\u201317. The school-year schedule affects the children and I would prefer a trial date after September.","helpText":"List any dates to avoid for any witness or party, or any other scheduling considerations."},{"id":"interpreter_needed","label":"Does any party or witness need a court interpreter?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"interpreter_language","label":"What language(s) does the interpreter need to speak?","type":"text","required":false,"conditionalOn":{"field":"interpreter_needed","value":"yes"},"placeholder":"e.g. French, Punjabi, Mandarin"},{"id":"accommodation_needs","label":"Are there any accessibility or accommodation needs for any party or witness?","type":"textarea","required":false,"placeholder":"e.g. The Applicant uses a wheelchair and requires an accessible courtroom. One witness has hearing loss and requires a hearing loop system.","helpText":"Contact the court's accessibility coordinator as early as possible if accommodations are needed."}]},{"stepId":"tb-step7","title":"Settlement Possibilities","description":"The trial management conference is a final opportunity to settle. The judge must be satisfied that settlement has been genuinely explored before proceeding to trial.","fields":[{"id":"settlement_attempts","label":"What settlement attempts have been made?","type":"checkbox-group","required":true,"options":[{"value":"direct_negotiation","label":"Direct negotiation between the parties"},{"value":"lawyer_negotiation","label":"Negotiation through lawyers"},{"value":"mediation","label":"Mediation"},{"value":"collaborative","label":"Collaborative family law process"},{"value":"offers_to_settle","label":"Formal offers to settle (Rule 18)"},{"value":"none","label":"No settlement attempts have been made"}]},{"id":"why_no_settlement","label":"Why has the case not settled?","type":"textarea","required":true,"placeholder":"e.g. The main obstacle is the other party's refusal to provide full financial disclosure, which makes it impossible to accurately value the property and calculate support. We have exchanged offers to settle on parenting but remain $400/month apart on child support.","helpText":"Be specific and factual. Identifying the real barrier to settlement often helps the judge assist at the conference."},{"id":"still_open_to_settlement","label":"Are you still open to settling some or all issues before trial?","type":"radio","required":true,"options":[{"value":"yes_all","label":"Yes \u2014 I am open to settling all remaining issues"},{"value":"yes_some","label":"Yes \u2014 I am open to settling some issues but not all"},{"value":"no","label":"No \u2014 I believe trial is necessary for all remaining issues"}]},{"id":"issues_still_negotiable","label":"Which issues are you still willing to negotiate on?","type":"textarea","required":false,"conditionalOn":{"field":"still_open_to_settlement","value":"yes_some"},"placeholder":"e.g. I am willing to negotiate the spousal support duration and amount. I am not willing to accept anything less than primary parenting time given the children's established routine with me."},{"id":"settlement_offer_outstanding","label":"Is there a formal settlement offer currently outstanding?","type":"radio","required":true,"helpText":"A formal offer to settle (Rule 18) can affect who pays costs at the end of trial if it is rejected and the other party does not do better at trial.","options":[{"value":"yes_i_made","label":"Yes \u2014 I made an offer that has not been accepted"},{"value":"yes_they_made","label":"Yes \u2014 the other party made an offer I have not accepted"},{"value":"both","label":"Both parties have outstanding offers"},{"value":"no","label":"No \u2014 there is no outstanding offer"}]}]},{"stepId":"tb-step8","title":"Orders Sought at the Conference","description":"At the trial management conference, the judge may make procedural orders. Identify what you are asking for.","fields":[{"id":"tmc_orders_sought","label":"At the trial management conference, I am asking the judge to","type":"checkbox-group","required":true,"options":[{"value":"confirm_trial_date","label":"Confirm or set the trial date"},{"value":"order_disclosure","label":"Order the other party to provide outstanding disclosure before trial"},{"value":"limit_witnesses","label":"Set limits on the number of witnesses each party may call"},{"value":"order_expert_reports","label":"Set deadlines for serving expert reports"},{"value":"exclude_witnesses","label":"Order witnesses to be excluded from the courtroom until called"},{"value":"bifurcate","label":"Bifurcate (split) the trial \u2014 hear some issues first"},{"value":"costs_order","label":"Make a costs order based on conduct in the proceedings"},{"value":"other_tmc_order","label":"Other order"}]},{"id":"other_tmc_order_description","label":"Describe the other order you are seeking at the TMC","type":"textarea","required":false,"conditionalOn":{"field":"tmc_orders_sought","value":"other_tmc_order"},"placeholder":"e.g. I am asking the judge to order that the parties attend a joint pre-trial meeting to attempt resolution on the financial issues with the assistance of a financial neutral."},{"id":"last_minute_issues","label":"Are there any urgent matters that have arisen recently that the court should know about?","type":"textarea","required":false,"placeholder":"e.g. The other party recently informed me they intend to relocate to another province with the children before the trial date. I may need to bring an emergency motion to prevent relocation pending trial.","helpText":"Include anything that has changed since the last court attendance that affects how the trial should proceed."}]},{"stepId":"tb-step9","title":"Declaration","description":"Confirm the accuracy of your trial management conference brief before filing.","fields":[{"id":"brief_complete_confirmation","label":"I confirm this Trial Management Conference Brief","type":"checkbox-group","required":true,"options":[{"value":"accurate","label":"Is accurate and complete to the best of my knowledge"},{"value":"served","label":"Has been or will be served on the other party at least 7 days before the conference"},{"value":"filed","label":"Has been or will be filed with the court at least 7 days before the conference"}]},{"id":"signature_date","label":"Date of completion","type":"date","required":true},{"id":"sworn_declaration","label":"Declaration","type":"declaration","required":true,"text":"I declare that the information in this Trial Management Conference Brief is true and complete to the best of my knowledge and belief.","checkboxLabel":"I confirm this declaration is true and accurate."}]}],"pdfMapping":{"notes":"Form 17E \u2014 Trial Management Conference Brief. Filed with court and served on all parties at least 7 days before the trial management conference. See ontario.ca/page/family-law-forms for the current version.","case_identification":["courthouse","court_file_number","applicant_full_name","respondent_full_name","party_role","tmc_date","trial_date"],"issues_section":["trial_issues","issues_resolved_before_trial","resolved_issues_description"],"positions_section":["position_decision_making","position_parenting_time","position_child_support","position_spousal_support","position_property","position_other_issues"],"witnesses_section":["witnesses"],"evidence_section":["key_documents","continuing_record_complete","documents_still_needed"],"time_estimate_section":["your_time_estimate","total_trial_estimate","scheduling_constraints","interpreter_needed","accommodation_needs"],"settlement_section":["settlement_attempts","why_no_settlement","still_open_to_settlement","settlement_offer_outstanding"],"tmc_orders_section":["tmc_orders_sought","last_minute_issues"],"declaration_section":["brief_complete_confirmation","signature_date","sworn_declaration"]}};
  window.__hp_formDefs['ON-F35_1'] = {"formId":"ON-F35_1",
  "pdfFileName": "form35_1.pdf","formCode":"form35_1-custody-affidavit","title":"Form 35.1 \u2014 Affidavit in Support of Claim for Custody or Access","jurisdiction":"Ontario","version":"2024","description":"Required in every Ontario family law case where a party claims decision-making responsibility (custody) or parenting time (access). Must be sworn and filed with your application or motion. Requires full disclosure of past involvement with child protection services, criminal history, and domestic violence history.","autoPopulateFrom":["form8-general"],"sensitiveForm":true,"steps":[{"stepId":"f351-step1","title":"About This Affidavit","description":"This affidavit is required by law whenever you ask for decision-making responsibility (custody) or parenting time (access) in Ontario.","fields":[{"id":"important_notice","label":"Important notice before you begin","type":"info-box","content":"**This form requires you to disclose sensitive personal information.** Ontario law requires anyone asking for custody or access to disclose:\n\n- Any involvement with a Children's Aid Society (CAS) in Ontario or elsewhere\n- Any criminal charges or convictions\n- Any history of domestic violence or abuse\n\nThis information is kept in the court file and shared with the other party. **You must answer all questions honestly.** Providing false information in an affidavit is perjury, which is a criminal offence.\n\nThis affidavit must be sworn before a commissioner of oaths \u2014 do not sign it until you are in front of the commissioner."},{"id":"courthouse","label":"Courthouse","type":"select","required":true,"autoPopulate":"courthouse","options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"]},{"id":"court_file_number","label":"Court file number","type":"text","required":false,"autoPopulate":"court_file_number","placeholder":"e.g. FC-2024-12345"},{"id":"applicant_full_name","label":"Applicant's full legal name","type":"text","required":true,"autoPopulate":"applicant_full_name"},{"id":"respondent_full_name","label":"Respondent's full legal name","type":"text","required":true,"autoPopulate":"respondent_full_name"},{"id":"deponent_name","label":"Your full legal name (person swearing this affidavit)","type":"text","required":true,"autoPopulate":"applicant_full_name","helpText":"This is the person making the sworn statement \u2014 usually the applicant or respondent filing this form."},{"id":"deponent_role","label":"You are","type":"select","required":true,"options":[{"value":"applicant","label":"The Applicant"},{"value":"respondent","label":"The Respondent"},{"value":"other","label":"Other party"}]}]},{"stepId":"f351-step2","title":"The Children","description":"List each child for whom you are claiming decision-making responsibility or parenting time.","fields":[{"id":"children","label":"Children involved in this claim","type":"repeatable-group","required":true,"maxItems":10,"addLabel":"Add another child","helpText":"List every child for whom you are asking for custody or access.","fields":[{"id":"child_full_name","label":"Child's full legal name","type":"text","required":true,"placeholder":"e.g. Alex Jordan Smith"},{"id":"child_dob","label":"Date of birth","type":"date","required":true},{"id":"child_current_address","label":"Child's current address","type":"text","required":true,"placeholder":"e.g. 123 Main St, Toronto ON M5V 1A1","helpText":"Where the child lives right now."},{"id":"child_current_resident","label":"Child currently lives with","type":"select","required":true,"options":[{"value":"me","label":"Me"},{"value":"other_party","label":"The other party"},{"value":"both_equally","label":"Both parties equally (shared)"},{"value":"other_person","label":"Another person"}]},{"id":"child_other_resident_name","label":"Name of the other person the child lives with","type":"text","required":false,"conditionalOn":{"field":"child_current_resident","value":"other_person"},"placeholder":"e.g. Maternal grandmother \u2014 Mary Johnson"},{"id":"what_i_am_seeking","label":"What are you asking for regarding this child?","type":"checkbox-group","required":true,"options":[{"value":"sole_decision_making","label":"Sole decision-making responsibility (sole custody)"},{"value":"joint_decision_making","label":"Joint decision-making responsibility (joint custody)"},{"value":"primary_parenting_time","label":"Primary parenting time (child lives primarily with me)"},{"value":"specified_parenting_time","label":"Specified parenting time (schedule)"},{"value":"supervised_parenting_time","label":"Supervised parenting time only"}]}]}]},{"stepId":"f351-step3","title":"Your Living Situation","description":"Describe where you currently live and who lives with you.","fields":[{"id":"my_current_address","label":"Your current address","type":"text","required":true,"autoPopulate":"applicant_address","placeholder":"e.g. 456 Oak Ave, Toronto ON M6G 2B3"},{"id":"how_long_at_address","label":"How long have you lived at this address?","type":"text","required":true,"placeholder":"e.g. 8 months / since March 2025"},{"id":"household_members","label":"Who else lives in your home?","type":"repeatable-group","required":false,"maxItems":10,"addLabel":"Add another person","helpText":"List everyone who lives with you other than the children named above. Include new partners, other children, parents, roommates, etc.","fields":[{"id":"member_name","label":"Full name","type":"text","required":true,"placeholder":"e.g. Michael Brown"},{"id":"member_relationship","label":"Relationship to you","type":"text","required":true,"placeholder":"e.g. New partner, my mother, adult sibling, roommate"},{"id":"member_age","label":"Age","type":"number","required":false,"placeholder":"e.g. 34"}]},{"id":"plan_to_move","label":"Do you plan to move in the next 12 months?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"possibly","label":"Possibly \u2014 not sure yet"}]},{"id":"move_details","label":"Describe your planned move","type":"textarea","required":false,"conditionalOn":{"field":"plan_to_move","value":"yes"},"placeholder":"e.g. I plan to move to Ottawa in September 2025 for a new job. I intend to bring the children with me and enroll them in school there."}]},{"stepId":"f351-step4","title":"Previous Court Proceedings","description":"Disclose any previous or ongoing court cases involving these children or yourself.","fields":[{"id":"previous_custody_proceedings","label":"Have there been any previous court proceedings about the custody, access, or child protection of the children named in this form?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}],"helpText":"Include proceedings in Ontario or any other province, territory, or country."},{"id":"previous_proceedings_details","label":"Describe the previous court proceedings","type":"repeatable-group","required":false,"conditionalOnParent":{"field":"previous_custody_proceedings","value":"yes"},"maxItems":5,"addLabel":"Add another proceeding","fields":[{"id":"proc_court_location","label":"Court and location","type":"text","required":true,"placeholder":"e.g. Ontario Court of Justice, Toronto / Family Court, Brampton"},{"id":"proc_file_number","label":"File number (if known)","type":"text","required":false,"placeholder":"e.g. FC-2022-08734"},{"id":"proc_type","label":"Type of proceeding","type":"text","required":true,"placeholder":"e.g. Custody and access application / Child protection / Divorce"},{"id":"proc_outcome","label":"Outcome or current status","type":"textarea","required":true,"placeholder":"e.g. Order dated June 1, 2023 gave the Applicant primary custody with Respondent having access every other weekend. Case is now closed. / Still ongoing."}]},{"id":"existing_orders","label":"Are there any existing court orders or agreements about the children?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"existing_orders_details","label":"Describe the existing orders or agreements","type":"textarea","required":false,"conditionalOn":{"field":"existing_orders","value":"yes"},"placeholder":"e.g. There is a temporary consent order dated April 10, 2025 providing that the children live primarily with the Applicant. There is also a separation agreement dated January 2024 that addresses parenting but which I am now seeking to vary."}]},{"stepId":"f351-step5","title":"Child Protection Involvement","description":"You must disclose any involvement with Children's Aid Societies (CAS) or equivalent child protection agencies \u2014 in Ontario or anywhere else.","fields":[{"id":"cas_involvement_notice","label":"Important","type":"info-box","content":"You must disclose **all** past or current involvement with Children's Aid Societies (CAS), child protection agencies, or equivalent government bodies \u2014 in Ontario or any other province, territory, or country. This includes investigations that did not result in a finding or that were closed. Failure to disclose is taken very seriously by courts."},{"id":"has_cas_involvement","label":"Have you or anyone in your household ever been involved with a Children's Aid Society or child protection agency?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"cas_involvement_details","label":"Describe each involvement with a child protection agency","type":"repeatable-group","required":false,"conditionalOnParent":{"field":"has_cas_involvement","value":"yes"},"maxItems":10,"addLabel":"Add another involvement","helpText":"Include all investigations, protection orders, voluntary services agreements, or court proceedings.","fields":[{"id":"cas_agency_name","label":"Name of the CAS or child protection agency","type":"text","required":true,"placeholder":"e.g. Children's Aid Society of Toronto / Ministry for Children in British Columbia"},{"id":"cas_date_period","label":"Approximate date or period of involvement","type":"text","required":true,"placeholder":"e.g. March to August 2021 / 2019 (date unknown)"},{"id":"cas_reason","label":"Reason for the involvement","type":"textarea","required":true,"placeholder":"e.g. A neighbour made an anonymous report of neglect. A worker investigated and found no concerns. The file was closed after two home visits."},{"id":"cas_outcome","label":"Outcome","type":"textarea","required":true,"placeholder":"e.g. File closed with no findings / Voluntary service agreement signed and completed / Child apprehended and returned following court order / Protection order made \u2014 specify terms"},{"id":"cas_who_involved","label":"Who was involved (you, your partner, your child, another household member)?","type":"text","required":true,"placeholder":"e.g. Myself and the child Alex / My current partner (before we met)"}]},{"id":"cas_currently_open","label":"Is there currently an open child protection case involving you or any child in your home?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"cas_currently_open_details","label":"Describe the current open child protection case","type":"textarea","required":false,"conditionalOn":{"field":"cas_currently_open","value":"yes"},"placeholder":"e.g. There is a current open file with the CAS of Peel regarding an allegation made by the other party in January 2025. The worker has conducted two visits and the investigation is ongoing. No protection concerns have been identified to date."}]},{"stepId":"f351-step6","title":"Criminal History","description":"You must disclose any criminal charges or convictions. This includes offences related to violence, weapons, drugs, and any offences involving children.","fields":[{"id":"criminal_history_notice","label":"Important","type":"info-box","content":"You must disclose **all** criminal charges and convictions \u2014 including those for which you received a pardon (record suspension), charges that were withdrawn or stayed, and charges that are currently before the courts. Disclose charges in Canada and any other country."},{"id":"has_criminal_history","label":"Have you ever been charged with or convicted of a criminal offence in Canada or any other country?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"criminal_history_details","label":"List each criminal charge or conviction","type":"repeatable-group","required":false,"conditionalOnParent":{"field":"has_criminal_history","value":"yes"},"maxItems":15,"addLabel":"Add another charge or conviction","fields":[{"id":"offence_description","label":"Offence description","type":"text","required":true,"placeholder":"e.g. Assault / Impaired driving / Possession of a controlled substance"},{"id":"offence_date","label":"Approximate date of the offence or charge","type":"text","required":true,"placeholder":"e.g. June 2018 / Approximately 2015"},{"id":"offence_outcome","label":"Outcome","type":"select","required":true,"options":[{"value":"convicted","label":"Convicted"},{"value":"acquitted","label":"Acquitted (found not guilty)"},{"value":"withdrawn_stayed","label":"Charge withdrawn or stayed"},{"value":"absolute_discharge","label":"Absolute discharge"},{"value":"conditional_discharge","label":"Conditional discharge"},{"value":"pending","label":"Charge currently pending"},{"value":"pardon_received","label":"Convicted and received a pardon / record suspension"}]},{"id":"offence_sentence","label":"Sentence or conditions (if convicted)","type":"text","required":false,"placeholder":"e.g. Fine of $500 / 6-month conditional sentence / 18 months probation"},{"id":"offence_involved_children_or_violence","label":"Did this offence involve violence, weapons, or children?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]}]},{"id":"household_criminal_history","label":"Does anyone else in your household have a criminal record or pending charges?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"unknown","label":"I don't know"}]},{"id":"household_criminal_history_details","label":"Describe the household member's criminal history","type":"textarea","required":false,"conditionalOn":{"field":"household_criminal_history","value":"yes"},"placeholder":"e.g. My current partner was convicted of impaired driving in 2019 and received a fine. There have been no other charges."}]},{"stepId":"f351-step7","title":"Domestic Violence & Abuse History","description":"You must disclose any history of domestic violence, abuse, or a restraining order \u2014 whether you were the victim, the alleged perpetrator, or both.","fields":[{"id":"dv_notice","label":"About this section","type":"info-box","content":"Ontario courts take domestic violence very seriously in custody and access decisions. You must disclose:\n\n- Any history of physical, sexual, emotional, psychological, or financial abuse between you and the other party\n- Any police involvement or criminal charges related to domestic violence\n- Any restraining orders or peace bonds\n- Any history of stalking, harassment, or coercive control\n\nThis information helps the court assess the safety of the children and both parties. Disclosing abuse does not automatically change your right to parenting time \u2014 the court's focus is on the children's safety and best interests."},{"id":"has_dv_history","label":"Has there been any domestic violence or abuse in your relationship with the other party?","type":"radio","required":true,"options":[{"value":"yes_i_experienced","label":"Yes \u2014 I experienced abuse from the other party"},{"value":"yes_i_was_alleged","label":"Yes \u2014 the other party has alleged that I was abusive"},{"value":"yes_both","label":"Yes \u2014 both of the above apply"},{"value":"no","label":"No \u2014 there has been no domestic violence or abuse"}]},{"id":"dv_description_experienced","label":"Describe the abuse you experienced","type":"textarea","required":false,"conditionalOn":{"field":"has_dv_history","value":"yes_i_experienced","orValues":["yes_i_experienced","yes_both"]},"placeholder":"e.g. During our relationship, the other party pushed and grabbed me on multiple occasions. The most serious incident occurred in November 2023 when they shoved me against the wall in front of the children. I called police on that occasion. There were also incidents of controlling behavior \u2014 monitoring my phone, preventing me from seeing family, and controlling our finances.","helpText":"Describe specific incidents where possible, including approximate dates and whether the children were present or witnessed the abuse."},{"id":"dv_description_alleged","label":"Describe what the other party has alleged about you","type":"textarea","required":false,"conditionalOn":{"field":"has_dv_history","value":"yes_i_was_alleged","orValues":["yes_i_was_alleged","yes_both"]},"placeholder":"e.g. The other party has alleged that I was physically abusive during our relationship. I deny these allegations. They made a report to police in February 2024 which was investigated and no charges were laid."},{"id":"police_involvement_dv","label":"Was police ever called for a domestic violence incident involving you and the other party?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"police_involvement_dv_details","label":"Describe the police involvement","type":"textarea","required":false,"conditionalOn":{"field":"police_involvement_dv","value":"yes"},"placeholder":"e.g. Police were called on November 12, 2023 following an incident at our home. The other party was charged with assault. The charge was subsequently withdrawn. Police were also called in February 2024 on a report by the other party \u2014 I was not charged."},{"id":"has_restraining_order","label":"Is there a restraining order or peace bond between you and the other party?","type":"radio","required":true,"options":[{"value":"yes_against_them","label":"Yes \u2014 there is a restraining order against the other party"},{"value":"yes_against_me","label":"Yes \u2014 there is a restraining order against me"},{"value":"yes_peace_bond","label":"Yes \u2014 there is a peace bond"},{"value":"no","label":"No"}]},{"id":"restraining_order_details","label":"Describe the restraining order or peace bond","type":"textarea","required":false,"conditionalOn":{"field":"has_restraining_order","value":"no","inverse":true},"placeholder":"e.g. There is a restraining order made February 15, 2024 by Justice Chen prohibiting the other party from attending within 200 metres of my home and the children's school. It expires February 14, 2026."},{"id":"dv_impact_on_children","label":"Were the children present for or affected by any of the incidents described above?","type":"radio","required":false,"conditionalOn":{"field":"has_dv_history","value":"no","inverse":true},"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"dv_impact_details","label":"Describe how the children were affected","type":"textarea","required":false,"conditionalOn":{"field":"dv_impact_on_children","value":"yes"},"placeholder":"e.g. The children (ages 7 and 9) were present in the home during the November 2023 incident and witnessed the other party pushing me. Alex has since disclosed to a school counsellor that they are afraid of the other party. Both children are currently receiving counselling."}]},{"stepId":"f351-step8","title":"Proposed Parenting Plan","description":"Describe your proposed parenting plan and why it is in the best interests of the children.","fields":[{"id":"proposed_parenting_plan","label":"Describe your proposed parenting arrangement in detail","type":"textarea","required":true,"placeholder":"e.g. I am proposing that Alex and Sam live primarily with me at my home in Toronto. I propose that the other party have parenting time every other weekend from Friday at 6 p.m. to Sunday at 6 p.m., plus one evening per week (Wednesdays from 4 p.m. to 7 p.m.). Holidays to be shared equally as follows: [describe holiday schedule]. I am asking for sole decision-making responsibility because the parties are unable to communicate effectively and agreement on major decisions is not feasible.","helpText":"Be specific about where the children will live, how often each parent will see them, and who will make major decisions about education, health care, and religion."},{"id":"decision_making_proposal","label":"What are you proposing for decision-making responsibility?","type":"select","required":true,"options":[{"value":"sole_to_me","label":"Sole decision-making to me \u2014 I make all major decisions"},{"value":"joint","label":"Joint decision-making \u2014 both parties decide together"},{"value":"parallel","label":"Parallel decision-making \u2014 each parent decides independently in their area (e.g. I decide education, they decide health)"},{"value":"sole_to_other","label":"Sole decision-making to the other party (I am only seeking parenting time)"}]},{"id":"best_interests_narrative","label":"Why is your proposed arrangement in the best interests of the children?","type":"textarea","required":true,"placeholder":"e.g. I have been the children's primary caregiver throughout their lives. I manage their school attendance, medical appointments, and extracurricular activities. The children are settled in their current school and community. My proposed arrangement maintains stability and allows both children to maintain a meaningful relationship with both parents while ensuring their safety and well-being.","helpText":"Ontario law requires the court to focus on the best interests of the children. Address: stability, existing relationships, safety, each parent's ability to meet the children's needs, and the children's own views (if age-appropriate)."},{"id":"children_views","label":"Have the children expressed views or preferences about where they want to live or how much time they want to spend with each parent?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No / too young to express a view"}]},{"id":"children_views_details","label":"Describe the children's views","type":"textarea","required":false,"conditionalOn":{"field":"children_views","value":"yes"},"placeholder":"e.g. Alex (age 12) has expressed clearly to me, to their school counsellor, and to a family friend that they want to live primarily with me and see the other party on weekends. Sam (age 9) has said they miss the other party but is settled and happy living with me."},{"id":"relationship_with_other_parent","label":"Describe the children's current relationship with the other parent","type":"textarea","required":true,"placeholder":"e.g. The children love both parents and have a positive relationship with the other party despite the separation. They enjoy their time with the other party and I support that relationship. However, the other party has cancelled parenting time on four occasions in the past two months without adequate notice, which has been upsetting for the children."},{"id":"willing_to_facilitate_relationship","label":"Are you willing to support the children's relationship with the other parent?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 I am committed to supporting the children's relationship with both parents"},{"value":"yes_with_conditions","label":"Yes \u2014 but with conditions due to safety concerns"},{"value":"no","label":"No \u2014 I have serious concerns about the other parent's access to the children"}]},{"id":"conditions_for_access","label":"Describe the conditions or concerns","type":"textarea","required":false,"conditionalOn":{"field":"willing_to_facilitate_relationship","value":"yes_with_conditions","orValues":["yes_with_conditions","no"]},"placeholder":"e.g. I support the children having a relationship with the other party but believe all visits should be supervised by a neutral third party given the history of domestic violence. I am asking the court to order supervised access until a parenting assessment has been completed."}]},{"stepId":"f351-step9","title":"Declaration","description":"This affidavit must be sworn before a commissioner of oaths. Do not sign it until you are in front of the commissioner.","fields":[{"id":"swear_or_affirm","label":"Will you swear or affirm?","type":"select","required":true,"options":[{"value":"swear","label":"Swear (on a religious text)"},{"value":"affirm","label":"Affirm (non-religious solemn declaration)"}]},{"id":"municipality_of_swearing","label":"Municipality where you will swear or affirm this affidavit","type":"text","required":true,"placeholder":"e.g. Toronto"},{"id":"commissioning_date","label":"Date of commissioning (leave blank to complete at courthouse)","type":"date","required":false},{"id":"accuracy_declaration","label":"Declaration","type":"declaration","required":true,"text":"I, the deponent, declare that the contents of this affidavit are true, and I make this solemn declaration conscientiously believing it to be true and knowing that it is of the same force and effect as if made under oath. I understand that providing false information in an affidavit is perjury.","checkboxLabel":"I confirm this declaration is true and complete to the best of my knowledge and belief."}]}],"pdfMapping":{"notes":"Form 35.1 \u2014 Affidavit in Support of Claim for Custody or Access. Must be sworn before a commissioner of oaths. Required whenever custody or access is claimed in an Ontario family law proceeding. See ontario.ca/page/family-law-forms for current version.","case_header":["courthouse","court_file_number","applicant_full_name","respondent_full_name","deponent_name","deponent_role"],"children_section":["children"],"living_situation":["my_current_address","how_long_at_address","household_members","plan_to_move"],"previous_proceedings":["previous_custody_proceedings","previous_proceedings_details","existing_orders"],"cas_section":["has_cas_involvement","cas_involvement_details","cas_currently_open"],"criminal_section":["has_criminal_history","criminal_history_details","household_criminal_history"],"dv_section":["has_dv_history","dv_description_experienced","dv_description_alleged","police_involvement_dv","has_restraining_order","dv_impact_on_children"],"parenting_plan":["proposed_parenting_plan","decision_making_proposal","best_interests_narrative","children_views","relationship_with_other_parent"],"declaration":["swear_or_affirm","municipality_of_swearing","accuracy_declaration"]}};
  window.__hp_formDefs['ON-F14B'] = {"formId":"ON-F14B",
  "pdfFileName": "form14b.pdf","formCode":"form14b-motion-form","title":"Form 14B \u2014 Motion Form","jurisdiction":"Ontario","version":"2024","description":"Used for motions that can be decided without a hearing \u2014 either because both parties consent, or because the matter is procedural and can be decided on written materials alone (without notice). Common uses include consent orders, procedural directions, and unopposed motions.","autoPopulateFrom":["form8-general","form14-motion"],"steps":[{"stepId":"mb-step1","title":"Court & Case Information","description":"Enter the court file details. This motion will be decided by a judge without a hearing.","fields":[{"id":"courthouse","label":"Courthouse","type":"select","required":true,"autoPopulate":"courthouse","options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"]},{"id":"court_file_number","label":"Court file number","type":"text","required":true,"autoPopulate":"court_file_number","placeholder":"e.g. FC-2024-12345","helpText":"Required \u2014 a file number must exist before you can use Form 14B."},{"id":"applicant_full_name","label":"Applicant's full legal name","type":"text","required":true,"autoPopulate":"applicant_full_name"},{"id":"respondent_full_name","label":"Respondent's full legal name","type":"text","required":true,"autoPopulate":"respondent_full_name"},{"id":"moving_party","label":"Who is bringing this motion?","type":"select","required":true,"options":[{"value":"applicant","label":"The Applicant"},{"value":"respondent","label":"The Respondent"},{"value":"both_parties","label":"Both parties (joint / consent motion)"}]}]},{"stepId":"mb-step2","title":"Type of Motion","description":"Form 14B is used for motions that don't need a full court hearing. Select the type that applies to your situation.","fields":[{"id":"motion_type","label":"What type of motion is this?","type":"select","required":true,"options":[{"value":"consent","label":"Consent motion \u2014 both parties agree to the order being requested"},{"value":"without_notice","label":"Without notice motion \u2014 the other party has not been told about this motion"},{"value":"procedural","label":"Procedural / administrative motion \u2014 a routine procedural step"},{"value":"unopposed","label":"Unopposed motion \u2014 served on the other party who has not responded"}],"helpText":"Not sure which to choose? See the guidance below."},{"id":"motion_type_guide","label":"Which type applies to me?","type":"info-box","content":"**Consent motion:** Both parties have agreed on the order. Both must sign. Most common use of Form 14B \u2014 great for formalizing agreements.\n\n**Without notice (ex parte):** You are asking the court to make an order without telling the other party first. Only allowed in urgent circumstances \u2014 for example, emergency child protection, imminent risk of harm, or urgent asset preservation. The court will question why notice was not given.\n\n**Procedural:** Administrative or housekeeping steps \u2014 for example, extending a deadline, correcting a name in a file, or filing materials late.\n\n**Unopposed:** You served the other party and they did not respond within the required time. You are asking the court to grant the order based on their non-response."},{"id":"without_notice_reason","label":"Why is it necessary to bring this motion without notice to the other party?","type":"textarea","required":false,"conditionalOn":{"field":"motion_type","value":"without_notice"},"placeholder":"e.g. I am bringing this motion without notice because there is an immediate risk that the Respondent will remove the children from Ontario before a court order can be obtained. I have evidence that the Respondent has purchased plane tickets for travel outside Canada on July 4, 2025. Giving notice would defeat the purpose of the order.","helpText":"You must give a clear reason. Without notice orders are rare and scrutinized closely by judges."},{"id":"date_motion_submitted","label":"Date you are submitting this motion","type":"date","required":true}]},{"stepId":"mb-step3","title":"Order(s) You Are Requesting","description":"Describe exactly what you want the judge to order. Be as specific as possible \u2014 the judge will decide based on what you write here.","fields":[{"id":"orders_requested_categories","label":"What type of order are you asking for? (select all that apply)","type":"checkbox-group","required":true,"options":[{"value":"consent_order","label":"Consent order \u2014 formalizing an agreement between the parties"},{"value":"extend_deadline","label":"Extend a filing or service deadline"},{"value":"adjourn_matter","label":"Adjourn (postpone) a scheduled court date"},{"value":"vary_existing_order","label":"Vary or change a specific term of an existing order (by consent)"},{"value":"file_materials_late","label":"Permission to file materials after a deadline"},{"value":"set_aside_default","label":"Set aside a default (restore a party's right to participate)"},{"value":"add_remove_party","label":"Add or remove a party from the proceeding"},{"value":"seal_court_record","label":"Seal or restrict access to the court record"},{"value":"dispense_service","label":"Dispense with service on the other party"},{"value":"urgent_relief","label":"Urgent interim relief (without notice situations)"},{"value":"other_order","label":"Other order"}]},{"id":"orders_requested_details","label":"Write out the exact order(s) you are asking the judge to make","type":"textarea","required":true,"placeholder":"e.g. 1. THIS COURT ORDERS that the Respondent is prohibited from removing the children Alex Smith (born April 12, 2015) and Sam Smith (born September 3, 2018) from the Province of Ontario without the written consent of the Applicant or a further order of this court.\n\n2. THIS COURT ORDERS that the Respondent shall immediately surrender the children's passports to the Applicant's counsel.\n\n3. THIS COURT ORDERS that this order be served on the Respondent forthwith.","helpText":"Write each order on its own numbered line. Start with 'THIS COURT ORDERS that...' This is exactly what the judge will sign. For consent orders, write what both parties have agreed to."},{"id":"effective_date","label":"From what date should the order take effect?","type":"date","required":false,"helpText":"Leave blank if you want the order to take effect immediately upon signing. Courts can also backdate orders in appropriate circumstances."}]},{"stepId":"mb-step4","title":"Grounds for the Order","description":"Briefly explain the facts and legal basis that support the order you are requesting.","fields":[{"id":"grounds_narrative","label":"Grounds for this motion","type":"textarea","required":true,"placeholder":"e.g. The parties have both agreed to change the parenting schedule set out in the consent order dated March 1, 2025. The children have started a new school year and the current schedule no longer works with school pickups. Both parties consent to the proposed change as set out in the draft order attached. The proposed change is in the children's best interests.\n\n\u2014 OR \u2014\n\nThe Applicant requires an extension of time to file their financial disclosure. The Applicant's accountant requires an additional 3 weeks to prepare the required documents. The Respondent consents to this extension. No hearing date is affected.","helpText":"For consent motions, briefly describe why both parties agree. For without-notice motions, describe the urgent facts in detail. For procedural motions, briefly explain what is needed and why."},{"id":"supporting_materials","label":"What supporting materials are you attaching to this motion?","type":"checkbox-group","required":false,"helpText":"Attach any materials that support your request.","options":[{"value":"affidavit","label":"Affidavit (sworn statement of facts)"},{"value":"draft_order","label":"Draft order (the proposed order for the judge to sign)"},{"value":"consent_both_parties","label":"Written consent signed by both parties"},{"value":"correspondence","label":"Relevant correspondence or emails"},{"value":"existing_order_copy","label":"Copy of the existing order being varied or referenced"},{"value":"other_documents","label":"Other documents"}]},{"id":"other_documents_description","label":"Describe the other documents attached","type":"text","required":false,"conditionalOn":{"field":"supporting_materials","value":"other_documents"},"placeholder":"e.g. Airline itinerary showing booked flights for July 4"},{"id":"legal_authority","label":"Legal authority for this order (optional \u2014 helpful for complex motions)","type":"textarea","required":false,"placeholder":"e.g. Family Law Rules, Rule 14(12) \u2014 motion without notice. Children's Law Reform Act, section 35 \u2014 order for return of child. / Leave blank for simple consent or procedural matters.","helpText":"You don't need to cite law for simple procedural motions. For more complex motions (especially without notice), citing the relevant rule or statute is helpful."}]},{"stepId":"mb-step5","title":"Service & Response","description":"Tell the court whether the other party has been served and whether they have responded.","fields":[{"id":"other_party_served","label":"Has the other party been served with this motion?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 they have been served"},{"value":"no_consent","label":"No \u2014 this is a consent motion and they will sign instead of being served"},{"value":"no_without_notice","label":"No \u2014 I am asking the court to dispense with service (without notice motion)"}]},{"id":"service_details","label":"How and when was the other party served?","type":"textarea","required":false,"conditionalOn":{"field":"other_party_served","value":"yes"},"placeholder":"e.g. Served by email on June 20, 2025. The other party acknowledged receipt but has not responded within the required time."},{"id":"other_party_response","label":"Did the other party respond?","type":"radio","required":false,"conditionalOn":{"field":"other_party_served","value":"yes"},"options":[{"value":"yes_consents","label":"Yes \u2014 they consent to the order"},{"value":"yes_opposes","label":"Yes \u2014 they oppose the order"},{"value":"no_response","label":"No \u2014 they did not respond within the required time"}]},{"id":"opposition_details","label":"Describe the other party's opposition","type":"textarea","required":false,"conditionalOn":{"field":"other_party_response","value":"yes_opposes"},"placeholder":"e.g. The Respondent has communicated through their counsel that they oppose the extension of the filing deadline. Their position is that any further delay is prejudicial. I respectfully submit that the court should grant the extension despite this opposition because [reason].","helpText":"If the other party opposes, Form 14B may not be the right form \u2014 a full hearing may be required. Describe their position and why you believe the matter can still proceed on written materials."},{"id":"dispense_service_reason","label":"Why should service be dispensed with?","type":"textarea","required":false,"conditionalOn":{"field":"other_party_served","value":"no_without_notice"},"placeholder":"e.g. Serving the other party before obtaining this order would defeat its purpose, as they would have the opportunity to remove the children or dissipate assets before the order is made. This is an emergency situation requiring immediate court intervention."}]},{"stepId":"mb-step6","title":"Consent (if applicable)","description":"For consent motions, both parties must agree. Confirm consent details here.","fields":[{"id":"is_consent_motion","label":"Is this a consent motion (both parties agree)?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 both parties consent"},{"value":"no","label":"No \u2014 this is not a consent motion"}]},{"id":"consent_details","label":"Confirm consent","type":"info-box","conditionalOn":{"field":"is_consent_motion","value":"yes"},"content":"For a consent motion, both parties must sign the motion form or a separate written consent. The judge does not need to hold a hearing \u2014 they will review the materials and, if satisfied, sign the order.\n\nMake sure your draft order accurately reflects what both parties have agreed to. Once signed by the judge, it becomes a binding court order."},{"id":"consent_basis","label":"How was consent confirmed?","type":"select","required":false,"conditionalOn":{"field":"is_consent_motion","value":"yes"},"options":[{"value":"both_sign_form","label":"Both parties will sign this motion form"},{"value":"separate_consent","label":"A separate written consent is attached"},{"value":"lawyer_confirmation","label":"Consent confirmed by letters from both parties' lawyers"},{"value":"minutes_of_settlement","label":"Based on Minutes of Settlement signed at a conference"}]},{"id":"children_involved_consent","label":"Does this consent motion involve the children?","type":"radio","required":false,"conditionalOn":{"field":"is_consent_motion","value":"yes"},"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No \u2014 this is about finances, procedures, or other matters only"}]},{"id":"best_interests_consent","label":"Why is the consent order in the best interests of the children?","type":"textarea","required":false,"conditionalOn":{"field":"children_involved_consent","value":"yes"},"placeholder":"e.g. Both parties have agreed that the new parenting schedule better reflects the children's current school and activity schedules. The children are comfortable with both parents. The proposed change maintains stability while accommodating the children's growing independence.","helpText":"The court must be satisfied that any order involving children serves their best interests, even when both parties consent."}]},{"stepId":"mb-step7","title":"Declaration & Signature","description":"Confirm the accuracy of this motion before filing.","fields":[{"id":"costs_request","label":"Are you asking for costs?","type":"radio","required":true,"helpText":"Costs are rare on procedural or consent motions. If you are asking for costs, state the amount and basis.","options":[{"value":"no","label":"No \u2014 no order as to costs"},{"value":"yes","label":"Yes \u2014 I am asking for costs"}]},{"id":"costs_details","label":"Describe the costs you are requesting","type":"textarea","required":false,"conditionalOn":{"field":"costs_request","value":"yes"},"placeholder":"e.g. The Respondent caused the need for this motion by failing to comply with the existing order. I am asking for costs of $500 on a partial indemnity basis."},{"id":"declaration_confirmed","label":"Declaration","type":"declaration","required":true,"text":"I declare that the information in this Motion Form is true and complete to the best of my knowledge and belief. I understand that this form will be filed with the Ontario court.","checkboxLabel":"I confirm this declaration is true and accurate."},{"id":"signature_date","label":"Date","type":"date","required":true}]}],"pdfMapping":{"notes":"Form 14B \u2014 Motion Form. Used for consent, without notice, procedural, or unopposed motions decided on written materials without a hearing. Attach a draft order for the judge to sign. See ontario.ca/page/family-law-forms.","case_header":["courthouse","court_file_number","applicant_full_name","respondent_full_name","moving_party"],"motion_type_section":["motion_type","without_notice_reason","date_motion_submitted"],"orders_section":["orders_requested_categories","orders_requested_details","effective_date"],"grounds_section":["grounds_narrative","supporting_materials","legal_authority"],"service_section":["other_party_served","service_details","other_party_response"],"consent_section":["is_consent_motion","consent_basis","children_involved_consent","best_interests_consent"],"declaration_section":["costs_request","declaration_confirmed","signature_date"]}};
  window.__hp_formDefs['ON-F13B'] = {"formId":"ON-F13B",
  "pdfFileName": "form13b.pdf","formCode":"form13b-net-family-property","title":"Form 13B \u2014 Net Family Property Statement","jurisdiction":"Ontario","version":"2024","description":"Used to calculate the equalization of net family property under Part I of the Family Law Act. Each party completes their own Form 13B. The difference between the two net family property values determines the equalization payment owed from one spouse to the other.","autoPopulateFrom":["form8-general","form13-financial","form13_1-property"],"steps":[{"stepId":"nfp-step1","title":"About This Form","description":"Form 13B calculates your net family property (NFP) \u2014 the foundation of property equalization in Ontario.","fields":[{"id":"nfp_explainer","label":"How equalization works in Ontario","type":"info-box","content":"**Ontario's equalization of net family property** means that when a marriage ends, each spouse keeps what they brought in \u2014 but they share equally in what was accumulated during the marriage.\n\n**How it works:**\n1. Calculate your assets and debts on the **valuation date** (usually the date you separated)\n2. Subtract your assets and debts on the **date of marriage** (your starting point)\n3. Subtract any **excluded property** (gifts, inheritances, and certain other assets)\n4. The result is your **Net Family Property (NFP)**\n5. The spouse with the higher NFP pays the other half the difference \u2014 this is the **equalization payment**\n\n**You need:** your separation date, your marriage date, values of all property at both dates, and records of any gifts or inheritances."},{"id":"courthouse","label":"Courthouse","type":"select","required":true,"autoPopulate":"courthouse","options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"]},{"id":"court_file_number","label":"Court file number","type":"text","required":false,"autoPopulate":"court_file_number","placeholder":"e.g. FC-2024-12345"},{"id":"applicant_full_name","label":"Applicant's full legal name","type":"text","required":true,"autoPopulate":"applicant_full_name"},{"id":"respondent_full_name","label":"Respondent's full legal name","type":"text","required":true,"autoPopulate":"respondent_full_name"},{"id":"completing_party","label":"You are completing this form as","type":"select","required":true,"options":[{"value":"applicant","label":"The Applicant"},{"value":"respondent","label":"The Respondent"}]},{"id":"marriage_date","label":"Date of marriage","type":"date","required":true,"autoPopulate":"marriage_date","helpText":"The date your marriage was legally performed."},{"id":"valuation_date","label":"Valuation date (usually your separation date)","type":"date","required":true,"autoPopulate":"separation_date","helpText":"The valuation date is the earliest of: the date you separated, the date a divorce order is made, or the date of an event triggering equalization. Usually this is your separation date."}]},{"stepId":"nfp-step2","title":"Assets on Valuation Date","description":"List the value of everything you owned on the valuation date (your separation date). Include all assets even if they were partially or fully inherited or gifted \u2014 you will deduct excluded property later.","fields":[{"id":"asset_family_home_value","label":"Family home \u2014 value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Enter the fair market value. Use a recent appraisal if available. If you do not own or have an interest in the family home, enter 0."},{"id":"asset_family_home_address","label":"Family home \u2014 address","type":"text","required":false,"placeholder":"e.g. 123 Main St, Toronto ON M5V 1A1"},{"id":"asset_other_real_estate","label":"Other real estate \u2014 total value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Include rental properties, cottages, vacant land, or any other real property you have an interest in."},{"id":"asset_other_real_estate_description","label":"Describe other real estate","type":"textarea","required":false,"placeholder":"e.g. Rental property at 456 Oak Ave, Toronto \u2014 value $480,000 / Cottage at 789 Lake Rd, Muskoka \u2014 value $320,000"},{"id":"asset_bank_accounts","label":"Bank accounts, savings, GICs \u2014 total balance on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Total balance across all accounts \u2014 chequing, savings, GICs, high-interest savings, TFSAs. Include accounts in your name only and any joint accounts."},{"id":"asset_bank_accounts_description","label":"Describe bank accounts","type":"textarea","required":false,"placeholder":"e.g. TD chequing \u2014 $4,200 / RBC savings \u2014 $12,500 / TFSA at TD \u2014 $38,000"},{"id":"asset_rrsp_rrif","label":"RRSPs, RRIFs, LIRAs \u2014 total value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Use the market value before tax. Note: the tax owing on withdrawal is often deducted separately as a liability or negotiated between parties."},{"id":"asset_pension","label":"Pension plans \u2014 value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Use the commuted value (transfer value) of your pension. For defined benefit pensions, you may need an actuarial valuation. Contact your pension administrator."},{"id":"asset_pension_description","label":"Describe pension plan(s)","type":"textarea","required":false,"placeholder":"e.g. OMERS defined benefit pension \u2014 commuted value on valuation date: $185,000 / Company RRSP/DC pension \u2014 $52,000"},{"id":"asset_investments","label":"Non-registered investments \u2014 total value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Include stocks, bonds, mutual funds, ETFs, investment accounts held outside an RRSP or TFSA."},{"id":"asset_business_interest","label":"Business interests \u2014 value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Include shares or ownership interest in any business. A business valuation by a qualified valuator may be required. Enter the fair market value of your interest."},{"id":"asset_business_description","label":"Describe business interests","type":"textarea","required":false,"placeholder":"e.g. 50% ownership in ABC Plumbing Inc. \u2014 valued at $240,000 by business valuator John Smith, CA\u00b7CBV, on [date]"},{"id":"asset_vehicles","label":"Vehicles \u2014 total value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Include cars, trucks, motorcycles, boats, RVs, snowmobiles, etc. Use Canadian Black Book or similar for market value."},{"id":"asset_life_insurance","label":"Life insurance \u2014 cash surrender value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Only include policies with a cash surrender value (whole life, universal life). Term life insurance has no cash value \u2014 enter 0."},{"id":"asset_household_contents","label":"Household contents and personal property \u2014 value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Include furniture, appliances, electronics, jewelry, art, collections, and other personal property. Use fair market value (what you could sell it for today)."},{"id":"asset_money_owed_to_you","label":"Money owed to you (loans receivable, legal settlements) \u2014 value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Include any money others owe you \u2014 loans you made, pending legal settlements, expected tax refunds, etc."},{"id":"asset_other","label":"Other assets \u2014 value on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"asset_other_description","label":"Describe other assets","type":"textarea","required":false,"placeholder":"e.g. Cryptocurrency \u2014 $8,500 / Structured settlement \u2014 $25,000 / Intellectual property rights \u2014 $12,000"},{"id":"total_assets_valuation_date","label":"TOTAL assets on valuation date","type":"number","required":true,"prefix":"$","placeholder":"0.00","helpText":"Add up all assets listed above.","autoCalculate":{"operation":"sum","fields":["asset_family_home_value","asset_other_real_estate","asset_bank_accounts","asset_rrsp_rrif","asset_pension","asset_investments","asset_business_interest","asset_vehicles","asset_life_insurance","asset_household_contents","asset_money_owed_to_you","asset_other"]}}]},{"stepId":"nfp-step3","title":"Debts on Valuation Date","description":"List all debts and liabilities you owed on the valuation date. These reduce your net family property.","fields":[{"id":"debt_mortgage_family_home","label":"Mortgage on family home \u2014 balance owing on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"debt_mortgage_other","label":"Mortgages on other properties \u2014 total balance owing on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"debt_vehicle_loans","label":"Vehicle loans \u2014 total balance owing on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"debt_credit_cards","label":"Credit card balances \u2014 total owing on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"debt_lines_of_credit","label":"Lines of credit \u2014 total balance owing on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"debt_student_loans","label":"Student loans \u2014 balance owing on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"debt_personal_loans","label":"Personal loans (family, bank) \u2014 balance owing on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"debt_business_debts","label":"Business debts you are personally responsible for \u2014 balance owing on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"debt_tax_owing","label":"Income taxes owing (including estimated deferred taxes on RRSPs) \u2014 on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Include any income tax owing to CRA, and optionally an estimate of the tax you would owe if you cashed out your RRSP/pension (parties often negotiate whether to include this)."},{"id":"debt_other","label":"Other debts \u2014 total owing on valuation date","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"debt_other_description","label":"Describe other debts","type":"textarea","required":false,"placeholder":"e.g. Money owed to parents for home down payment loan \u2014 $20,000 / Unpaid legal fees \u2014 $8,000"},{"id":"total_debts_valuation_date","label":"TOTAL debts on valuation date","type":"number","required":true,"prefix":"$","placeholder":"0.00","helpText":"Add up all debts listed above.","autoCalculate":{"operation":"sum","fields":["debt_mortgage_family_home","debt_mortgage_other","debt_vehicle_loans","debt_credit_cards","debt_lines_of_credit","debt_student_loans","debt_personal_loans","debt_business_debts","debt_tax_owing","debt_other"]}},{"id":"net_on_valuation_date","label":"Net value on valuation date (assets minus debts)","type":"number","required":true,"prefix":"$","placeholder":"0.00","helpText":"Subtract total debts from total assets.","autoCalculate":{"operation":"subtract","fields":["total_assets_valuation_date","total_debts_valuation_date"]}}]},{"stepId":"nfp-step4","title":"Assets on Date of Marriage","description":"List what you owned on the day you were married. This is subtracted from your valuation date net to calculate growth during the marriage.","fields":[{"id":"dom_asset_notice","label":"Date of marriage assets","type":"info-box","content":"List the value of your assets on the date of your marriage. These represent what you brought into the marriage \u2014 they are subtracted so that property you had before the marriage is not shared.\n\n**Important:** The family home you lived in at separation is NOT deducted even if you owned it before marriage \u2014 it is always included in the equalization calculation."},{"id":"dom_bank_accounts","label":"Bank accounts and savings \u2014 balance on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_rrsp","label":"RRSPs, investments \u2014 value on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_real_estate","label":"Real estate (excluding the matrimonial home) \u2014 value on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_business","label":"Business interests \u2014 value on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_pension","label":"Pension \u2014 value on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_vehicles","label":"Vehicles \u2014 value on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_other_assets","label":"Other assets on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_other_assets_description","label":"Describe other assets on date of marriage","type":"textarea","required":false,"placeholder":"e.g. Inheritance received before marriage \u2014 $30,000 / Personal property \u2014 $5,000"},{"id":"total_assets_dom","label":"TOTAL assets on date of marriage","type":"number","required":true,"prefix":"$","placeholder":"0.00","autoCalculate":{"operation":"sum","fields":["dom_bank_accounts","dom_rrsp","dom_real_estate","dom_business","dom_pension","dom_vehicles","dom_other_assets"]}}]},{"stepId":"nfp-step5","title":"Debts on Date of Marriage","description":"List the debts you owed on the day you were married. These reduce your date-of-marriage deduction.","fields":[{"id":"dom_debt_mortgage","label":"Mortgage(s) \u2014 balance owing on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_debt_vehicle","label":"Vehicle loans \u2014 balance owing on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_debt_student","label":"Student loans \u2014 balance owing on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_debt_credit_cards","label":"Credit card and line of credit balances \u2014 on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"dom_debt_other","label":"Other debts on date of marriage","type":"number","required":false,"prefix":"$","placeholder":"0.00"},{"id":"total_debts_dom","label":"TOTAL debts on date of marriage","type":"number","required":true,"prefix":"$","placeholder":"0.00","autoCalculate":{"operation":"sum","fields":["dom_debt_mortgage","dom_debt_vehicle","dom_debt_student","dom_debt_credit_cards","dom_debt_other"]}},{"id":"net_dom","label":"Net value on date of marriage (assets minus debts)","type":"number","required":true,"prefix":"$","placeholder":"0.00","helpText":"This is the amount subtracted from your valuation date net to account for what you brought into the marriage.","autoCalculate":{"operation":"subtract","fields":["total_assets_dom","total_debts_dom"]}}]},{"stepId":"nfp-step6","title":"Excluded Property","description":"Certain property is excluded from equalization even if you owned it on the valuation date. List any property that qualifies as excluded.","fields":[{"id":"excluded_property_notice","label":"What property is excluded?","type":"info-box","content":"Under the Family Law Act, the following property received **during the marriage** is excluded from equalization:\n\n- **Gifts or inheritances** received from a third party during the marriage (not from your spouse)\n- **Proceeds from a life insurance policy** received during the marriage\n- **Damages or settlement** for personal injury, nervous shock, or a prescribed right\n- **Property traceable to** any of the above (e.g. if you invested an inheritance and it grew, the original inheritance value is excluded)\n\n**Important:** The increase in value of excluded property is NOT excluded \u2014 only the original value of the excluded property itself."},{"id":"has_excluded_property","label":"Do you have any excluded property?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"excluded_property_items","label":"List each excluded property item","type":"repeatable-group","required":false,"conditionalOnParent":{"field":"has_excluded_property","value":"yes"},"maxItems":10,"addLabel":"Add another excluded property item","fields":[{"id":"excluded_description","label":"Description of the excluded property","type":"text","required":true,"placeholder":"e.g. Inheritance from my father's estate / Gift of money from my parents / Personal injury settlement"},{"id":"excluded_source","label":"Type of exclusion","type":"select","required":true,"options":[{"value":"gift","label":"Gift from a third party (not from spouse)"},{"value":"inheritance","label":"Inheritance"},{"value":"insurance_proceeds","label":"Life insurance proceeds"},{"value":"personal_injury","label":"Personal injury damages or settlement"},{"value":"traceable","label":"Property traceable to an excluded source"}]},{"id":"excluded_date_received","label":"Date received","type":"date","required":false,"helpText":"Approximate date you received this property during the marriage."},{"id":"excluded_value","label":"Value of the excluded property (at the time you received it, or at valuation date if it still exists in original form)","type":"number","required":true,"prefix":"$","placeholder":"0.00"},{"id":"excluded_still_exists","label":"Does this property still exist in its original form on the valuation date?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 still exists (e.g. still in a bank account or investment)"},{"value":"partly","label":"Partly \u2014 some was spent or converted, some remains"},{"value":"no","label":"No \u2014 it was spent or no longer traceable"}]},{"id":"excluded_tracing_notes","label":"Notes on how you can trace this exclusion","type":"textarea","required":false,"placeholder":"e.g. The $45,000 inheritance I received in 2019 was deposited into my TD savings account. I have bank records showing the deposit and the account balance over time. I kept the inheritance separate from joint funds."}]},{"id":"total_excluded_property","label":"TOTAL excluded property value","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Add up the values of all excluded property items listed above."}]},{"stepId":"nfp-step7","title":"Net Family Property Calculation","description":"Calculate your net family property. This is the number that determines whether you owe an equalization payment or are entitled to receive one.","fields":[{"id":"calculation_notice","label":"The formula","type":"info-box","content":"**Net Family Property (NFP) = A \u2212 B \u2212 C**\n\nWhere:\n- **A** = Net value on valuation date (total assets minus total debts at separation)\n- **B** = Net value on date of marriage (total assets minus total debts at marriage)\n- **C** = Excluded property\n\nIf the result is negative, your NFP is treated as zero.\n\nThe spouse with the **higher NFP** pays the other spouse **half the difference**. That payment is the equalization payment."},{"id":"nfp_line_a","label":"Line A \u2014 Net value on valuation date","type":"number","required":true,"prefix":"$","placeholder":"0.00","helpText":"Copy from Step 3: Net value on valuation date.","autoPopulate":"net_on_valuation_date"},{"id":"nfp_line_b","label":"Line B \u2014 Net value on date of marriage","type":"number","required":true,"prefix":"$","placeholder":"0.00","helpText":"Copy from Step 5: Net value on date of marriage.","autoPopulate":"net_dom"},{"id":"nfp_line_c","label":"Line C \u2014 Total excluded property","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"Copy from Step 6: Total excluded property value. Enter 0 if no excluded property.","autoPopulate":"total_excluded_property"},{"id":"nfp_result","label":"Your Net Family Property (A minus B minus C)","type":"number","required":true,"prefix":"$","placeholder":"0.00","helpText":"If this number is negative, your NFP is zero for equalization purposes.","autoCalculate":{"operation":"subtract","fields":["nfp_line_a","nfp_line_b","nfp_line_c"]}},{"id":"nfp_is_negative","label":"Is your calculated NFP negative?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 my NFP is negative, so I will report it as zero"},{"value":"no","label":"No \u2014 my NFP is zero or positive"}]},{"id":"nfp_final","label":"Your final Net Family Property (zero if negative)","type":"number","required":true,"prefix":"$","placeholder":"0.00","helpText":"If your calculated NFP above was negative, enter 0 here. Otherwise enter the same number as above."}]},{"stepId":"nfp-step8","title":"Equalization Claim","description":"Based on your NFP, describe what equalization payment you are claiming or expect to owe.","fields":[{"id":"other_party_nfp_estimate","label":"What is your estimate of the other party's Net Family Property?","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"If you know or can estimate the other party's NFP, enter it here. The equalization payment is half the difference between the two NFPs."},{"id":"equalization_payment_estimate","label":"Estimated equalization payment","type":"number","required":false,"prefix":"$","placeholder":"0.00","helpText":"If your NFP is lower than the other party's, you are owed an equalization payment = (Their NFP \u2212 Your NFP) \u00f7 2."},{"id":"equalization_direction","label":"Based on your estimate","type":"select","required":false,"options":[{"value":"i_am_owed","label":"I am owed an equalization payment from the other party"},{"value":"i_owe","label":"I owe an equalization payment to the other party"},{"value":"equal","label":"The NFPs appear roughly equal \u2014 no significant payment either way"},{"value":"unknown","label":"I don't have enough information to estimate"}]},{"id":"property_division_disputes","label":"Are there any specific assets or valuations that are in dispute with the other party?","type":"textarea","required":false,"placeholder":"e.g. The parties disagree on the value of the family home \u2014 I believe it is worth $780,000 based on a recent appraisal; the other party claims $850,000. The parties also disagree on the valuation of the other party's dental practice.","helpText":"Identifying disputed valuations helps the court understand what needs to be resolved."},{"id":"unequal_division_claim","label":"Are you asking the court to award an amount other than the standard equalization payment?","type":"radio","required":true,"helpText":"In rare cases, a court can order an unequal division of property if the standard equalization payment would be unconscionable (shockingly unfair).","options":[{"value":"yes","label":"Yes \u2014 I am asking for an unequal division"},{"value":"no","label":"No \u2014 I am asking for the standard equalization payment"}]},{"id":"unequal_division_reason","label":"Explain why an unequal division is warranted","type":"textarea","required":false,"conditionalOn":{"field":"unequal_division_claim","value":"yes"},"placeholder":"e.g. The other party deliberately dissipated significant family assets in the two years before separation by making large unauthorized withdrawals from joint accounts and gambling losses totalling approximately $85,000. Standard equalization would be unconscionable in these circumstances."}]},{"stepId":"nfp-step9","title":"Declaration","description":"Confirm the accuracy of your Net Family Property Statement.","fields":[{"id":"documents_available","label":"What documents do you have to support the values in this statement?","type":"checkbox-group","required":false,"options":[{"value":"mortgage_statement","label":"Mortgage statement as of valuation date"},{"value":"bank_statements","label":"Bank and investment statements as of valuation date"},{"value":"rrsp_statements","label":"RRSP/RRIF statements as of valuation date"},{"value":"pension_valuation","label":"Pension commuted value letter from administrator"},{"value":"property_appraisal","label":"Property appraisal or real estate valuation"},{"value":"business_valuation","label":"Business valuation report"},{"value":"vehicle_valuation","label":"Vehicle valuation (Canadian Black Book or appraisal)"},{"value":"tax_returns","label":"Income tax returns and Notices of Assessment"},{"value":"marriage_date_documents","label":"Bank/investment statements from date of marriage"},{"value":"inheritance_documents","label":"Estate documents or gift letters (for excluded property)"}]},{"id":"sworn_declaration","label":"Declaration","type":"declaration","required":true,"text":"I declare that the information in this Net Family Property Statement is true and complete to the best of my knowledge and belief. I understand that providing false information to the court is a serious matter.","checkboxLabel":"I confirm this declaration is true and accurate."},{"id":"signature_date","label":"Date","type":"date","required":true}]}],"pdfMapping":{"notes":"Form 13B \u2014 Net Family Property Statement. Each party completes separately. Used to calculate equalization payment under the Family Law Act. See ontario.ca/page/family-law-forms for the current version.","case_header":["courthouse","court_file_number","applicant_full_name","respondent_full_name","completing_party","marriage_date","valuation_date"],"valuation_date_assets":["asset_family_home_value","asset_other_real_estate","asset_bank_accounts","asset_rrsp_rrif","asset_pension","asset_investments","asset_business_interest","asset_vehicles","total_assets_valuation_date"],"valuation_date_debts":["debt_mortgage_family_home","debt_mortgage_other","debt_credit_cards","total_debts_valuation_date","net_on_valuation_date"],"marriage_date_section":["total_assets_dom","total_debts_dom","net_dom"],"excluded_property":["has_excluded_property","excluded_property_items","total_excluded_property"],"nfp_calculation":["nfp_line_a","nfp_line_b","nfp_line_c","nfp_result","nfp_final"],"equalization_claim":["equalization_direction","equalization_payment_estimate","unequal_division_claim"],"declaration":["sworn_declaration","signature_date"]}};
  window.__hp_formDefs['ON-F23C'] = {"formId":"ON-F26B",
  "pdfFileName": "form23c.pdf","formCode":"form23c-uncontested-trial","title":"Affidavit for Uncontested Trial","jurisdiction":"Ontario","version":"December 2020","description":"Filed when you are applying for divorce or another family law order and the other party is not contesting (disputing) the matter. Allows the court to grant the order based on your written evidence without a live hearing. Must be sworn before a commissioner of oaths.","autoPopulateFrom":["form8-general","form36-divorce"],"steps":[{"stepId":"ud-step1","title":"About This Affidavit","description":"Form 26B allows a divorce to proceed without a court hearing. A judge reviews the written materials and grants the divorce if all requirements are met.","fields":[{"id":"ud_explainer","label":"When is Form 26B used?","type":"info-box","content":"**Form 26B is used when:**\n- You have filed for divorce and the other party has NOT contested it (has not filed an Answer disputing the divorce)\n- OR both parties agree to a joint divorce application\n- There is no need for a court hearing \u2014 the judge decides on the written materials\n\n**You will also need:**\n- A certified copy of your marriage certificate\n- Your Form 36 (Affidavit for Divorce) \u2014 already sworn\n- Form 25A (Order for Divorce) \u2014 the draft order for the judge to sign\n- Proof of service on the other party (Form 6B) if they were not a joint applicant\n\n**After the divorce is granted:** The divorce order becomes effective 31 days after it is made, unless the judge waives the waiting period."},{"id":"courthouse","label":"Courthouse","type":"select","required":true,"autoPopulate":"courthouse","options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"]},{"id":"court_file_number","label":"Court file number","type":"text","required":true,"autoPopulate":"court_file_number","placeholder":"e.g. FC-2024-12345"},{"id":"applicant_full_name","label":"Applicant's full legal name","type":"text","required":true,"autoPopulate":"applicant_full_name"},{"id":"respondent_full_name","label":"Respondent's full legal name","type":"text","required":true,"autoPopulate":"respondent_full_name"},{"id":"application_type","label":"Type of divorce application","type":"select","required":true,"options":[{"value":"sole","label":"Sole application \u2014 I am the only applicant"},{"value":"joint","label":"Joint application \u2014 both parties are applicants"}]},{"id":"deponent_role","label":"You are swearing this affidavit as","type":"select","required":true,"options":[{"value":"applicant","label":"The Applicant"},{"value":"joint_applicant","label":"One of the joint applicants"}]}]},{"stepId":"ud-step2","title":"The Marriage","description":"Confirm the details of your marriage. These must match your marriage certificate exactly.","fields":[{"id":"marriage_date","label":"Date of marriage","type":"date","required":true,"autoPopulate":"marriage_date","helpText":"Must match your marriage certificate."},{"id":"marriage_city","label":"City or town where you were married","type":"text","required":true,"placeholder":"e.g. Toronto"},{"id":"marriage_province_country","label":"Province or country where you were married","type":"text","required":true,"placeholder":"e.g. Ontario, Canada"},{"id":"applicant_name_at_marriage","label":"Your full name at the time of marriage (if different from current name)","type":"text","required":false,"placeholder":"Leave blank if your name has not changed"},{"id":"respondent_name_at_marriage","label":"Other party's full name at the time of marriage (if different from current name)","type":"text","required":false,"placeholder":"Leave blank if their name has not changed"},{"id":"marriage_certificate_available","label":"Do you have a certified copy of your marriage certificate?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 I will attach a certified copy"},{"value":"no","label":"No \u2014 I need to obtain one"},{"value":"applied_for","label":"I have applied for one and it is pending"}],"helpText":"A certified copy of your marriage certificate is required to be filed with your divorce application. Obtain one from ServiceOntario or the vital statistics office in the jurisdiction where you were married."},{"id":"marriage_certificate_note","label":"If you do not have a marriage certificate, explain why and what steps you are taking","type":"textarea","required":false,"conditionalOn":{"field":"marriage_certificate_available","value":"no","orValues":["no","applied_for"]},"placeholder":"e.g. We were married in India. I have applied to the Indian government registry for a certified copy and expect to receive it within 8\u201310 weeks. I am asking the court to allow me to file the certificate once received."}]},{"stepId":"ud-step3","title":"Residence & Jurisdiction","description":"The court must confirm it has jurisdiction to grant the divorce. At least one spouse must have lived in Ontario for at least one year before the divorce application was filed.","fields":[{"id":"applicant_current_address","label":"Your current address","type":"text","required":true,"autoPopulate":"applicant_address","placeholder":"e.g. 123 Main St, Toronto ON M5V 1A1"},{"id":"applicant_residency_duration","label":"How long have you lived in Ontario?","type":"select","required":true,"options":[{"value":"more_than_1_year","label":"More than 1 year \u2014 I have lived in Ontario for at least 1 year"},{"value":"less_than_1_year","label":"Less than 1 year \u2014 I have not lived in Ontario for a full year yet"}],"helpText":"You must have been ordinarily resident in Ontario for at least one year immediately before the divorce application was filed."},{"id":"residency_note","label":"Note on residency requirement","type":"info-box","conditionalOn":{"field":"applicant_residency_duration","value":"less_than_1_year"},"content":"If you have not lived in Ontario for at least one year, check whether your spouse has \u2014 if so, they may need to be the applicant, or you may need to wait until the one-year requirement is met."},{"id":"respondent_address_known","label":"Do you know the other party's current address?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No \u2014 their address is not known to me"}]},{"id":"respondent_current_address","label":"Other party's current address","type":"text","required":false,"conditionalOn":{"field":"respondent_address_known","value":"yes"},"placeholder":"e.g. 456 Oak Ave, Ottawa ON K1A 0A1"}]},{"stepId":"ud-step4","title":"Separation","description":"Confirm the separation facts. One year of separation is the most common ground for divorce in Canada.","fields":[{"id":"separation_date","label":"Date you and your spouse separated","type":"date","required":true,"autoPopulate":"separation_date","helpText":"The date one or both of you decided the marriage was over."},{"id":"separated_one_year","label":"Have you lived separate and apart for at least one year as of today?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 we have been separated for at least one year"},{"value":"no","label":"No \u2014 we have not yet been separated for one year"}],"helpText":"You must have been separated for at least one year before the divorce can be granted."},{"id":"not_yet_separated_note","label":"Separation requirement not yet met","type":"info-box","conditionalOn":{"field":"separated_one_year","value":"no"},"content":"You can file a divorce application before the one-year anniversary of your separation \u2014 but the court will not grant the divorce until one year has passed. Make note of your one-year anniversary date and follow up with the court at that time."},{"id":"reconciliation_attempts","label":"Did you and your spouse attempt to reconcile after separating?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 we had a period of attempted reconciliation"},{"value":"no","label":"No \u2014 we did not attempt to reconcile"}]},{"id":"reconciliation_details","label":"Describe the reconciliation attempt(s)","type":"textarea","required":false,"conditionalOn":{"field":"reconciliation_attempts","value":"yes"},"placeholder":"e.g. We reconciled from October 1 to October 28, 2024 (28 days). We then separated again on October 29, 2024. Our total reconciliation period was less than 90 days so our one-year separation clock was not reset.","helpText":"Reconciliation periods of 90 days or less (combined) do not reset the one-year clock. Periods over 90 days do reset it."},{"id":"no_reasonable_chance","label":"Is there any reasonable chance of reconciliation?","type":"radio","required":true,"options":[{"value":"no","label":"No \u2014 there is no reasonable chance of reconciliation"},{"value":"yes","label":"Yes \u2014 there may be a possibility"}],"helpText":"You must confirm there is no reasonable chance of reconciliation for the court to grant the divorce."},{"id":"separated_same_home","label":"Did you live in the same home after separating?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 we continued to live in the same home after separating"},{"value":"no","label":"No \u2014 we moved to separate homes when we separated"}]},{"id":"same_home_details","label":"Describe how you lived separately in the same home","type":"textarea","required":false,"conditionalOn":{"field":"separated_same_home","value":"yes"},"placeholder":"e.g. After we separated on March 1, 2024, we continued to share the house due to financial constraints. We slept in separate bedrooms, had no intimate relationship, ate separately, and managed our finances independently. We told family and friends that we had separated. I moved out on September 15, 2024.","helpText":"The court must be satisfied you were truly living 'separate and apart' even if under the same roof. Be specific."}]},{"stepId":"ud-step5","title":"Children","description":"Confirm whether there are children of the marriage and what support arrangements are in place.","fields":[{"id":"has_children","label":"Are there any children of the marriage \u2014 under 18, or 18 or over but still dependent?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No \u2014 there are no children of the marriage"}],"helpText":"Children of the marriage include biological, adopted, and step-children who were treated as children of the family."},{"id":"children_list","label":"List the children","type":"repeatable-group","required":false,"conditionalOnParent":{"field":"has_children","value":"yes"},"maxItems":8,"addLabel":"Add another child","fields":[{"id":"child_name","label":"Child's full name","type":"text","required":true,"placeholder":"e.g. Alex Jordan Smith"},{"id":"child_dob","label":"Date of birth","type":"date","required":true},{"id":"child_lives_with","label":"Child currently lives with","type":"select","required":true,"options":[{"value":"applicant","label":"The Applicant"},{"value":"respondent","label":"The Respondent"},{"value":"both_equal","label":"Both parents (shared/equal time)"},{"value":"other","label":"Another person"}]},{"id":"child_still_dependent","label":"Is this child still dependent (if 18 or over)?","type":"radio","required":false,"options":[{"value":"yes_still_dependent","label":"Yes \u2014 still in school or otherwise dependent"},{"value":"no_independent","label":"No \u2014 fully independent"},{"value":"under_18","label":"Under 18 \u2014 automatically a child of the marriage"}]}]},{"id":"child_support_in_place","label":"Are reasonable arrangements in place for child support?","type":"radio","required":false,"conditionalOn":{"field":"has_children","value":"yes"},"options":[{"value":"yes","label":"Yes \u2014 child support is in place"},{"value":"no","label":"No \u2014 child support has not been arranged"}],"helpText":"The court will not grant the divorce unless satisfied that reasonable support arrangements exist for the children."},{"id":"child_support_details","label":"Describe the child support arrangements","type":"textarea","required":false,"conditionalOn":{"field":"child_support_in_place","value":"yes"},"placeholder":"e.g. The Respondent pays child support of $1,200 per month pursuant to the Federal Child Support Guidelines, as set out in the separation agreement dated March 15, 2025. Payments are made through the Family Responsibility Office."},{"id":"parenting_arrangement_details","label":"Describe the parenting (custody/access) arrangement","type":"textarea","required":false,"conditionalOn":{"field":"has_children","value":"yes"},"placeholder":"e.g. The children reside primarily with the Applicant. The Respondent has parenting time every other weekend from Friday 6 p.m. to Sunday 6 p.m. and Wednesday evenings from 4 p.m. to 7 p.m. This is set out in the separation agreement dated March 15, 2025."}]},{"stepId":"ud-step6","title":"Service on the Other Party","description":"Confirm how the other party was served with the divorce application, or why service is not required.","fields":[{"id":"service_situation","label":"Service of the divorce application","type":"select","required":true,"options":[{"value":"served_personally","label":"The other party was personally served with the application"},{"value":"served_by_mail","label":"The other party was served by mail"},{"value":"served_by_lawyer","label":"Service was accepted by the other party's lawyer"},{"value":"joint_application","label":"This is a joint application \u2014 service is not required"},{"value":"court_dispensed_service","label":"The court dispensed with service"}]},{"id":"service_date","label":"Date the other party was served","type":"date","required":false,"conditionalOn":{"field":"service_situation","value":"joint_application","inverse":true},"helpText":"This should match the date on your Form 6B (Affidavit of Service)."},{"id":"respondent_did_not_contest","label":"Did the other party file an Answer contesting the divorce?","type":"radio","required":false,"conditionalOn":{"field":"service_situation","value":"joint_application","inverse":true},"options":[{"value":"no","label":"No \u2014 they did not file an Answer"},{"value":"yes","label":"Yes \u2014 they filed a response"}],"helpText":"Form 26B can only be used if the divorce is uncontested. If the other party filed an Answer, you may need to proceed to a hearing instead."},{"id":"answer_filed_note","label":"Other party filed a response","type":"info-box","conditionalOn":{"field":"respondent_did_not_contest","value":"yes"},"content":"If the other party filed an Answer to your divorce application, the divorce may be contested and cannot proceed on written materials alone. Contact the court clerk to discuss whether a hearing is required. Form 26B may not be the appropriate form for your situation."}]},{"stepId":"ud-step7","title":"Previous Divorce Proceedings","description":"Disclose any previous divorce or family law proceedings between you and the other party.","fields":[{"id":"previous_divorce_proceedings","label":"Are there any other divorce or family law proceedings between you and the other party in any court in Canada or elsewhere?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"previous_proceedings_details","label":"Describe the other proceedings","type":"textarea","required":false,"conditionalOn":{"field":"previous_divorce_proceedings","value":"yes"},"placeholder":"e.g. There is an existing Ontario Superior Court of Justice proceeding (File No. FC-2024-12345) which is the proceeding within which this divorce application is filed. There are no other proceedings in any other court in Canada or internationally."},{"id":"existing_separation_agreement","label":"Do you have a signed separation agreement?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},{"id":"separation_agreement_details","label":"Describe the separation agreement","type":"textarea","required":false,"conditionalOn":{"field":"existing_separation_agreement","value":"yes"},"placeholder":"e.g. The parties executed a separation agreement dated March 15, 2025, which addresses parenting, child support, spousal support, and property division. A copy is filed with the court."}]},{"stepId":"ud-step8","title":"Collusion & No Reconciliation","description":"Standard declarations required by the Divorce Act.","fields":[{"id":"no_collusion","label":"Declaration regarding collusion","type":"checkbox","required":true,"checkboxLabel":"I confirm that there has been no collusion in relation to this divorce application \u2014 meaning no agreement, conspiracy, or arrangement to fabricate or suppress evidence or to deceive the court.","helpText":"Collusion is extremely rare in practice but must be declared. It refers to a secret agreement to mislead the court \u2014 for example, fabricating grounds for divorce."},{"id":"no_condonation","label":"Declaration regarding condonation","type":"checkbox","required":true,"checkboxLabel":"I confirm that I have not condoned any conduct that might otherwise be raised as a ground for divorce.","helpText":"Condonation means forgiving a matrimonial offence (such as adultery or cruelty) and resuming the marriage knowing about it. For separation-based divorces, this is generally not applicable."},{"id":"divorce_grounds","label":"Grounds for divorce","type":"select","required":true,"options":[{"value":"separation","label":"Separation \u2014 we have been separated for at least one year (most common)"},{"value":"adultery","label":"Adultery \u2014 my spouse committed adultery"},{"value":"cruelty","label":"Physical or mental cruelty"}],"helpText":"Virtually all Canadian divorces proceed on the grounds of one year's separation. Adultery and cruelty are very rarely used because they are more difficult to prove."}]},{"stepId":"ud-step9","title":"Name Change (Optional)","description":"If you wish to resume a former name after the divorce, this can be included in the divorce order.","fields":[{"id":"name_change_requested","label":"Do you want to resume a former surname after the divorce?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 I want to resume a former name"},{"value":"no","label":"No \u2014 I do not want to change my name"}],"helpText":"You can resume a surname you used before the marriage. The divorce order itself serves as proof of the name change \u2014 no separate process is required."},{"id":"name_to_resume","label":"Surname you want to resume","type":"text","required":false,"conditionalOn":{"field":"name_change_requested","value":"yes"},"placeholder":"e.g. Johnson (your surname before marriage)"},{"id":"waive_31_days","label":"Are you asking the court to waive the standard 31-day waiting period before the divorce takes effect?","type":"radio","required":true,"options":[{"value":"no","label":"No \u2014 the standard 31-day effective date is fine"},{"value":"yes","label":"Yes \u2014 I am asking the court to waive the 31-day period"}],"helpText":"The divorce normally becomes effective 31 days after the order is made \u2014 this allows time for an appeal. The waiting period is rarely waived; it requires a compelling reason such as an imminent remarriage."},{"id":"waive_reason","label":"Reason for requesting the 31-day waiver","type":"textarea","required":false,"conditionalOn":{"field":"waive_31_days","value":"yes"},"placeholder":"e.g. Both parties consent to the divorce taking immediate effect. The Applicant plans to remarry on [date] and needs the divorce to be final before that date. Both parties waive their right to appeal."}]},{"stepId":"ud-step10","title":"Documents Checklist & Declaration","description":"Confirm what documents you are filing with this affidavit and swear to the accuracy of your information.","fields":[{"id":"documents_filed","label":"Documents you are filing with this affidavit","type":"checkbox-group","required":true,"helpText":"Check all that apply. You must file all required documents together.","options":[{"value":"divorce_application","label":"Divorce application (Form 8A)"},{"value":"form36","label":"Form 36 \u2014 Affidavit for Divorce (sworn)"},{"value":"form25a","label":"Form 25A \u2014 Order for Divorce (draft, unsigned)"},{"value":"marriage_certificate","label":"Certified copy of the marriage certificate"},{"value":"form6b","label":"Form 6B \u2014 Affidavit of Service (proof of service on the other party)"},{"value":"separation_agreement","label":"Separation agreement (if one exists)"},{"value":"draft_minutes","label":"Minutes of settlement or draft consent order"},{"value":"other_form","label":"Other court forms or documents"}]},{"id":"other_documents_description","label":"Describe other documents being filed","type":"text","required":false,"conditionalOn":{"field":"documents_filed","value":"other_form"},"placeholder":"e.g. Financial statement Form 13, property valuation report"},{"id":"swear_or_affirm","label":"Will you swear or affirm?","type":"select","required":true,"options":[{"value":"swear","label":"Swear (on a religious text)"},{"value":"affirm","label":"Affirm (non-religious solemn declaration)"}]},{"id":"municipality_of_swearing","label":"Municipality where you will swear or affirm this affidavit","type":"text","required":true,"placeholder":"e.g. Toronto"},{"id":"commissioning_date","label":"Date of commissioning (leave blank to complete at courthouse)","type":"date","required":false},{"id":"sworn_declaration","label":"Declaration","type":"declaration","required":true,"text":"I, the deponent, declare that the contents of this affidavit are true and complete to the best of my knowledge and belief. I make this solemn declaration conscientiously believing it to be true and knowing that it is of the same force and effect as if made under oath.","checkboxLabel":"I confirm this declaration is true and accurate."}]}],"pdfMapping":{"notes":"Form 26B \u2014 Affidavit (Divorce) for uncontested divorce applications. Must be sworn before a commissioner of oaths. Filed with Form 36, Form 25A, marriage certificate, and proof of service. See ontario.ca/page/family-law-forms.","case_header":["courthouse","court_file_number","applicant_full_name","respondent_full_name","application_type","deponent_role"],"marriage_section":["marriage_date","marriage_city","marriage_province_country","marriage_certificate_available"],"residence_section":["applicant_current_address","applicant_residency_duration"],"separation_section":["separation_date","separated_one_year","reconciliation_attempts","no_reasonable_chance","separated_same_home"],"children_section":["has_children","children_list","child_support_in_place","parenting_arrangement_details"],"service_section":["service_situation","service_date","respondent_did_not_contest"],"previous_proceedings":["previous_divorce_proceedings","existing_separation_agreement"],"declarations":["no_collusion","no_condonation","divorce_grounds"],"name_change":["name_change_requested","name_to_resume","waive_31_days"],"documents_and_oath":["documents_filed","swear_or_affirm","municipality_of_swearing","sworn_declaration"]},"formNumber":"Form 23C"},
      {
        icon: "📋",
        label: "Draft a court order",
        description: "Prepare a draft Order (General) for the judge or clerk to sign",
        formKeys: ["form25-order-general"]
      },
      {
        icon: "🔄",
        label: "Change your representation",
        description: "File a Notice of Change in Representation (hire a lawyer, switch lawyers, or go self-represented)",
        formKeys: ["form4-change-representation"]
      };
  window.__hp_formDefs['ON-F25'] = {"pdfFileName":"form25.pdf","formCode":"form25-order-general","formNumber":"Form 25","title":"Order (General)","jurisdiction":"Ontario","act":"Family Law Rules","version":"December 2020","description":"Used to draft a proposed court order for the judge or clerk to sign. Can be temporary or final and may refer to the Divorce Act, Children's Law Reform Act, or Family Law Act.","steps":[{"step":1,"title":"Court & File Information","description":"Enter the court location and file details for this order.","fields":[{"id":"court_file_number","label":"Court File Number","type":"text","required":true,"placeholder":"e.g. FC-12345-24","hint":"This is the number the court assigned when the case was started. It appears on your Application."},{"id":"court_name","label":"Name of Court","type":"text","required":true,"placeholder":"e.g. Ontario Court of Justice","hint":"Write the full name of the court where your case is being heard."},{"id":"court_location","label":"Court Location (City)","type":"text","required":true,"placeholder":"e.g. Toronto","hint":"The city or municipality where the court office is located."},{"id":"court_office_address","label":"Court Office Address","type":"text","required":true,"placeholder":"e.g. 311 Jarvis Street, Toronto, ON M5B 2C4","hint":"Full street address of the courthouse."},{"id":"order_type","label":"Type of Order","type":"radio","required":true,"options":[{"value":"temporary","label":"Temporary \u2014 an order that lasts until a future court date or further order"},{"value":"final","label":"Final \u2014 a permanent order that ends this issue in your case"}],"hint":"A temporary order is often made at a motion. A final order is made after a trial or on consent. If you are not sure, ask the court office."}]},{"step":2,"title":"Applicant Information","description":"Enter the full name and contact details for the applicant.","fields":[{"id":"applicant_fullname","label":"Applicant \u2014 Full Legal Name","type":"text","required":true,"placeholder":"e.g. Jane Elizabeth Smith","autoFill":"user_fullname","hint":"Use your full legal name exactly as it appears on your Application."},{"id":"applicant_address","label":"Applicant \u2014 Address for Service","type":"text","required":true,"placeholder":"Street & number, city, province, postal code","autoFill":"user_address","hint":"This is the address where court documents will be sent to you."},{"id":"applicant_phone","label":"Applicant \u2014 Telephone Number","type":"tel","required":true,"placeholder":"e.g. 416-555-0100","autoFill":"user_phone"},{"id":"applicant_fax","label":"Applicant \u2014 Fax Number (if any)","type":"tel","required":false,"placeholder":"e.g. 416-555-0101"},{"id":"applicant_email","label":"Applicant \u2014 Email Address (if any)","type":"email","required":false,"placeholder":"e.g. jane.smith@email.com","autoFill":"user_email"},{"id":"applicant_lawyer_name","label":"Applicant's Lawyer \u2014 Full Name & Address","type":"textarea","required":false,"rows":3,"placeholder":"Lawyer's full name, firm, street & number, city, province, postal code, telephone, fax, email","hint":"Leave blank if the applicant is self-represented."}]},{"step":3,"title":"Respondent Information","description":"Enter the full name and contact details for the respondent.","fields":[{"id":"respondent_fullname","label":"Respondent \u2014 Full Legal Name","type":"text","required":true,"placeholder":"e.g. John Robert Smith","autoFill":"spouse_fullname","hint":"Use the respondent's full legal name exactly as it appears on the Application."},{"id":"respondent_address","label":"Respondent \u2014 Address for Service","type":"text","required":true,"placeholder":"Street & number, city, province, postal code","autoFill":"spouse_address"},{"id":"respondent_phone","label":"Respondent \u2014 Telephone Number","type":"tel","required":false,"placeholder":"e.g. 416-555-0200"},{"id":"respondent_fax","label":"Respondent \u2014 Fax Number (if any)","type":"tel","required":false,"placeholder":"e.g. 416-555-0201"},{"id":"respondent_email","label":"Respondent \u2014 Email Address (if any)","type":"email","required":false,"placeholder":"e.g. john.smith@email.com"},{"id":"respondent_lawyer_name","label":"Respondent's Lawyer \u2014 Full Name & Address","type":"textarea","required":false,"rows":3,"placeholder":"Lawyer's full name, firm, street & number, city, province, postal code, telephone, fax, email","hint":"Leave blank if the respondent is self-represented."}]},{"step":4,"title":"Hearing Details","description":"Describe what happened at the court hearing that led to this order.","fields":[{"id":"judge_name","label":"Judge's Name (print or type)","type":"text","required":false,"placeholder":"e.g. The Honourable Justice A. Lee","hint":"The name of the judge who made or will sign the order. If you do not know this yet, leave blank and fill in at the courthouse."},{"id":"hearing_date","label":"Date of Hearing / Date of Order","type":"date","required":true,"hint":"The date the court hearing took place, or the date the order is to be signed."},{"id":"motion_made_by","label":"Application / Motion Made By","type":"text","required":true,"placeholder":"e.g. the Applicant, Jane Smith","hint":"Write the name of the person or persons who brought the motion or application."},{"id":"persons_in_court","label":"Persons Present in Court","type":"textarea","required":false,"rows":3,"placeholder":"e.g. Jane Smith (Applicant, self-represented); John Smith (Respondent, represented by A. Jones)","hint":"List the names of all parties and lawyers who were present at the hearing."},{"id":"evidence_submissions_by","label":"Evidence and Submissions Received On Behalf Of","type":"textarea","required":false,"rows":2,"placeholder":"e.g. the Applicant, Jane Smith","hint":"List the names of the persons on whose behalf the court received evidence or heard submissions."}]},{"step":5,"title":"Applicable Legislation","description":"Select the legislation under which the order is being made. Most family law orders are made under more than one Act \u2014 check all that apply.","fields":[{"id":"legislation_provincial_only","label":"This order is made pursuant to provincial legislation only","type":"checkbox","required":false,"hint":"Check this if the order does NOT involve the Divorce Act (for example, you are not married, or this is a common-law matter)."},{"id":"legislation_divorce_act","label":"Divorce Act (Canada)","type":"checkbox","required":false,"hint":"Check if any part of the order relates to divorce, or to custody/access/support between married spouses under the federal Divorce Act."},{"id":"legislation_clra","label":"Children's Law Reform Act (Ontario)","type":"checkbox","required":false,"hint":"Check if the order involves parenting time, decision-making, or contact for children of unmarried parents, or for any child custody/access matter under provincial law."},{"id":"legislation_fla","label":"Family Law Act (Ontario)","type":"checkbox","required":false,"hint":"Check if the order involves spousal support, property division, net family property, or possession of the matrimonial home under Ontario's Family Law Act."}]},{"step":6,"title":"Order Terms \u2014 Divorce Act","description":"If the Divorce Act applies, type the exact terms of the order here.","showIf":{"field":"legislation_divorce_act","value":true},"fields":[{"id":"order_terms_divorce_act","label":"PURSUANT TO THE DIVORCE ACT (CANADA), THIS COURT ORDERS THAT:","type":"textarea","required":false,"rows":8,"placeholder":"e.g.\n1. The parties shall have joint decision-making responsibility for the child, Emma Smith, born March 1, 2018.\n2. The child shall reside primarily with the Applicant.\n3. The Respondent shall have parenting time with the child every other weekend...","hint":"Write the exact terms of each order. Number each term. Be as specific as possible \u2014 include names, dates, amounts, and conditions. Leave blank if this legislation does not apply."}]},{"step":7,"title":"Order Terms \u2014 Children's Law Reform Act","description":"If the Children's Law Reform Act applies, type the exact terms of the order here.","showIf":{"field":"legislation_clra","value":true},"fields":[{"id":"order_terms_clra","label":"PURSUANT TO THE CHILDREN'S LAW REFORM ACT, THIS COURT ORDERS THAT:","type":"textarea","required":false,"rows":8,"placeholder":"e.g.\n1. The Applicant shall have sole decision-making responsibility for the child, Liam Jones, born June 5, 2017.\n2. The Respondent shall have parenting time as agreed between the parties in writing...","hint":"Write the exact terms of each order. Number each term. Leave blank if this legislation does not apply."}]},{"step":8,"title":"Order Terms \u2014 Family Law Act","description":"If the Family Law Act applies, type the exact terms of the order here.","showIf":{"field":"legislation_fla","value":true},"fields":[{"id":"order_terms_fla","label":"PURSUANT TO THE FAMILY LAW ACT, THIS COURT ORDERS THAT:","type":"textarea","required":false,"rows":8,"placeholder":"e.g.\n1. The Respondent shall pay to the Applicant spousal support in the amount of $1,500 per month commencing January 1, 2025.\n2. The equalization payment of $45,000 shall be paid by the Respondent to the Applicant within 60 days of this order...","hint":"Write the exact terms of each order. Number each term. Leave blank if this legislation does not apply."}]},{"step":9,"title":"Additional Order Terms","description":"Use this section for any order terms not covered by a specific Act, or for additional terms that continue from the previous sections.","fields":[{"id":"order_terms_additional","label":"THIS COURT ALSO ORDERS THAT (additional terms, specify legislation where applicable):","type":"textarea","required":false,"rows":8,"placeholder":"e.g.\n1. The Respondent shall pay costs of this motion fixed at $2,500 payable within 30 days.\n2. Either party may apply to vary this order on notice.","hint":"Include costs awards, service directions, compliance timelines, or any other terms. Put a line through any blank space left on the printed form."},{"id":"order_attach_sheets","label":"Additional sheets attached?","type":"checkbox","required":false,"hint":"Check this if you have attached extra pages continuing the order terms. Make sure each page is clearly numbered and cross-referenced."}]},{"step":10,"title":"Signature & Declaration","description":"Review and confirm. The order is signed by the judge or clerk of the court \u2014 not by you. Your role is to present this draft to the court.","fields":[{"id":"signature_date","label":"Date of Signature (to be completed by court)","type":"date","required":false,"hint":"This field is filled in by the judge or clerk at the courthouse when the order is signed. Leave blank or enter the expected hearing date."},{"id":"preparer_confirmation","label":"I confirm that I have prepared this draft order accurately and that it reflects the order I am seeking from the court.","type":"checkbox","required":true},{"id":"hearth_page_notice","label":"Hearth & Page Notice","type":"info","content":"This draft order was prepared using Hearth & Page. It must be reviewed and signed by a judge or clerk of the court before it becomes a legally binding order. Bring this completed draft to your court hearing."}]}]};
  window.__hp_formDefs['ON-F4'] = {"pdfFileName":"form4.pdf","formCode":"form4-change-representation","formNumber":"Form 4","title":"Notice of Change in Representation","jurisdiction":"Ontario","act":"Family Law Rules","version":"October 2013","description":"Used when a party changes their legal representation \u2014 for example, hiring a lawyer, switching to a new lawyer, dismissing a lawyer to self-represent, or getting court permission to be represented by someone who is not a lawyer.","steps":[{"step":1,"title":"Court & File Information","description":"Enter the court location and file number for your case.","fields":[{"id":"court_file_number","label":"Court File Number","type":"text","required":true,"placeholder":"e.g. FC-12345-24","hint":"This is the number the court assigned to your case. It appears on your Application or any prior court documents."},{"id":"court_name","label":"Name of Court","type":"text","required":true,"placeholder":"e.g. Ontario Court of Justice","hint":"Write the full name of the court where your case is being heard."},{"id":"court_location","label":"Court Location (City)","type":"text","required":true,"placeholder":"e.g. Toronto","hint":"The city or municipality where the court office is located."},{"id":"court_office_address","label":"Court Office Address","type":"text","required":true,"placeholder":"e.g. 311 Jarvis Street, Toronto, ON M5B 2C4","hint":"Full street address of the courthouse."}]},{"step":2,"title":"Applicant Information","description":"Enter the applicant's full name and contact details.","fields":[{"id":"applicant_fullname","label":"Applicant \u2014 Full Legal Name","type":"text","required":true,"placeholder":"e.g. Jane Elizabeth Smith","autoFill":"user_fullname","hint":"Use the full legal name exactly as it appears on the original Application."},{"id":"applicant_address","label":"Applicant \u2014 Address for Service","type":"text","required":true,"placeholder":"Street & number, city, province, postal code","autoFill":"user_address"},{"id":"applicant_phone","label":"Applicant \u2014 Telephone Number","type":"tel","required":true,"placeholder":"e.g. 416-555-0100","autoFill":"user_phone"},{"id":"applicant_fax","label":"Applicant \u2014 Fax Number (if any)","type":"tel","required":false,"placeholder":"e.g. 416-555-0101"},{"id":"applicant_email","label":"Applicant \u2014 Email Address (if any)","type":"email","required":false,"placeholder":"e.g. jane.smith@email.com","autoFill":"user_email"},{"id":"applicant_lawyer_current","label":"Applicant's Current / Previous Lawyer (if any)","type":"textarea","required":false,"rows":3,"placeholder":"Lawyer's full name, firm, address, telephone, fax, email","hint":"Enter the current or previous lawyer's details if applicable. Leave blank if the applicant has always been self-represented."}]},{"step":3,"title":"Respondent Information","description":"Enter the respondent's full name and contact details.","fields":[{"id":"respondent_fullname","label":"Respondent \u2014 Full Legal Name","type":"text","required":true,"placeholder":"e.g. John Robert Smith","autoFill":"spouse_fullname"},{"id":"respondent_address","label":"Respondent \u2014 Address for Service","type":"text","required":true,"placeholder":"Street & number, city, province, postal code","autoFill":"spouse_address"},{"id":"respondent_phone","label":"Respondent \u2014 Telephone Number","type":"tel","required":false,"placeholder":"e.g. 416-555-0200"},{"id":"respondent_fax","label":"Respondent \u2014 Fax Number (if any)","type":"tel","required":false,"placeholder":"e.g. 416-555-0201"},{"id":"respondent_email","label":"Respondent \u2014 Email Address (if any)","type":"email","required":false,"placeholder":"e.g. john.smith@email.com"},{"id":"respondent_lawyer_name","label":"Respondent's Lawyer \u2014 Full Name & Address (if any)","type":"textarea","required":false,"rows":3,"placeholder":"Lawyer's full name, firm, address, telephone, fax, email","hint":"Leave blank if the respondent is self-represented."}]},{"step":4,"title":"Children's Lawyer (if involved)","description":"If a Children's Lawyer has been appointed in your case, enter their information here.","fields":[{"id":"childrens_lawyer_involved","label":"Is a Children's Lawyer involved in this case?","type":"radio","required":true,"options":[{"value":"no","label":"No \u2014 no Children's Lawyer is involved"},{"value":"yes","label":"Yes \u2014 a Children's Lawyer has been appointed"}],"hint":"A Children's Lawyer may be appointed by the court to represent your child's interests separately."},{"id":"childrens_lawyer_details","label":"Children's Lawyer / Agent \u2014 Name, Address & Child Represented","type":"textarea","required":false,"rows":4,"placeholder":"Name & address of Children's Lawyer's agent for service (street & number, municipality, postal code, telephone & fax), and name of person represented.","showIf":{"field":"childrens_lawyer_involved","value":"yes"},"hint":"Enter the Children's Lawyer's contact information and the name of the child they represent."}]},{"step":5,"title":"Who is Filing This Notice","description":"Tell the court which party is changing their representation.","fields":[{"id":"filer_role","label":"I am the:","type":"radio","required":true,"options":[{"value":"applicant","label":"Applicant"},{"value":"respondent","label":"Respondent"},{"value":"other","label":"Other party in this case"}]},{"id":"filer_name","label":"My Full Legal Name","type":"text","required":true,"placeholder":"e.g. Jane Elizabeth Smith","autoFill":"user_fullname","hint":"This notice is addressed to all parties and their lawyers."}]},{"step":6,"title":"Nature of the Change","description":"Select the change in representation that applies to you. Choose only one.","fields":[{"id":"representation_change","label":"My change in representation is:","type":"radio","required":true,"options":[{"value":"new_lawyer_first_time","label":"I have chosen to be represented by a lawyer (I was previously self-represented)"},{"value":"new_lawyer_switch","label":"I have chosen a new lawyer (replacing my previous lawyer)"},{"value":"self_represented","label":"I have decided to act in person (I am dismissing my lawyer and will represent myself)"},{"value":"non_lawyer_rep","label":"I have the court's permission to be represented by a person who is not a lawyer"},{"value":"self_rep_child_protection","label":"I have the court's permission to appear in person at a child protection trial"}],"hint":"If you are switching to self-representation from a lawyer, you must also serve this notice on your former lawyer."}]},{"step":7,"title":"New Representation Details","description":"Provide the contact details for your new lawyer or representative, or your new address for service if acting in person.","fields":[{"id":"new_rep_name","label":"New Lawyer / Representative \u2014 Full Name","type":"text","required":false,"placeholder":"e.g. A. Jones, Barrister & Solicitor","showIf":{"field":"representation_change","values":["new_lawyer_first_time","new_lawyer_switch","non_lawyer_rep"]},"hint":"Enter the full name of your new lawyer or court-approved representative."},{"id":"new_rep_address","label":"New Lawyer / Representative \u2014 Address","type":"text","required":false,"placeholder":"Street & number, city, province, postal code","showIf":{"field":"representation_change","values":["new_lawyer_first_time","new_lawyer_switch","non_lawyer_rep"]}},{"id":"new_rep_phone","label":"New Lawyer / Representative \u2014 Telephone Number","type":"tel","required":false,"placeholder":"e.g. 416-555-0300","showIf":{"field":"representation_change","values":["new_lawyer_first_time","new_lawyer_switch","non_lawyer_rep"]}},{"id":"new_rep_fax","label":"New Lawyer / Representative \u2014 Fax Number (if any)","type":"tel","required":false,"placeholder":"e.g. 416-555-0301","showIf":{"field":"representation_change","values":["new_lawyer_first_time","new_lawyer_switch","non_lawyer_rep"]}},{"id":"new_rep_email","label":"New Lawyer / Representative \u2014 Email Address (if any)","type":"email","required":false,"placeholder":"e.g. a.jones@lawfirm.com","showIf":{"field":"representation_change","values":["new_lawyer_first_time","new_lawyer_switch","non_lawyer_rep"]}},{"id":"self_rep_service_address","label":"My Address for Service (if acting in person)","type":"text","required":false,"placeholder":"Street & number, city, province, postal code","showIf":{"field":"representation_change","values":["self_represented","self_rep_child_protection"]},"autoFill":"user_address","hint":"If you are acting without a lawyer, documents will be served on you at this address. Provide a complete address \u2014 a PO Box alone is not sufficient."},{"id":"self_rep_phone","label":"My Telephone Number (if acting in person)","type":"tel","required":false,"placeholder":"e.g. 416-555-0100","showIf":{"field":"representation_change","values":["self_represented","self_rep_child_protection"]},"autoFill":"user_phone"},{"id":"self_rep_email","label":"My Email Address (if acting in person)","type":"email","required":false,"placeholder":"e.g. jane.smith@email.com","showIf":{"field":"representation_change","values":["self_represented","self_rep_child_protection"]},"autoFill":"user_email"},{"id":"lawyer_consent_attached","label":"I have attached the new lawyer's consent to this notice","type":"checkbox","required":false,"showIf":{"field":"representation_change","values":["new_lawyer_first_time","new_lawyer_switch"]},"hint":"Rule 4 of the Family Law Rules requires you to attach the new lawyer's consent when you were previously self-represented and are now hiring a lawyer."}]},{"step":8,"title":"Service Instructions","description":"Important steps you must complete after filing this notice.","fields":[{"id":"service_instructions_info","label":"Important Service Requirements","type":"info","content":"After completing this form, you must:\n\n1. Serve a copy of this notice on the lawyers for all other parties. If another party does not have a lawyer, serve it on that party directly.\n\n2. If you had a lawyer who is no longer representing you because of this notice, you must also serve a copy on your former lawyer.\n\n3. You may serve by any method in Rule 6 of the Family Law Rules (mail, courier, fax, or email).\n\n4. After serving, file this notice with the court clerk together with proof of service (Form 6B: Affidavit of Service).\n\n5. If a child protection case has been scheduled for trial, you must obtain the court's permission before removing your lawyer."},{"id":"service_completed_on_parties","label":"I confirm I will serve this notice on all parties or their lawyers before filing with the court.","type":"checkbox","required":true},{"id":"service_completed_on_former_lawyer","label":"I will also serve this notice on my former lawyer (if applicable).","type":"checkbox","required":false,"hint":"Check this if you had a lawyer who is being replaced or dismissed."},{"id":"form6b_reminder","label":"I understand I must file Form 6B (Affidavit of Service) as proof that I served this notice.","type":"checkbox","required":true}]},{"step":9,"title":"Signature & Date","description":"Sign and date this notice. You must sign it personally.","fields":[{"id":"signature_date","label":"Date of Signature","type":"date","required":true,"hint":"Enter today's date or the date you are signing this notice."},{"id":"signature_confirmation","label":"I confirm that all information in this notice is true and correct, and I am signing this notice personally.","type":"checkbox","required":true},{"id":"hearth_page_notice","label":"Hearth & Page Notice","type":"info","content":"This notice was prepared using Hearth & Page. You must serve a copy on all parties (or their lawyers) and file it with the court together with Form 6B as proof of service. This document does not replace legal advice."}]}]};
  window.__hp_formDefs['ON-F15B'] = {"pdfFileName":"form15b.pdf","formCode":"form15b-response-to-change","formNumber":"Form 15B","title":"Response to Motion to Change","jurisdiction":"Ontario","act":"Family Law Rules","version":"December 2020","description":"Filed by the responding party when they receive a Motion to Change (Form 15). Use this form if you disagree with the changes being requested, or if you want to ask for different or additional changes to the existing order or agreement. Must be sworn before a commissioner of oaths. You have 30 days to respond if you live in Canada or the US, or 60 days if you live elsewhere.","steps":[{"step":1,"title":"Court & File Information","description":"Enter the court details and the file number from the Motion to Change you received.","fields":[{"id":"courthouse","label":"Courthouse","type":"select","required":true,"autoFill":"courthouse","options":["Barrie","Belleville","Brampton","Brantford","Brockville","Chatham","Cobourg","Cornwall","Guelph","Hamilton","Kingston","Kitchener","L'Orignal","Lindsay","London","Milton","Newmarket","North Bay","Oshawa","Ottawa","Owen Sound","Pembroke","Perth","Peterborough","Sarnia","Sault Ste. Marie","Simcoe","St. Catharines","St. Thomas","Sudbury","Thunder Bay","Timmins","Toronto (Ontario Court of Justice)","Toronto (Superior Court of Justice — 393 University)","Toronto (Superior Court of Justice — 47 Sheppard)","Welland","Windsor","Woodstock"],"hint":"Select the courthouse shown at the top of the Motion to Change (Form 15) you received."},{"id":"court_file_number","label":"Court File Number","type":"text","required":true,"autoFill":"court_file_number","placeholder":"e.g. FC-12345-24","hint":"Copy the court file number exactly from the Motion to Change you received."}]},{"step":2,"title":"Applicant (Moving Party) Information","description":"Enter the name and contact details of the person who filed the Motion to Change against you.","fields":[{"id":"applicant_full_name","label":"Applicant (Moving Party) — Full Legal Name","type":"text","required":true,"autoFill":"applicant_full_name","placeholder":"e.g. Jane Elizabeth Smith","hint":"This is the person who filed the Motion to Change. Copy the name from the form you received."},{"id":"applicant_address","label":"Applicant — Address for Service","type":"text","required":true,"placeholder":"Street & number, city, province, postal code"},{"id":"applicant_phone","label":"Applicant — Phone & Fax","type":"tel","required":false,"placeholder":"e.g. 416-555-0100"},{"id":"applicant_email","label":"Applicant — Email","type":"email","required":false,"placeholder":"e.g. jane.smith@email.com"},{"id":"applicant_lawyer","label":"Applicant's Lawyer — Name, Address & Contact (if any)","type":"textarea","required":false,"rows":3,"placeholder":"Lawyer name, firm, address, phone, fax, email","hint":"Leave blank if the applicant is self-represented."}]},{"step":3,"title":"Respondent (Your) Information","description":"Enter your name and contact details as the responding party.","fields":[{"id":"respondent_full_name","label":"Respondent (You) — Full Legal Name","type":"text","required":true,"autoFill":"respondent_full_name","placeholder":"e.g. John Robert Smith","hint":"Your full legal name."},{"id":"respondent_address","label":"Respondent — Address for Service","type":"text","required":true,"autoFill":"user_address","placeholder":"Street & number, city, province, postal code"},{"id":"respondent_phone","label":"Respondent — Phone & Fax","type":"tel","required":false,"autoFill":"user_phone","placeholder":"e.g. 705-555-0200"},{"id":"respondent_email","label":"Respondent — Email","type":"email","required":false,"autoFill":"user_email","placeholder":"e.g. john.smith@email.com"},{"id":"respondent_lawyer","label":"Respondent's Lawyer — Name, Address & Contact (if any)","type":"textarea","required":false,"rows":3,"placeholder":"Lawyer name, firm, address, phone, fax, email","hint":"Leave blank if you are self-represented."}]},{"step":4,"title":"Part A — Your Basic Information","description":"Confirm your role and provide basic information about your response.","fields":[{"id":"respondent_municipality","label":"Municipality and Province Where You Live","type":"text","required":true,"placeholder":"e.g. Sudbury, Ontario","hint":"State the city or town and province where you currently reside."},{"id":"interjurisdictional_request","label":"Are you requesting to convert this motion to change support from s.17 to s.18.1 of the Divorce Act?","type":"radio","required":true,"options":[{"value":"no","label":"No"},{"value":"yes","label":"Yes — I live outside Ontario and this motion includes support claims under the Divorce Act"}],"hint":"This option is only available if you live outside Ontario and the motion involves support under the Divorce Act. If you are unsure, choose No."},{"id":"agreed_paragraphs","label":"I agree with the following claims made by the requesting party (list paragraph numbers from Form 15 that you agree with, e.g. 11(a), 11(b))","type":"textarea","required":false,"rows":3,"placeholder":"e.g. Paragraph 11(a), 11(c)","hint":"Look at paragraph 11 of the Motion to Change (Form 15) you received. List the items you agree with. Leave blank if you disagree with everything."},{"id":"disagreed_paragraphs","label":"I disagree with the following claims (list paragraph numbers from Form 15 that you disagree with)","type":"textarea","required":false,"rows":3,"placeholder":"e.g. Paragraph 11(b), 11(d), 11(e)","hint":"List the items you do not agree with. If you disagree with everything, you can write 'All claims in paragraph 11'."},{"id":"reason_for_disagreement","label":"I disagree with the claims because (briefly explain why you do not think the current order or agreement should be changed):","type":"textarea","required":true,"rows":5,"placeholder":"e.g. The existing order was made based on my income at the time. My income has not changed significantly, and the current arrangement continues to be in the best interests of the children...","hint":"Be specific. Explain what has NOT changed, or why the other party's reasons for change are not valid."},{"id":"factual_disagreements","label":"I also disagree with the following facts in the Motion to Change (Form 15) (explain what information you do not agree with and why):","type":"textarea","required":false,"rows":4,"placeholder":"e.g. Paragraph 7 states that my income has increased to $90,000. This is incorrect — my current annual income is $72,000 as shown in my attached financial statement.","hint":"Point out specific statements in the other party's Form 15 that are factually wrong."},{"id":"dismiss_request","label":"I am asking that the motion to change (except the parts I agree with) be dismissed with costs.","type":"checkbox","required":false,"hint":"Check this if you want the court to dismiss the motion and require the other party to pay your legal costs."}]},{"step":5,"title":"Part A — Support Information (if applicable)","description":"Complete this section only if the motion to change includes a request to change child or spousal support.","fields":[{"id":"support_involved","label":"Does this motion to change include support?","type":"radio","required":true,"options":[{"value":"no","label":"No — this motion does not involve child or spousal support"},{"value":"yes","label":"Yes — child support, spousal support, or both are included"}]},{"id":"support_role","label":"In relation to the support order, I am the:","type":"radio","required":false,"showIf":{"field":"support_involved","value":"yes"},"options":[{"value":"payor","label":"Support payor (I pay support)"},{"value":"recipient","label":"Support recipient (I receive support)"}]},{"id":"assignment_status","label":"Confirmation of assignment","type":"radio","required":false,"showIf":{"field":"support_involved","value":"yes"},"options":[{"value":"not_assigned","label":"The order has NOT been assigned to a government agency"},{"value":"assigned","label":"The order HAS been assigned to a government agency (I must serve a copy on the agency)"}],"hint":"You must attach the confirmation of assignment form from the Ontario Ministry of Children, Community and Social Services showing the assignment status."},{"id":"recalculation_notice","label":"Has a Notice of Recalculation been issued by the online Child Support Service since the order or agreement was made?","type":"radio","required":false,"showIf":{"field":"support_involved","value":"yes"},"options":[{"value":"no","label":"No"},{"value":"yes","label":"Yes — I have attached the Notice of Recalculation (include the date below)"}]},{"id":"recalculation_date","label":"Date of the Notice of Recalculation","type":"date","required":false,"showIf":{"field":"recalculation_notice","value":"yes"}}]},{"step":6,"title":"Part B — Changes You Are Asking For","description":"Complete this section only if you want to ask the court for your own changes, in addition to or instead of the other party's requests. Skip this section if you are only asking to dismiss the other party's motion.","fields":[{"id":"requesting_own_changes","label":"Are you asking the court to make changes of your own (in addition to or different from the other party's request)?","type":"radio","required":true,"options":[{"value":"no","label":"No — I only want the other party's motion dismissed"},{"value":"yes","label":"Yes — I am also asking for changes"}]},{"id":"changes_requested","label":"I want to change the following (check all that apply):","type":"checkboxgroup","required":false,"showIf":{"field":"requesting_own_changes","value":"yes"},"options":[{"value":"decision_making","label":"Decision-making responsibility (formerly called custody)"},{"value":"parenting_time","label":"Parenting time (formerly called access)"},{"value":"contact","label":"Contact with a child"},{"value":"child_support_table","label":"Child support — table amount"},{"value":"child_support_expenses","label":"Child support — special or extraordinary expenses"},{"value":"spousal_support","label":"Spousal support"},{"value":"other","label":"Other (describe below)"}]},{"id":"changes_other_description","label":"If you selected 'Other', describe the change:","type":"textarea","required":false,"rows":3,"showIf":{"field":"requesting_own_changes","value":"yes"},"placeholder":"Describe any other change you are requesting"},{"id":"specific_terms_to_change","label":"Specific terms of the existing order or agreement you want changed (provide the paragraph number and the exact wording as it appears in the order or agreement):","type":"textarea","required":false,"rows":6,"showIf":{"field":"requesting_own_changes","value":"yes"},"placeholder":"e.g. Paragraph 3 of the Order dated June 1, 2022 states: 'The Respondent shall pay child support in the amount of $800 per month.' I am asking that this be changed to $600 per month effective...","hint":"Copy the paragraph number and wording exactly from the existing order or agreement, then explain what you want it changed to."}]},{"step":7,"title":"Part C — Why You Want the Changes","description":"Provide the facts that explain why the court should make the changes you are asking for. You may complete this section OR attach a separate affidavit (Form 14A).","fields":[{"id":"evidence_method","label":"How will you provide your evidence?","type":"radio","required":true,"options":[{"value":"this_form","label":"I will provide my evidence in this form (complete below)"},{"value":"affidavit","label":"I will attach a separate Affidavit (Form 14A) with my evidence"}],"hint":"Both options are acceptable. An affidavit may be clearer if your situation is complex."},{"id":"order_compliance","label":"Are you and the other party following the current order or agreement?","type":"radio","required":false,"showIf":{"field":"evidence_method","value":"this_form"},"options":[{"value":"yes","label":"Yes — both parties are complying with the current order"},{"value":"no","label":"No — give details below"}]},{"id":"order_compliance_details","label":"Describe how the order is not being followed:","type":"textarea","required":false,"rows":4,"showIf":{"field":"order_compliance","value":"no"},"placeholder":"e.g. The applicant has failed to make support payments since January 2025. The arrears now total approximately $4,800."},{"id":"facts_for_change","label":"Briefly describe the facts that show why the court should change the order or agreement, including how your situation has changed since it was made:","type":"textarea","required":false,"rows":8,"showIf":{"field":"evidence_method","value":"this_form"},"placeholder":"e.g. Since the existing order was made in 2022, I have experienced a significant reduction in income due to a job loss. I am currently employed part-time earning $42,000 per year, compared to $78,000 at the time of the original order. This change in circumstances makes the current support amount unaffordable...","hint":"Be specific — include dates, amounts, and what has changed. The more detail you provide, the stronger your case."}]},{"step":8,"title":"Part D — Additional Information for Support Cases","description":"Complete this section only if you are asking to change child support or spousal support.","fields":[{"id":"support_change_requested","label":"Are you asking to change child support or spousal support in Part B?","type":"radio","required":true,"options":[{"value":"no","label":"No — skip this section"},{"value":"yes","label":"Yes — I am asking to change support"}]},{"id":"support_currently_owed","label":"Is support owed under the current order or agreement?","type":"radio","required":false,"showIf":{"field":"support_change_requested","value":"yes"},"options":[{"value":"no","label":"No support is currently owed"},{"value":"yes","label":"Yes — support arrears exist"}]},{"id":"support_arrears_amount","label":"Amount of support arrears currently owing ($):","type":"currency","required":false,"showIf":{"field":"support_currently_owed","value":"yes"},"placeholder":"0.00"},{"id":"support_change_start","label":"When do you want the change in support to start?","type":"radio","required":false,"showIf":{"field":"support_change_requested","value":"yes"},"options":[{"value":"today","label":"Today"},{"value":"before_today","label":"Before today (give the exact date below)"}]},{"id":"support_retroactive_date","label":"Retroactive start date for support change:","type":"date","required":false,"showIf":{"field":"support_change_start","value":"before_today"},"hint":"If you are asking for a retroactive change, you must answer the questions below."},{"id":"retroactive_first_request_date","label":"What date did you first ask the other party for updated income information or to change support?","type":"date","required":false,"showIf":{"field":"support_change_start","value":"before_today"}},{"id":"retroactive_obstruction","label":"Did the other party do anything to make it difficult for you to know if support should change?","type":"radio","required":false,"showIf":{"field":"support_change_start","value":"before_today"},"options":[{"value":"no","label":"No"},{"value":"yes","label":"Yes — describe below"}]},{"id":"retroactive_obstruction_details","label":"Describe what the other party did to obstruct your knowledge of whether support should change:","type":"textarea","required":false,"rows":3,"showIf":{"field":"retroactive_obstruction","value":"yes"},"placeholder":"e.g. The other party refused to provide their income information when I requested it in March 2024..."},{"id":"retroactive_delay_reason","label":"Why didn't you ask the court to change support sooner?","type":"textarea","required":false,"rows":3,"showIf":{"field":"support_change_start","value":"before_today"},"placeholder":"e.g. I was unaware that the other party's income had increased significantly until I received their financial disclosure in this motion..."},{"id":"retroactive_circumstances","label":"Describe your circumstances and the child's circumstances that support this retroactive request:","type":"textarea","required":false,"rows":4,"showIf":{"field":"support_change_start","value":"before_today"},"placeholder":"e.g. During the period in question, my income was significantly lower than the other party's. The child was living primarily with me and I was covering all day-to-day expenses without adequate support..."}]},{"step":9,"title":"Respondent's Certificate & Declaration","description":"Confirm your duties and sign before a commissioner of oaths.","fields":[{"id":"duties_info","label":"Your Legal Duties","type":"info","content":"Sections 7.1 to 7.5 of the Divorce Act and section 33.1 of the Children's Law Reform Act require you to:\n\n• Exercise decision-making responsibility, parenting time, or contact in a manner consistent with the child's best interests\n• Protect the child from conflict arising from this case, to the best of your ability\n• Try to resolve family law issues using out-of-court dispute resolution options, if appropriate\n• Provide complete, accurate, and up-to-date information\n• Comply with any orders made in this case"},{"id":"duties_acknowledged","label":"I certify that I am aware of my duties under the Divorce Act and the Children's Law Reform Act.","type":"checkbox","required":true},{"id":"swear_or_affirm","label":"Will you swear (religious oath) or affirm (non-religious, solemn promise)?","type":"radio","required":true,"options":[{"value":"swear","label":"Swear — I will take a religious oath"},{"value":"affirm","label":"Affirm — I will make a solemn non-religious promise"}]},{"id":"signing_municipality","label":"Municipality Where You Will Sign This Form","type":"text","required":true,"placeholder":"e.g. Sudbury, Ontario","hint":"You must sign this form in front of a lawyer, notary public, or commissioner for taking affidavits. The commissioner will complete the date."},{"id":"commissioner_reminder","label":"Important: Commissioner of Oaths","type":"info","content":"You must sign this form in front of a commissioner for taking affidavits (such as a lawyer, notary public, or court clerk). Do not sign it until you are in front of the commissioner. If you are asking to change support, you must also attach a completed Financial Statement (Form 13 or Form 13.1)."},{"id":"financial_statement_attached","label":"I have attached (or will attach) a completed Financial Statement (Form 13 or 13.1) as required.","type":"checkbox","required":false,"hint":"Required if you or the other party is asking to change child support or spousal support."},{"id":"signature_confirmation","label":"I confirm that everything stated in this Response to Motion to Change is true, and I understand that making a false statement is an offence under the Criminal Code of Canada.","type":"checkbox","required":true},{"id":"hearth_page_notice","label":"Hearth & Page Notice","type":"info","content":"This form was prepared using Hearth & Page (hearthandpage.ca). You must serve a copy on the moving party and file this form with the court within 30 days of being served (or 60 days if you live outside Canada or the US). File your Form 6B (Affidavit of Service) at the same time. Hearth & Page is not a law firm and does not provide legal advice."}]}]};
  window.__hp_formDefs['ON-F14C'] = {"pdfFileName":"form14c.pdf","formCode":"form14c-confirmation-motion","formNumber":"Form 14C","title":"Confirmation of Motion","jurisdiction":"Ontario","act":"Family Law Rules","version":"September 2024","description":"Filed to confirm that your motion is going ahead and that you will attend the hearing. Must be filed by 2:00 PM at least 3 business days before your motion date. If you miss this deadline, your motion may be cancelled. You must also give a copy to the other party before filing with the court.","steps":[{"step":1,"title":"Court & File Information","description":"Enter the court location and file number.","fields":[{"id":"courthouse","label":"Courthouse","type":"select","required":true,"autoFill":"courthouse","options":["Barrie","Belleville","Brampton","Brantford","Brockville","Chatham","Cobourg","Cornwall","Guelph","Hamilton","Kingston","Kitchener","L'Orignal","Lindsay","London","Milton","Newmarket","North Bay","Oshawa","Ottawa","Owen Sound","Pembroke","Perth","Peterborough","Sarnia","Sault Ste. Marie","Simcoe","St. Catharines","St. Thomas","Sudbury","Thunder Bay","Timmins","Toronto (Ontario Court of Justice)","Toronto (Superior Court of Justice — 393 University)","Toronto (Superior Court of Justice — 47 Sheppard)","Welland","Windsor","Woodstock"]},{"id":"court_file_number","label":"Court File Number","type":"text","required":true,"autoFill":"court_file_number","placeholder":"e.g. FC-12345-24"},{"id":"case_management_judge","label":"Case Management Judge (if any)","type":"text","required":false,"placeholder":"e.g. The Honourable Justice A. Lee","hint":"If a case management judge has been assigned to your case, enter their name here. Leave blank if none."}]},{"step":2,"title":"Applicant & Respondent","description":"Enter the party names.","fields":[{"id":"applicant_full_name","label":"Applicant — Full Legal Name","type":"text","required":true,"autoFill":"applicant_full_name","placeholder":"e.g. Jane Elizabeth Smith"},{"id":"respondent_full_name","label":"Respondent — Full Legal Name","type":"text","required":true,"autoFill":"respondent_full_name","placeholder":"e.g. John Robert Smith"}]},{"step":3,"title":"Who Is Filing This Confirmation","description":"Identify yourself and whether you have spoken with the other party.","fields":[{"id":"filer_role","label":"My name is (full legal name) and I am:","type":"radio","required":true,"options":[{"value":"lawyer_applicant","label":"The lawyer for the applicant"},{"value":"lawyer_respondent","label":"The lawyer for the respondent"},{"value":"self_applicant","label":"The applicant (self-represented)"},{"value":"self_respondent","label":"The respondent (self-represented)"},{"value":"other","label":"Other party (specify below)"}]},{"id":"filer_name","label":"Your Full Legal Name","type":"text","required":true,"autoFill":"applicant_full_name","placeholder":"e.g. Jane Elizabeth Smith","hint":"Enter the name of the person or lawyer filing this form."},{"id":"filer_other_description","label":"If 'Other', describe your role:","type":"text","required":false,"showIf":{"field":"filer_role","value":"other"},"placeholder":"e.g. Intervenor"},{"id":"conferred_with_other_party","label":"Have you conferred with the opposing counsel or party about the issues, motion material, and time estimates?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes — we have conferred"},{"value":"no","label":"No — provide reasons below"}],"hint":"The Family Law Rules require the parties or their counsel to confer, or attempt to confer, orally or in writing before filing this confirmation."},{"id":"confer_reason_not","label":"Reason for not conferring with the other party:","type":"textarea","required":false,"rows":3,"showIf":{"field":"conferred_with_other_party","value":"no"},"placeholder":"e.g. I attempted to reach the other party by phone and email on [date] but received no response. / A restraining order prohibits direct communication.","hint":"Provide a specific reason. If there is a court order prohibiting communication, state that here."}]},{"step":4,"title":"Motion Status","description":"Tell the court what is happening with your motion.","fields":[{"id":"motion_date","label":"Scheduled Date of Motion","type":"date","required":true,"hint":"The date the motion is scheduled to be heard, as shown on your Notice of Motion (Form 14)."},{"id":"motion_time","label":"Scheduled Time of Motion","type":"text","required":true,"placeholder":"e.g. 9:30 AM","hint":"The time the motion is scheduled, as shown on your Notice of Motion (Form 14)."},{"id":"case_conference_held","label":"Has a case conference been held in this case?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes — a case conference was held"},{"value":"no_exception","label":"No — but an exception applies (describe below)"},{"value":"not_required","label":"Not required for this type of motion"}],"hint":"Generally, a case conference must be held before a motion can be heard, unless the motion is urgent or the court grants an exception."},{"id":"case_conference_exception","label":"Describe why no case conference was held:","type":"textarea","required":false,"rows":3,"showIf":{"field":"case_conference_held","value":"no_exception"},"placeholder":"e.g. This is an urgent motion for a temporary restraining order. / The court granted leave to bring this motion without a prior conference by order dated [date]."},{"id":"motion_status","label":"This matter is:","type":"radio","required":true,"options":[{"value":"going_ahead_listed_issues","label":"Going ahead on the issues listed below"},{"value":"going_ahead_consent_order","label":"Going ahead for a consent order"},{"value":"adjourned_on_consent","label":"Being adjourned on consent to a future date"},{"value":"going_ahead_contested_adjournment","label":"Going ahead for a contested adjournment asked for by one party"},{"value":"other","label":"Other (explain below)"}]},{"id":"adjournment_date","label":"Adjourned to (date):","type":"date","required":false,"showIf":{"field":"motion_status","value":"adjourned_on_consent"},"hint":"Enter the agreed-upon adjournment date."},{"id":"adjournment_event_type","label":"Adjourned for what type of event?","type":"text","required":false,"showIf":{"field":"motion_status","value":"adjourned_on_consent"},"placeholder":"e.g. settlement conference, trial management conference"},{"id":"contested_adjournment_party","label":"Name of party asking for the contested adjournment:","type":"text","required":false,"showIf":{"field":"motion_status","value":"going_ahead_contested_adjournment"},"placeholder":"e.g. the Applicant, Jane Smith"},{"id":"contested_adjournment_reason","label":"Reason for the contested adjournment request:","type":"textarea","required":false,"rows":3,"showIf":{"field":"motion_status","value":"going_ahead_contested_adjournment"},"placeholder":"e.g. The applicant is requesting an adjournment due to a medical appointment on the scheduled date."},{"id":"motion_status_other","label":"Describe what is happening:","type":"textarea","required":false,"rows":3,"showIf":{"field":"motion_status","value":"other"},"placeholder":"Describe the current status of the motion."}]},{"step":5,"title":"Issues, Documents & Time Estimate","description":"List the issues, documents for the judge, and how much time you need.","fields":[{"id":"issues_going_ahead","label":"Issues going ahead at this motion (list each issue):","type":"textarea","required":true,"rows":5,"placeholder":"e.g.\na) Temporary decision-making responsibility for the child Emma Smith\nb) Temporary parenting time schedule\nc) Temporary child support in the amount of $X per month","hint":"List every issue the judge will be deciding at this motion. Be specific — include the type of order and the child's name where applicable."},{"id":"documents_for_judge","label":"Documents the judge should read (list each document, volume, and tab number in the Continuing Record):","type":"textarea","required":true,"rows":6,"placeholder":"e.g.\na) Notice of Motion (Form 14) — Volume 1, Tab A\nb) Affidavit of Jane Smith sworn June 15, 2025 (Form 14A) — Volume 1, Tab B\nc) Financial Statement of Jane Smith (Form 13) — Volume 2, Tab C\nd) Affidavit of Service (Form 6B) — Volume 1, Tab D","hint":"Organize by volume and tab as they appear in the Continuing Record. The judge uses this list to locate your materials quickly."},{"id":"documents_to_bring","label":"I confirm that I will bring a complete copy of the Continuing Record to the motion.","type":"checkbox","required":true},{"id":"presiding_judge","label":"The presiding judge will be (if known):","type":"text","required":false,"placeholder":"e.g. The Honourable Justice A. Lee","hint":"Leave blank if you do not know who will hear the motion."},{"id":"time_estimate_applicant","label":"Time estimate — Applicant (minutes):","type":"number","required":true,"placeholder":"e.g. 20","hint":"Estimate how many minutes the applicant (or their lawyer) will need to present arguments."},{"id":"time_estimate_respondent","label":"Time estimate — Respondent (minutes):","type":"number","required":true,"placeholder":"e.g. 20","hint":"Estimate how many minutes the respondent (or their lawyer) will need."},{"id":"time_estimate_reply","label":"Time estimate — Reply (minutes, if any):","type":"number","required":false,"placeholder":"e.g. 5","hint":"Estimate any additional time needed for reply submissions. Often 0 or 5 minutes."}]},{"step":6,"title":"Delivery & Deadline Reminder","description":"Confirm you have given a copy to the other party and understand the filing deadline.","fields":[{"id":"deadline_info","label":"Filing Deadline — Important","type":"info","content":"You must file this Confirmation of Motion with the court no later than 2:00 PM, at least 3 business days before your motion date.\n\nIf you miss this deadline, your motion may be cancelled and you will have to get a new date.\n\nYou can file this form:\n• In person at the courthouse\n• By email (if your court allows it) through Justice Services Online\n\nNote: Courts no longer accept this form by fax."},{"id":"copy_given_to_other_party","label":"I confirm that I have given (or will give) a copy of this Confirmation to the other party or their lawyer before filing it with the court.","type":"checkbox","required":true,"hint":"The Family Law Rules require you to deliver a copy to the other side before filing. You do NOT need to file a Form 6B (Affidavit of Service) for this particular form."},{"id":"signature_date","label":"Date of Signature","type":"date","required":true,"hint":"Enter the date you are signing this confirmation."},{"id":"signature_confirmation","label":"I confirm that all information in this Confirmation of Motion is accurate.","type":"checkbox","required":true},{"id":"hearth_page_notice","label":"Hearth & Page Notice","type":"info","content":"This form was prepared using Hearth & Page (hearthandpage.ca). File it with the court no later than 2:00 PM, 3 business days before your motion date. Give the other party a copy first. Hearth & Page is not a law firm and does not provide legal advice."}]}]};

  window.__hp_formDefs['ON-F17F'] = {"pdfFileName":"form17f.pdf","formCode":"form17f-confirmation-conference","formNumber":"Form 17F","title":"Confirmation of Conference","jurisdiction":"Ontario","act":"Family Law Rules, O. Reg. 114/99, Rule 17(14)","version":"September 24, 2024","urgencyFlag":{"enabled":true,"deadlineRule":"2:00 PM, 3 business days before conference date (weekends and statutory holidays excluded)","deadlineHours":null,"triggerField":"conference_date","messages":{"critical":"\u26a0\ufe0f URGENT \u2014 Your conference confirmation is due TODAY by 2:00 PM. File immediately at the courthouse or through Justice Services Online. If missed, your conference will be cancelled.","warning":"Your conference is coming up. This confirmation must be filed by 2:00 PM, 3 business days before the conference date. File it now to avoid cancellation.","reminder":"Reminder: You need to file this confirmation at least 3 business days before your conference. Give the other party a copy first."},"cancellationWarning":"Under Rule 17(14.1), the court SHALL cancel your conference if this form is not filed on time \u2014 unless the court orders otherwise. There is no grace period.","bannerThresholds":{"note":"Thresholds are hours remaining until the CALCULATED deadline (not until conference). FormEngine must compute deadline = conferenceDate - 3 business days at 14:00, then compare datetime.now() to deadline.","critical":{"hours_to_deadline":24,"message":"\u26a0\ufe0f URGENT \u2014 Your filing deadline is TODAY by 2:00 PM. File immediately or your conference will be automatically cancelled."},"warning":{"hours_to_deadline":72,"message":"Your filing deadline is {deadline_date} at 2:00 PM. File soon \u2014 missing this deadline cancels your conference automatically."},"info":{"hours_to_deadline":120,"message":"Reminder: File by 2:00 PM on {deadline_date} \u2014 3 business days before your conference."},"ok":{"hours_to_deadline":9999,"message":"Your filing deadline is {deadline_date}. You have time \u2014 don't forget."}},"deadlineNote":"Rule 17(14)(c) says 'three days' \u2014 courts consistently interpret this as three business days (excluding weekends and Ontario statutory holidays), confirmed by the Ontario Courts website, Steps to Justice, and all regional Practice Directions."},"description":"Filed to confirm that you will attend an upcoming case conference, settlement conference, or trial management conference. Must be filed by 2:00 PM at least 3 business days before the conference date. Give the other party a copy BEFORE filing with the court. If you miss this deadline, your conference will be cancelled automatically.","autoFillSources":["courthouse","court_file_number","applicant_full_name","respondent_full_name"],"steps":[{"stepId":1,"title":"Court & File Information","description":"Enter the court location, file number, and conference details.","fields":[{"id":"courthouse","label":"Name of Court","type":"select","required":true,"autoFill":"courthouse","hint":"Select the courthouse where your conference is scheduled.","options":["Ontario Court of Justice \u2014 Barrie","Ontario Court of Justice \u2014 Belleville","Ontario Court of Justice \u2014 Brampton","Ontario Court of Justice \u2014 Brantford","Ontario Court of Justice \u2014 Brockville","Ontario Court of Justice \u2014 Chatham","Ontario Court of Justice \u2014 Cobourg","Ontario Court of Justice \u2014 Cornwall","Ontario Court of Justice \u2014 Guelph","Ontario Court of Justice \u2014 Hamilton","Ontario Court of Justice \u2014 Kingston","Ontario Court of Justice \u2014 Kitchener","Ontario Court of Justice \u2014 Lindsay","Ontario Court of Justice \u2014 London","Ontario Court of Justice \u2014 Milton","Ontario Court of Justice \u2014 Newmarket","Ontario Court of Justice \u2014 North Bay","Ontario Court of Justice \u2014 Oshawa","Ontario Court of Justice \u2014 Ottawa","Ontario Court of Justice \u2014 Owen Sound","Ontario Court of Justice \u2014 Pembroke","Ontario Court of Justice \u2014 Perth","Ontario Court of Justice \u2014 Peterborough","Ontario Court of Justice \u2014 Sarnia","Ontario Court of Justice \u2014 Sault Ste. Marie","Ontario Court of Justice \u2014 Simcoe","Ontario Court of Justice \u2014 St. Catharines","Ontario Court of Justice \u2014 St. Thomas","Ontario Court of Justice \u2014 Sudbury","Ontario Court of Justice \u2014 Thunder Bay","Ontario Court of Justice \u2014 Timmins","Ontario Court of Justice \u2014 Toronto","Ontario Court of Justice \u2014 Welland","Ontario Court of Justice \u2014 Windsor","Ontario Court of Justice \u2014 Woodstock","Superior Court of Justice \u2014 Barrie","Superior Court of Justice \u2014 Brampton","Superior Court of Justice \u2014 Hamilton","Superior Court of Justice \u2014 Kingston","Superior Court of Justice \u2014 London","Superior Court of Justice \u2014 Milton","Superior Court of Justice \u2014 Newmarket","Superior Court of Justice \u2014 North Bay","Superior Court of Justice \u2014 Oshawa","Superior Court of Justice \u2014 Ottawa","Superior Court of Justice \u2014 St. Catharines","Superior Court of Justice \u2014 Sudbury","Superior Court of Justice \u2014 Thunder Bay","Superior Court of Justice \u2014 Toronto (393 University Ave.)","Superior Court of Justice \u2014 Toronto (47 Sheppard Ave.)","Superior Court of Justice \u2014 Windsor"]},{"id":"court_office_address","label":"Court Office Address","type":"text","required":true,"autoFill":"court_office_address","placeholder":"e.g. 393 University Avenue, Toronto, ON M5G 1E6"},{"id":"court_file_number","label":"Court File Number","type":"text","required":true,"autoFill":"court_file_number","placeholder":"e.g. FC-12345-24","validation":{"pattern":"^[A-Za-z0-9\\-/]+$","message":"Enter the file number exactly as it appears on your court documents."}}]},{"stepId":2,"title":"Applicant & Respondent","description":"Enter the full legal names and contact details for both parties.","fields":[{"id":"applicant_full_name","label":"Applicant \u2014 Full Legal Name","type":"text","required":true,"autoFill":"applicant_full_name","placeholder":"e.g. Jane Elizabeth Smith"},{"id":"applicant_address","label":"Applicant \u2014 Address for Service (street, city, postal code)","type":"text","required":true,"autoFill":"applicant_address","placeholder":"e.g. 123 Main Street, Toronto, ON M1A 1A1"},{"id":"applicant_phone","label":"Applicant \u2014 Telephone Number","type":"tel","required":true,"autoFill":"applicant_phone","placeholder":"e.g. 416-555-0100","validation":{"pattern":"^[\\d\\s\\-\\(\\)\\+]+$","minLength":10,"message":"Enter a valid telephone number including area code."}},{"id":"applicant_fax","label":"Applicant \u2014 Fax Number (if any)","type":"tel","required":false,"placeholder":"e.g. 416-555-0101"},{"id":"applicant_email","label":"Applicant \u2014 Email Address (if any)","type":"email","required":false,"autoFill":"applicant_email","placeholder":"e.g. jane.smith@email.com"},{"id":"applicant_lawyer","label":"Applicant's Lawyer (name, address, phone) \u2014 if applicable","type":"textarea","required":false,"rows":3,"placeholder":"e.g. A. Jones, 456 Bay Street, Toronto, ON M5H 1A1, 416-555-0200\nLeave blank if self-represented."},{"id":"respondent_full_name","label":"Respondent \u2014 Full Legal Name","type":"text","required":true,"autoFill":"respondent_full_name","placeholder":"e.g. John Robert Smith"},{"id":"respondent_address","label":"Respondent \u2014 Address for Service (street, city, postal code)","type":"text","required":true,"autoFill":"respondent_address","placeholder":"e.g. 789 Queen Street, Toronto, ON M5H 2N2"},{"id":"respondent_phone","label":"Respondent \u2014 Telephone Number","type":"tel","required":false,"placeholder":"e.g. 416-555-0300"},{"id":"respondent_email","label":"Respondent \u2014 Email Address (if any)","type":"email","required":false,"placeholder":"e.g. john.smith@email.com"},{"id":"respondent_lawyer","label":"Respondent's Lawyer (name, address, phone) \u2014 if applicable","type":"textarea","required":false,"rows":3,"placeholder":"Leave blank if respondent is self-represented or if unknown."}]},{"stepId":3,"title":"Who Is Filing + Conferring","description":"Identify yourself and confirm whether you conferred with the other party as required.","fields":[{"id":"filer_name","label":"My full legal name is:","type":"text","required":true,"autoFill":"applicant_full_name","placeholder":"e.g. Jane Elizabeth Smith"},{"id":"filer_role","label":"I am:","type":"radio","required":true,"options":[{"value":"lawyer_applicant","label":"The lawyer for the applicant"},{"value":"lawyer_respondent","label":"The lawyer for the respondent"},{"value":"self_applicant","label":"The applicant (self-represented)"},{"value":"self_respondent","label":"The respondent (self-represented)"}]},{"id":"conferred_info","label":"Filing Requirement \u2014 Conferring","type":"info","content":"The Family Law Rules (Rule 17(3.1)) require you to discuss the following with the other party (or their lawyer) before filing this form:\n\na) Requests for financial disclosure\nb) A temporary resolution of the outstanding issues in dispute\nc) For a settlement conference or trial management conference: a final resolution of the issues in dispute\n\nThis can be done by phone, email, or in writing.\n\nExceptions \u2014 you do NOT have to confer if:\n\u2022 A court order prohibits you from communicating with the other party, OR\n\u2022 There is a risk of domestic violence and the other party does not have a lawyer\n\n(Rule 17(3.2))"},{"id":"conferred_yn","label":"Have you conferred (or made best efforts to confer) with the other party about: (a) financial disclosure requests, (b) temporary resolution of issues, and (c) for settlement/TMC: final resolution of issues?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 we have conferred (or attempted to confer) on all required matters"},{"value":"no","label":"No \u2014 I was unable to confer (explain below)"}]},{"id":"confer_reason_not","label":"Reason for not conferring:","type":"textarea","required":false,"rows":4,"showIf":{"field":"conferred_yn","value":"no"},"placeholder":"e.g. A restraining order prohibits direct communication between the parties.\ne.g. There is a risk of domestic violence and the other party does not have a lawyer (Rule 17(3.2)(b)).\ne.g. I attempted to contact the respondent by email on [date] and by phone on [date] but received no response.","hint":"Be specific. The court may make a cost order against a party who fails to confer without good reason."},{"id":"costs_discussed","label":"I confirm that the parties have discussed costs.","type":"checkbox","required":true,"hint":"Field 9 on Form 17F requires confirmation that costs have been discussed. This is mandatory."}]},{"stepId":4,"title":"Conference Date & Type","description":"Enter the date, time, and type of conference. This triggers the deadline urgency check.","urgencyTrigger":true,"fields":[{"id":"conference_type","label":"This is a:","type":"radio","required":true,"options":[{"value":"case_conference","label":"Case Conference"},{"value":"settlement_conference","label":"Settlement Conference"},{"value":"trial_management_conference","label":"Trial Management Conference"}],"hint":"Select the type of conference exactly as it appears in your court notice or order."},{"id":"conference_date","label":"Scheduled Date of Conference","type":"date","required":true,"urgencyFlag":true,"deadlineBusinessDaysBefore":3,"deadlineTime":"14:00","hint":"Enter the date your conference is scheduled. We will automatically calculate your filing deadline (2:00 PM, 3 business days before this date) and alert you if you are running short on time.","validation":{"minDate":"today","message":"Conference date must be in the future."}},{"id":"conference_time","label":"Scheduled Time of Conference","type":"text","required":true,"placeholder":"e.g. 9:30 AM","hint":"Enter the time the conference is scheduled to begin."},{"id":"case_management_judge","label":"Case Management Judge (if any)","type":"text","required":false,"autoFill":"case_management_judge","placeholder":"e.g. The Honourable Justice A. Lee","hint":"If a case management judge is assigned to your case, enter their name. Leave blank if none."},{"id":"deadline_urgency_banner","label":"Your Filing Deadline","type":"computed_deadline","sourceField":"conference_date","businessDaysBefore":3,"cutoffTime":"14:00","displayFormat":"Your confirmation must be filed by 2:00 PM on {deadline_date}.","required":false}]},{"stepId":5,"title":"Issues & Conference Brief","description":"List the issues for the conference and identify the documents the judge should read.","fields":[{"id":"issues_for_conference","label":"Issues to be discussed at this conference (list each one separately):","type":"textarea","required":true,"rows":7,"placeholder":"e.g.\na) Decision-making responsibility for Emma (age 6) and Liam (age 4)\nb) Parenting time schedule \u2014 week-on, week-off proposal\nc) Child support \u2014 table amount under Federal Child Support Guidelines\nd) Equalization of net family property\ne) Disclosure of financial documents","hint":"Be specific. List each issue separately with a letter (a, b, c...). Courts may refuse to discuss issues not listed here.","validation":{"minLength":20,"message":"You must list at least one issue for the conference."}},{"id":"conference_brief_filed","label":"Have you filed your Conference Brief (Form 17A for case conference / Form 17C for settlement conference / Form 17E for trial management conference)?","type":"radio","required":true,"options":[{"value":"yes","label":"Yes \u2014 brief already filed"},{"value":"filing_with_this","label":"No \u2014 I am filing the brief at the same time as this confirmation"},{"value":"no_tmc","label":"No brief required for this type of conference"}],"hint":"Conference briefs must be served and filed:\n\u2022 At least 6 days before (if you requested the conference, or are the applicant)\n\u2022 At least 4 days before (if the other party requested it, or you are the respondent)\n\nNote for Trial Management Conference in Superior Court of Justice: The required documents may not be Form 17E. Instead, the court may require a trial scheduling endorsement form, an offer to settle, and an opening statement outline. Check with the court office before filing. Form 17E applies to OCJ trial management conferences."},{"id":"materials_for_judge","label":"In addition to the conference brief, the presiding judge will be referred to the following pages/tabs (list with volume, tab, and page numbers):","type":"textarea","required":false,"rows":6,"placeholder":"e.g.\na) Financial Statement of Jane Smith (Form 13) \u2014 Volume 2, Tab C, page 45\nb) Affidavit of Jane Smith sworn June 10, 2025 \u2014 Volume 1, Tab B, page 12\nc) Applicant's Offer to Settle dated May 1, 2025 \u2014 Volume 3, Tab F","hint":"Use exact volume, tab, and page numbers from the Continuing Record. This helps the judge navigate your materials quickly."}]},{"stepId":6,"title":"Time Estimates","description":"Estimate how much time each party needs at the conference.","fields":[{"id":"time_estimate_applicant","label":"Time estimate \u2014 Applicant (minutes):","type":"number","required":true,"placeholder":"e.g. 30","min":5,"max":480,"hint":"How many minutes does the applicant (or their lawyer) need to present their position at the conference?","validation":{"min":5,"max":480,"message":"Enter a time between 5 and 480 minutes."}},{"id":"time_estimate_respondent","label":"Time estimate \u2014 Respondent (minutes):","type":"number","required":true,"placeholder":"e.g. 30","min":5,"max":480,"hint":"How many minutes does the respondent (or their lawyer) need?"},{"id":"time_estimate_total","label":"Total time estimate (auto-calculated)","type":"computed","formula":"time_estimate_applicant + time_estimate_respondent","required":false,"displayAs":"{total} minutes total","hint":"This is the combined estimate that will appear on the form. Confirm it is realistic \u2014 courts cancel conferences that run over time."},{"id":"time_estimate_note","label":"Any note about time estimates (optional):","type":"textarea","required":false,"rows":2,"placeholder":"e.g. Both parties are self-represented and may need additional guidance from the judge."}]},{"stepId":7,"title":"Delivery, Deadline & Signature","description":"Confirm delivery to the other party, acknowledge the deadline, and sign.","fields":[{"id":"deadline_final_warning","label":"Deadline Reminder","type":"info","content":"\u23f0 FILING DEADLINE: You must file this Confirmation with the court by 2:00 PM, at least 3 business days before your conference date.\n\nBusiness days exclude weekends and Ontario statutory holidays.\n\nExamples:\n\u2022 Conference on Monday \u2192 file by 2:00 PM the previous Wednesday\n\u2022 Conference on Thursday \u2192 file by 2:00 PM Monday of the same week\n\u2022 Conference on Friday \u2192 file by 2:00 PM Tuesday of the same week\n\nYou can file by:\n1. In person at the courthouse\n2. By email to the court office\n3. Through Justice Services Online (justice.gov.on.ca)\n4. Through the Ontario Courts Public Portal (ontariocourts.ca/apply) \u2014 whichever is available at your courthouse\n\nNote: Fax is no longer accepted for this form.\n\n(Rule 17(14)(c) as amended by O.Reg. 228/25)"},{"id":"copy_delivered_to_other_party","label":"I confirm that I have given (or will give before filing) a copy of this Confirmation to the other party or their lawyer.","type":"checkbox","required":true,"hint":"Under Rule 17(14)(b), you must deliver a copy to the other party before filing with the clerk. You do NOT need to file a Form 6B (Affidavit of Service) for this step.\n\nException: If your case is a child protection case under the Child, Youth and Family Services Act, 2017, you do NOT need to give the other party a copy before filing."},{"id":"accuracy_acknowledgment","label":"I confirm that all information in this Confirmation of Conference is accurate.","type":"checkbox","required":true},{"id":"update_if_incorrect","label":"I understand that if any information in this form becomes incorrect before the conference is held, I must immediately update the form and deliver the corrected version to the other party and the court clerk (as required by Rule 17(14.1.1)).","type":"checkbox","required":true,"hint":"This is a legal obligation under the Family Law Rules. If circumstances change \u2014 for example, a settlement conference settles some issues \u2014 you must file a corrected Form 17F right away."},{"id":"signature_date","label":"Date of Signature","type":"date","required":true,"hint":"Enter today's date."},{"id":"hearth_page_notice","label":"Hearth & Page Notice","type":"info","content":"This form was prepared using Hearth & Page (hearthandpage.ca). File it with the court by 2:00 PM, 3 business days before your conference date. Deliver a copy to the other party first. Hearth & Page is not a law firm and does not provide legal advice. This document was prepared on or by Hearth & Page."}]}],"pdfTemplate":{"pageSize":"letter","margins":{"top":25,"bottom":20,"left":20,"right":20},"header":{"courtName":"{{courthouse}}","courtAddress":"{{court_office_address}}","formNumber":"Form 17F: Confirmation of Conference","courtFileNumber":"{{court_file_number}}"},"sections":[{"label":"Applicant(s)","fields":["applicant_full_name","applicant_address","applicant_phone","applicant_fax","applicant_email","applicant_lawyer"]},{"label":"Respondent(s)","fields":["respondent_full_name","respondent_address","respondent_phone","respondent_email","respondent_lawyer"]},{"label":"1. My name is, and I am the","fields":["filer_name","filer_role"]},{"label":"2. I have conferred (or attempted to confer) with the other party on: (a) outstanding issues; (b) resolution; (c) conference materials; (d) time estimates","fields":["conferred_yn","confer_reason_not"]},{"label":"3. The scheduled conference type and date","fields":["conference_type","conference_date","conference_time","case_management_judge"]},{"label":"4\u20136. Issues for this conference","fields":["issues_for_conference"]},{"label":"7. Documents for the judge (in addition to the conference brief)","fields":["materials_for_judge"]},{"label":"8. Time estimates","fields":["time_estimate_applicant","time_estimate_respondent","time_estimate_total"]},{"label":"9. Costs discussed","fields":["costs_discussed"]},{"label":"10. I will update this form if the information changes","fields":["update_if_incorrect"]},{"label":"Signature","fields":["signature_date"]}],"footerText":"FLR 17F (September 24, 2024) \u2014 Prepared using Hearth & Page (hearthandpage.ca). This document was prepared on or by Hearth & Page.","signatureLine":true,"dateLineLabel":"Date of signature"},"validationRules":[{"ruleId":"DEADLINE_CHECK","type":"urgency_flag","triggerField":"conference_date","check":"conference_date minus 3 business days at 14:00","levels":[{"threshold_hours":72,"severity":"critical","banner":true,"blockSubmit":false},{"threshold_hours":120,"severity":"warning","banner":true,"blockSubmit":false},{"threshold_hours":168,"severity":"info","banner":false,"blockSubmit":false}]},{"ruleId":"ISSUES_NOT_EMPTY","type":"field_required","field":"issues_for_conference","message":"You must list at least one issue for the conference."},{"ruleId":"TIME_ESTIMATES_POSITIVE","type":"field_range","fields":["time_estimate_applicant","time_estimate_respondent"],"min":5,"message":"Time estimates must be at least 5 minutes each."},{"ruleId":"COPY_DELIVERY_REQUIRED","type":"checkbox_required","field":"copy_delivered_to_other_party","message":"You must confirm that you have given the other party a copy of this form before filing."},{"ruleId":"CONFER_REASON_IF_NO","type":"conditional_required","condition":{"field":"conferred_yn","value":"no"},"requiredField":"confer_reason_not","message":"You must explain why you were unable to confer with the other party."},{"ruleId":"COSTS_DISCUSSED","type":"checkbox_required","field":"costs_discussed","message":"You must confirm that the parties have discussed costs (Field 9 on Form 17F \u2014 required by Rule 17)."},{"ruleId":"ACCURACY_ACKNOWLEDGMENT","type":"checkbox_required","field":"accuracy_acknowledgment","message":"You must confirm that all information in this Confirmation is accurate."},{"ruleId":"UPDATE_ACKNOWLEDGMENT","type":"checkbox_required","field":"update_if_incorrect","message":"You must acknowledge your obligation to update this form if any information changes before the conference (Rule 17(14.1.1))."}]};
  window.__hp_formDefs['ON-F36B'] = {"pdfFileName":"form36b.pdf","formCode":"form36b-certificate-divorce","formNumber":"Form 36B","title":"Certificate of Divorce","jurisdiction":"Ontario","act":"Divorce Act, R.S.C. 1985, c. 3 (2nd Supp.); Family Law Rules, O. Reg. 114/99","version":"Current","description":"The Certificate of Divorce is the official proof that your marriage has been legally dissolved. It is issued by the court clerk after your divorce order has taken effect \u2014 which is 31 days after the judge signed the order, provided no appeal was filed. You will need this certificate to remarry, change your last name, update government records (CRA, passport, SIN), and for other legal purposes. You cannot receive this certificate until the 31-day waiting period has passed.","clerkIssuedNotice":{"enabled":true,"message":"Important: Form 36B is ISSUED by the court clerk, not completed entirely by you. Your role is to submit a request with accurate case details and pay the court fee ($25). The clerk then certifies and signs the form. Hearth & Page will prepare your request with all required information pre-filled so the clerk can issue your certificate quickly.","fee":"$25 CAD (payable to the Minister of Finance)","processingTime":"Varies by courthouse \u2014 typically 2\u20136 weeks after request submission.","howToSubmit":["In person at the courthouse where your divorce was granted","By mail \u2014 include request, $25 cheque payable to Minister of Finance, and self-addressed stamped envelope","Online through Justice Services Online (where available)"]},"waitingPeriodFlag":{"enabled":true,"triggerField":"divorce_order_date","waitingDays":31,"message":"Your divorce order takes effect 31 days after the judge signed it (assuming no appeal). You cannot request your certificate until after this date.","warningMessages":{"tooEarly":"\u26a0\ufe0f Your divorce order was signed on {divorce_order_date}. The 31-day waiting period ends on {effective_date}. You can submit your certificate request on or after that date.","readyToFile":"\u2705 Your divorce is final. Your certificate became available on {effective_date}. You may submit your request now.","appealNotice":"If you or the other party filed an appeal, the 31-day clock may be paused or extended. Check with the court if you are unsure."}},"autoFillSources":["courthouse","court_file_number","applicant_full_name","respondent_full_name"],"steps":[{"stepId":1,"title":"Understanding Your Certificate","description":"Before you request your Certificate of Divorce, let's make sure your divorce is final.","fields":[{"id":"intro_info","label":"What is the Certificate of Divorce?","type":"info","content":"The Certificate of Divorce (Form 36B) is the official legal document that proves your marriage has been dissolved. It is different from your Divorce Order.\n\n\u2022 Your Divorce ORDER is the judge's signed decision granting the divorce.\n\u2022 Your Certificate of Divorce is proof that the order has TAKEN EFFECT.\n\nYou need the Certificate (not just the Order) for:\n\u2713 Remarrying in Ontario or anywhere in Canada\n\u2713 Changing your name on government ID, passport, and CRA records\n\u2713 Updating your bank accounts and pension plans\n\u2713 Most official purposes that require proof of divorce\n\nThe certificate is issued by the court clerk. You request it \u2014 they sign and stamp it."},{"id":"divorce_order_date","label":"What date did the judge sign your Divorce Order?","type":"date","required":true,"waitingPeriodFlag":true,"waitingDays":31,"hint":"This date is printed on your Divorce Order (Form 25A). It is the date the judge signed the order \u2014 not the date you received it in the mail.","validation":{"maxDate":"today","message":"The divorce order date cannot be in the future."}},{"id":"early_effective_date_ordered","label":"Has the court ordered that your divorce takes effect before the 31-day waiting period?","type":"radio","required":true,"options":[{"value":"no","label":"No \u2014 the standard 31-day period applies"},{"value":"yes","label":"Yes \u2014 the court ordered an earlier effective date"}],"hint":"Under the Divorce Act s.12(2), a court may order an earlier effective date if both spouses agree there will be no appeal and the court finds special circumstances. This is rare. Check your divorce order for any special effective date."},{"id":"early_effective_date","label":"Court-ordered effective date of divorce:","type":"date","required":false,"showIf":{"field":"early_effective_date_ordered","value":"yes"},"hint":"Enter the date specified in the court order for when your divorce takes effect."},{"id":"waiting_period_status","label":"Waiting Period Check","type":"computed_status","sourceField":"divorce_order_date","waitingDays":31,"statusMessages":{"waiting":"\u23f3 Your 31-day waiting period ends on {effective_date}. You can submit your certificate request on or after that date. Come back then and we'll prepare your request.","ready":"\u2705 Your divorce took effect on {effective_date}. You are ready to request your Certificate of Divorce.","no_date":"Enter your divorce order date above to check your eligibility."}},{"id":"appeal_filed","label":"Has either party filed an appeal of the Divorce Order?","type":"radio","required":true,"options":[{"value":"no","label":"No \u2014 no appeal was filed"},{"value":"yes","label":"Yes \u2014 an appeal was or may have been filed"},{"value":"unsure","label":"I am not sure"}],"hint":"If an appeal has been filed, the divorce order does not take effect on day 31. Contact the court office or a lawyer before requesting your certificate."},{"id":"appeal_warning","label":"Appeal Warning","type":"info","showIf":{"field":"appeal_filed","operator":"in","values":["yes","unsure"]},"content":"\u26a0\ufe0f If an appeal has been filed:\n\nYour divorce will not take effect on day 31. Instead, under the Divorce Act s.12(3), it takes effect when the time for any further appeal expires after the final appeal decision.\n\nIf the appeal was later abandoned or dismissed, your divorce will eventually take effect \u2014 contact the court to confirm the current status and the effective date.\n\nIf you are unsure whether an appeal has been filed, contact the courthouse where your divorce was granted before requesting your certificate.\n\nFor legal advice on appeals: Legal Aid Ontario 1-800-668-8258."}]},{"stepId":2,"title":"Court & Case Information","description":"Enter the court details exactly as they appear on your Divorce Order.","fields":[{"id":"divorce_appealed","label":"Was your divorce order granted after an appeal (i.e., by the Court of Appeal for Ontario)?","type":"radio","required":true,"options":[{"value":"no","label":"No \u2014 my divorce was granted by the trial court (Superior Court of Justice)"},{"value":"yes","label":"Yes \u2014 my divorce was granted on appeal by the Court of Appeal"}],"hint":"Under the Divorce Act s.12(7), if your divorce was granted on appeal, the certificate is issued by the appellate court \u2014 not the original trial court."},{"id":"appellate_court_notice","label":"Appellate Court Certificate","type":"info","showIf":{"field":"divorce_appealed","value":"yes"},"content":"Because your divorce was granted by the Court of Appeal for Ontario, your Certificate of Divorce must be requested from the Court of Appeal \u2014 not from the original trial court.\n\nCourt of Appeal for Ontario\n130 Queen Street West, Toronto, ON M5H 2N5\nTel: 416-327-5020\n\nContact them directly to request your certificate."},{"id":"court_name","label":"Name of Court that Granted the Divorce","type":"select","required":true,"autoFill":"courthouse","hint":"Select the courthouse where your divorce was granted. This must match your Divorce Order exactly.","options":["Superior Court of Justice \u2014 Toronto (393 University Ave.)","Superior Court of Justice \u2014 Toronto (47 Sheppard Ave.)","Superior Court of Justice \u2014 Ottawa","Superior Court of Justice \u2014 Brampton","Superior Court of Justice \u2014 Hamilton","Superior Court of Justice \u2014 London","Superior Court of Justice \u2014 Barrie","Superior Court of Justice \u2014 Kingston","Superior Court of Justice \u2014 Kitchener (Waterloo Region)","Superior Court of Justice \u2014 Milton (Halton Region)","Superior Court of Justice \u2014 Newmarket (York Region)","Superior Court of Justice \u2014 North Bay","Superior Court of Justice \u2014 Oshawa (Durham Region)","Superior Court of Justice \u2014 St. Catharines (Niagara Region)","Superior Court of Justice \u2014 Sudbury","Superior Court of Justice \u2014 Thunder Bay","Superior Court of Justice \u2014 Windsor"]},{"id":"court_office_address","label":"Court Office Address","type":"text","required":true,"autoFill":"court_office_address","placeholder":"e.g. 393 University Avenue, Toronto, ON M5G 1E6","hint":"Enter the full address of the court office. This appears on your divorce order."},{"id":"court_file_number","label":"Court File Number","type":"text","required":true,"autoFill":"court_file_number","placeholder":"e.g. FC-12345-24","hint":"Copy this exactly from your Divorce Order or other court documents. Even a small error can delay your certificate.","validation":{"pattern":"^[A-Za-z0-9\\-/\\s]+$","message":"Enter the file number exactly as it appears on your court documents."}}]},{"stepId":3,"title":"Party Names","description":"Enter both parties' names exactly as they appear on the court record.","fields":[{"id":"name_accuracy_notice","label":"Name Accuracy \u2014 Important","type":"info","content":"Enter both parties' names exactly as they appear on your court documents (Application, Divorce Order). Even small differences in spelling \u2014 including middle names or initials \u2014 can cause the clerk to return your request for correction, which delays your certificate."},{"id":"applicant_full_name","label":"Applicant \u2014 Full Legal Name (as it appears on the court record)","type":"text","required":true,"autoFill":"applicant_full_name","placeholder":"e.g. Jane Elizabeth Smith","hint":"Use the exact name from your Application (Form 8A) and Divorce Order (Form 25A)."},{"id":"applicant_address","label":"Applicant \u2014 Current Address for Service","type":"text","required":true,"autoFill":"applicant_address","placeholder":"e.g. 123 Main Street, Toronto, ON M1A 1A1"},{"id":"applicant_lawyer_name","label":"Applicant's Lawyer \u2014 Name and Address (if applicable)","type":"text","required":false,"placeholder":"Leave blank if self-represented","hint":"If you have a lawyer, the certificate may be sent to them. If self-represented, it will be sent to your address."},{"id":"respondent_full_name","label":"Respondent \u2014 Full Legal Name (as it appears on the court record)","type":"text","required":true,"autoFill":"respondent_full_name","placeholder":"e.g. John Robert Smith","hint":"Use the exact name from your court documents."},{"id":"respondent_address","label":"Respondent \u2014 Last Known Address","type":"text","required":false,"autoFill":"respondent_address","placeholder":"e.g. 789 Queen Street, Toronto, ON M5H 2N2"},{"id":"respondent_lawyer_name","label":"Respondent's Lawyer \u2014 Name and Address (if applicable)","type":"text","required":false,"placeholder":"Leave blank if respondent was self-represented"}]},{"stepId":4,"title":"Marriage & Divorce Details","description":"Provide the details of the marriage and the divorce order \u2014 these appear on the certificate.","fields":[{"id":"marriage_date","label":"Date of Marriage","type":"date","required":true,"autoFill":"marriage_date","hint":"\u26a0\ufe0f This date must match your court record EXACTLY \u2014 including the exact day, month, and year.\n\nCheck this date against:\n\u2022 Your original marriage certificate\n\u2022 Your Application for Divorce (Form 8A)\n\u2022 Your Divorce Order (Form 25A)\n\nEven a one-day error will cause the clerk to return your request for correction. Do not rely on memory or auto-fill \u2014 verify the date on your documents.","validation":{"maxDate":"today","message":"Marriage date cannot be in the future."}},{"id":"marriage_place","label":"Place of Marriage (city/town and province/country)","type":"text","required":true,"autoFill":"marriage_place","placeholder":"e.g. Toronto, Ontario, Canada","hint":"Enter the city and province (or country) where the marriage ceremony took place."},{"id":"divorce_order_date_confirm","label":"Date the Divorce Order was Signed (by the judge)","type":"date","required":true,"autoFill":"divorce_order_date","hint":"This is the date on your Divorce Order (Form 25A). The certificate will confirm that the divorce took effect 31 days after this date (or on the date specified in the order)."},{"id":"divorce_effective_date","label":"Date the Divorce Took Effect (auto-calculated: order date + 31 days)","type":"computed","formula":"divorce_order_date_confirm + 31 days","required":false,"displayAs":"Your divorce took effect on {computed_date}.","hint":"The court clerk will verify and certify this date. This is the date that will appear on your Certificate of Divorce."},{"id":"court_that_granted","label":"This court that is confirming the certificate:","type":"info","content":"The court clerk will certify: 'I CERTIFY THAT the marriage of [Applicant] and [Respondent], that was solemnized at [marriage place] on [marriage date], was dissolved by an order of this court and the divorce took effect on [effective date].'\n\nThe clerk will also apply the court seal. You do not need to fill in the certification section \u2014 that is the clerk's role."}]},{"stepId":5,"title":"Number of Copies & Fee","description":"Indicate how many certified copies you need and understand the fee structure.","fields":[{"id":"copies_needed_info","label":"How Many Copies Do You Need?","type":"info","content":"You should request at least 2\u20133 certified copies of your Certificate of Divorce. Common reasons you may need multiple copies:\n\n\u2022 One for your personal records\n\u2022 One for remarriage (required by the officiant or the other person's country)\n\u2022 One for name change documentation\n\u2022 One for government agencies (CRA, passport office)\n\u2022 One for your bank or pension plan\n\nEach additional certified copy typically costs $25. Uncertified copies are cheaper but may not be accepted for official purposes."},{"id":"copies_requested","label":"Number of certified copies requested:","type":"number","required":true,"min":1,"max":10,"defaultValue":2,"hint":"We recommend requesting at least 2 copies. The court fee is typically $25 per certified copy.","validation":{"min":1,"max":10,"message":"Request between 1 and 10 copies."}},{"id":"fee_reminder","label":"Court Fee","type":"computed","formula":"copies_requested * 25","displayAs":"Estimated fee: ${computed_total} CAD (${copies_requested} \u00d7 $25 per certified copy). Make cheques payable to the Minister of Finance. Note: Court fees are set by regulation and subject to change \u2014 confirm the current amount with the court office.","required":false},{"id":"submission_method","label":"How will you submit your request to the court?","type":"radio","required":true,"options":[{"value":"in_person","label":"In person at the courthouse"},{"value":"by_mail","label":"By mail (include cheque + self-addressed stamped envelope)"},{"value":"online","label":"Online through Justice Services Online"}],"hint":"Submit to the same courthouse where your divorce was granted."},{"id":"mail_instructions","label":"Mailing Instructions","type":"info","showIf":{"field":"submission_method","value":"by_mail"},"content":"When submitting by mail, include:\n1. Your completed Form 36B request (this document)\n2. A cheque payable to the Minister of Finance for the correct amount\n3. A self-addressed stamped envelope with sufficient postage for the number of copies\n\nAllow extra time for mail processing \u2014 typically 2\u20138 weeks total."}]},{"stepId":6,"title":"Review & Submit","description":"Review your request and confirm everything is accurate before printing.","fields":[{"id":"accuracy_confirmation","label":"I confirm that all information in this certificate request is accurate and matches my court records exactly.","type":"checkbox","required":true},{"id":"waiting_period_confirmation","label":"I confirm that the 31-day waiting period has passed and no appeal has been filed (or the appeal period has expired).","type":"checkbox","required":true,"hint":"If you are unsure whether an appeal was filed, contact the court before submitting."},{"id":"final_summary","label":"Your Certificate Request Summary","type":"info","content":"When you print this document:\n\n1. Take or mail it to the courthouse where your divorce was granted.\n2. Bring or include payment of $25 per certified copy (cheque payable to Minister of Finance).\n3. If going in person, bring photo ID.\n4. The clerk will verify your file and issue certified copies, usually within a few weeks.\n\nKeep your certified copies in a safe place \u2014 they are difficult to replace."},{"id":"hearth_page_notice","label":"Hearth & Page Notice","type":"info","content":"This certificate request was prepared using Hearth & Page (hearthandpage.ca). Hearth & Page is not a law firm and does not provide legal advice. The Certificate of Divorce is issued by the court clerk \u2014 Hearth & Page prepares your request only. This document was prepared on or by Hearth & Page."}]}],"pdfTemplate":{"pageSize":"letter","margins":{"top":25,"bottom":20,"left":20,"right":20},"header":{"courtName":"{{court_name}}","courtAddress":"{{court_office_address}}","formNumber":"Form 36B: Certificate of Divorce","courtFileNumber":"{{court_file_number}}"},"clerkSection":{"label":"FOR COURT CLERK USE ONLY","certificationText":"I CERTIFY THAT the marriage of {{applicant_full_name}} and {{respondent_full_name}}, that was solemnized at {{marriage_place}} on {{marriage_date}}, was dissolved by an order of this court, and the divorce took effect on {{divorce_effective_date}}.","sealPlaceholder":"[COURT SEAL]","signatureLine":"Signature of clerk of the court","dateLineLabel":"Date of signature"},"sections":[{"label":"Applicant(s)","fields":["applicant_full_name","applicant_address","applicant_lawyer_name"]},{"label":"Respondent(s)","fields":["respondent_full_name","respondent_address","respondent_lawyer_name"]},{"label":"Marriage Details","fields":["marriage_date","marriage_place"]},{"label":"Divorce Order Details","fields":["divorce_order_date_confirm","divorce_effective_date"]},{"label":"Copies Requested","fields":["copies_requested"]},{"label":"Submission Method","fields":["submission_method"]}],"footerText":"FLR 36B \u2014 Prepared using Hearth & Page (hearthandpage.ca). This document was prepared on or by Hearth & Page. The Certificate of Divorce is issued by the court clerk only.","clerkSignatureLine":true,"courtSealBox":true},"validationRules":[{"ruleId":"WAITING_PERIOD_CHECK","type":"date_gate","field":"divorce_order_date","gateType":"min_days_in_past","days":31,"severity":"warning","blockOnFail":false,"message":"Your divorce order was signed less than 31 days ago. The divorce may not yet be final. You can prepare your request now, but do not submit it to the court until {effective_date}."},{"ruleId":"APPEAL_BLOCK","type":"conditional_block","condition":{"field":"appeal_filed","operator":"in","values":["yes","unsure"]},"severity":"warning","message":"You indicated an appeal may have been filed. Please confirm the status of any appeal with the court before requesting your certificate."},{"ruleId":"NAME_MATCH_REMINDER","type":"info_reminder","fields":["applicant_full_name","respondent_full_name"],"message":"Ensure names match your court record exactly \u2014 including middle names and spelling."},{"ruleId":"FILE_NUMBER_FORMAT","type":"field_format","field":"court_file_number","message":"Enter the court file number exactly as it appears on your court documents."},{"ruleId":"COPIES_RANGE","type":"field_range","field":"copies_requested","min":1,"max":10,"message":"Request between 1 and 10 certified copies."},{"ruleId":"ACCURACY_CONFIRM","type":"checkbox_required","field":"accuracy_confirmation","message":"You must confirm that all information in this certificate request is accurate."},{"ruleId":"WAITING_CONFIRM","type":"checkbox_required","field":"waiting_period_confirmation","message":"You must confirm that the 31-day waiting period has passed and no appeal is pending."}]};
  window.__hp_formDefs['ON-F30A'] = {"formId":"ON-F30A","pdfFileName":"form30a.pdf","formCode":"form30a-default-hearing","formNumber":"Form 30A","jurisdiction":"Ontario","act":"Family Law Rules, O. Reg. 114/99, Rule 30(1); Family Responsibility and Support Arrears Enforcement Act, 1996, s. 41","version":"Current","title":"Form 30A — Request for Default Hearing","subtitle":"Ontario Family Court — Family Law Rules (FLR 30A)","description":"Filed by a support recipient when the payor has missed support payments. The clerk then issues a Notice of Default Hearing (Form 30) requiring the payor to come to court to explain the arrears. Must be filed with a fresh Statement of Money Owed (Form 26) prepared within the past 30 days.","requiredPlan":"standard","freeForm":false,"urgencyFlag":{"enabled":true,"type":"enforcement","warningMessage":"You must attach a Statement of Money Owed (Form 26) prepared within the past 30 days. An updated Form 26 must also be filed no more than 7 days before the hearing date.","relatedForms":["Form 26 (Statement of Money Owed)","Form 30 (Notice of Default Hearing — issued by clerk)","Form 30B (Default Dispute — filed by payor)","Form 13 (Financial Statement — filed by payor)"]},"steps":[{"stepId":"court-info","stepNumber":1,"title":"Court Information","subtitle":"Where the case is filed","intro":"Enter the court details for the enforcement proceeding. This should match the court where the original support order was made or registered.","fields":[{"fieldId":"court_name","type":"select","label":"Name of Court","required":true,"options":["Ontario Court of Justice","Superior Court of Justice","Superior Court of Justice (Family Court Branch)"],"helpText":"Select the court where the support order is being enforced."},{"fieldId":"court_office_address","type":"text","label":"Court Office Address","required":true,"placeholder":"393 University Ave, Toronto, ON M5G 1E6","source":"profile.case.courthouse"},{"fieldId":"court_file_number","type":"text","label":"Court File Number","required":true,"placeholder":"FC-2026-000000","source":"profile.case.fileNumber","helpText":"The file number from the original support order."}]},{"stepId":"parties","stepNumber":2,"title":"Recipient & Payor","subtitle":"Who owes support and who is owed","intro":"The recipient is the person entitled to support payments. The payor is the person who has missed payments.","groups":[{"label":"Recipient (You)","fields":[{"fieldId":"recipient_full_name","type":"text","label":"Recipient Full Legal Name","required":true,"placeholder":"Jane Smith","source":"profile.applicant.fullName"},{"fieldId":"recipient_address","type":"text","label":"Address for Service","required":true,"placeholder":"123 Main Street, Toronto, ON M4B 1A1","source":"profile.applicant.address"},{"fieldId":"recipient_phone","type":"tel","label":"Phone Number","required":true,"source":"profile.applicant.phone"},{"fieldId":"recipient_email","type":"email","label":"Email Address (if any)","required":false,"source":"profile.applicant.email"},{"fieldId":"recipient_has_lawyer","type":"yesno","label":"Do you have a lawyer?","required":true,"default":"no"},{"fieldId":"recipient_lawyer_name","type":"text","label":"Lawyer's Full Name","required":false,"showIf":{"field":"recipient_has_lawyer","value":"yes"}},{"fieldId":"recipient_lawyer_address","type":"text","label":"Lawyer's Address","required":false,"showIf":{"field":"recipient_has_lawyer","value":"yes"}},{"fieldId":"recipient_lawyer_phone","type":"tel","label":"Lawyer's Phone","required":false,"showIf":{"field":"recipient_has_lawyer","value":"yes"}}]},{"label":"Payor (Person Who Missed Payments)","fields":[{"fieldId":"payor_full_name","type":"text","label":"Payor Full Legal Name","required":true,"placeholder":"John Smith","source":"profile.respondent.fullName"},{"fieldId":"payor_address","type":"text","label":"Payor Address for Service","required":true,"placeholder":"456 Oak Avenue, Toronto, ON M4C 2B2","source":"profile.respondent.address"},{"fieldId":"payor_phone","type":"tel","label":"Payor Phone (if known)","required":false},{"fieldId":"payor_has_lawyer","type":"yesno","label":"Does the payor have a lawyer (that you know of)?","required":false,"default":"no"},{"fieldId":"payor_lawyer_name","type":"text","label":"Payor's Lawyer's Full Name","required":false,"showIf":{"field":"payor_has_lawyer","value":"yes"}},{"fieldId":"payor_lawyer_address","type":"text","label":"Payor's Lawyer's Address","required":false,"showIf":{"field":"payor_has_lawyer","value":"yes"}}]}]},{"stepId":"filer-role","stepNumber":3,"title":"Who Is Filing","subtitle":"Your role in this request","intro":"Identify whether you are filing this request yourself or through a lawyer.","fields":[{"fieldId":"filer_role","type":"radio","label":"I am filing this request as:","required":true,"options":[{"value":"recipient_self","label":"The person who signed the attached Statement of Money Owed (self-represented)"},{"value":"recipient_lawyer","label":"The lawyer for the person who signed the Statement of Money Owed"},{"value":"other","label":"Other (specify below)"}]},{"fieldId":"filer_role_other","type":"text","label":"Specify your role","required":false,"showIf":{"field":"filer_role","value":"other"}}]},{"stepId":"arrears","stepNumber":4,"title":"Missed Payments","subtitle":"The amount owed","intro":"Enter the total support arrears as calculated in your Statement of Money Owed (Form 26). The Form 26 must be attached when you file this request.","fields":[{"fieldId":"arrears_info","type":"info","label":"Important: Form 26 Required","content":"You must prepare and attach a fresh Statement of Money Owed (Form 26) when you file this request with the clerk. The Form 26 must have been prepared within the past 30 days. You will also need to file an updated Form 26 no more than 7 days before the default hearing date."},{"fieldId":"arrears_amount","type":"currency","label":"Total Missed Support Payments ($)","required":true,"placeholder":"0.00","helpText":"Enter the total amount of missed support payments as shown on your Statement of Money Owed (Form 26). Do not include any amounts for which the payor has a dispute filed."},{"fieldId":"support_order_date","type":"date","label":"Date of the Support Order","required":true,"helpText":"The date the original support order was made by the court."},{"fieldId":"support_order_type","type":"select","label":"Type of Support","required":true,"options":["Child support","Spousal support","Both child and spousal support","Other support order"]},{"fieldId":"fro_involved","type":"yesno","label":"Is the Family Responsibility Office (FRO) currently enforcing this order?","required":true,"default":"no","helpText":"The FRO (Director) can also file for a default hearing directly. If FRO is involved, they may file their own Statement of Arrears instead of Form 26."},{"fieldId":"fro_info","type":"info","label":"FRO Enforcement Note","content":"If the Family Responsibility Office (FRO) is already enforcing this order, you may want to contact them before filing Form 30A. FRO can file for a default hearing directly without Form 30A. You can file your own Form 30A if FRO is not enforcing or if you want to proceed independently.","showIf":{"field":"fro_involved","value":"yes"}}]},{"stepId":"delivery","stepNumber":5,"title":"Service & Signature","subtitle":"Certify and sign","intro":"After the clerk issues Form 30, the Notice of Default Hearing must be served on the payor by special service (in person or by an adult other than yourself). Review all information before signing.","fields":[{"fieldId":"service_info","type":"info","label":"After You File","content":"Once you file Form 30A and the Statement of Money Owed (Form 26), the clerk will issue a Notice of Default Hearing (Form 30). You must serve the Notice on the payor by special service (Rule 30(2)). The payor then has 10 days to file a Financial Statement (Form 13) and a Default Dispute (Form 30B)."},{"fieldId":"form26_prepared","type":"checkbox","label":"I confirm that I have prepared a Statement of Money Owed (Form 26) dated within the past 30 days and will attach it to this request.","required":true},{"fieldId":"information_true","type":"checkbox","label":"I confirm that the information in this request is true to the best of my knowledge.","required":true},{"fieldId":"signature_date","type":"date","label":"Date of Signature","required":true,"helpText":"Today's date."}]}]};
  window.__hp_formDefs['ON-F25F'] = {"formId":"ON-F25F",
  "pdfFileName": "form25f.pdf","formCode":"form25f-restraining-order-fla","formNumber":"Form 25F","jurisdiction":"Ontario","act":"Family Law Act, R.S.O. 1990, c. F.3, s. 46 (Order restraining harassment); Family Law Rules, O. Reg. 114/99, Rules 25(11)(b)(i.1), 25(11.1)","version":"September 1, 2009","title":"Form 25F — Restraining Order","subtitle":"Ontario Family Court — Family Law Act, s. 46","description":"A court-issued restraining order under s. 46 of the Family Law Act to prevent harassment and communication between former spouses or partners. Completed by the court clerk after a judge grants the order. The user fills in the applicant details and the conduct being restrained; a judge signs the order. Registered on the Canadian Police Information Centre (CPIC) database. Disobeying this order is a criminal offence.","requiredPlan":"standard","freeForm":false,"safetyFlag":{"enabled":true,"criticalWarning":true,"message":"If you or your children are in immediate danger, call 911. A restraining order takes time to obtain through the courts. If you need protection immediately, contact the police first.","urgentMotion":"If you need a restraining order urgently (without waiting weeks for a hearing), you can file an urgent motion WITHOUT NOTICE to the other party using Form 14 (Notice of Motion) and Form 14A (Affidavit). The judge can grant a temporary restraining order the same day."},"steps":[{"stepId":"safety-check","stepNumber":1,"title":"Safety Information","subtitle":"Read before continuing","intro":"Form 25F is the restraining order itself, signed by a judge. You need to apply for it first using a motion or application. This section explains what you need to do.","fields":[{"fieldId":"safety_info","type":"info","label":"Immediate Danger","content":"If you or your children are in immediate danger, call 911. Do not wait for a court order."},{"fieldId":"urgent_info","type":"info","label":"Urgent Restraining Order (Without Notice)","content":"If you need protection quickly, you can file an urgent motion WITHOUT telling the other party first. File Form 14 (Notice of Motion) and Form 14A (Affidavit) explaining why you are afraid. A judge can grant a temporary restraining order the same day. You will also need to start or reopen a family court case with Form 8 (Application General)."},{"fieldId":"legislation_info","type":"info","label":"Which Law Applies — Form 25F","content":"Form 25F is used for restraining orders under section 46 of the Family Law Act (FLA). This applies to former spouses or partners in a family law case. It orders the restrained person to stop harassing or communicating with you. If your case involves children and the order is under the Children's Law Reform Act (CLRA), use Form 25G instead."},{"fieldId":"cpic_info","type":"info","label":"CPIC Registration & Criminal Consequences","content":"Once granted, this order is registered on the Canadian Police Information Centre (CPIC) database. Any police officer in Canada can enforce it. Disobeying this order is a criminal offence punishable by fine or imprisonment. The restrained person can be arrested without a warrant under s. 495 of the Criminal Code."},{"fieldId":"has_existing_case","type":"yesno","label":"Do you already have a family court case open (a court file number)?","required":true,"default":"no","helpText":"If yes, your restraining order application will be added to your existing case. If no, you will need to file Form 8 (Application General) to start a new case at the same time."},{"fieldId":"no_case_info","type":"info","label":"Starting a New Case","content":"Since you don't have an open case, you will need to file Form 8 (Application General) to start one. Hearth & Page will help you prepare both Form 8 and this restraining order application together.","showIf":{"field":"has_existing_case","value":"no"}}]},{"stepId":"court-info","stepNumber":2,"title":"Court Information","subtitle":"Where the case is or will be filed","fields":[{"fieldId":"court_name","type":"select","label":"Name of Court","required":true,"options":["Ontario Court of Justice","Superior Court of Justice","Superior Court of Justice (Family Court Branch)"]},{"fieldId":"court_office_address","type":"text","label":"Court Office Address","required":true,"placeholder":"393 University Ave, Toronto, ON M5G 1E6","source":"profile.case.courthouse"},{"fieldId":"court_file_number","type":"text","label":"Court File Number (if you already have one)","required":false,"placeholder":"FC-2026-000000","source":"profile.case.fileNumber"}]},{"stepId":"parties","stepNumber":3,"title":"Applicant & Respondent","subtitle":"Who is applying and who is being restrained","intro":"The applicant is the person seeking the restraining order (you). The respondent is the person you want restrained.","groups":[{"label":"Applicant (You — person seeking protection)","fields":[{"fieldId":"applicant_full_name","type":"text","label":"Your Full Legal Name","required":true,"source":"profile.applicant.fullName"},{"fieldId":"applicant_address","type":"text","label":"Your Address for Service","required":true,"source":"profile.applicant.address","helpText":"This address will appear on the court form. You may use a lawyer's address or a P.O. Box if you are concerned about the respondent knowing your location."},{"fieldId":"applicant_phone","type":"tel","label":"Your Phone Number","required":true,"source":"profile.applicant.phone"},{"fieldId":"applicant_email","type":"email","label":"Your Email (if any)","required":false,"source":"profile.applicant.email"},{"fieldId":"applicant_has_lawyer","type":"yesno","label":"Do you have a lawyer?","required":true,"default":"no"},{"fieldId":"applicant_lawyer_name","type":"text","label":"Lawyer's Full Name","required":false,"showIf":{"field":"applicant_has_lawyer","value":"yes"}},{"fieldId":"applicant_lawyer_address","type":"text","label":"Lawyer's Address","required":false,"showIf":{"field":"applicant_has_lawyer","value":"yes"}}]},{"label":"Respondent (Person to be restrained)","fields":[{"fieldId":"respondent_full_name","type":"text","label":"Respondent Full Legal Name","required":true,"source":"profile.respondent.fullName"},{"fieldId":"respondent_dob","type":"date","label":"Respondent Date of Birth","required":true,"helpText":"Required for CPIC registration of the restraining order."},{"fieldId":"respondent_address","type":"text","label":"Respondent Address (if known)","required":false,"source":"profile.respondent.address"},{"fieldId":"respondent_has_lawyer","type":"yesno","label":"Does the respondent have a lawyer?","required":false,"default":"no"},{"fieldId":"respondent_lawyer_name","type":"text","label":"Respondent's Lawyer's Name","required":false,"showIf":{"field":"respondent_has_lawyer","value":"yes"}},{"fieldId":"respondent_lawyer_address","type":"text","label":"Respondent's Lawyer's Address","required":false,"showIf":{"field":"respondent_has_lawyer","value":"yes"}}]}]},{"stepId":"conduct","stepNumber":4,"title":"Conduct to be Restrained","subtitle":"What you are asking the court to order","intro":"Describe the specific conduct you want the judge to order the respondent to stop. Be as specific as possible — a judge can only order what you ask for.","fields":[{"fieldId":"conduct_types","type":"checkbox","label":"I am asking the court to order the respondent not to:","required":false,"helpText":"Select all that apply."},{"fieldId":"conduct_attend_home","type":"checkbox","label":"Come to or near my home or residence"},{"fieldId":"conduct_attend_workplace","type":"checkbox","label":"Come to or near my workplace"},{"fieldId":"conduct_attend_school","type":"checkbox","label":"Come to or near my children's school or daycare"},{"fieldId":"conduct_contact_me","type":"checkbox","label":"Contact or communicate with me (by any means including phone, text, email, or social media)"},{"fieldId":"conduct_contact_children","type":"checkbox","label":"Contact or communicate with our children except as permitted by a parenting order"},{"fieldId":"conduct_other","type":"checkbox","label":"Other conduct (describe below)"},{"fieldId":"conduct_other_description","type":"textarea","label":"Describe the other conduct to be restrained","required":false,"showIf":{"field":"conduct_other","value":true}},{"fieldId":"addresses_to_protect","type":"textarea","label":"Specific addresses / locations to include in the order","required":false,"placeholder":"123 Main Street, Toronto, ON — my residence\n456 School Road, Toronto, ON — children's school","helpText":"List all addresses the restraining order should cover. The more specific you are, the easier it is for police to enforce."},{"fieldId":"exclusion_zone_metres","type":"number","label":"Exclusion distance (metres) — how close the respondent must not come","required":false,"placeholder":"100","min":10,"max":1000,"helpText":"Common distances are 100-500 metres. Leave blank if you are not requesting a specific distance."},{"fieldId":"order_effective_date","type":"date","label":"Order Effective Date (usually the date the judge signs)","required":false,"helpText":"Usually left for the judge to complete. Leave blank unless your lawyer advises otherwise."},{"fieldId":"order_expiry_date","type":"date","label":"Order Expiry Date (if not indefinite)","required":false,"helpText":"Restraining orders can be permanent or time-limited. If you want a permanent order, leave blank. If you want a specific end date (e.g., until children finish high school), enter it here."},{"fieldId":"order_permanent","type":"yesno","label":"Are you requesting a permanent (indefinite) restraining order?","required":true,"default":"yes"}]},{"stepId":"motion-type","stepNumber":5,"title":"Motion Type","subtitle":"With or without notice to the respondent","intro":"You must decide whether to give the respondent notice of your motion before the hearing, or to apply without notice for an emergency order.","fields":[{"fieldId":"motion_type","type":"radio","label":"How are you bringing your motion?","required":true,"options":[{"value":"with_notice","label":"With notice — I will serve the respondent before the hearing (standard process)"},{"value":"without_notice","label":"Without notice — I need an emergency temporary order immediately (the respondent will be served after)"}],"helpText":"Most motions are made with notice. A motion without notice is only appropriate in urgent safety situations where giving notice could put you or your children at risk."},{"fieldId":"without_notice_reason","type":"textarea","label":"Why are you asking for a motion without notice?","required":false,"showIf":{"field":"motion_type","value":"without_notice"},"placeholder":"Describe the urgency and why giving notice to the respondent would put you or your children at risk.","helpText":"The judge needs to know why you cannot give notice. Describe recent incidents, threats, or danger."},{"fieldId":"prior_incidents","type":"textarea","label":"Describe the incidents of harassment or threatening behaviour","required":true,"placeholder":"On [date], the respondent...\nOn [date], the respondent...","helpText":"Provide specific dates, locations, and descriptions of each incident. This information will go in your Form 14A (Affidavit) which must be filed with this motion."},{"fieldId":"police_involved","type":"yesno","label":"Have you called the police about any of these incidents?","required":true,"default":"no"},{"fieldId":"police_report_details","type":"text","label":"Police report number(s) and detachment","required":false,"showIf":{"field":"police_involved","value":"yes"}}]},{"stepId":"delivery-signature","stepNumber":6,"title":"Required Documents & Next Steps","subtitle":"What to file with the court","intro":"Form 25F is the order itself — it is signed by the judge, not by you. You must file supporting documents to get the order granted.","fields":[{"fieldId":"filing_checklist_info","type":"info","label":"What to File with the Court","content":"To apply for a restraining order, file these documents together: (1) Form 8 (Application General) if you don't already have an open case, (2) Form 14 (Notice of Motion) stating you are asking for a restraining order under s. 46 of the Family Law Act, (3) Form 14A (Affidavit General) describing the incidents of harassment, (4) A blank Form 10 (Answer) for the respondent, (5) CPIC Restraining Order Information Form (available only at the courthouse counter). If your motion is WITH notice, also file Form 14C (Confirmation of Motion) at least 3 business days before the hearing."},{"fieldId":"form8_needed","type":"checkbox","label":"I understand I need to file Form 8 (Application General) to start or reopen my court case.","required":false},{"fieldId":"form14_needed","type":"checkbox","label":"I understand I need to file Form 14 (Notice of Motion) and Form 14A (Affidavit) to support my request.","required":true},{"fieldId":"cpic_form_needed","type":"checkbox","label":"I understand the CPIC Restraining Order Information Form is available only at the courthouse counter — not online.","required":true},{"fieldId":"victim_services","type":"info","label":"Support Resources","content":"If you are leaving an abusive relationship, contact a Family Court Support Worker at your local courthouse (free service). You can also call the Assaulted Women's Helpline at 1-866-863-0511 (24 hours). Duty counsel (free legal advice) is available at every Ontario family courthouse on motion days."},{"fieldId":"signature_date","type":"date","label":"Date Prepared","required":true}]}]};
  window.__hp_formDefs['ON-F25G'] = {"formId":"ON-F25G",
  "pdfFileName": "form25g.pdf","formCode":"form25g-restraining-order-clra","formNumber":"Form 25G","jurisdiction":"Ontario","act":"Children's Law Reform Act, R.S.O. 1990, c. C.12, s. 35; Family Law Act, R.S.O. 1990, c. F.3, s. 46; Family Law Rules, O. Reg. 114/99, Rules 25(11)(b)(i.1), 25(11.1)","version":"September 1, 2009","title":"Form 25G — Restraining Order on Motion Without Notice","subtitle":"Ontario Family Court — Emergency Restraining Order (CLRA and/or FLA)","description":"An emergency restraining order granted by a judge on a motion made WITHOUT notice to the respondent. Used in urgent situations where giving notice could put the applicant or children at risk. Can be made under s. 35 of the Children's Law Reform Act (CLRA), s. 46 of the Family Law Act (FLA), or both. The order is temporary and the matter returns to court on a review date. Registered on the CPIC database. Disobeying is a criminal offence.","requiredPlan":"standard","freeForm":false,"safetyFlag":{"enabled":true,"criticalWarning":true,"message":"If you or your children are in immediate danger RIGHT NOW, call 911. Form 25G is for urgent situations but still requires a court hearing before a judge.","reviewDateNote":"After a motion without notice, the court MUST set a review date (usually within a few days to 2 weeks). Both parties attend the review. The respondent will be served with a copy of the order and told about the review date."},"steps":[{"stepId":"safety-check","stepNumber":1,"title":"Emergency Safety Information","subtitle":"Read carefully before proceeding","fields":[{"fieldId":"emergency_info","type":"info","label":"When to Use Form 25G","content":"Form 25G is for emergency restraining orders made WITHOUT telling the other person first. Use this when: (1) You or your children are in danger and cannot wait for a regular hearing, or (2) Telling the respondent about your motion could put you at greater risk. A judge will review the order within days. The respondent will be served after the order is granted."},{"fieldId":"legislation_choice_info","type":"info","label":"Which Law Applies — CLRA vs FLA","content":"Form 25G can be made under either or both laws. Use CLRA (s. 35) when your children are at risk and parenting/custody is involved. Use FLA (s. 46) when the harassment or threats are directed at you as a former spouse or partner. Your lawyer or duty counsel can advise which applies to your situation."},{"fieldId":"clra_or_fla","type":"radio","label":"Which law is this order being sought under?","required":true,"options":[{"value":"clra","label":"Section 35 of the Children's Law Reform Act (CLRA) — children are at risk"},{"value":"fla","label":"Section 46 of the Family Law Act (FLA) — I am being harassed or threatened"},{"value":"both","label":"Both CLRA s. 35 and FLA s. 46"}],"helpText":"If unsure, speak to duty counsel at the courthouse before filing. Duty counsel is a free service."},{"fieldId":"cpic_info","type":"info","label":"CPIC Registration & Criminal Consequences","content":"This order is immediately registered on the Canadian Police Information Centre (CPIC) database. Any police officer in Canada can enforce it. Disobeying this order is a criminal offence punishable by fine or imprisonment under the Criminal Code."}]},{"stepId":"court-info","stepNumber":2,"title":"Court Information","subtitle":"Where the case is or will be filed","fields":[{"fieldId":"court_name","type":"select","label":"Name of Court","required":true,"options":["Ontario Court of Justice","Superior Court of Justice","Superior Court of Justice (Family Court Branch)"]},{"fieldId":"court_office_address","type":"text","label":"Court Office Address","required":true,"placeholder":"393 University Ave, Toronto, ON M5G 1E6","source":"profile.case.courthouse"},{"fieldId":"court_file_number","type":"text","label":"Court File Number (if you already have one)","required":false,"source":"profile.case.fileNumber"}]},{"stepId":"parties","stepNumber":3,"title":"Applicant & Respondent","subtitle":"Who is applying and who is being restrained","groups":[{"label":"Applicant (You)","fields":[{"fieldId":"applicant_full_name","type":"text","label":"Your Full Legal Name","required":true,"source":"profile.applicant.fullName"},{"fieldId":"applicant_address","type":"text","label":"Address for Service","required":true,"source":"profile.applicant.address","helpText":"You may use a lawyer's address or safe address if you are concerned about safety."},{"fieldId":"applicant_phone","type":"tel","label":"Phone Number","required":true,"source":"profile.applicant.phone"},{"fieldId":"applicant_has_lawyer","type":"yesno","label":"Do you have a lawyer?","required":true,"default":"no"},{"fieldId":"applicant_lawyer_name","type":"text","label":"Lawyer's Full Name","required":false,"showIf":{"field":"applicant_has_lawyer","value":"yes"}},{"fieldId":"applicant_lawyer_address","type":"text","label":"Lawyer's Address","required":false,"showIf":{"field":"applicant_has_lawyer","value":"yes"}}]},{"label":"Respondent (Person to be restrained)","fields":[{"fieldId":"respondent_full_name","type":"text","label":"Respondent Full Legal Name","required":true,"source":"profile.respondent.fullName"},{"fieldId":"respondent_dob","type":"date","label":"Respondent Date of Birth","required":true,"helpText":"Required for CPIC registration. If unknown, contact police or duty counsel."},{"fieldId":"respondent_address","type":"text","label":"Respondent's Last Known Address","required":false,"source":"profile.respondent.address"}]}]},{"stepId":"children","stepNumber":4,"title":"Children Involved","subtitle":"Children named in the order","intro":"If the restraining order is under the CLRA (s. 35), the children must be named in the order.","fields":[{"fieldId":"children_involved","type":"yesno","label":"Are there children involved in this restraining order?","required":true,"default":"yes","showIf":{"field":"clra_or_fla","operator":"in","values":["clra","both"]}},{"fieldId":"child_1_name","type":"text","label":"Child 1 — Full Name","required":false,"showIf":{"field":"children_involved","value":"yes"}},{"fieldId":"child_1_dob","type":"date","label":"Child 1 — Date of Birth","required":false,"showIf":{"field":"children_involved","value":"yes"}},{"fieldId":"child_2_name","type":"text","label":"Child 2 — Full Name (if applicable)","required":false,"showIf":{"field":"children_involved","value":"yes"}},{"fieldId":"child_2_dob","type":"date","label":"Child 2 — Date of Birth","required":false,"showIf":{"field":"children_involved","value":"yes"}},{"fieldId":"child_3_name","type":"text","label":"Child 3 — Full Name (if applicable)","required":false,"showIf":{"field":"children_involved","value":"yes"}},{"fieldId":"additional_children_note","type":"textarea","label":"Additional children (name and date of birth)","required":false,"showIf":{"field":"children_involved","value":"yes"},"helpText":"If more than 3 children, list the remaining children here."}]},{"stepId":"order-terms","stepNumber":5,"title":"Order Terms","subtitle":"What the judge will order the respondent not to do","intro":"Describe exactly what you are asking the court to order. The more specific, the easier it is for police to enforce.","fields":[{"fieldId":"restrained_person_clause","type":"info","label":"Order Format","content":"The order will read: '[Respondent's name], born [date of birth], SHALL NOT...' followed by the specific terms you request below."},{"fieldId":"conduct_attend_home","type":"checkbox","label":"Come to or near my home or residence"},{"fieldId":"conduct_attend_workplace","type":"checkbox","label":"Come to or near my workplace"},{"fieldId":"conduct_attend_school","type":"checkbox","label":"Come to or near the children's school or daycare"},{"fieldId":"conduct_contact_applicant","type":"checkbox","label":"Contact or communicate with me (by any means)"},{"fieldId":"conduct_contact_children","type":"checkbox","label":"Contact the children except as permitted by a parenting order"},{"fieldId":"conduct_harass","type":"checkbox","label":"Follow, watch, or surveil me or the children"},{"fieldId":"conduct_other","type":"checkbox","label":"Other (describe below)"},{"fieldId":"conduct_other_description","type":"textarea","label":"Other conduct to be restrained","required":false,"showIf":{"field":"conduct_other","value":true}},{"fieldId":"protected_addresses","type":"textarea","label":"Addresses / locations covered by this order","required":false,"placeholder":"123 Main Street, Toronto, ON — my home\n789 School Lane, Toronto, ON — children's school"},{"fieldId":"exclusion_distance","type":"number","label":"Exclusion distance (metres)","required":false,"min":10,"max":1000,"placeholder":"100"},{"fieldId":"review_date_info","type":"info","label":"Review Date — Required for Without-Notice Orders","content":"Because this is a motion WITHOUT notice, the court must set a review date so the respondent can come to court and respond. The clerk will set this date. The order will include the review date. The respondent must be served with a copy of the order and told about the review date immediately after the order is granted."},{"fieldId":"review_date","type":"date","label":"Review Date (set by the court — leave blank if unknown)","required":false,"helpText":"The court clerk will set this date. It is usually within a few days to 2 weeks of the order being granted."},{"fieldId":"service_method","type":"select","label":"How will the respondent be served with a copy of this order?","required":true,"options":["Personal service (handed directly to the respondent)","Substituted service (with court permission, another method)","By a process server","By police (if approved by the court)"],"helpText":"Form 25G requires immediate service on the respondent after the order is granted. The notice of motion and supporting affidavit must also be served at the same time."}]},{"stepId":"urgency-affidavit","stepNumber":6,"title":"Urgency & Affidavit Details","subtitle":"Why you need this order without notice","intro":"You must explain to the judge why you cannot give the respondent notice of this motion. This information will go into your Form 14A (Affidavit).","fields":[{"fieldId":"affidavit_info","type":"info","label":"Form 14A (Affidavit) Required","content":"You must file a Form 14A (Affidavit) explaining the incidents of harassment or danger and why you need this order without notice. Hearth & Page will help you prepare Form 14A. The more specific and detailed your affidavit, the stronger your case."},{"fieldId":"urgency_reason","type":"textarea","label":"Why do you need this order immediately, without notifying the respondent first?","required":true,"placeholder":"Describe the specific danger or risk if the respondent were notified in advance...","helpText":"Be specific. Examples: 'The respondent threatened to harm me if I took legal action'; 'I fear the respondent will flee with the children if notified'; 'The respondent has a history of violence.'"},{"fieldId":"recent_incidents","type":"textarea","label":"Describe the most recent incidents (include dates and details)","required":true,"placeholder":"Date: [date]\nWhat happened: [describe incident]\n\nDate: [date]\nWhat happened: [describe incident]"},{"fieldId":"injuries_or_threats","type":"yesno","label":"Have you been physically harmed or directly threatened with physical harm?","required":true,"default":"no"},{"fieldId":"injury_details","type":"textarea","label":"Describe the physical harm or threats","required":false,"showIf":{"field":"injuries_or_threats","value":"yes"}},{"fieldId":"police_called","type":"yesno","label":"Have you called the police?","required":true,"default":"no"},{"fieldId":"police_report_number","type":"text","label":"Police report number and detachment","required":false,"showIf":{"field":"police_called","value":"yes"}},{"fieldId":"signature_date","type":"date","label":"Date Prepared","required":true}]}]};


  window.__hp_formDefs['ON-F10A'] = {"formId":"ON-F10A","jurisdiction":"ON","pdfFileName":"form10a.pdf","title":"Form 10A \u2014 Reply","subtitle":"Ontario Family Court \u2014 Family Law Rules","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 10A is filed by the applicant in response to the respondent\u2019s Answer (Form 10). Use this form if the respondent has made claims you disagree with, or if you need to respond to new facts raised in the Answer. If you agree with everything in the Answer, you do not need to file a Reply.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 4","intro":"Confirm the court file details for this reply.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","pdfFieldName":"Court File Number","autoFill":"fileNumber"},{"fieldId":"form_date","label":"Date of this Reply","type":"date","required":true,"pdfFieldName":"Date of Reply"}]},{"partId":"parties","title":"Parties","subtitle":"Step 2 of 4","intro":"Confirm the applicant and respondent details.","fields":[{"fieldId":"applicant_name","label":"Applicant full legal name","type":"text","source":"profile.personal.fullName","required":true,"pdfFieldName":"Applicant Name","autoFill":"applicantName"},{"fieldId":"applicant_address","label":"Applicant address for service","type":"text","required":true,"pdfFieldName":"Applicant Address"},{"fieldId":"applicant_phone","label":"Applicant phone number","type":"text","required":false,"pdfFieldName":"Applicant Phone"},{"fieldId":"applicant_email","label":"Applicant email","type":"email","required":false,"pdfFieldName":"Applicant Email"},{"fieldId":"respondent_name","label":"Respondent full legal name","type":"text","source":"profile.case.respondentName","required":true,"pdfFieldName":"Respondent Name","autoFill":"respondentName"},{"fieldId":"respondent_address","label":"Respondent address for service","type":"text","required":false,"pdfFieldName":"Respondent Address"}]},{"partId":"claims","title":"Claims \u2014 Agree or Disagree","subtitle":"Step 3 of 4","intro":"Review each claim the respondent made in their Answer. Indicate which you agree with and which you dispute. Where you disagree, explain why.","fields":[{"fieldId":"claims_agreed","label":"Claims in the Answer you AGREE with","type":"textarea","required":false,"placeholder":"List paragraph numbers or claims from the Answer that you accept, e.g. \u2018I agree with paragraphs 3 and 5 of the Answer regarding parenting time.\u2019","pdfFieldName":"Claims Agreed"},{"fieldId":"claims_disagreed","label":"Claims in the Answer you DISAGREE with","type":"textarea","required":false,"placeholder":"List paragraph numbers or claims you dispute, e.g. \u2018I disagree with paragraph 7 regarding child support.\u2019","pdfFieldName":"Claims Disagreed"},{"fieldId":"dismiss_request","label":"Are you asking the court to dismiss any of the respondent\u2019s claims?","type":"yesno","required":true},{"fieldId":"dismiss_details","label":"Which claims should be dismissed and why?","type":"textarea","required":false,"conditional":{"dependsOn":"dismiss_request","showWhen":"yes"},"placeholder":"e.g. \u2018The respondent\u2019s claim for spousal support should be dismissed because no agreement was ever made.\u2019","pdfFieldName":"Dismiss Details"},{"fieldId":"supporting_facts","label":"Additional facts supporting your reply","type":"textarea","required":false,"placeholder":"Provide any facts or context that support your position. Be specific and factual. Do not include legal arguments here.","pdfFieldName":"Supporting Facts"}]},{"partId":"review","title":"Review & sign","subtitle":"Step 4 of 4","intro":"Review your Reply carefully before signing. This is a court document.","fields":[{"fieldId":"review_accuracy","label":"I confirm that all information in this Reply is true and accurate to the best of my knowledge.","type":"checkbox","required":true},{"fieldId":"signature_date","label":"Date of signature","type":"date","required":true,"pdfFieldName":"Signature Date"},{"fieldId":"deponent_name","label":"Your full legal name (as it will appear on the signature line)","type":"text","source":"profile.personal.fullName","required":true,"pdfFieldName":"Deponent Name","autoFill":"applicantName"}]}]};

  window.__hp_formDefs['ON-F13']   = {"formId":"ON-F13","jurisdiction":"ON","pdfFileName":"form13.pdf","title":"Form 13 — Financial Statement (Support Claims)","subtitle":"Ontario Court of Justice — Family Law Rules","requiredPlan":"standard","freeForm":false,"note":"Both parties must complete and exchange financial statements. Ensure all income, expense, asset, and debt figures are accurate — this is a sworn document.","universalProfileSections":["personal","income"],"parts":[{"partId":"f13_employment","title":"Employment & Income Documents","subtitle":"Step 1 of 6","intro":"Before you start, gather these documents. You'll need them to fill this form accurately.","type":"checklist","fields":[{"fieldId":"doc_paystub","label":"Most recent pay stub","type":"checkbox","required":false,"helpText":"Shows your current salary or hourly wage and deductions."},{"fieldId":"doc_t4_2024","label":"T4 slip — 2024","type":"checkbox","required":false,"helpText":"Employment income summary from your employer."},{"fieldId":"doc_t4_2023","label":"T4 slip — 2023","type":"checkbox","required":false},{"fieldId":"doc_t4_2022","label":"T4 slip — 2022","type":"checkbox","required":false},{"fieldId":"doc_noa_2024","label":"Notice of Assessment — 2024","type":"checkbox","required":false,"helpText":"Sent by CRA after you file your taxes. Shows your total income for the year."},{"fieldId":"doc_noa_2023","label":"Notice of Assessment — 2023","type":"checkbox","required":false},{"fieldId":"doc_noa_2022","label":"Notice of Assessment — 2022","type":"checkbox","required":false},{"fieldId":"doc_business_statements","label":"Business financial statements (if self-employed)","type":"checkbox","required":false,"conditional":{"dependsOn":"employmentType","showWhen":"self-employed"},"helpText":"Your accountant or bookkeeper can provide these."}]},{"partId":"f13_income","title":"Monthly Income","subtitle":"Step 2 of 6","intro":"Enter your average monthly income from every source. If an amount varies, use a monthly average. Enter 0 if a source doesn't apply — don't leave it blank.","type":"fields","fields":[{"fieldId":"inc_employment","label":"Employment income (before deductions)","type":"currency","unit":"$/month","source":"income.monthlyGross","required":true,"placeholder":"0.00","helpText":"From your pay stub — before tax, CPP, or EI is taken off.","pdfFieldName":"Employment income [0.00]"},{"fieldId":"inc_commissions","label":"Commissions, tips, bonuses","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","helpText":"Average these out over 12 months if they vary.","pdfFieldName":"Commissions [0.00]"},{"fieldId":"inc_selfemployment","label":"Self-employment income (net after expenses)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","conditional":{"dependsOn":"employmentType","showWhen":"self-employed"},"helpText":"Net profit after legitimate business expenses. Use your most recent business financial statement.","pdfFieldName":"Self-employment income [0.00]"},{"fieldId":"inc_ei","label":"Employment Insurance (EI) benefits","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Employment Insurance [0.00]"},{"fieldId":"inc_wcb","label":"Workers Compensation (WSIB) benefits","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Workers Compensation [0.00]"},{"fieldId":"inc_socialassistance","label":"Social assistance / Ontario Works / ODSP","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Social assistance [0.00]"},{"fieldId":"inc_investment","label":"Investment income (dividends, interest, rent)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Investment income [0.00]"},{"fieldId":"inc_pension","label":"Pension / retirement income","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Pension income [0.00]"},{"fieldId":"inc_spousalsupport","label":"Spousal support received","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Spousal support received [0.00]"},{"fieldId":"inc_childtaxbenefit","label":"Canada Child Benefit (CCB)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","helpText":"Monthly CCB payments from CRA for your children.","pdfFieldName":"Child tax benefit [0.00]"},{"fieldId":"inc_other","label":"Other income (describe)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Other income [0.00]"},{"fieldId":"inc_total_monthly","label":"Total monthly income","type":"currency_calculated","unit":"$/month","required":true,"calculated":true,"formula":"sum([inc_employment, inc_commissions, inc_selfemployment, inc_ei, inc_wcb, inc_socialassistance, inc_investment, inc_pension, inc_spousalsupport, inc_childtaxbenefit, inc_other])","helpText":"Auto-calculated from the fields above.","pdfFieldName":"Total monthly income [0.00]"},{"fieldId":"inc_other_benefits","label":"Non-cash benefits from employer (health plan, car, housing, etc.)","type":"textarea","required":false,"helpText":"Describe any perks that have a dollar value — e.g. 'employer-paid dental plan ($150/month value)'.","pdfFieldName":"Other non-cash benefits"}]},{"partId":"f13_expenses","title":"Monthly Expenses","subtitle":"Step 3 of 6","intro":"Enter your actual monthly expenses. Be honest — courts compare your income against your expenses to assess support needs. Round to the nearest dollar.","type":"fields","groups":[{"groupId":"housing","label":"Housing","fields":[{"fieldId":"exp_rent_mortgage","label":"Rent or mortgage payment","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Rent or mortgage [0.00]"},{"fieldId":"exp_property_tax","label":"Property taxes","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","helpText":"Divide your annual property tax bill by 12.","pdfFieldName":"Property taxes [0.00]"},{"fieldId":"exp_property_insurance","label":"Home / tenant insurance","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Property insurance [0.00]"},{"fieldId":"exp_condo_fees","label":"Condominium fees","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Condominium fees [0.00]"},{"fieldId":"exp_home_repairs","label":"Repairs and maintenance","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Repairs and maintenance [0.00]"},{"fieldId":"exp_utilities","label":"Utilities (hydro, gas, water, internet, phone)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Water [0.00]"}]},{"groupId":"food_personal","label":"Food & Personal","fields":[{"fieldId":"exp_groceries","label":"Groceries","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Groceries [0.00]"},{"fieldId":"exp_meals_out","label":"Meals outside the home","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Meals outside the home [0.00]"},{"fieldId":"exp_clothing","label":"Clothing","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Clothing [0.00]"},{"fieldId":"exp_personal","label":"Entertainment & recreation","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Entertainment/recreation [0.00]"},{"fieldId":"exp_vacations","label":"Vacations","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","helpText":"Average your annual vacation spending by 12.","pdfFieldName":"Vacations [0.00]"}]},{"groupId":"transport","label":"Transportation","fields":[{"fieldId":"exp_transit","label":"Transportation (car payments, gas, transit, parking)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Gas and oil [0.00]"}]},{"groupId":"health","label":"Health & Insurance","fields":[{"fieldId":"exp_health","label":"Health-related expenses (dental, prescriptions, therapy, glasses)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Health insurance premiums [0.00]"},{"fieldId":"exp_life_insurance","label":"Life insurance premiums","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Life Insurance premiums [0.00]"}]},{"groupId":"children","label":"Children","fields":[{"fieldId":"exp_childcare","label":"Childcare / daycare","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Daycare expense [0.00]"},{"fieldId":"exp_children_activities","label":"Children's activities (sports, music, tutoring)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Children's activities [0.00]"}]},{"groupId":"financial","label":"Financial Obligations","fields":[{"fieldId":"exp_rrsp","label":"RRSP / RESP contributions","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"RRSP/RESP withdrawals [0.00]"},{"fieldId":"exp_debt_payments","label":"Debt payments (credit cards, loans, lines of credit)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Debt payments [0.00]"},{"fieldId":"exp_auto_deductions","label":"Automatic deductions (CPP, EI, union dues, pension plan)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","helpText":"These are deductions taken off your paycheque automatically — visible on your pay stub.","pdfFieldName":"CPP contributions [0.00]"},{"fieldId":"exp_other_support","label":"Support paid for other children or dependants","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Support paid for other children [0.00]"}]},{"groupId":"other","label":"Other","fields":[{"fieldId":"exp_other","label":"Other expenses (describe)","type":"currency","unit":"$/month","required":false,"placeholder":"0.00","pdfFieldName":"Other expenses [0.00]"},{"fieldId":"exp_total_monthly","label":"Total monthly expenses","type":"currency_calculated","unit":"$/month","required":true,"calculated":true,"formula":"sum([exp_rent_mortgage, exp_property_tax, exp_property_insurance, exp_condo_fees, exp_home_repairs, exp_utilities, exp_groceries, exp_meals_out, exp_clothing, exp_personal, exp_vacations, exp_transit, exp_health, exp_life_insurance, exp_childcare, exp_children_activities, exp_rrsp, exp_debt_payments, exp_auto_deductions, exp_other_support, exp_other])","pdfFieldName":"Total Amount of Monthly Expenses [0.00]"}]}]},{"partId":"f13_assets","title":"Assets","subtitle":"Step 4 of 6","intro":"List everything you own or have a share in. Use today's market value, not what you paid for it. Enter 0 if you have none of a particular asset.","type":"fields","helpText":"Assets are things you own that have value. Courts use this to understand your overall financial picture.","fields":[{"fieldId":"asset_realestate","label":"Real estate (home, cottage, land) — estimated market value","type":"currency","required":false,"placeholder":"0.00","helpText":"Use a recent appraisal, MPAC assessment, or Realtor estimate. Describe the property in the notes field below.","pdfFieldName":"Real estate [0.00]"},{"fieldId":"asset_realestate_desc","label":"Real estate description","type":"textarea","required":false,"placeholder":"e.g. 123 Main St, Toronto — matrimonial home, joint ownership","pdfFieldName":"Real estate description"},{"fieldId":"asset_vehicles","label":"Vehicles (cars, trucks, motorcycles, boats) — market value","type":"currency","required":false,"placeholder":"0.00","helpText":"Check Canadian Black Book or AutoTrader for current resale value.","pdfFieldName":"Cars and other vehicles [0.00]"},{"fieldId":"asset_bank_accounts","label":"Bank accounts (chequing, savings, GICs) — total balance","type":"currency","required":false,"placeholder":"0.00","helpText":"Use the balance as of today. Include all accounts at all banks.","pdfFieldName":"Bank accounts [0.00]"},{"fieldId":"asset_investments","label":"Investments (stocks, bonds, mutual funds, crypto)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Investments [0.00]"},{"fieldId":"asset_rrsp_pension","label":"RRSPs, RRIFs, TFSAs, pension plans","type":"currency","required":false,"placeholder":"0.00","helpText":"Use the current account balance or commuted value from your pension statement.","pdfFieldName":"R.R.S.P.'s [0.00]"},{"fieldId":"asset_life_insurance","label":"Life insurance (cash surrender value)","type":"currency","required":false,"placeholder":"0.00","helpText":"Only whole life or universal life policies have cash value. Term life = 0.","pdfFieldName":"Life insurance [0.00]"},{"fieldId":"asset_business","label":"Business interests (value of any business you own or co-own)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Business interests [0.00]"},{"fieldId":"asset_money_owed","label":"Money owed to you (loans you've made, tax refunds expected)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Money owed to you [0.00]"},{"fieldId":"asset_other","label":"Other assets (jewelry, art, collectibles, equipment)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Other assets [0.00]"},{"fieldId":"asset_total","label":"Total assets","type":"currency_calculated","required":true,"calculated":true,"formula":"sum([asset_realestate, asset_vehicles, asset_bank_accounts, asset_investments, asset_rrsp_pension, asset_life_insurance, asset_business, asset_money_owed, asset_other])","pdfFieldName":"Total assets [0.00]"}]},{"partId":"f13_debts","title":"Debts & Liabilities","subtitle":"Step 5 of 6","intro":"List everything you owe. Include all debts even if you share them with someone else. Enter 0 if a type of debt doesn't apply.","type":"fields","helpText":"Debts reduce your net worth. Being thorough here protects you — understating debts can hurt your credibility with the court.","fields":[{"fieldId":"debt_mortgage_loans","label":"Mortgages and secured loans (balance owing)","type":"currency","required":false,"placeholder":"0.00","helpText":"Check your most recent mortgage statement for the outstanding balance.","pdfFieldName":"Mortgages [0.00]"},{"fieldId":"debt_credit_cards","label":"Credit cards and lines of credit (total balance)","type":"currency","required":false,"placeholder":"0.00","helpText":"Add up all credit card balances and any outstanding line of credit.","pdfFieldName":"Credit cards [0.00]"},{"fieldId":"debt_car_loans","label":"Car loans and leases (balance owing)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Car loans [0.00]"},{"fieldId":"debt_student_loans","label":"Student loans","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Student loans [0.00]"},{"fieldId":"debt_unpaid_support","label":"Unpaid support arrears (child or spousal support you owe)","type":"currency","required":false,"placeholder":"0.00","helpText":"Only include support that is already overdue and unpaid.","pdfFieldName":"Support arrears [0.00]"},{"fieldId":"debt_taxes_owing","label":"Taxes owing (CRA balance, HST, etc.)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Income tax [0.00]"},{"fieldId":"debt_other","label":"Other debts (personal loans, money owed to family)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Other debts [0.00]"},{"fieldId":"debt_total","label":"Total debts","type":"currency_calculated","required":true,"calculated":true,"formula":"sum([debt_mortgage_loans, debt_credit_cards, debt_car_loans, debt_student_loans, debt_unpaid_support, debt_taxes_owing, debt_other])","pdfFieldName":"Total debts [0.00]"},{"fieldId":"net_worth","label":"Net worth (assets minus debts)","type":"currency_calculated","required":true,"calculated":true,"formula":"asset_total - debt_total","helpText":"This is automatically calculated. A negative number is normal if you owe more than you own.","pdfFieldName":"Net worth [0.00]"}]},{"partId":"f13_schedules","title":"Schedules & Additional Documents","subtitle":"Step 6 of 6","intro":"Form 13 has three schedules you may need to attach depending on your situation.","type":"fields","fields":[{"fieldId":"schedule_a_required","label":"Do you have employment income to report on Schedule A?","type":"yesno","required":true,"helpText":"Schedule A lists your last 3 years of employment income. You'll need your T4s and Notices of Assessment."},{"fieldId":"schedule_a","label":"Schedule A — Employment income details (attach your T4s and NOAs)","type":"textarea","required":false,"conditional":{"dependsOn":"schedule_a_required","showWhen":"yes"},"helpText":"Describe your income for 2022, 2023, and 2024. Include your employer name, gross income, and whether you received any lump sums.","pdfFieldName":"Schedule A"},{"fieldId":"schedule_b_required","label":"Are you self-employed or do you earn income from a corporation?","type":"yesno","required":true,"helpText":"Schedule B applies if you own a business, work as a contractor, or receive income through a corporation."},{"fieldId":"schedule_b","label":"Schedule B — Non-employment income details","type":"textarea","required":false,"conditional":{"dependsOn":"schedule_b_required","showWhen":"yes"},"helpText":"Summarize your self-employment income. Attach your last 3 years of business financial statements.","pdfFieldName":"Schedule B"},{"fieldId":"schedule_c_required","label":"Do you have special or extraordinary expenses for children?","type":"yesno","required":true,"helpText":"Schedule C covers section 7 expenses — things like daycare, tutoring, medical costs, or post-secondary education that go above the base child support amount."},{"fieldId":"schedule_c","label":"Schedule C — Special or extraordinary expenses","type":"textarea","required":false,"conditional":{"dependsOn":"schedule_c_required","showWhen":"yes"},"helpText":"List each expense type, the monthly amount, and which child it's for.","pdfFieldName":"Schedule C"}]}]};
  window.__hp_formDefs['ON-F13_1'] = {"formId":"ON-F13_1","jurisdiction":"ON","pdfFileName":"form13_1.pdf","title":"Form 13.1 — Financial Statement (Property and Support Claims)","subtitle":"Ontario Family Court — Family Law Rules (FLR 13.1)","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 13.1 is a detailed financial statement required when your case involves property claims (like dividing the family home or other assets), equalization of net family property, or both support AND property. It is more detailed than Form 13 because it includes a full list of your assets, debts, and a calculation of your net family property. Both parties must file this form.","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 9","intro":"Confirm the court file details.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie — Superior Court of Justice","Brampton — Superior Court of Justice","Brantford — Superior Court of Justice","Cornwall — Superior Court of Justice","Hamilton — Superior Court of Justice","Kingston — Superior Court of Justice","Kitchener — Superior Court of Justice","London — Superior Court of Justice","Milton — Superior Court of Justice","Newmarket — Superior Court of Justice","Oshawa — Superior Court of Justice","Ottawa — Superior Court of Justice","Peterborough — Superior Court of Justice","St. Catharines — Superior Court of Justice","Sudbury — Superior Court of Justice","Thunder Bay — Superior Court of Justice","Toronto — Superior Court of Justice","Windsor — Superior Court of Justice"],"pdfFieldName":"Courthouse","id":"courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","pdfFieldName":"Court file number","id":"court_file_number","autoFill":"court_file_number"},{"fieldId":"applicantFullName","label":"Applicant's full legal name","type":"text","source":"profile.applicant.fullName","required":true,"pdfFieldName":"Applicant full name","id":"applicant_full_name","autoFill":"applicant_full_name"},{"fieldId":"respondentFullName","label":"Respondent's full legal name","type":"text","source":"profile.respondent.fullName","required":true,"pdfFieldName":"Respondent full name","id":"respondent_full_name","autoFill":"respondent_full_name"},{"fieldId":"statementDate","label":"Date of this financial statement","type":"date","required":true,"helpText":"Use today's date or the date your situation is accurate as of.","pdfFieldName":"Statement date"},{"fieldId":"marriageDate","label":"Date of marriage","type":"date","required":false,"helpText":"Required for equalization calculations.","pdfFieldName":"Marriage date","id":"date_of_marriage","autoFill":"marriage_date"},{"fieldId":"separationDate","label":"Date of separation","type":"date","required":true,"helpText":"The valuation date for net family property is usually the date of separation.","pdfFieldName":"Separation date","id":"date_of_separation","autoFill":"separation_date"}]},{"partId":"employment","title":"Your employment and income","subtitle":"Step 2 of 9","intro":"Describe your current employment situation and sources of income.","fields":[{"fieldId":"employmentStatus","label":"What is your current employment status?","type":"select","required":true,"options":["Employed full-time","Employed part-time","Self-employed","Unemployed","On disability","Retired","Student","Other"],"pdfFieldName":"Employment status"},{"fieldId":"employerName","label":"Employer's name (if employed)","type":"text","required":false,"pdfFieldName":"Employer name"},{"fieldId":"employerAddress","label":"Employer's address","type":"text","required":false,"pdfFieldName":"Employer address"},{"fieldId":"occupation","label":"Your occupation or job title","type":"text","required":false,"placeholder":"e.g. Registered Nurse, Truck Driver, Project Manager","pdfFieldName":"Occupation"},{"fieldId":"annualEmploymentIncome","label":"Annual employment income (gross, before taxes)","type":"currency","required":true,"placeholder":"0.00","helpText":"Enter your yearly gross income from employment. Found on your T4 or pay stub.","pdfFieldName":"Annual employment income"},{"fieldId":"selfEmploymentIncome","label":"Annual self-employment income (net after business expenses)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Self employment income"},{"fieldId":"rentalIncome","label":"Annual rental income","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Rental income"},{"fieldId":"investmentIncome","label":"Annual investment / dividend income","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Investment income"},{"fieldId":"governmentBenefits","label":"Annual government benefits (EI, CPP, OAS, ODSP, Ontario Works, etc.)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Government benefits"},{"fieldId":"otherIncomeSources","label":"Other income sources (describe and amount)","type":"textarea","required":false,"placeholder":"e.g. Child tax benefit: $3,600/yr\nSpouse's support payments received: $12,000/yr","pdfFieldName":"Other income sources"},{"fieldId":"totalAnnualIncome","label":"Total annual income from ALL sources","type":"currency","required":true,"placeholder":"0.00","helpText":"Add up all the income amounts above.","pdfFieldName":"Total annual income"}]},{"partId":"monthlyExpenses","title":"Monthly expenses","subtitle":"Step 3 of 9","intro":"List your monthly living expenses. Include only what you actually pay — not expenses shared with the other party.","fields":[{"fieldId":"expenseRent","label":"Rent or mortgage payment","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense rent mortgage"},{"fieldId":"expensePropertyTax","label":"Property taxes (monthly)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense property tax"},{"fieldId":"expenseUtilities","label":"Utilities (hydro, gas, water, internet, phone)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense utilities"},{"fieldId":"expenseFood","label":"Food and groceries","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense food"},{"fieldId":"expenseTransportation","label":"Transportation (car payment, gas, insurance, transit)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense transportation"},{"fieldId":"expenseChildcare","label":"Childcare / daycare","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense childcare"},{"fieldId":"expenseHealthInsurance","label":"Health and dental insurance premiums","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense health insurance"},{"fieldId":"expenseMedical","label":"Medical and dental expenses not covered by insurance","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense medical"},{"fieldId":"expenseChildren","label":"Children's expenses (school, activities, clothing)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense children"},{"fieldId":"expenseDebtPayments","label":"Debt payments (credit cards, loans — minimum payments)","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Expense debt payments"},{"fieldId":"expenseOther","label":"Other monthly expenses (describe)","type":"textarea","required":false,"placeholder":"e.g. Life insurance: $80/mo\nGym membership: $45/mo","pdfFieldName":"Expense other"},{"fieldId":"totalMonthlyExpenses","label":"Total monthly expenses","type":"currency","required":true,"placeholder":"0.00","helpText":"Add up all monthly expenses above.","pdfFieldName":"Total monthly expenses"}]},{"partId":"assetsAtSeparation","title":"Assets on the date of separation (valuation date)","subtitle":"Step 4 of 9","intro":"List every asset you owned on the date of separation. These values are used to calculate your net family property (NFP). Be as accurate as possible — you may need appraisals for real estate and businesses.","fields":[{"fieldId":"realEstateAtSeparation","label":"Real estate owned on separation date (address and estimated value)","type":"textarea","required":false,"placeholder":"123 Main Street, Toronto ON — Family home — Value: $850,000\n456 Oak Avenue, Barrie ON — Rental property — Value: $420,000","helpText":"Include the matrimonial home and any other real estate. Use the fair market value on the date of separation.","pdfFieldName":"Real estate at separation"},{"fieldId":"bankAccountsAtSeparation","label":"Bank accounts on separation date (bank, account type, balance)","type":"textarea","required":false,"placeholder":"TD Bank — Chequing — $4,200\nRBC — Savings — $12,500\nTD Bank — Joint savings — $8,000 (my 50% share: $4,000)","pdfFieldName":"Bank accounts at separation"},{"fieldId":"investmentsAtSeparation","label":"Investments on separation date (RRSPs, TFSAs, stocks, GICs, etc.)","type":"textarea","required":false,"placeholder":"RBC RRSP — $45,000\nTD TFSA — $22,000\nFidelity stock portfolio — $15,000","pdfFieldName":"Investments at separation"},{"fieldId":"pensionAtSeparation","label":"Pension value on separation date","type":"currency","required":false,"placeholder":"0.00","helpText":"Get the commuted value from your pension administrator as of the separation date.","pdfFieldName":"Pension at separation"},{"fieldId":"vehiclesAtSeparation","label":"Vehicles on separation date (make, year, estimated value)","type":"textarea","required":false,"placeholder":"2019 Toyota Camry — $18,000\n2021 Honda Civic — $22,500","pdfFieldName":"Vehicles at separation"},{"fieldId":"businessInterestAtSeparation","label":"Business interests on separation date (name, your share, estimated value)","type":"textarea","required":false,"placeholder":"Lance Contracting Ltd. — 100% owner — Value: $75,000","helpText":"Businesses should be professionally valuated. Use a reasonable estimate if a valuation has not been done.","pdfFieldName":"Business interest at separation"},{"fieldId":"otherAssetsAtSeparation","label":"Other assets on separation date (jewellery, art, furniture, life insurance cash value, etc.)","type":"textarea","required":false,"placeholder":"Life insurance (cash surrender value): $8,500\nBoat and trailer: $12,000\nFurniture and household goods: $5,000","pdfFieldName":"Other assets at separation"},{"fieldId":"totalAssetsAtSeparation","label":"TOTAL value of all assets on date of separation","type":"currency","required":true,"placeholder":"0.00","helpText":"Add up all the asset values listed above.","pdfFieldName":"Total assets at separation"}]},{"partId":"debtsAtSeparation","title":"Debts on the date of separation","subtitle":"Step 5 of 9","intro":"List every debt you owed on the date of separation. Debts are subtracted from your assets to calculate your net family property.","fields":[{"fieldId":"mortgagesAtSeparation","label":"Mortgages on separation date (property, lender, balance owing)","type":"textarea","required":false,"placeholder":"123 Main Street — TD Bank mortgage — Balance: $420,000\n456 Oak Avenue — RBC mortgage — Balance: $210,000","pdfFieldName":"Mortgages at separation"},{"fieldId":"carLoansAtSeparation","label":"Car loans on separation date","type":"textarea","required":false,"placeholder":"2021 Honda Civic — TD Auto Finance — Balance: $14,500","pdfFieldName":"Car loans at separation"},{"fieldId":"creditCardsAtSeparation","label":"Credit card balances on separation date","type":"textarea","required":false,"placeholder":"TD Visa — $3,200\nRBC Mastercard — $1,800","pdfFieldName":"Credit cards at separation"},{"fieldId":"studentLoansAtSeparation","label":"Student loans on separation date","type":"currency","required":false,"placeholder":"0.00","pdfFieldName":"Student loans at separation"},{"fieldId":"otherDebtsAtSeparation","label":"Other debts on separation date (lines of credit, personal loans, taxes owing, etc.)","type":"textarea","required":false,"placeholder":"HELOC — RBC — Balance: $25,000\nPersonal loan — BMO — Balance: $8,000","pdfFieldName":"Other debts at separation"},{"fieldId":"totalDebtsAtSeparation","label":"TOTAL debts on date of separation","type":"currency","required":true,"placeholder":"0.00","helpText":"Add up all debt balances listed above.","pdfFieldName":"Total debts at separation"}]},{"partId":"propertyAtMarriage","title":"Property owned on date of marriage","subtitle":"Step 6 of 9","intro":"List assets and debts you had on the date of marriage. This amount is excluded from your net family property calculation (it was yours before the marriage).","fields":[{"fieldId":"assetsAtMarriage","label":"Assets you owned on the date of marriage (describe and value)","type":"textarea","required":false,"placeholder":"RBC savings account — $8,000\n2015 Dodge Ram — $25,000\nRRSP balance — $12,000","helpText":"These amounts will be deducted from your NFP calculation. Include only assets you personally owned on the wedding day.","pdfFieldName":"Assets at marriage"},{"fieldId":"debtsAtMarriage","label":"Debts you owed on the date of marriage","type":"textarea","required":false,"placeholder":"Student loan — $22,000\nVisa credit card — $1,500","helpText":"Debts at marriage are also excluded — they reduce your deduction from assets at marriage.","pdfFieldName":"Debts at marriage"},{"fieldId":"netPropertyAtMarriage","label":"Net value of property owned on date of marriage (assets minus debts)","type":"currency","required":false,"placeholder":"0.00","helpText":"Assets at marriage minus debts at marriage = this number. If negative, enter 0.","pdfFieldName":"Net property at marriage"}]},{"partId":"excludedProperty","title":"Excluded property","subtitle":"Step 7 of 9","intro":"Certain property received during the marriage is excluded from net family property under the Family Law Act. List any excluded property you have.","fields":[{"fieldId":"hasExcludedProperty","label":"Do you have any excluded property?","type":"yesno","required":true,"helpText":"Excluded property includes: gifts or inheritances received during marriage, damages from a personal injury lawsuit, life insurance proceeds, and property traced to any of the above.","pdfFieldName":"Has excluded property"},{"fieldId":"inheritances","label":"Inheritances received during marriage (amount and description)","type":"textarea","required":false,"conditional":{"dependsOn":"hasExcludedProperty","showWhen":"yes"},"placeholder":"Received from estate of John Smith (father) in 2019 — $45,000 cash\nInherited cottage in Muskoka — Value on date received: $180,000","pdfFieldName":"Inheritances"},{"fieldId":"giftsReceived","label":"Gifts received from third parties during marriage (not from spouse)","type":"textarea","required":false,"conditional":{"dependsOn":"hasExcludedProperty","showWhen":"yes"},"placeholder":"Gift from parents — $25,000 used as down payment — 2018","pdfFieldName":"Gifts received"},{"fieldId":"personalInjuryDamages","label":"Damages for personal injuries received during marriage","type":"currency","required":false,"conditional":{"dependsOn":"hasExcludedProperty","showWhen":"yes"},"placeholder":"0.00","helpText":"General damages for pain and suffering only — not for lost income.","pdfFieldName":"Personal injury damages"},{"fieldId":"totalExcludedProperty","label":"Total value of excluded property","type":"currency","required":false,"conditional":{"dependsOn":"hasExcludedProperty","showWhen":"yes"},"placeholder":"0.00","pdfFieldName":"Total excluded property"}]},{"partId":"netFamilyProperty","title":"Net Family Property calculation","subtitle":"Step 8 of 9","intro":"Net Family Property (NFP) is what the court uses to determine equalization. It is calculated as: Assets at separation − Debts at separation − Property owned at marriage − Excluded property = NFP. The spouse with the higher NFP pays the other half the difference.","fields":[{"fieldId":"nfpAssetsAtSeparation","label":"Total assets on date of separation (from Step 4)","type":"currency","source":"form.assetsAtSeparation.totalAssetsAtSeparation","required":true,"placeholder":"0.00","pdfFieldName":"NFP assets at separation"},{"fieldId":"nfpDebtsAtSeparation","label":"Total debts on date of separation (from Step 5)","type":"currency","source":"form.debtsAtSeparation.totalDebtsAtSeparation","required":true,"placeholder":"0.00","pdfFieldName":"NFP debts at separation"},{"fieldId":"nfpPropertyAtMarriage","label":"Net property owned on date of marriage (from Step 6)","type":"currency","source":"form.propertyAtMarriage.netPropertyAtMarriage","required":false,"placeholder":"0.00","pdfFieldName":"NFP property at marriage"},{"fieldId":"nfpExcludedProperty","label":"Total excluded property (from Step 7)","type":"currency","source":"form.excludedProperty.totalExcludedProperty","required":false,"placeholder":"0.00","pdfFieldName":"NFP excluded property"},{"fieldId":"nfpMatrimonialHomeDeduction","label":"Matrimonial home exclusion deduction (enter 0 if home is being claimed as part of equalization)","type":"currency","required":false,"placeholder":"0.00","helpText":"The matrimonial home cannot be excluded from NFP even if owned before marriage — enter 0 unless a special exception applies.","pdfFieldName":"NFP matrimonial home deduction"},{"fieldId":"netFamilyPropertyTotal","label":"YOUR Net Family Property total","type":"currency","required":true,"placeholder":"0.00","helpText":"Formula: Assets at Separation − Debts at Separation − Property at Marriage − Excluded Property = NFP. If the result is negative, enter 0.","pdfFieldName":"Net family property total"},{"fieldId":"equalizationPaymentClaimed","label":"Equalization payment you are claiming (if any)","type":"currency","required":false,"placeholder":"0.00","helpText":"If your NFP is lower than the other party's, you may claim half the difference. Leave blank if you are the party with the higher NFP.","pdfFieldName":"Equalization payment claimed"}]},{"partId":"currentAssets","title":"Current assets and debts (today)","subtitle":"Step 9 of 9","intro":"In addition to the valuation-date figures, the court also needs your current financial picture. This section covers where things stand today.","fields":[{"fieldId":"currentRealEstate","label":"Real estate you own today (address and current estimated value)","type":"textarea","required":false,"placeholder":"123 Main Street, Toronto ON — Current value: $920,000","pdfFieldName":"Current real estate"},{"fieldId":"currentBankAccounts","label":"Bank accounts today (bank, type, balance)","type":"textarea","required":false,"placeholder":"TD Bank — Chequing — $2,100\nRBC — Savings — $9,800","pdfFieldName":"Current bank accounts"},{"fieldId":"currentInvestments","label":"Investments today (RRSPs, TFSAs, stocks, etc.)","type":"textarea","required":false,"placeholder":"RBC RRSP — $52,000\nTD TFSA — $24,500","pdfFieldName":"Current investments"},{"fieldId":"currentDebts","label":"Debts you owe today (type, lender, balance)","type":"textarea","required":false,"placeholder":"TD Bank mortgage — $398,000\nRBC Mastercard — $2,100","pdfFieldName":"Current debts"},{"fieldId":"declarationConfirmed","label":"I swear or affirm that the information in this financial statement is accurate and complete to the best of my knowledge.","type":"checkbox","required":true,"helpText":"This form must be sworn or affirmed before a commissioner of oaths. Providing false information is contempt of court.","pdfFieldName":"Declaration confirmed"},{"fieldId":"signatureDate","label":"Date of signature","type":"date","required":true,"pdfFieldName":"Signature date"}]}]};
  window.__hp_formDefs['ON-F6B'] = {"formId":"ON-F6B","jurisdiction":"ON","pdfFileName":"form6b.pdf","title":"Form 6B \u2014 Affidavit of Service","subtitle":"Ontario Family Court \u2014 Family Law Rules","requiredPlan":"standard","freeForm":false,"helpIntro":"Form 6B is filed with the court to prove that you properly served the other party with your court documents. It must be completed by the person who actually did the serving \u2014 not you personally. The form is sworn before a commissioner for taking affidavits (a lawyer, notary public, or justice of the peace).","parts":[{"partId":"court","title":"Court information","subtitle":"Step 1 of 5","intro":"Enter the court file details. These must match exactly what appears on your other court documents.","fields":[{"fieldId":"courthouse","label":"Courthouse","type":"select","source":"profile.case.courthouse","required":true,"options":["Barrie \u2014 Superior Court of Justice","Brampton \u2014 Superior Court of Justice","Brantford \u2014 Superior Court of Justice","Cornwall \u2014 Superior Court of Justice","Hamilton \u2014 Superior Court of Justice","Kingston \u2014 Superior Court of Justice","Kitchener \u2014 Superior Court of Justice","London \u2014 Superior Court of Justice","Milton \u2014 Superior Court of Justice","Newmarket \u2014 Superior Court of Justice","Oshawa \u2014 Superior Court of Justice","Ottawa \u2014 Superior Court of Justice","Peterborough \u2014 Superior Court of Justice","St. Catharines \u2014 Superior Court of Justice","Sudbury \u2014 Superior Court of Justice","Thunder Bay \u2014 Superior Court of Justice","Toronto \u2014 Superior Court of Justice","Windsor \u2014 Superior Court of Justice"],"pdfFieldName":"Courthouse","autoFill":"courthouse"},{"fieldId":"fileNumber","label":"Court file number","type":"text","source":"profile.case.fileNumber","required":false,"placeholder":"e.g. FC-2024-12345","helpText":"Leave blank if a file number has not yet been assigned.","pdfFieldName":"Court file number","autoFill":"fileNumber"},{"fieldId":"applicant_name","label":"Applicant full legal name","type":"text","source":"profile.personal.fullName","required":true,"pdfFieldName":"Applicant Name","autoFill":"applicantName","placeholder":"First Middle Last"},{"fieldId":"applicant_address","label":"Applicant address for service","type":"text","required":true,"pdfFieldName":"Applicant Address","placeholder":"Street, City, Province, Postal Code"},{"fieldId":"respondent_name","label":"Respondent full legal name","type":"text","source":"profile.case.respondentName","required":true,"pdfFieldName":"Respondent Name","autoFill":"respondentName","placeholder":"First Middle Last"},{"fieldId":"respondent_address","label":"Respondent address for service","type":"text","required":false,"pdfFieldName":"Respondent Address","placeholder":"Street, City, Province, Postal Code"}]},{"partId":"server","title":"Who served the documents","subtitle":"Step 2 of 5","intro":"The person who physically delivered the documents must complete this section. This cannot be you \u2014 you cannot serve your own documents. It is usually a friend, adult family member, or process server.","fields":[{"fieldId":"serverFullName","label":"Server\u2019s full legal name","type":"text","required":true,"pdfFieldName":"Server Full Name","placeholder":"Full legal name of the person who served the documents","helpText":"This is the person swearing the affidavit \u2014 the one who did the serving."},{"fieldId":"serverAddress","label":"Server\u2019s municipality and province","type":"text","required":true,"pdfFieldName":"Server Address","placeholder":"e.g. Sudbury, Ontario","helpText":"The city and province where the server lives."},{"fieldId":"serverRelationship","label":"Server\u2019s relationship to the parties (if any)","type":"text","required":false,"pdfFieldName":"Server Relationship","placeholder":"e.g. Friend of the applicant, No relation, Process server","helpText":"If the server has no relationship to either party, write \u2018None\u2019."}]},{"partId":"service_details","title":"Service details","subtitle":"Step 3 of 5","intro":"Describe exactly when, where, and how the documents were delivered.","fields":[{"fieldId":"personServed","label":"Name of person who was served","type":"text","required":true,"pdfFieldName":"Person Served","placeholder":"Full legal name of the person who received the documents","helpText":"Usually the respondent. If served on a lawyer, enter the lawyer\u2019s name."},{"fieldId":"serviceDate","label":"Date of service","type":"date","required":true,"pdfFieldName":"Service Date","helpText":"The actual calendar date the documents were delivered."},{"fieldId":"serviceTime","label":"Time of service","type":"text","required":true,"pdfFieldName":"Service Time","placeholder":"e.g. 2:30 PM","helpText":"Approximate time of day the documents were handed over or sent."},{"fieldId":"serviceMethod","label":"How were the documents served?","type":"select","required":true,"options":["Special service \u2014 handed directly to the person","Mail","Same-day courier","Next-day courier","Email","Fax","Document exchange","Electronic document exchange","Substituted service (by court order)"],"pdfFieldName":"Service Method","helpText":"Choose the method that was actually used. For most family law applications, personal (special) service is required."},{"fieldId":"serviceAddress","label":"Address or location where service took place","type":"text","required":true,"pdfFieldName":"Service Address","placeholder":"e.g. 123 Main St, Sudbury, ON \u2014 respondent\u2019s residence","helpText":"For in-person service, the address where documents were handed over. For mail or email, the address or email used."},{"fieldId":"emailAddress","label":"Email address used (if served by email)","type":"email","required":false,"pdfFieldName":"Email Address","placeholder":"respondent@example.com","conditional":{"dependsOn":"serviceMethod","showWhen":"Email"}}]},{"partId":"documents_served","title":"Documents that were served","subtitle":"Step 4 of 5","intro":"List every document that was included in the package delivered to the other party. Each document needs its own entry.","fields":[{"fieldId":"documentsList","label":"List of documents served","type":"textarea","required":true,"pdfFieldName":"Documents List","placeholder":"Form 8 \u2014 Application (General) \u2014 signed July 8, 2026\nForm 35.1 \u2014 Affidavit (Parenting Time) \u2014 sworn July 8, 2026\nForm 13 \u2014 Financial Statement \u2014 sworn July 8, 2026","helpText":"Include the form number, name, and the date it was signed or sworn. Add one document per line."}]},{"partId":"commissioning","title":"Swearing the affidavit","subtitle":"Step 5 of 5","intro":"This affidavit must be signed in front of a commissioner for taking affidavits \u2014 a lawyer, justice of the peace, notary public, or court clerk. The server signs the form, not you.","fields":[{"fieldId":"commissioningDate","label":"Date the affidavit was sworn or affirmed","type":"date","required":true,"pdfFieldName":"Commissioning Date","helpText":"The date the server signed in front of the commissioner."},{"fieldId":"commissioningMunicipality","label":"Municipality where it was sworn","type":"text","required":true,"pdfFieldName":"Commissioning Municipality","placeholder":"e.g. Sudbury","helpText":"The city where the affidavit was signed and commissioned."},{"fieldId":"commissioningProvince","label":"Province","type":"text","required":true,"pdfFieldName":"Commissioning Province","placeholder":"Ontario"},{"fieldId":"review_accuracy","label":"I confirm the above information is accurate and ready for the server to review and sign before a commissioner.","type":"checkbox","required":true}]}]};

})();

// --- Hash Guard: block free users from navigating directly to locked forms ---
// Intercepts hash navigation to FormEngine wizard routes for non-free forms.
// Works alongside applyFormLocks (which handles form card clicks) to catch
// direct URL entry, browser back/forward, and programmatic navigation.
(function() {
  var FREE_FORM_KEYS = ['form8', 'on-f8'];

  function isLockedFormHash(hash) {
    if (!hash) return false;
    // FormEngine is launched via hash like #/case/2/wizard?formId=ON-F14
    // or #/wizard/ON-F14 etc.
    if (!hash.includes('wizard') && !hash.includes('formId')) return false;
    // Extract formId from query string
    var m = hash.match(/[?&]formId=([^&]+)/i);
    if (!m) {
      // Try to extract from path like #/wizard/ON-F14
      m = hash.match(/wizard\/([^/?&#]+)/i);
    }
    if (!m) return false;
    var fid = decodeURIComponent(m[1]).toLowerCase().replace(/[^a-z0-9_]/g, '');
    return !FREE_FORM_KEYS.includes(fid);
  }

  function checkHashForLock() {
    var hash = window.location.hash;
    if (!isLockedFormHash(hash)) return;
    // Check plan
    var isPaid = false;
    if (window.__hp_sub_status === 'active' && window.__hp_plan !== 'free') {
      isPaid = true;
    } else if (window.__hp_currentUser) {
      var u = window.__hp_currentUser;
      isPaid = (u.subscriptionStatus === 'active') && u.plan !== 'free';
    }
    if (isPaid) return;
    // Redirect back to dashboard
    window.location.hash = '#/dashboard';
    setTimeout(function() {
      if (typeof showUpgradeModal === 'function') showUpgradeModal('form');
    }, 300);
  }

  window.addEventListener('hashchange', function() {
    // Only block after plan data is loaded (2s grace period on cold load)
    if (window.__hp_sub_status !== undefined || window.__hp_currentUser) {
      checkHashForLock();
    }
  });

  // Also check on initial load after user data is ready
  window.addEventListener('hp:userready', checkHashForLock);
})();


// --- Account Settings Page ---
// Renders an in-app account settings page when hash is #/account-settings
// or when user clicks the account settings nav link.
// Handles: change password, manage subscription, account info.
(function() {
  var RAILWAY_ACCT = 'https://api-production-2334.up.railway.app';
  var TEAL_D = '#1E2D4E';
  var BURG   = '#1E2D4E';

  function renderAccountSettings() {
    // Find the main content area — replace its content
    var root = document.querySelector('[data-page="account-settings"]') ||
               document.getElementById('hp-account-settings-page');

    if (root) { root.remove(); }

    var user = window.__hp_currentUser;
    var plan = (user && user.plan) || window.__hp_plan || 'free';
    var status = (user && user.subscriptionStatus) || window.__hp_sub_status || null;
    var email = (user && user.email) || '';
    var isPaid = (status === 'active' || status === 'past_due') && plan !== 'free';
    var planLabel = plan === 'plus' ? 'Plus ($19.99/mo CAD)' :
                    plan === 'standard' ? 'Standard ($9.99/mo CAD)' : 'Free';
    var statusLabel = status === 'active' ? 'Active' :
                      status === 'past_due' ? 'Past Due' :
                      status === 'canceled' ? 'Cancelled' : 'No subscription';

    var page = document.createElement('div');
    page.id = 'hp-account-settings-page';
    page.setAttribute('data-page', 'account-settings');
    page.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#f8f5f0;overflow-y:auto;font-family:DM Sans,system-ui,sans-serif;padding-bottom:60px;';

    page.innerHTML = [
      // Header
      '<div style="background:' + TEAL_D + ';padding:20px 24px;display:flex;align-items:center;gap:16px;">',
        '<button id="hp-acct-back" style="background:transparent;border:none;color:#fff;font-size:22px;cursor:pointer;padding:0 8px 0 0;line-height:1;">&larr;</button>',
        '<div>',
          '<div style="font-size:11px;color:#7ecfcf;text-transform:uppercase;letter-spacing:0.1em;">Hearth &amp; Page</div>',
          '<div style="font-size:20px;font-weight:700;color:#fff;">Account Settings</div>',
        '</div>',
      '</div>',

      // Account info card
      '<div style="max-width:580px;margin:28px auto 0;padding:0 16px;">',

        '<div style="background:#fff;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,0.07);">',
          '<div style="font-size:13px;font-weight:700;color:' + TEAL_D + ';text-transform:uppercase;letter-spacing:0.07em;margin-bottom:14px;">Account</div>',
          '<div style="font-size:14px;color:#555;margin-bottom:6px;">Email address</div>',
          '<div style="font-size:16px;font-weight:600;color:#222;margin-bottom:16px;">' + email + '</div>',
          '<div style="font-size:14px;color:#555;margin-bottom:4px;">Plan</div>',
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">',
            '<span style="font-size:16px;font-weight:600;color:#222;">' + planLabel + '</span>',
            '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:' +
              (status === 'active' ? '#d1fae5' : status === 'past_due' ? '#fef3c7' : '#f3f4f6') +
              ';color:' +
              (status === 'active' ? '#065f46' : status === 'past_due' ? '#92400e' : '#6b7280') +
              ';">' + statusLabel + '</span>',
          '</div>',
        '</div>',

        // Subscription management
        '<div style="background:#fff;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,0.07);">',
          '<div style="font-size:13px;font-weight:700;color:' + TEAL_D + ';text-transform:uppercase;letter-spacing:0.07em;margin-bottom:14px;">Subscription</div>',
          isPaid ? [
            '<p style="font-size:14px;color:#555;margin:0 0 16px;line-height:1.5;">Manage your plan, update your payment method, or cancel your subscription through the billing portal.</p>',
            '<button id="hp-acct-portal" style="background:' + TEAL_D + ';color:#fff;border:none;border-radius:10px;padding:13px 22px;font-size:15px;font-weight:600;cursor:pointer;width:100%;">Manage Subscription &rarr;</button>',
          ].join('') : [
            '<p style="font-size:14px;color:#555;margin:0 0 16px;line-height:1.5;">You are on the free plan. Subscribe to access all 35 Ontario court forms and download court-ready PDFs.</p>',
            '<button id="hp-acct-std" style="background:' + TEAL_D + ';color:#fff;border:none;border-radius:10px;padding:13px 22px;font-size:15px;font-weight:600;cursor:pointer;width:100%;margin-bottom:8px;">Standard \u2014 $9.99/mo CAD</button>',
            '<button id="hp-acct-plus" style="background:' + BURG + ';color:#fff;border:none;border-radius:10px;padding:13px 22px;font-size:15px;font-weight:600;cursor:pointer;width:100%;">Plus \u2014 $19.99/mo CAD</button>',
          ].join(''),
        '</div>',

        // Change password
        '<div style="background:#fff;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,0.07);">',
          '<div style="font-size:13px;font-weight:700;color:' + TEAL_D + ';text-transform:uppercase;letter-spacing:0.07em;margin-bottom:14px;">Change Password</div>',
          '<div id="hp-pw-msg" style="display:none;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;"></div>',
          '<label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">Current password</label>',
          '<input id="hp-pw-current" type="password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px;">',
          '<label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">New password</label>',
          '<input id="hp-pw-new" type="password" placeholder="8+ characters" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px;">',
          '<label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">Confirm new password</label>',
          '<input id="hp-pw-confirm" type="password" placeholder="Repeat new password" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:16px;">',
          '<button id="hp-pw-submit" style="background:' + TEAL_D + ';color:#fff;border:none;border-radius:10px;padding:12px 22px;font-size:14px;font-weight:600;cursor:pointer;width:100%;">Update Password</button>',
        '</div>',

        // Danger zone
        '<div style="background:#fff;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,0.07);border:1px solid #fee2e2;">',
          '<div style="font-size:13px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">Danger Zone</div>',
          '<p style="font-size:13px;color:#555;margin:0 0 14px;line-height:1.5;">Permanently delete your account and all associated data. This cannot be undone.</p>',
          '<button id="hp-acct-delete" style="background:transparent;color:#dc2626;border:1.5px solid #dc2626;border-radius:10px;padding:11px 20px;font-size:14px;font-weight:600;cursor:pointer;">Delete My Account</button>',
        '</div>',

      '</div>',
    ].join('');

    document.body.appendChild(page);

    // Back button
    document.getElementById('hp-acct-back').addEventListener('click', function() {
      page.remove();
      window.history.back();
    });

    // Billing portal
    var portalBtn = document.getElementById('hp-acct-portal');
    if (portalBtn) {
      portalBtn.addEventListener('click', function() {
        portalBtn.textContent = 'Opening\u2026';
        portalBtn.disabled = true;
        fetch(RAILWAY_ACCT + '/api/stripe/billing-portal', {
          method: 'POST',
          headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
          body: JSON.stringify({ returnUrl: window.location.href })
        }).then(function(r){ return r.json(); })
          .then(function(d){ if (d && d.url) window.location.href = d.url; else { portalBtn.textContent = 'Manage Subscription \u2192'; portalBtn.disabled = false; } })
          .catch(function(){ portalBtn.textContent = 'Manage Subscription \u2192'; portalBtn.disabled = false; });
      });
    }

    // Subscribe buttons (free users)
    var stdBtn = document.getElementById('hp-acct-std');
    var plusBtn = document.getElementById('hp-acct-plus');
    function launchAcctCheckout(priceId, btn) {
      btn.disabled = true; btn.textContent = 'Opening checkout\u2026';
      fetch(RAILWAY_ACCT + '/api/stripe/create-checkout', {
        method: 'POST',
        headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
        body: JSON.stringify({ priceId: priceId, successUrl: window.location.href + '?checkout=success', cancelUrl: window.location.href })
      }).then(function(r){ return r.json(); })
        .then(function(d){ if (d && d.url) window.location.href = d.url; else { btn.disabled = false; btn.textContent = btn.id === 'hp-acct-std' ? 'Standard \u2014 $9.99/mo CAD' : 'Plus \u2014 $19.99/mo CAD'; } })
        .catch(function(){ btn.disabled = false; });
    }
    if (stdBtn) stdBtn.addEventListener('click', function() { launchAcctCheckout('price_1Tduf0DyokC7Tv7bDRAZBk57', stdBtn); });
    if (plusBtn) plusBtn.addEventListener('click', function() { launchAcctCheckout('price_1TduyXDyokC7Tv7bKKoeeh1v', plusBtn); });

    // Change password
    document.getElementById('hp-pw-submit').addEventListener('click', async function() {
      var btn = document.getElementById('hp-pw-submit');
      var msgEl = document.getElementById('hp-pw-msg');
      var cur = document.getElementById('hp-pw-current').value;
      var nw  = document.getElementById('hp-pw-new').value;
      var cnf = document.getElementById('hp-pw-confirm').value;

      function showMsg(msg, ok) {
        msgEl.style.display = 'block';
        msgEl.style.background = ok ? '#f0fdf4' : '#fef2f2';
        msgEl.style.border = '1px solid ' + (ok ? '#bbf7d0' : '#fecaca');
        msgEl.style.color  = ok ? '#15803d' : '#dc2626';
        msgEl.textContent  = msg;
      }

      if (!cur) { showMsg('Enter your current password.', false); return; }
      if (nw.length < 8) { showMsg('New password must be at least 8 characters.', false); return; }
      if (nw !== cnf) { showMsg('Passwords do not match.', false); return; }

      btn.disabled = true; btn.textContent = 'Updating\u2026';
      try {
        var resp = await fetch(RAILWAY_ACCT + '/api/auth/change-password', {
          method: 'POST',
          headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
          body: JSON.stringify({ currentPassword: cur, newPassword: nw })
        });
        var data = await resp.json();
        if (resp.ok) {
          showMsg('\u2713 Password updated successfully.', true);
          document.getElementById('hp-pw-current').value = '';
          document.getElementById('hp-pw-new').value = '';
          document.getElementById('hp-pw-confirm').value = '';
        } else {
          showMsg(data.message || 'Could not update password. Check your current password and try again.', false);
        }
      } catch(e) {
        showMsg('Network error. Please try again.', false);
      }
      btn.disabled = false; btn.textContent = 'Update Password';
    });

    // Delete account (with confirmation)
    document.getElementById('hp-acct-delete').addEventListener('click', function() {
      var confirmed = window.confirm(
        'Are you sure you want to permanently delete your Hearth & Page account?\n\n' +
        'All your cases, saved data, and subscription will be removed. This cannot be undone.'
      );
      if (!confirmed) return;
      fetch(RAILWAY_ACCT + '/api/account', {
        method: 'DELETE',
        headers: __authHdr()
      }).then(function(r){ return r.json(); })
        .then(function() {
          window.__hp_token = null;
          window.__hp_currentUser = null;
          localStorage.removeItem('hp_token');
          page.remove();
          window.location.hash = '#/';
          window.location.reload();
        }).catch(function() { alert('Could not delete account. Please contact support@hearthandpage.ca'); });
    });
  }

  // Open settings when hash changes to #/account-settings
  window.addEventListener('hashchange', function() {
    if (window.location.hash === '#/account-settings') {
      setTimeout(renderAccountSettings, 100);
    } else {
      var pg = document.getElementById('hp-account-settings-page');
      if (pg) pg.remove();
    }
  });

  // Intercept clicks on any settings link
  document.addEventListener('click', function(e) {
    var el = e.target.closest('a[href="#/account-settings"],a[href*="account-settings"],button[data-hp-settings]');
    if (el) {
      e.preventDefault();
      window.location.hash = '#/account-settings';
      setTimeout(renderAccountSettings, 100);
    }
  }, true);

  // Expose globally for nav patch
  window.__openAccountSettings = function() {
    window.location.hash = '#/account-settings';
    setTimeout(renderAccountSettings, 100);
  };

  // Inject "Settings" link into navbar account menu (MutationObserver)
  (function injectSettingsLink() {
    var injected = false;
    var obs = new MutationObserver(function() {
      if (injected) return;
      // Look for account menu items (Profile, Logout, etc.)
      var logoutEl = Array.from(document.querySelectorAll('a,button')).find(function(el) {
        return /log.?out|sign.?out/i.test(el.textContent || '');
      });
      if (!logoutEl) return;
      injected = true;
      obs.disconnect();

      if (document.querySelector('[data-hp-settings-link]')) return;
      var link = document.createElement('a');
      link.setAttribute('data-hp-settings-link', '1');
      link.href = '#/account-settings';
      link.textContent = 'Account Settings';
      link.style.cssText = 'display:block;padding:8px 16px;font-size:14px;color:#374151;text-decoration:none;cursor:pointer;';
      link.addEventListener('click', function(e) {
        e.preventDefault();
        window.__openAccountSettings();
      });
      logoutEl.parentNode.insertBefore(link, logoutEl);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function() { obs.disconnect(); }, 30000);
  })();
})();


// ============================================================================
// PDF REVIEW & PATCH SCREEN
// ============================================================================
(function() {
  'use strict';

  var RAILWAY_RP  = (typeof RAILWAY_EP !== 'undefined' ? RAILWAY_EP : 'https://api-production-2334.up.railway.app');
  var TEAL_RP     = '#1E2D4E';
  var AMBER_RP    = '#f59e0b';
  var GREEN_RP    = '#16a34a';
  var SURFACE_RP  = '#f0f4f7';
  var BORDER_RP   = '#d1dce3';

  function authHdr() {
    var tok = localStorage.getItem('hp_token') || sessionStorage.getItem('hp_token') || '';
    if (!tok) {
      // try window.__hp_token
      tok = (typeof window.__hp_token !== 'undefined') ? window.__hp_token : '';
    }
    return tok ? { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' }
               : { 'Content-Type': 'application/json' };
  }

  // ── Main entry point ──────────────────────────────────────────────────────
  window.__hp_showReviewPatch = async function(opts) {
    // opts: { caseId, formType, pdfKey, formLabel, onDownload }
    var caseId    = opts.caseId;
    var formType  = opts.formType;   // e.g. 'form13'
    var pdfKey    = opts.pdfKey || formType;
    var formLabel = opts.formLabel || 'Court Form';
    var onDownload = opts.onDownload; // callback once PDF is ready

    // ── Remove any existing panel ──
    var existing = document.getElementById('hp-review-patch');
    if (existing) existing.remove();

    // ── Fetch field list ──
    var fields = [];
    try {
      var resp = await fetch(RAILWAY_RP + '/api/cases/' + caseId + '/pdf-fields/' + formType, {
        headers: authHdr()
      });
      if (resp.ok) {
        var data = await resp.json();
        fields = data.fields || [];
      }
    } catch(e) { /* network error — show empty list */ }

    var blanks = fields.filter(function(f) { return f.isBlank; });
    var filled = fields.filter(function(f) { return !f.isBlank; });

    // ── Build panel HTML ──
    var panel = document.createElement('div');
    panel.id = 'hp-review-patch';
    panel.style.cssText = [
      'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);',
      'display:flex;align-items:center;justify-content:center;',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
    ].join('');

    var card = document.createElement('div');
    card.style.cssText = [
      'background:#fff;border-radius:16px;width:min(680px,96vw);max-height:90vh;',
      'display:flex;flex-direction:column;overflow:hidden;',
      'box-shadow:0 24px 64px rgba(0,0,0,0.22);'
    ].join('');

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'background:' + TEAL_RP + ';padding:20px 24px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
    header.innerHTML = [
      '<div>',
        '<div style="color:#fff;font-size:17px;font-weight:700;margin-bottom:2px;">Review Your Form</div>',
        '<div style="color:#b0ccd8;font-size:13px;">' + formLabel + '</div>',
      '</div>',
      '<div style="display:flex;gap:10px;align-items:center;">',
        '<button id="hp-rp-preview" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;">',
          '&#128065; Preview PDF',
        '</button>',
        '<button id="hp-rp-close" style="background:transparent;border:none;color:#b0ccd8;font-size:22px;cursor:pointer;line-height:1;padding:4px 8px;">&times;</button>',
      '</div>',
    ].join('');
    card.appendChild(header);

    // Summary bar
    var summary = document.createElement('div');
    summary.style.cssText = 'padding:14px 24px;background:' + SURFACE_RP + ';border-bottom:1px solid ' + BORDER_RP + ';flex-shrink:0;';
    var blankCount = blanks.length;
    summary.innerHTML = blankCount > 0
      ? '<span style="color:' + AMBER_RP + ';font-weight:700;font-size:14px;">&#9888; ' + blankCount + ' field' + (blankCount > 1 ? 's' : '') + ' need' + (blankCount === 1 ? 's' : '') + ' your attention</span>'
        + '<span style="color:#C8C0B0;font-size:13px;margin-left:12px;">Fill them in below before downloading</span>'
      : '<span style="color:' + GREEN_RP + ';font-weight:700;font-size:14px;">&#10003; All fields are filled</span>'
        + '<span style="color:#C8C0B0;font-size:13px;margin-left:12px;">Review below and download when ready</span>';
    card.appendChild(summary);

    // Scrollable body
    var body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:20px 24px;';

    // Patch tracking
    var patches = {}; // fieldId → new value

    function makeFieldRow(f, isBlank) {
      var row = document.createElement('div');
      row.style.cssText = [
        'padding:12px 14px;border-radius:10px;margin-bottom:8px;',
        'border:1px solid ' + (isBlank ? AMBER_RP : BORDER_RP) + ';',
        'background:' + (isBlank ? '#fffbeb' : '#fff') + ';',
      ].join('');

      var labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:12px;font-weight:600;color:' + (isBlank ? '#92400e' : '#2a3a5c') + ';margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em;';
      labelEl.textContent = f.label;
      row.appendChild(labelEl);

      if (f.partTitle) {
        var partEl = document.createElement('div');
        partEl.style.cssText = 'font-size:11px;color:#8a9baa;margin-bottom:6px;';
        partEl.textContent = f.partTitle;
        row.appendChild(partEl);
      }

      var input = document.createElement('input');
      input.type = 'text';
      input.value = f.currentValue || '';
      input.placeholder = isBlank ? 'Enter value\u2026' : '';
      input.dataset.fieldId = f.fieldId;
      input.style.cssText = [
        'width:100%;box-sizing:border-box;padding:8px 10px;',
        'border:1px solid ' + (isBlank ? AMBER_RP : BORDER_RP) + ';',
        'border-radius:6px;font-size:14px;color:#1a2b35;',
        'background:' + (isBlank ? '#fff' : SURFACE_RP) + ';',
        'outline:none;transition:border-color 0.2s;',
      ].join('');

      input.addEventListener('focus', function() { this.style.borderColor = TEAL_RP; });
      input.addEventListener('blur',  function() { this.style.borderColor = isBlank ? AMBER_RP : BORDER_RP; });
      input.addEventListener('input', function() {
        patches[f.fieldId] = this.value;
        // If blank field now has value, update row style
        if (this.value.trim()) {
          row.style.borderColor = BORDER_RP;
          row.style.background = '#fff';
          labelEl.style.color = '#2a3a5c';
          this.style.borderColor = BORDER_RP;
          this.style.background = SURFACE_RP;
        }
        // Update blank count in summary
        updateSummary();
      });

      row.appendChild(input);
      return row;
    }

    function updateSummary() {
      var stillBlank = 0;
      body.querySelectorAll('input[data-field-id]').forEach(function(inp) {
        var fid = inp.dataset.fieldId;
        var originallyBlank = blanks.some(function(b) { return b.fieldId === fid; });
        if (originallyBlank) {
          var val = patches[fid] !== undefined ? patches[fid] : '';
          if (!val.trim()) stillBlank++;
        }
      });
      summary.innerHTML = stillBlank > 0
        ? '<span style="color:' + AMBER_RP + ';font-weight:700;font-size:14px;">&#9888; ' + stillBlank + ' field' + (stillBlank > 1 ? 's' : '') + ' still need' + (stillBlank === 1 ? 's' : '') + ' attention</span>'
          + '<span style="color:#C8C0B0;font-size:13px;margin-left:12px;">Fill them in below before downloading</span>'
        : '<span style="color:' + GREEN_RP + ';font-weight:700;font-size:14px;">&#10003; All fields are filled</span>'
          + '<span style="color:#C8C0B0;font-size:13px;margin-left:12px;">Review below and download when ready</span>';
    }

    // Blanks section
    if (blanks.length > 0) {
      var blankHeader = document.createElement('div');
      blankHeader.style.cssText = 'font-size:13px;font-weight:700;color:#92400e;margin-bottom:10px;display:flex;align-items:center;gap:6px;';
      blankHeader.innerHTML = '<span style="background:' + AMBER_RP + ';color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;">' + blanks.length + '</span> Needs Attention';
      body.appendChild(blankHeader);
      blanks.forEach(function(f) { body.appendChild(makeFieldRow(f, true)); });
    }

    // Filled section
    if (filled.length > 0) {
      var filledHeader = document.createElement('div');
      filledHeader.style.cssText = 'font-size:13px;font-weight:700;color:#2a3a5c;margin:' + (blanks.length > 0 ? '20px' : '0') + ' 0 10px;display:flex;align-items:center;gap:6px;';
      filledHeader.innerHTML = '<span style="background:' + GREEN_RP + ';color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;">&#10003;</span> Filled (' + filled.length + ')';
      body.appendChild(filledHeader);
      filled.forEach(function(f) { body.appendChild(makeFieldRow(f, false)); });
    }

    if (fields.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.style.cssText = 'text-align:center;color:#C8C0B0;padding:40px 20px;font-size:14px;';
      emptyMsg.textContent = 'All fields are ready. Click "Save & Download PDF" to generate your form.';
      body.appendChild(emptyMsg);
    }

    card.appendChild(body);

    // Footer
    var footer = document.createElement('div');
    footer.style.cssText = 'padding:16px 24px;border-top:1px solid ' + BORDER_RP + ';display:flex;gap:12px;align-items:center;flex-shrink:0;background:#fff;';
    footer.innerHTML = [
      '<button id="hp-rp-back" style="flex:1;padding:12px;border:1px solid ' + BORDER_RP + ';background:#fff;border-radius:10px;font-size:14px;font-weight:600;color:#2a3a5c;cursor:pointer;">',
        '&#8592; Back to Wizard',
      '</button>',
      '<button id="hp-rp-save" style="flex:2;padding:12px;background:' + TEAL_RP + ';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;">',
        'Save &amp; Download PDF',
      '</button>',
    ].join('');
    card.appendChild(footer);

    panel.appendChild(card);
    document.body.appendChild(panel);

    // ── Status message helper ──
    var statusMsg = null;
    function showRPStatus(msg, type) {
      if (!statusMsg) {
        statusMsg = document.createElement('div');
        statusMsg.style.cssText = 'padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-top:10px;text-align:center;';
        footer.appendChild(statusMsg);
      }
      statusMsg.textContent = msg;
      statusMsg.style.background = type === 'error' ? '#fef2f2' : type === 'success' ? '#f0fdf4' : '#f0f4f7';
      statusMsg.style.color = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1E2D4E';
      statusMsg.style.display = 'block';
    }

    // ── Close button ──
    document.getElementById('hp-rp-close').addEventListener('click', function() {
      panel.remove();
    });

    // ── Back button ──
    document.getElementById('hp-rp-back').addEventListener('click', function() {
      panel.remove();
    });

    // ── Preview PDF modal ──
    document.getElementById('hp-rp-preview').addEventListener('click', async function() {
      var previewModal = document.getElementById('hp-rp-preview-modal');
      if (previewModal) { previewModal.remove(); return; }

      var resolvedCaseId = caseId;
      var modal = document.createElement('div');
      modal.id = 'hp-rp-preview-modal';
      modal.style.cssText = [
        'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.7);',
        'display:flex;align-items:center;justify-content:center;',
      ].join('');

      var mcard = document.createElement('div');
      mcard.style.cssText = 'background:#fff;border-radius:12px;width:min(800px,95vw);height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,0.3);';

      var mheader = document.createElement('div');
      mheader.style.cssText = 'padding:16px 20px;background:#f0f4f7;border-bottom:1px solid #d1dce3;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;';
      mheader.innerHTML = [
        '<span style="font-weight:700;font-size:15px;color:#1E2D4E;">' + formLabel + ' — Preview</span>',
        '<div style="display:flex;gap:10px;align-items:center;">',
          '<span style="font-size:12px;color:#C8C0B0;">This is the current saved state. Edits on the review screen will appear after Save &amp; Download.</span>',
          '<button id="hp-rp-modal-close" style="background:#1E2D4E;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;">Close</button>',
        '</div>',
      ].join('');

      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'flex:1;border:none;';
      iframe.src = RAILWAY_RP + '/api/cases/' + resolvedCaseId + '/official-pdf/' + pdfKey + '?preview=1&t=' + Date.now();

      // Use a POST-based URL via object URL trick if needed — for now use the inline endpoint
      // We'll fetch the PDF and load it as a blob URL
      (async function() {
        try {
          var previewResp = await fetch(RAILWAY_RP + '/api/cases/' + resolvedCaseId + '/official-pdf/' + pdfKey, {
            method: 'POST',
            headers: authHdr()
          });
          if (previewResp.ok) {
            var blob = await previewResp.blob();
            var blobUrl = URL.createObjectURL(blob);
            iframe.src = blobUrl;
          }
        } catch(e) { iframe.src = 'about:blank'; }
      })();

      mcard.appendChild(mheader);
      mcard.appendChild(iframe);
      modal.appendChild(mcard);
      document.body.appendChild(modal);

      document.getElementById('hp-rp-modal-close').addEventListener('click', function() { modal.remove(); });
      modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
    });

    // ── Save & Download ──
    var saveBtn = document.getElementById('hp-rp-save');
    saveBtn.addEventListener('click', async function() {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving\u2026';

      try {
        // 1. Save any patches back to case
        var patchList = Object.keys(patches).map(function(fid) {
          return { fieldId: fid, value: patches[fid], section: '__patch__' };
        });

        // Also collect all currently-visible inputs (in case user edited filled fields)
        var allInputs = body.querySelectorAll('input[data-field-id]');
        allInputs.forEach(function(inp) {
          var fid = inp.dataset.fieldId;
          if (patches[fid] === undefined) {
            // Check if value changed from original
            var orig = (fields.find(function(f) { return f.fieldId === fid; }) || {}).currentValue || '';
            if (inp.value !== orig) {
              patchList.push({ fieldId: fid, value: inp.value, section: '__patch__' });
            }
          }
        });

        if (patchList.length > 0) {
          saveBtn.textContent = 'Saving ' + patchList.length + ' change' + (patchList.length > 1 ? 's' : '') + '\u2026';
          var patchResp = await fetch(RAILWAY_RP + '/api/cases/' + caseId + '/pdf-fields/' + formType, {
            method: 'PATCH',
            headers: authHdr(),
            body: JSON.stringify(patchList)
          });
          if (!patchResp.ok) {
            showRPStatus('Failed to save changes. Please try again.', 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save & Download PDF';
            return;
          }
        }

        // 2. Generate and download PDF
        saveBtn.textContent = 'Generating PDF\u2026';
        var resolvedCaseId = caseId;
        var dlResp = await fetch(RAILWAY_RP + '/api/cases/' + resolvedCaseId + '/official-pdf/' + pdfKey, {
          method: 'POST',
          headers: authHdr()
        });

        if (dlResp.status === 403) {
          panel.remove();
          if (typeof showUpgradeModal === 'function') showUpgradeModal('pdf');
          return;
        }

        if (!dlResp.ok) {
          showRPStatus('Could not generate PDF. Please try again.', 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save & Download PDF';
          return;
        }

        var blob = await dlResp.blob();
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = await window.__hp_scjFilename(formLabel, window.__hp_currentCaseId, 'Applicant');
        document.body.appendChild(a);
        a.click();
        setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 3000);

        showRPStatus('\u2713 Your PDF has been downloaded!', 'success');
        saveBtn.textContent = '\u2713 Downloaded';
        setTimeout(function() {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save & Download PDF';
        }, 4000);

        if (typeof onDownload === 'function') onDownload();

      } catch(err) {
        showRPStatus('Network error. Please try again.', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save & Download PDF';
      }
    });

    // Close on backdrop click
    panel.addEventListener('click', function(e) { if (e.target === panel) panel.remove(); });
  };

})();

// ═══════════════════════════════════════════════════════════════════════════════
// HP PRE-EXPORT VALIDATION — v1.0
// Runs automatically when the user clicks "Download Official Court PDF".
// Fetches saved form_data from the API, checks all mandatory fields (including
// conditional ones), then either shows a blocking warning modal or lets the
// download proceed.
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
  var RAILWAY_EP = 'https://api-production-2334.up.railway.app';
  var TEAL_D  = '#1E2D4E';
  var AMBER   = '#92400E';
  var AMBER_BG= '#FFFBEB';
  var AMBER_BR= '#FCD34D';

  // ── 1. VALIDATION RULES ───────────────────────────────────────────────────
  // Each rule: { label, test(flat) → true=OK / false=FAIL, section, step }
  // `flat` is a plain {fieldKey: fieldValue} dict assembled from form_data rows.
  //
  // Rules are form-aware:
  //  - Conditional fields are only checked when their parent condition is met
  //  - Claims block just needs ≥ 1 claim selected
  //  - Children block scales with childrenCount

  var FORM8_RULES = [
    // ── Court ──
    { step: 'Step 1 — Court', label: 'Courthouse',
      test: function(d) { return !!trim(d.courthouse || d.court_name); } },
    { step: 'Step 1 — Court', label: 'Do you have an existing court file? (Yes or No)',
      test: function(d) { return notEmpty(d.hasFile); } },
    { step: 'Step 1 — Court', label: 'Have there been prior court orders? (Yes or No)',
      test: function(d) { return notEmpty(d.hasPriorOrders); } },

    // ── Applicant ──
    { step: 'Step 2 — About You', label: 'Your full legal name',
      test: function(d) { return !!trim(d.applicantFullName || d.applicant_full_name); } },
    { step: 'Step 2 — About You', label: 'Your date of birth',
      test: function(d) { return !!trim(d.applicantDob || d.applicant_dob); } },
    { step: 'Step 2 — About You', label: 'Your gender',
      test: function(d) { return !!trim(d.applicantGender || d.applicant_gender); } },
    { step: 'Step 2 — About You', label: 'Your street address',
      test: function(d) { return !!trim(d.applicantAddress || d.applicant_address || d.applicant_street); } },
    { step: 'Step 2 — About You', label: 'Your city or town',
      test: function(d) { return !!trim(d.applicantCity || d.applicant_city); } },
    { step: 'Step 2 — About You', label: 'Your postal code',
      test: function(d) { return !!trim(d.applicantPostalCode || d.applicant_postal_code); } },
    { step: 'Step 2 — About You', label: 'Your phone number',
      test: function(d) { return !!trim(d.applicantPhone || d.applicant_phone); } },

    // ── Respondent ──
    { step: 'Step 3 — Other Party', label: "Other party\u2019s full legal name",
      test: function(d) { return !!trim(d.respondentFullName || d.respondent_full_name); } },
    { step: 'Step 3 — Other Party', label: 'Does the other party have a lawyer? (Yes or No)',
      test: function(d) { return notEmpty(d.respondentHasLawyer); } },

    // ── Children ──
    { step: 'Step 4 — Children', label: 'Number of children involved',
      test: function(d) { return !!trim(d.childrenCount || d.children_count); } },
    { step: 'Step 4 — Children', label: 'Child 1 — Full name',
      test: function(d) {
        if (!hasChildren(d)) return true; // skip if 0 children (edge case)
        return !!trim(d.child1Name || d.child_1_name);
      }
    },
    { step: 'Step 4 — Children', label: 'Child 1 — Date of birth',
      test: function(d) {
        if (!hasChildren(d)) return true;
        return !!trim(d.child1Dob || d.child_1_dob);
      }
    },
    { step: 'Step 4 — Children', label: 'Child 1 — Currently lives with',
      test: function(d) {
        if (!hasChildren(d)) return true;
        return !!trim(d.child1Residence || d.child_1_residence);
      }
    },
    // Child 2 — only required when childrenCount >= 2
    { step: 'Step 4 — Children', label: 'Child 2 — Full name',
      test: function(d) {
        if (childCount(d) < 2) return true;
        return !!trim(d.child2Name || d.child_2_name);
      }
    },
    { step: 'Step 4 — Children', label: 'Child 2 — Date of birth',
      test: function(d) {
        if (childCount(d) < 2) return true;
        return !!trim(d.child2Dob || d.child_2_dob);
      }
    },
    { step: 'Step 4 — Children', label: 'Child 2 — Currently lives with',
      test: function(d) {
        if (childCount(d) < 2) return true;
        return !!trim(d.child2Residence || d.child_2_residence);
      }
    },
    // Child 3
    { step: 'Step 4 — Children', label: 'Child 3 — Full name',
      test: function(d) {
        if (childCount(d) < 3) return true;
        return !!trim(d.child3Name || d.child_3_name);
      }
    },
    { step: 'Step 4 — Children', label: 'Child 3 — Date of birth',
      test: function(d) {
        if (childCount(d) < 3) return true;
        return !!trim(d.child3Dob || d.child_3_dob);
      }
    },
    { step: 'Step 4 — Children', label: 'Child 3 — Currently lives with',
      test: function(d) {
        if (childCount(d) < 3) return true;
        return !!trim(d.child3Residence || d.child_3_residence);
      }
    },

    // ── Claims — at least one must be selected ──
    { step: 'Step 5 — What You\u2019re Asking For', label: 'At least one claim must be selected (e.g. custody, child support)',
      test: function(d) {
        return isYes(d.claimCustody)        || isYes(d.claim_custody)
            || isYes(d.claimAccess)         || isYes(d.claim_access)
            || isYes(d.claimChildSupport)   || isYes(d.claim_child_support)
            || isYes(d.claimSpousalSupport) || isYes(d.claim_spousal_support)
            || isYes(d.claimPropertyDivision)
            || isYes(d.claimRestrainingOrder)
            || isYes(d.claimOther)          || isYes(d.claim_other);
      }
    },

    // ── Situation ──
    { step: 'Step 6 — Your Situation', label: 'Your relationship type (married / common-law / never lived together)',
      test: function(d) { return !!trim(d.relationshipType || d.relationship_type); } },
    { step: 'Step 6 — Your Situation', label: 'Date of separation',
      test: function(d) { return !!trim(d.separationDate || d.separation_date); } },
    { step: 'Step 6 — Your Situation', label: 'Brief description of your situation (why you are coming to court)',
      test: function(d) { return !!trim(d.situationSummary || d.situation_summary); } },

    // ── Declaration ──
    { step: 'Step 7 — Review & Confirm', label: 'Declaration checkbox must be confirmed',
      test: function(d) { return isYes(d.declarationConfirmed || d.declaration_confirmed); } },
  ];

  // Per-form rule registry — add more forms here as they are built
  var FORM_RULES = {
    form8:   FORM8_RULES,
    // form13, form14a, etc. can be added later following the same pattern
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  function trim(v) { return v != null ? String(v).trim() : ''; }
  function notEmpty(v) {
    if (v == null) return false;
    var s = String(v).trim().toLowerCase();
    return s !== '' && s !== 'null' && s !== 'undefined';
  }
  function isYes(v) {
    if (v == null || v === '') return false;
    var s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }
  function childCount(d) {
    var raw = d.childrenCount || d.children_count || '0';
    var n = parseInt(String(raw), 10);
    return isNaN(n) ? 0 : n;
  }
  function hasChildren(d) { return childCount(d) > 0; }

  // ── 2. FETCH + FLATTEN form_data ──────────────────────────────────────────
  async function fetchFormData(caseId) {
    try {
      var resp = await fetch(
        RAILWAY_EP + '/api/cases/' + caseId + '/form-data',
        { headers: __authHdr() }
      );
      if (!resp.ok) return null;
      var rows = await resp.json();
      var flat = {};
      if (Array.isArray(rows)) {
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          // Store under fieldKey directly — covers both camelCase and snake_case
          if (row.fieldKey)  flat[row.fieldKey]  = row.fieldValue;
          if (row.field_key) flat[row.field_key] = row.field_value;
        }
      }
      return flat;
    } catch(e) {
      console.warn('[hp-validate] Could not fetch form data:', e);
      return null;
    }
  }

  // ── 3. RUN VALIDATION ─────────────────────────────────────────────────────
  function runValidation(flat, formKey) {
    var rules = FORM_RULES[formKey] || FORM_RULES['form8'];
    var errors = [];
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      try {
        if (!rule.test(flat)) {
          errors.push({ step: rule.step, label: rule.label });
        }
      } catch(e) {
        console.warn('[hp-validate] Rule error for "' + rule.label + '":', e);
      }
    }
    return errors;
  }

  // ── 4. WARNING MODAL ──────────────────────────────────────────────────────
  function showValidationModal(errors, onProceed) {
    // Group errors by step
    var byStep = {};
    var stepOrder = [];
    for (var i = 0; i < errors.length; i++) {
      var e = errors[i];
      if (!byStep[e.step]) {
        byStep[e.step] = [];
        stepOrder.push(e.step);
      }
      byStep[e.step].push(e.label);
    }

    // Build the grouped list HTML
    var listHTML = '';
    for (var s = 0; s < stepOrder.length; s++) {
      var step = stepOrder[s];
      var items = byStep[step];
      listHTML += '<div style="margin-bottom:14px;">';
      listHTML += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:' + AMBER + ';margin-bottom:6px;">' + step + '</div>';
      listHTML += '<ul style="margin:0;padding-left:18px;list-style:disc;">';
      for (var j = 0; j < items.length; j++) {
        listHTML += '<li style="font-size:13px;color:#374151;margin-bottom:3px;">' + items[j] + '</li>';
      }
      listHTML += '</ul></div>';
    }

    var modal = document.createElement('div');
    modal.id = 'hp-validation-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;';

    modal.innerHTML =
      '<div style="background:#fff;border-radius:16px;max-width:500px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.3);overflow:hidden;">' +

        // Header bar — amber
        '<div style="background:' + AMBER_BG + ';border-bottom:1px solid ' + AMBER_BR + ';padding:20px 24px 16px;">' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
            '<div style="width:40px;height:40px;flex-shrink:0;border-radius:10px;background:' + AMBER_BR + ';display:flex;align-items:center;justify-content:center;">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + AMBER + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:16px;font-weight:700;color:#1c1917;">Before you export — ' + errors.length + ' field' + (errors.length === 1 ? '' : 's') + ' need' + (errors.length === 1 ? 's' : '') + ' attention</div>' +
              '<div style="font-size:12px;color:#78716c;margin-top:2px;">The court may reject an incomplete form. Please fill in these fields first.</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Scrollable field list
        '<div id="hp-val-list" style="padding:20px 24px;max-height:320px;overflow-y:auto;">' +
          listHTML +
        '</div>' +

        // Footer buttons
        '<div style="padding:16px 24px 20px;border-top:1px solid #f3f4f6;display:flex;gap:10px;flex-wrap:wrap;">' +
          '<button id="hp-val-go-back" style="flex:1;min-width:120px;background:' + TEAL_D + ';color:#fff;border:none;border-radius:9px;padding:12px 16px;font-size:14px;font-weight:600;cursor:pointer;">Go back &amp; fix</button>' +
          '<button id="hp-val-proceed" style="flex:1;min-width:120px;background:transparent;color:#6b7280;border:1px solid #d1d5db;border-radius:9px;padding:12px 16px;font-size:14px;cursor:pointer;">Export anyway</button>' +
        '</div>' +

        '<p style="margin:0 0 14px;font-size:10px;color:#d1d5db;text-align:center;padding:0 24px;">Hearth &amp; Page &bull; hearthandpage.ca</p>' +
      '</div>';

    document.body.appendChild(modal);

    document.getElementById('hp-val-go-back').addEventListener('click', function() {
      modal.remove();
      // Don't proceed — user goes back to fix fields
    });

    document.getElementById('hp-val-proceed').addEventListener('click', function() {
      modal.remove();
      if (typeof onProceed === 'function') onProceed();
    });

    // Backdrop click = go back (safe default)
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  }

  // ── 5. HOOK INTO EXPORT PANEL ─────────────────────────────────────────────
  // We wrap window.__openExportPanel so that every time it fires, we intercept
  // the Download button click and run validation first.
  var _originalOpenExportPanel = null;

  function patchExportPanel() {
    if (!window.__openExportPanel || window.__hp_validationPatched) return;
    window.__hp_validationPatched = true;

    _originalOpenExportPanel = window.__openExportPanel;

    window.__openExportPanel = function(caseId, formId) {
      // Call the original to build the panel UI
      _originalOpenExportPanel.call(this, caseId, formId);

      // Give the panel a tick to render, then intercept the download button
      requestAnimationFrame(function() {
        var dlBtn = document.getElementById('hp-ep-download');
        if (!dlBtn) return;

        // Determine formKey for rule lookup
        var pdfKey = (formId || 'form8').replace(/^ON-F/i, 'form').toLowerCase();

        // Resolve caseId (same logic as the original panel)
        var resolvedCaseId = caseId;
        if (!resolvedCaseId) {
          var hm = window.location.hash.match(/case[s]?\/([0-9]+)/);
          resolvedCaseId = hm ? hm[1] : '1';
        }

        // Wrap the click: validate first, then let the original handler fire
        dlBtn.addEventListener('click', async function(e) {
          // Only run validation if we have rules for this form
          if (!FORM_RULES[pdfKey]) return; // no rules = pass through

          // Prevent the original handler firing immediately
          e.stopImmediatePropagation();

          // Show inline "Checking…" state
          var origText = dlBtn.textContent;
          dlBtn.disabled = true;
          dlBtn.textContent = 'Checking form…';

          var flat = await fetchFormData(resolvedCaseId);

          dlBtn.disabled = false;
          dlBtn.textContent = origText;

          if (!flat) {
            // Network failure — let user proceed (don't block on connectivity issues)
            dlBtn.click();
            return;
          }

          var errors = runValidation(flat, pdfKey);

          if (errors.length === 0) {
            // All good — synthetically re-trigger the original listener
            // We stored it in __hp_dl_origHandler on the button
            if (typeof dlBtn.__hp_dl_origHandler === 'function') {
              dlBtn.__hp_dl_origHandler();
            } else {
              // Fallback: clone button to trigger original listener stack
              var clone = dlBtn.cloneNode(true);
              dlBtn.parentNode.replaceChild(clone, dlBtn);
              clone.click();
            }
            return;
          }

          // Errors found — show blocking modal
          showValidationModal(errors, function() {
            // User chose "Export anyway" — fire original handler
            if (typeof dlBtn.__hp_dl_origHandler === 'function') {
              dlBtn.__hp_dl_origHandler();
            } else {
              var clone2 = dlBtn.cloneNode(true);
              dlBtn.parentNode.replaceChild(clone2, dlBtn);
              clone2.click();
            }
          });

        }, true); // capture phase so we intercept before existing listeners

      });
    };
  }

  // Run patch immediately if __openExportPanel already exists, otherwise
  // wait for it to be defined (it's set later in the same file)
  if (window.__openExportPanel) {
    patchExportPanel();
  } else {
    var _patchTimer = setInterval(function() {
      if (window.__openExportPanel) {
        clearInterval(_patchTimer);
        patchExportPanel();
      }
    }, 200);
  }

  // ── 6. EXPOSE VALIDATOR PUBLICLY for testing / external calls ────────────
  window.__hp_validateForm = async function(caseId, formKey) {
    var flat = await fetchFormData(caseId || window.__hp_currentCaseId || '1');
    if (!flat) return { ok: false, error: 'Could not fetch form data' };
    var errors = runValidation(flat, formKey || 'form8');
    return { ok: errors.length === 0, errors: errors, count: errors.length };
  };

})();

// ═══════════════════════════════════════════════════════════════════════════════
// CASE PACKAGE SCREEN  ·  Route: /#/case/:id/package
// Intercepts post-quiz case creation and shows the recommended form bundle.
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
  'use strict';

  var RW = 'https://api-production-2334.up.railway.app';

  // ── Package definitions ────────────────────────────────────────────────────
  var PACKAGES = [
    {
      id: 'PKG-DIV-SIMPLE',
      label: 'Divorce Only',
      description: 'You were married and want a divorce, with no children, support, or property issues.',
      icon: '⚖️',
      forms: ['form8a-divorce','form36-divorce-affidavit','form6b-service','form36a-certificate-clerk-divorce'],
      formLabels: ['Form 8A — Application (Divorce)','Form 36 — Affidavit for Divorce','Form 6B — Affidavit of Service','Form 36A — Certificate (Clerk of Court)']
    },
    {
      id: 'PKG-DIV-PARENT',
      label: 'Divorce + Parenting',
      description: 'Married couple seeking divorce and parenting/custody arrangements for your children.',
      icon: '👨‍👩‍👧',
      forms: ['form8-general','form35-affidavit','form13-financial','form6b-service','form36-divorce-affidavit'],
      formLabels: ['Form 8 — Application (General)','Form 35.1 — Affidavit (Parenting)','Form 13 — Financial Statement','Form 6B — Affidavit of Service','Form 36 — Affidavit for Divorce']
    },
    {
      id: 'PKG-PARENT-ONLY',
      label: 'Parenting (No Divorce)',
      description: 'You were not married, or are already divorced, and need parenting or custody orders.',
      icon: '🏠',
      forms: ['form8-general','form35-affidavit','form13-financial','form6b-service'],
      formLabels: ['Form 8 — Application (General)','Form 35.1 — Affidavit (Parenting)','Form 13 — Financial Statement','Form 6B — Affidavit of Service']
    },
    {
      id: 'PKG-SUPPORT-CHILD',
      label: 'Child Support Only',
      description: 'You need a child support order or want to enforce an existing one.',
      icon: '💰',
      forms: ['form8-general','form13-financial','form6b-service'],
      formLabels: ['Form 8 — Application (General)','Form 13 — Financial Statement','Form 6B — Affidavit of Service']
    },
    {
      id: 'PKG-FULL-APP',
      label: 'Full Family Application',
      description: 'You need orders for parenting, support, and property — a comprehensive application.',
      icon: '📋',
      forms: ['form8-general','form35-affidavit','form13-financial','form13_1-financial-property','form6b-service'],
      formLabels: ['Form 8 — Application (General)','Form 35.1 — Affidavit (Parenting)','Form 13 — Financial Statement','Form 13.1 — Net Family Property Statement','Form 6B — Affidavit of Service']
    },
    {
      id: 'PKG-RESPOND',
      label: 'Responding to Application',
      description: 'You received court papers and need to respond to the other party\'s application.',
      icon: '📬',
      forms: ['form10-answer','form6b-service'],
      formLabels: ['Form 10 — Answer','Form 6B — Affidavit of Service']
    },
    {
      id: 'PKG-CHANGE',
      label: 'Motion to Change',
      description: 'You have an existing court order and need to change custody, support, or access.',
      icon: '🔄',
      forms: ['form15-motion-to-change','form13-financial','form6b-service'],
      formLabels: ['Form 15 — Motion to Change','Form 13 — Financial Statement','Form 6B — Affidavit of Service']
    },
    {
      id: 'PKG-PROPERTY',
      label: 'Property Division',
      description: 'You were married and need to divide property and assets.',
      icon: '🏡',
      forms: ['form8-general','form13-financial','form13_1-financial-property','form6b-service'],
      formLabels: ['Form 8 — Application (General)','Form 13 — Financial Statement','Form 13.1 — Net Family Property Statement','Form 6B — Affidavit of Service']
    }
  ];

  // ── Infer package from quiz answers encoded in caseType string ─────────────
  function inferPackage(caseTypeStr) {
    var forms = (caseTypeStr || '').split(',').map(function(f){ return f.trim(); });
    var has = function(f){ return forms.some(function(x){ return x.indexOf(f) === 0; }); };

    // Respondent path
    if (has('form10')) return 'PKG-RESPOND';
    // Motion to change
    if (has('form15')) return 'PKG-CHANGE';
    // Divorce + parenting
    if (has('form8a') && (has('form35') || has('form13'))) return 'PKG-DIV-PARENT';
    // Divorce only
    if (has('form8a') || has('form36')) return 'PKG-DIV-SIMPLE';
    // Full app (parenting + property)
    if (has('form13_1') || has('form13-financial') && has('form35')) return 'PKG-FULL-APP';
    // Property only
    if (has('form13_1')) return 'PKG-PROPERTY';
    // Child support only
    if (has('form13') && !has('form35')) return 'PKG-SUPPORT-CHILD';
    // Parenting only (general + parenting affidavit)
    if (has('form8') && has('form35')) return 'PKG-PARENT-ONLY';
    // Default
    return 'PKG-FULL-APP';
  }

  // ── Palette ────────────────────────────────────────────────────────────────
  var BG   = '#0f1117';
  var SURF = '#161920';
  var NAV  = '#1E2D4E';
  var PB   = '#A8B4D0';
  var GOLD = '#C9903A';
  var TEAL = '#20808D';
  var TEAL_D = '#01696F';
  var WHITE = '#CDCCCA';

  // ── Render helper ──────────────────────────────────────────────────────────
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.assign(e.style, attrs.style || {});
    if (attrs && attrs.cls) e.className = attrs.cls;
    if (attrs && attrs.id)  e.id = attrs.id;
    if (attrs && attrs.html) e.innerHTML = attrs.html;
    if (attrs && attrs.text) e.textContent = attrs.text;
    if (attrs && attrs.on) Object.keys(attrs.on).forEach(function(ev){ e.addEventListener(ev, attrs.on[ev]); });
    if (attrs) Object.keys(attrs).forEach(function(k){
      if (!['style','cls','id','html','text','on'].includes(k) && k !== 'style') {
        try { e.setAttribute(k, attrs[k]); } catch(x){}
      }
    });
    if (children) (Array.isArray(children) ? children : [children]).forEach(function(c){
      if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  // ── Mount the Package Screen ───────────────────────────────────────────────
  function mountPackageScreen(caseId, caseData) {
    // Remove any existing mount
    var existing = document.getElementById('hp-pkg-screen');
    if (existing) existing.remove();

    var pkg = PACKAGES.find(function(p){ return p.id === (caseData.package_id || inferPackage(caseData.case_type || caseData.caseType || '')); })
           || PACKAGES.find(function(p){ return p.id === 'PKG-FULL-APP'; });

    var selectedId = pkg.id;

    // ── Outer shell ──────────────────────────────────────────────────────────
    var shell = el('div', {
      id: 'hp-pkg-screen',
      style: {
        position:'fixed', inset:'0', background: BG,
        zIndex:'2147483647', overflowY:'auto',
        fontFamily:'"Inter",system-ui,sans-serif', color: WHITE
      }
    });

    // ── Inner container ──────────────────────────────────────────────────────
    var wrap = el('div', { style: { maxWidth:'680px', margin:'0 auto', padding:'40px 24px 80px' } });

    // Back button
    var backBtn = el('button', {
      style: { background:'none', border:'none', color: PB, cursor:'pointer', fontSize:'13px',
               display:'flex', alignItems:'center', gap:'6px', marginBottom:'32px', padding:'0' },
      html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Back to dashboard',
      on: { click: function(){ shell.remove(); window.location.hash = '/dashboard'; } }
    });

    // Header
    var hdr = el('div', { style: { marginBottom:'32px' } });
    var stepBadge = el('div', {
      text: 'Step 2 of 2 — Confirm your form package',
      style: { fontSize:'11px', fontWeight:'700', textTransform:'uppercase', letterSpacing:'0.08em',
               color: GOLD, marginBottom:'10px' }
    });
    var title = el('h1', {
      text: 'Your Recommended Forms',
      style: { fontSize:'24px', fontWeight:'700', color: WHITE, margin:'0 0 8px' }
    });
    var subtitle = el('p', {
      text: 'Based on your answers, we\'ve selected the forms you need. Review and confirm your package below.',
      style: { fontSize:'14px', color: PB, margin:'0', lineHeight:'1.6' }
    });
    hdr.appendChild(stepBadge);
    hdr.appendChild(title);
    hdr.appendChild(subtitle);

    // ── Recommended package card ─────────────────────────────────────────────
    var recLabel = el('div', {
      text: 'RECOMMENDED FOR YOU',
      style: { fontSize:'10px', fontWeight:'700', letterSpacing:'0.1em', color: TEAL,
               marginBottom:'12px' }
    });

    var recCard = el('div', {
      id: 'hp-pkg-rec-card',
      style: { background: SURF, borderRadius:'14px', border:'2px solid ' + TEAL,
               padding:'20px 24px', marginBottom:'24px' }
    });

    function buildRecCard(p) {
      recCard.innerHTML = '';
      var topRow = el('div', { style: { display:'flex', alignItems:'center', gap:'14px', marginBottom:'12px' } });
      var icon = el('div', {
        text: p.icon,
        style: { fontSize:'28px', lineHeight:'1', flexShrink:'0', width:'44px', height:'44px',
                 display:'flex', alignItems:'center', justifyContent:'center',
                 background: NAV, borderRadius:'10px' }
      });
      var info = el('div');
      var pkgTitle = el('div', { text: p.label, style: { fontSize:'17px', fontWeight:'700', color: WHITE, marginBottom:'4px' } });
      var pkgDesc  = el('div', { text: p.description, style: { fontSize:'13px', color: PB, lineHeight:'1.5' } });
      info.appendChild(pkgTitle);
      info.appendChild(pkgDesc);
      topRow.appendChild(icon);
      topRow.appendChild(info);
      recCard.appendChild(topRow);

      var divider = el('div', { style: { height:'1px', background:'rgba(168,180,208,0.12)', margin:'14px 0' } });
      recCard.appendChild(divider);

      var formsLabel = el('div', {
        text: p.formLabels.length + ' forms included:',
        style: { fontSize:'11px', fontWeight:'700', textTransform:'uppercase', letterSpacing:'0.07em',
                 color: GOLD, marginBottom:'10px' }
      });
      recCard.appendChild(formsLabel);

      p.formLabels.forEach(function(lbl) {
        var row = el('div', {
          style: { display:'flex', alignItems:'center', gap:'8px', marginBottom:'7px' }
        });
        row.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + TEAL + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        var txt = el('span', { text: lbl, style: { fontSize:'13px', color: WHITE } });
        row.appendChild(txt);
        recCard.appendChild(row);
      });
    }
    buildRecCard(pkg);

    // ── Change package link ──────────────────────────────────────────────────
    var changeRow = el('div', { style: { marginBottom:'28px', textAlign:'center' } });
    var changeBtn = el('button', {
      text: 'Not right? Choose a different package',
      style: { background:'none', border:'none', color: PB, cursor:'pointer',
               fontSize:'13px', textDecoration:'underline', textDecorationColor:'rgba(168,180,208,0.4)' }
    });
    changeRow.appendChild(changeBtn);

    // ── Package picker (hidden by default) ───────────────────────────────────
    var pickerWrap = el('div', {
      id: 'hp-pkg-picker',
      style: { display:'none', marginBottom:'28px' }
    });
    var pickerLabel = el('div', {
      text: 'Choose your package:',
      style: { fontSize:'12px', fontWeight:'700', textTransform:'uppercase',
               letterSpacing:'0.07em', color: PB, marginBottom:'14px' }
    });
    pickerWrap.appendChild(pickerLabel);

    PACKAGES.forEach(function(p) {
      var card = el('div', {
        'data-pkg': p.id,
        style: {
          background: p.id === selectedId ? NAV : SURF,
          border: '1.5px solid ' + (p.id === selectedId ? TEAL : 'rgba(168,180,208,0.15)'),
          borderRadius:'10px', padding:'14px 18px', marginBottom:'8px',
          cursor:'pointer', display:'flex', alignItems:'center', gap:'12px',
          transition:'border-color 0.15s'
        },
        on: {
          click: function() {
            // Deselect all
            pickerWrap.querySelectorAll('[data-pkg]').forEach(function(c){
              c.style.border = '1.5px solid rgba(168,180,208,0.15)';
              c.style.background = SURF;
            });
            // Select this
            card.style.border = '1.5px solid ' + TEAL;
            card.style.background = NAV;
            selectedId = p.id;
            // Rebuild rec card
            var newPkg = PACKAGES.find(function(x){ return x.id === p.id; });
            buildRecCard(newPkg);
            // Hide picker
            pickerWrap.style.display = 'none';
          }
        }
      });
      card.innerHTML = '<span style="font-size:20px;width:30px;flex-shrink:0;">' + p.icon + '</span>' +
        '<div><div style="font-size:14px;font-weight:600;color:' + WHITE + ';margin-bottom:2px;">' + p.label + '</div>' +
        '<div style="font-size:12px;color:' + PB + ';">' + p.formLabels.length + ' forms</div></div>';
      pickerWrap.appendChild(card);
    });

    changeBtn.addEventListener('click', function() {
      pickerWrap.style.display = pickerWrap.style.display === 'none' ? 'block' : 'none';
    });

    // ── Info box ─────────────────────────────────────────────────────────────
    var infoBox = el('div', {
      style: { background: NAV, borderRadius:'10px', padding:'16px 20px', marginBottom:'28px',
               display:'flex', gap:'12px', alignItems:'flex-start' }
    });
    infoBox.innerHTML =
      '<svg width="18" height="18" style="flex-shrink:0;margin-top:1px;" viewBox="0 0 24 24" fill="none" stroke="' + PB + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' +
      '</svg>' +
      '<p style="margin:0;font-size:13px;color:' + PB + ';line-height:1.6;">You can always add or remove forms later from your case dashboard. This package is a starting point based on your situation.</p>';

    // ── CTA button ───────────────────────────────────────────────────────────
    var ctaBtn = el('button', {
      id: 'hp-pkg-cta',
      text: 'Confirm Package & Start Filling Forms →',
      style: {
        width:'100%', background: TEAL_D, color:'#fff', border:'none',
        borderRadius:'12px', padding:'16px 24px', fontSize:'15px', fontWeight:'700',
        cursor:'pointer', letterSpacing:'0.01em', transition:'background 0.15s'
      },
      on: {
        mouseenter: function(){ ctaBtn.style.background = TEAL; },
        mouseleave: function(){ ctaBtn.style.background = TEAL_D; },
        click: async function() {
          ctaBtn.disabled = true;
          ctaBtn.textContent = 'Saving package…';
          try {
            var selPkg = PACKAGES.find(function(p){ return p.id === selectedId; }) || PACKAGES[0];
            var packageStatus = {};
            selPkg.forms.forEach(function(f){ packageStatus[f] = 'pending'; });

            var resp = await fetch(RW + '/api/cases/' + caseId, {
              method: 'PATCH',
              headers: Object.assign({'Content-Type':'application/json'}, __authHdr()),
              body: JSON.stringify({
                package_id: selPkg.id,
                package_forms: selPkg.forms,
                package_status: packageStatus,
                current_form_idx: 0
              })
            });
            if (!resp.ok) throw new Error('Save failed');
            shell.remove();
            window.location.hash = '/case/' + caseId + '/wizard';
          } catch(err) {
            ctaBtn.disabled = false;
            ctaBtn.textContent = 'Confirm Package & Start Filling Forms →';
            var errMsg = document.getElementById('hp-pkg-err');
            if (!errMsg) {
              errMsg = el('div', {
                id: 'hp-pkg-err',
                text: 'Could not save package. Please try again.',
                style: { color:'#ef4444', fontSize:'13px', textAlign:'center', marginTop:'10px' }
              });
              ctaBtn.parentNode.insertBefore(errMsg, ctaBtn.nextSibling);
            }
          }
        }
      }
    });

    var finePrint = el('p', {
      text: 'Hearth & Page · hearthandpage.ca',
      style: { textAlign:'center', fontSize:'10px', color:'rgba(168,180,208,0.3)',
               marginTop:'24px', letterSpacing:'0.04em' }
    });

    // ── Assemble ──────────────────────────────────────────────────────────────
    wrap.appendChild(backBtn);
    wrap.appendChild(hdr);
    wrap.appendChild(recLabel);
    wrap.appendChild(recCard);
    wrap.appendChild(changeRow);
    wrap.appendChild(pickerWrap);
    wrap.appendChild(infoBox);
    wrap.appendChild(ctaBtn);
    wrap.appendChild(finePrint);
    shell.appendChild(wrap);
    document.body.appendChild(shell);
  }

  // ── Route watcher: show Package Screen on /#/case/:id/package ─────────────
  function checkRoute() {
    var hash = window.location.hash || '';
    var m = hash.match(/^#\/case\/(\d+)\/package/);
    if (!m) return;

    var caseId = m[1];
    var existing = document.getElementById('hp-pkg-screen');
    if (existing) return; // already mounted

    // Fetch case data to get package_id (if returning to package screen)
    fetch(RW + '/api/cases', { headers: __authHdr() })
      .then(function(r){ return r.json(); })
      .then(function(cases) {
        var c = cases.find(function(x){ return String(x.id) === String(caseId); }) || { id: caseId };
        mountPackageScreen(caseId, c);
      })
      .catch(function() {
        mountPackageScreen(caseId, { id: caseId });
      });
  }

  // Listen for hash changes
  window.addEventListener('hashchange', checkRoute);
  // Check on load too
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkRoute);
  } else {
    checkRoute();
  }

  // ── Form Finder wiring: after quiz → /#/case/:id/package ──────────────────
  // The quiz posts to /api/cases and then navigates to /case/:id/wizard.
  // We intercept the navigation by watching for the case creation response.
  // Strategy: patch fetch to detect POST /api/cases with fromQuiz context.

  var _origFetch = window.fetch;
  var _lastFromQuiz = false;

  // Track if we're in a fromQuiz flow
  window.addEventListener('hashchange', function() {
    var h = window.location.hash || '';
    // If navigating to /case/new with fromQuiz=true, set the flag
    if (h.indexOf('case/new') !== -1 && window.location.search.indexOf('fromQuiz') !== -1) {
      _lastFromQuiz = true;
    }
  });

  // Also check URL params at page load
  (function() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('fromQuiz') === 'true') _lastFromQuiz = true;
  })();

  // Patch fetch to intercept POST /api/cases when fromQuiz=true
  window.fetch = function(url, opts) {
    var urlStr = (typeof url === 'string') ? url : (url && url.url) || '';
    var isCreateCase = opts && opts.method === 'POST' && urlStr.match(/\/api\/cases\/?$/);

    if (isCreateCase) {
      // Check if we came from the quiz
      var searchParams = new URLSearchParams(window.location.search);
      var fromQuiz = searchParams.get('fromQuiz') === 'true' || _lastFromQuiz;

      if (fromQuiz) {
        return _origFetch.apply(this, arguments).then(function(resp) {
          if (!resp.ok) return resp;
          // Clone the response so we can read it without consuming the body
          var cloned = resp.clone();
          cloned.json().then(function(data) {
            if (data && data.id) {
              // Small delay to let React process the response first
              setTimeout(function() {
                _lastFromQuiz = false;
                // Redirect to package screen instead of wizard
                var targetHash = '#/case/' + data.id + '/package';
                if (window.location.hash !== targetHash) {
                  window.location.hash = '/case/' + data.id + '/package';
                }
              }, 100);
            }
          }).catch(function(){});
          return resp;
        });
      }
    }

    return _origFetch.apply(this, arguments);
  };

  // ── Package Screen for Quiz (free-user conversion hook) ──────────────────
  // Shows the package screen BEFORE case creation, with a subscribe CTA.
  // caseType is the comma-separated form string from the quiz.
  function mountForQuiz(caseType, routeLabel) {
    var existing = document.getElementById('hp-pkg-screen');
    if (existing) existing.remove();

    var pkg = PACKAGES.find(function(p){ return p.id === inferPackage(caseType); })
           || PACKAGES.find(function(p){ return p.id === 'PKG-FULL-APP'; });

    var selectedId = pkg.id;

    // ── Outer shell ────────────────────────────────────────────────────────
    var shell = el('div', {
      id: 'hp-pkg-screen',
      style: {
        position:'fixed', inset:'0', background: BG,
        zIndex:'2147483647', overflowY:'auto',
        fontFamily:'"Inter",system-ui,sans-serif', color: WHITE
      }
    });

    var wrap = el('div', { style: { maxWidth:'680px', margin:'0 auto', padding:'40px 24px 80px' } });

    // Back button
    var backBtn = el('button', {
      style: { background:'none', border:'none', color: PB, cursor:'pointer', fontSize:'13px',
               display:'flex', alignItems:'center', gap:'6px', marginBottom:'32px', padding:'0' },
      html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Back',
      on: { click: function(){ shell.remove(); } }
    });

    // Header
    var hdr = el('div', { style: { marginBottom:'32px' } });
    var stepBadge = el('div', {
      text: 'Your forms are ready',
      style: { fontSize:'11px', fontWeight:'700', textTransform:'uppercase', letterSpacing:'0.08em',
               color: GOLD, marginBottom:'10px' }
    });
    var title = el('h1', {
      text: 'Here’s what we’ll prepare for you',
      style: { fontSize:'24px', fontWeight:'700', color: WHITE, margin:'0 0 8px' }
    });
    var subtitle = el('p', {
      text: 'Based on your answers, these are the Ontario court forms your situation requires. Subscribe to start filling them out.',
      style: { fontSize:'14px', color: PB, margin:'0', lineHeight:'1.6' }
    });
    hdr.appendChild(stepBadge);
    hdr.appendChild(title);
    hdr.appendChild(subtitle);

    // Recommended package card
    var recLabel = el('div', {
      text: 'RECOMMENDED FOR YOUR SITUATION',
      style: { fontSize:'10px', fontWeight:'700', letterSpacing:'0.1em', color: TEAL, marginBottom:'12px' }
    });

    var recCard = el('div', {
      id: 'hp-pkg-rec-card',
      style: { background: SURF, borderRadius:'14px', border:'2px solid ' + TEAL,
               padding:'20px 24px', marginBottom:'24px' }
    });

    function buildRecCard(p) {
      recCard.innerHTML = '';
      var topRow = el('div', { style: { display:'flex', alignItems:'center', gap:'14px', marginBottom:'12px' } });
      var icon = el('div', {
        text: p.icon,
        style: { fontSize:'28px', lineHeight:'1', flexShrink:'0', width:'44px', height:'44px',
                 display:'flex', alignItems:'center', justifyContent:'center',
                 background: NAV, borderRadius:'10px' }
      });
      var info = el('div');
      var pkgTitle = el('div', { text: p.label, style: { fontSize:'17px', fontWeight:'700', color: WHITE, marginBottom:'4px' } });
      var pkgDesc  = el('div', { text: p.description, style: { fontSize:'13px', color: PB, lineHeight:'1.5' } });
      info.appendChild(pkgTitle);
      info.appendChild(pkgDesc);
      topRow.appendChild(icon);
      topRow.appendChild(info);
      recCard.appendChild(topRow);

      var divider = el('div', { style: { height:'1px', background:'rgba(168,180,208,0.12)', margin:'14px 0' } });
      recCard.appendChild(divider);

      var formsLabel = el('div', {
        text: p.formLabels.length + ' forms included in your package:',
        style: { fontSize:'11px', fontWeight:'700', textTransform:'uppercase', letterSpacing:'0.07em',
                 color: GOLD, marginBottom:'10px' }
      });
      recCard.appendChild(formsLabel);

      p.formLabels.forEach(function(lbl) {
        var row = el('div', { style: { display:'flex', alignItems:'center', gap:'8px', marginBottom:'7px' } });
        row.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + TEAL + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        var txt = el('span', { text: lbl, style: { fontSize:'13px', color: WHITE } });
        row.appendChild(txt);
        recCard.appendChild(row);
      });
    }
    buildRecCard(pkg);

    // Change package link
    var changeRow = el('div', { style: { marginBottom:'24px', textAlign:'center' } });
    var changeBtn = el('button', {
      text: 'Not right? Choose a different package',
      style: { background:'none', border:'none', color: PB, cursor:'pointer',
               fontSize:'13px', textDecoration:'underline', textDecorationColor:'rgba(168,180,208,0.4)' }
    });
    changeRow.appendChild(changeBtn);

    // Package picker (hidden by default)
    var pickerWrap = el('div', { id: 'hp-pkg-picker', style: { display:'none', marginBottom:'24px' } });
    var pickerLabel = el('div', {
      text: 'Choose your package:',
      style: { fontSize:'12px', fontWeight:'700', textTransform:'uppercase',
               letterSpacing:'0.07em', color: PB, marginBottom:'14px' }
    });
    pickerWrap.appendChild(pickerLabel);

    PACKAGES.forEach(function(p) {
      var pCard = el('div', {
        'data-pkg': p.id,
        style: {
          background: p.id === selectedId ? NAV : SURF,
          border: '1.5px solid ' + (p.id === selectedId ? TEAL : 'rgba(168,180,208,0.15)'),
          borderRadius:'10px', padding:'14px 18px', marginBottom:'8px',
          cursor:'pointer', display:'flex', alignItems:'center', gap:'12px',
          transition:'border-color 0.15s'
        },
        on: {
          click: function() {
            pickerWrap.querySelectorAll('[data-pkg]').forEach(function(c){
              c.style.border = '1.5px solid rgba(168,180,208,0.15)';
              c.style.background = SURF;
            });
            pCard.style.border = '1.5px solid ' + TEAL;
            pCard.style.background = NAV;
            selectedId = p.id;
            // Update pending package
            window.__hp_pendingPackage = window.__hp_pendingPackage || {};
            window.__hp_pendingPackage.pkgId = p.id;
            buildRecCard(PACKAGES.find(function(x){ return x.id === p.id; }));
            pickerWrap.style.display = 'none';
          }
        }
      });
      pCard.innerHTML = '<span style="font-size:20px;width:30px;flex-shrink:0;">' + p.icon + '</span>' +
        '<div><div style="font-size:14px;font-weight:600;color:' + WHITE + ';margin-bottom:2px;">' + p.label + '</div>' +
        '<div style="font-size:12px;color:' + PB + ';">' + p.formLabels.length + ' forms</div></div>';
      pickerWrap.appendChild(pCard);
    });

    changeBtn.addEventListener('click', function() {
      pickerWrap.style.display = pickerWrap.style.display === 'none' ? 'block' : 'none';
    });

    // Lock notice
    var lockBox = el('div', {
      style: { background: 'rgba(201,144,58,0.10)', border: '1px solid rgba(201,144,58,0.30)',
               borderRadius:'12px', padding:'16px 20px', marginBottom:'24px',
               display:'flex', gap:'12px', alignItems:'flex-start' }
    });
    lockBox.innerHTML =
      '<svg width="20" height="20" style="flex-shrink:0;margin-top:1px;" viewBox="0 0 24 24" fill="none" stroke="' + GOLD + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>' +
        '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
      '</svg>' +
      '<div>' +
        '<div style="font-size:13px;font-weight:700;color:' + GOLD + ';margin-bottom:4px;">Subscribe to unlock these forms</div>' +
        '<div style="font-size:13px;color:' + PB + ';line-height:1.6;">A subscription gives you access to all ' + pkg.formLabels.length + ' forms in this package — fill them out at home, save your progress, and download court-ready PDFs.</div>' +
      '</div>';

    // Pricing row
    var pricingRow = el('div', {
      style: { display:'flex', gap:'12px', marginBottom:'16px', flexWrap:'wrap' }
    });

    function makePriceCard(planId, planName, price, period, features, highlight) {
      var priceEnvKey = planId === 'standard' ? 'VITE_STRIPE_PRICE_STANDARD' : 'VITE_STRIPE_PRICE_PLUS';
      var priceId = (window.__hp_env && window.__hp_env[priceEnvKey]) || '';

      var card = el('div', {
        style: {
          flex:'1', minWidth:'220px',
          background: highlight ? NAV : SURF,
          border: '1.5px solid ' + (highlight ? TEAL : 'rgba(168,180,208,0.15)'),
          borderRadius:'12px', padding:'18px 20px',
          display:'flex', flexDirection:'column', gap:'12px'
        }
      });

      var nameRow = el('div', { style: { display:'flex', alignItems:'center', justifyContent:'space-between' } });
      nameRow.innerHTML = '<span style="font-size:14px;font-weight:700;color:' + WHITE + ';">' + planName + '</span>' +
        (highlight ? '<span style="font-size:10px;font-weight:700;background:' + TEAL_D + ';color:#fff;padding:2px 8px;border-radius:20px;letter-spacing:0.05em;">POPULAR</span>' : '');
      card.appendChild(nameRow);

      var priceEl = el('div', {
        html: '<span style="font-size:26px;font-weight:800;color:' + WHITE + ';">' + price + '</span>' +
              '<span style="font-size:13px;color:' + PB + ';">' + period + '</span>'
      });
      card.appendChild(priceEl);

      var featList = el('div', { style: { fontSize:'12px', color: PB, lineHeight:'1.8' } });
      featList.innerHTML = features.map(function(f){
        return '<div style="display:flex;align-items:center;gap:6px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="' + TEAL + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' + f + '</div>';
      }).join('');
      card.appendChild(featList);

      var btn = el('button', {
        text: 'Choose ' + planName + ' →',
        style: {
          background: highlight ? TEAL_D : NAV, color:'#fff',
          border:'none', borderRadius:'8px', padding:'12px 16px',
          fontSize:'13px', fontWeight:'700', cursor:'pointer',
          transition:'background 0.15s', marginTop:'auto'
        },
        on: {
          mouseenter: function(){ btn.style.background = TEAL; },
          mouseleave: function(){ btn.style.background = highlight ? TEAL_D : NAV; },
          click: function() {
            // Save selected package ID before leaving
            window.__hp_pendingPackage = window.__hp_pendingPackage || {};
            window.__hp_pendingPackage.pkgId = selectedId;

            // Get price ID from the patched env
            var pid = (function(){
              try {
                // Try to grab from the React bundle's fF object via a global
                var scripts = document.querySelectorAll('script[src*="index-"]');
                // Direct lookup in window.__hp_env (set below)
                return window.__hp_env && window.__hp_env[priceEnvKey];
              } catch(e){ return ''; }
            })() || '';

            if (!pid) {
              // Fallback: navigate to React subscription page
              shell.remove();
              window.location.hash = '#/subscription';
              return;
            }

            btn.disabled = true;
            btn.textContent = 'Opening checkout…';

            fetch(window.__hp_rw + '/api/stripe/create-checkout', {
              method: 'POST',
              headers: Object.assign({'Content-Type':'application/json'}, window.__authHdr ? window.__authHdr() : {}),
              body: JSON.stringify({ priceId: pid })
            })
            .then(function(r){ return r.json(); })
            .then(function(d) {
              if (d.url) {
                window.open(d.url, '_blank') || (window.location.href = d.url);
                // Show "I've paid" prompt on the package screen
                btn.disabled = false;
                btn.textContent = 'I\'ve paid — activate my plan →';
                btn.style.background = GOLD;
                btn.removeEventListener('mouseenter', arguments.callee);
                btn.onclick = function() {
                  btn.disabled = true;
                  btn.textContent = 'Activating…';
                  fetch(window.__hp_rw + '/api/stripe/sync', {
                    method: 'POST',
                    headers: Object.assign({'Content-Type':'application/json'}, window.__authHdr ? window.__authHdr() : {})
                  })
                  .then(function(r){ return r.json(); })
                  .then(function(sd) {
                    if (sd.synced) {
                      // Now create the case
                      shell.remove();
                      var pp = window.__hp_pendingPackage || {};
                      createFirstCase(pp.title || routeLabel, pp.caseType || caseType);
                    } else {
                      btn.disabled = false;
                      btn.textContent = 'Payment not confirmed yet — give it a moment and try again';
                    }
                  })
                  .catch(function(){
                    btn.disabled = false;
                    btn.textContent = 'Could not activate — please try again or contact support';
                  });
                };
              } else {
                btn.disabled = false;
                btn.textContent = 'Choose ' + planName + ' →';
                // Fallback to subscription page
                shell.remove();
                window.location.hash = '#/subscription';
              }
            })
            .catch(function(){
              btn.disabled = false;
              btn.textContent = 'Choose ' + planName + ' →';
              alert('We couldn\'t open checkout. If your card was declined, check with your bank that online purchases are enabled \u2014 this is common with debit Visa/Mastercard. No charge has been made.');
              shell.remove();
              window.location.hash = '#/subscription';
            });
          }
        }
      });
      card.appendChild(btn);
      return card;
    }

    pricingRow.appendChild(makePriceCard(
      'standard', 'Standard', '$9.99', '/month CAD',
      ['All 35 Ontario court forms', 'Court-ready PDF download', 'Save progress anytime', 'Unlimited cases'],
      false
    ));
    pricingRow.appendChild(makePriceCard(
      'plus', 'Plus', '$19.99', '/month CAD',
      ['Everything in Standard', 'Smart document upload', 'Evidence file storage', 'Priority support'],
      true
    ));

    var billingNote = el('p', {
      text: 'Billed monthly. Cancel anytime. No contracts.',
      style: { fontSize:'11px', color:'rgba(168,180,208,0.5)', textAlign:'center', margin:'0 0 28px' }
    });

    // Fine print
    var finePrint = el('p', {
      text: 'Hearth & Page · hearthandpage.ca',
      style: { textAlign:'center', fontSize:'10px', color:'rgba(168,180,208,0.3)',
               marginTop:'24px', letterSpacing:'0.04em' }
    });

    // Assemble
    wrap.appendChild(backBtn);
    wrap.appendChild(hdr);
    wrap.appendChild(recLabel);
    wrap.appendChild(recCard);
    wrap.appendChild(changeRow);
    wrap.appendChild(pickerWrap);
    wrap.appendChild(lockBox);
    wrap.appendChild(pricingRow);
    wrap.appendChild(billingNote);
    wrap.appendChild(finePrint);
    shell.appendChild(wrap);
    document.body.appendChild(shell);
  }

  // Expose for testing
  window.__hp_packageScreen = { PACKAGES: PACKAGES, inferPackage: inferPackage, mount: mountPackageScreen, mountForQuiz: mountForQuiz };

  // Expose env shim so the inline pricing cards can read Stripe price IDs
  window.__hp_env = {
    VITE_STRIPE_PRICE_STANDARD: 'price_1Tduf0DyokC7Tv7bDRAZBk57',
    VITE_STRIPE_PRICE_PLUS:     'price_1TduyXDyokC7Tv7bKKoeeh1v'
  };

  // Expose auth helpers for the inline checkout
  (function pollForHelpers() {
    var attempts = 0;
    var timer = setInterval(function() {
      attempts++;
      if (window.__authHdr && window._RW) {
        window.__hp_rw = window._RW;
        clearInterval(timer);
      } else if (attempts > 40) {
        clearInterval(timer);
      }
    }, 250);
  })();

})();

// ============================================================
// ONTARIO SUPPORT CALCULATOR — Phase A
// Child Support: Federal CSG Tables (Oct 1, 2025) — Ontario
// Spousal Support: SSAG (Without-Child + With-Child formulas)
// Auto-populates Form 13 income fields on save
// Route: /#/case/:id/calculator
// Floating button injected into Form 13 wizard
// ============================================================
(function() {
  'use strict';

  // ─── Ontario Child Support Table (Oct 1, 2025) ─────────────────────────────
  // Format: [income_from, base_amount, rate_percent] for each $1000 band
  // income_from in dollars, base in $/month, rate in %
  // Income below $16,000 = $0 support
  // Covers 1–4 children. Table covers up to $150,000+

  var CST = {
    1: [
      [16000,0,9.54],[17000,96,8.98],[18000,186,8.51],[19000,271,8.11],[20000,352,7.75],
      [21000,430,7.43],[22000,504,7.14],[23000,575,6.87],[24000,644,6.63],[25000,710,6.41],
      [26000,774,6.21],[27000,836,6.02],[28000,896,5.84],[29000,954,5.68],[30000,1011,5.53],
      [31000,1066,5.38],[32000,1120,5.25],[33000,1172,5.12],[34000,1223,5.00],[35000,1273,4.88],
      [36000,1322,4.77],[37000,1369,4.67],[38000,1416,4.57],[39000,1461,4.48],[40000,1506,4.39],
      [41000,1550,4.30],[42000,1593,4.22],[43000,1635,4.14],[44000,1676,4.07],[45000,1717,3.99],
      [46000,1757,3.92],[47000,1796,3.86],[48000,1835,3.79],[49000,1873,3.73],[50000,1910,3.67],
      [51000,1947,3.61],[52000,1983,3.56],[53000,2019,3.50],[54000,2054,3.45],[55000,2089,3.40],
      [56000,2123,3.35],[57000,2157,3.31],[58000,2190,3.26],[59000,2223,3.22],[60000,2255,3.17],
      [61000,2287,3.13],[62000,2318,3.09],[63000,2349,3.05],[64000,2380,3.01],[65000,2410,2.97],
      [66000,2440,2.94],[67000,2469,2.90],[68000,2498,2.87],[69000,2527,2.84],[70000,2555,2.80],
      [71000,2583,2.77],[72000,2611,2.74],[73000,2638,2.72],[74000,2665,2.69],[75000,2692,2.66],
      [76000,2718,2.63],[77000,2744,2.61],[78000,2770,2.58],[79000,2796,2.56],[80000,2822,2.53],
      [81000,2847,2.51],[82000,2872,2.49],[83000,2897,2.47],[84000,2921,2.44],[85000,2945,2.42],
      [86000,2969,2.40],[87000,2993,2.38],[88000,3017,2.36],[89000,3040,2.34],[90000,3064,2.32],
      [91000,3087,2.30],[92000,3110,2.29],[93000,3133,2.27],[94000,3155,2.25],[95000,3178,2.23],
      [96000,3200,2.22],[97000,3222,2.20],[98000,3244,2.18],[99000,3266,2.17],[100000,3288,2.15],
      [101000,3309,2.14],[102000,3330,2.12],[103000,3352,2.11],[104000,3373,2.09],[105000,3394,2.08],
      [106000,3415,2.06],[107000,3436,2.05],[108000,3457,2.03],[109000,3477,2.02],[110000,3498,2.01],
      [120000,3697,1.90],[130000,3887,1.80],[140000,4067,1.71],[150000,4238,1.63]
    ],
    2: [
      [16000,0,10.21],[17000,102,9.62],[18000,198,9.11],[19000,289,8.67],[20000,376,8.27],
      [21000,459,7.91],[22000,538,7.59],[23000,614,7.30],[24000,687,7.03],[25000,757,6.79],
      [26000,825,6.56],[27000,891,6.35],[28000,954,6.16],[29000,1016,5.98],[30000,1076,5.81],
      [31000,1134,5.65],[32000,1191,5.50],[33000,1246,5.36],[34000,1300,5.23],[35000,1352,5.10],
      [36000,1403,4.98],[37000,1453,4.87],[38000,1501,4.76],[39000,1549,4.66],[40000,1595,4.56],
      [41000,1641,4.47],[42000,1686,4.38],[43000,1730,4.29],[44000,1773,4.21],[45000,1815,4.13],
      [46000,1856,4.05],[47000,1897,3.98],[48000,1937,3.91],[49000,1976,3.84],[50000,2014,3.77],
      [51000,2052,3.71],[52000,2089,3.65],[53000,2126,3.59],[54000,2162,3.53],[55000,2197,3.47],
      [56000,2232,3.42],[57000,2266,3.37],[58000,2300,3.32],[59000,2333,3.27],[60000,2366,3.22],
      [61000,2398,3.17],[62000,2430,3.13],[63000,2461,3.08],[64000,2492,3.04],[65000,2523,3.00],
      [66000,2553,2.96],[67000,2583,2.92],[68000,2612,2.88],[69000,2641,2.84],[70000,2669,2.81],
      [71000,2697,2.77],[72000,2725,2.74],[73000,2752,2.71],[74000,2779,2.68],[75000,2806,2.64],
      [76000,2832,2.61],[77000,2858,2.59],[78000,2884,2.56],[79000,2910,2.53],[80000,2935,2.50],
      [81000,2960,2.48],[82000,2985,2.45],[83000,3010,2.43],[84000,3034,2.40],[85000,3058,2.38],
      [86000,3082,2.36],[87000,3106,2.33],[88000,3129,2.31],[89000,3152,2.29],[90000,3175,2.27],
      [91000,3198,2.25],[92000,3220,2.23],[93000,3243,2.21],[94000,3265,2.19],[95000,3287,2.17],
      [96000,3309,2.15],[97000,3330,2.14],[98000,3352,2.12],[99000,3373,2.10],[100000,3394,2.08],
      [101000,3415,2.07],[102000,3436,2.05],[103000,3457,2.04],[104000,3477,2.02],[105000,3498,2.00],
      [106000,3518,1.99],[107000,3538,1.97],[108000,3558,1.96],[109000,3578,1.94],[110000,3597,1.93],
      [120000,3787,1.83],[130000,3970,1.73],[140000,4143,1.64],[150000,4307,1.56]
    ],
    3: [
      [16000,0,11.07],[17000,111,10.44],[18000,215,9.90],[19000,314,9.42],[20000,408,9.00],
      [21000,498,8.61],[22000,584,8.25],[23000,668,7.93],[24000,747,7.63],[25000,823,7.36],
      [26000,897,7.11],[27000,968,6.88],[28000,1037,6.66],[29000,1103,6.46],[30000,1168,6.27],
      [31000,1230,6.09],[32000,1291,5.92],[33000,1350,5.76],[34000,1408,5.61],[35000,1464,5.47],
      [36000,1519,5.33],[37000,1572,5.20],[38000,1624,5.08],[39000,1675,4.96],[40000,1724,4.85],
      [41000,1773,4.74],[42000,1820,4.63],[43000,1866,4.53],[44000,1912,4.43],[45000,1956,4.34],
      [46000,2000,4.25],[47000,2042,4.16],[48000,2084,4.07],[49000,2125,3.99],[50000,2165,3.91],
      [51000,2204,3.83],[52000,2243,3.75],[53000,2281,3.68],[54000,2318,3.61],[55000,2354,3.54],
      [56000,2390,3.48],[57000,2425,3.41],[58000,2459,3.35],[59000,2493,3.29],[60000,2526,3.23],
      [61000,2558,3.18],[62000,2590,3.12],[63000,2621,3.07],[64000,2652,3.02],[65000,2682,2.97],
      [66000,2712,2.92],[67000,2741,2.87],[68000,2770,2.83],[69000,2798,2.78],[70000,2826,2.74],
      [71000,2853,2.70],[72000,2880,2.66],[73000,2907,2.62],[74000,2933,2.58],[75000,2959,2.55],
      [76000,2984,2.51],[77000,3009,2.48],[78000,3034,2.44],[79000,3058,2.41],[80000,3082,2.38],
      [81000,3106,2.35],[82000,3130,2.32],[83000,3153,2.29],[84000,3176,2.27],[85000,3198,2.24],
      [86000,3220,2.21],[87000,3242,2.19],[88000,3264,2.16],[89000,3286,2.14],[90000,3307,2.11],
      [91000,3328,2.09],[92000,3349,2.07],[93000,3370,2.04],[94000,3391,2.02],[95000,3411,2.00],
      [96000,3431,1.98],[97000,3451,1.96],[98000,3471,1.94],[99000,3490,1.92],[100000,3509,1.90],
      [110000,3699,1.81],[120000,3880,1.71],[130000,4051,1.63],[140000,4214,1.55],[150000,4369,1.48]
    ],
    4: [
      [16000,0,11.69],[17000,117,11.03],[18000,227,10.45],[19000,332,9.93],[20000,431,9.47],
      [21000,526,9.06],[22000,617,8.68],[23000,703,8.34],[24000,786,8.02],[25000,866,7.72],
      [26000,943,7.45],[27000,1018,7.20],[28000,1090,6.96],[29000,1160,6.74],[30000,1227,6.53],
      [31000,1292,6.34],[32000,1356,6.15],[33000,1418,5.98],[34000,1478,5.81],[35000,1536,5.66],
      [36000,1593,5.51],[37000,1648,5.37],[38000,1702,5.24],[39000,1754,5.11],[40000,1805,4.99],
      [41000,1855,4.87],[42000,1904,4.76],[43000,1951,4.65],[44000,1998,4.55],[45000,2043,4.46],
      [46000,2088,4.36],[47000,2131,4.27],[48000,2174,4.18],[49000,2215,4.10],[50000,2256,4.02],
      [51000,2296,3.94],[52000,2336,3.86],[53000,2374,3.79],[54000,2413,3.72],[55000,2450,3.65],
      [56000,2487,3.58],[57000,2523,3.52],[58000,2558,3.46],[59000,2593,3.40],[60000,2627,3.34],
      [61000,2661,3.28],[62000,2694,3.22],[63000,2726,3.17],[64000,2758,3.12],[65000,2789,3.07],
      [66000,2820,3.02],[67000,2850,2.97],[68000,2880,2.92],[69000,2909,2.87],[70000,2938,2.83],
      [71000,2966,2.79],[72000,2994,2.74],[73000,3022,2.70],[74000,3049,2.66],[75000,3076,2.63],
      [76000,3102,2.59],[77000,3128,2.55],[78000,3154,2.52],[79000,3179,2.48],[80000,3204,2.45],
      [81000,3228,2.41],[82000,3252,2.38],[83000,3276,2.35],[84000,3299,2.32],[85000,3322,2.29],
      [86000,3345,2.26],[87000,3367,2.24],[88000,3389,2.21],[89000,3411,2.18],[90000,3433,2.16],
      [91000,3454,2.13],[92000,3475,2.11],[93000,3496,2.08],[94000,3517,2.06],[95000,3538,2.04],
      [96000,3558,2.01],[97000,3578,1.99],[98000,3598,1.97],[99000,3618,1.95],[100000,3638,1.93],
      [110000,3830,1.83],[120000,4013,1.73],[130000,4187,1.65],[140000,4352,1.57],[150000,4509,1.49]
    ]
  };

  // ─── CST Lookup ────────────────────────────────────────────────────────────
  function lookupCST(annualIncome, numChildren) {
    var n = Math.min(Math.max(parseInt(numChildren) || 1, 1), 4);
    var table = CST[n];
    if (!table) return 0;
    if (annualIncome < 16000) return 0;
    // Find the right band
    var band = null;
    for (var i = table.length - 1; i >= 0; i--) {
      if (annualIncome >= table[i][0]) { band = table[i]; break; }
    }
    if (!band) return 0;
    var base = band[1];
    var pct  = band[2];
    var over = annualIncome - band[0];
    return Math.round(base + (over * pct / 100));
  }

  // ─── SSAG Spousal Support ──────────────────────────────────────────────────
  function calcSpousal(payorGross, recipientGross, yearsCohabited, hasChildren) {
    if (!payorGross || payorGross <= recipientGross) return null;
    var diff = payorGross - recipientGross;
    var low, mid, high, durLow, durHigh;
    if (!hasChildren) {
      // Without-child formula
      var pctLow  = Math.min(0.015 * yearsCohabited, 0.375);
      var pctHigh = Math.min(0.020 * yearsCohabited, 0.50);
      low  = Math.round((diff * pctLow)  / 12);
      high = Math.round((diff * pctHigh) / 12);
      mid  = Math.round((low + high) / 2);
      durLow  = Math.max(0.5 * yearsCohabited, 1);
      durHigh = yearsCohabited;
      // Rule of 65 or 20-year marriage = indefinite
      var indefinite = yearsCohabited >= 20;
      return { low: low, mid: mid, high: high, durLow: durLow, durHigh: durHigh, indefinite: indefinite };
    } else {
      // With-child formula — simplified INDI-based estimate
      // Rough combined net = 70% of gross (after tax/CPP/EI)
      var payorNet    = payorGross * 0.70 / 12;
      var recipNet    = recipientGross * 0.70 / 12;
      var combined    = payorNet + recipNet;
      low  = Math.round(combined * 0.40 - recipNet);
      high = Math.round(combined * 0.46 - recipNet);
      low  = Math.max(low, 0);
      high = Math.max(high, 0);
      mid  = Math.round((low + high) / 2);
      durLow  = yearsCohabited * 0.5;
      durHigh = yearsCohabited;
      var indefinite = yearsCohabited >= 20;
      return { low: low, mid: mid, high: high, durLow: durLow, durHigh: durHigh, indefinite: indefinite };
    }
  }

  // ─── Auth Helper ──────────────────────────────────────────────────────────
  function __calcAuthHdr() {
    var token = (window.__hp_token || sessionStorage.getItem('hp_token') || '');
    return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  // ─── Autofill Form 13 ──────────────────────────────────────────────────────
  async function autofillForm13(caseId, annualIncome, childSupport, spousalLow, spousalHigh) {
    if (!caseId || !annualIncome) return;
    var monthlyGross = Math.round(annualIncome / 12);
    var fields = [
      { fieldKey: 'inc_employment', fieldValue: String(monthlyGross), formId: 'ON-F13', section: 'f13_income' }
    ];
    if (spousalLow && spousalHigh) {
      // Save spousal support received if recipient side
      fields.push({ fieldKey: 'inc_spousalsupport', fieldValue: String(spousalLow), formId: 'ON-F13', section: 'f13_income' });
    }
    for (var i = 0; i < fields.length; i++) {
      try {
        await fetch('/api/cases/' + caseId + '/form-data', {
          method: 'POST',
          headers: __calcAuthHdr(),
          body: JSON.stringify(fields[i])
        });
      } catch(e) {}
    }
  }

  // ─── Styles ────────────────────────────────────────────────────────────────
  var CALC_STYLES = [
    '/* HP Calculator */',
    '.hp-calc-fab{position:fixed;bottom:24px;right:24px;z-index:9100;',
    'background:#C9903A;color:#fff;border:none;border-radius:50px;',
    'padding:12px 20px;font-size:14px;font-weight:600;cursor:pointer;',
    'box-shadow:0 4px 16px rgba(201,144,58,0.45);',
    'display:flex;align-items:center;gap:8px;transition:all .2s;}',
    '.hp-calc-fab:hover{background:#b07e2e;transform:translateY(-2px);}',
    '.hp-calc-overlay{position:fixed;inset:0;z-index:9200;',
    'background:rgba(0,0,0,.75);display:flex;align-items:center;',
    'justify-content:center;padding:16px;}',
    '.hp-calc-modal{background:#161920;border:1px solid #2a2f3e;',
    'border-radius:16px;width:100%;max-width:600px;max-height:90vh;',
    'overflow-y:auto;padding:32px;}',
    '.hp-calc-modal h2{color:#fff;font-size:22px;font-weight:700;margin:0 0 4px;}',
    '.hp-calc-modal .sub{color:#8892a0;font-size:13px;margin:0 0 24px;}',
    '.hp-calc-tabs{display:flex;gap:8px;margin-bottom:24px;}',
    '.hp-calc-tab{flex:1;padding:10px;border:1px solid #2a2f3e;border-radius:8px;',
    'background:transparent;color:#8892a0;font-size:13px;font-weight:500;',
    'cursor:pointer;transition:all .15s;}',
    '.hp-calc-tab.active{background:#C9903A;border-color:#C9903A;color:#fff;}',
    '.hp-calc-label{display:block;font-size:12px;font-weight:600;',
    'color:#8892a0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;}',
    '.hp-calc-input{width:100%;background:#0f1117;border:1px solid #2a2f3e;',
    'border-radius:8px;padding:10px 14px;color:#fff;font-size:15px;',
    'outline:none;box-sizing:border-box;margin-bottom:16px;}',
    '.hp-calc-input:focus{border-color:#C9903A;}',
    '.hp-calc-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
    '.hp-calc-btn{width:100%;padding:14px;background:#C9903A;',
    'border:none;border-radius:10px;color:#fff;font-size:15px;',
    'font-weight:700;cursor:pointer;margin-top:8px;transition:all .2s;}',
    '.hp-calc-btn:hover{background:#b07e2e;}',
    '.hp-calc-result{margin-top:24px;border-top:1px solid #2a2f3e;padding-top:24px;}',
    '.hp-calc-amount{font-size:42px;font-weight:800;color:#C9903A;line-height:1;}',
    '.hp-calc-amount-label{font-size:13px;color:#8892a0;margin-top:4px;margin-bottom:16px;}',
    '.hp-calc-range{display:flex;gap:12px;margin-bottom:16px;}',
    '.hp-calc-range-card{flex:1;background:#0f1117;border:1px solid #2a2f3e;',
    'border-radius:8px;padding:12px;text-align:center;}',
    '.hp-calc-range-card .label{font-size:11px;color:#8892a0;text-transform:uppercase;}',
    '.hp-calc-range-card .value{font-size:20px;font-weight:700;color:#fff;margin-top:4px;}',
    '.hp-calc-disclaimer{font-size:11px;color:#5a6070;line-height:1.5;',
    'border-top:1px solid #1e2330;padding-top:12px;margin-top:16px;}',
    '.hp-calc-autofill-btn{width:100%;padding:12px;background:#1E2D4E;',
    'border:1px solid #3d5280;border-radius:8px;color:#A8B4D0;font-size:13px;',
    'font-weight:600;cursor:pointer;margin-top:8px;transition:all .2s;}',
    '.hp-calc-autofill-btn:hover{background:#263a60;color:#fff;}',
    '.hp-calc-close{position:absolute;top:16px;right:16px;background:none;',
    'border:none;color:#8892a0;font-size:22px;cursor:pointer;padding:4px 8px;}',
    '.hp-calc-close:hover{color:#fff;}',
    '.hp-calc-source{font-size:10px;color:#3a4050;margin-top:8px;text-align:center;}'
  ].join('\n');

  // ─── Inject Styles Once ───────────────────────────────────────────────────
  if (!document.getElementById('hp-calc-styles')) {
    var styleEl = document.createElement('style');
    styleEl.id = 'hp-calc-styles';
    styleEl.textContent = CALC_STYLES;
    document.head.appendChild(styleEl);
  }

  // ─── Calculator Modal ──────────────────────────────────────────────────────
  function openCalcModal(caseId) {
    if (document.getElementById('hp-calc-modal')) return;

    var overlay = document.createElement('div');
    overlay.className = 'hp-calc-overlay';
    overlay.id = 'hp-calc-overlay';

    overlay.innerHTML = [
      '<div class="hp-calc-modal" id="hp-calc-modal" style="position:relative">',
      '  <button class="hp-calc-close" id="hp-calc-close">&#x2715;</button>',
      '  <h2>Support Calculator</h2>',
      '  <p class="sub">Ontario — Federal Child Support Guidelines (Oct 1, 2025) &amp; SSAG</p>',
      '  <div class="hp-calc-tabs">',
      '    <button class="hp-calc-tab active" data-tab="child">Child Support</button>',
      '    <button class="hp-calc-tab" data-tab="spousal">Spousal Support</button>',
      '    <button class="hp-calc-tab" data-tab="both">Both</button>',
      '  </div>',

      // ── Child Support Fields ──
      '  <div id="hp-calc-child-section">',
      '    <label class="hp-calc-label" for="hp-calc-payor-income">Payor Annual Gross Income ($)</label>',
      '    <input class="hp-calc-input" type="number" id="hp-calc-payor-income" placeholder="e.g. 75000" min="0" />',
      '    <label class="hp-calc-label" for="hp-calc-num-children">Number of Children</label>',
      '    <select class="hp-calc-input" id="hp-calc-num-children">',
      '      <option value="1">1 child</option>',
      '      <option value="2">2 children</option>',
      '      <option value="3">3 children</option>',
      '      <option value="4">4 children</option>',
      '    </select>',
      '  </div>',

      // ── Spousal Support Fields ──
      '  <div id="hp-calc-spousal-section" style="display:none">',
      '    <div class="hp-calc-row">',
      '      <div>',
      '        <label class="hp-calc-label" for="hp-calc-payor-gross">Payor Annual Gross ($)</label>',
      '        <input class="hp-calc-input" type="number" id="hp-calc-payor-gross" placeholder="e.g. 90000" />',
      '      </div>',
      '      <div>',
      '        <label class="hp-calc-label" for="hp-calc-recipient-gross">Recipient Annual Gross ($)</label>',
      '        <input class="hp-calc-input" type="number" id="hp-calc-recipient-gross" placeholder="e.g. 35000" />',
      '      </div>',
      '    </div>',
      '    <div class="hp-calc-row">',
      '      <div>',
      '        <label class="hp-calc-label" for="hp-calc-years">Years Cohabited</label>',
      '        <input class="hp-calc-input" type="number" id="hp-calc-years" placeholder="e.g. 8" min="0" max="60" />',
      '      </div>',
      '      <div>',
      '        <label class="hp-calc-label" for="hp-calc-has-children">Children Involved?</label>',
      '        <select class="hp-calc-input" id="hp-calc-has-children">',
      '          <option value="no">No</option>',
      '          <option value="yes">Yes</option>',
      '        </select>',
      '      </div>',
      '    </div>',
      '  </div>',

      '  <button class="hp-calc-btn" id="hp-calc-run">Calculate &#8594;</button>',

      '  <div class="hp-calc-result" id="hp-calc-result" style="display:none"></div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(overlay);

    var activeTab = 'child';

    function showTab(tab) {
      activeTab = tab;
      document.querySelectorAll('.hp-calc-tab').forEach(function(b) {
        b.classList.toggle('active', b.dataset.tab === tab);
      });
      document.getElementById('hp-calc-child-section').style.display =
        (tab === 'child' || tab === 'both') ? '' : 'none';
      document.getElementById('hp-calc-spousal-section').style.display =
        (tab === 'spousal' || tab === 'both') ? '' : 'none';
      document.getElementById('hp-calc-result').style.display = 'none';
    }

    document.querySelectorAll('.hp-calc-tab').forEach(function(btn) {
      btn.addEventListener('click', function() { showTab(this.dataset.tab); });
    });

    document.getElementById('hp-calc-close').addEventListener('click', function() {
      overlay.remove();
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });

    document.getElementById('hp-calc-run').addEventListener('click', function() {
      var resultEl = document.getElementById('hp-calc-result');
      var html = '';
      var childAmount = null, spousalResult = null;
      var payorIncome = 0;

      // Child support
      if (activeTab === 'child' || activeTab === 'both') {
        payorIncome = parseInt(document.getElementById('hp-calc-payor-income').value) || 0;
        var numKids  = parseInt(document.getElementById('hp-calc-num-children').value) || 1;
        if (payorIncome < 16000) {
          html += '<p style="color:#f87171;font-size:14px">Income is below the $16,000 threshold — no child support is payable under the Federal Guidelines.</p>';
        } else {
          childAmount = lookupCST(payorIncome, numKids);
          html += [
            '<div class="hp-calc-amount">$' + childAmount.toLocaleString() + '</div>',
            '<div class="hp-calc-amount-label">per month child support &mdash; ' + numKids + ' child' + (numKids > 1 ? 'ren' : '') + '</div>',
            '<div style="font-size:12px;color:#8892a0;margin-bottom:12px">',
            'Based on payor income of $' + payorIncome.toLocaleString() + '/yr | Ontario CSG Table (Oct 1, 2025)',
            '</div>'
          ].join('');
        }
      }

      // Spousal support
      if (activeTab === 'spousal' || activeTab === 'both') {
        var pGross = parseInt(document.getElementById('hp-calc-payor-gross').value) || 0;
        var rGross = parseInt(document.getElementById('hp-calc-recipient-gross').value) || 0;
        var years  = parseInt(document.getElementById('hp-calc-years').value) || 0;
        var hasKids = document.getElementById('hp-calc-has-children').value === 'yes';
        if (!pGross || !years) {
          html += '<p style="color:#f87171;font-size:14px">Please enter payor gross income and years cohabited.</p>';
        } else {
          spousalResult = calcSpousal(pGross, rGross, years, hasKids);
          if (!spousalResult) {
            html += '<p style="color:#8892a0;font-size:14px">Payor income must exceed recipient income for spousal support to be payable.</p>';
          } else {
            var durStr = spousalResult.indefinite
              ? 'Indefinite (Rule of 65 / 20+ years)'
              : spousalResult.durLow.toFixed(1) + '–' + spousalResult.durHigh.toFixed(1) + ' years';
            html += [
              '<div style="margin-top:' + (childAmount ? '24px' : '0') + ';' + (childAmount ? 'padding-top:20px;border-top:1px solid #2a2f3e;' : '') + '">',
              '<div style="font-size:13px;font-weight:700;color:#A8B4D0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">Spousal Support — SSAG Range</div>',
              '<div class="hp-calc-range">',
              '  <div class="hp-calc-range-card"><div class="label">Low</div><div class="value">$' + spousalResult.low.toLocaleString() + '</div></div>',
              '  <div class="hp-calc-range-card" style="border-color:#C9903A"><div class="label">Mid</div><div class="value" style="color:#C9903A">$' + spousalResult.mid.toLocaleString() + '</div></div>',
              '  <div class="hp-calc-range-card"><div class="label">High</div><div class="value">$' + spousalResult.high.toLocaleString() + '</div></div>',
              '</div>',
              '<div style="font-size:12px;color:#8892a0;margin-bottom:8px">Duration: ' + durStr + '</div>',
              '</div>'
            ].join('');
          }
        }
      }

      // Autofill button
      if (caseId && (childAmount || spousalResult)) {
        var autofillIncome = payorIncome ||
          (parseInt(document.getElementById('hp-calc-payor-gross').value) || 0);
        var spLow  = spousalResult ? spousalResult.low : null;
        var spHigh = spousalResult ? spousalResult.high : null;
        html += [
          '<button class="hp-calc-autofill-btn" id="hp-calc-autofill">',
          '  &#8595; Save income to Form 13',
          '</button>'
        ].join('');
        setTimeout(function() {
          var btn = document.getElementById('hp-calc-autofill');
          if (btn) {
            btn.addEventListener('click', async function() {
              this.disabled = true;
              this.textContent = 'Saving…';
              await autofillForm13(caseId, autofillIncome, childAmount, spLow, spHigh);
              this.textContent = '✓ Saved to Form 13';
              this.style.color = '#4ade80';
            });
          }
        }, 50);
      }

      html += [
        '<div class="hp-calc-disclaimer">',
        'These are estimates only and do not constitute legal advice. Support amounts depend on actual verified income, expenses, and the specific facts of your case. Consult a licensed family law lawyer or mediator before relying on these figures in any proceeding.',
        '</div>',
        '<div class="hp-calc-source">',
        'Child Support: Justice Canada 2025 Federal Child Support Guidelines Table for Ontario (effective Oct 1, 2025) &bull; Spousal Support: Spousal Support Advisory Guidelines (SSAG)',
        '</div>'
      ].join('');

      resultEl.innerHTML = html;
      resultEl.style.display = '';
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // ─── Floating Button Injector ──────────────────────────────────────────────
  function injectCalcFAB(caseId) {
    if (document.getElementById('hp-calc-fab')) return;
    var fab = document.createElement('button');
    fab.id = 'hp-calc-fab';
    fab.className = 'hp-calc-fab';
    fab.innerHTML = [
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">',
      '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
      '</svg>',
      'Calculate Support'
    ].join('');
    fab.addEventListener('click', function() { openCalcModal(caseId || null); });
    document.body.appendChild(fab);
  }

  function removeCalcFAB() {
    var fab = document.getElementById('hp-calc-fab');
    if (fab) fab.remove();
    var overlay = document.getElementById('hp-calc-overlay');
    if (overlay) overlay.remove();
  }

  // ─── Route Handler — /#/case/:id/calculator ───────────────────────────────
  function handleCalcRoute(caseId) {
    // Remove FAB, show full standalone page
    removeCalcFAB();
    openCalcModal(caseId);
  }

  // ─── Route Watcher ────────────────────────────────────────────────────────
  var __calcLastHash = '';

  function onHashChange() {
    var hash = window.location.hash;
    if (hash === __calcLastHash) return;
    __calcLastHash = hash;

    // Clean up if navigating away
    var calcOverlay = document.getElementById('hp-calc-overlay');
    if (calcOverlay) calcOverlay.remove();

    // Detect Form 13 wizard: /#/case/:id/wizard?form=ON-F13 or /#/case/:id/form/ON-F13
    var wizardMatch = hash.match(/#\/case\/(\d+)\/(wizard|form)/);
    var isForm13 = hash.includes('ON-F13') || hash.includes('form13') ||
                   (window.location.search && (window.location.search.includes('ON-F13') || window.location.search.includes('form13')));

    if (wizardMatch && isForm13) {
      setTimeout(function() { injectCalcFAB(wizardMatch[1]); }, 800);
      return;
    }

    // Detect /#/case/:id/calculator route
    var calcMatch = hash.match(/#\/case\/(\d+)\/calculator/);
    if (calcMatch) {
      setTimeout(function() { handleCalcRoute(calcMatch[1]); }, 300);
      return;
    }

    // Detect standalone /#/calculator
    if (hash === '#/calculator' || hash === '#/calculator/') {
      setTimeout(function() { openCalcModal(null); }, 300);
      return;
    }

    // Not on a calc-relevant page — remove FAB
    removeCalcFAB();
  }

  window.addEventListener('hashchange', onHashChange);
  // Also handle initial page load on Form 13
  setTimeout(onHashChange, 1200);

  // ─── Wizard Step Observer — inject FAB when Form 13 parts load ─────────────
  // Watches the DOM for Form 13 part headers to appear and injects FAB
  if (window.MutationObserver) {
    var __calcObserver = new MutationObserver(function(mutations) {
      var hash = window.location.hash;
      if (!hash.includes('ON-F13') && !hash.includes('form13')) return;
      var caseMatch = hash.match(/#\/case\/(\d+)\//);
      if (!caseMatch) return;
      // Look for the income part header
      var incomeHeader = document.querySelector('[data-part-id="f13_income"], [data-partid="f13_income"]');
      if (incomeHeader && !document.getElementById('hp-calc-fab')) {
        injectCalcFAB(caseMatch[1]);
      }
    });
    __calcObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Expose globally ──────────────────────────────────────────────────────
  window.__hp_calculator = {
    open: openCalcModal,
    lookupCST: lookupCST,
    calcSpousal: calcSpousal,
    injectFAB: injectCalcFAB
  };

})();

// ============================================================
// ONTARIO FAMILY LAW — DEADLINE DASHBOARD — Phase B
// Source: Ontario Family Law Rules O. Reg. 114/99
// Auto-generates procedural deadlines from case anchor date
// Route: /#/case/:id/deadlines
// Nav entry injected into case sidebar/header
// ============================================================
(function() {
  'use strict';

  // ─── Ontario FLR Deadline Rules ───────────────────────────────────────────
  // Each rule: { id, label, description, calDays, bizDays, anchor, role, urgency, rule, form }
  // anchor: 'application_served' | 'motion_date' | 'conference_date' | 'trial_date' | 'financial_served' | 'case_created'
  // urgency: 'critical' | 'high' | 'medium' | 'low'
  // calDays: calendar days offset from anchor (negative = BEFORE anchor, positive = AFTER)
  // bizDays: if true, calDays is business days (we convert to calendar ~1.4×)

  var DEADLINE_RULES = [
    // ── From Application Served ──────────────────────────────────────────────
    {
      id: 'answer_deadline',
      label: 'File Answer (Form 10)',
      description: 'Respondent must serve and file Form 10: Answer within 30 calendar days of being served with the Application. Missing this deadline means the case can proceed without you.',
      calDays: 30,
      anchor: 'application_served',
      role: 'respondent',
      urgency: 'critical',
      rule: 'FLR Rule 10(1)',
      form: 'Form 10'
    },
    {
      id: 'financial_statement_respondent',
      label: 'File Financial Statement (Form 13/13.1)',
      description: 'If the Application includes a support or property claim, the respondent must serve and file a Financial Statement (Form 13 or 13.1) within the same 30-day window as the Answer.',
      calDays: 30,
      anchor: 'application_served',
      role: 'respondent',
      urgency: 'critical',
      rule: 'FLR Rule 13(1)(b)',
      form: 'Form 13 / Form 13.1'
    },
    {
      id: 'reply_deadline',
      label: 'File Reply (Form 10A)',
      description: 'If the Applicant wants to reply to claims made in the Answer, they must file Form 10A: Reply within 10 calendar days of receiving the Answer.',
      calDays: 10,
      anchor: 'answer_served',
      role: 'applicant',
      urgency: 'high',
      rule: 'FLR Rule 10(6)',
      form: 'Form 10A'
    },
    {
      id: 'financial_docs_property',
      label: 'Serve Financial Disclosure Documents (Property Claims)',
      description: 'If there is a property claim under Part I of the Family Law Act, you must serve supporting financial documents within 30 days of when your Financial Statement was due.',
      calDays: 60,
      anchor: 'application_served',
      role: 'both',
      urgency: 'high',
      rule: 'FLR Rule 13(3.3)',
      form: 'Form 13A (Certificate of Financial Disclosure)'
    },

    // ── Motion Deadlines (relative to motion date) ───────────────────────────
    {
      id: 'motion_serve',
      label: 'Serve Motion Forms on Other Party',
      description: 'You must serve all motion forms on every other party at least 6 business days before your motion date. Use regular or special service.',
      calDays: -9,
      anchor: 'motion_date',
      role: 'moving_party',
      urgency: 'critical',
      rule: 'FLR Rule 14(11)',
      form: 'Form 14, Form 14A'
    },
    {
      id: 'motion_file',
      label: 'File Motion Forms with Court',
      description: 'File original motion forms and Form 6B: Affidavit of Service with the court at least 4 business days before your motion date.',
      calDays: -6,
      anchor: 'motion_date',
      role: 'moving_party',
      urgency: 'critical',
      rule: 'FLR Rule 14(11)',
      form: 'Form 14, Form 6B'
    },
    {
      id: 'motion_confirm',
      label: 'File Confirmation of Motion (Form 14C)',
      description: 'File Form 14C: Confirmation of Motion by 2:00 p.m., 3 business days before the motion. If you miss this, your motion will be cancelled.',
      calDays: -5,
      anchor: 'motion_date',
      role: 'both',
      urgency: 'critical',
      rule: 'FLR Rule 14(11)',
      form: 'Form 14C'
    },
    {
      id: 'motion_financial_update_moving',
      label: 'Update Financial Statement — Motion (Moving Party)',
      description: 'If your Financial Statement is more than 30 days old before the motion, you must serve and file an updated Form 13/13.1 or a sworn affidavit confirming no change.',
      calDays: -6,
      anchor: 'motion_date',
      role: 'moving_party',
      urgency: 'high',
      rule: 'FLR Rule 13(12)',
      form: 'Form 13 / Affidavit'
    },
    {
      id: 'motion_financial_update_responding',
      label: 'Update Financial Statement — Motion (Responding Party)',
      description: 'The responding party must serve and file an updated Financial Statement or sworn affidavit at least 4 business days before the motion.',
      calDays: -6,
      anchor: 'motion_date',
      role: 'respondent',
      urgency: 'high',
      rule: 'FLR Rule 13(4)',
      form: 'Form 13 / Affidavit'
    },

    // ── Case/Settlement Conference ────────────────────────────────────────────
    {
      id: 'conf_brief_applicant',
      label: 'File Conference Brief — Applicant (Form 17A)',
      description: 'Serve and file your Case Conference Brief (Form 17A) at least 6 business days before the conference if you are the applicant or the party who requested the conference.',
      calDays: -9,
      anchor: 'conference_date',
      role: 'applicant',
      urgency: 'critical',
      rule: 'FLR Rule 17(13.1)',
      form: 'Form 17A'
    },
    {
      id: 'conf_brief_respondent',
      label: 'File Conference Brief — Respondent (Form 17A)',
      description: 'Serve and file your Case Conference Brief (Form 17A) at least 4 business days before the conference if you are the respondent or the party who received the conference notice.',
      calDays: -6,
      anchor: 'conference_date',
      role: 'respondent',
      urgency: 'critical',
      rule: 'FLR Rule 17(13.1)',
      form: 'Form 17A'
    },
    {
      id: 'conf_financial_applicant',
      label: 'Update Financial Statement — Conference (Applicant)',
      description: 'If your Financial Statement is more than 60 days old, serve and file an updated Form 13/13.1 or sworn affidavit at least 6 business days before the conference.',
      calDays: -9,
      anchor: 'conference_date',
      role: 'applicant',
      urgency: 'high',
      rule: 'FLR Rule 13(12)',
      form: 'Form 13 / Affidavit'
    },
    {
      id: 'conf_financial_respondent',
      label: 'Update Financial Statement — Conference (Respondent)',
      description: 'Serve and file updated Financial Statement or affidavit at least 4 business days before the conference.',
      calDays: -6,
      anchor: 'conference_date',
      role: 'respondent',
      urgency: 'high',
      rule: 'FLR Rule 13(12)',
      form: 'Form 13 / Affidavit'
    },
    {
      id: 'conf_confirmation',
      label: 'File Confirmation of Conference (Form 17F)',
      description: 'Both parties must file Form 17F: Confirmation of Conference by 2:00 p.m., 3 business days before the conference. Give a copy to the other party first.',
      calDays: -5,
      anchor: 'conference_date',
      role: 'both',
      urgency: 'critical',
      rule: 'FLR Rule 17(14)',
      form: 'Form 17F'
    },

    // ── Trial ─────────────────────────────────────────────────────────────────
    {
      id: 'trial_financial',
      label: 'Update Financial Statement — Trial',
      description: 'If your Financial Statement is more than 40 days old before trial, you must serve and file an updated Form 13/13.1 or sworn affidavit at least 30 calendar days before the trial starts.',
      calDays: -30,
      anchor: 'trial_date',
      role: 'both',
      urgency: 'critical',
      rule: 'FLR Rule 13(12)',
      form: 'Form 13 / Form 13.1'
    },
    {
      id: 'trial_net_family_property',
      label: 'File Net Family Property Statement (Form 13B)',
      description: 'If there is a property claim, serve and file Form 13B: Net Family Property Statement at least 30 calendar days before the earlier of the trial start or trial sitting.',
      calDays: -30,
      anchor: 'trial_date',
      role: 'both',
      urgency: 'critical',
      rule: 'FLR Rule 13(14)',
      form: 'Form 13B'
    },
    {
      id: 'trial_brief',
      label: 'Serve Trial Management Conference Brief',
      description: 'Serve and file your Trial Management Conference Brief (Form 17E) at least 6 business days (applicant) or 4 business days (respondent) before the trial management conference.',
      calDays: -9,
      anchor: 'trial_date',
      role: 'both',
      urgency: 'high',
      rule: 'FLR Rule 17(13.1)',
      form: 'Form 17E'
    },

    // ── Ex-Parte (Without Notice) Order ───────────────────────────────────────
    {
      id: 'exparte_return',
      label: 'Return to Court After Without-Notice Order',
      description: 'After an emergency (without-notice) motion order is granted, you must return to court within 14 days to give the other party a chance to respond.',
      calDays: 14,
      anchor: 'exparte_order_date',
      role: 'both',
      urgency: 'critical',
      rule: 'FLR Rule 14(15)',
      form: 'Form 14, Form 14C'
    }
  ];

  // ─── Business Day Calculator ───────────────────────────────────────────────
  // Add/subtract N business days from a date
  function addBusinessDays(date, n) {
    var d = new Date(date);
    var dir = n >= 0 ? 1 : -1;
    var remaining = Math.abs(n);
    while (remaining > 0) {
      d.setDate(d.getDate() + dir);
      var day = d.getDay();
      if (day !== 0 && day !== 6) remaining--;
    }
    return d;
  }

  function addCalendarDays(date, n) {
    var d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function isBizDays(rule) {
    // Rules referencing motion/conference relative deadlines use business days
    return ['motion_serve','motion_file','motion_confirm','conf_brief_applicant',
            'conf_brief_respondent','conf_financial_applicant','conf_financial_respondent',
            'conf_confirmation','trial_brief','motion_financial_update_moving','motion_financial_update_responding'].indexOf(rule.id) !== -1;
  }

  function computeDeadline(rule, anchors) {
    var anchorDate = anchors[rule.anchor];
    if (!anchorDate) return null;
    var base = new Date(anchorDate);
    var days = rule.calDays;
    var deadline;
    if (isBizDays(rule)) {
      // calDays stored as negative calendar days — convert to biz days
      // We already store the approximate calendar equivalent, so just use addCalendarDays
      deadline = addCalendarDays(base, days);
    } else {
      deadline = addCalendarDays(base, days);
    }
    return deadline;
  }

  function daysUntil(date) {
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return Math.round((d - now) / (1000 * 60 * 60 * 24));
  }

  function formatDate(date) {
    if (!date) return '—';
    var d = new Date(date);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  // ─── Auth Helper ───────────────────────────────────────────────────────────
  function __dlAuthHdr() {
    var token = window.__hp_token || sessionStorage.getItem('hp_token') || '';
    return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  // ─── Deadline Storage Keys ─────────────────────────────────────────────────
  // Anchors stored as form_data rows with form_id = '__deadlines__'
  // field_key = anchor name (e.g. 'application_served', 'motion_date')

  async function loadAnchors(caseId) {
    try {
      var resp = await fetch('/api/cases/' + caseId + '/form-data', { headers: __dlAuthHdr() });
      if (!resp.ok) return {};
      var rows = await resp.json();
      var anchors = {};
      rows.forEach(function(r) {
        var fk = r.fieldKey || r.field_key;
        var fv = r.fieldValue || r.field_value;
        var sec = r.section;
        // Anchors are stored with section='anchors' or section='__dl_anchors__'
        if ((sec === 'anchors' || sec === '__dl_anchors__') && fk && fv) {
          anchors[fk] = fv;
        }
      });
      return anchors;
    } catch(e) { return {}; }
  }

  async function saveAnchor(caseId, key, value) {
    try {
      await fetch('/api/cases/' + caseId + '/form-data', {
        method: 'POST',
        headers: __dlAuthHdr(),
        body: JSON.stringify({ fieldKey: key, fieldValue: value, formId: '__deadlines__', section: 'anchors' })
      });
    } catch(e) {}
  }

  // ─── Styles ────────────────────────────────────────────────────────────────
  var DL_STYLES = [
    '.hp-dl-page{padding:32px 24px;max-width:800px;margin:0 auto;}',
    '.hp-dl-header{display:flex;align-items:flex-start;justify-content:space-between;',
    'margin-bottom:8px;flex-wrap:wrap;gap:12px;}',
    '.hp-dl-header h2{color:#fff;font-size:22px;font-weight:700;margin:0;}',
    '.hp-dl-header .sub{color:#8892a0;font-size:13px;margin:4px 0 0;}',
    '.hp-dl-anchors{background:#161920;border:1px solid #2a2f3e;border-radius:12px;',
    'padding:20px;margin-bottom:28px;}',
    '.hp-dl-anchors h3{color:#A8B4D0;font-size:13px;font-weight:700;',
    'text-transform:uppercase;letter-spacing:.06em;margin:0 0 14px;}',
    '.hp-dl-anchor-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}',
    '.hp-dl-anchor-item label{display:block;font-size:11px;font-weight:600;color:#8892a0;',
    'text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;}',
    '.hp-dl-anchor-item input[type="date"]{width:100%;background:#0f1117;border:1px solid #2a2f3e;',
    'border-radius:8px;padding:9px 12px;color:#fff;font-size:13px;outline:none;',
    'box-sizing:border-box;color-scheme:dark;}',
    '.hp-dl-anchor-item input[type="date"]:focus{border-color:#C9903A;}',
    '.hp-dl-save-btn{margin-top:14px;padding:10px 20px;background:#C9903A;border:none;',
    'border-radius:8px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;}',
    '.hp-dl-save-btn:hover{background:#b07e2e;}',
    '.hp-dl-saved{font-size:12px;color:#4ade80;margin-left:12px;display:none;}',
    '.hp-dl-section{margin-bottom:24px;}',
    '.hp-dl-section-title{font-size:11px;font-weight:700;color:#8892a0;',
    'text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;',
    'padding-bottom:6px;border-bottom:1px solid #1e2330;}',
    '.hp-dl-card{background:#161920;border:1px solid #2a2f3e;border-radius:10px;',
    'padding:14px 16px;margin-bottom:8px;display:flex;gap:16px;align-items:flex-start;',
    'transition:border-color .15s;}',
    '.hp-dl-card:hover{border-color:#3d4558;}',
    '.hp-dl-card.overdue{border-left:3px solid #ef4444;background:#1a1212;}',
    '.hp-dl-card.due-soon{border-left:3px solid #f59e0b;background:#1a1710;}',
    '.hp-dl-card.upcoming{border-left:3px solid #3b82f6;}',
    '.hp-dl-card.done{opacity:.45;border-left:3px solid #22c55e;}',
    '.hp-dl-card.no-anchor{opacity:.35;border-left:3px solid #2a2f3e;}',
    '.hp-dl-badge{min-width:72px;text-align:center;padding:5px 8px;border-radius:6px;',
    'font-size:11px;font-weight:700;line-height:1.2;flex-shrink:0;}',
    '.hp-dl-badge.overdue{background:#7f1d1d;color:#fca5a5;}',
    '.hp-dl-badge.due-soon{background:#78350f;color:#fde68a;}',
    '.hp-dl-badge.upcoming{background:#1e3a5f;color:#93c5fd;}',
    '.hp-dl-badge.done{background:#14532d;color:#86efac;}',
    '.hp-dl-badge.no-anchor{background:#1e2330;color:#5a6070;}',
    '.hp-dl-info{flex:1;min-width:0;}',
    '.hp-dl-info .title{font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:3px;}',
    '.hp-dl-info .desc{font-size:12px;color:#8892a0;line-height:1.5;margin-bottom:4px;}',
    '.hp-dl-info .meta{font-size:11px;color:#5a6070;}',
    '.hp-dl-info .meta span{margin-right:12px;}',
    '.hp-dl-check{display:flex;align-items:center;gap:6px;cursor:pointer;',
    'margin-left:auto;flex-shrink:0;}',
    '.hp-dl-check input[type="checkbox"]{width:16px;height:16px;accent-color:#22c55e;cursor:pointer;}',
    '.hp-dl-check label{font-size:11px;color:#5a6070;cursor:pointer;white-space:nowrap;}',
    '.hp-dl-empty{text-align:center;padding:48px 24px;color:#5a6070;font-size:14px;}',
    '.hp-dl-empty .icon{font-size:32px;margin-bottom:12px;}',
    '.hp-dl-legend{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px;}',
    '.hp-dl-legend-item{display:flex;align-items:center;gap:6px;font-size:11px;color:#8892a0;}',
    '.hp-dl-legend-dot{width:8px;height:8px;border-radius:50%;}',
    '.hp-dl-disclaimer{font-size:11px;color:#3a4050;line-height:1.5;',
    'border-top:1px solid #1e2330;padding-top:16px;margin-top:8px;}',
    '.hp-dl-nav-btn{display:inline-flex;align-items:center;gap:6px;',
    'background:#1E2D4E;border:1px solid #3d5280;border-radius:8px;',
    'color:#A8B4D0;font-size:13px;font-weight:600;padding:8px 14px;',
    'cursor:pointer;text-decoration:none;margin-bottom:20px;}',
    '.hp-dl-nav-btn:hover{background:#263a60;color:#fff;}'
  ].join('\n');

  if (!document.getElementById('hp-dl-styles')) {
    var dlStyleEl = document.createElement('style');
    dlStyleEl.id = 'hp-dl-styles';
    dlStyleEl.textContent = DL_STYLES;
    document.head.appendChild(dlStyleEl);
  }

  // ─── Render Dashboard ──────────────────────────────────────────────────────
  async function mountDeadlineDashboard(container, caseId) {
    container.innerHTML = '<div class="hp-dl-page"><div class="hp-dl-empty"><div class="icon">⏳</div>Loading deadlines…</div></div>';

    var anchors = await loadAnchors(caseId);
    var completed = {};
    // Load completed flags from form_data too
    try {
      var fdResp = await fetch('/api/cases/' + caseId + '/form-data', { headers: __dlAuthHdr() });
      if (fdResp.ok) {
        var fdRows = await fdResp.json();
        fdRows.forEach(function(r) {
          var sec = r.section;
          if (sec === '__deadline_done__') {
            completed[r.fieldKey || r.field_key] = true;
          }
        });
      }
    } catch(e) {}

    // Default anchor: use case created_at if no application_served set
    if (!anchors.application_served && !anchors.case_created) {
      // Fetch case to get createdAt
      try {
        var caseResp = await fetch('/api/cases/' + caseId, { headers: __dlAuthHdr() });
        if (caseResp.ok) {
          var caseData = await caseResp.json();
          if (caseData.createdAt) {
            var dt = new Date(caseData.createdAt);
            anchors.case_created = dt.toISOString().split('T')[0];
            // Use as proxy for application_served if not set
            if (!anchors.application_served) {
              anchors.application_served = anchors.case_created;
            }
          }
        }
      } catch(e) {}
    }

    // Build computed deadlines
    var computed = DEADLINE_RULES.map(function(rule) {
      var deadline = computeDeadline(rule, anchors);
      var days = deadline ? daysUntil(deadline) : null;
      var status = 'no-anchor';
      if (deadline) {
        if (completed[rule.id]) status = 'done';
        else if (days < 0) status = 'overdue';
        else if (days <= 5) status = 'due-soon';
        else status = 'upcoming';
      }
      return { rule: rule, deadline: deadline, days: days, status: status };
    });

    // Sort: overdue first, then due-soon, then upcoming, then no-anchor, then done
    var order = { overdue: 0, 'due-soon': 1, upcoming: 2, 'no-anchor': 3, done: 4 };
    computed.sort(function(a, b) { return (order[a.status] || 0) - (order[b.status] || 0); });

    // Group by anchor type for sectioned layout
    var sections = {
      'Application / Response': ['answer_deadline','financial_statement_respondent','reply_deadline','financial_docs_property'],
      'Motion': ['motion_serve','motion_file','motion_confirm','motion_financial_update_moving','motion_financial_update_responding'],
      'Case / Settlement Conference': ['conf_brief_applicant','conf_brief_respondent','conf_financial_applicant','conf_financial_respondent','conf_confirmation'],
      'Trial': ['trial_financial','trial_net_family_property','trial_brief'],
      'Emergency (Without-Notice) Order': ['exparte_return']
    };

    var ANCHOR_LABELS = {
      application_served: 'Application Served Date',
      answer_served: 'Answer Served Date',
      motion_date: 'Motion Hearing Date',
      conference_date: 'Conference Date',
      trial_date: 'Trial Date',
      exparte_order_date: 'Without-Notice Order Date'
    };

    // Build HTML
    var html = '<div class="hp-dl-page">';
    html += '<div class="hp-dl-header">';
    html += '<div><h2>Deadline Dashboard</h2><p class="sub">Ontario Family Law Rules — Procedural Timelines</p></div>';
    html += '</div>';

    // Legend
    html += '<div class="hp-dl-legend">';
    html += '<div class="hp-dl-legend-item"><div class="hp-dl-legend-dot" style="background:#ef4444"></div>Overdue</div>';
    html += '<div class="hp-dl-legend-item"><div class="hp-dl-legend-dot" style="background:#f59e0b"></div>Due within 5 days</div>';
    html += '<div class="hp-dl-legend-item"><div class="hp-dl-legend-dot" style="background:#3b82f6"></div>Upcoming</div>';
    html += '<div class="hp-dl-legend-item"><div class="hp-dl-legend-dot" style="background:#22c55e"></div>Done</div>';
    html += '</div>';

    // Anchor Date Inputs
    html += '<div class="hp-dl-anchors">';
    html += '<h3>Enter Your Key Dates</h3>';
    html += '<p style="font-size:12px;color:#8892a0;margin:0 0 14px">Enter the dates relevant to your case — deadlines will be calculated automatically.</p>';
    html += '<div class="hp-dl-anchor-grid">';
    Object.keys(ANCHOR_LABELS).forEach(function(key) {
      var val = anchors[key] || '';
      html += '<div class="hp-dl-anchor-item">';
      html += '<label for="hp-dl-anchor-' + key + '">' + ANCHOR_LABELS[key] + '</label>';
      html += '<input type="date" id="hp-dl-anchor-' + key + '" data-anchor="' + key + '" value="' + val + '">';
      html += '</div>';
    });
    html += '</div>';
    html += '<div style="display:flex;align-items:center;margin-top:14px">';
    html += '<button class="hp-dl-save-btn" id="hp-dl-save-anchors">Save Dates</button>';
    html += '<span class="hp-dl-saved" id="hp-dl-saved-msg">✓ Dates saved</span>';
    html += '</div>';
    html += '</div>';

    // Deadline Sections
    Object.keys(sections).forEach(function(sectionName) {
      var ids = sections[sectionName];
      var sectionItems = computed.filter(function(c) { return ids.indexOf(c.rule.id) !== -1; });
      if (!sectionItems.length) return;

      html += '<div class="hp-dl-section">';
      html += '<div class="hp-dl-section-title">' + sectionName + '</div>';

      sectionItems.forEach(function(item) {
        var badgeText, badgeClass;
        if (item.status === 'done') {
          badgeText = 'Done'; badgeClass = 'done';
        } else if (item.status === 'no-anchor') {
          badgeText = 'Set date'; badgeClass = 'no-anchor';
        } else if (item.status === 'overdue') {
          var d = Math.abs(item.days);
          badgeText = d + (d === 1 ? ' day' : ' days') + ' overdue'; badgeClass = 'overdue';
        } else if (item.status === 'due-soon') {
          badgeText = item.days === 0 ? 'Today!' : item.days + (item.days === 1 ? ' day' : ' days'); badgeClass = 'due-soon';
        } else {
          badgeText = item.days + (item.days === 1 ? ' day' : ' days'); badgeClass = 'upcoming';
        }

        html += '<div class="hp-dl-card ' + item.status + '" data-id="' + item.rule.id + '">';
        html += '<div class="hp-dl-badge ' + badgeClass + '">' + badgeText + '</div>';
        html += '<div class="hp-dl-info">';
        html += '<div class="title">' + item.rule.label + '</div>';
        html += '<div class="desc">' + item.rule.description + '</div>';
        html += '<div class="meta">';
        html += '<span>' + item.rule.rule + '</span>';
        html += '<span>' + item.rule.form + '</span>';
        if (item.deadline) html += '<span>Due: <strong style="color:#e2e8f0">' + formatDate(item.deadline) + '</strong></span>';
        html += '<span style="text-transform:capitalize;color:#5a6070">' + (item.rule.role === 'both' ? 'All parties' : item.rule.role) + '</span>';
        html += '</div>';
        html += '</div>';
        html += '<div class="hp-dl-check">';
        html += '<input type="checkbox" id="hp-dl-done-' + item.rule.id + '" data-deadline-id="' + item.rule.id + '" ' + (item.status === 'done' ? 'checked' : '') + '>';
        html += '<label for="hp-dl-done-' + item.rule.id + '">Done</label>';
        html += '</div>';
        html += '</div>';
      });

      html += '</div>';
    });

    html += '<div class="hp-dl-disclaimer">';
    html += 'Deadline dates are estimates based on the Ontario Family Law Rules (O. Reg. 114/99) and are provided for reference only. Court deadlines may vary based on specific orders, local practice directions, or judicial discretion. Always confirm timelines with the court office or a licensed family law lawyer. Deadlines shown in calendar days unless otherwise noted; motion and conference deadlines use approximate business day conversions.';
    html += '</div>';
    html += '</div>';

    container.innerHTML = html;

    // Event: Save anchor dates
    document.getElementById('hp-dl-save-anchors').addEventListener('click', async function() {
      var inputs = container.querySelectorAll('[data-anchor]');
      var promises = [];
      inputs.forEach(function(inp) {
        if (inp.value) promises.push(saveAnchor(caseId, inp.dataset.anchor, inp.value));
      });
      await Promise.all(promises);
      var msg = document.getElementById('hp-dl-saved-msg');
      msg.style.display = 'inline';
      setTimeout(function() { msg.style.display = 'none'; }, 2500);
      // Re-mount to refresh deadline calculations
      await mountDeadlineDashboard(container, caseId);
    });

    // Event: Check done
    container.querySelectorAll('[data-deadline-id]').forEach(function(checkbox) {
      checkbox.addEventListener('change', async function() {
        var did = this.dataset.deadlineId;
        var isDone = this.checked;
        try {
          await fetch('/api/cases/' + caseId + '/form-data', {
            method: 'POST',
            headers: __dlAuthHdr(),
            body: JSON.stringify({
              fieldKey: did,
              fieldValue: isDone ? 'done' : 'pending',
              formId: '__deadline_done__',
              section: 'deadlines'
            })
          });
          // Update card visually without full re-mount
          var card = container.querySelector('[data-id="' + did + '"]');
          if (card) {
            if (isDone) {
              card.className = 'hp-dl-card done';
              var badge = card.querySelector('.hp-dl-badge');
              badge.className = 'hp-dl-badge done';
              badge.textContent = 'Done';
            }
          }
        } catch(e) {}
      });
    });
  }

  // ─── Page Renderer ─────────────────────────────────────────────────────────
  function renderDeadlinePage(caseId) {
    var existing = document.getElementById('hp-dl-page-root');
    if (existing) existing.remove();

    var mainContent = document.querySelector(
      'main, [class*="main"], [class*="content"], [id*="app"], #root, .app-body'
    );
    if (!mainContent) mainContent = document.body;

    var root = document.createElement('div');
    root.id = 'hp-dl-page-root';
    root.style.cssText = 'position:fixed;inset:0;z-index:8500;background:#0f1117;overflow-y:auto;';

    // Back button
    var backBar = document.createElement('div');
    backBar.style.cssText = 'padding:16px 24px;border-bottom:1px solid #1e2330;display:flex;align-items:center;gap:12px;background:#0f1117;position:sticky;top:0;z-index:1;';
    backBar.innerHTML = '<button class="hp-dl-nav-btn" id="hp-dl-back-btn">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>' +
      'Back to Case</button>' +
      '<span style="color:#A8B4D0;font-size:14px;font-weight:600">Deadline Dashboard</span>' +
      '<span style="margin-left:auto;font-size:11px;color:#5a6070">Ontario Family Law Rules</span>';

    root.appendChild(backBar);

    var contentArea = document.createElement('div');
    root.appendChild(contentArea);

    document.body.appendChild(root);

    document.getElementById('hp-dl-back-btn').addEventListener('click', function() {
      root.remove();
      window.location.hash = '/case/' + caseId;
    });

    mountDeadlineDashboard(contentArea, caseId);
  }

  // ─── Inject Dashboard Button into Case Header/Actions ─────────────────────
  function injectDeadlineNavBtn(caseId) {
    if (window.__hp_noFabs) return;
    if (document.getElementById('hp-dl-nav-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'hp-dl-nav-btn';
    btn.className = 'hp-dl-nav-btn';
    btn.style.cssText = 'position:fixed;bottom:82px;right:24px;z-index:9000;';
    btn.innerHTML = [
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">',
      '<rect x="3" y="4" width="18" height="18" rx="2"/>',
      '<line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>',
      '<line x1="3" y1="10" x2="21" y2="10"/>',
      '</svg>',
      'Deadlines'
    ].join('');
    btn.addEventListener('click', function() { renderDeadlinePage(caseId); });
    document.body.appendChild(btn);
  }

  function removeDeadlineBtn() {
    var btn = document.getElementById('hp-dl-nav-btn');
    if (btn) btn.remove();
    var page = document.getElementById('hp-dl-page-root');
    if (page) page.remove();
  }

  // ─── Route Handler ─────────────────────────────────────────────────────────
  var __dlLastHash = '';

  function onDlHashChange() {
    var hash = window.location.hash;
    if (hash === __dlLastHash) return;
    __dlLastHash = hash;

    // /#/case/:id/deadlines — direct route
    var dlMatch = hash.match(/#\/case\/(\d+)\/deadlines/);
    if (dlMatch) {
      setTimeout(function() { renderDeadlinePage(dlMatch[1]); }, 300);
      return;
    }

    // Remove deadline page if navigating away from it
    var page = document.getElementById('hp-dl-page-root');
    if (page) page.remove();

    // /#/case/:id/* — show the floating Deadlines button
    var caseMatch = hash.match(/#\/case\/(\d+)/);
    if (caseMatch) {
      setTimeout(function() { injectDeadlineNavBtn(caseMatch[1]); }, 1000);
      return;
    }

    removeDeadlineBtn();
  }

  window.addEventListener('hashchange', onDlHashChange);
  setTimeout(onDlHashChange, 1500);

  // ─── Expose globally ───────────────────────────────────────────────────────
  window.__hp_deadlines = {
    mount: mountDeadlineDashboard,
    render: renderDeadlinePage,
    rules: DEADLINE_RULES
  };

})();

// ─── PHASE C: TWO-PARTY COLLABORATION ────────────────────────────────────────
// Join page, Invite panel (owner), Respondent shared-case view
// ─────────────────────────────────────────────────────────────────────────────
(function() {
  'use strict';

  var API = window.__HP_API || 'https://api-production-2334.up.railway.app';
  var GOLD   = '#C9903A';
  var NAVY   = '#1E2D4E';
  var BG     = '#0f1117';
  var SURF   = '#161920';
  var POWDER = '#A8B4D0';
  var BORDER = 'rgba(168,180,208,0.15)';

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function getToken() {
    return window.__hp_auth_token || localStorage.getItem('hp_token') || '';
  }

  function authHeaders() {
    return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' };
  }

  function apiFetch(path, opts) {
    return fetch(API + path, Object.assign({ headers: authHeaders() }, opts || {}));
  }

  function currentUserId() {
    try {
      var t = getToken();
      if (!t) return null;
      var payload = JSON.parse(atob(t.split('.')[1]));
      return payload.userId || payload.id || payload.sub || null;
    } catch(e) { return null; }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function showToast(msg, isError) {
    var existing = document.getElementById('hp-collab-toast');
    if (existing) existing.remove();
    var t = document.createElement('div');
    t.id = 'hp-collab-toast';
    t.textContent = msg;
    t.style.cssText = [
      'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
      'background:' + (isError ? '#7f1d1d' : '#14532d'),
      'color:#fff;padding:10px 20px;border-radius:8px',
      'font-size:13px;z-index:99999;pointer-events:none',
      'box-shadow:0 4px 16px rgba(0,0,0,0.5)'
    ].join(';');
    document.body.appendChild(t);
    setTimeout(function() { if (t.parentNode) t.remove(); }, 3500);
  }

  // ── CSS injection ────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#hp-join-overlay{position:fixed;inset:0;background:' + BG + ';z-index:99990;display:flex;align-items:center;justify-content:center;padding:20px}',
    '#hp-join-card{background:' + SURF + ';border:1px solid ' + BORDER + ';border-radius:16px;padding:40px 36px;max-width:480px;width:100%;text-align:center}',
    '#hp-join-card h2{color:' + GOLD + ';font-size:22px;font-weight:700;margin:0 0 8px}',
    '#hp-join-card .hp-join-sub{color:' + POWDER + ';font-size:14px;margin:0 0 28px;opacity:0.8}',
    '#hp-join-card .hp-join-case{background:rgba(30,45,78,0.6);border:1px solid ' + BORDER + ';border-radius:10px;padding:18px;margin-bottom:24px;text-align:left}',
    '#hp-join-card .hp-join-case-label{color:' + POWDER + ';font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px}',
    '#hp-join-card .hp-join-case-title{color:#fff;font-size:17px;font-weight:600}',
    '#hp-join-card .hp-join-case-applicant{color:' + POWDER + ';font-size:13px;margin-top:4px;opacity:0.7}',
    '#hp-join-card .hp-btn-gold{background:' + GOLD + ';color:#fff;border:none;border-radius:8px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;width:100%;margin-bottom:12px}',
    '#hp-join-card .hp-btn-gold:hover{background:#b8822e}',
    '#hp-join-card .hp-btn-outline{background:transparent;color:' + POWDER + ';border:1px solid ' + BORDER + ';border-radius:8px;padding:10px 20px;font-size:14px;cursor:pointer;width:100%}',
    '#hp-join-card .hp-join-expired{color:#f87171;font-size:13px;margin-top:8px}',
    '#hp-join-card .hp-join-status{color:' + POWDER + ';font-size:13px;margin-top:8px;opacity:0.7}',
    '#hp-invite-fab{position:fixed;bottom:24px;right:24px;z-index:9000;background:' + NAVY + ';border:1px solid ' + GOLD + ';border-radius:50px;padding:10px 20px;display:flex;align-items:center;gap:8px;cursor:pointer;color:' + GOLD + ';font-size:13px;font-weight:600;box-shadow:0 4px 20px rgba(201,144,58,0.25)}',
    '#hp-invite-fab:hover{background:#263d6a}',
    '#hp-invite-panel{position:fixed;bottom:76px;right:24px;z-index:9001;background:' + SURF + ';border:1px solid ' + BORDER + ';border-radius:14px;width:340px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.6);display:none}',
    '#hp-invite-panel h3{color:' + GOLD + ';font-size:15px;font-weight:700;margin:0 0 4px}',
    '#hp-invite-panel .hp-inv-sub{color:' + POWDER + ';font-size:12px;opacity:0.7;margin:0 0 16px}',
    '#hp-invite-panel .hp-inv-status-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:16px}',
    '.hp-inv-status-none{background:rgba(168,180,208,0.1);color:' + POWDER + '}',
    '.hp-inv-status-invited{background:rgba(201,144,58,0.15);color:' + GOLD + '}',
    '.hp-inv-status-active{background:rgba(34,197,94,0.15);color:#4ade80}',
    '#hp-invite-panel .hp-inv-link-row{display:flex;gap:8px;margin-bottom:12px}',
    '#hp-invite-panel .hp-inv-link-input{flex:1;background:rgba(255,255,255,0.05);border:1px solid ' + BORDER + ';border-radius:6px;color:#fff;font-size:12px;padding:8px 10px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '#hp-invite-panel .hp-inv-copy-btn{background:' + NAVY + ';border:1px solid ' + GOLD + ';color:' + GOLD + ';border-radius:6px;padding:8px 12px;font-size:12px;cursor:pointer;white-space:nowrap}',
    '#hp-invite-panel .hp-inv-generate-btn{background:' + GOLD + ';color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;width:100%;margin-bottom:10px}',
    '#hp-invite-panel .hp-inv-generate-btn:hover{background:#b8822e}',
    '#hp-invite-panel .hp-inv-revoke-btn{background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:8px 16px;font-size:12px;cursor:pointer;width:100%}',
    '#hp-invite-panel .hp-inv-respondent-info{background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#4ade80}',
    '#hp-invite-panel .hp-inv-close{position:absolute;top:12px;right:12px;background:transparent;border:none;color:' + POWDER + ';font-size:18px;cursor:pointer;opacity:0.6;line-height:1}',
    '.hp-shared-badge{display:inline-block;background:rgba(201,144,58,0.15);color:' + GOLD + ';border:1px solid rgba(201,144,58,0.3);border-radius:12px;padding:2px 8px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-left:6px;vertical-align:middle}',
    '.hp-shared-readonly-banner{background:rgba(30,45,78,0.8);border:1px solid rgba(201,144,58,0.3);border-radius:8px;padding:10px 14px;margin:12px 0;display:flex;align-items:center;gap:8px;font-size:13px;color:' + POWDER + '}',
    '.hp-shared-readonly-banner svg{flex-shrink:0;color:' + GOLD + '}',
    '#hp-invite-panel{position:fixed}'
  ].join('\n');
  document.head.appendChild(style);

  // ══════════════════════════════════════════════════════════════════
  // 1. JOIN PAGE  /#/join/:token
  // ══════════════════════════════════════════════════════════════════
  var joinOverlay = null;

  function removeJoinOverlay() {
    if (joinOverlay && joinOverlay.parentNode) {
      joinOverlay.remove();
      joinOverlay = null;
    }
  }

  function renderJoinOverlay(token) {
    removeJoinOverlay();
    joinOverlay = document.createElement('div');
    joinOverlay.id = 'hp-join-overlay';
    joinOverlay.innerHTML = '<div id="hp-join-card"><div style="font-size:32px;margin-bottom:12px">🤝</div><h2>You\'ve been invited to collaborate</h2><p class="hp-join-sub">Loading case details…</p></div>';
    document.body.appendChild(joinOverlay);

    // Fetch invite preview (no auth needed)
    fetch(API + '/api/invite/' + encodeURIComponent(token))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var card = document.getElementById('hp-join-card');
        if (!card) return;

        if (data.error || data.message) {
          card.innerHTML = [
            '<div style="font-size:40px;margin-bottom:12px">⚠️</div>',
            '<h2 style="color:#f87171">Invalid or Expired Invite</h2>',
            '<p class="hp-join-sub">' + (data.message || 'This invite link is no longer valid.') + '</p>',
            '<button class="hp-btn-outline" onclick="window.location.hash=\'#/\'">Go to Home</button>'
          ].join('');
          return;
        }

        var expired = data.expiresAt && Date.now() > data.expiresAt;
        var alreadyActive = data.collabStatus === 'active' && data.alreadyLinked;
        var loggedIn = !!getToken();

        var html = [
          '<div style="font-size:32px;margin-bottom:12px">🤝</div>',
          '<h2>You\'ve been invited to collaborate</h2>',
          '<p class="hp-join-sub">Review the case details below and accept to link your account.</p>',
          '<div class="hp-join-case">',
          '  <div class="hp-join-case-label">Case</div>',
          '  <div class="hp-join-case-title">' + escHtml(data.caseTitle || 'Unnamed Case') + '</div>',
          '  <div class="hp-join-case-applicant">Applicant: ' + escHtml(data.applicantName || 'Unknown') + '</div>',
          '</div>'
        ];

        if (expired) {
          html.push('<p class="hp-join-expired">⏰ This invite has expired. Ask the applicant to generate a new link.</p>');
          html.push('<button class="hp-btn-outline" onclick="window.location.hash=\'#/\'">Go to Home</button>');
        } else if (alreadyActive) {
          html.push('<p class="hp-join-status">✅ You are already linked to this case as the respondent.</p>');
          html.push('<button class="hp-btn-gold" onclick="window.location.hash=\'#/case/' + data.caseId + '\'">Open Case</button>');
        } else if (!loggedIn) {
          html.push('<p class="hp-join-sub" style="margin-bottom:16px">You need an account to accept this invite. Sign in or create one first — your invite link will still work after.</p>');
          html.push('<button class="hp-btn-gold" onclick="window.__hp_pending_invite=\'' + escHtml(token) + '\';window.location.hash=\'#/register\'">Create Account</button>');
          html.push('<button class="hp-btn-outline" style="margin-top:8px" onclick="window.__hp_pending_invite=\'' + escHtml(token) + '\';window.location.hash=\'#/login\'">Sign In</button>');
        } else {
          html.push('<button class="hp-btn-gold" id="hp-accept-invite-btn">Accept &amp; Join Case</button>');
          html.push('<button class="hp-btn-outline" style="margin-top:8px" onclick="window.location.hash=\'#/\'">Cancel</button>');
        }

        html.push('</div>');
        card.innerHTML = html.join('');

        var acceptBtn = document.getElementById('hp-accept-invite-btn');
        if (acceptBtn) {
          acceptBtn.addEventListener('click', function() {
            acceptBtn.disabled = true;
            acceptBtn.textContent = 'Joining…';
            apiFetch('/api/invite/' + encodeURIComponent(token) + '/accept', { method: 'POST' })
              .then(function(r) { return r.json(); })
              .then(function(res) {
                if (res.ok) {
                  showToast('You are now linked to the case as the respondent!');
                  removeJoinOverlay();
                  setTimeout(function() {
                    window.location.hash = '#/case/' + res.caseId;
                  }, 400);
                } else {
                  showToast(res.message || 'Failed to accept invite.', true);
                  acceptBtn.disabled = false;
                  acceptBtn.textContent = 'Accept & Join Case';
                }
              })
              .catch(function() {
                showToast('Network error. Please try again.', true);
                acceptBtn.disabled = false;
                acceptBtn.textContent = 'Accept & Join Case';
              });
          });
        }
      })
      .catch(function() {
        var card = document.getElementById('hp-join-card');
        if (card) {
          card.innerHTML = '<h2 style="color:#f87171">Connection Error</h2><p class="hp-join-sub">Could not load invite details. Please check your connection.</p><button class="hp-btn-outline" onclick="window.location.hash=\'#/\'">Go Home</button>';
        }
      });
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Check pending invite after login/register
  function checkPendingInvite() {
    var pending = window.__hp_pending_invite;
    if (pending && getToken()) {
      window.__hp_pending_invite = null;
      renderJoinOverlay(pending);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 2. INVITE PANEL (owner — injected on /#/case/:id pages)
  // ══════════════════════════════════════════════════════════════════
  var inviteFab = null;
  var invitePanel = null;
  var invitePanelOpen = false;
  var currentInviteCaseId = null;
  var inviteCollabState = { status: 'none', token: null, inviteUrl: null, respondentEmail: null };

  function removeInvitePanel() {
    if (inviteFab && inviteFab.parentNode) inviteFab.remove();
    if (invitePanel && invitePanel.parentNode) invitePanel.remove();
    inviteFab = null;
    invitePanel = null;
    invitePanelOpen = false;
    currentInviteCaseId = null;
  }

  function renderInvitePanel(caseId) {
    if (window.__hp_noFabs) return;
    if (currentInviteCaseId === caseId && inviteFab) return; // already mounted for this case
    removeInvitePanel();
    currentInviteCaseId = caseId;

    // FAB button
    inviteFab = document.createElement('div');
    inviteFab.id = 'hp-invite-fab';
    inviteFab.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>Collaborate</span>';
    document.body.appendChild(inviteFab);

    // Panel
    invitePanel = document.createElement('div');
    invitePanel.id = 'hp-invite-panel';
    document.body.appendChild(invitePanel);

    // Close button added after panel is in DOM
    renderInvitePanelContent();

    inviteFab.addEventListener('click', function() {
      invitePanelOpen = !invitePanelOpen;
      invitePanel.style.display = invitePanelOpen ? 'block' : 'none';
      if (invitePanelOpen) {
        loadCollabStatus(caseId);
      }
    });
  }

  // ── Open collab content inside a provided container (for unified drawer) ──
  function openCollabInContainer(caseId, container) {
    currentInviteCaseId = caseId;
    // Use a temporary div as the invitePanel target
    invitePanel = container;
    inviteFab = { parentNode: null, remove: function(){} }; // stub
    invitePanelOpen = true;
    renderInvitePanelContent();
    loadCollabStatus(caseId);
  }

  function renderInvitePanelContent() {
    if (!invitePanel) return;
    var st = inviteCollabState;
    var statusClass = 'hp-inv-status-' + (st.status || 'none');
    var statusLabel = st.status === 'active' ? '● Active Collaboration' : st.status === 'invited' ? '⏳ Invite Pending' : '○ No Collaboration';

    var html = [
      '<button class="hp-inv-close" id="hp-inv-close-btn">✕</button>',
      '<h3>Two-Party Collaboration</h3>',
      '<p class="hp-inv-sub">Invite the other party to view shared case data.</p>',
      '<span class="hp-inv-status-badge ' + statusClass + '">' + statusLabel + '</span>'
    ];

    if (st.status === 'active' && st.respondentEmail) {
      html.push('<div class="hp-inv-respondent-info">✓ Linked: ' + escHtml(st.respondentEmail) + '</div>');
    }

    if (st.inviteUrl) {
      html.push('<div class="hp-inv-link-row">');
      html.push('<div class="hp-inv-link-input" id="hp-inv-link-display" title="' + escHtml(st.inviteUrl) + '">' + escHtml(st.inviteUrl.replace('https://api-production-2334.up.railway.app', '')) + '</div>');
      html.push('<button class="hp-inv-copy-btn" id="hp-inv-copy-btn">Copy</button>');
      html.push('</div>');
    }

    if (st.status !== 'active') {
      html.push('<button class="hp-inv-generate-btn" id="hp-inv-generate-btn">' + (st.inviteUrl ? '↺ Regenerate Link' : '+ Generate Invite Link') + '</button>');
    }

    if (st.status === 'active' || st.inviteUrl) {
      html.push('<button class="hp-inv-revoke-btn" id="hp-inv-revoke-btn">' + (st.status === 'active' ? 'Revoke Collaboration' : 'Cancel Invite') + '</button>');
    }

    invitePanel.innerHTML = html.join('');

    // Wire close
    var closeBtn = document.getElementById('hp-inv-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        invitePanelOpen = false;
        invitePanel.style.display = 'none';
      });
    }

    // Wire copy
    var copyBtn = document.getElementById('hp-inv-copy-btn');
    if (copyBtn && st.inviteUrl) {
      copyBtn.addEventListener('click', function() {
        copyToClipboard(st.inviteUrl).then(function() {
          copyBtn.textContent = '✓ Copied!';
          setTimeout(function() { copyBtn.textContent = 'Copy'; }, 2000);
        });
      });
    }

    // Wire generate
    var genBtn = document.getElementById('hp-inv-generate-btn');
    if (genBtn) {
      genBtn.addEventListener('click', function() {
        genBtn.disabled = true;
        genBtn.textContent = 'Generating…';
        apiFetch('/api/cases/' + currentInviteCaseId + '/invite', { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.inviteUrl || data.token) {
              inviteCollabState.inviteUrl = data.inviteUrl;
              inviteCollabState.token = data.token;
              inviteCollabState.status = inviteCollabState.status === 'active' ? 'active' : 'invited';
              renderInvitePanelContent();
              showToast('Invite link generated. Share it with the other party.');
            } else {
              showToast(data.message || 'Failed to generate invite.', true);
              genBtn.disabled = false;
              genBtn.textContent = '+ Generate Invite Link';
            }
          })
          .catch(function() {
            showToast('Network error.', true);
            genBtn.disabled = false;
            genBtn.textContent = '+ Generate Invite Link';
          });
      });
    }

    // Wire revoke
    var revokeBtn = document.getElementById('hp-inv-revoke-btn');
    if (revokeBtn) {
      revokeBtn.addEventListener('click', function() {
        if (!confirm('Are you sure you want to revoke this collaboration? The other party will lose access.')) return;
        revokeBtn.disabled = true;
        revokeBtn.textContent = 'Revoking…';
        apiFetch('/api/cases/' + currentInviteCaseId + '/collab', { method: 'DELETE' })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.ok || !data.error) {
              inviteCollabState = { status: 'none', token: null, inviteUrl: null, respondentEmail: null };
              renderInvitePanelContent();
              showToast('Collaboration revoked.');
            } else {
              showToast(data.message || 'Failed to revoke.', true);
              revokeBtn.disabled = false;
              revokeBtn.textContent = 'Revoke Collaboration';
            }
          })
          .catch(function() { showToast('Network error.', true); });
      });
    }
  }

  function loadCollabStatus(caseId) {
    apiFetch('/api/cases/' + caseId + '/collab-status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        inviteCollabState = {
          status: data.collabStatus || 'none',
          token: data.inviteToken || null,
          inviteUrl: data.inviteToken
            ? (window.location.origin + '/#/join/' + data.inviteToken)
            : null,
          respondentEmail: data.respondentEmail || null
        };
        renderInvitePanelContent();
      })
      .catch(function() {
        inviteCollabState = { status: 'none', token: null, inviteUrl: null, respondentEmail: null };
        renderInvitePanelContent();
      });
  }

  // ══════════════════════════════════════════════════════════════════
  // 3. RESPONDENT SHARED-CASE VIEW
  // ══════════════════════════════════════════════════════════════════
  var sharedCasesLoaded = false;

  function injectSharedCaseBadges() {
    // Called after dashboard renders — look for case cards and add Shared badge
    // to any case where the current user is the respondent
    if (!getToken()) return;

    apiFetch('/api/cases/shared')
      .then(function(r) { return r.json(); })
      .then(function(cases) {
        if (!Array.isArray(cases) || cases.length === 0) return;
        var sharedIds = cases.reduce(function(acc, c) { acc[c.id] = c; return acc; }, {});

        // Look for case card elements — they typically have data-case-id or href #/case/:id
        var allLinks = document.querySelectorAll('[href*="#/case/"], [data-case-id]');
        allLinks.forEach(function(el) {
          var id = el.getAttribute('data-case-id') ||
                   (el.getAttribute('href') || '').replace(/.*#\/case\/(\d+).*/, '$1');
          if (id && sharedIds[id]) {
            if (!el.querySelector('.hp-shared-badge')) {
              var badge = document.createElement('span');
              badge.className = 'hp-shared-badge';
              badge.textContent = 'Shared';
              el.appendChild(badge);
            }
          }
        });

        // Also check case title elements
        document.querySelectorAll('[class*="case"]').forEach(function(el) {
          var textContent = el.textContent;
          cases.forEach(function(c) {
            if (c.title && textContent.includes(c.title)) {
              if (!el.querySelector('.hp-shared-badge')) {
                var badge = document.createElement('span');
                badge.className = 'hp-shared-badge';
                badge.textContent = 'Shared';
                el.appendChild(badge);
              }
            }
          });
        });
      })
      .catch(function() {});
  }

  function injectReadOnlyBanner(caseId) {
    // Check if current user is the respondent on this case
    apiFetch('/api/cases/' + caseId + '/collab-status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var uid = currentUserId();
        // respondentUserId comes back as number; uid may be string
        if (data.respondentUserId && String(data.respondentUserId) === String(uid)) {
          // This user is the respondent — inject read-only banner
          var existing = document.getElementById('hp-shared-readonly-banner');
          if (existing) return;

          // Find a good injection point — top of the case content area
          var targets = [
            document.querySelector('[class*="case-header"]'),
            document.querySelector('[class*="wizard"]'),
            document.querySelector('main'),
            document.querySelector('#app')
          ];
          var target = null;
          for (var i = 0; i < targets.length; i++) {
            if (targets[i]) { target = targets[i]; break; }
          }
          if (!target) return;

          var banner = document.createElement('div');
          banner.id = 'hp-shared-readonly-banner';
          banner.className = 'hp-shared-readonly-banner';
          banner.innerHTML = [
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
            '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
            '</svg>',
            '<span>You are viewing this case as the <strong>respondent</strong>. Form data is read-only. You can see all information entered by the applicant.</span>'
          ].join('');
          target.insertBefore(banner, target.firstChild);
        }
      })
      .catch(function() {});
  }

  // ══════════════════════════════════════════════════════════════════
  // 4. HASH ROUTER — listen for relevant hash changes
  // ══════════════════════════════════════════════════════════════════
  function onCollabHashChange() {
    var hash = window.location.hash || '';

    // JOIN PAGE
    var joinMatch = hash.match(/#\/join\/([^/?#]+)/);
    if (joinMatch) {
      // Remove any invite panel that might be showing
      removeInvitePanel();
      renderJoinOverlay(joinMatch[1]);
      return;
    }

    // Not on join page — remove join overlay if present
    removeJoinOverlay();

    // Check if pending invite should be processed (after login)
    checkPendingInvite();

    // CASE PAGE — owner gets invite FAB, respondent gets read-only banner
    var caseMatch = hash.match(/#\/case\/(\d+)/);
    if (caseMatch) {
      var caseId = caseMatch[1];
      // Load collab status to decide what to show
      apiFetch('/api/cases/' + caseId + '/collab-status')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var uid = currentUserId();
          var isRespondent = data.respondentUserId && String(data.respondentUserId) === String(uid);
          if (isRespondent) {
            // Show read-only banner, no invite panel
            removeInvitePanel();
            setTimeout(function() { injectReadOnlyBanner(caseId); }, 800);
          } else {
            // Show invite FAB for owner
            setTimeout(function() { renderInvitePanel(caseId); }, 800);
          }
        })
        .catch(function() {
          // Default to showing invite FAB for owner
          setTimeout(function() { renderInvitePanel(caseId); }, 800);
        });
      return;
    }

    // Dashboard — inject shared case badges
    if (hash === '#/' || hash === '' || hash === '#') {
      removeInvitePanel();
      setTimeout(injectSharedCaseBadges, 1500);
      return;
    }

    // Any other page — remove invite panel
    removeInvitePanel();
  }

  window.addEventListener('hashchange', onCollabHashChange);
  // Run on load
  setTimeout(onCollabHashChange, 2000);

  // Expose for external use
  window.__hp_collab = {
    renderJoinOverlay: renderJoinOverlay,
    renderInvitePanel: renderInvitePanel,
    openCollabInContainer: openCollabInContainer,
    injectSharedCaseBadges: injectSharedCaseBadges,
    checkPendingInvite: checkPendingInvite
  };

})();

// ─── PHASE D: EVIDENCE STORAGE PANEL ─────────────────────────────────────────
// Full evidence management: categories, labels, descriptions, search, preview
// Floating "Evidence" button on /#/case/:id/* routes (Plus plan only)
// ─────────────────────────────────────────────────────────────────────────────
(function() {
  var RAILWAY_EP = 'https://api-production-2334.up.railway.app';

  var CATEGORIES = [
    { key: 'financial',      label: 'Financial',       icon: '💰', color: '#22895E' },
    { key: 'communications', label: 'Communications',  icon: '💬', color: '#2563EB' },
    { key: 'photos',         label: 'Photos',          icon: '📷', color: '#7C3AED' },
    { key: 'court_orders',   label: 'Court Orders',    icon: '⚖️',  color: '#C9903A' },
    { key: 'medical',        label: 'Medical',         icon: '🏥', color: '#DC2626' },
    { key: 'other',          label: 'Other',           icon: '📎', color: '#6B7280' }
  ];

  function getCat(key) {
    return CATEGORIES.find(function(c) { return c.key === key; }) || CATEGORIES[CATEGORIES.length - 1];
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(typeof ts === 'number' ? ts : parseInt(ts));
    return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function isImage(fileType) {
    return fileType && fileType.startsWith('image/');
  }

  function isPDF(fileType) {
    return fileType === 'application/pdf';
  }

  // ── CSS ──────────────────────────────────────────────────────────────────────
  (function injectEvidenceStyles() {
    if (document.getElementById('hp-ev-styles')) return;
    var s = document.createElement('style');
    s.id = 'hp-ev-styles';
    s.textContent = [
      '.hp-ev-btn{position:fixed;bottom:140px;right:24px;z-index:9000;display:flex;align-items:center;gap:8px;',
      'padding:10px 16px;background:#7C3AED;color:#fff;border:none;border-radius:24px;font-size:13px;',
      'font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(124,58,237,0.4);font-family:inherit;}',
      '.hp-ev-btn:hover{background:#6D28D9;}',
      '.hp-ev-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;',
      'align-items:stretch;justify-content:flex-end;}',
      '.hp-ev-panel{width:min(520px,100vw);background:#0f1117;display:flex;flex-direction:column;',
      'height:100vh;overflow:hidden;border-left:1px solid #2a2f3e;font-family:inherit;}',
      '.hp-ev-header{padding:20px 24px 16px;border-bottom:1px solid #2a2f3e;flex-shrink:0;}',
      '.hp-ev-header h2{color:#fff;font-size:18px;font-weight:700;margin:0 0 4px;}',
      '.hp-ev-header p{color:#8892a0;font-size:12px;margin:0;}',
      '.hp-ev-toolbar{padding:12px 24px;border-bottom:1px solid #2a2f3e;display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;}',
      '.hp-ev-search{flex:1;min-width:160px;background:#161920;border:1px solid #2a2f3e;border-radius:8px;',
      'padding:8px 12px;color:#fff;font-size:13px;font-family:inherit;outline:none;}',
      '.hp-ev-search:focus{border-color:#7C3AED;}',
      '.hp-ev-search::placeholder{color:#4a5568;}',
      '.hp-ev-cat-filter{display:flex;gap:6px;flex-wrap:wrap;padding:0 24px 10px;flex-shrink:0;}',
      '.hp-ev-cat-chip{padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;',
      'border:1.5px solid #2a2f3e;background:transparent;color:#8892a0;font-family:inherit;}',
      '.hp-ev-cat-chip.active{color:#fff;border-color:transparent;}',
      '.hp-ev-list{flex:1;overflow-y:auto;padding:12px 16px 80px;}',
      '.hp-ev-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'padding:60px 20px;color:#4a5568;text-align:center;}',
      '.hp-ev-empty .icon{font-size:40px;margin-bottom:12px;}',
      '.hp-ev-card{background:#161920;border:1px solid #2a2f3e;border-radius:10px;margin-bottom:8px;',
      'overflow:hidden;transition:border-color .15s;}',
      '.hp-ev-card:hover{border-color:#3d4558;}',
      '.hp-ev-card-top{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;}',
      '.hp-ev-card-icon{font-size:20px;flex-shrink:0;margin-top:2px;}',
      '.hp-ev-card-body{flex:1;min-width:0;}',
      '.hp-ev-card-name{color:#e2e8f0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.hp-ev-card-meta{display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap;}',
      '.hp-ev-cat-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;color:#fff;}',
      '.hp-ev-card-size{font-size:11px;color:#6b7280;}',
      '.hp-ev-card-date{font-size:11px;color:#6b7280;}',
      '.hp-ev-card-desc{font-size:11px;color:#8892a0;margin-top:4px;font-style:italic;}',
      '.hp-ev-card-actions{display:flex;gap:6px;flex-shrink:0;}',
      '.hp-ev-action-btn{background:transparent;border:1px solid #2a2f3e;border-radius:6px;',
      'padding:5px 8px;color:#8892a0;cursor:pointer;font-size:11px;font-family:inherit;}',
      '.hp-ev-action-btn:hover{border-color:#7C3AED;color:#a78bfa;}',
      '.hp-ev-action-btn.danger:hover{border-color:#ef4444;color:#ef4444;}',
      '.hp-ev-preview{background:#0a0c12;border-top:1px solid #2a2f3e;padding:12px 14px;display:none;}',
      '.hp-ev-preview img{max-width:100%;border-radius:6px;max-height:280px;object-fit:contain;}',
      '.hp-ev-edit-form{background:#0a0c12;border-top:1px solid #2a2f3e;padding:12px 14px;display:none;}',
      '.hp-ev-edit-form input,.hp-ev-edit-form textarea,.hp-ev-edit-form select{',
      'width:100%;background:#161920;border:1px solid #2a2f3e;border-radius:6px;',
      'padding:7px 10px;color:#e2e8f0;font-size:12px;font-family:inherit;margin-bottom:8px;box-sizing:border-box;outline:none;}',
      '.hp-ev-edit-form input:focus,.hp-ev-edit-form textarea:focus,.hp-ev-edit-form select:focus{border-color:#7C3AED;}',
      '.hp-ev-edit-form select option{background:#161920;}',
      '.hp-ev-save-edit{background:#7C3AED;color:#fff;border:none;border-radius:6px;',
      'padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;}',
      '.hp-ev-save-edit:hover{background:#6D28D9;}',
      '.hp-ev-upload-bar{position:absolute;bottom:0;left:0;right:0;padding:14px 16px;',
      'background:#0f1117;border-top:1px solid #2a2f3e;}',
      '.hp-ev-upload-btn{width:100%;background:#7C3AED;color:#fff;border:none;border-radius:8px;',
      'padding:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}',
      '.hp-ev-upload-btn:hover{background:#6D28D9;}',
      '.hp-ev-uploading{color:#8892a0;font-size:12px;text-align:center;padding:8px;}',
      '.hp-ev-close-btn{background:transparent;border:none;color:#6b7280;cursor:pointer;',
      'font-size:20px;line-height:1;padding:4px;margin-left:auto;}',
      '.hp-ev-close-btn:hover{color:#fff;}',
      '.hp-ev-count{font-size:11px;color:#6b7280;padding:0 24px 8px;flex-shrink:0;}',
    ].join('');
    document.head.appendChild(s);
  })();

  // ── State ────────────────────────────────────────────────────────────────────
  var evState = {
    caseId: null,
    docs: [],
    filter: 'all',
    search: '',
    isPlus: false
  };

  // ── API helpers ──────────────────────────────────────────────────────────────
  function evFetch(path, opts) {
    return fetch(RAILWAY_EP + path, Object.assign({
      headers: Object.assign({ 'Content-Type': 'application/json' }, window.__authHdr ? window.__authHdr() : {})
    }, opts || {}));
  }

  async function loadDocs() {
    var r = await evFetch('/api/cases/' + evState.caseId + '/documents');
    if (!r.ok) return;
    evState.docs = await r.json();
  }

  // ── Filter / search ──────────────────────────────────────────────────────────
  function filteredDocs() {
    return evState.docs.filter(function(d) {
      var catOk = evState.filter === 'all' || d.category === evState.filter;
      var q = evState.search.toLowerCase();
      var searchOk = !q ||
        (d.fileName || '').toLowerCase().includes(q) ||
        (d.label || '').toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q) ||
        (d.category || '').toLowerCase().includes(q);
      return catOk && searchOk;
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function renderEvidencePanel() {
    var panel = document.getElementById('hp-ev-panel-root');
    if (!panel) return;
    var filtered = filteredDocs();

    // Category filter chips
    var catHtml = '<button class="hp-ev-cat-chip' + (evState.filter === 'all' ? ' active" style="background:#7C3AED;border-color:#7C3AED' : '') + '" data-cat="all">All (' + evState.docs.length + ')</button>';
    CATEGORIES.forEach(function(c) {
      var count = evState.docs.filter(function(d) { return d.category === c.key; }).length;
      if (count === 0) return;
      var isActive = evState.filter === c.key;
      catHtml += '<button class="hp-ev-cat-chip' + (isActive ? ' active' : '') + '" data-cat="' + c.key + '"' +
        (isActive ? ' style="background:' + c.color + ';border-color:' + c.color + '"' : '') + '>' +
        c.icon + ' ' + c.label + ' (' + count + ')</button>';
    });
    panel.querySelector('.hp-ev-cat-filter').innerHTML = catHtml;
    panel.querySelector('.hp-ev-count').textContent = filtered.length + ' of ' + evState.docs.length + ' document' + (evState.docs.length === 1 ? '' : 's');

    // Document cards
    var listEl = panel.querySelector('.hp-ev-list');
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="hp-ev-empty"><div class="icon">' +
        (evState.docs.length === 0 ? '📂' : '🔍') + '</div><p>' +
        (evState.docs.length === 0 ? 'No documents uploaded yet.<br>Tap the button below to add your first file.' : 'No documents match your search.') +
        '</p></div>';
    } else {
      var html = '';
      filtered.forEach(function(d) {
        var cat = getCat(d.category);
        var docIcon = isImage(d.fileType) ? '🖼️' : isPDF(d.fileType) ? '📄' : '📎';
        html += '<div class="hp-ev-card" data-doc-id="' + d.id + '">' +
          '<div class="hp-ev-card-top">' +
            '<div class="hp-ev-card-icon">' + docIcon + '</div>' +
            '<div class="hp-ev-card-body">' +
              '<div class="hp-ev-card-name" title="' + (d.fileName || '') + '">' + (d.label || d.fileName || 'Untitled') + '</div>' +
              '<div class="hp-ev-card-meta">' +
                '<span class="hp-ev-cat-badge" style="background:' + cat.color + '">' + cat.icon + ' ' + cat.label + '</span>' +
                '<span class="hp-ev-card-size">' + fmtSize(d.fileSize) + '</span>' +
                '<span class="hp-ev-card-date">' + fmtDate(d.uploadedAt) + '</span>' +
              '</div>' +
              (d.description ? '<div class="hp-ev-card-desc">' + d.description + '</div>' : '') +
            '</div>' +
            '<div class="hp-ev-card-actions">' +
              (isImage(d.fileType) ? '<button class="hp-ev-action-btn hp-ev-preview-btn" data-doc-id="' + d.id + '" title="Preview">👁</button>' : '') +
              '<button class="hp-ev-action-btn extract hp-ev-parse-btn" data-doc-id="' + d.id + '" title="Extract & Auto-fill">⚡ Extract</button>' +
              '<button class="hp-ev-action-btn hp-ev-edit-btn" data-doc-id="' + d.id + '" title="Edit">✏️</button>' +
              '<button class="hp-ev-action-btn hp-ev-dl-btn" data-doc-id="' + d.id + '" data-name="' + (d.fileName || 'file') + '" title="Download">⬇</button>' +
              '<button class="hp-ev-action-btn danger hp-ev-del-btn" data-doc-id="' + d.id + '" title="Delete">🗑</button>' +
            '</div>' +
          '</div>' +
          '<div class="hp-ev-preview" id="hp-ev-preview-' + d.id + '"></div>' +
          '<div class="hp-ev-edit-form" id="hp-ev-edit-' + d.id + '">' +
            '<select class="hp-ev-cat-select" data-doc-id="' + d.id + '">' +
              CATEGORIES.map(function(c) {
                return '<option value="' + c.key + '"' + (d.category === c.key ? ' selected' : '') + '>' + c.icon + ' ' + c.label + '</option>';
              }).join('') +
            '</select>' +
            '<input class="hp-ev-label-input" type="text" placeholder="Label (e.g. Bank statement March 2026)" value="' + (d.label || '') + '" data-doc-id="' + d.id + '" />' +
            '<textarea class="hp-ev-desc-input" placeholder="Notes (optional)" rows="2" data-doc-id="' + d.id + '">' + (d.description || '') + '</textarea>' +
            '<button class="hp-ev-save-edit" data-doc-id="' + d.id + '">Save</button>' +
          '</div>' +
        '</div>';
      });
      listEl.innerHTML = html;
    }

    // Wire category chips
    panel.querySelectorAll('.hp-ev-cat-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        evState.filter = this.dataset.cat;
        renderEvidencePanel();
      });
    });

    // Wire preview buttons
    panel.querySelectorAll('.hp-ev-preview-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var docId = this.dataset.docId;
        var previewEl = document.getElementById('hp-ev-preview-' + docId);
        if (previewEl.style.display === 'block') { previewEl.style.display = 'none'; return; }
        previewEl.innerHTML = '<div style="color:#8892a0;font-size:12px;padding:4px">Loading preview…</div>';
        previewEl.style.display = 'block';
        try {
          var r = await evFetch('/api/cases/' + evState.caseId + '/documents/' + docId);
          var data = await r.json();
          if (data.fileData && data.fileType) {
            previewEl.innerHTML = '<img src="data:' + data.fileType + ';base64,' + data.fileData + '" alt="Preview" />';
          } else {
            previewEl.innerHTML = '<div style="color:#8892a0;font-size:12px;padding:4px">Preview not available</div>';
          }
        } catch(e) { previewEl.innerHTML = '<div style="color:#ef4444;font-size:12px;padding:4px">Failed to load preview</div>'; }
      });
    });

    // Wire edit buttons
    panel.querySelectorAll('.hp-ev-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var docId = this.dataset.docId;
        var editEl = document.getElementById('hp-ev-edit-' + docId);
        editEl.style.display = editEl.style.display === 'block' ? 'none' : 'block';
      });
    });

    // Wire save edit buttons
    panel.querySelectorAll('.hp-ev-save-edit').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var docId = this.dataset.docId;
        var card = panel.querySelector('.hp-ev-card[data-doc-id="' + docId + '"]');
        var category = card.querySelector('.hp-ev-cat-select').value;
        var label = card.querySelector('.hp-ev-label-input').value.trim();
        var description = card.querySelector('.hp-ev-desc-input').value.trim();
        this.textContent = 'Saving…';
        try {
          await evFetch('/api/cases/' + evState.caseId + '/documents/' + docId, {
            method: 'PATCH',
            body: JSON.stringify({ label, category, description })
          });
          // Update local state
          var doc = evState.docs.find(function(d) { return String(d.id) === String(docId); });
          if (doc) { doc.label = label; doc.category = category; doc.description = description; }
          document.getElementById('hp-ev-edit-' + docId).style.display = 'none';
          renderEvidencePanel();
        } catch(e) { this.textContent = 'Error — retry'; }
      });
    });

    // Wire download buttons
    panel.querySelectorAll('.hp-ev-dl-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var docId = this.dataset.docId;
        var name = this.dataset.name;
        this.textContent = '⏳';
        try {
          var r = await evFetch('/api/cases/' + evState.caseId + '/documents/' + docId);
          var data = await r.json();
          if (data.fileData) {
            var byteStr = atob(data.fileData);
            var ab = new ArrayBuffer(byteStr.length);
            var ia = new Uint8Array(ab);
            for (var i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
            var blob = new Blob([ab], { type: data.fileType || 'application/octet-stream' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 2000);
          }
        } catch(e) {}
        this.textContent = '⬇';
      });
    });

    // Wire delete buttons
    panel.querySelectorAll('.hp-ev-del-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var docId = this.dataset.docId;
        if (!confirm('Delete this document? This cannot be undone.')) return;
        try {
          await evFetch('/api/cases/' + evState.caseId + '/documents/' + docId, { method: 'DELETE' });
          evState.docs = evState.docs.filter(function(d) { return String(d.id) !== String(docId); });
          renderEvidencePanel();
        } catch(e) { alert('Delete failed. Please try again.'); }
      });
    });

    // ── Wire Extract & Auto-fill buttons ──────────────────────────────────────
    panel.querySelectorAll('.hp-ev-parse-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var docId = this.dataset.docId;
        var doc   = evState.docs.find(function(d) { return String(d.id) === String(docId); });
        openParseConfirm(docId, doc ? (doc.label || doc.fileName || 'Document') : 'Document');
      });
    });
  }

  // ── Parse confirm sheet ───────────────────────────────────────────────────
  async function openParseConfirm(docId, docName) {
    if (document.getElementById('hp-parse-overlay')) return;

    // Show loading sheet immediately
    var overlay = document.createElement('div');
    overlay.className = 'hp-parse-overlay';
    overlay.id = 'hp-parse-overlay';
    overlay.innerHTML =
      '<div class="hp-parse-sheet" style="position:relative;">' +
        '<div class="hp-parse-header">' +
          '<h3>⚡ Extracting fields…</h3>' +
          '<p>Reading your document with AI — this takes about 10 seconds</p>' +
          '<button class="hp-parse-close" id="hp-parse-close">✕</button>' +
        '</div>' +
        '<div class="hp-parse-body"><div class="hp-parse-empty">Analyzing document…</div></div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('hp-parse-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Call the parse endpoint
    var result;
    try {
      var r = await evFetch('/api/cases/' + evState.caseId + '/documents/' + docId + '/parse', { method: 'POST' });
      result = await r.json();
    } catch(e) {
      result = { fields: [], docTypeLabel: docName };
    }

    var fields     = (result && Array.isArray(result.fields)) ? result.fields : [];
    var docTypeLabel = (result && result.docTypeLabel) ? result.docTypeLabel : docName;

    // Rebuild sheet with results
    var bodyHtml = '';
    if (fields.length === 0) {
      var emptyMsg;
      if (result && result._encrypted) {
        emptyMsg = '<div class="hp-parse-empty" style="line-height:1.6;">' +
          '<div style="font-size:2rem;margin-bottom:12px;">🔒</div>' +
          '<strong>Password-Protected PDF</strong><br><br>' +
          'This PDF is encrypted and can\'t be read directly.<br><br>' +
          '<strong>Easy fix:</strong> Take a screenshot or photo of the paystub on your phone, then upload the image — the AI can extract all the same fields from a photo.<br><br>' +
          '<small style="color:#8892a0;">Tip: On iPhone, open the PDF in the Files app and take a screenshot with Side + Volume Up.</small>' +
          '</div>';
      } else {
        emptyMsg = '<div class="hp-parse-empty">No fields could be extracted from this document.<br><br>' +
          '<small style="color:#4a5568;">Make sure the document is clear and well-lit. Try uploading a photo/screenshot instead of a PDF if the PDF is encrypted.</small></div>';
      }
      bodyHtml = emptyMsg;
    } else {
      fields.forEach(function(f, i) {
        var conf = f.confidence || 'medium';
        var confLabel = conf === 'high' ? 'High confidence' : conf === 'medium' ? 'Review' : 'Uncertain';
        var sectionLabel = {
          applicant: 'Your personal info',
          respondent: 'Respondent info',
          f13_employment: 'Employment & income',
          f13_income: 'Income (tax)',
          children: 'Children',
          marriage: 'Marriage details'
        }[f.section] || f.section || '';
        bodyHtml +=
          '<div class="hp-parse-field" data-field-idx="' + i + '">' +
            '<div class="hp-parse-field-header">' +
              '<span class="hp-parse-field-label">' + (f.label || f.key) + '</span>' +
              '<span class="hp-parse-confidence ' + conf + '">' + confLabel + '</span>' +
            '</div>' +
            '<input type="text" value="' + (f.value || '').replace(/"/g, '&quot;') + '" data-key="' + f.key + '" data-section="' + (f.section || '') + '" />' +
            (sectionLabel ? '<div class="hp-parse-section-tag">→ ' + sectionLabel + '</div>' : '') +
          '</div>';
      });
    }

    var existingSheet = overlay.querySelector('.hp-parse-sheet');
    existingSheet.innerHTML =
      '<div class="hp-parse-header" style="position:relative;">' +
        '<h3>⚡ ' + docTypeLabel + ' — ' + fields.length + ' field' + (fields.length !== 1 ? 's' : '') + ' found</h3>' +
        '<p>Review each field, make any edits, then tap Apply to My Forms</p>' +
        '<button class="hp-parse-close" id="hp-parse-close2">✕</button>' +
      '</div>' +
      '<div class="hp-parse-body">' + bodyHtml + '</div>' +
      (fields.length > 0 ?
        '<div class="hp-parse-footer">' +
          '<button class="hp-parse-cancel-btn" id="hp-parse-cancel">Cancel</button>' +
          '<button class="hp-parse-apply-btn" id="hp-parse-apply">Apply to My Forms ✓</button>' +
        '</div>' : '');

    document.getElementById('hp-parse-close2') && document.getElementById('hp-parse-close2').addEventListener('click', function() { overlay.remove(); });
    document.getElementById('hp-parse-cancel') && document.getElementById('hp-parse-cancel').addEventListener('click', function() { overlay.remove(); });

    if (fields.length > 0) {
      document.getElementById('hp-parse-apply').addEventListener('click', function() {
        // Collect current (possibly edited) values from inputs
        var toApply = [];
        overlay.querySelectorAll('.hp-parse-field input').forEach(function(inp) {
          var val = inp.value.trim();
          if (val) toApply.push({ key: inp.dataset.key, section: inp.dataset.section, value: val });
        });
        applyParsedFields(toApply, overlay);
      });
    }
  }

  // ── Apply extracted fields into active wizard ────────────────────────────
  function applyParsedFields(fields, overlay) {
    var applied = 0;

    fields.forEach(function(f) {
      var key     = f.key;
      var section = f.section;
      var value   = f.value;
      if (!key || !value) return;

      // Strategy 1: write into window.__hp_autofill cache (wizard reads this on mount/step change)
      if (!window.__hp_autofill_cache) window.__hp_autofill_cache = {};
      if (!window.__hp_autofill_cache[section]) window.__hp_autofill_cache[section] = {};
      window.__hp_autofill_cache[section][key] = value;

      // Strategy 2: directly set value on any matching visible input/select/textarea
      // Try: name="fieldKey", id="fieldKey", data-field-id="fieldKey", data-key="fieldKey"
      var selectors = [
        'input[name="' + key + '"]',
        'input[id="' + key + '"]',
        'input[data-field-id="' + key + '"]',
        'input[data-key="' + key + '"]',
        'textarea[name="' + key + '"]',
        'select[name="' + key + '"]',
        'select[id="' + key + '"]',
        '[data-testid="input-' + key + '"]',
        '[data-testid="' + key + '"]'
      ];

      var found = false;
      selectors.forEach(function(sel) {
        if (found) return;
        var el = document.querySelector(sel);
        if (!el) return;
        // Set value
        var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (nativeInputValueSetter) {
          nativeInputValueSetter.set.call(el, value);
        } else {
          el.value = value;
        }
        // Fire React synthetic events so state updates
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        found = true;
        applied++;
      });

      // Strategy 3: Try React fiber — find input by label text nearby
      if (!found) {
        var allInputs = document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea');
        allInputs.forEach(function(inp) {
          if (found) return;
          // Check associated label or placeholder
          var labelEl = inp.id ? document.querySelector('label[for="' + inp.id + '"]') : null;
          var labelText = (labelEl ? labelEl.textContent : '') + (inp.placeholder || '') + (inp.name || '');
          // Match on key words in label — heuristic
          var keyWords = key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
          if (labelText.toLowerCase().includes(keyWords.replace(/\s+/g,''))) {
            var niv = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (niv) niv.set.call(inp, value); else inp.value = value;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            found = true;
            applied++;
          }
        });
      }
    });

    // Persist to case form_data — build array for PUT /form-data bulk endpoint
    // Also try the /autofill endpoint as a secondary path
    var caseId = evState.caseId || (window.__hp_state && window.__hp_state.caseId);
    if (caseId) {
      // Build bulk array for the reliable PUT endpoint
      var bulkRows = [];
      fields.forEach(function(f) {
        if (f.key && f.value !== null && f.value !== undefined && f.value !== '') {
          bulkRows.push({ section: f.section || 'autofill', fieldKey: f.key, fieldValue: String(f.value) });
        }
      });
      if (bulkRows.length > 0) {
        // Primary: PUT /form-data bulk save (definitely exists)
        evFetch('/api/cases/' + caseId + '/form-data', {
          method: 'PUT',
          body: JSON.stringify(bulkRows)
        }).then(function(r) {
          if (r && r.ok) console.log('[hp-extract] Saved', bulkRows.length, 'fields to DB via PUT');
        }).catch(function(e) {
          console.warn('[hp-extract] PUT form-data failed:', e);
          // Fallback: POST /autofill
          if (window.__hp_autofill_cache) {
            evFetch('/api/cases/' + caseId + '/autofill', {
              method: 'POST',
              body: JSON.stringify({ fields: window.__hp_autofill_cache })
            }).catch(function(){});
          }
        });
      }
    }

    // Show success state
    var sheet = overlay.querySelector('.hp-parse-sheet');
    sheet.innerHTML =
      '<div class="hp-parse-success">' +
        '<div class="icon">✅</div>' +
        '<h4>Fields Saved!</h4>' +
        '<p>' + fields.length + ' field' + (fields.length !== 1 ? 's' : '') + ' extracted and saved to your Answers.<br>' +
        'Check the <strong>Answers tab</strong> to confirm — they\'re ready to use in all your forms.</p>' +
        '<button class="hp-parse-apply-btn" id="hp-parse-done" style="margin-top:16px;max-width:200px;">Done</button>' +
      '</div>';
    document.getElementById('hp-parse-done').addEventListener('click', function() { overlay.remove(); });
    setTimeout(function() { if (document.getElementById('hp-parse-overlay')) { document.getElementById('hp-parse-overlay').remove(); } }, 4000);
  }

  // ── Upload handler ───────────────────────────────────────────────────────────
  async function handleUpload(file) {
    var panel = document.getElementById('hp-ev-panel-root');
    var statusEl = panel ? panel.querySelector('.hp-ev-uploading') : null;
    if (statusEl) statusEl.textContent = 'Uploading ' + file.name + '…';
    try {
      var fd = new FormData();
      fd.append('file', file);
      // Default category from extension
      var ext = file.name.split('.').pop().toLowerCase();
      var defaultCat = 'other';
      if (['jpg','jpeg','png','gif','webp','heic','heif'].includes(ext)) defaultCat = 'photos';
      if (file.name.toLowerCase().includes('statement') || file.name.toLowerCase().includes('bank')) defaultCat = 'financial';
      fd.append('category', defaultCat);

      var r = await fetch(RAILWAY_EP + '/api/cases/' + evState.caseId + '/documents', {
        method: 'POST',
        headers: window.__authHdr ? window.__authHdr() : {},
        body: fd
      });
      if (!r.ok) throw new Error('Upload failed');
      var newDoc = await r.json();
      evState.docs.unshift(newDoc);
      if (statusEl) statusEl.textContent = '';
      renderEvidencePanel();
    } catch(e) {
      if (statusEl) statusEl.textContent = 'Upload failed — please try again';
    }
  }

  // ── Open panel ───────────────────────────────────────────────────────────────
  async function openEvidencePanel(caseId) {
    if (document.getElementById('hp-ev-panel-root')) return;
    evState.caseId = caseId;
    evState.filter = 'all';
    evState.search = '';

    // Check Plus plan
    var isPlus = false;
    if (window.__hp_currentUser) {
      var u = window.__hp_currentUser;
      isPlus = (u.subscriptionStatus === 'active' || u.subscription_status === 'active') && (u.plan === 'plus');
    } else if (window.__hp_plan === 'plus' && window.__hp_sub_status === 'active') {
      isPlus = true;
    }
    evState.isPlus = isPlus;

    var overlay = document.createElement('div');
    overlay.className = 'hp-ev-overlay';
    overlay.id = 'hp-ev-panel-root';

    overlay.innerHTML =
      '<div class="hp-ev-panel" style="position:relative;">' +
        '<div class="hp-ev-header">' +
          '<div style="display:flex;align-items:center;">' +
            '<div>' +
              '<h2>📂 Evidence Storage</h2>' +
              '<p>Securely store photos, documents, and communications for your case.</p>' +
            '</div>' +
            '<button class="hp-ev-close-btn" id="hp-ev-close">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="hp-ev-toolbar">' +
          '<input class="hp-ev-search" type="text" placeholder="Search documents…" id="hp-ev-search-input" />' +
        '</div>' +
        '<div class="hp-ev-cat-filter"></div>' +
        '<div class="hp-ev-count"></div>' +
        '<div class="hp-ev-list"><div class="hp-ev-empty"><div class="icon">⏳</div><p>Loading…</p></div></div>' +
        (isPlus ?
          '<div class="hp-ev-upload-bar">' +
            '<div class="hp-ev-uploading"></div>' +
            '<button class="hp-ev-upload-btn" id="hp-ev-upload-btn">+ Upload Document or Photo</button>' +
            '<input type="file" id="hp-ev-file-input" style="display:none" accept=".jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.pdf,.doc,.docx,.txt" />' +
          '</div>' :
          '<div class="hp-ev-upload-bar"><p style="color:#C9903A;font-size:13px;text-align:center;margin:0;">Evidence storage is available on the <strong>Plus plan</strong> ($19.99/mo).</p></div>'
        ) +
      '</div>';

    document.body.appendChild(overlay);

    // Close handlers
    document.getElementById('hp-ev-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Search
    document.getElementById('hp-ev-search-input').addEventListener('input', function() {
      evState.search = this.value;
      renderEvidencePanel();
    });

    // Upload
    if (isPlus) {
      document.getElementById('hp-ev-upload-btn').addEventListener('click', function() {
        document.getElementById('hp-ev-file-input').click();
      });
      document.getElementById('hp-ev-file-input').addEventListener('change', function() {
        if (this.files && this.files[0]) handleUpload(this.files[0]);
        this.value = '';
      });
    }

    // Load and render
    await loadDocs();
    renderEvidencePanel();
  }

  // ── Floating button ──────────────────────────────────────────────────────────
  function injectEvidenceBtn(caseId) {
    if (window.__hp_noFabs) return;
    if (document.getElementById('hp-ev-fab')) return;
    var btn = document.createElement('button');
    btn.id = 'hp-ev-fab';
    btn.className = 'hp-ev-btn';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Evidence';
    btn.addEventListener('click', function() { openEvidencePanel(caseId); });
    document.body.appendChild(btn);
  }

  function removeEvidenceBtn() {
    var b = document.getElementById('hp-ev-fab');
    if (b) b.remove();
    var p = document.getElementById('hp-ev-panel-root');
    if (p) p.remove();
  }

  // ── Route handler ────────────────────────────────────────────────────────────
  var __evLastHash = '';
  function onEvHashChange() {
    var hash = window.location.hash;
    if (hash === __evLastHash) return;
    __evLastHash = hash;
    var caseMatch = hash.match(/#\/case\/(\d+)/);
    if (caseMatch) {
      setTimeout(function() { injectEvidenceBtn(caseMatch[1]); }, 1200);
    } else {
      removeEvidenceBtn();
    }
  }

  window.addEventListener('hashchange', onEvHashChange);
  setTimeout(onEvHashChange, 2000);

  // ── Inline mount for unified drawer (renders inside a provided container) ──
  async function openEvidenceInContainer(caseId, container) {
    // Remove any existing full-screen evidence panel
    var existing = document.getElementById('hp-ev-panel-root');
    if (existing) existing.remove();

    evState.caseId = caseId;
    evState.filter = 'all';
    evState.search = '';

    var isPlus = false;
    if (window.__hp_currentUser) {
      var u = window.__hp_currentUser;
      isPlus = (u.subscriptionStatus === 'active' || u.subscription_status === 'active') && (u.plan === 'plus');
    } else if (window.__hp_plan === 'plus' && window.__hp_sub_status === 'active') {
      isPlus = true;
    }
    evState.isPlus = isPlus;

    // Build the panel HTML directly inside container; give it hp-ev-panel-root id
    // so renderEvidencePanel() can find it
    container.innerHTML = '';
    var inner = document.createElement('div');
    inner.id = 'hp-ev-panel-root';
    inner.style.cssText = 'display:flex;flex-direction:column;height:100%;';
    inner.innerHTML =
      '<div class="hp-ev-toolbar" style="padding:12px 16px;">' +
        '<input class="hp-ev-search" type="text" placeholder="Search documents\u2026" id="hp-ev-search-input" />' +
      '</div>' +
      '<div class="hp-ev-cat-filter" style="padding:0 16px 8px;"></div>' +
      '<div class="hp-ev-count" style="padding:0 16px 4px;font-size:12px;color:#8892a0;"></div>' +
      '<div class="hp-ev-list" style="flex:1;overflow-y:auto;padding:0 16px 8px;"><div class="hp-ev-empty"><div class="icon">⏳</div><p>Loading\u2026</p></div></div>' +
      (isPlus ?
        '<div class="hp-ev-upload-bar">' +
          '<div class="hp-ev-uploading"></div>' +
          '<button class="hp-ev-upload-btn" id="hp-ev-upload-btn">+ Upload Document or Photo</button>' +
          '<input type="file" id="hp-ev-file-input" style="display:none" accept=".jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.pdf,.doc,.docx,.txt" />' +
        '</div>' :
        '<div class="hp-ev-upload-bar"><p style="color:#C9903A;font-size:13px;text-align:center;margin:0;">Evidence storage is available on the <strong>Plus plan</strong> ($19.99/mo).</p></div>'
      );
    container.appendChild(inner);

    // Wire search
    document.getElementById('hp-ev-search-input').addEventListener('input', function() {
      evState.search = this.value;
      renderEvidencePanel();
    });

    // Wire upload
    if (isPlus) {
      document.getElementById('hp-ev-upload-btn').addEventListener('click', function() {
        document.getElementById('hp-ev-file-input').click();
      });
      document.getElementById('hp-ev-file-input').addEventListener('change', function() {
        if (this.files && this.files[0]) handleUpload(this.files[0]);
        this.value = '';
      });
    }

    await loadDocs();
    renderEvidencePanel();
  }

  // Expose for unified Documents drawer
  window.__hp_evidence = {
    open: openEvidencePanel,
    openInContainer: openEvidenceInContainer
  };

})();


// ─── REVIEW PAGE: Evidence / Deadlines / Collaborate tabs ────────────────────
// Injects three additional tabs into the Answers | Documents tab bar on
// /#/case/:id/review, matching the exact same pill style. Removes the three
// floating FABs so everything lives in one place.
// ─────────────────────────────────────────────────────────────────────────────
(function() {

  var ACTIVE_CLS   = 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-background text-foreground shadow-sm';
  var INACTIVE_CLS = 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors text-muted-foreground hover:text-foreground';

  var TABS = [
    {
      id: 'evidence',
      label: 'Evidence',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
    },
    {
      id: 'deadlines',
      label: 'Deadlines',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
    },
    {
      id: 'collaborate',
      label: 'Collaborate',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
    }
  ];

  var currentCaseId  = null;
  var activeCustomTab = null; // 'evidence' | 'deadlines' | 'collaborate' | null
  var contentPanel   = null; // our injected content div
  var injected       = false;

  // ── Find the React tab bar ────────────────────────────────────────────────
  function findTabBar() {
    // The tab bar wraps the Answers + Documents buttons
    var allDivs = document.querySelectorAll('div.rounded-xl.bg-muted');
    for (var i = 0; i < allDivs.length; i++) {
      var d = allDivs[i];
      // Must contain exactly the Answers and Documents buttons (2 children)
      var btns = d.querySelectorAll('button');
      if (btns.length >= 2) {
        var labels = Array.from(btns).map(function(b) { return b.textContent.trim(); });
        if (labels.includes('Answers') && labels.includes('Documents')) {
          return d;
        }
      }
    }
    return null;
  }

  // ── Find the React content area below the tabs ────────────────────────────
  function findReactContent(tabBar) {
    // It's the next sibling element after the tab bar's parent chain
    var el = tabBar;
    while (el && el.nextElementSibling === null) el = el.parentElement;
    return el ? el.nextElementSibling : null;
  }

  // ── Show/hide native React content ───────────────────────────────────────
  function setReactContentVisible(visible) {
    var tabBar = findTabBar();
    if (!tabBar) return;
    var el = tabBar.nextElementSibling;
    if (el) el.style.display = visible ? '' : 'none';
    // Also look for a sibling further up
    var parent = tabBar.parentElement;
    if (parent) {
      Array.from(parent.children).forEach(function(child) {
        if (child !== tabBar && child !== contentPanel) {
          child.style.display = visible ? '' : 'none';
        }
      });
    }
  }

  // ── Inject content panel below tab bar ───────────────────────────────────
  function ensureContentPanel(tabBar) {
    if (contentPanel && contentPanel.parentNode) return contentPanel;
    contentPanel = document.createElement('div');
    contentPanel.id = 'hp-review-panel';
    contentPanel.style.cssText = 'margin-top:0;min-height:400px;';
    // Insert right after tabBar's parent if tabBar is direct child of a container
    var parent = tabBar.parentElement;
    if (parent) {
      // Insert after the tabBar
      tabBar.insertAdjacentElement('afterend', contentPanel);
    }
    return contentPanel;
  }

  // ── Switch to a custom tab ────────────────────────────────────────────────
  function activateCustomTab(tabId, caseId) {
    activeCustomTab = tabId;

    // Style all injected buttons
    TABS.forEach(function(t) {
      var btn = document.getElementById('hp-rtab-' + t.id);
      if (btn) btn.className = (t.id === tabId) ? ACTIVE_CLS : INACTIVE_CLS;
    });

    // Also de-style the native Answers/Documents buttons
    var tabBar = findTabBar();
    if (tabBar) {
      tabBar.querySelectorAll('button').forEach(function(b) {
        if (!b.id || !b.id.startsWith('hp-rtab-')) {
          // native button — make it look inactive
          b.className = INACTIVE_CLS;
        }
      });
    }

    // Hide React content, show our panel
    setReactContentVisible(false);
    var panel = ensureContentPanel(tabBar);
    panel.style.display = 'block';
    panel.innerHTML = '<div style="padding:40px 0;text-align:center;color:#8892a0;font-size:14px;">Loading…</div>';

    if (tabId === 'evidence') mountEvidenceTab(caseId, panel);
    else if (tabId === 'deadlines') mountDeadlinesTab(caseId, panel);
    else if (tabId === 'collaborate') mountCollabTab(caseId, panel);
  }

  // ── Deactivate custom tabs (user clicked Answers or Documents) ────────────
  function deactivateCustomTabs() {
    activeCustomTab = null;
    TABS.forEach(function(t) {
      var btn = document.getElementById('hp-rtab-' + t.id);
      if (btn) btn.className = INACTIVE_CLS;
    });
    if (contentPanel) contentPanel.style.display = 'none';
    setReactContentVisible(true);
  }

  // ── Evidence content ──────────────────────────────────────────────────────
  function mountEvidenceTab(caseId, panel) {
    function tryMount() {
      if (window.__hp_evidence && window.__hp_evidence.openInContainer) {
        window.__hp_evidence.openInContainer(caseId, panel);
      } else {
        setTimeout(tryMount, 300);
      }
    }
    tryMount();
  }

  // ── Deadlines content ─────────────────────────────────────────────────────
  function mountDeadlinesTab(caseId, panel) {
    function tryMount() {
      if (window.__hp_deadlines && window.__hp_deadlines.mount) {
        panel.innerHTML = '';
        window.__hp_deadlines.mount(panel, caseId);
      } else {
        setTimeout(tryMount, 300);
      }
    }
    tryMount();
  }

  // ── Collaborate content ───────────────────────────────────────────────────
  function mountCollabTab(caseId, panel) {
    function tryMount() {
      if (window.__hp_collab && window.__hp_collab.openCollabInContainer) {
        panel.innerHTML = '';
        // Style override so the collab panel renders inline
        if (!document.getElementById('hp-collab-inline-style')) {
          var st = document.createElement('style');
          st.id = 'hp-collab-inline-style';
          st.textContent = '#hp-review-panel #hp-invite-panel{position:relative!important;bottom:auto!important;right:auto!important;width:100%!important;display:block!important;box-shadow:none!important;border-radius:12px!important;background:rgba(30,45,78,0.4)!important;padding:24px!important;}';
          document.head.appendChild(st);
        }
        window.__hp_collab.openCollabInContainer(caseId, panel);
      } else {
        setTimeout(tryMount, 300);
      }
    }
    tryMount();
  }

  // ── Main injection ────────────────────────────────────────────────────────
  function injectTabs(caseId) {
    var tabBar = findTabBar();
    if (!tabBar) return false;

    // Don't inject twice
    if (document.getElementById('hp-rtab-evidence')) return true;

    // Make tab bar horizontally scrollable on mobile
    tabBar.style.cssText += ';overflow-x:auto;max-width:100%;flex-wrap:nowrap;-webkit-overflow-scrolling:touch;scrollbar-width:none;';
    if (!document.getElementById('hp-tabbar-scroll-style')) {
      var ss = document.createElement('style');
      ss.id = 'hp-tabbar-scroll-style';
      ss.textContent = 'div.rounded-xl.bg-muted::-webkit-scrollbar{display:none}';
      document.head.appendChild(ss);
    }

    TABS.forEach(function(t) {
      var btn = document.createElement('button');
      btn.id = 'hp-rtab-' + t.id;
      btn.className = INACTIVE_CLS;
      btn.innerHTML = t.icon + '<span>' + t.label + '</span>';
      btn.addEventListener('click', function() {
        activateCustomTab(t.id, caseId);
      });
      tabBar.appendChild(btn);
    });

    // Hook native Answers/Documents buttons to deactivate custom tabs
    tabBar.querySelectorAll('button').forEach(function(b) {
      if (!b.id || !b.id.startsWith('hp-rtab-')) {
        b.addEventListener('click', deactivateCustomTabs);
      }
    });

    injected = true;
    return true;
  }

  // ── Remove injected tabs (when leaving review page) ───────────────────────
  function cleanup() {
    TABS.forEach(function(t) {
      var btn = document.getElementById('hp-rtab-' + t.id);
      if (btn) btn.remove();
    });
    if (contentPanel) { contentPanel.remove(); contentPanel = null; }
    setReactContentVisible(true);
    activeCustomTab = null;
    injected = false;
  }

  // ── Suppress the floating FABs — everything lives in the tab bar now ──────
  window.__hp_noFabs = true;

  // ── Route handler ─────────────────────────────────────────────────────────
  var lastHash = '';

  function onHashChange() {
    var hash = window.location.hash || '';
    if (hash === lastHash) return;
    lastHash = hash;

    var reviewMatch = hash.match(/#\/case\/(\d+)\/review/);
    if (reviewMatch) {
      currentCaseId = reviewMatch[1];
      injected = false;
      // Poll until React has rendered the tab bar
      var attempts = 0;
      function tryInject() {
        if (injectTabs(currentCaseId)) return;
        if (++attempts < 20) setTimeout(tryInject, 200);
      }
      setTimeout(tryInject, 400);
      return;
    }

    // Left the review page
    cleanup();
  }

  window.addEventListener('hashchange', onHashChange);
  setTimeout(onHashChange, 1000);

  // MutationObserver re-injects if React re-renders the tab bar
  var obs = new MutationObserver(function() {
    var hash = window.location.hash || '';
    if (!hash.match(/#\/case\/\d+\/review/)) return;
    if (!document.getElementById('hp-rtab-evidence')) {
      injected = false;
      if (currentCaseId) injectTabs(currentCaseId);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Also suppress the individual FAB guards
  // (belt-and-suspenders — __hp_noFabs above handles the injection functions)

})();

// ─── Inject Form 6B into React quick-search (t8 array patch) ─────────────────
// The React bundle's t8 search list doesn't include Form 6B (added post-build).
// We patch window by intercepting the module's r8() search function once loaded.
(function() {
  var EXTRA_FORMS = [
    { id: 'form6b-service', badge: 'Form 6B', title: 'Affidavit of Service',
      tag: 'Required after serving documents',
      keywords: ['service', 'affidavit', 'served', '6b', 'proof of service'] }
  ];

  // Wait for the React search input to appear, then patch
  function patchSearch() {
    // Find the script bundle's module scope — look for r8 on window or module
    // Strategy: wrap the existing search textbox onChange to intercept results
    var input = document.querySelector('[data-testid="input-form-search"], input[placeholder*="form"], input[placeholder*="Form"]');
    if (!input) return false;

    // Already patched
    if (input.__hp_search_patched) return true;
    input.__hp_search_patched = true;

    // Watch the results container — when it renders, append our extra forms if they match the query
    var resultsObs = new MutationObserver(function() {
      var query = (input.value || '').toLowerCase().trim();
      if (!query) return;

      // Check if any extra form matches
      var matches = EXTRA_FORMS.filter(function(f) {
        return f.badge.toLowerCase().includes(query) ||
               f.title.toLowerCase().includes(query) ||
               f.tag.toLowerCase().includes(query) ||
               f.keywords.some(function(k) { return k.includes(query); });
      });
      if (!matches.length) return;

      // Find results list
      var list = document.querySelector('[data-testid^="button-search-result"]');
      if (!list) {
        // Check for "No forms found" — replace with our results
        var noResults = Array.from(document.querySelectorAll('p')).find(function(p) {
          return p.textContent.includes('No forms found');
        });
        if (noResults) {
          var container = noResults.closest('div');
          if (container && !container.__hp_injected) {
            container.__hp_injected = true;
            container.innerHTML = '';
            matches.forEach(function(f) {
              var btn = document.createElement('button');
              btn.className = 'w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-card transition-colors border-b border-card-border';
              btn.setAttribute('data-testid', 'button-search-result-' + f.id);
              btn.innerHTML =
                '<div class="flex-shrink-0 flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">' +
                  '<svg class="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
                '</div>' +
                '<div class="flex-1 min-w-0">' +
                  '<p class="text-sm font-medium text-foreground">' + f.title + '</p>' +
                  '<p class="text-xs text-muted-foreground">' + f.badge + ' \u00b7 ' + f.tag + '</p>' +
                '</div>' +
                '<svg class="h-4 w-4 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';

              btn.addEventListener('click', function() {
                // Navigate to add-form flow for this case or the form selector
                var hash = window.location.hash || '';
                var caseMatch = hash.match(/#\/case\/(\d+)/);
                if (caseMatch) {
                  window.location.hash = '#/case/' + caseMatch[1] + '/wizard/ON-F6B';
                } else {
                  window.location.hash = '#/forms/ON-F6B';
                }
              });
              container.appendChild(btn);
            });
          }
        }
      }
    });

    var searchContainer = input.closest('[class*="search"], [class*="Search"]') || input.parentElement.parentElement;
    if (searchContainer) {
      resultsObs.observe(searchContainer, { childList: true, subtree: true });
    }
    return true;
  }

  var attempts = 0;
  function tryPatch() {
    if (patchSearch()) return;
    if (++attempts < 30) setTimeout(tryPatch, 500);
  }
  setTimeout(tryPatch, 1000);

  // Re-run on hash change (new page load)
  window.addEventListener('hashchange', function() {
    attempts = 0;
    setTimeout(tryPatch, 800);
  });
})();


// ─── Wizard Encouragement Messages ────────────────────────────────────────────
// Personalized, context-aware messages that appear at meaningful moments
// in the form wizard — completing hard sections, hitting the halfway point,
// and reaching the final step before export.
(function() {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────

  // How long the card stays visible (ms) before fading out
  var DISPLAY_MS   = 5000;
  var FADE_MS      = 600;
  var COOLDOWN_MS  = 90000; // minimum gap between messages (1.5 min)

  // Keys of sections that should always trigger an empathy message
  var HARD_SECTIONS = [
    'violence', 'domestic', 'criminal', 'history', 'safety', 'protection',
    'harm', 'abuse', 'custody', 'danger', 'criminal_history', 'care_history',
    'f351_history', 'f351_violence', 'f351_care_history',
    'prior order', 'prior orders', 'restraining', 'protection order'
  ];

  // Section-title keywords mapped to a specific empathy line
  var SECTION_MESSAGES = {
    'violence':          'That section asks hard questions. You answered them. That takes real courage.',
    'domestic':          'That section asks hard questions. You answered them. That takes real courage.',
    'criminal':          'These questions are difficult. You\'re doing the right thing by being honest.',
    'history':           'Looking back is never easy. You\'re still moving forward.',
    'custody':           'Parenting questions can be emotional. You\'re advocating for your child — that matters.',
    'prior order':       'You\'ve been through this before. You know what\'s at stake — keep going.',
    'restraining':       'Your safety matters. You\'re taking the right steps.',
    'protection order':  'Your safety matters. You\'re taking the right steps.',
    'care':              'These questions exist to protect your child. You\'re doing that right now.',
    'affidavit':         'An affidavit is one of the most important documents you\'ll file. You\'re handling it.',
  };

  // Generic encouragements by position in the form
  var HALFWAY_MESSAGES = [
    'You\'re halfway through. Everything is saved — take a breath if you need one.',
    'Past the halfway point. The hard part is behind you.',
    'Halfway there. You\'re doing this.',
  ];

  var FINAL_STEP_MESSAGES = [
    'This is the last section. You\'ve done the work — almost there.',
    'Final step. Everything you\'ve entered is ready. You\'ve got this.',
    'Last section. You made it through the whole form.',
  ];

  var GENERIC_PROGRESS = [
    'You\'re making real progress. Keep going.',
    'Every section you complete is one step closer to your day in court.',
    'You\'re not alone in this. Hearth & Page is with you every step.',
    'Take it one section at a time. You\'re doing great.',
  ];

  // ── State ─────────────────────────────────────────────────────────────────
  var _lastShownAt    = 0;
  var _lastStepText   = '';
  var _shownSections  = {};   // prevent repeating the same section message
  var _styleInjected  = false;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getFirstName() {
    try {
      var u = window.__hp_currentUser || window.__hp_user || {};
      var full = u.fullName || u.full_name || u.name || u.email || '';
      if (!full) return '';
      // Use first word only, title-case it
      var first = full.split(/[\s@]/)[0];
      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    } catch(e) { return ''; }
  }

  function injectStyles() {
    if (_styleInjected) return;
    _styleInjected = true;
    var s = document.createElement('style');
    s.textContent = [
      '#hp-encourage-card{',
      '  position:fixed;bottom:88px;left:50%;transform:translateX(-50%);',
      '  z-index:9990;max-width:360px;width:calc(100% - 32px);',
      '  background:linear-gradient(135deg,#1E2D4E 0%,#0d1520 100%);',
      '  border:1px solid rgba(168,180,208,0.25);border-radius:16px;',
      '  padding:14px 18px;box-shadow:0 8px 32px rgba(0,0,0,0.45);',
      '  display:flex;align-items:flex-start;gap:12px;',
      '  animation:hp-enc-in 0.35s cubic-bezier(0.32,0.72,0,1);',
      '  transition:opacity ' + (FADE_MS/1000) + 's ease;',
      '}',
      '#hp-encourage-card.hp-enc-fade{opacity:0;}',
      '@keyframes hp-enc-in{from{transform:translateX(-50%) translateY(16px);opacity:0;}to{transform:translateX(-50%) translateY(0);opacity:1;}}',
      '#hp-encourage-icon{font-size:22px;line-height:1;flex-shrink:0;margin-top:1px;}',
      '#hp-encourage-body{flex:1;min-width:0;}',
      '#hp-encourage-name{font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;',
      '  color:#A8B4D0;font-family:DM Sans,system-ui,sans-serif;margin-bottom:3px;}',
      '#hp-encourage-msg{font-size:13.5px;font-weight:500;color:#ede8df;',
      '  font-family:DM Sans,system-ui,sans-serif;line-height:1.45;}',
      '#hp-encourage-sub{font-size:11px;color:rgba(237,232,223,0.50);',
      '  font-family:DM Sans,system-ui,sans-serif;margin-top:3px;}',
      '#hp-encourage-close{background:transparent;border:none;color:rgba(237,232,223,0.40);',
      '  font-size:16px;cursor:pointer;padding:0 0 0 8px;line-height:1;flex-shrink:0;align-self:flex-start;margin-top:2px;}',
      '#hp-encourage-close:hover{color:rgba(237,232,223,0.80);}',
    ].join('');
    document.head.appendChild(s);
  }

  function showCard(message, subtext, icon) {
    // Respect cooldown
    var now = Date.now();
    if (now - _lastShownAt < COOLDOWN_MS) return;
    _lastShownAt = now;

    injectStyles();

    // Remove any existing card
    var existing = document.getElementById('hp-encourage-card');
    if (existing) existing.remove();

    var firstName = getFirstName();
    var nameHtml = firstName
      ? '<div id="hp-encourage-name">Hey ' + firstName + '</div>'
      : '';

    var card = document.createElement('div');
    card.id = 'hp-encourage-card';
    card.innerHTML =
      '<div id="hp-encourage-icon">' + (icon || '💙') + '</div>' +
      '<div id="hp-encourage-body">' +
        nameHtml +
        '<div id="hp-encourage-msg">' + message + '</div>' +
        (subtext ? '<div id="hp-encourage-sub">' + subtext + '</div>' : '') +
      '</div>' +
      '<button id="hp-encourage-close" title="Dismiss">✕</button>';

    document.body.appendChild(card);

    // Dismiss on close button
    document.getElementById('hp-encourage-close').addEventListener('click', function() {
      dismissCard(card);
    });

    // Auto-dismiss
    setTimeout(function() { dismissCard(card); }, DISPLAY_MS);
  }

  function dismissCard(card) {
    if (!card || !card.parentNode) return;
    card.classList.add('hp-enc-fade');
    setTimeout(function() { if (card.parentNode) card.parentNode.removeChild(card); }, FADE_MS);
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ── Step change detection ─────────────────────────────────────────────────

  function getStepInfo() {
    // The wizard renders a subtitle like "Step 3 of 7" — find it in the DOM
    var subtitleEls = document.querySelectorAll('p, span, div, h2, h3');
    var stepText = '', sectionTitle = '';
    var current = 0, total = 0;

    for (var i = 0; i < subtitleEls.length; i++) {
      var el = subtitleEls[i];
      var t = el.textContent ? el.textContent.trim() : '';
      if (/^Step \d+ of \d+$/i.test(t)) {
        stepText = t;
        var m = t.match(/Step (\d+) of (\d+)/i);
        if (m) { current = parseInt(m[1]); total = parseInt(m[2]); }
      }
    }

    // Get the section heading (h2 or h3 near the top of the wizard body)
    var headings = document.querySelectorAll('h1, h2, h3');
    for (var j = 0; j < headings.length; j++) {
      var ht = headings[j].textContent ? headings[j].textContent.trim().toLowerCase() : '';
      if (ht.length > 3 && ht.length < 80 && !ht.includes('hearth') && !ht.includes('page')) {
        sectionTitle = ht;
        break;
      }
    }

    return { stepText: stepText, current: current, total: total, sectionTitle: sectionTitle };
  }

  function onStepChange() {
    // Only run inside the wizard
    if (!window.location.hash.includes('wizard')) return;

    var info = getStepInfo();
    if (!info.stepText || info.stepText === _lastStepText) return;
    _lastStepText = info.stepText;

    var current  = info.current;
    var total    = info.total;
    var section  = info.sectionTitle;
    var sectionKey = section.replace(/[^a-z0-9]+/g, '_');

    // ── Priority 1: Hard / sensitive section ─────────────────────────────
    var hardMsg = null;
    for (var keyword in SECTION_MESSAGES) {
      if (section.indexOf(keyword) >= 0) {
        hardMsg = SECTION_MESSAGES[keyword];
        break;
      }
    }
    if (hardMsg && !_shownSections[sectionKey]) {
      _shownSections[sectionKey] = true;
      showCard(hardMsg, 'You can pause anytime — your progress is saved.', '💙');
      return;
    }

    // ── Priority 2: Final step ────────────────────────────────────────────
    if (total > 0 && current === total && !_shownSections['__final__']) {
      _shownSections['__final__'] = true;
      showCard(pickRandom(FINAL_STEP_MESSAGES), 'Your forms will be ready to download after this.', '✅');
      return;
    }

    // ── Priority 3: Halfway ───────────────────────────────────────────────
    if (total >= 4 && current === Math.ceil(total / 2) && !_shownSections['__halfway__']) {
      _shownSections['__halfway__'] = true;
      showCard(pickRandom(HALFWAY_MESSAGES), 'Hearth & Page has your back.', '🏠');
      return;
    }

    // ── Priority 4: Generic progress every ~3 steps ───────────────────────
    if (current > 1 && current % 3 === 0 && !_shownSections['__generic_' + current + '__']) {
      _shownSections['__generic_' + current + '__'] = true;
      showCard(pickRandom(GENERIC_PROGRESS), null, '💙');
    }
  }

  // Reset shown-sections cache when user opens a new case or form
  window.addEventListener('hashchange', function() {
    var hash = window.location.hash || '';
    // New form opened — reset
    if (hash.includes('wizard')) {
      _lastStepText = '';
      // Keep _shownSections so we don't repeat within same form
      // but clear on new case navigation
    } else {
      // Navigated away from wizard — clear everything for fresh start
      _shownSections = {};
      _lastStepText  = '';
    }
    setTimeout(onStepChange, 600);
  });

  // Watch for DOM changes inside the wizard (step renders are DOM mutations)
  var _encObserver = new MutationObserver(function() {
    if (window.location.hash.includes('wizard')) {
      setTimeout(onStepChange, 300);
    }
  });

  function startEncObserver() {
    if (document.body) {
      _encObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startEncObserver);
  } else {
    startEncObserver();
  }

})();
