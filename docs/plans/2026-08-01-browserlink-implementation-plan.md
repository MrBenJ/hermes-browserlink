# BrowserLink Implementation Plan

> **For the implementer (Claude Opus 5 / Claude Code):** Execute task-by-task
> in order. Every task ends in a commit. Work on branch `feat/initial-port`.
> Do not push to `main`. If a Phase 0 spike fails, STOP, write findings to
> `docs/spikes/`, and report — do not improvise around a failed spike.
> Design rationale lives in `docs/plans/2026-08-01-hermes-port-plan.md`;
> this document is self-contained for execution.

**Goal:** Port LobsterLink (upstream `~/code/forks/lobsterlink-upstream` @
`4bb37de`) into this repo as **BrowserLink**, rebranded, with an exportable
single-file viewer, configurable viewer base URL, and Hermes-native install
flow + skill.

**Working directory:** `~/code/hermes-browserlink`

**Source of truth for vendoring:** `~/code/forks/lobsterlink-upstream`
ONLY. Never use `~/code/forks/lobsterlink` (stale, untrusted).

**Architecture (unchanged from upstream):** MV3 extension —
`background.js` (service worker: chrome.debugger screencast + input
dispatch) → `offscreen.js` (canvas ← JPEG frames → `captureStream()` →
PeerJS) ↔ `client/` viewer (PeerJS, render + input). `bridge.html` is the
agent control surface. PeerJS default cloud broker, signaling only.

**Hard rules for the implementer:**
- NEVER modify `~/.hermes/.env` or `~/.hermes/config.yaml` without showing
  Ben the exact lines and getting explicit approval first. Present, ask,
  wait.
- Commit after every task. Conventional commits (`feat:`, `chore:`, `docs:`,
  `test:`).
- `vitest run` must be green at the end of every task that touches JS.
- Evidence over assumptions: every verification step has an expected output.
  If output differs, stop and report the diff.

---

## Phase 0 — Environment spikes (gates everything)

### Task 1: Characterize agent-browser

**Objective:** Learn how Hermes' local browser mode launches Chromium.

**Steps:**
1. `which agent-browser || npm i -g agent-browser`
2. `agent-browser --help` — record output.
3. From a Hermes session, call `browser_navigate` to `https://example.com`.
4. `ps aux | grep -iE "chrom|headless" | grep -v grep` — record: binary
   path, headless flags, `--remote-debugging-port` value (or absence),
   `--user-data-dir` value.
5. Write all findings to `docs/spikes/01-agent-browser.md`.
6. Commit: `docs: spike 01 — agent-browser launch profile`

**Expected:** you know the Chromium binary, headless mode, CDP port (or
"pipe only"), and profile dir. If headless is old-style (`--headless`
without `=new`), flag it: MV3 extensions need `--headless=new`.

### Task 2: Extension flag pass-through

**Objective:** Prove `AGENT_BROWSER_ARGS` loads an extension.

**Steps:**
1. `mkdir -p ~/.hermes/browser-extensions && cp -R ~/code/forks/lobsterlink-upstream ~/.hermes/browser-extensions/lobsterlink-spike`
2. **STOP — present these exact lines to Ben for approval before adding to
   `~/.hermes/.env`:**
   ```
   AGENT_BROWSER_ARGS="--load-extension=$HOME/.hermes/browser-extensions/lobsterlink-spike --disable-extensions-except=$HOME/.hermes/browser-extensions/lobsterlink-spike"
   ```
   If `AGENT_BROWSER_ARGS` already exists in `.env`, show the merged value
   instead (preserve existing flags, comma/newline separated per Hermes
   docs). Note: setting it disables Hermes' auto-injection of
   `--no-sandbox` etc. — on macOS this is a non-issue, but record what was
   there before.
3. After approval + edit, restart the Hermes session, `browser_navigate` to
   `https://example.com`, then `ps aux | grep "load-extension" | grep -v grep`.
