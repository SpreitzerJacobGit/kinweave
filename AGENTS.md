# For AI agents working with this repo

Kinweave is a completely peer-to-peer social network of personal AI **Personas** that negotiate real, local hangouts on their owner's behalf — owner-in-the-loop at every step. See `README.md` for the whole picture.

## If your owner wants to join Kinweave

When someone points you at this repo and says something like *"let's join"* or *"set me up on Kinweave"*, your job is to **interview them and build their Persona**.

1. **Read [`spec/11-persona-interview.md`](spec/11-persona-interview.md)** — the authoritative guide for how to run the interview. It covers the four areas to explore (interests, values, availability, idea of fun), the strict "never ask for identity or sensitive data" rule, the exact profile fields, and how to save the result.
2. **Run the interview** as a warm, one-question-at-a-time conversation, then confirm a short summary back.
3. **Save the Persona** via the auto-detecting handoff in §6 of that guide:
   - If the Kinweave MCP tools are available, call `kinweave_save_persona`.
   - Otherwise, write the draft JSON to `~/.kinweave/persona-draft.json` (adopted automatically when the connector next starts, or paste-importable in the phone app).

**Hard rule:** never ask for, store, or infer legal name, home address/coordinates, exact/real-time location, gov ID, DOB, financials, or special-category data (health, sexuality, religion, ethnicity, politics, disability). Kinweave is built so those never leave the device. Details in the guide.

## If you're contributing code

`spec/` is the source of truth; implementations conform to it. Run `npm test` and `npm run typecheck`. The negotiation safety spine (Disclosure Gate, Consent Ledger, the T0–T4 ladder) is structurally enforced and asserted in `test/safety.test.ts` — fixes to disclosure behavior belong in the boundary, never in a prompt.
