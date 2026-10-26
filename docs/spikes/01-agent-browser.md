# Spike 01 — agent-browser launch profile

**Date:** 2026-08-01
**Task:** Plan Task 1 — "Characterize agent-browser"
**Result:** ⛔ **NOT RUNNABLE — Hermes is not installed on this machine.**

> **Update 2026-08-02:** the environment finding below is still accurate,
> but it no longer stops the run — Ben scoped this session to skip all E2E
> and do the repo-local work here. Hermes' browser configuration was
> instead characterized by reading a real install's source over SSH; see
> [`02-hermes-browser-config.md`](./02-hermes-browser-config.md). The
> "Consequence for the plan" table below reflects the original stop, not
> the final outcome — see [`../final-report.md`](../final-report.md).

Phase 0 gates everything. It could not be executed, so no spike findings
exist for Tasks 1–5. This document records why, with the evidence, so the
run can be resumed on a correctly-provisioned machine without re-deriving
any of it.

---

## What Task 1 asked for

1. `which agent-browser || npm i -g agent-browser`
2. `agent-browser --help` — record output
3. From a Hermes session, call `browser_navigate` to `https://example.com`
4. `ps aux | grep -iE "chrom|headless"` — record binary path, headless
   flags, `--remote-debugging-port`, `--user-data-dir`
5. Write findings here

Steps 3–5 require a working Hermes installation. Step 1's fallback
(`npm i -g agent-browser`) would install the browser launcher but not
Hermes itself, and characterizing the launch profile is only meaningful
as *Hermes* launches it — which is the whole point of the spike.

## Evidence — Hermes is absent

Machine identity:

```
$ hostname
MacBookPro.lan
$ sysctl -n hw.model
MacBookPro18,2
```

Hermes CLI:

```
$ which hermes
hermes not found
$ hermes --version
(eval):2: command not found: hermes
```

Hermes home directory:

```
$ ls -la ~/.hermes
ls: /Users/bjunya/.hermes: No such file or directory
$ ls -d ~/.hermes* ~/.config/hermes*
(none)
```

agent-browser:

```
$ which agent-browser
agent-browser not found
```

Not present via any other install channel:

```
$ npm ls -g --depth=0
/Users/bjunya/.nvm/versions/node/v22.13.1/lib
├── @openai/codex@0.146.0
├── ccusage@20.0.4
├── clawdhub@0.3.0
├── corepack@0.35.0
├── mcp-dealer@0.1.0 -> ./../../../../../code/mcp-dealer
├── neonctl@2.22.0
├── npm@10.9.2
└── vercel@54.6.0

$ brew list | grep -iE "hermes|agent-browser"
(no brew match)

$ for p in /usr/local/bin /opt/homebrew/bin ~/.local/bin ~/.bun/bin ~/.deno/bin /usr/bin; do
    ls "$p" 2>/dev/null | grep -i hermes; done
(no output)
```

Toolchain that *is* present and adequate:

```
$ node -v
v22.13.1
$ npm -v
10.9.2
```

## Consequence for the plan

| Task | Needs Hermes / agent-browser | Status |
|------|------------------------------|--------|
| 1 — Characterize agent-browser | yes | blocked |
| 2 — Extension flag pass-through (`AGENT_BROWSER_ARGS`) | yes | blocked |
| 3 — Extension target discovery via CDP | yes | blocked |
| 4 — Bridge page reachability | yes | blocked |
| 5 — End-to-end smoke (upstream code) | yes | blocked |
| 11 — Reload ported extension in spike browser | yes | blocked |
| 14 — E2E with single-file viewer | yes | blocked |
| 16 — Rehearse INSTALL.md from clean state | yes | blocked |
| 18 — Install skill + Telegram acceptance | yes | blocked |

Tasks 6–10, 12, 13, 15, 17, 19–22 are repo-local and need no Hermes, but
they sit *behind* the Phase 0 gate by design: the gate exists so that the
port is not built on an unvalidated premise (that an MV3 extension can be
loaded into, and driven inside, Hermes' Chromium). Per the plan header and
the run's autonomy rules — *"Never improvise around a failed spike"* — the
run stops here rather than proceeding to Phase 1.

## Why this was not self-remediated

The run's scope rules permit modifications only inside
`~/code/hbai/opensource/hermes-browserlink` plus three pre-approved paths
(`~/.hermes/.env` `AGENT_BROWSER_ARGS` lines only,
`~/.hermes/browser-extensions/`, `~/.hermes/skills/browserlink-tab-share/`).

Remediating this blocker would require, at minimum:

- installing Hermes system-wide (outside all allowed paths);
- **creating** `~/.hermes/.env` rather than editing an existing one — the
  pre-approval is scoped to specific `AGENT_BROWSER_ARGS` edits with
  documented merge-preserve rules, which presupposes the file exists;
- almost certainly creating/populating `~/.hermes/config.yaml` and
  provisioning credentials — `config.yaml` is explicitly **forbidden**.

See `docs/BLOCKED.md`.

## Secondary finding — vendoring source (resolvable, not the blocker)

The plan's vendoring source `~/code/forks/lobsterlink-upstream` also does
not exist:

```
$ test -d ~/code/forks && echo YES || echo NO
NO
$ find ~ -maxdepth 6 -iname "*lobsterlink*" -not -path "*/node_modules/*"
(no results)
```

`~/code/_forks/` exists (underscore prefix) but contains only
`clawkie-talkie` and `openclaw`. `clawkie-talkie` is a *different*
davidguttman project (`git@github.com:davidguttman/clawkie-talkie.git`, a
voice-handoff app) — not LobsterLink; it has no root `manifest.json`,
`background.js`, or `bridge.html`.

This one is recoverable without guesswork: the public upstream is live and
its `HEAD`/`master` is **exactly the pinned commit**:

```
$ git ls-remote https://github.com/davidguttman/lobsterlink | head -5
4bb37deb0e1292c8b53c3e702f7d97c6a241fcc3	HEAD
08668ca8635ab6ffea41183d77fbd31199bfd382	refs/heads/docs/install-agent-flow
6577b47e4210e1ba8cd7a223d9639055148ce94c	refs/heads/fix/lobsterlink-public-url
a3f57e55cdeb5c931af11390e2b4f7d8356886e1	refs/heads/lobsterlink-copy-instructions
4bb37deb0e1292c8b53c3e702f7d97c6a241fcc3	refs/heads/master
```

`4bb37deb0e1292c8b53c3e702f7d97c6a241fcc3` == the plan's `4bb37de`. A
faithful vendor source is therefore one `git clone` away; no stale-source
risk, and no need to ever touch the untrusted `~/code/forks/lobsterlink`
path the plan warns about (which also does not exist).

**Nothing was cloned during this run** — creating `~/code/forks/` is
outside the permitted paths, and with Phase 0 blocked there was no reason
to vendor anyway.
