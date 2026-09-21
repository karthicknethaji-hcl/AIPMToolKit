// Agent Test Execution Framework — reads scripts/env.js for non-secret,
// already-known-locally config (SUPABASE_URL, PROXY_URL) so the harness
// doesn't make you re-paste a value that's already sitting in the repo.
//
// scripts/env.js is a browser IIFE (window.SUPABASE_URL = ...), gitignored,
// dropped in locally before every Netlify deploy — never committed (see its
// own header comment). It sets its dev-vs-prod branch by reading
// window.location.hostname, so it's loaded here in a Node `vm` context with
// a stubbed window/location — same technique test-suite/agents/
// discovery-map/invoke-config.js already established for safely running a
// DOM-touching file headlessly, not a new pattern.
//
// Deliberately does NOT read SUPABASE_SERVICE_ROLE_KEY or any auth
// token/company id from here: the service-role key is never in scripts/env.js
// (correctly — it's server-only, proxy-side) and isn't present anywhere in
// this checkout as a local file either; a signed-in session's auth token and
// active company id are live, expiring, per-session values with nothing
// static to read. Those three stay explicit env vars — see each agent's own
// README for how to obtain them.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENV_JS_PATH = path.join(__dirname, '..', '..', 'scripts', 'env.js');

function readAppEnvJs() {
  if (!fs.existsSync(ENV_JS_PATH)) return {};
  try {
    const code = fs.readFileSync(ENV_JS_PATH, 'utf8');
    // Forces the file's own _isDev branch (localhost) — always correct here,
    // since this harness only ever targets the local dev proxy/company.
    const sandbox = { window: { location: { hostname: 'localhost' } } };
    vm.createContext(sandbox);
    new vm.Script(code, { filename: 'scripts/env.js' }).runInContext(sandbox);
    return {
      SUPABASE_URL: sandbox.window.SUPABASE_URL || null,
      PROXY_URL: sandbox.window.PROXY_URL || null
    };
  } catch (e) {
    console.warn('[readAppEnvJs] Could not read scripts/env.js (will fall back to explicit env vars):', e.message);
    return {};
  }
}

module.exports = { readAppEnvJs };
