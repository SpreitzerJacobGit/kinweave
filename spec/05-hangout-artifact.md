# 05 — Output artifact: `ProposedHangout`

Type in `src/types/artifact.ts`; assembled by `buildArtifact` in `src/core/state-machine.ts` **strictly from what was disclosed on the channel** (never from a Persona's private state). Surfaced identically to both owners at S6. Versioned by a deterministic hash that binds the G4 approval.

## Shape

- **`plan`** — activity (`class`, `specific`, `whyThis`), place (`type`, `name`, `geoCell`, `isPublic`, accessibility notes), time (`date`, `start`, `end`, `timezone`), optional fallback, `estCostBand`, logistics notes.
- **`compatibilityRationale`** — `overallConfidence` (0–1) + `label`, and four axes (`interestOverlap`, `valueAlignment`, `scheduleFit`, `geoConvenience`), each with a `score`, `evidence`, and **`conflicts`**. Plus `honestCaveats` and a `noveltyFlag`.
- **`disclosureLedger`** — `myRevealed` / `theirRevealed` / `stillPrivate` field keys, so each owner sees exactly what a stranger now knows and what is still held back.
- **`provenance`** — stages traversed, rounds used vs caps, transcript ref.
- **`status`** — `pending_review → approved | declined → committed`.

## Honest-confidence rule

The rationale **must surface conflicts and caveats**, not only positives. A high overall score that hides a value/energy conflict is a spec violation. The sim always includes at least a "first meetup — limited shared history" caveat and adds an explicit conflict line when energy levels differ (`test/protocol.test.ts` asserts caveats are present). Over time, confidence is recalibrated against post-hangout feedback (S8) — a Persona that says "high" and owners consistently dislike the result gets corrected.

## Safety properties visible in the artifact

- `plan.place.isPublic === true` — meetups are drawn from the neutral public-venue set (`src/core/venues.ts`) and are **never** a function of a home coordinate.
- `disclosureLedger.stillPrivate` always lists the never-disclosed fields (`homeCoordinate, legalName, interestVector, personaMemory`).
