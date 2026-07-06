// patch-server.cjs — injects /api/send-email route into compiled server
// Runs after npm run build, appends a self-contained email proxy module
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'dist', 'index.cjs');

if (!fs.existsSync(serverPath)) {
  console.log('[patch-server] dist/index.cjs not found — skipping');
  process.exit(0);
}

const content = fs.readFileSync(serverPath, 'utf8');

if (content.includes('__HP_EMAIL_ROUTE__')) {
  console.log('[patch-server] Email route already patched');
  process.exit(0);
}

// Find the last app.use() or app.get() call before the server listen
// We'll append an email route module that self-registers
const emailRouteCode = `

// __HP_EMAIL_ROUTE__ — injected by patch-server.cjs
(function() {
  try {
    var https = require('https');
    var RESEND_KEY = process.env.RESEND_API_KEY || 're_7xmsQDqc_DfXJZqjovXzezt7wsS5gr8Dc';
    var FROM = 'Hearth & Page <support@hearthandpage.ca>';

    // Find the Express app instance — it's exported or used in the server
    // We hook into the module by finding the http server and patching its listeners
    var origCreateServer = require('http').createServer;
    require('http').createServer = function(app) {
      var server = origCreateServer(app);

      // If app is an Express-like function with 'use', add our route
      if (app && typeof app.post === 'function') {
        app.post('/api/send-email', function(req, res) {
          // CORS headers for cross-origin requests from iframe
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

          var body = req.body;
          if (!body || !body.to || !body.subject) {
            return res.status(400).json({ error: 'Missing fields' });
          }

          var payload = JSON.stringify({
            from: FROM,
            to: Array.isArray(body.to) ? body.to : [body.to],
            subject: body.subject,
            text: body.text || '',
            attachments: body.attachments || []
          });

          var options = {
            hostname: 'api.resend.com',
            path: '/emails',
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + RESEND_KEY,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          };

          var reqOut = https.request(options, function(resOut) {
            var data = '';
            resOut.on('data', function(chunk) { data += chunk; });
            resOut.on('end', function() {
              try {
                var parsed = JSON.parse(data);
                if (resOut.statusCode >= 200 && resOut.statusCode < 300) {
                  res.json({ ok: true, id: parsed.id });
                } else {
                  res.status(resOut.statusCode).json({ error: parsed });
                }
              } catch(e) {
                res.status(500).json({ error: 'Parse error' });
              }
            });
          });

          reqOut.on('error', function(e) {
            res.status(500).json({ error: e.message });
          });

          reqOut.write(payload);
          reqOut.end();
        });

        // Handle CORS preflight
        app.options('/api/send-email', function(req, res) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          res.sendStatus(204);
        });

        console.log('[HP] /api/send-email route registered');
      }

      return server;
    };
  } catch(e) {
    console.warn('[HP] Email route patch failed:', e.message);
  }
})();
`;

// Prepend the route code (before the server starts, so http.createServer gets patched)
fs.writeFileSync(serverPath, emailRouteCode + content);
console.log('[patch-server] Injected /api/send-email route into dist/index.cjs');