4. **Expected:** live Chromium command line contains both flags with the
   spike path. If not: spike FAILED → document, stop, report.

### Task 3: Extension target discovery via CDP

**Objective:** Prove the extension actually loaded; record its ID.

**Steps:**
1. Get the debug port from Task 1's `ps` output (call it `PORT`).
2. `curl -s http://127.0.0.1:PORT/json/list` — find targets whose `url`
   starts with `chrome-extension://`. Record the extension ID (the
   32-char path component).
3. If no CDP port exists (pipe mode), try `lsof -a -p <chromium-pid> -i TCP -P | grep LISTEN`.
4. **Expected:** a `chrome-extension://<id>/...` service-worker or page
   target exists. If none: spike FAILED → document, stop, report.
5. Append findings + extension ID to `docs/spikes/02-extension-loading.md`.
6. Commit: `docs: spike 02-03 — extension load + CDP discovery`

### Task 4: Bridge page reachability

**Objective:** Determine how Hermes opens `chrome-extension://` pages.

**Steps:**
1. Try Hermes `browser_navigate` to
   `chrome-extension://<id>/bridge.html`. Record the result verbatim.
2. If blocked, try CDP target creation (modern Chrome requires PUT):
   `curl -s -X PUT "http://127.0.0.1:PORT/json/new?chrome-extension://<id>/bridge.html"`
   then confirm it appears in `/json/list`.
3. **Expected:** at least one path works. Record WHICH path works — this
   determines the skill's bridge-open flow. If both work, prefer
   `browser_navigate`.
4. Append to spike doc. Commit: `docs: spike 04 — bridge reachability`

### Task 5: End-to-end smoke (upstream code, unmodified)

**Objective:** Prove the whole pipeline works in this topology BEFORE
porting.

**Steps:**
1. Serve the upstream viewer: `cd ~/code/forks/lobsterlink-upstream && python3 -m http.server 4173 --directory client &`
2. In the agent browser, open a test tab (e.g. `https://example.com`).
3. Open the bridge (path from Task 4), select the test tab, click
   **Start Host**. Read `Current Peer ID` from the bridge fields.
4. Open `http://127.0.0.1:4173/#host=<peer-id>` in a NEW tab of the same
   Chromium (CDP `/json/new`).
5. Verify the viewer tab renders non-black frames (CDP
   `Page.captureScreenshot` on the viewer target, or Hermes browser tools
   on that tab). Verify the bridge focus indicator reads `Active`.
6. From the viewer, click somewhere / send input; verify the hosted tab
   responds (e.g. scroll example.com, then re-screenshot viewer).
7. Record results + screenshots to `docs/spikes/05-e2e.md`, including
   whether the hosted-tab-active constraint behaved as documented.
8. Stop the python server. Commit: `docs: spike 05 — end-to-end smoke`

**Expected:** frames flow, input flows. Any deviation → document precisely;
it shapes the skill's gotchas section.

---

## Phase 1 — Vendor + rebrand

### Task 6: Vendor upstream code

**Files:** everything except upstream docs/meta.

**Steps:**
```bash
cd ~/code/hermes-browserlink
rsync -av \
  --exclude '.git' \
  --exclude 'openclaw' \
  --exclude 'docs' \
  --exclude 'AGENT-INSTALL.md' \
  --exclude 'README.md' \
  ~/code/forks/lobsterlink-upstream/ ./
rm -f hello.txt
npm ci
```
- `git add -A && git commit -m "chore: vendor LobsterLink upstream @ 4bb37de"`

### Task 7: Rebrand manifest

**Files:** Modify `manifest.json`

