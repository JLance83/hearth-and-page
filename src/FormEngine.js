/**
 * Hearth & Page — FormEngine v1.0
 * Option A: runs ALONGSIDE existing hardcoded wizards.
 * 
 * Usage:
 *   window.__hp_FormEngine.render('ON-F8', caseId, containerId)
 *   window.__hp_FormEngine.render('ON-F14', caseId, containerId)
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
  // Canonical field paths shared across all forms.
  // When a form field has source:"profile.applicant.firstName",
  // FormEngine pre-fills it from the profile and writes back on save.
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
    children: [], // array of { name, dob, currentResidence, primaryCaregiver }
    income: {
      employmentType: '', annualGrossIncome: '', monthlyNetIncome: '',
      employer: '', selfEmployed: false, incomeYear: new Date().getFullYear() - 1
    }
  };

  /* ─── Profile store ───────────────────────────────────────── */
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
    // path = "applicant.firstName"
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

  /* ─── Form definition loader ──────────────────────────────── */
  var _formCache = {};

  function loadFormDef(formId) {
    if (_formCache[formId]) return Promise.resolve(_formCache[formId]);
    // In production, fetch from /form-engine/ON/form8-schema.json etc.
    // For now, load from window.__hp_formDefs (injected at build time)
    var def = (window.__hp_formDefs || {})[formId];
    if (!def) return Promise.reject(new Error('FormEngine: no definition for ' + formId));
    _formCache[formId] = def;
    return Promise.resolve(def);
  }

  function registerFormDef(formId, def) {
    _formCache[formId] = def;
    window.__hp_formDefs = window.__hp_formDefs || {};
    window.__hp_formDefs[formId] = def;
  }

  /* ─── Field value store for current session ──────────────── */
  var _fieldValues = {}; // { fieldId: value }
  var _saveTimers  = {}; // debounce per fieldId

  function getFieldValue(fieldId, field, caseData) {
    // Priority: 1) in-session edits, 2) saved case data, 3) profile source, 4) default
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
    // Write back to profile source if field has one
    if (field && field.source && field.source.startsWith('profile.')) {
      var path = field.source.replace('profile.', '');
      saveProfileField(caseId, path, value);
    }
    // Debounced save to form-data
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
  function shouldShowField(field) {
    if (!field.conditional) return true;
    var c = field.conditional;
    var depVal = _fieldValues[c.dependsOn];
    if (depVal === undefined) depVal = '';
    if (Array.isArray(c.showWhen)) return c.showWhen.includes(depVal);
    return String(depVal).toLowerCase() === String(c.showWhen).toLowerCase();
  }

  /* ─── Auto-calculate currency fields ─────────────────────── */
  function recalculate(def) {
    if (!def || !def.parts) return;
    def.parts.forEach(function(part) {
      var fields = part.fields || [];
      // Also flatten group fields
      if (part.groups) {
        part.groups.forEach(function(g) { fields = fields.concat(g.fields || []); });
      }
      fields.forEach(function(field) {
        if (field.type !== 'currency_calculated' || !field.formula) return;
        // sum([fieldA, fieldB, ...])
        var sumMatch = field.formula.match(/^sum\(\[([^\]]+)\]\)$/);
        if (sumMatch) {
          var ids = sumMatch[1].split(',').map(function(s) { return s.trim(); });
          var total = ids.reduce(function(acc, id) {
            return acc + (parseFloat(_fieldValues[id]) || 0);
          }, 0);
          _fieldValues[field.fieldId] = total.toFixed(2);
        }
        // subtraction: fieldA - fieldB
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
  function renderField(field, caseId, caseData, onUpdate) {
    if (!shouldShowField(field)) return null;

    var val = getFieldValue(field.fieldId, field, caseData);
    var wrapper = document.createElement('div');
    wrapper.className = 'fe-field';
    wrapper.dataset.fieldId = field.fieldId;

    // Label
    if (field.label && field.type !== 'currency_calculated') {
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

      default:
        wrapper.innerHTML += '<p class="fe-unsupported">Field type "' + field.type + '" — coming soon</p>';
    }

    return wrapper;
  }

  function renderPart(part, caseId, caseData, onUpdate) {
    var section = document.createElement('div');
    section.className = 'fe-part';

    // Part header
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

    // Render fields (flat or grouped)
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
          });
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
        });
        if (el) section.appendChild(el);
      });
    }

    return section;
  }

  function updateCalcDisplays(container, def) {
    var calcEls = container.querySelectorAll('[data-calc-id]');
    calcEls.forEach(function(el) {
      var id = el.dataset.calcId;
      var val = parseFloat(_fieldValues[id]) || 0;
      el.textContent = '$' + val.toFixed(2);
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

      // Build caseData map: fieldKey → fieldValue
      var caseData = {};
      if (Array.isArray(rawData)) {
        rawData.forEach(function(row) {
          var val = row.fieldValue;
          try { val = JSON.parse(val); } catch(e) {}
          caseData[row.fieldKey] = val;
          _fieldValues[row.fieldKey] = val;
        });
      }

      // Run initial calc pass
      recalculate(def);

      // Build wizard UI
      container.innerHTML = '';
      container.className = 'fe-container';

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

      // Main content area
      var main = document.createElement('div');
      main.className = 'fe-main';

      // Nav buttons
      var nav = document.createElement('div');
      nav.className = 'fe-nav';
      var backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'fe-btn fe-btn-back';
      backBtn.textContent = '← Back';
      var nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'fe-btn fe-btn-next';
      nextBtn.textContent = 'Continue →';
      nav.appendChild(backBtn);
      nav.appendChild(nextBtn);

      container.appendChild(sidebar);
      container.appendChild(main);
      container.appendChild(nav);

      function goTo(idx) {
        currentPart = Math.max(0, Math.min(idx, parts.length - 1));
        // Update sidebar
        sidebar.querySelectorAll('.fe-sidebar-item').forEach(function(el, i) {
          el.classList.toggle('fe-sidebar-active', i === currentPart);
        });
        // Render part
        main.innerHTML = '';
        var partEl = renderPart(parts[currentPart], caseId, caseData, function() {
          updateCalcDisplays(partEl, def);
        });
        main.appendChild(partEl);
        // Re-run calcs after render
        recalculate(def);
        updateCalcDisplays(partEl, def);
        // Update conditional fields
        updateConditionals(partEl, parts[currentPart]);
        // Nav state
        backBtn.style.display = currentPart === 0 ? 'none' : '';
        nextBtn.textContent = currentPart === parts.length - 1 ? 'Review & Export' : 'Continue →';
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
          // Last step — trigger export
          if (window.__openExportPanel) window.__openExportPanel(caseId, formId);
        }
      });

      // Initial render
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
    style.textContent = `
      .fe-container { display:flex; flex-wrap:wrap; gap:0; min-height:60vh; font-family:DM Sans,system-ui,sans-serif; }
      .fe-sidebar { width:220px; background:#1a1a2e; padding:24px 0; flex-shrink:0; }
      .fe-sidebar-item { padding:12px 20px; color:#9ca3af; font-size:13px; cursor:pointer; border-left:3px solid transparent; transition:all 0.15s; }
      .fe-sidebar-item:hover { color:#fff; background:rgba(255,255,255,0.05); }
      .fe-sidebar-active { color:#5eead4; border-left-color:#5eead4; background:rgba(94,234,212,0.08); font-weight:600; }
      .fe-main { flex:1; padding:32px; min-width:0; }
      .fe-part-header { margin-bottom:28px; }
      .fe-subtitle { font-size:12px; color:#9ca3af; text-transform:uppercase; letter-spacing:0.08em; }
      .fe-part-title { font-size:22px; font-weight:700; color:#f9fafb; margin:6px 0 12px; }
      .fe-intro { font-size:14px; color:#9ca3af; line-height:1.6; }
      .fe-field { margin-bottom:20px; }
      .fe-label { display:block; font-size:14px; font-weight:500; color:#e5e7eb; margin-bottom:6px; }
      .fe-required::after { content:" *"; color:#f87171; }
      .fe-help { font-size:12px; color:#6b7280; margin:4px 0 8px; line-height:1.5; }
      .fe-unit { font-weight:400; color:#6b7280; }
      .fe-input, .fe-select, .fe-textarea { width:100%; padding:10px 14px; background:#0f172a; border:1px solid #374151; border-radius:8px; color:#f9fafb; font-size:14px; font-family:inherit; box-sizing:border-box; transition:border-color 0.15s; }
      .fe-input:focus, .fe-select:focus, .fe-textarea:focus { outline:none; border-color:#5eead4; }
      .fe-currency { font-family:monospace; }
      .fe-textarea { resize:vertical; min-height:96px; }
      .fe-yesno { display:flex; gap:10px; }
      .fe-yesno-btn { padding:9px 24px; border-radius:8px; border:1px solid #374151; background:#1f2937; color:#9ca3af; cursor:pointer; font-size:14px; transition:all 0.15s; }
      .fe-yesno-active { background:#0d9488; border-color:#0d9488; color:#fff; font-weight:600; }
      .fe-checkbox-label { display:flex; align-items:center; gap:8px; font-size:14px; color:#e5e7eb; cursor:pointer; }
      .fe-checkbox { width:18px; height:18px; accent-color:#5eead4; }
      .fe-group { margin-bottom:28px; }
      .fe-group-title { font-size:15px; font-weight:600; color:#5eead4; border-bottom:1px solid #1f2937; padding-bottom:8px; margin-bottom:16px; }
      .fe-calc-label { display:block; font-size:14px; font-weight:600; color:#e5e7eb; margin-bottom:4px; }
      .fe-calc-value { font-size:22px; font-weight:700; color:#5eead4; font-family:monospace; padding:10px 0; }
      .fe-nav { display:flex; justify-content:space-between; padding:20px 32px; border-top:1px solid #1f2937; background:#0f172a; position:sticky; bottom:0; width:100%; box-sizing:border-box; }
      .fe-btn { padding:12px 28px; border-radius:10px; border:none; font-size:15px; font-weight:600; cursor:pointer; transition:all 0.15s; }
      .fe-btn-back { background:#1f2937; color:#9ca3af; }
      .fe-btn-next { background:#0d9488; color:#fff; }
      .fe-btn-next:hover { background:#0f766e; }
      .fe-loading, .fe-error { padding:40px; text-align:center; color:#9ca3af; }
      .fe-unsupported { color:#f87171; font-size:12px; }
      @media(max-width:640px) {
        .fe-sidebar { width:100%; }
        .fe-main { padding:20px 16px; }
        .fe-nav { padding:16px; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ─── Public API ──────────────────────────────────────────── */
  window.__hp_FormEngine = {
    render: render,
    registerFormDef: registerFormDef,
    getProfile: function() { return _profile; },
    getFieldValues: function() { return _fieldValues; }
  };

  injectStyles();
  console.log('[Hearth & Page] FormEngine v1.0 ready');

})();
