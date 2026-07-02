// ── auth.js — Supabase Auth client ──
// Initialises the Supabase client and exposes all auth functions.
// Loaded by both login.html and index.html.
// Depends on: config.js (AUTH_DOMAIN constant)
// Supabase JS SDK must be loaded via CDN before this file.

// ── Supabase credentials are loaded from scripts/env.js ──
// env.js is NOT included in Claude zips — create it once locally and keep it.
// SUPABASE_URL and SUPABASE_ANON_KEY must be defined before this file loads.

// ── Client singleton ──
var _supabase = null;

// Initialise the Supabase client. Called once on page load.
function authInit() {
  if (_supabase) return _supabase;
  if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient === 'undefined') {
    console.error('auth.js: Supabase SDK not loaded. Check CDN script tag.');
    return null;
  }
  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

// ── Sign In ──
// Returns { user, session } on success.
// Throws a user-readable error string on failure.
async function authSignIn(email, password) {
  const client = authInit();
  if (!client) throw 'Auth client not initialised. Check Supabase credentials.';

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    // Map Supabase error codes to user-readable messages
    if (error.message && error.message.toLowerCase().includes('invalid login')) {
      throw 'Wrong email or password. Please try again.';
    }
    if (error.message && error.message.toLowerCase().includes('email not confirmed')) {
      throw 'Email not confirmed. Check your inbox for a confirmation link.';
    }
    throw error.message || 'Sign in failed. Please try again.';
  }
  return data;
}

// ── Sign Up ──
// Validates domain against AUTH_DOMAIN before calling Supabase.
// Returns { user, session } on success.
// Throws a user-readable error string on failure.
async function authSignUp(email, displayName, password) {
  const client = authInit();
  if (!client) throw 'Auth client not initialised. Check Supabase credentials.';

  // Domain validation — client-side guard before any Supabase call
  const domain = (typeof AUTH_DOMAIN !== 'undefined') ? AUTH_DOMAIN : 'hcltech.com';
  if (!email.toLowerCase().endsWith('@' + domain)) {
    throw 'Only @' + domain + ' email addresses are permitted.';
  }

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName.trim() }
    }
  });

  if (error) {
    if (error.message && error.message.toLowerCase().includes('already registered')) {
      throw 'An account with this email already exists. Sign in instead.';
    }
    if (error.message && error.message.toLowerCase().includes('password')) {
      throw 'Password must be at least 8 characters.';
    }
    throw error.message || 'Account creation failed. Please try again.';
  }

  // Auto sign-in: Supabase returns a session immediately when email confirmation is disabled
  if (!data.session) {
    // Email confirmation is enabled — should not happen in Phase 1 config
    throw 'Account created. Check your email to confirm before signing in.';
  }

  return data;
}

// ── Sign Out ──
// Signs out, clears local state, redirects to login.html.
async function authSignOut() {
  const client = authInit();
  if (client) {
    await client.auth.signOut();
  }
  // Clear app state from localStorage (Supabase session key cleared by SDK automatically)
  // App session data (pgt_session_*) is preserved — will be re-associated on next login
  // in Step 6 when Supabase becomes the authoritative store.
  window.location.href = 'login.html';
}

// ── Get current session ──
// Returns the active Supabase session object, or null if not authenticated.
// Used by the auth gate in main.js (index.html).
async function authGetSession() {
  const client = authInit();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) return null;
  return data.session;
}

// ── Get a guaranteed-fresh JWT access token ──
// Used by callAPI() and _homeCallAIRecs() before every proxy request.
// Strategy:
//   1. getSession() — Supabase v2 auto-refreshes if expired; returns cached token if fresh.
//   2. If token is within 90s of expiry (EXPIRY_MARGIN_MS match), force a hard refresh.
//   3. refreshSession() — forces a network round-trip; deduped via refreshInFlight promise
//      so concurrent AI calls don't fan out multiple refresh requests.
//   4. Both failed → session is dead → redirect to login (hosted only; local dev bypassed).
// Returns the access_token string, or '' if local dev / refresh failed before redirect.
var _authRefreshInFlight = null;
async function authGetFreshToken() {
  const client = authInit();
  if (!client) return '';

  const nowSec = Math.floor(Date.now() / 1000);
  const marginSec = 90; // matches Supabase EXPIRY_MARGIN_MS = 3 × 30,000ms

  // Step 1 — getSession() handles most cases including Supabase's own auto-refresh
  try {
    const { data, error } = await client.auth.getSession();
    if (!error && data && data.session && data.session.access_token) {
      const expiresAt = data.session.expires_at; // Unix seconds
      if (expiresAt && (expiresAt - nowSec) > marginSec) {
        return data.session.access_token; // fresh — use it
      }
    }
  } catch(e) {
    console.warn('authGetFreshToken: getSession threw:', e);
  }

  // Step 2 — Token absent, expired, or within margin. Force hard refresh.
  // Dedupe concurrent callers so only one refreshSession() network call fires.
  try {
    if (!_authRefreshInFlight) {
      _authRefreshInFlight = client.auth.refreshSession().finally(function() {
        _authRefreshInFlight = null;
      });
    }
    const { data: rd, error: re } = await _authRefreshInFlight;
    if (!re && rd && rd.session && rd.session.access_token) {
      return rd.session.access_token;
    }
    console.warn('authGetFreshToken: refreshSession failed:', re);
  } catch(e) {
    console.warn('authGetFreshToken: refreshSession threw:', e);
  }

  // Step 3 — Both failed. Session is dead. Redirect to login on hosted only.
  const host = window.location.hostname;
  const isLocal = host === '' || host === 'localhost' || host === '127.0.0.1';
  if (!isLocal) {
    window.location.replace('login.html');
  }
  return '';
}

// ── Get current user ──
// Returns { id, email, displayName } for the signed-in user, or null.
// Populated into the global currentUser in main.js after auth gate passes.
async function authGetUser() {
  const client = authInit();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const u = data.user;
  return {
    id:          u.id,
    email:       u.email,
    displayName: (u.user_metadata && u.user_metadata.display_name) || u.email.split('@')[0]
  };
}

// ── Password reset ──
// Sends a reset link to the given email via Supabase.
// Returns true on success, throws on failure.
async function authResetPassword(email) {
  const client = authInit();
  if (!client) throw 'Auth client not initialised.';
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/login.html'
  });
  if (error) throw error.message || 'Password reset failed. Please try again.';
  return true;
}