**Replace entire contents with:**
```json
{
  "manifest_version": 3,
  "name": "BrowserLink",
  "version": "1.0.0",
  "description": "Remote browser tab viewing and control via WebRTC — hand a human one blocked step without sharing credentials",
  "permissions": [
    "tabs",
    "debugger",
    "activeTab",
    "offscreen",
    "scripting",
    "clipboardWrite",
    "storage"
  ],
  "host_permissions": [
    "http://127.0.0.1/*",
    "http://localhost/*",
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "BrowserLink"
  },
  "icons": {},
  "web_accessible_resources": []
}
```
- Commit: `chore: rebrand manifest to BrowserLink 1.0.0`

### Task 8: Rebrand all strings

**Objective:** No user-visible or log-visible "LobsterLink"/"LOBSTERLINK"
remains; no `lobsterl.ink` reference remains outside spike docs.

**Steps:**
1. Enumerate: `grep -rniE "lobsterlink|lobsterl\.ink" --include='*.js' --include='*.html' --include='*.json' . | grep -v node_modules | grep -v package-lock | grep -v docs/spikes`
2. Replace, file by file (review each — don't blind-sed):
   - `LobsterLink` → `BrowserLink`
   - `[LOBSTERLINK:` → `[BROWSERLINK:]` (log prefixes in `offscreen.js`,
     `background.js`, `bridge.js`, `client/viewer.js`, etc.)
   - `lobsterl.ink` mentions in `bridge.html` / `client/index.html` copy →
     rephrase as "your configured viewer" (the actual URL constant is
     removed in Task 9).
   - Lowercase `lobsterlink` in code identifiers (e.g.
     `__lobsterlinkHostAgentInstalled`, `__lobsterlink_remote_cursor_root`
     in `host-agent.js`) → `browserlink` equivalents. These are internal
     sentinel keys — renaming is safe, but confirm each is self-consistent
     (same file or paired producer/consumer).
3. Run `npx vitest run`. **Expected:** all tests pass (some will fail on
   the URL constant — that's Task 9; if the ONLY failures are
   `buildViewerUrl` URL expectations, proceed to Task 9 and fix there).
4. Commit: `chore: rebrand strings and log prefixes to BrowserLink`

### Task 9: Configurable viewer base URL — pure helpers (TDD)

**Files:**
- Modify: `lib/bridge-utils.js`
- Test: `test/bridge-utils.test.js`

**Step 1 — replace `test/bridge-utils.test.js` `buildViewerUrl` tests with:**
```js
const { buildViewerUrl, normalizeViewerBaseUrl } = require('../lib/bridge-utils.js');

describe('normalizeViewerBaseUrl', () => {
  it('trims whitespace', () => {
    expect(normalizeViewerBaseUrl('  http://x/v.html ')).toBe('http://x/v.html');
  });
  it('strips an existing fragment', () => {
    expect(normalizeViewerBaseUrl('http://x/v.html#host=old')).toBe('http://x/v.html');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeViewerBaseUrl('')).toBe('');
    expect(normalizeViewerBaseUrl(undefined)).toBe('');
    expect(normalizeViewerBaseUrl('   ')).toBe('');
  });
});

describe('buildViewerUrl', () => {
  it('returns empty string without a peer id', () => {
    expect(buildViewerUrl('', 'http://x/v.html')).toBe('');
  });
  it('returns empty string without a base url', () => {
    expect(buildViewerUrl('abc', '')).toBe('');
    expect(buildViewerUrl('abc')).toBe('');
    expect(buildViewerUrl('abc', '   ')).toBe('');
  });
  it('builds the url with a #host fragment', () => {
    expect(buildViewerUrl('abc123', 'http://mac-mini:8787/browserlink-viewer.html'))
      .toBe('http://mac-mini:8787/browserlink-viewer.html#host=abc123');
  });
  it('encodes the peer id', () => {
    expect(buildViewerUrl('a b/c', 'http://x/v.html'))
      .toBe('http://x/v.html#host=a%20b%2Fc');
  });
  it('replaces a stale fragment on the base', () => {
    expect(buildViewerUrl('abc', 'http://x/v.html#host=old'))
      .toBe('http://x/v.html#host=abc');
  });
});
```
Keep the existing `pickDefaultSelectedTab` tests unchanged.

**Step 2 — run:** `npx vitest run test/bridge-utils.test.js` — **Expected:
FAIL** (new functions missing).

**Step 3 — replace `lib/bridge-utils.js` contents with:**
```js
'use strict';

// BrowserLink bridge pure helpers.
// Classic-script-compatible: defines functions at script scope so the
// extension (bridge.html -> bridge.js) can pick them up as globals, and
// exports via CommonJS so Vitest can import them in Node.

var VIEWER_BASE_URL_STORAGE_KEY = 'browserlinkViewerBaseUrl';

function normalizeViewerBaseUrl(baseUrl) {
  if (!baseUrl) return '';
  var trimmed = String(baseUrl).trim();
  if (!trimmed) return '';
  return trimmed.replace(/#.*$/, '');
}

function buildViewerUrl(peerId, baseUrl) {
  if (!peerId) return '';
  var base = normalizeViewerBaseUrl(baseUrl);
  if (!base) return '';
  return base + '#host=' + encodeURIComponent(peerId);
}

function pickDefaultSelectedTab(state) {
  var tabs = state && state.tabs;
  if (!tabs || !tabs.length) return null;
  var capturedTabId = state.status && state.status.capturedTabId;
  if (capturedTabId && tabs.some(function (tab) { return tab.id === capturedTabId; })) {
    return capturedTabId;
  }
  var active = tabs.find(function (tab) { return tab.active; });
  return active ? active.id : tabs[0].id;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VIEWER_BASE_URL_STORAGE_KEY: VIEWER_BASE_URL_STORAGE_KEY,
    normalizeViewerBaseUrl: normalizeViewerBaseUrl,
    buildViewerUrl: buildViewerUrl,
    pickDefaultSelectedTab: pickDefaultSelectedTab
  };
}
```

**Step 4 — run:** `npx vitest run test/bridge-utils.test.js` — **Expected:
PASS.**

**Step 5 — commit:** `feat: configurable viewer base URL in bridge utils`

### Task 10: Wire the base URL into the bridge page

**Files:**
- Modify: `bridge.html` (add field), `bridge.js` (wire storage + calls)

**Objective:** Every `buildViewerUrl(peerId)` call site in `bridge.js`
passes the configured base; bridge UI lets the agent set it once.

**Steps:**
1. Read `bridge.html`/`bridge.js` fully. Find the Viewer URL display field
   and every `buildViewerUrl(` call.
2. Add to `bridge.html`, directly above the existing Viewer URL field:
```html
<div class="field-row">
  <label for="viewerBaseUrl">Viewer Base URL</label>
  <input id="viewerBaseUrl" type="text"
         placeholder="http://<this-machine>:8787/browserlink-viewer.html"
         spellcheck="false" />
  <span class="muted">Saved locally. The shareable Viewer URL is built from this.</span>
</div>
```
   (Adapt class names to the file's existing conventions.)
3. In `bridge.js`, near bridge init:
```js
let currentViewerBaseUrl = '';

function refreshViewerUrlField() {
  const peerId = /* existing expression for current peer id */;
  const url = buildViewerUrl(peerId, currentViewerBaseUrl);
  // existing code that writes the Viewer URL field → write url;
  // when url === '' show placeholder text:
  //   peerId ? 'Set Viewer Base URL to get a shareable link' : ''
}

chrome.storage.local.get(VIEWER_BASE_URL_STORAGE_KEY, (result) => {
  currentViewerBaseUrl = result[VIEWER_BASE_URL_STORAGE_KEY] || '';
  document.getElementById('viewerBaseUrl').value = currentViewerBaseUrl;
  refreshViewerUrlField();
});

document.getElementById('viewerBaseUrl').addEventListener('change', (e) => {
  currentViewerBaseUrl = e.target.value.trim();
  chrome.storage.local.set({ [VIEWER_BASE_URL_STORAGE_KEY]: currentViewerBaseUrl }, refreshViewerUrlField);
});
```
   Replace every existing `buildViewerUrl(peerId)` call with
   `buildViewerUrl(peerId, currentViewerBaseUrl)` and route them through
   `refreshViewerUrlField()` wherever peer id changes.
4. Manual verification (in the spike browser with the ported extension
   loaded — see Task 11): field persists across bridge reopens; Viewer URL
   field shows the hint text when base is empty.
5. `npx vitest run` — green.
6. Commit: `feat: bridge page viewer base URL field persisted to chrome.storage`

### Task 11: Reload ported extension in the spike browser

**Objective:** Swap the spike extension path to the ported code.

**Steps:**
1. **Present to Ben for approval** — update `~/.hermes/.env`
   `AGENT_BROWSER_ARGS` to point at `~/code/hermes-browserlink` instead of
   the spike path (same two flags, new path).
2. Restart browser session; re-run Task 3 discovery; record the NEW
   extension ID (it will change — unpacked extension IDs derive from path).
3. Re-run the Task 5 smoke against the ported code.
4. Commit any fixes needed: `fix: issues found during ported-extension smoke`

---

## Phase 2 — Exportable viewer client

### Task 12: Single-file viewer build (TDD)

**Files:**
- Create: `scripts/build-viewer.js`
- Test: `test/build-viewer.test.js`

**Step 1 — write `test/build-viewer.test.js`:**
```js
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'browserlink-viewer.html');

describe('build-viewer', () => {
  beforeAll(() => {
    execFileSync('node', [path.join(ROOT, 'scripts', 'build-viewer.js')], { stdio: 'pipe' });
  });

  it('produces the output file', () => {
    expect(fs.existsSync(OUT)).toBe(true);
  });

  it('contains no external script references', () => {
    expect(fs.readFileSync(OUT, 'utf8')).not.toMatch(/<script[^>]+\ssrc=/);
  });

  it('contains no external stylesheet links', () => {
    expect(fs.readFileSync(OUT, 'utf8')).not.toMatch(/<link[^>]+rel=["']stylesheet["']/);
  });

  it('inlines substantial JS (peerjs is large)', () => {
    expect(fs.readFileSync(OUT, 'utf8').length).toBeGreaterThan(100000);
  });

  it('contains no lobsterl.ink or other hardcoded viewer domain', () => {
    const html = fs.readFileSync(OUT, 'utf8');
    expect(html).not.toMatch(/lobsterl\.ink/i);
  });
});
```
(Match the import/require style of the existing test files.)

**Step 2 — run:** `npx vitest run test/build-viewer.test.js` — **Expected:
FAIL** (script missing).

**Step 3 — create `scripts/build-viewer.js`:**
```js
#!/usr/bin/env node
// Build a single self-contained BrowserLink viewer HTML file.
// Usage: node scripts/build-viewer.js
// Output: dist/browserlink-viewer.html
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'client', 'index.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'browserlink-viewer.html');

function inlineScripts(html, baseDir) {
  return html.replace(
    /<script\b[^>]*?\ssrc="([^"]+)"[^>]*>\s*<\/script>/g,
    (match, src) => {
      if (/^(https?:)?\/\//.test(src)) {
        throw new Error(`External script must be vendored before inlining: ${src}`);
      }
      const filePath = path.resolve(baseDir, src);
      const code = fs.readFileSync(filePath, 'utf8');
      return `<script>\n${code}\n</script>`;
    }
  );
}

function inlineStylesheets(html, baseDir) {
  return html.replace(
    /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
    (match, href) => {
      if (/^(https?:)?\/\//.test(href)) {
        throw new Error(`External stylesheet must be vendored before inlining: ${href}`);
      }
      const filePath = path.resolve(baseDir, href);
      const css = fs.readFileSync(filePath, 'utf8');
      return `<style>\n${css}\n</style>`;
    }
  );
}

function main() {
  let html = fs.readFileSync(ENTRY, 'utf8');
  html = inlineScripts(html, path.dirname(ENTRY));
  html = inlineStylesheets(html, path.dirname(ENTRY));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html);
  const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} (${kb} KB)`);
}

