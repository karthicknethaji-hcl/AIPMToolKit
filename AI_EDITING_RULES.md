# AI Editing Rules — AI PM Toolkit

Read this file before making any change to any file in this project.

---

## Project structure

```
index.html            app entry point — layout, tab buttons, script/CSS references
styles/               CSS files grouped by app area
scripts/              JavaScript files grouped by feature
DESIGN_SYSTEM.md      single source of truth for all visual and layout standards
PROJECT_MAP.md        which file owns which function
FILE_MANIFEST.txt     current complete list of all project files
CHANGELOG.md          plain-English change history
AI_EDITING_RULES.md   this file
```

---

## Before making any change

1. Read `PROJECT_MAP.md` to identify the correct file(s).
2. Read `DESIGN_SYSTEM.md` before writing any new CSS or building any new screen.
3. Read `FILE_MANIFEST.txt` to understand the current file inventory — never assume file counts from memory.
4. Inspect only the relevant files. Do not open unrelated files.
5. For JS changes: run a syntax check after every edit (`node --check filename.js`).
6. After completing a change: update `CHANGELOG.md`. If new files were added or file ownership changed, update `PROJECT_MAP.md` and `FILE_MANIFEST.txt`.

---

## MANDATORY PROCESS — diagnose before building

**HARD RULE: Never write a single line of code, run a single command, or modify any file until the user has explicitly approved the build list.**

This rule applies to EVERY change — no matter how small, no matter how obvious the fix. One line. One CSS tweak. One label change. All of it requires approval first.

When the user reports issues or requests changes:
1. Read the relevant files to understand the current state
2. Diagnose the root cause of each issue
3. Present a **Confirmed Build List** — every item listed with: what's wrong, root cause, proposed fix
4. **STOP. Wait for explicit approval.** Do not touch any file.
5. Only begin building after the user says "go ahead", "ok", "approved" or equivalent
6. If the user asks a question or makes a suggestion during the build list review — answer it, update the list if needed, then wait for approval again before building

**Violation examples — all of these are wrong:**
- User asks "did you fix X?" → Claude says "no" then immediately fixes it without approval
- User suggests a label change → Claude agrees then immediately builds it
- User says "fix all" after a summary → Claude builds without presenting a final list first
- User reports a bug → Claude diagnoses it and immediately fixes it without presenting a build list
- Claude judges a fix as "obvious" or "one line" → builds without approval. Simplicity is never an exception.
- Any scenario where code is written before the user has seen and approved a build list

**The hotfix trap:** Bug reports feel urgent. The fix feels obvious. Claude skips the list and builds. This is the most common violation pattern and there are zero exceptions — a one-line hotfix still requires a presented build list and explicit approval before a single character is changed.

This rule exists because Nethaji has flagged this repeatedly. Every violation wastes a test cycle and disrespects his time. There is no exception.

---

## MANDATORY — Design and impact thinking (before any wireframe or build list)

This section applies to all feature design, UX proposals, and build planning.
Violating this is the same category of error as building without approval.

### Step 1 — Read the code before forming opinions
Never describe, assume, or design based on memory of how something works.
Before any wireframe or spec:
- Read the relevant JS function(s) to understand current behaviour
- Check the actual CSS constraints (panel widths, z-index, overflow rules)
- Read the data model fields on the objects involved — don't assume field names or values

### Step 2 — Enumerate all states before designing the happy path
Every UI interaction has multiple states. Identify all of them first:
- All origin variants (e.g. kpi / diagnostic / market / pi)
- Empty states, error states, partially-populated states
- What the UI looks like before the action, during it, and after it
Design must account for all states — not just the one that looks good in a wireframe

### Step 3 — Trace the full journey
For every proposed interaction, answer these questions before proposing anything:
- What triggers this? (user action, system event, data condition)
- What state does the system land in immediately after?
- What does the user see on screen — does it re-render, refresh, close, update in place?
- Is there any other canvas, panel, or data structure affected?
- What happens if the user cancels or partially completes the action?

