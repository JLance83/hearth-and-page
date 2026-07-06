// patch-frontend.cjs — runs after Vite build to inject hp-patches lazy loader
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist', 'public', 'assets');
const files = fs.readdirSync(distDir).filter(f => f.startsWith('index-') && f.endsWith('.js') && !f.includes('patch'));

if (files.length === 0) {
  console.log('[patch] No bundle found to patch');
  process.exit(0);
}

const bundlePath = path.join(distDir, files[0]);
const content = fs.readFileSync(bundlePath, 'utf8');

if (content.includes('__HP_LAZY__ v5')) {
  console.log('[patch] Already patched (v5):', files[0]);
} else {
  const bootstrap = `// __HP_LAZY__ v5 — Hearth & Page patch loader
// hp-patches.js is loaded via <script defer> in index.html — no double load here
// This bootstrap provides: stub functions, tap-queuing, and pdf-lib lazy load
(function(){
  var _queue=[];
  function whenReady(cb){
    if(window.__hp_patches_ready){cb();return;}
    if(!window.__hp_patches_queue)window.__hp_patches_queue=[];
    window.__hp_patches_queue.push(cb);
  }
  function loadScript(src,cb){
    if(window.PDFLib){cb();return;}
    var s=document.createElement('script');
    s.src=src;s.onload=cb;
    s.onerror=function(){console.warn('[HP] Failed:',src);cb();};
    document.head.appendChild(s);
  }
  function loadPdfThen(cb){
    whenReady(function(){
      loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',cb);
    });
  }
  window.__patchForm35PDF=function(b,c){return new Promise(function(res){
    loadPdfThen(function(){if(window.__patchForm35PDF_real)window.__patchForm35PDF_real(b,c).then(res).catch(function(){res(null);});else res(null);});
  });};
  window.__patchForm13PDF=function(b,c){return new Promise(function(res){
    loadPdfThen(function(){if(window.__patchForm13PDF_real)window.__patchForm13PDF_real(b,c).then(res).catch(function(){res(null);});else res(null);});
  });};
  window.__emailPDF=function(b,f,e,l){return new Promise(function(res){
    whenReady(function(){if(window.__emailPDF_real)window.__emailPDF_real(b,f,e,l).then(res).catch(function(){res(false);});else res(false);});
  });};
  window.__getFlap35Token=function(){
    try{if(typeof window.__hp_getToken==='function'){var tk=window.__hp_getToken();if(tk)return tk;}}catch(e){}
    try{var p=(window.name||'').split('|');for(var i=0;i<p.length;i++){if(p[i].indexOf('flap:')===0)return p[i].slice(5);}}catch(e){}
    try{var m=document.cookie.match(/(?:^|;\\\\s*)flap_token=([^;]+)/);if(m)return decodeURIComponent(m[1]);}catch(e){}
    return null;
  };
  window.__hp_setCurrentForm=function(k,l){window.__hp_currentFormKey=k;window.__hp_currentFormLabel=l;};
  window.__openSafetyOverlay=function(){
    whenReady(function(){if(typeof window.__openSafetyOverlay_real==='function')window.__openSafetyOverlay_real();});
  };
  window.__openAccountSettings=function(){
    whenReady(function(){if(typeof window.__openAccountSettings_real==='function')window.__openAccountSettings_real();});
  };
})();
`;

  // Also inject window.__hp_user exposure into the bundle
  let patched = content;

  // Expose I0() as __hp_getToken (reads cookie + window.name + Rs)
  patched = patched.replace(
    'return null}function Zx(t)',
    'return null}window.__hp_getToken=I0;function Zx(t)'
  );

  // Expose user + token from auth provider
  patched = patched.replace(
    'if(!g)if(C.ok){const _=await C.json();u(v),r(_.user)}',
    'if(!g)if(C.ok){const _=await C.json();u(v),r(_.user);window.__hp_user=_.user;window.__hp_token=v;}'
  );

  // Fix inline email handler: read window.__hp_user.email directly
  patched = patched.replace(
    'const _me=await fetch("/api/auth/me",{headers:_authHdr}).then(res=>res.json()).catch(()=>null);const _email=(_me?.user?.email)||(_me?.email);',
    'const _email=(window.__hp_user&&window.__hp_user.email)||(await fetch("/api/auth/me",{headers:_authHdr}).then(res=>res.json()).catch(()=>null).then(m=>(m?.user?.email)||(m?.email)||null));'
  );

  // Fix inline email handler: use __hp_token if available
  patched = patched.replace(
    'const _authHdr=(()=>{const _t=typeof __getFlap35Token==="function"&&__getFlap35Token();return _t?{Authorization:"Bearer "+_t}:{}})();',
    'const _authHdr=(()=>{const _t=(typeof window.__hp_token!=="undefined"&&window.__hp_token)||(typeof __getFlap35Token==="function"&&__getFlap35Token());return _t?{Authorization:"Bearer "+_t}:{}})();'
  );

  // Change email send to go through our backend proxy instead of direct Resend
  patched = patched.replace(
    "window.__emailPDF&&!h",
    "window.__emailPDF&&!h"
  );

  // Inject shield/safety button before the logout button in the navbar
  const SHIELD_BUTTON = `s.jsx("button",{type:"button",onClick:()=>{if(typeof window.__openSafetyOverlay==="function")window.__openSafetyOverlay();},style:{display:"inline-flex",alignItems:"center",justifyContent:"center",height:"2.25rem",width:"2.25rem",minWidth:"44px",minHeight:"44px",borderRadius:"0.375rem",background:"transparent",border:"none",cursor:"pointer",color:"rgba(237,232,223,0.6)",flexShrink:0},"data-testid":"button-safety","aria-label":"Safety & emergency",title:"Safety & emergency resources",children:s.jsx("svg",{width:16,height:16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round",children:s.jsx("path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"})})}),`;
  const LOGOUT_TARGET = `s.jsx(rt,{variant:"ghost",size:"sm",onClick:()=>n(),className:"h-9 w-9 p-0","data-testid":"button-logout"`;
  if (!patched.includes('button-safety')) {
    if (patched.includes(LOGOUT_TARGET)) {
      patched = patched.replace(LOGOUT_TARGET, SHIELD_BUTTON + LOGOUT_TARGET);
      console.log('[patch] Shield button injected into navbar');
    } else {
      console.warn('[patch] WARNING: logout button anchor not found — shield not injected');
    }
  } else {
    console.log('[patch] Shield button already present in bundle');
  }

  fs.writeFileSync(bundlePath, bootstrap + patched);
  console.log('[patch] Patched bundle with HP_LAZY v3:', files[0]);
}

// Copy hp-patches.js into dist/public/assets/
const patchesSrc = path.join(__dirname, 'hp-patches.js');
const patchesDst = path.join(distDir, 'hp-patches.js');
if (fs.existsSync(patchesSrc)) {
  fs.copyFileSync(patchesSrc, patchesDst);
  console.log('[patch] Copied hp-patches.js to dist/assets/');
}

console.log('[patch] Done.');
