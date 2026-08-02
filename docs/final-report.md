# BrowserLink port — final report

**Branch:** `feat/initial-port` · **Date:** 2026-08-02
**Upstream:** `davidguttman/lobsterlink` @ `4bb37deb0e1292c8b53c3e702f7d97c6a241fcc3`

## Scope of this run

The run began by stopping cleanly at Phase 0: Hermes is not installed on
this MacBook Pro, so the environment spikes that "gate everything" could
not execute. Ben then scoped the session to **skip all end-to-end testing**
and complete the repo-local work here, testing E2E himself later.

So: **every task that does not need a live browser is done. Every task that
does is untouched and marked `PENDING-HUMAN`.**

Nothing outside this repo was modified. `~/.hermes/` was never written to
— on this machine it does not exist, and on the Mac Mini it was only read.

## Task status

| # | Task | Status |
|---|------|--------|
| 1–5 | Phase 0 environment spikes | ⏭️ **PENDING-HUMAN** — need a live Hermes browser. Partly superseded by spike 02 (below). |
| 6 | Vendor upstream @ `4bb37de` | ✅ |
| 7 | Rebrand manifest | ✅ |
| 8 | Rebrand all strings | ✅ |
| 9 | Configurable viewer base URL (TDD) | ✅ |
| 10 | Wire base URL into bridge page | ✅ (browser-persistence check pending) |
| 11 | Reload ported extension in spike browser | ⏭️ **PENDING-HUMAN** |
| 12 | Single-file viewer build (TDD) | ✅ |
| 13 | Serve script | ✅ |
| 14 | E2E with single-file viewer | ⏭️ **PENDING-HUMAN** |
| 15 | INSTALL.md | ✅ |
| 16 | Rehearse INSTALL.md from clean state | ⏭️ **PENDING-HUMAN** — needs `.env` edits + browser |
| 17 | Author the skill | ✅ |
| 18 | Install skill + Telegram acceptance | ⏭️ **PENDING-HUMAN** |
| 19 | README | ✅ |
| 20 | package.json | ✅ |
| 21 | scripts/ cleanup | ✅ |
| 22 | Final gate | ✅ (PR opened; review gauntlet not run) |

**13 of 22 complete, 9 pending a live browser.**

## Definition of done

| Item | Status |
|---|---|
| All spikes documented in `docs/spikes/` | ⚠️ Partial — spike 01 documents why 1–5 could not run; spike 02 answers what was answerable from source. Live spikes still owed. |
| `npx vitest run` green | ✅ **101 passed, 11 files** |
| No `lobsterl.ink` / hardcoded viewer domain in shipped code | ✅ |
| `dist/browserlink-viewer.html` builds from one command | ✅ 146.9 KB, verified served over HTTP 200 |
| INSTALL.md rehearsed from clean state | ❌ **PENDING-HUMAN** |
| Runtime skill patched + Telegram acceptance | ❌ **PENDING-HUMAN** |
| README with upstream attribution | ✅ |

## `~/.hermes/.env` — before / after

**No `.env` edits were made.** The pre-approval covered `AGENT_BROWSER_ARGS`
edits in Tasks 2, 11 and 16 — all three are E2E tasks, all three skipped.

- **This MacBook Pro:** `~/.hermes/` does not exist. Nothing to edit.
- **Mac Mini (`aria-mac-mini`):** read-only inspection only. Confirmed
  `AGENT_BROWSER_ARGS` is **absent** (`grep -c` → 0) and
  `~/.hermes/browser-extensions/` does not exist. **No values from `.env`
  were read, printed or stored** — only the presence of key names.

**Before (both machines):** `AGENT_BROWSER_ARGS` — *not set*.
**After:** unchanged, *not set*.

When Ben does install, INSTALL.md § 4.2–4.3 has the exact lines and merge
rules.

## Extension ID / bridge URL / viewer base URL

| Item | Value |
|---|---|
| Extension ID | ❌ **Not determined.** Unpacked IDs derive from the install path and can only be read from CDP `/json/list` after loading. Not guessable. |
| Bridge URL | ❌ **Not determined** — depends on the ID. Skill still holds `<RECORDED_BRIDGE_URL>`, `INSTALLED = false`. |
| Viewer base URL | ❌ **Not configured** — requires the bridge page in a live browser. |

## ⚠️ Top risk for the live test: headless mode

Reading Hermes' own source on the Mac Mini surfaced a likely blocker that
no amount of repo-local work can settle:

- Hermes launches Chromium **headless by default**
  (`tools/browser_tool.py:2384`), headed only when
  `config.browser.headed` / `AGENT_BROWSER_HEADED` is set
  (`browser_tool.py:892-916`).
- agent-browser may resolve Chromium to Playwright's
  `chromium_headless_shell` build (`browser_tool.py:4587-4630`).
- **MV3 extensions do not load in headless-shell.**

**Prediction: BrowserLink will need `AGENT_BROWSER_HEADED=true` in
`~/.hermes/.env`.** That env var reaches the same code path as
`config.browser.headed` **without touching the forbidden `config.yaml`**.