### Step 4 — Check surface constraints before designing
- Measure available width/height from CSS before building horizontal or grid layouts
- Check if a modal already exists for this context — reuse patterns before inventing new ones
- Check if the proposed UX creates panel-over-panel, modal-over-modal, or scroll-within-scroll
- Verify that the data needed for the design actually exists on the object in state

### Step 5 — Impact analysis across the full codebase
Before finalising a build list, ask:
- Which other canvases read the data this change writes?
- Does changing a field affect any IDs, keys, or Set memberships used elsewhere?
- Does this change require a re-render anywhere outside the primary file?
- Are there demo data implications — will demo mode exercise this new state?

### The standard
Raise all of the above proactively.
Do not wait for the user to identify gaps, missing states, or downstream impacts.
If something was missed and the user catches it — treat it as the same class of process
violation as building without approval. Learn from it, update these rules, move on.

---

## MANDATORY — Pre-build-list stress test

This section governs the diagnosis stage itself — before any Confirmed Build List
is presented for approval. It exists because a build list was presented as
"diagnosis complete" without this step, and stress testing afterward surfaced
two real scope changes (a missed copy location, and a missing rename-cascade
that would have orphaned data) that should have been caught before the list
was first shown to the user.

**Run this for every item before it goes into a Confirmed Build List:**

1. **Cross-reference grep, not memory.** For every proposed fix, grep the
   codebase for every other consumer of the function/string/data field being
   touched — not just the one location the bug report pointed at.
2. **Trace every data field by its full lifecycle, not just its render point.**
   If a fix touches a field that's also read elsewhere (a name used as a
   dictionary key, a string matched against a session snapshot, a flag checked
   by a different render path), confirm whether that other consumer needs an
   equivalent update. Ask explicitly: does this field get cloned/snapshotted
   anywhere, and if so, does this change desync the clone from the source?
3. **Check for an existing pattern before inventing a new one.** If a similar
   problem was already solved elsewhere in the codebase (e.g.
   `stageRenameDownstream()` for stage renames), the new fix must either reuse
   that pattern or explicitly justify why it doesn't apply. Silently omitting
   it is a regression risk, not a simplification.
