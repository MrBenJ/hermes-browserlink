# BrowserLink — Agent Install Instructions

These instructions are written for an agent to follow. A human is pointing
you at this file because they want BrowserLink installed in the
Hermes-controlled browser you drive.

Do the work, do not just describe it. Verify with evidence, do not assume.

---

## 1. What you are installing

BrowserLink is an **unpacked MV3 Chrome extension** that lets the browser
you control host a tab over WebRTC, so a human can open a link, complete one
blocked step (login, 2FA, CAPTCHA), and leave — without ever handing you
their credentials.

> **⚠️ Scope of the share.** The viewer is not limited to the hosted tab. It
> ships with a tab switcher, and the host answers tab-list and tab-switch
> requests, so whoever holds a Viewer URL can enumerate and switch to any
> other **web** tab in this browser profile (only public `http:`/`https:`
> hosts are capturable; browser-internal, extension, `file://` and
> loopback/LAN/link-local tabs are excluded).
> Treat a Viewer URL as a bearer capability over this browser profile's web
> tabs. Tell the human that before they share one,
> and prefer a browser profile that holds only the accounts relevant to the
> task.

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

Durable path: `~/.hermes/browser-extensions/browserlink` (if Hermes uses a
different home, e.g. `$HERMES_HOME`, put it under that home instead).

Use that path, written out as an absolute path, in every flag below. Re-run this `rsync` after
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

An annotated, ready-to-fill block ships at
[`hermes/browserlink.env.example`](./hermes/browserlink.env.example). It
explains every line; read it before editing the human's `.env`. The core
lines are:

```
AGENT_BROWSER_HEADED=true
AGENT_BROWSER_ARGS=--load-extension=/ABSOLUTE/PATH/TO/HERMES_HOME/browser-extensions/browserlink,--disable-extensions-except=/ABSOLUTE/PATH/TO/HERMES_HOME/browser-extensions/browserlink,--disable-backgrounding-occluded-windows
```

`--disable-backgrounding-occluded-windows` keeps frames flowing when the
browser window is hidden or covered, at the cost of extra CPU/GPU while
hidden. It is recommended, not required.

Use the **absolute** path — `$HOME` and `~` are not expanded inside
`.env` values. To print the block with your path filled in (works on macOS
and Linux; it only prints, it edits nothing):

```bash
H="${HERMES_HOME:-$HOME/.hermes}"
sed "s#/ABSOLUTE/PATH/TO/HERMES_HOME#$H#g" hermes/browserlink.env.example
```

**Separator:** `AGENT_BROWSER_ARGS` is **comma- or newline-separated**
(Hermes `website/docs/reference/environment-variables.md:151`). Not
space-separated, and no quotes.

`.env` is read once when Hermes starts, so a change needs a **full Hermes
restart**. Rollback is restoring the backup of `.env` (or deleting the
BrowserLink block) and restarting again.

### 4.3 Merge rules — never blind-replace

Hermes hands `AGENT_BROWSER_ARGS` straight to agent-browser, which splits
it on **every comma and newline** (agent-browser README, `--args`). A
value like `--load-extension=/a,/b` therefore turns into two arguments,
`--load-extension=/a` and a stray `/b`. Chromium's own comma-separated
path list **cannot be expressed inside `AGENT_BROWSER_ARGS`.**

- **`AGENT_BROWSER_ARGS` absent** (the tested, primary path): add the
  block from §4.2 as-is.
- **`AGENT_BROWSER_ARGS` exists, but it has no `--load-extension=` or
  `--disable-extensions-except=`:** preserve every existing flag and
  append BrowserLink's flags to the comma-separated list.
