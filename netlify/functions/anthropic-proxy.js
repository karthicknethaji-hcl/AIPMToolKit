// ── Anthropic Proxy — Netlify Serverless Function v5.10 ──
// Primary proxy path for all hosted deployments (dev + prod).
// Receives same-origin requests from /api/anthropic (netlify.toml rewrite).
// Same-origin → no CORS preflight → works on corporate networks.
//
// Auth: X-Auth-Token presence required (Supabase JWT — presence-only in Phase 1).
// Key:  BYOK from Authorization: Bearer header. Falls back to ANTHROPIC_API_KEY env var (org key).

function getHeader(headers, name) {
  const lower = name.toLowerCase();
  for (const key in headers || {}) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return '';
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token',
  'Content-Type': 'application/json'
};

const ALLOWED_MODELS = new Set(['claude-sonnet-4-6','claude-haiku-4-5']);
const MAX_OUTPUT_TOKENS = 600;

function extractBearerToken(authHeader) {
  const h = (authHeader || '').trim();
  if (!h) return { key: '', malformed: false };
  const bearerMatch = /^Bearer(?:\s+(.+))?$/i.exec(h);
  if (!bearerMatch) return { key: '', malformed: true };
  const k = (bearerMatch[1] || '').trim();
  // Guard against literal 'undefined' or 'null' strings from corrupted localStorage
  if (k === 'undefined' || k === 'null') return { key: '', malformed: false };
  return { key: k, malformed: false };
}

function looksLikeAnthropicKey(key) {
  return /^sk-(ant-)?[A-Za-z0-9._~+=/-]{20,}$/.test(key);
}

exports.handler = async function(event) {

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Method not allowed' } })
    };
  }

  // Auth gate: X-Auth-Token presence (Phase 1 — presence only, not verified)
  const jwtToken = getHeader(event.headers, 'x-auth-token');
  if (!jwtToken) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: { type: 'auth_error', message: 'Not authenticated. Please sign in and try again.' }
      })
    };
  }

  // API key — BYOK from Authorization header, fallback to org key env var
  const ORG_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
  const parsedAuth = extractBearerToken(getHeader(event.headers, 'authorization'));

  if (parsedAuth.malformed) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Invalid Authorization header.' } })
    };
  }

  const byokKey = parsedAuth.key;
  const apiKey = byokKey || ORG_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: { message: 'No API key available. Add a personal API key in Settings or contact your admin.' }
      })
    };
  }

  // Format validation: only validate BYOK keys — org key is trusted server-side env var
  if (byokKey && !looksLikeAnthropicKey(byokKey)) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Invalid API key format.' } })
    };
  }

  // Parse body
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch(e) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Invalid request body.' } })
    };
  }

  // Model allowlist + max_tokens clamp
  if (!ALLOWED_MODELS.has(body.model)) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Unsupported model for AI Recommendations.' } })
    };
  }
  body.max_tokens = Math.min(MAX_OUTPUT_TOKENS, Math.max(1, Number(body.max_tokens) || MAX_OUTPUT_TOKENS));

  // AbortController timeout — 55s (within Netlify 60s limit)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      body.model,
        max_tokens: body.max_tokens,
        system:     body.system,
        messages:   body.messages
      }),
      signal: controller.signal
    });

    const rawText = await response.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch(e) {
      const msg = response.status === 403
        ? 'Your organisation API key is blocked from direct API access. Contact your Anthropic org admin to enable API access.'
        : response.status === 529 || response.status === 503
        ? 'Anthropic API is temporarily overloaded. Please wait a moment and try again.'
        : 'Anthropic returned an unexpected response (HTTP ' + response.status + '). Please try again.';
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: msg } }) };
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };

  } catch(err) {
    const msg = err.name === 'AbortError'
      ? 'Request timed out. Please try again.'
      : 'Proxy error: ' + err.message;
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: msg } }) };
  } finally {
    clearTimeout(timeout);
  }
};
