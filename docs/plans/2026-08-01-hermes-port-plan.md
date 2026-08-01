# Hermes BrowserLink — Port Plan (Discussion Draft)

> Status: DRAFT for discussion with Ben. Once the open decisions below are
> locked, this gets expanded into a granular implementer plan (bite-sized
> tasks, exact files, TDD steps) for the coding model.

**Goal:** Port LobsterLink (Chrome extension that hosts an agent's browser tab
over WebRTC so a human can complete blocked steps like logins/CAPTCHAs) into
`hermes-browserlink`, rebranded as **BrowserLink**, installable and drivable by
Hermes Agent instead of OpenClaw.

**Source of truth:** fresh upstream clone at
`~/code/forks/lobsterlink-upstream` (HEAD `4bb37de`, verified identical to the
older fork checkout — do not use `~/code/forks/lobsterlink`).

---

## 1. How LobsterLink works (architecture)

```text
Agent browser (Host)                        Human (Viewer)
┌──────────────────────────────┐           ┌────────────────────────┐
│ background.js (MV3 svc wrkr) │           │ lobsterl.ink static    │
│  chrome.debugger attach      │           │ page (client/)         │
│  CDP Page.startScreencast ── │──frames──▶│                        │
│  CDP Input.dispatch* ◀────── │◀─input─── │ mouse/kbd/nav          │
│ offscreen.js (offscreen doc) │           │                        │
│  canvas ← JPEG frames        │           │                        │
│  canvas.captureStream()      │──WebRTC──▶│ video render           │
│  PeerJS peer (media+data)    │◀──WebRTC──│ PeerJS peer            │
│ bridge.html/js (agent UI)    │           │                        │
│ host-agent.js (injected into │           │                        │
│  hosted page: cursor overlay,│           │                        │
│  viewport, pw-mgr suppress)  │           │                        │
└──────────────────────────────┘           └────────────────────────┘
```

- **WebRTC transport:** PeerJS with default cloud broker (`new Peer()`, no
  config) in `offscreen.js:127` and `client/viewer.js:123`.
- **Video path:** CDP screencast JPEG frames → drawn to canvas in offscreen
  doc → `captureStream()` → PeerJS media call. (MV3 service workers can't do
  WebRTC, hence the offscreen document.)
- **Input path:** viewer → PeerJS data channel → background.js →
  `chrome.debugger` `Input.dispatch*`.
- **Agent control surface:** `bridge.html` — a normal extension page with
  numbered agent steps: pick tab → Start Host → read `Current Peer ID` /
  `Viewer URL` fields → keep hosted tab ACTIVE (screencast stalls on
  backgrounded tabs → black viewer).
- **Viewer URL:** single constant in `lib/bridge-utils.js` `buildViewerUrl()`
  → `https://lobsterl.ink/#host=<peerId>`. Static viewer site is `client/`
  (no build step).

### Critical finding: the extension code is runtime-agnostic

OpenClaw coupling exists **only** in:
- `AGENT-INSTALL.md` (OpenClaw config patching, `browser.extraArgs`,
  `~/.openclaw/...` paths)
- `openclaw/lobsterlink-tab-share/SKILL.md` (OpenClaw `browser` tool,
  `profile="openclaw"`)
- `README.md` (audience/positioning)
- `docs/plans/` (upstream working notes — drop from the port)

None of `background.js`, `bridge.js`, `offscreen.js`, `host-agent.js`,
`client/` contain OpenClaw references. The port is therefore:
**copy extension code + rebrand + repoint viewer URL + rewrite install flow
and agent skill for Hermes.** No protocol rewrites.

## 2. Hermes target environment (verified from live docs)

Hermes browser toolset modes (docs/user-guide/features/browser):

- **Local mode** via `agent-browser` CLI (npm) driving a local Chromium.
  Extra launch flags via env `AGENT_BROWSER_ARGS` (comma/newline separated).
  Works from **any surface including the Telegram gateway** — this matters,
  Ben talks to Cadence over Telegram.
- **CDP attach mode** via `/browser connect` — auto-launches or attaches to
  Chrome/Brave/Chromium/Edge at `http://127.0.0.1:9222` with a dedicated
  `--user-data-dir`. **Caveat: `/browser connect` is CLI-only — it is NOT
  dispatched from gateway chats (Telegram/Discord/etc).**
- Cloud modes (Browserbase / Browser Use / Firecrawl) and Camofox (Firefox)
  are **out of scope** — no extension loading, no chrome.debugger.

Recommended topology: **local `agent-browser` mode with
`AGENT_BROWSER_ARGS="--load-extension=<durable-path> --disable-extensions-except=<durable-path>"`**
so tab-sharing works from Telegram. CDP-connect mode documented as the
alternative for CLI sessions / debugging.

## 3. Work breakdown (phases → expand into granular tasks after decisions)

### Phase 0 — Environment verification spikes (do FIRST, gates everything)
Each spike produces evidence (command output), not assumptions.

1. Install/inspect `agent-browser` (`npm i -g agent-browser`, `--help`,
   find how it launches Chromium: headless? which binary? CDP via port or
   pipe?).
2. Verify `AGENT_BROWSER_ARGS` pass-through: launch with
   `--load-extension=<upstream-lobsterlink-path>`, inspect live Chromium
   command line (`ps`), confirm flags present.
3. Verify extension loads: CDP `/json/list` shows extension service worker
   target; record extension ID. If headless: confirm `--headless=new`
   extension support; if old headless blocks extensions, find agent-browser
   headed flag or escalate to Ben for topology decision.
