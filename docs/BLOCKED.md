# BLOCKED — RESOLVED

**Filed:** 2026-08-01 · **Resolved:** 2026-08-02

This file recorded a clean stop at Phase 0 Task 1: Hermes is not installed
on this MacBook Pro, so the Phase 0 spikes — which the plan states "gate
everything" — could not run, and unblocking them would have required
modifications outside the run's permitted paths.

**How it was resolved:** Ben scoped the run to skip all end-to-end testing
and to do the repo-local work on this machine, testing E2E himself later.
That removes the gate for everything that does not need a live browser.

**Current state:** the port is done except for the E2E-dependent tasks. See
[`final-report.md`](./final-report.md) for the full task-by-task status,
what is verified, and what is still `PENDING-HUMAN`.

The two secondary discrepancies this file originally raised are also
resolved:

- **Vendoring source.** `~/code/forks/lobsterlink-upstream` did not exist.
  It was cloned from `https://github.com/davidguttman/lobsterlink`, whose
  `master` HEAD is exactly the plan's pinned commit
  `4bb37deb0e1292c8b53c3e702f7d97c6a241fcc3`. The stale
  `~/code/forks/lobsterlink` the plan warns against does not exist, so
  there was no risk of grabbing the wrong tree.
- **Branch name.** The handoff said `feature/initial-port`; the plan and
  the endgame said `feat/initial-port`. Used **`feat/initial-port`**.

Working-directory drift is unresolved but harmless: the checkout is at
`~/code/hbai/opensource/hermes-browserlink`, not the plan's
`~/code/hermes-browserlink`. Only affects hardcoded paths in the plan text.

The original environment evidence is preserved in
[`spikes/01-agent-browser.md`](./spikes/01-agent-browser.md), and remains
accurate: **Hermes is still not installed on this machine.** Anything
requiring a live Hermes browser must run on the Mac Mini.
