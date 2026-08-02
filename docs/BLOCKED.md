# BLOCKED — BrowserLink autonomous port run

**Date:** 2026-08-01
**Branch:** `feat/initial-port`
**Plan:** `docs/plans/2026-08-01-browserlink-implementation-plan.md`
**Outcome:** Clean stop at Phase 0, Task 1. **Zero of 22 tasks executed.**
No code vendored, no rebrand, no `.env` edits, no files written outside
this repo.

---

## The blocker, in one line

**Hermes is not installed on this machine, so Phase 0 — which the plan
states "gates everything" — cannot be run at all.**

Full evidence: `docs/spikes/01-agent-browser.md`.

## Evidence summary

| Check | Result |
|---|---|
| `which hermes` | not found |
| `hermes --version` | command not found |
| `ls ~/.hermes` | No such file or directory |
| `ls -d ~/.hermes* ~/.config/hermes*` | none |
| `which agent-browser` | not found |
| `npm ls -g --depth=0` | no hermes / agent-browser |
| `brew list \| grep -iE "hermes\|agent-browser"` | no match |
| `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin`, `~/.bun/bin`, `~/.deno/bin`, `/usr/bin` | no hermes binary |
| `hostname` / `hw.model` | `MacBookPro.lan` / `MacBookPro18,2` |

Node 22.13.1 / npm 10.9.2 are present and fine — the toolchain is not the
problem.

## Why I did not fix it myself

The run's scope rules allow writes only inside this repo plus three
pre-approved paths:

1. `~/.hermes/.env` — **only** the `AGENT_BROWSER_ARGS` edits from Tasks
   2, 11 and 16, including the merge-preserve-existing-flags rules;
2. `~/.hermes/browser-extensions/`;
3. `~/.hermes/skills/browserlink-tab-share/`.

Everything else — notably `~/.hermes/config.yaml` — is **forbidden**, with
the instruction: *"If a task seems to require one, write `docs/BLOCKED.md`
explaining it and stop the run cleanly."* That is what this document is.

Unblocking would require all of:

- installing Hermes system-wide — outside every permitted path;
- **creating** `~/.hermes/.env` from nothing, not editing it. The
  pre-approval is written around merging into an existing file
  ("preserve existing flags", "record what was there before"), which
  presupposes one exists. Fabricating the file, and guessing what else
  Hermes needs in it, is outside that grant;
- near-certainly creating `~/.hermes/config.yaml` and provisioning
  model/gateway credentials — explicitly forbidden.

I also did not proceed to Phase 1+ on the pure-code tasks. The plan header
and the run rules both say a Phase 0 failure means stop and *"do not
improvise around a failed spike."* Phase 0 gates the port precisely because
the port is worthless if an MV3 extension cannot be loaded into and driven
inside Hermes' Chromium — and that premise is currently **unvalidated, not
merely untested**. Building ~15 tasks of code on it would be the exact
outcome the gate exists to prevent.

## Most likely cause

The handoff prompt's launch suggestion referenced *"keeps the **Mac Mini**
awake through the wait + run"*, while the MISSION section describes a
MacBook Pro M1 Max. This box is `MacBookPro18,2` — an M1 Max MacBook Pro,
matching MISSION but not the Mac Mini. If Hermes lives on the Mac Mini,
the run simply started on the wrong machine.

## Two ways to unblock

### Option A — run this on the machine that already has Hermes (preferred)

If the Mac Mini has Hermes provisioned, re-launch the same handoff prompt
there. Confirm first:

```bash
which hermes && hermes --version && ls ~/.hermes/.env
```

Also fix the working-directory path — see Discrepancy 2 below.

### Option B — provision Hermes here, then re-launch

Install and configure Hermes on this MacBook Pro (credentials included —
that part needs a human), verify the three checks above pass, then
re-launch the handoff prompt. The pre-approved `AGENT_BROWSER_ARGS` grant
then works as written, because `~/.hermes/.env` will exist.

Either way, `/tmp/browserlink-delay-complete` now exists, so the 80-minute
wait is correctly skipped on re-launch.

---

## Other discrepancies found (fix these before re-launching)

### 1. Vendoring source is missing — but recoverable, and *not* the blocker

`~/code/forks/lobsterlink-upstream` does not exist; neither does
`~/code/forks/` at all. A whole-home search for `*lobsterlink*` returned
nothing. `~/code/_forks/` (underscore) holds only `clawkie-talkie` and
`openclaw`; `clawkie-talkie` is a different davidguttman project, not
LobsterLink.

Good news: the public upstream is live and its `HEAD`/`master` is
**exactly the pinned commit** `4bb37deb0e1292c8b53c3e702f7d97c6a241fcc3`
(= the plan's `4bb37de`). So a faithful source is one clone away:

```bash
git clone https://github.com/davidguttman/lobsterlink ~/code/forks/lobsterlink-upstream
git -C ~/code/forks/lobsterlink-upstream checkout 4bb37de
```

Nothing was cloned during this run — creating `~/code/forks/` is outside
the permitted paths, and with Phase 0 blocked there was no reason to.

**Decision needed from Ben:** either pre-create that directory, or amend
the plan to allow cloning upstream into a scratch path. The stale
`~/code/forks/lobsterlink` the plan warns against does not exist, so
there is no risk of grabbing the wrong tree.

### 2. Working-directory drift

The plan says the working directory is `~/code/hermes-browserlink`. The
actual checkout is `~/code/hbai/opensource/hermes-browserlink`. Correct
remote (`git@github.com:MrBenJ/hermes-browserlink.git`), so this is only a
path mismatch — but Tasks 6, 13 and 17 hardcode the old path and would
need updating, and `scripts/serve-viewer.sh` resolves relative to itself
so it is unaffected.

### 3. Branch-name conflict in the handoff prompt

The handoff's GIT + SCOPE DISCIPLINE section says branch
`feature/initial-port`; its ENDGAME section says push `feat/initial-port`,
and the plan header also says `feat/initial-port`. **I used
`feat/initial-port`** (2 of 3 sources, including the execution document,
which the prompt designates as authoritative).

---

## What this run did and did not touch

**Wrote (all inside this repo, on `feat/initial-port`):**

- `docs/BLOCKED.md` (this file)
- `docs/spikes/01-agent-browser.md`

**Did not touch:** `~/.hermes/**` (does not exist), `~/code/forks/**`
(does not exist), any other repository, `main`. No `npm i -g`. No remote
pushes. No PR opened — an "opened PR" implying a completed port would
misrepresent the state of this branch.
