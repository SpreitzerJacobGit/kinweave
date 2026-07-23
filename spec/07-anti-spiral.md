# 07 — Termination & anti-spiral

Implemented via `Caps` and the budget/round counters in `src/core/state-machine.ts`.

- **Per-stage round caps** — probe 2, align 3, coplan 4, owner 2. Exceeding a cap triggers the stage's ABANDON code (e.g. coplan → `no_feasible_plan`).
- **Global message budget** — default ~40 messages per negotiation. Hitting it → `budget_exhausted` (prevents infinite micro-negotiation). Asserted with a tiny budget in `test/protocol.test.ts`.
- **Global wall-clock deadline** — default 7 days from S1 (specified; the sim uses logical ticks, not real time).
- **Gate TTLs** — G1 72h, G2/G3/G4 48h. Timeout routes to `timeout` / `owner_timeout`. Modeled by an owner policy returning `defer`.
- **Graceful abandon** — every ABANDON sends the counterpart only a generic `publicReason`; the true reason stays owner-side (`test/protocol.test.ts` asserts the true reason never appears on the wire).
- **Cooldowns** — after an abandon between a specific pair, re-pairing is blocked for a window (default 30 days for `low_match` / `owner_declined`; 0 for `no_feasible_plan`) *(specified)*.
- **Per-owner concurrency cap** — at most 3 active negotiations and 5 new/day, rate-limiting the graph against spam Personas *(specified)*.
- **No backslide past a satisfied gate** — an owner edit at S6 invalidates the artifact version and requires a fresh G4 on the new version.
- **Idempotent commit** — the two-phase commit is keyed on the artifact hash; a duplicate confirm is a no-op (`CommitBook`), so a hangout can't be double-booked. Asserted in `test/protocol.test.ts`.
- **Anti-oscillation** — if two consecutive counters revisit the same rejected dimension, the coplan loop force-terminates early to `no_feasible_plan` *(specified; the sim caps rounds)*.