main();
```

**Step 4 — run:** `node scripts/build-viewer.js && npx vitest run test/build-viewer.test.js` — **Expected: PASS.** If `client/index.html`
has no external stylesheets, the stylesheet test still passes (vacuously) —
fine.

**Step 5 — commit:** `feat: single-file exportable viewer build`

**Note:** if `client/index.html` references `viewer/index.html` via a
redirect or anchor, the single file must BE the viewer entry — read
`client/README.md` and the two HTML files; if the real entry is
`client/viewer/index.html`, build from THAT file instead and note the
choice in the commit message. The test suite above is entry-agnostic.

### Task 13: Serve script + docs

**Files:**
- Create: `scripts/serve-viewer.sh`

**Contents:**
```bash
#!/usr/bin/env bash
# Serve the BrowserLink viewer on a local port, reachable over LAN/Tailscale.
# Usage: bash scripts/serve-viewer.sh [PORT]   (default 8787)
set -euo pipefail
PORT="${1:-8787}"
DIR="$(cd "$(dirname "$0")/../dist" && pwd)"
if [ ! -f "$DIR/browserlink-viewer.html" ]; then
  echo "dist/browserlink-viewer.html missing — run: node scripts/build-viewer.js" >&2
  exit 1
fi
echo "Serving BrowserLink viewer on http://0.0.0.0:${PORT}/browserlink-viewer.html"
exec python3 -m http.server "$PORT" --directory "$DIR"
```
- `chmod +x scripts/serve-viewer.sh`
- Verify: run `node scripts/build-viewer.js`, then the script in
  background, `curl -s http://127.0.0.1:8787/browserlink-viewer.html | head -c 200`
  shows HTML. Kill it.