4. **State confirmed-safe findings, not just confirmed-risk findings.** Report
   what was checked and found to be NOT a problem (e.g. "checked X, no other
   callers, safe"), so the user can trust an absence of a finding was due to
   checking, not skipping.
5. **Present stress-test results as part of the Confirmed Build List itself —
   not as a separate step the user has to ask for.** Every item in the build
   list must show what was cross-checked and what (if anything) the check
   changed about the item's original scope.
6. **This happens before the Confirmed Build List is finalized — not after
   approval, not during build.** If stress testing surfaces a scope change,
   the user reviews the updated list before any code is touched.

---

## MANDATORY — Layout/CSS bugs: measure before modifying (parent-chain first)

This section exists because of a real incident (v7.61, Home tab empty-state centering)
where ~8 CSS variants were tried on `.home-empty-wrap` / `.home-main` before the actual
root cause was found: a sibling element (`.right`, `flex:1`) was competing for space
inside `.app`, capping `#home-tab` at ~679px instead of the full panel width. The child
elements were centering correctly all along — inside a parent that was the wrong size.

**The rule:**

1. If a centering, alignment, or sizing fix does not produce the expected visual change
   after **one** attempt, STOP iterating on the target element's own CSS.
2. Before proposing a second variant, measure the actual rendered dimensions of the full
   parent chain — every ancestor up to the nearest known-good/full-size container — using
   `getBoundingClientRect()` via Playwright against the **real `index.html`** (not an
   isolated repro — repros can hide sibling/competition issues that only exist in the
   full DOM).
3. Compare the broken layout's container chain against a working reference pattern
   elsewhere in the app (e.g. `.right > .app-shell > .out-body > .empty`). Structural
   differences in the chain — extra/missing wrappers, competing `flex:1` siblings,
   inline styles overriding stylesheet rules — are more often the cause than the
   target element's own alignment properties.
4. **`position:absolute; inset:0` producing literally no visible change is a strong
   signal the containing block is not what you think it is** — not a signal to try yet
   another centering approach on the same element.
5. A child element can be correctly centered inside a parent that is itself the wrong
   size. Always verify the parent's box dimensions before concluding the child's CSS
   is wrong.

This applies to any layout bug, not just centering — overflow, clipping, unexpected
width/height, and z-index stacking issues are all parent-chain bugs more often than
target-element bugs.

---

**The `/mnt/project/` files are a frozen snapshot. They are NOT the current codebase. Never use them as a build base.**

Every build must start from the correct base. Follow this decision tree exactly:

### Case 1: Same conversation thread, prior build exists
```
Base = the last build directory from this session (e.g. /home/claude/build-629/)
Command: cp -r /home/claude/build-629 /home/claude/build-630
NEVER: cp -r /mnt/project /home/claude/build-630
```
Using `/mnt/project/` as the base when a prior build exists will silently discard all previous fixes. This was the root cause of regressions in v6.29 and v6.30 where v6.28 panel fixes were lost.

### Case 2: New conversation thread, no prior build directory in session
```
Base = /mnt/project/ (only option available)
BUT: Before building, run this verification:
  1. Read CHANGELOG.md — note the claimed current version
  2. Check 4 key signatures in the code against the changelog claims:
     - grep "hdr-version" index.html → does the version match?
     - grep "ccGetFeatSelState" capability-canvas.js → must be present
     - grep "allSelected=feat.stories.every" feature-canvas.js → must be present
     - grep "piGetSelectedStories" pi-planning.js → must be present
  3. If mismatches found, flag them to the user before building
  4. Note: /mnt/project/ is typically several versions behind the deployed app
```

### Permanent fix (user action required)
Update the Claude Project files after each significant build session by uploading the latest JS/CSS files. This makes `/mnt/project/` reflect true current state and eliminates Case 2 regressions.

---

## Pre-build verification checklist

Run ALL of these before calling `present_files` on any build:

1. All JS files pass `node --check`
2. **CSS integrity check — MANDATORY:** Run the following before every zip:
   ```python
   for f in /mnt/project/*.css:
       opens = content.count('{')
       closes = content.count('}')
       if opens != closes: FAIL
   ```
   A single truncated CSS file (even one dangling selector with no braces) will break the entire app layout on Netlify. This was the root cause of the v6.08/v6.09 deployment failures. Every CSS file must have balanced braces before packaging.
3. **Proxy URL cross-check:** `PROXY_URL` in `api.js` must match the routing intent — if using Render, confirm Render is reachable. If using Netlify function, confirm max_tokens across all callAPI() calls fit within the 10s function timeout (they don't for KPI tree at 14000 tokens — use Render).
4. No `style.display` assignments targeting `#mi-tab`, `#dv-tab`, `#sc-tab` content divs — these use `classList.toggle('on')`
5. No `classList.add/remove('on')` targeting `#tab-mi`, `#tab-dv`, `#tab-la` tab buttons — these use `style.display`
6. No hardcoded hex colours in CSS files (use token variables)
7. No duplicate function declarations in any JS file
8. Every collapse button CSS class includes `color: var(--t3)` — never rely on colour inheritance
9. Every collapse button SVG is `width="12" height="12"` with `stroke="currentColor"` — never hardcoded hex, never 14×14
10. **Version string — MANDATORY:** Before every zip, update `APP_VERSION` in `config.js` to the new version number (e.g. `const APP_VERSION = 'v8.77';`). Both `index.html` and `login.html` read this automatically on page load — never hardcode version strings in HTML. Do NOT update `hdr-version` spans in HTML directly.
11. **CHANGELOG verification — MANDATORY:** Before every zip, confirm the new version entry exists at the top of CHANGELOG.md:
    ```python
    with open('CHANGELOG.md') as f: content = f.read()
    assert f'## v{new_version}' in content, f"CHANGELOG missing v{new_version} entry — do not zip"
    ```
    If the assert fails, fix the CHANGELOG before zipping. A zip with a missing or wrong version entry has been delivered before (v7.35) — this check prevents recurrence.

---

## Tab button vs tab content — CRITICAL DISTINCTION

There are TWO different elements per tab with DIFFERENT visibility mechanisms:

| Element | ID pattern | Mechanism |
|---|---|---|
| Tab button | `#tab-mi`, `#tab-dv`, `#tab-la` | `style.display = ''` / `'none'` |
| Tab content div | `#mi-tab`, `#dv-tab`, `#sc-tab` | `classList.add/remove('on')` |

**Before replacing any `style.display` assignment, read the element's ID and confirm which type it is.**

---

## Editing principles

- Prefer targeted surgical edits over broad rewrites.
- Do not rewrite a full file when a str_replace will do.
- Do not rebuild a working screen unless explicitly instructed.
- Do not add unrequested features or scope creep.
- Do not hardcode colour hex values in component CSS — always use the token variables from `styles/00-tokens.css`.
- Do not change the 300px left panel width. Do not change the tab row position (it must be in `.app-shell`, above `.app`).
- The user is non-technical. Infer the correct file from `PROJECT_MAP.md` rather than asking the user to name files.

---

## Adding new features

When adding a new tab, screen, or major feature:

1. New features get **new files** — a new `scripts/feature-name.js` and `styles/NN-feature-name.css`.
2. Minimal changes to existing files — add state variables to `state.js`, add prompts to `prompts.js`, add tab switch logic to `api.js`, add script/CSS references to `index.html`.
3. Follow the naming convention: CSS files are numbered sequentially (`11-`, `12-`, etc.).
4. Update `FILE_MANIFEST.txt` with the new files.
5. Update `PROJECT_MAP.md` with the new file's ownership and routing.

---

## Deployment verification rules

**Before every zip delivery, verify these three things:**

1. **Proxy URL matches netlify.toml** — Open `scripts/api.js` and find `PROXY_URL` or the hosted fetch URL. Open `netlify.toml` and find the `[[redirects]]` `from` path. They must match. If they don't, the deployed app will fail on every API call while working perfectly locally.

2. **Render proxy is the correct hosted proxy — not the Netlify function** — The Netlify free tier function timeout is 10 seconds. KPI tree generation uses max_tokens=14000 and takes 30–60 seconds. The Netlify function times out and returns an HTML error page, causing "Unexpected token '<'" in the app. Always use the Render proxy (`https://product-diagnostics-proxy.onrender.com/api/anthropic`) for hosted deployments. UptimeRobot keeps Render warm with a ping every 5 minutes — never remove this setup or switch to the Netlify function without accounting for the timeout constraint.

3. **Local vs hosted routing** — The app behaves differently locally (`file://`, `localhost`) vs deployed. Any change to `api.js` routing logic must be tested mentally against both paths: (a) local file open, (b) Netlify deployment. Never assume local success = Netlify success.

---

## Versioning rules

**Always read CHANGELOG.md to determine the current version before naming any zip.**
Never infer the version from memory or prior conversation — the changelog is the single source of truth.

Version format:
- Major increment (v5 → v6 → v7): new tab, new screen, new major feature, or breaking change
- Minor revision (v6.00 → v6.01 → v6.02): improvements, bug fixes, prompt changes, UI tweaks
- Minor revisions always use two decimal places: v6.00, v6.01 ... v6.09, v6.10, v6.11 etc.
- After a major version bump the minor resets to .00: v6.00, not v6.0
- Example sequence: v5.13 → v5.14 → v6.00 (major) → v6.01 → v6.02

**CRITICAL — every build increments the version, no exceptions:**
- Hotfixes increment: v6.36 → v6.37. Never re-deliver a build under the same version number.
- Bug fixes found immediately after delivery still get a new version — v6.36 bugs fixed = v6.37.
- There is no concept of "patching" or "re-zipping" under the same version. One delivery = one version.
- This applies even if only one line changed in one file.

**Before every build:**
1. Read CHANGELOG.md — find the current version number
2. Add +0.01 — that is the new version, no exceptions
3. Update `APP_VERSION` in `config.js` to the new version string — both `index.html` and `login.html` pick it up automatically on page load. Never update `hdr-version` spans in HTML directly.
4. Add a CHANGELOG entry for the new version before zipping — **use this exact insert pattern:**
   ```python
   import re
   entry = f"## v{new_version} — {title}\n- bullet 1\n- bullet 2\n\n"
   content = re.sub(r'(## v\d+\.\d+)', entry + r'\1', content, count=1)
   ```
   This inserts before the topmost existing version entry regardless of how many entries exist.
   **Never** target a static anchor like `## Pre-v7 History` — it breaks as soon as one entry exists above it.
5. Name the zip folder and zip file with the new version number

---

## MANDATORY CHECKPOINT — before any present_files call on a build

Before constructing $TARGET or running any cp/zip commands, re-read the
"Deliverables — zip packaging" section below in full — even if this file was
already read at session start. Do not reuse $TARGET structure or copy
commands from memory of a previous build in this session. The packaging
section's mkdir/cp commands are the only authoritative source for folder
layout (scripts/, styles/, netlify/functions/, proxy/, assets/templates/) —
/mnt/project/ is flat and does not reflect the deployed structure.

---

## Deliverables — zip packaging

**Every completed build must be delivered as a zip file.**

- Read CHANGELOG.md first to confirm the correct version number
- Build correct folder structure (do NOT just copy /mnt/project flat):
  ```
  TARGET=/home/claude/Product-Metrics-Teardown-App-vX.XX
  rm -rf $TARGET
  mkdir -p $TARGET/scripts $TARGET/styles $TARGET/netlify/functions $TARGET/assets/templates

  # Root files ONLY — index.html, login.html, favicon.ico, md files, toml, manifest
  cp /mnt/project/index.html $TARGET/
  cp /mnt/project/favicon.ico $TARGET/
  cp /mnt/project/login.html $TARGET/
  cp /mnt/project/netlify.toml $TARGET/
  cp /mnt/project/FILE_MANIFEST.txt $TARGET/
  cp /mnt/project/AI_EDITING_RULES.md $TARGET/
  cp /mnt/project/CHANGELOG.md $TARGET/
  cp /mnt/project/DESIGN_SYSTEM.md $TARGET/
  cp /mnt/project/PROJECT_MAP.md $TARGET/

  # JS files → scripts/ subfolder
  for f in /mnt/project/*.js; do cp "$f" $TARGET/scripts/; done

  # CSS files → styles/ subfolder
  for f in /mnt/project/*.css; do cp "$f" $TARGET/styles/; done

  # Netlify function
  cp /mnt/project/anthropic-proxy.js $TARGET/netlify/functions/

  # Render.com proxy backend
  mkdir -p $TARGET/proxy
  cp /mnt/project/server.js $TARGET/proxy/
  cp /mnt/project/package.json $TARGET/proxy/
  cp /mnt/project/README.md $TARGET/proxy/

  # XLSX templates → assets/templates/ subfolder (NEVER copy to root)
  cp /mnt/project/capabilityfeaturestemplate.xlsx $TARGET/assets/templates/capability-features-template.xlsx
  cp /mnt/project/capabilitylisttemplate.xlsx $TARGET/assets/templates/capability-list-template.xlsx
  cp /mnt/project/prevpitemplate.xlsx $TARGET/assets/templates/prev-pi-template.xlsx

  # Prototype style guide → assets/ ROOT (NOT assets/templates/)
  # prototype-canvas.js fetches this via fetch('assets/prototype-style-default.md') —
  # it must sit directly under assets/, sibling to templates/, not inside it.
  # If this file is missing, the app silently falls back to the embedded
  # PROTOTYPE_STYLE_DEFAULT_FALLBACK constant — no crash, but your customised
  # style guide content is never used. This was missing from the v8.83 build.
  cp /mnt/project/prototype-style-default.md $TARGET/assets/
  ```
  NOTE: proxy/ files are flat in /mnt/project/ (server.js, package.json, README.md).
  They must be explicitly copied into the proxy/ subfolder in the zip.
  These files are for the Render.com backend — they are NOT served by Netlify.
  Include in every zip for completeness; deploy separately via Render.com GitHub repo.
  WARNING: Never use cp /mnt/project/* or wildcard copies to root — this pulls JS/CSS flat.
  Always copy each file type explicitly to its correct subfolder.
  WARNING: xlsx template files in /mnt/project/ have camelCase names — they MUST be renamed
  to hyphenated names when copied into assets/templates/ (see copy commands above).
  WARNING: prototype-style-default.md must NOT be renamed and must NOT go into
  assets/templates/ — it is fetched at runtime by exact relative path
  'assets/prototype-style-default.md'. Confirmed missing from the v8.83 build because
  this packaging script never had a copy step for it despite FILE_MANIFEST.txt listing it.
  WARNING: Always name the build directory TARGET=Product-Metrics-Teardown-App-vX.XX from
  the start — never use a short name like /home/claude/v636 and rename later. The directory
  name becomes the folder name inside the zip.
- Apply all changes to files inside $TARGET after the structure is built
- **MANDATORY pre-zip file verification** — before zipping, cross-check every `script src` and `link href` in `index.html` resolves to an actual file in the output folder. Run:
  ```
  grep "script src" $TARGET/index.html | sed "s/.*src=\"\.\/scripts\///;s/\".*//" | while read f; do
    [ -f "$TARGET/scripts/$f" ] && echo "OK: $f" || echo "MISSING: $f"
  done
  grep "link rel.*stylesheet.*styles/" $TARGET/index.html | sed 's/.*href="\.\/styles\///;s/".*//' | while read f; do
    [ -f "$TARGET/styles/$f" ] && echo "OK: $f" || echo "MISSING: $f"
  done
  ```
  Any MISSING file must be copied before zipping. A missing script causes a blank screen on load.
- **MANDATORY — exclude `env.js` from every zip:** `scripts/env.js` contains live credentials (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PROXY_URL`). It must NEVER be included in any zip. Drop it manually into `scripts/` after unzipping on the target machine. Add `-x "*/scripts/env.js"` to every zip command without exception.
- **MANDATORY — preserve `favicon.ico`:** `favicon.ico` is a binary asset at the project root. It is referenced in both `index.html` and `login.html`. It must be present in every build directory. When copying a previous build as the base for a new build (`cp -r`), it is carried over automatically. Never delete it. Never omit it from the zip (it is not excluded by any rule). If it is ever missing, copy it from a previous build directory.
- Zip it: `zip -r /mnt/user-data/outputs/Product-Metrics-Teardown-App-vX.XX.zip Product-Metrics-Teardown-App-vX.XX/ -x "*.DS_Store" -x "*/node_modules/*" -x "*/scripts/env.js"`
  MANDATORY: always exclude `node_modules` from the zip. The `proxy/package.json` lists all dependencies — users run `npm install` once inside `proxy/` after unzipping. Including `node_modules` adds hundreds of files with zero value and makes the zip unnecessarily large.
- Present the zip with `present_files`

The zip must contain everything needed to run locally and deploy to Netlify:
```
index.html
netlify.toml
netlify/
  functions/
    anthropic-proxy.js
proxy/
  server.js
  package.json
  README.md
scripts/
  (all JS files)
styles/
  (all CSS files)
assets/
  templates/
    capability-features-template.xlsx
    capability-list-template.xlsx
    prev-pi-template.xlsx
*.md files
FILE_MANIFEST.txt
```

CRITICAL — zip packaging rules:
- JS files go in `scripts/` subfolder — NEVER at root level
- CSS files go in `styles/` subfolder — NEVER at root level
- The project files in /mnt/project/ are flat (Claude Projects limitation) — you MUST create the correct subfolder structure manually when building the zip
- Build pattern: mkdir scripts/ styles/ netlify/functions/ → copy JS to scripts/ → copy CSS to styles/ → copy netlify files → zip
- index.html references `./scripts/` and `./styles/` — a flat zip will break the app

No build step. No dependencies. Open `index.html` directly in a browser to run locally (uses direct Anthropic API call as fallback).
For Netlify: drag the unzipped folder into Netlify Drop. Netlify serves `index.html` as the root and auto-detects `netlify.toml`.

---

## Local testing

Open `index.html` in a browser. The `styles/` and `scripts/` folders must remain beside `index.html`.
The app requires an Anthropic API key (entered in Settings) to generate AI content.
Demo Mode (if present) works without an API key.

---

## Netlify deployment

Drag the unzipped project folder into Netlify Drop (netlify.com/drop).
No build configuration needed. The app is a static site with no server-side dependencies.
The Anthropic API key is entered by the user in the browser — it is not baked into the deployment.

---

## MANDATORY — External tool consultation (ChatGPT / second opinions)

This section exists because of repeated incidents (v8.39–v8.42) where ChatGPT was consulted
but given incomplete context, leading to fixes that broke related behaviour. The same issues
recurred across 4+ versions.

### Before writing a ChatGPT prompt

1. **Read the actual live code first — all of it.** Not just the broken function. Read:
   - The full CSS for every element the fix touches (not just the target element — all ancestors and siblings)
   - The full call chain: every function that calls the broken function, and every function it calls
   - Every `switchTab()` branch that touches the affected state
   - Every render path that could overwrite the fix

2. **Describe the cause, not the symptom.** "text-transform:uppercase in .hdr-product.has-name CSS rule" not "text goes CAPS". "el.style.display='none' not restored on tab switch back" not "session name disappears". ChatGPT fixes what it's told — if told a symptom, it guesses the cause.

3. **Include in the prompt:**
   - The exact failing line of code (not a paraphrase)
   - The full relevant CSS rules (not just the selector)
   - The full call chain showing where the function is called from
   - What other functions touch the same element or state variable
   - The history: "this fix was attempted N times and broke because of X"

4. **Ask ChatGPT explicitly:** "What else could break from this fix?" and "What am I missing in this diagnosis?" — not just "how do I fix this?"

### Before building from ChatGPT output

1. **Run the adversarial check against the proposed code** — not just the diagnosis. The adversarial instance should be given ChatGPT's proposed code and asked to find failure modes.

2. **Verify every CSS rule that touches the affected element** — ChatGPT rarely looks at CSS unless given it explicitly. After every JS fix that touches a DOM element, manually check all CSS selectors that could affect that element's colour, visibility, transform, or position.

3. **Trace every call site of every function being changed** — grep the codebase. ChatGPT only knows what's in the prompt. A function with 8 call sites fixed at 1 call site is still broken at 7.

4. **Never build from ChatGPT output that hasn't been adversarially reviewed** for state management, cross-file impact, timing, or third-party library behaviour.

### The failure pattern to avoid

```
Problem reported → Claude diagnoses (incompletely) → writes ChatGPT prompt (with incomplete context)
→ ChatGPT fixes the described symptom → build ships → same area breaks differently next version
```

The correct pattern:
```
Problem reported → Claude reads ALL relevant code → identifies exact failing line
→ writes ChatGPT prompt with full context including CSS, call chain, history
→ adversarial check on ChatGPT output → build with verified fix
```

---

## Do not do this

- Do not collapse everything back into one large HTML file.
- Do not create a `/dist` or `/build` folder.
- Do not hardcode colour hex values in component CSS files.
- Do not change the 300px left panel width without an explicit instruction.
- Do not move the tab row inside `.right` — it must stay in `.app-shell`.
- Do not ask the user to identify source files by name. Use `PROJECT_MAP.md`.
- Do not hallucinate file counts. Read `FILE_MANIFEST.txt` for the current inventory.
