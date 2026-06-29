/**
 * Hearth & Page — FormEngine v1.1
 * Option A: runs ALONGSIDE existing hardcoded wizards.
 * 
 * v1.1 additions:
 *   - Ontario statutory holiday array (2024-2030)
 *   - calcDeadline(conferenceDate, businessDaysBefore) — proper business-day subtraction
 *   - renderUrgencyBanner(deadlineDate) — critical/warning/info/ok states
 *   - New field types: info, radio, number, computed, computed_deadline, computed_status
 *   - steps→parts compatibility shim in loadFormDef()
 *   - showIf→conditional adapter in shouldShowField()
 * 
 * Usage:
 *   window.__hp_FormEngine.render('ON-F8', caseId, containerId)
 *   window.__hp_FormEngine.render('ON-F17F', caseId, containerId)
 * 
 * Existing Form 8 / 35.1 / 13 wizards are untouched until
 * they are explicitly migrated by calling migrateForm().
 */

(function() {
  'use strict';

  var _RW = 'https://api-production-2334.up.railway.app';

  /* ─── Auth helper ─────────────────────────────────────────── */
  function authHdr() {
    var t = window.__hp_token;
    if (t) return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t };
    return { 'Content-Type': 'application/json' };
  }

  /* ─── Universal Client Profile ────────────────────────────── */
  var PROFILE_SCHEMA = {
    applicant: {
      firstName: '', lastName: '', fullName: '',
      dob: '', gender: '',
      address: '', unit: '', city: '', province: 'Ontario', postalCode: '',
      phone: '', email: '',
      language: 'English', interpreter: false
    },
    respondent: {
      firstName: '', lastName: '', fullName: '',
      dob: '', address: '', unit: '', phone: '',
      hasLawyer: false, lawyerName: '', lawyerFirm: '', lawyerPhone: ''
    },
    case: {
      courthouse: '', fileNumber: '', hasFile: false,
      caseType: '', filingProvince: 'ON',
      marriageDate: '', separationDate: '',
      hasPriorOrders: false, priorOrdersDetails: ''
    },
    children: [],
    income: {
      employmentType: '', annualGrossIncome: '', monthlyNetIncome: '',
      employer: '', selfEmployed: false, incomeYear: new Date().getFullYear() - 1
    }
  };

  var _profile = JSON.parse(JSON.stringify(PROFILE_SCHEMA));

  function loadProfile(caseId) {
    return fetch(_RW + '/api/cases/' + caseId + '/form-data', { headers: authHdr() })
      .then(function(r) { return r.json(); })
      .then(function(rows) {
        if (!Array.isArray(rows)) return;
        rows.forEach(function(row) {
          if (row.section === 'profile') {
            try {
              var parts = row.fieldKey.split('.');
              var val = row.fieldValue;
              try { val = JSON.parse(val); } catch(e) {}
              if (parts.length === 2 && _profile[parts[0]] !== undefined) {
                _profile[parts[0]][parts[1]] = val;
              }
            } catch(e) {}
          }
        });
      });
  }

  function saveProfileField(caseId, path, value) {
    var parts = path.split('.');
    if (parts.length === 2 && _profile[parts[0]] !== undefined) {
      _profile[parts[0]][parts[1]] = value;
    }
    return fetch(_RW + '/api/cases/' + caseId + '/form-data', {
      method: 'POST',
      headers: authHdr(),
      body: JSON.stringify({
        section: 'profile',
        fieldKey: path,
        fieldValue: typeof value === 'object' ? JSON.stringify(value) : String(value)
      })
    });
  }

  function resolveProfileValue(source) {
    if (!source || !source.startsWith('profile.')) return undefined;
    var path = source.replace('profile.', '');
    var parts = path.split('.');
    if (parts.length === 2 && _profile[parts[0]] !== undefined) {
      return _profile[parts[0]][parts[1]];
    }
    return undefined;
  }

  /* ─── Ontario Statutory Holidays 2024-2030 ────────────────── */
  // Sources: Ontario Employment Standards Act + federal stat holidays observed in ON
  var _onHolidays = (function() {
    var h = {};
    // Helper: mark a date string YYYY-MM-DD
    function mark(s) { h[s] = true; }

    // 2024
    mark('2024-01-01'); // New Year's Day
    mark('2024-02-19'); // Family Day (3rd Monday Feb)
    mark('2024-03-29'); // Good Friday
    mark('2024-05-20'); // Victoria Day (Mon before May 25)
    mark('2024-07-01'); // Canada Day
    mark('2024-08-05'); // Civic Holiday (1st Mon Aug)
    mark('2024-09-02'); // Labour Day (1st Mon Sep)
    mark('2024-10-14'); // Thanksgiving (2nd Mon Oct)
    mark('2024-11-11'); // Remembrance Day
    mark('2024-12-25'); // Christmas Day
    mark('2024-12-26'); // Boxing Day

    // 2025
    mark('2025-01-01'); // New Year's Day
    mark('2025-02-17'); // Family Day
    mark('2025-04-18'); // Good Friday
    mark('2025-05-19'); // Victoria Day
    mark('2025-07-01'); // Canada Day
    mark('2025-08-04'); // Civic Holiday
    mark('2025-09-01'); // Labour Day
    mark('2025-10-13'); // Thanksgiving
    mark('2025-11-11'); // Remembrance Day
    mark('2025-12-25'); // Christmas Day
    mark('2025-12-26'); // Boxing Day

    // 2026
    mark('2026-01-01'); // New Year's Day
    mark('2026-02-16'); // Family Day
    mark('2026-04-03'); // Good Friday
    mark('2026-05-18'); // Victoria Day
    mark('2026-07-01'); // Canada Day
    mark('2026-08-03'); // Civic Holiday
    mark('2026-09-07'); // Labour Day
    mark('2026-10-12'); // Thanksgiving
    mark('2026-11-11'); // Remembrance Day
    mark('2026-12-25'); // Christmas Day
    mark('2026-12-26'); // Boxing Day

    // 2027
    mark('2027-01-01'); // New Year's Day
    mark('2027-02-15'); // Family Day
    mark('2027-03-26'); // Good Friday
    mark('2027-05-24'); // Victoria Day
    mark('2027-07-01'); // Canada Day
    mark('2027-08-02'); // Civic Holiday
    mark('2027-09-06'); // Labour Day
    mark('2027-10-11'); // Thanksgiving
    mark('2027-11-11'); // Remembrance Day
    mark('2027-12-27'); // Christmas Day (observed, falls Sun)
    mark('2027-12-28'); // Boxing Day (observed)

    // 2028
    mark('2028-01-03'); // New Year's Day (observed, Jan 1 is Sat)
    mark('2028-02-21'); // Family Day
    mark('2028-04-14'); // Good Friday
    mark('2028-05-22'); // Victoria Day
    mark('2028-07-03'); // Canada Day (observed, Jul 1 is Sat)
    mark('2028-08-07'); // Civic Holiday
    mark('2028-09-04'); // Labour Day
    mark('2028-10-09'); // Thanksgiving
    mark('2028-11-13'); // Remembrance Day (observed, Nov 11 is Sat)
    mark('2028-12-25'); // Christmas Day
    mark('2028-12-26'); // Boxing Day

    // 2029
    mark('2029-01-01'); // New Year's Day
    mark('2029-02-19'); // Family Day
    mark('2029-03-30'); // Good Friday
    mark('2029-05-21'); // Victoria Day
    mark('2029-07-02'); // Canada Day (observed, Jul 1 is Sun)
    mark('2029-08-06'); // Civic Holiday
    mark('2029-09-03'); // Labour Day
    mark('2029-10-08'); // Thanksgiving
    mark('2029-11-12'); // Remembrance Day (observed, Nov 11 is Sun)
    mark('2029-12-25'); // Christmas Day
    mark('2029-12-26'); // Boxing Day

    // 2030
    mark('2030-01-01'); // New Year's Day
    mark('2030-02-18'); // Family Day
    mark('2030-04-19'); // Good Friday
    mark('2030-05-20'); // Victoria Day
    mark('2030-07-01'); // Canada Day
    mark('2030-08-05'); // Civic Holiday
    mark('2030-09-02'); // Labour Day
    mark('2030-10-14'); // Thanksgiving
    mark('2030-11-11'); // Remembrance Day
    mark('2030-12-25'); // Christmas Day
    mark('2030-12-26'); // Boxing Day

    return h;
  })();

  function _isHoliday(dateObj) {
    var y = dateObj.getFullYear();
    var m = String(dateObj.getMonth() + 1).padStart(2, '0');
    var d = String(dateObj.getDate()).padStart(2, '0');
    return !!_onHolidays[y + '-' + m + '-' + d];
  }

  function _isBusinessDay(dateObj) {
    var dow = dateObj.getDay(); // 0=Sun 6=Sat
    if (dow === 0 || dow === 6) return false;
    if (_isHoliday(dateObj)) return false;
    return true;
  }

  /**
   * calcDeadline(conferenceDateStr, businessDaysBefore)
   * Returns a Date object = deadline at 14:00 local time, N business days before the conference.
   * conferenceDateStr = 'YYYY-MM-DD'
   * businessDaysBefore = 3 (for Form 17F Rule 17(14))
   * 
   * Unit test: Monday 2026-06-29 conference, 3 biz days before
   *   Step back: Fri Jun 26 (1), Thu Jun 25 (2), Wed Jun 24 (3)
   *   → deadline = Wed Jun 24 at 14:00 ✓
   */
  function calcDeadline(conferenceDateStr, businessDaysBefore) {
    if (!conferenceDateStr) return null;
    // Parse as local midnight to avoid UTC-offset drift
    var parts = conferenceDateStr.split('-');
    if (parts.length !== 3) return null;
    var cursor = new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10),
      0, 0, 0, 0
    );
    var countdown = businessDaysBefore;
    while (countdown > 0) {
      cursor.setDate(cursor.getDate() - 1);
      if (_isBusinessDay(cursor)) countdown--;
    }
    // Deadline is 14:00 (2:00 PM) on that business day
    cursor.setHours(14, 0, 0, 0);
    return cursor;
  }

  /**
   * renderUrgencyBanner(deadlineDate, container)
   * Renders (or updates) the urgency banner based on hours remaining.
   * Thresholds: critical <24h, warning <72h, info <120h, ok otherwise.
   */
  function renderUrgencyBanner(deadlineDate, container) {
    if (!container) return;
    // Clear existing banner
    var existing = container.querySelector('.fe-urgency-banner');
    if (existing) existing.remove();

    if (!deadlineDate) {
      var empty = document.createElement('div');
      empty.className = 'fe-urgency-banner fe-urgency-none';
      empty.textContent = 'Enter your conference date above to see your filing deadline.';
      container.appendChild(empty);
      return;
    }

    var now = new Date();
    var hoursRemaining = (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    var deadlineStr = _formatDeadlineDate(deadlineDate);
    var banner = document.createElement('div');
    banner.className = 'fe-urgency-banner';

    if (hoursRemaining <= 0) {
      // Past deadline
      banner.className += ' fe-urgency-past';
      banner.innerHTML =
        '<span class="fe-urgency-icon" aria-hidden="true">&#x2716;</span>' +
        '<div><strong>DEADLINE MISSED — ' + deadlineStr + ' at 2:00 PM</strong>' +
        '<p>Your filing deadline has passed. Under Rule 17(14.1), the court SHALL cancel your conference unless the court orders otherwise. Contact the courthouse immediately.</p></div>';
    } else if (hoursRemaining <= 24) {
      banner.className += ' fe-urgency-critical';
      banner.innerHTML =
        '<span class="fe-urgency-icon" aria-hidden="true">&#x26A0;</span>' +
        '<div><strong>URGENT — Deadline TODAY by 2:00 PM (' + deadlineStr + ')</strong>' +
        '<p>File this confirmation immediately at the courthouse or through Justice Services Online. Missing this deadline cancels your conference automatically.</p></div>';
    } else if (hoursRemaining <= 72) {
      banner.className += ' fe-urgency-warning';
      banner.innerHTML =
        '<span class="fe-urgency-icon" aria-hidden="true">&#x26A0;</span>' +
        '<div><strong>Filing deadline: ' + deadlineStr + ' at 2:00 PM</strong>' +
        '<p>File soon. Missing this 3-business-day deadline automatically cancels your conference under Rule 17(14.1). Deliver a copy to the other party first.</p></div>';
    } else if (hoursRemaining <= 120) {
      banner.className += ' fe-urgency-info';
      banner.innerHTML =
        '<span class="fe-urgency-icon" aria-hidden="true">&#x2139;</span>' +
        '<div><strong>Filing deadline: ' + deadlineStr + ' at 2:00 PM</strong>' +
        '<p>Reminder: You must file at least 3 business days before your conference. Deliver a copy to the other party before filing.</p></div>';
    } else {
      banner.className += ' fe-urgency-ok';
      banner.innerHTML =
        '<span class="fe-urgency-icon" aria-hidden="true">&#x2713;</span>' +
        '<div><strong>Filing deadline: ' + deadlineStr + ' at 2:00 PM</strong>' +
        '<p>You have time, but do not wait. File well in advance and deliver a copy to the other party first.</p></div>';
    }

    container.appendChild(banner);
  }

  function _formatDeadlineDate(d) {
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /* ─── Form definition loader (with steps→parts shim) ─────── */
  var _formCache = {};

  function loadFormDef(formId) {
    if (_formCache[formId]) return Promise.resolve(_formCache[formId]);
    var def = (window.__hp_formDefs || {})[formId];
    if (!def) return Promise.reject(new Error('FormEngine: no definition for ' + formId));

    // ── steps→parts compatibility shim ──────────────────────
    // New Week 13 schemas use def.steps[]; engine expects def.parts[].
    // Map stepId→partId, stepNumber→partNumber if needed.
    if (def.steps && !def.parts) {
      def.parts = def.steps.map(function(step) {
        var part = JSON.parse(JSON.stringify(step)); // deep clone
        if (!part.partId && part.stepId) part.partId = step.stepId;
        if (!part.partNumber && part.stepNumber) part.partNumber = step.stepNumber;
        return part;
      });
    }

    // ── showIf→conditional adapter ───────────────────────────
    // New schemas use field.showIf = { field, value } or { field, operator, values }
    // Engine's shouldShowField() reads field.conditional = { dependsOn, showWhen }
    if (def.parts) {
      def.parts.forEach(function(part) {
        var allFields = (part.fields || []).slice();
        (part.groups || []).forEach(function(g) {
          allFields = allFields.concat(g.fields || []);
        });
        allFields.forEach(function(field) {
          if (field.showIf && !field.conditional) {
            var si = field.showIf;
            // Support: { field, value } and { field, operator:'in', values:[] }
            field.conditional = {
              dependsOn: si.field,
              showWhen: si.operator === 'in' ? si.values : si.value
            };
          }
        });
      });
    }

    _formCache[formId] = def;
    return Promise.resolve(def);
  }

  function registerFormDef(formId, def) {
    _formCache[formId] = def;
    window.__hp_formDefs = window.__hp_formDefs || {};
    window.__hp_formDefs[formId] = def;
  }

  /* ─── Field value store for current session ──────────────── */
  var _fieldValues = {};
  var _saveTimers  = {};

  function getFieldValue(fieldId, field, caseData) {
    if (_fieldValues[fieldId] !== undefined) return _fieldValues[fieldId];
    var saved = caseData[fieldId];
    if (saved !== undefined) return saved;
    if (field.source) {
      var profileVal = resolveProfileValue(field.source);
      if (profileVal !== undefined && profileVal !== '') return profileVal;
    }
    return field.default !== undefined ? field.default : '';
  }

  function setFieldValue(fieldId, value, field, caseId) {
    _fieldValues[fieldId] = value;
    if (field && field.source && field.source.startsWith('profile.')) {
      var path = field.source.replace('profile.', '');
      saveProfileField(caseId, path, value);
    }
    clearTimeout(_saveTimers[fieldId]);
    _saveTimers[fieldId] = setTimeout(function() {
      fetch(_RW + '/api/cases/' + caseId + '/form-data', {
        method: 'POST',
        headers: authHdr(),
        body: JSON.stringify({
          section: field && field.partId ? field.partId : 'form',
          fieldKey: fieldId,
          fieldValue: typeof value === 'object' ? JSON.stringify(value) : String(value)
        })
      });
    }, 600);
  }

  /* ─── Conditional logic ───────────────────────────────────── */
  // Handles both legacy { dependsOn, showWhen } and adapted showIf structures
  function shouldShowField(field) {
    if (!field.conditional) return true;
    var c = field.conditional;
    var depVal = _fieldValues[c.dependsOn];
    if (depVal === undefined) depVal = '';
    if (Array.isArray(c.showWhen)) return c.showWhen.includes(String(depVal));
    return String(depVal).toLowerCase() === String(c.showWhen).toLowerCase();
  }

  /* ─── Auto-calculate currency fields ─────────────────────── */
  function recalculate(def) {
    if (!def || !def.parts) return;
    def.parts.forEach(function(part) {
      var fields = part.fields || [];
      if (part.groups) {
        part.groups.forEach(function(g) { fields = fields.concat(g.fields || []); });
      }
      fields.forEach(function(field) {
        if (field.type !== 'currency_calculated' || !field.formula) return;
        var sumMatch = field.formula.match(/^sum\(\[([^\]]+)\]\)$/);
        if (sumMatch) {
          var ids = sumMatch[1].split(',').map(function(s) { return s.trim(); });
          var total = ids.reduce(function(acc, id) {
            return acc + (parseFloat(_fieldValues[id]) || 0);
          }, 0);
          _fieldValues[field.fieldId] = total.toFixed(2);
        }
        var subMatch = field.formula.match(/^(\w+)\s*-\s*(\w+)$/);
        if (subMatch) {
          var a = parseFloat(_fieldValues[subMatch[1]]) || 0;
          var b = parseFloat(_fieldValues[subMatch[2]]) || 0;
          _fieldValues[field.fieldId] = (a - b).toFixed(2);
        }
      });
    });
  }

  /* ─── Renderer ────────────────────────────────────────────── */
  function renderField(field, caseId, caseData, onUpdate, def) {
    if (!shouldShowField(field)) return null;

    var val = getFieldValue(field.fieldId, field, caseData);
    var wrapper = document.createElement('div');
    wrapper.className = 'fe-field';
    wrapper.dataset.fieldId = field.fieldId;

    // Label (suppressed for info, computed types, and checkbox which renders inline)
    var suppressLabel = ['info', 'computed_deadline', 'computed_status', 'computed', 'checkbox', 'currency_calculated'];
    if (field.label && suppressLabel.indexOf(field.type) === -1) {
      var lbl = document.createElement('label');
      lbl.className = 'fe-label' + (field.required ? ' fe-required' : '');
      lbl.textContent = field.label + (field.required ? ' *' : '');
      if (field.unit) {
        var unit = document.createElement('span');
        unit.className = 'fe-unit';
        unit.textContent = ' (' + field.unit + ')';
        lbl.appendChild(unit);
      }
      wrapper.appendChild(lbl);
    }

    // Help text
    if (field.helpText) {
      var help = document.createElement('p');
      help.className = 'fe-help';
      help.textContent = field.helpText;
      wrapper.appendChild(help);
    }

    var input;

    switch (field.type) {

      /* ── Existing types (unchanged) ─────────────────────── */
      case 'text':
      case 'email':
      case 'tel':
        input = document.createElement('input');
        input.type = field.type === 'tel' ? 'tel' : (field.type === 'email' ? 'email' : 'text');
        input.className = 'fe-input';
        input.value = val || '';
        input.placeholder = field.placeholder || '';
        input.addEventListener('input', function() {
          setFieldValue(field.fieldId, input.value, field, caseId);
          if (onUpdate) onUpdate();
        });
        wrapper.appendChild(input);
        break;

      case 'textarea':
        input = document.createElement('textarea');
        input.className = 'fe-textarea';
        input.rows = 4;
        input.value = val || '';
        input.placeholder = field.placeholder || '';
        input.addEventListener('input', function() {
          setFieldValue(field.fieldId, input.value, field, caseId);
          if (onUpdate) onUpdate();
        });
        wrapper.appendChild(input);
        break;

      case 'currency':
        input = document.createElement('input');
        input.type = 'number';
        input.className = 'fe-input fe-currency';
        input.step = '0.01';
        input.min = '0';
        input.value = val || '';
        input.placeholder = field.placeholder || '0.00';
        input.addEventListener('input', function() {
          setFieldValue(field.fieldId, input.value, field, caseId);
          if (onUpdate) onUpdate();
        });
        wrapper.appendChild(input);
        break;

      case 'currency_calculated':
        var calcLabel = document.createElement('label');
        calcLabel.className = 'fe-label fe-calc-label';
        calcLabel.textContent = field.label;
        var calcVal = document.createElement('div');
        calcVal.className = 'fe-calc-value';
        calcVal.dataset.calcId = field.fieldId;
        calcVal.textContent = '$' + (parseFloat(_fieldValues[field.fieldId]) || 0).toFixed(2);
        wrapper.appendChild(calcLabel);
        wrapper.appendChild(calcVal);
        break;

      case 'date':
        input = document.createElement('input');
        input.type = 'date';
        input.className = 'fe-input';
        input.value = val || '';
        input.addEventListener('change', function() {
          setFieldValue(field.fieldId, input.value, field, caseId);
          if (onUpdate) onUpdate();
          // If this is the conference_date trigger field, refresh any deadline banners
          if (field.fieldId === 'conference_date') {
            _refreshDeadlineBanners(input.value);
          }
        });
        wrapper.appendChild(input);
        break;

      case 'yesno':
        var yesnoWrap = document.createElement('div');
        yesnoWrap.className = 'fe-yesno';
        ['Yes', 'No'].forEach(function(opt) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'fe-yesno-btn' + (String(val).toLowerCase() === opt.toLowerCase() ? ' fe-yesno-active' : '');
          btn.textContent = opt;
          btn.addEventListener('click', function() {
            yesnoWrap.querySelectorAll('.fe-yesno-btn').forEach(function(b) {
              b.classList.remove('fe-yesno-active');
            });
            btn.classList.add('fe-yesno-active');
            setFieldValue(field.fieldId, opt.toLowerCase(), field, caseId);
            if (onUpdate) onUpdate();
          });
          yesnoWrap.appendChild(btn);
        });
        wrapper.appendChild(yesnoWrap);
        break;

      case 'select':
        input = document.createElement('select');
        input.className = 'fe-select';
        var opts = field.options || [];
        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = field.placeholder || 'Select...';
        input.appendChild(placeholder);
        opts.forEach(function(opt) {
          var o = document.createElement('option');
          o.value = typeof opt === 'object' ? opt.value : opt;
          o.textContent = typeof opt === 'object' ? opt.label : opt;
          if (val === o.value) o.selected = true;
          input.appendChild(o);
        });
        input.addEventListener('change', function() {
          setFieldValue(field.fieldId, input.value, field, caseId);
          if (onUpdate) onUpdate();
        });
        wrapper.appendChild(input);
        break;

      case 'checkbox':
        var cbWrap = document.createElement('label');
        cbWrap.className = 'fe-checkbox-label';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'fe-checkbox';
        cb.checked = val === true || val === 'true';
        cb.addEventListener('change', function() {
          setFieldValue(field.fieldId, cb.checked, field, caseId);
          if (onUpdate) onUpdate();
        });
        cbWrap.appendChild(cb);
        cbWrap.appendChild(document.createTextNode(' ' + (field.label || '')));
        wrapper.appendChild(cbWrap);
        break;

      /* ── NEW field types (v1.1) ──────────────────────────── */

      // info — static informational callout, no input
      case 'info':
        var infoBox = document.createElement('div');
        infoBox.className = 'fe-info-box';
        if (field.label) {
          var infoTitle = document.createElement('strong');
          infoTitle.className = 'fe-info-title';
          infoTitle.textContent = field.label;
          infoBox.appendChild(infoTitle);
        }
        var infoText = document.createElement('p');
        infoText.className = 'fe-info-text';
        infoText.textContent = field.content || field.helpText || '';
        infoBox.appendChild(infoText);
        wrapper.appendChild(infoBox);
        break;

      // radio — single-choice button group
      case 'radio':
        var radioWrap = document.createElement('div');
        radioWrap.className = 'fe-radio-group';
        (field.options || []).forEach(function(opt) {
          var optVal = typeof opt === 'object' ? opt.value : opt;
          var optLabel = typeof opt === 'object' ? opt.label : opt;
          var radioRow = document.createElement('label');
          radioRow.className = 'fe-radio-label' + (String(val) === String(optVal) ? ' fe-radio-selected' : '');
          var radioInput = document.createElement('input');
          radioInput.type = 'radio';
          radioInput.name = field.fieldId;
          radioInput.value = optVal;
          radioInput.checked = String(val) === String(optVal);
          radioInput.addEventListener('change', function() {
            radioWrap.querySelectorAll('.fe-radio-label').forEach(function(l) {
              l.classList.remove('fe-radio-selected');
            });
            radioRow.classList.add('fe-radio-selected');
            setFieldValue(field.fieldId, optVal, field, caseId);
            if (onUpdate) onUpdate();
          });
          radioRow.appendChild(radioInput);
          radioRow.appendChild(document.createTextNode(' ' + optLabel));
          radioWrap.appendChild(radioRow);
        });
        wrapper.appendChild(radioWrap);
        break;

      // number — integer or decimal input
      case 'number':
        input = document.createElement('input');
        input.type = 'number';
        input.className = 'fe-input';
        input.value = val || '';
        input.placeholder = field.placeholder || '';
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        input.step = field.step !== undefined ? field.step : '1';
        input.addEventListener('input', function() {
          setFieldValue(field.fieldId, input.value, field, caseId);
          if (onUpdate) onUpdate();
        });
        wrapper.appendChild(input);
        break;

      // computed — read-only calculated display (non-currency)
      case 'computed':
        var compLabel = document.createElement('label');
        compLabel.className = 'fe-label fe-calc-label';
        compLabel.textContent = field.label || '';
        var compVal = document.createElement('div');
        compVal.className = 'fe-computed-value';
        compVal.dataset.computedId = field.fieldId;
        // Evaluate formula if present
        compVal.textContent = _evalComputedField(field) || field.default || '—';
        wrapper.appendChild(compLabel);
        wrapper.appendChild(compVal);
        break;

      // computed_deadline — urgency banner driven by conference_date
      case 'computed_deadline':
        // Render the banner container; will be populated by _refreshDeadlineBanners
        var bannerContainer = document.createElement('div');
        bannerContainer.className = 'fe-deadline-banner-host';
        bannerContainer.dataset.bannerHost = 'deadline_urgency_banner';
        // Initial render using whatever conference_date is already stored
        var confDate = _fieldValues['conference_date'] || '';
        var deadlineDate = confDate ? calcDeadline(confDate, 3) : null;
        renderUrgencyBanner(deadlineDate, bannerContainer);
        wrapper.appendChild(bannerContainer);
        break;

      // computed_status — waiting-period status display (Form 36B)
      case 'computed_status':
        var statusContainer = document.createElement('div');
        statusContainer.className = 'fe-status-display';
        statusContainer.dataset.statusId = field.fieldId;
        _updateWaitingPeriodStatus(statusContainer);
        wrapper.appendChild(statusContainer);
        break;

      default:
        wrapper.innerHTML += '<p class="fe-unsupported">Field type "' + field.type + '" — coming soon</p>';
    }

    return wrapper;
  }

  /* ─── Deadline banner refresh (called when conference_date changes) */
  function _refreshDeadlineBanners(conferenceDateVal) {
    var hosts = document.querySelectorAll('[data-banner-host="deadline_urgency_banner"]');
    hosts.forEach(function(host) {
      var dl = conferenceDateVal ? calcDeadline(conferenceDateVal, 3) : null;
      renderUrgencyBanner(dl, host);
    });
  }

  /* ─── Computed field evaluator ───────────────────────────── */
  function _evalComputedField(field) {
    if (!field.formula) return field.default || '';
    // sum([a,b,...])
    var sumMatch = field.formula.match(/^sum\(\[([^\]]+)\]\)$/);
    if (sumMatch) {
      var ids = sumMatch[1].split(',').map(function(s) { return s.trim(); });
      var total = ids.reduce(function(acc, id) {
        return acc + (parseFloat(_fieldValues[id]) || 0);
      }, 0);
      return String(total);
    }
    // a + b (number)
    var addMatch = field.formula.match(/^(\w+)\s*\+\s*(\w+)$/);
    if (addMatch) {
      var a = parseFloat(_fieldValues[addMatch[1]]) || 0;
      var b = parseFloat(_fieldValues[addMatch[2]]) || 0;
      return String(a + b);
    }
    // a - b
    var subMatch = field.formula.match(/^(\w+)\s*-\s*(\w+)$/);
    if (subMatch) {
      var x = parseFloat(_fieldValues[subMatch[1]]) || 0;
      var y = parseFloat(_fieldValues[subMatch[2]]) || 0;
      return String(x - y);
    }
    return field.default || '';
  }

  /* ─── Waiting period status (Form 36B) ───────────────────── */
  function _updateWaitingPeriodStatus(container) {
    var divorceOrderDate = _fieldValues['divorce_order_date'] || '';
    var earlyOrdered = _fieldValues['early_effective_date_ordered'] || '';
    var earlyDate = _fieldValues['early_effective_date'] || '';

    container.innerHTML = '';
    if (!divorceOrderDate) {
      container.innerHTML = '<p class="fe-status-pending">Enter your divorce order date above to see your waiting period status.</p>';
      return;
    }

    var orderParts = divorceOrderDate.split('-');
    if (orderParts.length !== 3) {
      container.innerHTML = '<p class="fe-status-pending">Invalid date format.</p>';
      return;
    }
    var orderDt = new Date(parseInt(orderParts[0]),parseInt(orderParts[1])-1,parseInt(orderParts[2]));
    var effectiveDt;

    if (earlyOrdered === 'yes' && earlyDate) {
      var ep = earlyDate.split('-');
      effectiveDt = ep.length === 3
        ? new Date(parseInt(ep[0]),parseInt(ep[1])-1,parseInt(ep[2]))
        : new Date(orderDt.getTime() + 31 * 86400000);
    } else {
      // Default: 31 days after order date
      effectiveDt = new Date(orderDt.getTime() + 31 * 86400000);
    }

    var now = new Date();
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    var effStr = months[effectiveDt.getMonth()] + ' ' + effectiveDt.getDate() + ', ' + effectiveDt.getFullYear();

    if (now >= effectiveDt) {
      container.innerHTML =
        '<div class="fe-status-ok">' +
        '<strong>Waiting period complete</strong>' +
        '<p>Your divorce became effective on ' + effStr + '. You may now request your certificate.</p>' +
        '</div>';
    } else {
      var daysLeft = Math.ceil((effectiveDt.getTime() - now.getTime()) / 86400000);
      container.innerHTML =
        '<div class="fe-status-waiting">' +
        '<strong>Waiting period not yet complete</strong>' +
        '<p>Your divorce becomes effective on ' + effStr + ' (' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' remaining). You cannot request your certificate yet.</p>' +
        '</div>';
    }
  }

  /* ─── Part renderer ───────────────────────────────────────── */
  function renderPart(part, caseId, caseData, onUpdate, def) {
    var section = document.createElement('div');
    section.className = 'fe-part';

    var header = document.createElement('div');
    header.className = 'fe-part-header';
    if (part.subtitle) {
      var sub = document.createElement('span');
      sub.className = 'fe-subtitle';
      sub.textContent = part.subtitle;
      header.appendChild(sub);
    }
    var title = document.createElement('h2');
    title.className = 'fe-part-title';
    title.textContent = part.title;
    header.appendChild(title);
    if (part.intro) {
      var intro = document.createElement('p');
      intro.className = 'fe-intro';
      intro.textContent = part.intro;
      header.appendChild(intro);
    }
    section.appendChild(header);

    if (part.groups) {
      part.groups.forEach(function(group) {
        var groupEl = document.createElement('div');
        groupEl.className = 'fe-group';
        var groupTitle = document.createElement('h3');
        groupTitle.className = 'fe-group-title';
        groupTitle.textContent = group.label;
        groupEl.appendChild(groupTitle);
        (group.fields || []).forEach(function(field) {
          field.partId = part.partId;
          var el = renderField(field, caseId, caseData, function() {
            recalculate({ parts: [part] });
            updateCalcDisplays(section, { parts: [part] });
            onUpdate && onUpdate();
          }, def);
          if (el) groupEl.appendChild(el);
        });
        section.appendChild(groupEl);
      });
    } else {
      (part.fields || []).forEach(function(field) {
        field.partId = part.partId;
        var el = renderField(field, caseId, caseData, function() {
          recalculate({ parts: [part] });
          updateCalcDisplays(section, { parts: [part] });
          onUpdate && onUpdate();
        }, def);
        if (el) section.appendChild(el);
      });
    }

    return section;
  }

  function updateCalcDisplays(container, def) {
    // currency_calculated
    var calcEls = container.querySelectorAll('[data-calc-id]');
    calcEls.forEach(function(el) {
      var id = el.dataset.calcId;
      var val = parseFloat(_fieldValues[id]) || 0;
      el.textContent = '$' + val.toFixed(2);
    });
    // computed (non-currency)
    var compEls = container.querySelectorAll('[data-computed-id]');
    compEls.forEach(function(el) {
      var id = el.dataset.computedId;
      // Find field def to re-evaluate
      if (def && def.parts) {
        def.parts.forEach(function(part) {
          var allFields = (part.fields || []).slice();
          (part.groups || []).forEach(function(g) { allFields = allFields.concat(g.fields || []); });
          allFields.forEach(function(field) {
            if (field.fieldId === id && field.type === 'computed') {
              el.textContent = _evalComputedField(field) || '—';
            }
          });
        });
      }
    });
    // waiting period status
    var statusEls = container.querySelectorAll('[data-status-id]');
    statusEls.forEach(function(el) {
      _updateWaitingPeriodStatus(el);
    });
  }

  /* ─── Main render function ────────────────────────────────── */
  function render(formId, caseId, containerId) {
    var container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;

    if (!container) {
      console.error('FormEngine: container not found:', containerId);
      return;
    }

    container.innerHTML = '<div class="fe-loading">Loading form...</div>';

    Promise.all([
      loadFormDef(formId),
      loadProfile(caseId),
      fetch(_RW + '/api/cases/' + caseId + '/form-data', { headers: authHdr() })
        .then(function(r) { return r.json(); })
    ]).then(function(results) {
      var def = results[0];
      var rawData = results[2];

      var caseData = {};
      if (Array.isArray(rawData)) {
        rawData.forEach(function(row) {
          var val = row.fieldValue;
          try { val = JSON.parse(val); } catch(e) {}
          caseData[row.fieldKey] = val;
          _fieldValues[row.fieldKey] = val;
        });
      }

      recalculate(def);

      container.innerHTML = '';
      container.className = 'fe-container';

      // ── safetyFlag: non-dismissible red banner for Forms 25F / 25G ────────
      if (def.safetyFlag && def.safetyFlag.criticalWarning) {
        var sf = def.safetyFlag;
        var banner = document.createElement('div');
        banner.id = 'fe-safety-banner';
        banner.setAttribute('role', 'alert');
        banner.setAttribute('aria-live', 'assertive');
        banner.style.cssText = [
          'background:#450a0a',
          'border-bottom:2px solid #991b1b',
          'color:#fca5a5',
          'padding:14px 20px',
          'font-size:13px',
          'line-height:1.6',
          'display:flex',
          'align-items:flex-start',
          'gap:14px',
          'width:100%',
          'box-sizing:border-box',
          'position:relative',
          'z-index:10'
        ].join(';');
        banner.innerHTML = [
          '<span style="font-size:22px;flex-shrink:0;line-height:1.3;">&#x26A0;&#xFE0F;</span>',
          '<span style="flex:1;">',
          '<strong style="display:block;color:#f87171;font-size:13.5px;margin-bottom:4px;">Safety Notice &mdash; Read Before Continuing</strong>',
          '<span>' + (sf.message || 'If you or your children are in immediate danger, call 911.') + '</span>',
          '<span style="display:block;margin-top:6px;">',
          '<strong>Assaulted Women&rsquo;s Helpline:</strong> ',
          '<a href="tel:18668630511" style="color:#fca5a5;text-decoration:underline;">1-866-863-0511</a>',
          ' (24 hours, free, confidential)',
          '</span>',
          '<span style="display:block;margin-top:4px;">',
          '<strong>Duty Counsel (free legal advice)</strong> is available at every Ontario family courthouse on motion days.',
          '</span>',
          (sf.reviewDateNote ? '<span style="display:block;margin-top:6px;color:#fcd34d;">' + sf.reviewDateNote + '</span>' : ''),
          '</span>'
        ].join('');
        container.appendChild(banner);
        // Override fe-container layout so banner spans full width above wizard
        container.style.cssText = (container.style.cssText || '') + ';display:block;';
      }

      var parts = def.parts || [];
      var currentPart = 0;

      // Sidebar
      var sidebar = document.createElement('div');
      sidebar.className = 'fe-sidebar';
      parts.forEach(function(part, i) {
        var item = document.createElement('div');
        item.className = 'fe-sidebar-item' + (i === 0 ? ' fe-sidebar-active' : '');
        item.textContent = part.title;
        item.addEventListener('click', function() { goTo(i); });
        sidebar.appendChild(item);
      });

      var main = document.createElement('div');
      main.className = 'fe-main';

      var nav = document.createElement('div');
      nav.className = 'fe-nav';
      var backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'fe-btn fe-btn-back';
      backBtn.textContent = '<- Back';
      var nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'fe-btn fe-btn-next';
      nextBtn.textContent = 'Continue ->';

      nav.appendChild(backBtn);
      nav.appendChild(nextBtn);

      container.appendChild(sidebar);
      container.appendChild(main);
      container.appendChild(nav);

      function goTo(idx) {
        currentPart = Math.max(0, Math.min(idx, parts.length - 1));
        sidebar.querySelectorAll('.fe-sidebar-item').forEach(function(el, i) {
          el.classList.toggle('fe-sidebar-active', i === currentPart);
        });
        main.innerHTML = '';
        var partEl = renderPart(parts[currentPart], caseId, caseData, function() {
          updateCalcDisplays(partEl, def);
        }, def);
        main.appendChild(partEl);
        recalculate(def);
        updateCalcDisplays(partEl, def);
        updateConditionals(partEl, parts[currentPart]);
        backBtn.style.display = currentPart === 0 ? 'none' : '';
        nextBtn.textContent = currentPart === parts.length - 1 ? 'Review & Export' : 'Continue ->';
        window.scrollTo(0, 0);
      }

      function updateConditionals(partEl, part) {
        var allFields = (part.fields || []).slice();
        if (part.groups) {
          part.groups.forEach(function(g) { allFields = allFields.concat(g.fields || []); });
        }
        allFields.forEach(function(field) {
          if (!field.conditional) return;
          var el = partEl.querySelector('[data-field-id="' + field.fieldId + '"]');
          if (el) el.style.display = shouldShowField(field) ? '' : 'none';
        });
      }

      backBtn.addEventListener('click', function() { goTo(currentPart - 1); });
      nextBtn.addEventListener('click', function() {
        if (currentPart < parts.length - 1) {
          goTo(currentPart + 1);
        } else {
          if (window.__openExportPanel) window.__openExportPanel(caseId, formId);
        }
      });

      goTo(0);

    }).catch(function(err) {
      container.innerHTML = '<div class="fe-error">Failed to load form: ' + err.message + '</div>';
      console.error('FormEngine error:', err);
    });
  }

  /* ─── CSS injection ───────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('fe-styles')) return;
    var style = document.createElement('style');
    style.id = 'fe-styles';
    style.textContent = [
      '.fe-container{display:flex;flex-wrap:wrap;gap:0;min-height:60vh;font-family:DM Sans,system-ui,sans-serif}',
      '.fe-sidebar{width:220px;background:#1a1a2e;padding:24px 0;flex-shrink:0}',
      '.fe-sidebar-item{padding:12px 20px;color:#9ca3af;font-size:13px;cursor:pointer;border-left:3px solid transparent;transition:all 0.15s}',
      '.fe-sidebar-item:hover{color:#fff;background:rgba(255,255,255,0.05)}',
      '.fe-sidebar-active{color:#5eead4;border-left-color:#5eead4;background:rgba(94,234,212,0.08);font-weight:600}',
      '.fe-main{flex:1;padding:32px;min-width:0}',
      '.fe-part-header{margin-bottom:28px}',
      '.fe-subtitle{font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em}',
      '.fe-part-title{font-size:22px;font-weight:700;color:#f9fafb;margin:6px 0 12px}',
      '.fe-intro{font-size:14px;color:#9ca3af;line-height:1.6}',
      '.fe-field{margin-bottom:20px}',
      '.fe-label{display:block;font-size:14px;font-weight:500;color:#e5e7eb;margin-bottom:6px}',
      '.fe-required::after{content:" *";color:#f87171}',
      '.fe-help{font-size:12px;color:#6b7280;margin:4px 0 8px;line-height:1.5}',
      '.fe-unit{font-weight:400;color:#6b7280}',
      '.fe-input,.fe-select,.fe-textarea{width:100%;padding:10px 14px;background:#0f172a;border:1px solid #374151;border-radius:8px;color:#f9fafb;font-size:14px;font-family:inherit;box-sizing:border-box;transition:border-color 0.15s}',
      '.fe-input:focus,.fe-select:focus,.fe-textarea:focus{outline:none;border-color:#5eead4}',
      '.fe-currency{font-family:monospace}',
      '.fe-textarea{resize:vertical;min-height:96px}',
      '.fe-yesno{display:flex;gap:10px}',
      '.fe-yesno-btn{padding:9px 24px;border-radius:8px;border:1px solid #374151;background:#1f2937;color:#9ca3af;cursor:pointer;font-size:14px;transition:all 0.15s}',
      '.fe-yesno-active{background:#0d9488;border-color:#0d9488;color:#fff;font-weight:600}',
      '.fe-checkbox-label{display:flex;align-items:center;gap:8px;font-size:14px;color:#e5e7eb;cursor:pointer}',
      '.fe-checkbox{width:18px;height:18px;accent-color:#5eead4}',
      '.fe-group{margin-bottom:28px}',
      '.fe-group-title{font-size:15px;font-weight:600;color:#5eead4;border-bottom:1px solid #1f2937;padding-bottom:8px;margin-bottom:16px}',
      '.fe-calc-label{display:block;font-size:14px;font-weight:600;color:#e5e7eb;margin-bottom:4px}',
      '.fe-calc-value{font-size:22px;font-weight:700;color:#5eead4;font-family:monospace;padding:10px 0}',
      '.fe-computed-value{font-size:18px;font-weight:600;color:#5eead4;padding:8px 0}',
      '.fe-nav{display:flex;justify-content:space-between;padding:20px 32px;border-top:1px solid #1f2937;background:#0f172a;position:sticky;bottom:0;width:100%;box-sizing:border-box}',
      '.fe-btn{padding:12px 28px;border-radius:10px;border:none;font-size:15px;font-weight:600;cursor:pointer;transition:all 0.15s}',
      '.fe-btn-back{background:#1f2937;color:#9ca3af}',
      '.fe-btn-next{background:#0d9488;color:#fff}',
      '.fe-btn-next:hover{background:#0f766e}',
      '.fe-loading,.fe-error{padding:40px;text-align:center;color:#9ca3af}',
      '.fe-unsupported{color:#f87171;font-size:12px}',
      /* info box */
      '.fe-info-box{background:#1e293b;border-left:4px solid #5eead4;border-radius:6px;padding:14px 16px;margin-bottom:4px}',
      '.fe-info-title{display:block;font-size:14px;font-weight:600;color:#5eead4;margin-bottom:6px}',
      '.fe-info-text{font-size:13px;color:#9ca3af;line-height:1.6;margin:0}',
      /* radio */
      '.fe-radio-group{display:flex;flex-direction:column;gap:10px}',
      '.fe-radio-label{display:flex;align-items:center;gap:10px;font-size:14px;color:#e5e7eb;cursor:pointer;padding:10px 14px;border:1px solid #374151;border-radius:8px;transition:all 0.15s}',
      '.fe-radio-label:hover{border-color:#5eead4;background:rgba(94,234,212,0.05)}',
      '.fe-radio-selected{border-color:#0d9488;background:rgba(13,148,136,0.12);font-weight:500}',
      '.fe-radio-label input[type=radio]{accent-color:#5eead4;width:16px;height:16px}',
      /* urgency banner */
      '.fe-urgency-banner{display:flex;align-items:flex-start;gap:14px;border-radius:10px;padding:16px 18px;margin:8px 0 16px;font-size:14px;line-height:1.5}',
      '.fe-urgency-icon{font-weight:700;font-size:18px;flex-shrink:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%}',
      '.fe-urgency-banner strong{display:block;margin-bottom:4px}',
      '.fe-urgency-banner p{margin:0;font-size:13px;opacity:0.85}',
      '.fe-urgency-past{background:rgba(127,29,29,0.35);border:1px solid #991b1b;color:#fca5a5}',
      '.fe-urgency-past .fe-urgency-icon{background:#991b1b;color:#fff}',
      '.fe-urgency-critical{background:rgba(127,29,29,0.25);border:1px solid #b91c1c;color:#fca5a5}',
      '.fe-urgency-critical .fe-urgency-icon{background:#b91c1c;color:#fff}',
      '.fe-urgency-warning{background:rgba(120,53,15,0.25);border:1px solid #b45309;color:#fcd34d}',
      '.fe-urgency-warning .fe-urgency-icon{background:#b45309;color:#fff}',
      '.fe-urgency-info{background:rgba(30,58,138,0.25);border:1px solid #1d4ed8;color:#93c5fd}',
      '.fe-urgency-info .fe-urgency-icon{background:#1d4ed8;color:#fff}',
      '.fe-urgency-ok{background:rgba(6,78,59,0.25);border:1px solid #065f46;color:#6ee7b7}',
      '.fe-urgency-ok .fe-urgency-icon{background:#065f46;color:#fff}',
      '.fe-urgency-none{background:#1e293b;border:1px solid #374151;color:#9ca3af;font-size:13px;padding:12px 16px;border-radius:8px}',
      /* computed status (Form 36B) */
      '.fe-status-display{padding:4px 0}',
      '.fe-status-ok{background:rgba(6,78,59,0.2);border:1px solid #065f46;border-radius:8px;padding:14px 16px;color:#6ee7b7}',
      '.fe-status-ok strong{display:block;margin-bottom:4px}',
      '.fe-status-ok p{margin:0;font-size:13px;opacity:0.85}',
      '.fe-status-waiting{background:rgba(120,53,15,0.2);border:1px solid #b45309;border-radius:8px;padding:14px 16px;color:#fcd34d}',
      '.fe-status-waiting strong{display:block;margin-bottom:4px}',
      '.fe-status-waiting p{margin:0;font-size:13px;opacity:0.85}',
      '.fe-status-pending{font-size:13px;color:#6b7280;font-style:italic}',
      '@media(max-width:640px){.fe-sidebar{width:100%}.fe-main{padding:20px 16px}.fe-nav{padding:16px}}'
    ].join('');
    document.head.appendChild(style);
  }

  /* ─── Public API ──────────────────────────────────────────── */
  window.__hp_FormEngine = {
    render: render,
    registerFormDef: registerFormDef,
    calcDeadline: calcDeadline,
    renderUrgencyBanner: renderUrgencyBanner,
    getProfile: function() { return _profile; },
    getFieldValues: function() { return _fieldValues; },
    // Exposed for unit testing
    _isBusinessDay: _isBusinessDay,
    _onHolidays: _onHolidays
  };

  injectStyles();
  console.log('[Hearth & Page] FormEngine v1.1 ready');

})();