- Commit: `feat: serve-viewer helper script`

### Task 14: End-to-end with the single-file viewer

**Steps:**
1. Build viewer, serve on 8787.
2. On the bridge, set Viewer Base URL to
   `http://127.0.0.1:8787/browserlink-viewer.html`, verify it persists.
3. Repeat the Task 5 smoke using the Viewer URL field's output.
4. **Expected:** identical behavior to the upstream-client smoke.
5. Update `docs/spikes/05-e2e.md` with a "ported re-run" section.
6. Commit: `test: e2e smoke against single-file viewer`

---

## Phase 3 — Hermes install flow

### Task 15: Write INSTALL.md

**Files:** Create `INSTALL.md`

**Required sections (adapt upstream `AGENT-INSTALL.md` — keep its review
checklist and evidence-list style, they're excellent):**
1. **What you are installing** — BrowserLink, unpacked MV3 extension, for
   Hermes-controlled Chromium.
2. **Suspicious-or-harmful review checklist** — port upstream's verbatim.
3. **Durable path** — `~/.hermes/browser-extensions/browserlink`
   (copy from this repo; never point flags at a git working tree).
4. **Hermes local-mode install** —
   `AGENT_BROWSER_ARGS` in `~/.hermes/.env` with
   `--load-extension=<durable-path> --disable-extensions-except=<durable-path>`;
   merge rules: preserve any existing flags; show-before-edit, get human
   approval (Hermes convention: never edit `.env` unapproved).
5. **Verification** — live Chromium command line; CDP `/json/list` as
   source of truth for the extension target + ID; bridge URL construction;
   `Preferences` file explicitly marked stale-prone fallback only.
6. **Viewer setup** — `node scripts/build-viewer.js`;
   `bash scripts/serve-viewer.sh`; set the bridge's Viewer Base URL to
   `http://<tailscale-hostname-or-LAN-IP>:8787/browserlink-viewer.html`;
   exporting `dist/browserlink-viewer.html` to any static host for
   off-LAN sharing; note the file works from any static server.
7. **CLI alternative** — `/browser connect` with a dedicated
   `--user-data-dir` + the same extension flags, with a **bold** warning
   that `/browser connect` does not work from gateway chats (Telegram etc).
8. **Skill patching** — replace `<RECORDED_BRIDGE_URL>` in the runtime
   skill copy, set `INSTALLED = true`, record extension ID + date.
9. **Required final answer** — port upstream's evidence list, swapping
   OpenClaw items for: `.env` lines added (approved by human y/n), flags
   merged-or-replaced, live-cmdline proof, CDP proof, extension ID, bridge
   URL, viewer base URL configured, skill path patched.
- Commit: `docs: Hermes INSTALL.md`

### Task 16: Rehearse INSTALL.md from clean state

**Steps:**
1. Remove the spike extension copy, reset `AGENT_BROWSER_ARGS` (with Ben's
   approval for the `.env` edit).
2. Follow INSTALL.md exactly as written, as if you know nothing.
3. Every place you hesitate or the doc is wrong → fix the doc immediately.
4. Commit: `docs: INSTALL.md corrections from clean rehearsal`

---

## Phase 4 — Hermes skill

### Task 17: Author the skill

**Files:** Create `hermes/browserlink-tab-share/SKILL.md`

**Skeleton (expand each section; port hard rules from upstream
`openclaw/lobsterlink-tab-share/SKILL.md`, swapping tool names):**
```markdown
---
name: browserlink-tab-share
description: Use when a human wants to share a logged-in tab from the Hermes-controlled browser so they can complete a blocked step (login, 2FA, CAPTCHA) through BrowserLink, or to stop sharing. Triggers: "share the X tab", "give me the viewer link", "use my logged-in tab", "stop sharing". Skip install if INSTALLED is true below.
---

# BrowserLink Tab Share

## Recorded Bridge URL
- `BRIDGE_URL = <RECORDED_BRIDGE_URL>` (patched at install time, e.g.
  `chrome-extension://<extension-id>/bridge.html`). If this placeholder is
  still here, the install did not finish — do INSTALL.md first.

## Installation Status
- `INSTALLED = false`
- Extension ID: <id>
- Install date: <YYYY-MM-DD>

## Hard Rules
- The bridge page is the source of truth for peer ID and viewer URL. Never
  scrape IDs from host-tab overlays.
- After Start Host, the hosted tab MUST stay the active tab in its window.
  Bridge focus indicator must read `Active` before returning the link.
  Black viewer → refocus the hosted tab FIRST.
- Verify bridge state before claiming success. Return concrete evidence.
- The Viewer URL field is only valid when a Viewer Base URL is configured
  on the bridge. If it shows the set-base-URL hint, configure it (serve
  flow below) before proceeding.

## Quick Flow
1. Confirm the extension is loaded (CDP /json/list shows the extension
   target) — NOT the human's personal browser.
2. Open BRIDGE_URL. (Spike 4 determined whether Hermes `browser_navigate`
   handles `chrome-extension://` or CDP target creation is required —
   record the working method here at install time.)
3. Stop any old host. Select the requested tab. Start Host.
4. Read `Current Peer ID` and `Viewer URL` from the bridge fields. Reopen
   BRIDGE_URL if Start Host backgrounded it — state persists.
5. Ensure the viewer is being served: `curl -sf http://127.0.0.1:8787/browserlink-viewer.html`
   — if down, run `bash <repo>/scripts/serve-viewer.sh` in the background
   first (build first if `dist/` is missing).
6. Verify: bridge says Hosting, peer ID populated, captured tab matches,
   focus indicator `Active`.
7. Return the Viewer URL to the human.

## To stop sharing
Click Stop Host on the bridge; verify hosting is false. Leave the viewer
server running or stop it — say which you did.

## Verification checklist
(extension loaded / target tab exists / bridge opened / host started /
hosted tab Active / viewer serving / link built from configured base)
```
- Commit: `feat: browserlink-tab-share Hermes skill`

### Task 18: Install skill + live acceptance test

**Steps:**
1. Copy `hermes/browserlink-tab-share/` into `~/.hermes/skills/browserlink-tab-share/`.
2. Patch the RUNTIME copy: real `BRIDGE_URL`, `INSTALLED = true`, ID, date.
3. **Acceptance test (the real one):** from a fresh Telegram session, ask
   Cadence to "share the <site> tab". Cadence must produce a working
   Viewer URL with zero install rediscovery. Open the link from a second
   device, complete a dummy interaction, confirm control, ask Cadence to
   stop sharing.
4. Record the transcript + evidence to `docs/acceptance/01-telegram-e2e.md`.
5. Commit: `test: telegram end-to-end acceptance`

---

## Phase 5 — Docs + hygiene

### Task 19: README.md

**Files:** Create `README.md` (repo root)

**Outline:** problem framing (port upstream's — agent hits login wall, bad
usual options, BrowserLink hosts one tab over WebRTC) → "Is this for you"
(Hermes users) → quickstart ("Tell your Hermes agent: install BrowserLink
by following INSTALL.md in this repo...") → what the human sees →
architecture diagram → **The viewer is yours** section (exportable single
file, configurable base URL, no dependency on any domain we don't own) →
**Third-party touchpoints** section (PeerJS cloud = signaling only, media
is P2P; STUN-only, no TURN → some NATs fail; self-host PeerServer escape
hatch) → development (`npm ci`, `npx vitest run`, `npm run build:viewer`).
- Commit: `docs: README for Hermes audience`

### Task 20: package.json

**Replace scripts section:**
```json
{
  "name": "browserlink",
  "private": true,
  "scripts": {
    "build:viewer": "node scripts/build-viewer.js",
    "serve:viewer": "bash scripts/serve-viewer.sh",
    "dev": "npm run dev:client",
    "dev:client": "serve client --listen ${PORT:-4173}",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "devDependencies": {
    "serve": "^14.2.3",
    "vitest": "^1.6.0"
  }
}
```
- Commit: `chore: package.json rename + viewer scripts`

### Task 21: scripts/ cleanup

Review upstream `scripts/` (dev-runtime.js, log-server.js, stamp-version.js,
watch-version.js). Keep `build-viewer.js` + `serve-viewer.sh`. Delete
stamp/watch-version (semver reset makes them dead weight). Keep or delete
dev-runtime/log-server based on whether the README dev loop references
them (default: delete; the smoke flow in this plan doesn't need them).
- Commit: `chore: prune unused upstream scripts`

### Task 22: Final gate

1. `npx vitest run` — all green.
2. `grep -rniE "lobsterlink|lobsterl\.ink|openclaw" --include='*.js' --include='*.html' --include='*.json' --include='*.md' . | grep -v node_modules | grep -v package-lock` — remaining hits only in
   `docs/plans/` + `docs/spikes/` (historical record) and the upstream
   attribution line in README.
3. Add upstream attribution to README: "BrowserLink is a Hermes port of
   [LobsterLink](https://github.com/davidguttman/lobsterlink) by
   David Guttman."
4. Fresh-machine rehearsal already done (Task 16) — confirm no doc drift.
5. Commit: `docs: upstream attribution`
6. Push `feat/initial-port`, open PR, request review.

---

## Definition of done

- [ ] All spikes documented in `docs/spikes/`
- [ ] `npx vitest run` green
- [ ] No `lobsterl.ink` / hardcoded viewer domain in shipped code
- [ ] `dist/browserlink-viewer.html` builds from one command, works from any
      static server
- [ ] INSTALL.md rehearsed from clean state
- [ ] Runtime skill patched and Telegram acceptance test passed
- [ ] README with upstream attribution
