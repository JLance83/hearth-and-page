import re

# ============================================================
# BACKEND — index.cjs
# ============================================================
with open('dist/index.cjs', 'r', encoding='utf-8') as f:
    be = f.read()

# 1. Add Twilio helper after the Resend sendViaResend function
TWILIO_HELPER = r"""
// ─── Twilio SMS helper ───────────────────────────────────────────────────────
async function sendViaTwilio(to, body) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) {
    console.warn('[Twilio] Credentials not configured — skipping SMS to', to);
    return { ok: false, reason: 'not_configured' };
  }
  // Normalize phone: ensure E.164 format
  let phone = to.replace(/\s+/g, '').replace(/[.\-()]/g, '');
  if (phone.startsWith('1') && phone.length === 11) phone = '+' + phone;
  else if (!phone.startsWith('+')) phone = '+1' + phone;

  const params = new URLSearchParams({ To: phone, From: from, Body: body });
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  return new Promise((resolve, reject) => {
    const https = require('https');
    const auth  = Buffer.from(`${sid}:${token}`).toString('base64');
    const req   = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params.toString()),
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.sid) resolve({ ok: true, sid: json.sid });
          else resolve({ ok: false, error: json.message || data });
        } catch(e) { resolve({ ok: false, error: data }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.write(params.toString());
    req.end();
  });
}
"""

# Find insertion point — after sendViaResend function
marker_be = "// ─── Routes ─"
if 'sendViaTwilio' not in be and marker_be in be:
    be = be.replace(marker_be, TWILIO_HELPER + '\n' + marker_be, 1)
    print("Backend: Twilio helper added ✓")
elif 'sendViaTwilio' in be:
    print("Backend: Twilio helper already present, skipping")
else:
    # Try alternate
    marker_be2 = "app.get('/api/auth"
    be = be.replace(marker_be2, TWILIO_HELPER + '\n' + marker_be2, 1)
    print("Backend: Twilio helper added (alt marker) ✓")

# 2. Replace the trigger route's email-only dispatch with email+SMS dispatch
OLD_DISPATCH = """    const emailContacts = contacts.filter(c => c.contactType === 'email' || (!c.contactType && c.email));
    const sendPromises = emailContacts.map(c => {
      const toEmail = c.contactValue || c.email;
      return sendViaResend({ from: 'Hearth & Page Safety <safety@hearthandpage.ca>', to: [toEmail], subject: emailSubject, html: emailBody })
        .catch(err => console.error('[Safety] Email failed to', toEmail, err.message));
    });
    await Promise.all(sendPromises);
    await dbInsert('alert_log', { userId: req.user.id, method: method || 'button', triggeredAt: Date.now() });
    res.json({ ok: true, sent: emailContacts.length });"""

NEW_DISPATCH = """    const emailContacts = contacts.filter(c => c.contactType === 'email' || (!c.contactType && c.email));
    const smsContacts   = contacts.filter(c => c.contactType === 'sms' || c.contactType === 'phone');

    // Build SMS body (concise — must fit 160 chars ideally)
    const isSafeWordSms = method === 'codeword';
    const smsAlert = isSafeWordSms
      ? `⚠️ SAFE WORD ALERT: ${userName} may need help — their secret safe word was triggered on Hearth & Page at ${triggeredAt} ET. Please check on them immediately.`
      : `⚠️ SAFETY ALERT: ${userName} activated their safety alert on Hearth & Page at ${triggeredAt} ET. They may be in danger — please check on them NOW.`;

    // Get user's courthouse for follow-up SMS location
    let courthouseLocation = null;
    try {
      const caseRows = await dbAll('cases', { user_id: `eq.${req.user.id}` });
      if (caseRows && caseRows.length > 0) {
        const lastCase = caseRows[caseRows.length - 1];
        const ch = lastCase.courthouse || lastCase.data?.courthouse || null;
        if (ch) courthouseLocation = ch;
      }
    } catch(e) { /* non-critical */ }

    const smsFollowUp = courthouseLocation
      ? `📍 Follow-up: ${userName} was last working on a case in ${courthouseLocation}. If they were at or near that courthouse, search that area. Call 911 if you cannot reach them.`
      : `📍 Follow-up: If you cannot reach ${userName}, call 911. They may be at or near a courthouse or legal services office. This automated alert was sent by Hearth & Page.`;

    const sendPromises = [
      // Email alerts
      ...emailContacts.map(c => {
        const toEmail = c.contactValue || c.email;
        return sendViaResend({ from: 'Hearth & Page Safety <safety@hearthandpage.ca>', to: [toEmail], subject: emailSubject, html: emailBody })
          .catch(err => console.error('[Safety] Email failed to', toEmail, err.message));
      }),
      // SMS alerts — first message, then follow-up with location
      ...smsContacts.map(async c => {
        const phone = c.contactValue || c.phone;
        try {
          await sendViaTwilio(phone, smsAlert);
          // Follow-up after 15 seconds
          setTimeout(async () => {
            try { await sendViaTwilio(phone, smsFollowUp); }
            catch(e) { console.error('[Safety] SMS follow-up failed:', e.message); }
          }, 15000);
        } catch(err) {
          console.error('[Safety] SMS failed to', phone, err.message);
        }
      }),
    ];
    await Promise.all(sendPromises);
    const totalSent = emailContacts.length + smsContacts.length;
    await dbInsert('alert_log', { userId: req.user.id, method: method || 'button', triggeredAt: Date.now() });
    res.json({ ok: true, sent: totalSent, emailSent: emailContacts.length, smsSent: smsContacts.length });"""

if OLD_DISPATCH in be:
    be = be.replace(OLD_DISPATCH, NEW_DISPATCH, 1)
    print("Backend: SMS dispatch injected ✓")
else:
    print("Backend: dispatch marker not found — checking for slight variation...")
    # Check partial
    if 'emailContacts.length' in be and 'smsContacts' not in be:
        print("  Variation present — manual fix needed")
    else:
        print("  SMS dispatch may already be applied")

with open('dist/index.cjs', 'w', encoding='utf-8') as f:
    f.write(be)
print("dist/index.cjs saved ✓")
