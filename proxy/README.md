# Product Growth Toolkit — Anthropic Proxy

Express server that authenticates requests (via Supabase JWT verification)
and forwards AI generation calls to Anthropic. Deployed to Render for both
dev and prod; can also be run locally for development.

## Required environment variables

| Variable | Purpose |
|---|---|
| `ALLOWED_ORIGIN` | The single frontend origin allowed to call this proxy (e.g. `https://productdiagnostics.netlify.app`) |
| `SUPABASE_URL` | Used for JWT verification (JWKS) and the admin client below |
| `SUPABASE_SERVICE_ROLE_KEY` | Required as of v8.99 — used by the admin client for `/api/check-company-name` and Team Management's admin routes. Bypasses RLS; never expose this to the browser. |
| `INVITE_REDIRECT_ALLOWLIST` | As of v8.112 — comma-separated exact origins (no trailing slash) allowed as invite-link redirect targets, e.g. `http://localhost:3000,https://devproductdiagnostics.netlify.app`. Deliberately per-environment, not hardcoded — this same file deploys to both dev and prod, and prod's value must never include a localhost entry. If unset, invite links fall back to the Supabase project's default Site URL. |
| `ANTHROPIC_API_KEY` | Optional shared org key, used as a fallback when a request has no personal (BYOK) key |

## Running locally

Two separate processes, in two separate terminal windows:

```powershell
# Terminal 1 — from the app root
node scripts/local-server.js

# Terminal 2 — from the app root, same session as the exports below
$env:SUPABASE_URL="https://<your-pgt-dev-project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<pgt-dev service role key>"
$env:ALLOWED_ORIGIN="http://localhost:3000"
$env:INVITE_REDIRECT_ALLOWLIST="http://localhost:3000,https://devproductdiagnostics.netlify.app"
node proxy/server.js
```

`local-server.js` only serves the static frontend on port 3000 — it has
never been responsible for AI calls. Those go through `server.js` on port
3001, which is why both need to be running simultaneously for AI
generation to work locally.

**As of v8.109 (Phase 4), `SUPABASE_URL` is no longer optional for local
testing.** Team Management's routes require a real, JWT-verifying identity
— unlike `/api/anthropic`, which has always had a local-dev bypass that
skips JWT verification entirely for `localhost` origins. Without
`SUPABASE_URL` set, every `/api/team/*` call fails immediately with
`"Auth not configured on proxy"`, even though `/api/anthropic` would have
kept working fine — the bypass only ever covered that one route, not the
proxy as a whole. `/api/check-company-name` masked this same gap for even
longer, since it degrades gracefully to `{exists:false}` when
`SUPABASE_SERVICE_ROLE_KEY` is missing rather than hard-failing.

**First time running the proxy locally, or after a `package.json` change:**
run `npm install` inside `proxy/` before starting it — `@supabase/supabase-js`
was added as a dependency in v8.99, and a `node_modules` folder from before
that change will cause a `Cannot find module '@supabase/supabase-js'` crash
on startup.

### Corporate network TLS certificate errors

If you're behind SSL-inspecting corporate network security (e.g. Fireglass,
Forcepoint) and see `unable to get local issuer certificate` when the local
proxy tries to reach Anthropic or Supabase: your browser already trusts the
corporate root certificate (pushed to the OS/browser trust store by IT), but
a locally-run Node.js process does not — Node uses its own separate bundled
certificate list by default.

**Local development only, every time you start the proxy — this setting is
per-terminal-session and does not persist:**

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED="0"
node proxy/server.js
```

**Never set this for the hosted Render deployment.** It disables TLS
certificate verification entirely, which is fine for bypassing a known
corporate MITM proxy on your own machine during development, but would be
a real security regression anywhere else. Render's environment has no
Fireglass/Forcepoint in the path, so it isn't needed there at all.

A more correct (but more involved) fix, if this becomes worth setting up
permanently: export the corporate root certificate and point Node at it via
the `NODE_EXTRA_CA_CERTS` environment variable instead of disabling
verification outright.

## Deploying

Auto-deploys to Render on push to `main` of the
`kkarthicknethaji/product-diagnostics-proxy` repository. The same push
deploys both the dev and prod Render services, since they share this repo.
