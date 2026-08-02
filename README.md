# BrowserLink

Let a human complete blocked steps inside an agent's browser, without
sharing credentials.

---

Your agent opens LinkedIn, hits a login wall, and stops. Or Twitter wants
2FA. Or Reddit throws a CAPTCHA. Or a bank site needs an identity check.
Every agent workflow eventually hits a step that requires a real human —
and the usual options are bad: hand over your password, stuff a cookie
file, or babysit the agent.

BrowserLink does something smaller than a remote desktop. The agent hosts a
tab over WebRTC and hands you a link:

```text
http://your-machine:8787/browserlink-viewer.html#host=abc123-long-uuid
```

You open it. You see the agent's tab, live, in any browser. You do the
step. You close the tab. The agent keeps the authenticated session and goes
back to work.

No credentials shared. No extension installed on your machine. No remote
desktop. Just the blocked step, then you're out.

One thing to be clear about up front: the link is scoped to the agent's
browser, not to a single tab. The viewer has a tab switcher, so whoever
holds the link can reach the other web tabs in that browser profile too —
see [What the link actually grants](#%EF%B8%8F-what-the-link-actually-grants).

## Is this for you

**Yes, if:**

- You run Hermes agents that need to browse authenticated sites you
  control.
- You've hit the "OK but how does it log in" wall and don't love the
  answers.
- Your agent controls its own browser and can load a Chrome extension.

**Not yet, if:**

- Your agent doesn't control its own browser. BrowserLink installs on the
  agent side, not yours.

## Quickstart

BrowserLink installs into the agent's browser, not yours. You don't install
anything locally.

Tell your Hermes agent:

```
Install BrowserLink by following INSTALL.md in this repo. Before installing,
check the files for anything suspicious or harmful. If you're not confident
it looks safe, stop and ask. When you're finished, give me a plain English
summary of what you did.
```

The agent follows it and reports back with an extension ID, the live
Chromium command line, and CDP proof of install.

Once installed, ask for things like *"share the LinkedIn tab"* or *"give me
the viewer link."* The bundled `browserlink-tab-share` skill handles the
rest.

## What you see when you click a link

You open the viewer link in a desktop browser — any browser, any OS. You
see the agent's tab rendering live, and your mouse and keyboard drive it.
You are **not** sharing your screen. The agent can't see your other tabs,
your desktop, or anything else on your machine. When you close the tab,
you're out.

### ⚠️ What the link actually grants

Be precise about this before you share one.

**On your machine:** nothing. The agent cannot see your desktop, your tabs,
or your files, and no credentials change hands.

**On the agent's machine:** more than the one hosted tab. The viewer ships
with a tab switcher, and the host answers tab-list and tab-switch requests
(`sendTabListToViewer` → `chrome.tabs.query({})`), so whoever holds the link
can enumerate and switch to any other **web** tab in that browser profile
— including unrelated logged-in sessions. Only `http:`/`https:` tabs are
capturable; browser-internal, extension, `file://` and other non-web schemes
are excluded, as are literal loopback, RFC1918/LAN, link-local and other
private hosts.

> **Limit of that check.** It matches on the hostname, not the resolved
> address, so it stops the direct cases (`127.0.0.1`, `192.168.x`,
> `169.254.169.254`, `router.local`) but **not** a public-looking domain
> that resolves to a private address — `127.0.0.1.nip.io` and friends get
> through. Treat it as defence in depth, not a guarantee. An extension
> cannot resolve DNS before navigating; a real boundary needs an explicit
> operator allowlist of reachable origins or a network-layer block. See
> `docs/final-report.md`.

So the Viewer URL is a bearer capability over the agent browser's normal
tabs, not a keyhole onto one of them. The host ID is a random 122-bit UUID,
so it isn't guessable — but it is shareable. **Treat the link like a
password, and only send it to someone you would trust with that whole
browser profile.**

If you want a genuine one-tab boundary, that is a change to the host's
control surface (constraining the tab list and rejecting `switchTab`), not a
documentation fix — see `docs/final-report.md`.

Mobile and tablet work for viewing, but keyboard handling is rough — the
on-screen keyboard doesn't reliably appear when you'd expect. Use a laptop
or desktop for anything involving typing.

---

## The viewer is yours

Upstream LobsterLink points every share link at a viewer hosted on a domain
its author owns. BrowserLink removes that dependency entirely.

- **`npm run build:viewer`** produces
  `dist/browserlink-viewer.html` — one self-contained file, ~147 KB, with
  PeerJS and all viewer logic inlined. No external scripts, no external
  stylesheets, no CDN.
- **The base URL is configuration, not a constant.** Set *Viewer Base URL*
  once on the bridge page; it persists in `chrome.storage.local` and every
  share link is built from it.
- **Serve it anywhere.** `npm run serve:viewer` for LAN/Tailscale, or
  upload the single file to GitHub Pages, S3, Netlify — anything that
  serves static files.

There is no domain in this project that you don't control.

> **Loopback rule.** `127.0.0.1` and `localhost` base URLs work only for
> same-machine testing. A link handed to a human on another device must use
> a LAN IP, Tailscale address, or public static host — otherwise it
> resolves on *their* machine and is dead.

## Third-party touchpoints

Worth knowing before you deploy this:

- **PeerJS cloud broker (signaling only).** By default, peers find each
  other through PeerJS' public broker. It carries **signaling only** — the
  session description and ICE candidates. **Media and input never touch
  it**; those go peer-to-peer over encrypted WebRTC. The broker does see
  that two peers connected, and when.
- **STUN only, no TURN.** There is no relay fallback. On restrictive NATs
  (symmetric NAT, some corporate or mobile networks) the peer connection
  will simply fail to establish rather than degrade.
- **Escape hatch:** run your own [PeerServer](https://github.com/peers/peerjs-server)
  and point the extension at it if you don't want to depend on the public
  broker.

---

## For agents

BrowserLink is an MV3 Chrome extension that hosts a browser tab over WebRTC
and exposes a bridge page for programmatic control.

### Architecture

```text
Agent browser (Host)                   Human (Viewer)
┌──────────────────────────┐          ┌──────────────────────────┐
│ CDP screencast           │          │ live video render        │
│ offscreen document       │──RTC───▶ │ control surface          │
│ chrome.debugger input    │ ◀─RTC─── │ mouse / keyboard / nav   │
│ chrome.tabs tab control  │ ◀─RTC─── │ tab + viewport commands  │
└──────────────────────────┘          └──────────────────────────┘
```

`background.js` (service worker) drives `chrome.debugger` screencast and
input dispatch → `offscreen.js` paints JPEG frames to a canvas and
`captureStream()`s them into PeerJS → `client/` renders and sends input
back. `bridge.html` is the agent's control surface.

### Usage

Open the bridge page: `chrome-extension://<extension-id>/bridge.html`.

The bridge is a regular HTML page in extension context, with a numbered
step list written for agents and live status indicators. Pick the target
tab, start hosting, read the peer ID and viewer URL from the bridge fields,
then keep the hosted tab active.

The bridge is **the source of truth** for the current host ID and viewer
URL. Host state is persisted by the background worker, so if the bridge
gets backgrounded you can reopen `bridge.html` and the `Current Peer ID`
and `Viewer URL` fields still show the active session. Never read the host
ID off a host-tab overlay.

### Installing

Full instructions: [`INSTALL.md`](./INSTALL.md).

### Hermes skill

Ships at [`hermes/browserlink-tab-share/SKILL.md`](./hermes/browserlink-tab-share/SKILL.md).
It opens the bridge, starts hosting, verifies state, re-focuses the hosted
tab, and returns the viewer link. Covers *"share the X tab"*, *"give me the
viewer link"*, *"use my logged-in tab"*, *"stop sharing"*.

### Gotchas

- **Black viewer → the hosted tab is not active.** CDP screencast only
  produces frames while the hosted tab is the active tab in its window. If
  the viewer is black, the first and only check is whether the hosted tab
  is frontmost — click **Show Hosted Tab** on the bridge. The focus
  indicator reports `Active` vs `Needs Focus`; treat anything but `Active`
  as a broken session.
- **Extension missing from CDP `/json/list` → check headless.** MV3
  extensions do not load in Chromium's headless-shell build, and Hermes
  launches headless by default. Set `AGENT_BROWSER_HEADED=true`. See
  [`INSTALL.md` § 4.1](./INSTALL.md).
- **Recovering the host ID after auto-focus.** `Start Host` brings the
  hosted tab to the front, which can background the bridge. Reopen
  `bridge.html`; state persists.
- **`chrome-extension://` navigation blocked.** Open the bridge through CDP
  target creation instead.
- **Share expiry is best-effort, not a hard cutoff.** The 15-minute
  countdown runs on an MV3 service-worker `setTimeout`. Chrome can suspend
  the worker while idle, and expiry is then re-enforced on the next wake.
  Any viewer message wakes it, so an interactive viewer is always cut off
  on time — but a viewer that sends nothing can keep receiving frames past
  `shareExpiresAt`. **Click Stop Host to actually end a share.** Closing
  this gap needs a durable scheduled wake-up, which means a new extension
  permission and reversing `test/no-alarms.test.js` — see
  `docs/final-report.md`.
- **Empty Viewer URL field.** The bridge shows *"Set Viewer Base URL to get
  a shareable link"* until a base URL is configured. That's not a bug — it
  is refusing to emit a dead link.

### Vendored assets

`lib/peerjs.min.js` and `client/lib/peerjs.min.js` are byte-identical
copies of the PeerJS build vendored by upstream LobsterLink at
`4bb37deb0e1292c8b53c3e702f7d97c6a241fcc3`; the same holds for the
`viewer-utils.js` pair. The minified bundle carries no version string, so
that upstream commit is the provenance to diff against — this port did not
re-vendor or upgrade them.

### Development

```bash
npm ci
npx vitest run          # unit tests
npm run build:viewer    # -> dist/browserlink-viewer.html
npm run serve:viewer    # serve it on :8787
```

`client/` is the standalone static viewer. `client/viewer/index.html` is
the viewer entrypoint and the input to the single-file build;
`client/index.html` is an optional landing page and is **not** part of the
portable artifact. `client/viewer.js` is shared by both the extension and
the hosted client.

---

## Credits

BrowserLink is a Hermes port of
[LobsterLink](https://github.com/davidguttman/lobsterlink) by David
Guttman.
