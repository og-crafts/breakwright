# Decisions
| # | Decision | Why |
|---|---|---|
| 1 | Plain Playwright files are the source of truth | Approach A; no lock-in |
| 2 | Node helper serves UI on 127.0.0.1 with a token; desktop shell only starts it | Same app in browser and desktop; a Playwright project needs Node anyway |
| 3 | Faults are injected by a preload (NODE_OPTIONS), never by editing tests | User files stay untouched |
| 4 | AI/MCP can propose, never apply | The trust rule |
| 5 | AI keys are kept in memory or read from the environment, not saved | No keychain work proven yet |
| 6 | All faults of a test run in one Playwright session (repeat i = fault i), with a clean repeat last | One start per fault took minutes |
| 7 | A failure counts as caught only if an assertion failed; unsteady tests are not scored | Honest scores |
| 8 | The guard is an allowlist: plain renames pass, everything else is flagged | Review found ways round a list of tricks |
| 9 | Desktop app uses the person's Node 22.15+, not a bundled one | Playwright projects need Node anyway; small package |
| 10 | Built-in assistant uses claude-opus-5-5 by default, with refusal fallbacks on | Current default model; not tried against the live service yet |
| 11 | node:test instead of vitest | The machine was out of memory |
