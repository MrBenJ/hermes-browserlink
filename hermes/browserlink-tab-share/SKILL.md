---
name: browserlink-tab-share
description: Use when a human wants to share a logged-in tab from the Hermes-controlled browser so they can complete a blocked step (login, 2FA, CAPTCHA) through BrowserLink, or to stop sharing. Triggers - "share the X tab", "give me the viewer link", "use my logged-in tab", "stop sharing". Skip install if INSTALLED is true below.
---

# BrowserLink Tab Share

Use this when BrowserLink is already loaded in the Hermes-controlled
browser and the human wants to see or drive one authenticated tab.

If BrowserLink is not installed yet, follow `INSTALL.md` in the
`hermes-browserlink` repo first.

## Recorded Bridge URL

- `BRIDGE_URL = <RECORDED_BRIDGE_URL>`
- During install, replace `<RECORDED_BRIDGE_URL>` in the **runtime** copy of
  this skill with the full bridge URL, e.g.
  `chrome-extension://<extension-id>/bridge.html`.
- If this placeholder is still here, the install did not finish — do
  `INSTALL.md` first. Do not guess an extension ID: unpacked IDs derive
  from the install path and differ per machine.

## Installation Status

- `INSTALLED = false`
- Extension ID: `<id>`
- Install date: `<YYYY-MM-DD>`
- Bridge open method: `<browser_navigate | CDP target creation>`
- If `INSTALLED = true` and the bridge URL is resolved, skip the install
  flow entirely. Only reinstall if the extension is unloaded or the bridge
  URL is broken.

## Hard Rules

- **The bridge page is the source of truth** for peer ID and viewer URL.
  Read them from the bridge's `Current Peer ID` and `Viewer URL` fields.
  Never scrape IDs from an overlay on the hosted tab.
- **The hosted tab MUST stay the active tab in its window after Start
  Host.** This is required, not optional — CDP screencast stalls when the
  hosted tab is backgrounded and the viewer goes black. The bridge focus
  indicator must read `Active`, not `Needs Focus`, before you return the
  link. If the viewer is black, **refocus the hosted tab first** and only
  investigate other causes after the indicator reads `Active`.
- `Start Host` auto-focuses the hosted tab, which may background the
  bridge. That is expected — host state is persisted, so reopening
  `BRIDGE_URL` shows the current session with its fields still populated.
- **The Viewer URL field is only valid when a Viewer Base URL is
  configured.** If it shows *"Set Viewer Base URL to get a shareable
  link"*, configure it (§ Serving the viewer) before proceeding.
- **NEVER return a Viewer URL whose base is `127.0.0.1` or `localhost` to a
  human on another device.** It resolves on *their* machine and is dead.
  The base must be a LAN IP, Tailscale hostname/IP, or a static-host URL
  reachable from the human's device. Only exception: the human explicitly
  says they are opening the viewer on this same machine.
- **A Viewer URL grants more than the hosted tab.** The viewer has a tab
  switcher, and the host answers tab-list and tab-switch requests, so anyone
  holding the link can enumerate and switch to any other **normal** tab in
  this browser profile (`chrome://` and extension pages excluded). When you
  hand over a link, say so plainly — do not describe it as access to one
  tab. If the profile holds sensitive unrelated sessions, warn the human
  before sharing.
- Verify bridge state before claiming success. Return concrete evidence,
  not assumptions. A visible popup is not proof that hosting started.
- Prefer the bridge path, not the popup click path.

## Quick Flow

1. **Confirm the extension is loaded** in the Hermes-controlled browser —
   not the human's personal browser. CDP `/json/list` showing a
   `chrome-extension://` target is the proof.
2. **Open `BRIDGE_URL`** using the method recorded above. Some browser
   tools block `chrome-extension://` navigation; if Hermes
   `browser_navigate` refuses, create the bridge target through CDP
   instead, and record which one worked.
3. **Stop any old host**, then select the requested tab and **Start Host**.
4. **Read `Current Peer ID` and `Viewer URL`** from the bridge fields.
   Reopen `BRIDGE_URL` if Start Host backgrounded it — state persists.
5. **Ensure the viewer is being served:**
   ```bash
   curl -sf http://127.0.0.1:8787/browserlink-viewer.html >/dev/null
   ```
   If it fails, start it: `bash <repo>/scripts/serve-viewer.sh` in the
   background (run `node <repo>/scripts/build-viewer.js` first if `dist/`
   is missing).
   > This curl only proves the file is being served **locally**. It says
   > nothing about whether the human can reach the link.
6. **Check the configured Viewer Base URL before trusting the Viewer URL
   field.** If it is loopback and the human is on another device, STOP —
   reconfigure it to this machine's LAN IP or Tailscale address
   (`tailscale ip -4`, or the MagicDNS name), then re-read the field.
7. **Verify** before replying:
   - bridge says `Hosting`
   - peer ID is populated
   - captured tab matches what was asked for
   - capture mode is present
   - focus indicator reads `Active`
8. **Return the Viewer URL** to the human.

## To stop sharing

Click **Stop Host** on the bridge and verify hosting is now false. Leave
the viewer server running or stop it — either is fine, but **say which you
did.**

## Serving the viewer

```bash
node <repo>/scripts/build-viewer.js     # -> dist/browserlink-viewer.html
bash <repo>/scripts/serve-viewer.sh     # serves on 0.0.0.0:8787
```

Then set **Viewer Base URL** on the bridge to an address reachable from the
human's device, e.g.
`http://<tailscale-host-or-LAN-IP>:8787/browserlink-viewer.html`. It is
saved to `chrome.storage.local` and persists across bridge reopens.

## Verification checklist

Before replying, confirm every relevant item:

- [ ] extension loaded in the Hermes-controlled browser (CDP evidence)
- [ ] target tab exists and matches the request
- [ ] bridge page opened
- [ ] host started (or stopped) successfully
- [ ] hosted tab is active/frontmost — focus indicator reads `Active`
- [ ] viewer is being served
- [ ] Viewer Base URL is configured and is **not** loopback when the human
      is on another device
- [ ] link returned was read from the bridge's `Viewer URL` field

## Notes

- Some browser tools block `chrome-extension://` navigation. If that
  happens, create the bridge target through CDP instead.
- If the extension does not appear in CDP `/json/list` at all, check
  whether the browser is running **headless**. MV3 extensions do not load
  in Chromium's headless-shell build; Hermes needs
  `AGENT_BROWSER_HEADED=true`. See `INSTALL.md` § 4.1.
- Unpacked extension IDs derive from the install path. If the durable path
  moved, the ID changed and `BRIDGE_URL` above is stale.
