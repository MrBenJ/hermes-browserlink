# BrowserLink — Agent Install Instructions

These instructions are written for an agent to follow. A human is pointing
you at this file because they want BrowserLink installed in the
Hermes-controlled browser you drive.

Do the work, do not just describe it. Verify with evidence, do not assume.

---

## 1. What you are installing

BrowserLink is an **unpacked MV3 Chrome extension** that lets the browser
you control host a single tab over WebRTC, so a human can open a link,
complete one blocked step (login, 2FA, CAPTCHA), and leave — without ever
handing you their credentials.

After install you will have a bridge page at
`chrome-extension://<extension-id>/bridge.html` with a step-by-step UI for
hosting tabs. That page is the source of truth for peer ID and viewer URL.

**Source:** this repository (`MrBenJ/hermes-browserlink`). BrowserLink is a
port of [LobsterLink](https://github.com/davidguttman/lobsterlink) by David
Guttman.

## 2. Suspicious-or-harmful review checklist

Review the extension before installing it.

Expected or possibly legitimate items:

- Chrome extension permissions for `tabs`, `debugger`, or `scripting`
- `<all_urls>` when needed for viewer or bridge behavior
- WebRTC, viewer, or bridge functionality
- localhost-only optional diagnostic logging

Suspicious items:

- native binaries
- shell execution or process spawning (`child_process`, `spawn`, `exec`)
- remote code fetch plus `eval` / dynamic code execution
- credential dumping or exfiltration
- non-local debug log exfiltration
- install-time scripts outside the normal browser-extension flow

If the extension looks suspicious, **stop and report the exact concern
instead of installing it.**

## 3. Durable install path

Never point long-lived browser config at a git working tree — a checkout,
branch switch, or `git clean` will silently break the browser's extension
load.

```bash
mkdir -p ~/.hermes/browser-extensions
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
  --exclude 'docs' --exclude 'test' \
  <path-to-this-repo>/ ~/.hermes/browser-extensions/browserlink/
```

Durable path: `~/.hermes/browser-extensions/browserlink`

Use that absolute path in every flag below. Re-run this `rsync` after
pulling repo updates, then restart the browser.

## 4. Hermes local-mode install

### 4.1 ⚠️ First: the browser must be headed

Hermes' local browser mode launches Chromium **headless by default**
(`tools/browser_tool.py:2384`), and agent-browser may resolve Chromium to
Playwright's `chromium_headless_shell` build.

**MV3 extensions do not load in headless-shell**, and require
`--headless=new` or a headed browser. So BrowserLink needs headed mode.

Set in `~/.hermes/.env`:

```
AGENT_BROWSER_HEADED=true
```

This reaches the same code path as `config.browser.headed`
(`tools/browser_tool.py:892-916`) **without editing `config.yaml`**. Prefer
the env var for exactly that reason.

> If the extension still does not appear in CDP `/json/list` after this,
> headless mode is the first thing to re-check — it is the most likely
> failure cause, not a misconfigured path.

### 4.2 The extension flags

Add to `~/.hermes/.env`:

```
AGENT_BROWSER_ARGS=--load-extension=/Users/<you>/.hermes/browser-extensions/browserlink,--disable-extensions-except=/Users/<you>/.hermes/browser-extensions/browserlink
```

Use the **absolute** path — `$HOME` and `~` are not expanded inside
`.env` values.

**Separator:** `AGENT_BROWSER_ARGS` is **comma- or newline-separated**
(Hermes `website/docs/reference/environment-variables.md:151`). Not
space-separated.

### 4.3 Merge rules — never blind-replace

- If `AGENT_BROWSER_ARGS` is **absent**, add the line above as-is.
- If it **already exists**, preserve every existing flag and append
  BrowserLink's two flags to the comma-separated list.
- If a `--load-extension=` or `--disable-extensions-except=` flag already
  exists, do **not** add a second copy of that flag. Chromium takes the
  last occurrence. Merge BrowserLink's path into the existing flag's own
  comma-separated **path list**:
  `--load-extension=/existing/one,/Users/<you>/.hermes/browser-extensions/browserlink`
- Setting `AGENT_BROWSER_ARGS` **disables** Hermes' auto-injection of
  `--no-sandbox,--disable-dev-shm-usage`
  (`tools/browser_tool.py:2447-2461`). That injection is gated on
  root/Docker/AppArmor and does not fire on a normal macOS user account, so
  on macOS this costs nothing. **On Linux/Docker, re-add those two flags
  manually** or the browser will fail to start.

### 4.4 Human approval is required

**Never edit `~/.hermes/.env` without showing the human the exact
before/after lines and getting explicit approval.** Present, ask, wait.
This is a Hermes convention, not a suggestion.

Record what was there before, verbatim, even if the answer is "the key was
absent".

## 5. Verification — evidence, not assumption

Use the right source for each question:

| Question | Source of truth |
|---|---|
| What flags did the browser actually launch with? | the **live Chromium command line** |
| Is the extension actually loaded, and what is its ID? | **CDP `/json/list`** |
| What did we intend? | `~/.hermes/.env` |
| Historical installs | profile `Preferences` — **stale-prone, fallback only** |

If CDP and `Preferences` disagree, **trust CDP.**

### 5.1 Restart the browser session, then check the live command line

```bash
ps aux | grep -i chrom | grep -v grep
```

Confirm the line contains both `--load-extension=` and
`--disable-extensions-except=` with the durable path, and note whether it
shows `--headless`, `--headless=new`, or no headless flag at all.

### 5.2 Confirm the extension loaded, via CDP

Find the debug port from the `ps` output (`--remote-debugging-port=`). If
there is no port, agent-browser may be pipe-only; try:

```bash
lsof -a -p <chromium-pid> -i TCP -P | grep LISTEN
```

Then:

```bash
curl -s http://127.0.0.1:<PORT>/json/list
```

Look for a target whose `url` starts with `chrome-extension://`. The 32-char
path component is the **extension ID**.

**If no `chrome-extension://` target exists, the install has failed.** Do
not proceed and do not patch the skill. Re-check §4.1 (headed mode) first.

Unpacked extension IDs are derived from the install path, so the ID changes
if the path changes. Never hardcode an ID from a different machine or a
previous install.

### 5.3 Record the bridge URL

```
chrome-extension://<EXTENSION_ID>/bridge.html
```

### 5.4 If multiple BrowserLink installs appear

- prefer the one whose path matches the configured durable path
- require a live CDP target for the one you choose
- do not select a stale `Preferences` entry just because it exists
- report stale installs; cleanup is optional and separate

## 6. Viewer setup

The viewer is a single self-contained HTML file. It depends on no domain
anyone else owns.

```bash
node scripts/build-viewer.js      # -> dist/browserlink-viewer.html
bash scripts/serve-viewer.sh      # serves it on 0.0.0.0:8787
```

Then open the bridge page and set **Viewer Base URL** to an address
reachable from the *human's* device:

```
http://<tailscale-hostname-or-LAN-IP>:8787/browserlink-viewer.html
```

Find the address with `tailscale ip -4`, the MagicDNS name, or
`ipconfig getifaddr en0`.

The value is saved to `chrome.storage.local` and persists across bridge
reopens. The shareable Viewer URL is built from it; until it is set, the
bridge shows *"Set Viewer Base URL to get a shareable link"* rather than
emitting a dead link.

> **Loopback rule.** `127.0.0.1` and `localhost` base URLs are for
> **same-machine smoke tests only**. A loopback link handed to a human on
> another device resolves on *their* machine and is dead. Any link you
> return to a human must use an address reachable from their device.

For off-LAN sharing, `dist/browserlink-viewer.html` can be uploaded to any
static host (GitHub Pages, S3, Netlify) and the Viewer Base URL pointed at
that instead. The file works from any static server.

## 7. CLI alternative — `/browser connect`

Instead of Hermes' managed browser you can attach to your own Chromium
launched with a dedicated profile and the same two flags:

```bash
chromium \
  --user-data-dir=/tmp/browserlink-profile \
  --remote-debugging-port=9222 \
  --load-extension=$HOME/.hermes/browser-extensions/browserlink \
  --disable-extensions-except=$HOME/.hermes/browser-extensions/browserlink
```

> **⚠️ `/browser connect` does not work from gateway chats (Telegram,
> Discord, etc).** It is an interactive terminal-session feature. If the
> human is talking to you through a gateway, this path is unavailable —
> use the `AGENT_BROWSER_ARGS` route in §4.

## 8. Patch the runtime skill

The skill ships with placeholders. Patch the **runtime copy** — the one the
Hermes runtime actually loads — not just the repo copy.

1. Copy `hermes/browserlink-tab-share/` to the runtime skills location.
   On this machine `~/.hermes/skills/` is organized into category
   subdirectories (`apple/`, `devops/`, `github/`, …); place the skill
   where the runtime will actually discover it, and **verify** discovery
   rather than assuming a path.
2. In that runtime copy set:
   - `BRIDGE_URL` = the real bridge URL from §5.3
   - `INSTALLED = true`
   - the extension ID and today's date
   - the method that worked for opening `chrome-extension://` pages
     (Hermes `browser_navigate`, or CDP target creation)
3. If you cannot determine the runtime skill location, **stop and report
   that blocker instead of guessing.**
4. Do not leave any placeholder unresolved.

## 9. Required final answer

Setup is complete only after post-restart verification passes. Your final
answer must include:

- the durable extension path used
- the **exact `~/.hermes/.env` lines before and after**, verbatim
- whether the human explicitly approved that `.env` edit (**y/n**)
- whether `AGENT_BROWSER_ARGS` was **merged into an existing value or added
  fresh**
- whether `AGENT_BROWSER_HEADED` was set, and what the browser's headless
  state actually was
- whether the browser was restarted
- **proof from the live Chromium command line** (paste it)
- **proof from CDP `/json/list`** (paste the extension target)
- the chosen extension ID, and if duplicates existed, why that one
- the full bridge URL
- the Viewer Base URL configured, and confirmation it is **not** loopback
  if the human is on another device
- the exact runtime skill file path patched

If any of these is missing, the install is not finished.
