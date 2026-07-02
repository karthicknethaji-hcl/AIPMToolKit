// ── env.js — Environment configuration ──────────────────────────────────────
// Auto-detects dev vs prod based on hostname.
// Drop this file into scripts/ before every Netlify deploy.
// Never include in the zip — keep locally only.
// Never commit to GitHub.

(function() {
  const _isDev =
    window.location.hostname === 'devproductdiagnostics.netlify.app' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  // ── Supabase ───────────────────────────────────────────────────────────────
  window.SUPABASE_URL = _isDev
    ? 'https://enozfttaoxhomesdonrc.supabase.co'         // dev
    : 'https://azqttvcnsbxviadnyaha.supabase.co';         // prod

  window.SUPABASE_ANON_KEY = _isDev
    ?'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVub3pmdHRhb3hob21lc2RvbnJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTUwNDcsImV4cCI6MjA5NzI3MTA0N30.WY8yYj_z3ex5I9gF_0SAaDZzzqVw0FjhPlbWCIc-Fxs'           // dev — Supabase → pgt-dev → Settings → API
    :'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6cXR0dmNuc2J4dmlhZG55YWhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTYwNDUsImV4cCI6MjA5NzI3MjA0NX0.-pyLSMB5eSX6LrNYKFnHH_LswTsN98Y2X5q4N3woVr0';         // prod — Supabase → pgt-prod → Settings → API

  // ── Proxy ──────────────────────────────────────────────────────────────────
  window.PROXY_URL = _isDev
    ? 'https://pgt-proxy-dev.onrender.com/api/anthropic'  // dev
    : 'https://product-diagnostics-proxy.onrender.com/api/anthropic'; // prod

})();