- **The human already loads other extensions** (an existing
  `--load-extension=` or `--disable-extensions-except=` in
  `AGENT_BROWSER_ARGS`, or extensions in an `agent-browser.json` config):
  do **not** merge BrowserLink's path into those flags, and do **not** add
  a second copy of either flag. Chromium takes the last occurrence, and
  `--disable-extensions-except=<browserlink>` would switch off the
  human's other extensions. Instead, leave their extension flags alone
  and load BrowserLink through agent-browser's own extension option:

  ```
  AGENT_BROWSER_EXTENSIONS=/ABSOLUTE/PATH/TO/HERMES_HOME/browser-extensions/browserlink
  ```

  agent-browser documents `--extension <path>` as repeatable, with
  `AGENT_BROWSER_EXTENSIONS` as its env form. Its bundled command
  reference (`skill-data/core/references/commands.md`, v0.36) gives the
  separator as **comma-separated paths**, e.g. `/ext1,/ext2`. Extensions
  from user and project `agent-browser.json` configs are concatenated.
  **Unverified:** this route has not been tested with BrowserLink under
  Hermes. That covers whether Hermes forwards this variable and how
  agent-browser combines it with a `--load-extension=` you already have
  in `--args`. Treat it as a fallback, and prove it with §5.2: every
  expected extension, BrowserLink included, must appear in CDP. If one
  of them is missing, stop and report it rather than editing more
  flags.
- **Sandbox flags.** On root, Docker and AppArmor hosts, Hermes normally
  adds `--no-sandbox,--disable-dev-shm-usage` itself
  (`_apply_chromium_sandbox_args`). Setting `AGENT_BROWSER_ARGS` turns
  that off. On those hosts, include both flags in `AGENT_BROWSER_ARGS`
  yourself, or the browser will fail to start. A normal macOS user
  account never gets the injection, so on macOS this costs nothing.
- **Engine.** BrowserLink needs the default Chrome engine. Under the
  Lightpanda engine (`AGENT_BROWSER_ENGINE=lightpanda`), these variables
  are stripped, so the extension does not load.

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

**Do not just take the first `chrome-extension://` target.** Chrome ships
its own component extensions, which also appear as `chrome-extension://`
service-worker targets (Chrome for Testing 151 shows Gemini in Chrome,
`admccjkmockfdflocgggjfgdacdodkdf`, and `nkeimhogjdpnpccoofpliimaahmaaome`).
Identify BrowserLink by its **known ID**, then confirm it by **manifest
name**.

1. **Predict the ID.** An unpacked extension's ID is the first 32 hex
   characters of the SHA-256 of its absolute load path, with `0-f` mapped to
   `a-p`. Use the exact path from `--load-extension`:

   ```bash
   EXT_PATH="$HOME/.hermes/browser-extensions/browserlink"   # as passed to --load-extension
   EXPECTED_ID=$(printf '%s' "$EXT_PATH" | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p')
   echo "$EXPECTED_ID"
   ```

2. **Find that ID in CDP.** Exactly one service worker must match:

   ```bash
   curl -s http://127.0.0.1:<PORT>/json/list \
     | grep -o "\"url\": *\"chrome-extension://$EXPECTED_ID/[^\"]*\""
   ```

   Expected: `"url": "chrome-extension://<EXPECTED_ID>/background.js"`.

3. **Confirm the manifest name.** Open the bridge as a new target and check
   its title:

   ```bash
   curl -s -X PUT "http://127.0.0.1:<PORT>/json/new?chrome-extension://$EXPECTED_ID/bridge.html" \
     | grep '"title"'
   ```

   Expected: `"title": "BrowserLink Bridge"` (the page title can take a
   moment; re-read `/json/list` if it still shows the URL). The manifest name
   is `BrowserLink`. A different title, or a `chrome-error://` URL, means
   that ID is not BrowserLink.

**If no target matches the predicted ID, the install has failed.** Do not
fall back to another `chrome-extension://` ID, and do not patch the skill.
Check that `EXT_PATH` is byte-for-byte the path in `--load-extension` (no
trailing slash, no `~`, no symlinked alternative), then re-check §4.1
(headed mode).

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
reopens and browser restarts. The shareable Viewer URL is built from it;
until it is set, the bridge shows *"Set Viewer Base URL to get a shareable
link"* rather than emitting a dead link.

> **Set it again after any install-path change.** `chrome.storage.local` is
> per extension ID, and an unpacked extension's ID is derived from its load
> path (§5.2). Moving or renaming the durable path, or loading a second copy,
> gives a new ID with an **empty** Viewer Base URL — and a new bridge URL, so
> re-run §5.2–§5.3 and §8 too.

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
   Hermes' `skills/` directory may be organized into category
   subdirectories (e.g. `devops/`, `github/`, …); place the skill
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