4. Verify Hermes `browser_navigate` can open
   `chrome-extension://<id>/bridge.html`. If blocked, verify fallback:
   CDP target creation (`/json/new?<url>`) — requires knowing the debug
   port in agent-browser mode (discover from process args).
5. End-to-end smoke: start host on a test tab via bridge, connect with
   `client/` viewer locally (`npm run dev:client`), confirm frames flow and
   input works; confirm black-frame/focus behavior in this topology.

### Phase 1 — Vendor + rebrand
6. Copy extension sources from `lobsterlink-upstream` into
   `hermes-browserlink` (exclude `.git`, `openclaw/`, `docs/plans/`,
   `AGENT-INSTALL.md`, `README.md` — those get rewritten).
7. Rebrand: `manifest.json` (name `BrowserLink`, description, reset version
   to `1.0.0`), log prefixes `[LOBSTERLINK:*]` → `[BROWSERLINK:*]`,
   UI text in `bridge.html`/`popup.html`/`client/index.html`.
8. Repoint viewer URL constant in `lib/bridge-utils.js` + text in
   `bridge.html` + tests (depends on Decision D1).
9. Update `test/bridge-utils.test.js` expectations; run `vitest run` — all
   green before proceeding.

### Phase 2 — Viewer hosting (Decision D1)
10. If self-hosting: wire `client/` to GitHub Pages on
    `mrbenj/hermes-browserlink` (static, no build; `client/README.md`
    already documents this shape). Update viewer URL constant to the Pages
    URL. Verify the deployed viewer loads and connects.

### Phase 3 — Hermes install flow (replaces AGENT-INSTALL.md)
11. Write `INSTALL.md` for Hermes agents: suspicious-code review checklist
    (keep upstream's, it's good), durable path
    `~/.hermes/browser-extensions/browserlink`, `AGENT_BROWSER_ARGS` setup
    via `~/.hermes/.env` (note: env, not config.yaml), live-flag
    verification, extension-ID discovery via CDP `/json/list`, bridge URL
    construction, required final-answer evidence list (port upstream's —
    it's excellent).
12. Document the CDP-connect alternative for CLI use (`/browser connect`
    + dedicated `--user-data-dir` + extension flags), with the
    gateway-vs-CLI caveat in bold.

### Phase 4 — Hermes skill (replaces openclaw/ skill)
13. Author `hermes/browserlink-tab-share/SKILL.md` (Hermes skill format):
    triggers ("share the X tab", "give me the viewer link", "stop sharing"),
    Hermes tool flow (`browser_navigate` to bridge URL or CDP fallback),
    hosted-tab-active hard rule, bridge-fields-are-truth rule, verification
    checklist, stop-sharing flow. Include `INSTALLED`/`BRIDGE_URL`
    self-patching convention from upstream (it's a good pattern).
14. Install skill into `~/.hermes/skills/` and verify Cadence can execute
    the full flow from a Telegram message end-to-end. (This is the real
    acceptance test.)

### Phase 5 — Docs + hygiene
15. Rewrite `README.md` for the Hermes audience (keep upstream's excellent
    problem framing, swap runtime references).
16. `package.json`: rename, keep `vitest` + `serve` scripts.
17. Decide fate of `scripts/` (dev-runtime, log-server, stamp-version,
    watch-version) — keep what the dev loop needs, drop version-stamping if
    we reset to semver.
18. Final: full `vitest run`, fresh-machine install rehearsal following
    `INSTALL.md` exactly as written, from a clean Hermes session.

## 4. Open decisions for Ben

- **D1 — Viewer hosting:** self-host `client/` via GitHub Pages on
  `mrbenj/hermes-browserlink` (RECOMMENDED — you own it, upstream domain
  can't break/change under you) vs keep pointing at `lobsterl.ink`
  (zero effort, but hard dependency on davidguttman's domain).
- **D2 — Topology:** agent-browser local mode (RECOMMENDED — works from
  Telegram) as primary, `/browser connect` as documented alternative.
  Contingent on Spike 1–3 results; if agent-browser can't load extensions,
  we revisit.
- **D3 — Branding:** "BrowserLink" (matches repo) OK? Any icon ambitions or
  ship plain?
- **D4 — PeerJS broker:** keep default PeerJS cloud (RECOMMENDED for v1)
  vs self-host a peer server (YAGNI unless reliability demands it).

## 5. Risks

- **R1:** agent-browser may launch old-headless Chromium (no MV3 extension
  support) or not pass `AGENT_BROWSER_ARGS` through. → Phase 0 spikes
  exist precisely to catch this before any porting work.
- **R2:** Hermes browser tools may block `chrome-extension://` navigation.
  Fallback is CDP target creation, which needs a reachable CDP HTTP port in
  agent-browser mode — unverified. → Spike 4.
- **R3:** The "hosted tab must be active" constraint may behave differently
  headless (better or worse). Must be characterized, not assumed. → Spike 5.
- **R4:** PeerJS cloud is a third-party dependency in both directions;
  fine for v1, noted for the README.

## 6. Implementer recommendation

**Claude Opus 5** (via Claude Code on this machine), with Cadence doing an
independent verification pass after — matching our established PR pattern.

Rationale: ~70% of this job is disciplined environment verification with
branching fallbacks ("if blocked, prove X via CDP output, else Y") and
evidence-based reporting; ~30% is mechanical-but-precise rebranding across
~25 files without breaking a WebRTC/CDP pipeline. That profile rewards
Opus's caution and instruction-fidelity more than raw code-generation speed.
Value pick if cost matters: **Claude Fable 5**. Not GLM 5.2 (weakest
MV3/CDP arcana track record), not GPT 5.6 Sol (verification rigor), not
Kimi K3 (Cadence keeps context and reviews instead).
