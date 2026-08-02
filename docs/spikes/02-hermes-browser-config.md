# Spike 02 — Hermes browser configuration (source-derived)

**Date:** 2026-08-02
**Replaces:** the parts of plan Tasks 1–4 that could be answered without a
running browser.
**Method:** read-only inspection of a real Hermes install over SSH
(`aria-mac-mini`, `Mac16,11`, Hermes at `~/.hermes/hermes-agent`, a Python
package). **No live browser was launched and no E2E was run** — Ben's
instruction for this run was to skip all end-to-end testing.

> This is evidence from Hermes' own source and docs, not from observing a
> running Chromium. Everything below is checkable by reading the cited
> file. The one thing it cannot tell us is whether the extension actually
> loads — that still needs Ben's live test.

---

## 1. `AGENT_BROWSER_ARGS` is comma- or newline-separated

`website/docs/reference/environment-variables.md:151`:

> | `AGENT_BROWSER_ARGS` | Extra Chromium launch flags (comma- or
> newline-separated). Hermes auto-injects
> `--no-sandbox,--disable-dev-shm-usage` when running as root or on
> AppArmor-restricted unprivileged user namespaces (Ubuntu 23.10+, DGX
> Spark, many container images); set this manually only to override or add
> other flags. |

This settles the merge format the plan left open: **comma-separated**, and
newlines also work. So merging BrowserLink into an existing value means
appending `,--load-extension=...,--disable-extensions-except=...`, not
space-joining.

## 2. Setting it disables Hermes' sandbox auto-injection — a non-issue on macOS

`tools/browser_tool.py:2447-2461`:

```python
# Honour either the legacy AGENT_BROWSER_CHROME_FLAGS (never consumed by
# agent-browser itself, but documented in older notes) or the real
# AGENT_BROWSER_ARGS — if the user pre-sets either, don't overwrite it.
if (
    "AGENT_BROWSER_ARGS" not in browser_env
    and "AGENT_BROWSER_CHROME_FLAGS" not in browser_env
):
    if _needs_chromium_sandbox_bypass():
        ...
        browser_env["AGENT_BROWSER_ARGS"] = (
            "--no-sandbox,--disable-dev-shm-usage"
        )
```

The auto-injection is gated on `_needs_chromium_sandbox_bypass()` — root,
Docker, or AppArmor userns. On a normal macOS user account that gate is
false, so nothing would have been injected anyway. **The plan's claim that
this is "a non-issue on macOS" is confirmed correct.**

## 3. ⚠️ Headless is the default, and that likely blocks the whole port

`tools/browser_tool.py:2384-2387`:

```python
# Local mode — launch Chromium (headless by default, headed when configured)
backend_args = ["--session", session_info["session_name"]]
if _is_headed_mode():
    backend_args.append("--headed")
```

`tools/browser_tool.py:892-916` — `_is_headed_mode()` reads
`config["browser"]["headed"]` from `~/.hermes/config.yaml`, with an
`AGENT_BROWSER_HEADED` environment override, and **defaults to `False`**.

Worse, `tools/browser_tool.py:4587-4630` shows agent-browser (0.26+) may
resolve Chromium to Playwright's **headless-shell** build
(`chromium_headless_shell-<build>`), noting "agent-browser accepts either".

**Why this matters:** MV3 extensions do not load in Chromium's
headless-shell at all, and historically did not load in old-style
`--headless`. Extension support requires `--headless=new` or a headed
browser. This is precisely the risk plan Task 1 was written to catch:

> *"If headless is old-style (`--headless` without `=new`), flag it: MV3
> extensions need `--headless=new`."*

**Consequence:** BrowserLink almost certainly needs Hermes' browser in
**headed** mode. The env-var route is `AGENT_BROWSER_HEADED=true` in
`~/.hermes/.env`, which reaches the same code path as
`config.browser.headed` without editing `config.yaml`.

**This is unverified.** It is a source-derived prediction, not an observed
failure. It is the single highest-risk unknown remaining in this port, and
the first thing Ben's live test should check.

## 4. Current state of the Mac Mini install

- `AGENT_BROWSER_ARGS` is **not** currently set in `~/.hermes/.env`
  (`grep -c` returned 0). So a first install **adds** the key rather than
  merging into an existing value — the plan's merge-preserve rules are
  written for a case that does not currently exist on this box.
- `~/.hermes/browser-extensions/` does **not** exist yet.
- `~/.hermes/skills/` exists and is organized into **category
  subdirectories** (`apple/`, `devops/`, `github/`, `productivity/`,
  `red-teaming/`, …), not a flat list of skills. The plan's Task 18 target
  `~/.hermes/skills/browserlink-tab-share/` would be a top-level entry
  alongside those categories; whether Hermes discovers skills at that depth
  was not verified.
- No `hermes` binary on the non-interactive SSH `PATH` (`~/.hermes/bin`
  holds `tirith`, `uv`, `uvx`). Hermes is presumably launched some other
  way; not investigated further, as this run does not run Hermes.

## 5. What was NOT determined

These still require a live browser and remain open for Ben's test:

- Whether the extension actually loads (item 3 above is the open question).
- The extension ID — unpacked IDs derive from the install path, so this
  cannot be predicted, only read from CDP `/json/list` after loading.
- The CDP port, or whether agent-browser runs pipe-only.
- Whether Hermes' `browser_navigate` can open `chrome-extension://` URLs,
  or whether CDP target creation is required (plan Task 4).
- Anything about frame flow or input dispatch (plan Task 5).

## Scope note

Nothing on the Mac Mini was modified. All commands were reads: `ls`,
`grep -c`, `sed -n`, `grep -rn`. `~/.hermes/.env` was searched for the
single key name `AGENT_BROWSER_ARGS` and for `^[A-Z_]*AGENT_BROWSER[A-Z_]*`
key names only — **no values from `.env` were read, printed, or stored.**