This is source-derived, **not observed**. It is the first thing to check if
the extension does not appear in CDP `/json/list`. Full detail:
[`spikes/02-hermes-browser-config.md`](./spikes/02-hermes-browser-config.md).

## Decisions made without you

1. **Branch `feat/initial-port`** — handoff said `feature/`, plan and
   endgame said `feat/`. Went with the execution document.
2. **Vendored from a fresh clone.** `~/code/forks/lobsterlink-upstream` did
   not exist; cloned upstream, whose `master` HEAD is byte-exactly the
   pinned `4bb37de`.
3. **`client/README.md` dropped.** The plan's unanchored `README.md` rsync
   exclude caught it too. Left excluded — it documents the LobsterLink
   public web client and is superseded by the new README.
4. **Repointed URLs the bulk rename would have corrupted.**
   `client/index.html`'s GitHub link and agent-install text became
   `davidguttman/browserlink` (nonexistent) under a blind rename; pointed
   them at `MrBenJ/hermes-browserlink` instead.
5. **Lobster favicon → link emoji** in the two client HTML files.
6. **`[BROWSERLINK:` log prefix**, not the plan's literal `[BROWSERLINK:]`
   — the trailing bracket is a typo that would have broken the
   `[PREFIX:scope]` shape.
7. **Fixed `buildViewerUrl` call sites the plan missed.** Task 10 named
   only `bridge.js`, but `background.js` and `popup.js` also called it and
   would have silently broken under the two-arg signature.
8. **`dist/` gitignored** — generated, one-command rebuild.
9. **Kept `scripts/log-server.js`** against the plan's stated default: it
   is the receiver for `background.js`'s live `DIAGNOSTIC_LOG_URL`.
10. **Moved diagnostic logging 8787 → 8788.** The plan puts the viewer on
    8787, which collided with log-server's default; running both would
    fail to bind.
11. **Added `escapeClosingScriptTag`** to the viewer build — defensive
    against a `</script>` in future vendored JS. No current source has one.

## Environment notes for Ben

- **Hermes is not on this MacBook Pro** — no binary, no `~/.hermes`, no
  agent-browser, nothing via npm global or brew. Any live testing has to
  happen on the Mac Mini (or Hermes gets installed here).
- **The Mac Mini's `~/.hermes/skills/` is organized into category
  subdirectories** (`apple/`, `devops/`, `github/`, …), not a flat list.
  The plan's Task 18 target `~/.hermes/skills/browserlink-tab-share/` would
  sit alongside those categories; **whether Hermes discovers skills at that
  depth is unverified.** INSTALL.md § 8 says verify, don't assume.
- **The Mac Mini is a live production box** (`aria`, gateway running, cron
  active). Everything this run did there was a read.
- `/tmp/browserlink-delay-complete` exists, so a re-launch skips the
  80-minute wait.

## Review findings addressed

Both of Aria's findings were reproduced before being fixed.

- **P1 — stale viewer kept privileged control (security).**
  `peer.on('connection')` reassigned `dataConnection` without closing the
  previous connection, and neither the `data` nor `close` handler checked
  ownership. A superseded viewer kept forwarding input/control events,
  which this extension executes via `chrome.debugger` with `<all_urls>`;
  and the old connection closing tore down the *new* viewer's state.
  Fixed by closing the previous connection and fencing `open`/`data`/`close`
  on `conn === dataConnection`, covered by
  `test/offscreen-viewer-ownership.test.js` (8 tests, written first — 6
  failed against the old code, and the 2 that passed were control cases,
  so the test discriminates). This was **inherited upstream behavior**, not
  introduced by the port.
- **P2 — vulnerable lockfile, no CI.** 7 advisories (1 critical:
  `GHSA-5xrq-8626-4rwp` against the `vitest <=3.2.5` chain upstream pinned
  at `^1.6.0`). Upgraded vitest to `^4.1.10` (suite passes unchanged),
  `npm audit fix` for two transitive highs under `serve` → **0
  vulnerabilities**. Added `.github/workflows/ci.yml` with a test job and an
  audit job gating on `--audit-level=high`, since the branch had no checks.

## Verification evidence

```
$ npx vitest run
 Test Files  11 passed (11)
      Tests  101 passed (101)

$ npm audit
found 0 vulnerabilities

$ node scripts/build-viewer.js
Wrote dist/browserlink-viewer.html (146.9 KB)

$ curl -s -o /dev/null -w '%{http_code} %{size_download}' \
    http://127.0.0.1:8787/browserlink-viewer.html
200 150425
```

Residual `lobsterlink|lobsterl.ink|openclaw` hits outside `docs/`:
`README.md:212` and `INSTALL.md:23` (upstream attribution — required),
`README.md:84` (prose comparing against upstream), and
`test/build-viewer.test.js:38` (the guard test's own name). No hits in
shipped extension code.

## Not done

- The `/aria:review-gauntlet` consensus review from the handoff's endgame
  step 5 was **not run** — it was not requested in the revised scope, and
  it would be reviewing a port whose central premise (does the extension
  load in Hermes' browser?) is still unverified. Worth running after the
  live test, when there is something real to review against.
