# 11 — The guided persona interview

This is the **source of truth** for how any AI builds a Kinweave Persona by interviewing its owner. If a person points their existing AI at this repo and says *"let's join,"* the AI should read this file and run the interview below, then save the result via the handoff in §6.

The web app's onboarding prompts (`src/ai/prompts.ts`), the MCP tool description (`mcp/server.ts`), and the agent SOUL snippet (`plugins/kinweave.soul.md`) are all short, runtime-embeddable restatements of this document — **this file is authoritative; keep them in step with it.** The controlled vocabulary lives in `src/types/vocab.ts`.

## What you're building, and why it's shaped this way

A **Persona** is the small, structured profile that lets someone's AI find compatible people nearby and co-plan a real hangout — with the owner approving every step. Kinweave connects people on **four things** (`spec/00`): their **interests**, their **values**, their **availability**, and their **idea of fun**.

The interview only ever produces a **`ProfileDraft`** — coarse, disclosable fields (§5). Identity secrets (real name, home coordinate, contact) and the raw interest vector are added **on-device**, never by you (see §4). So your whole job is a warm conversation that fills the draft well.

Do it as a real conversation — **one friendly question at a time**, following the person's answers into natural follow-ups. Not a form. Aim for enough signal across all four areas, then stop.

## 1. The golden rule — never collect identity or sensitive data

You **must not ask for, store, or even infer** any of the following. Kinweave is built so these never leave the device; another local step handles the few that are needed.

- Legal name, home address or coordinates, exact or real-time location
- Government ID, date of birth, financial details
- Exact contact details as *matching input* (phone/email/handles) — a contact handle is collected last (§3, step 6) and shared only after both people commit
- Special-category data: **health, sexuality, religion, ethnicity, politics, disability**

If the person volunteers something on this list, gently note it stays private and steer back. Never present a **guess** as something they told you — only what they actually said is a stated fact (`spec/03` provenance).

## 2. Interview these four areas, highest-leverage first

The negotiation engine leans on some fields far more than others. Ask in this order so a short conversation still captures what matters most.

1. **Interests & community — matters most.** What do they genuinely love doing? Any hobby, scene, or community they'd want to meet people through? Hobbies are how compatible people even *find* each other, and they seed the compatibility signal. Get several concrete, specific tags (`bouldering`, `jazz piano`, `tabletop RPGs` — not just `sports`).
2. **Their idea of fun.** The kind of activity (see the activity vocabulary in §5), their energy level (low / medium / high), indoor vs. outdoors, one-on-one vs. small groups, and whether they like **familiar** favorites or trying **new** things.
3. **Availability.** Roughly when they're free — mornings vs. evenings, weekdays vs. weekends. This maps onto four coarse bands (§5); no exact times.
4. **Values & boundaries.** The vibe of people they click with (`quiet`, `outdoorsy`, `sober-friendly`, `nerdy`…) and any **hard limits** (`no alcohol`, `wheelchair-accessible venues`). Values are shown honestly in the "why you two" summary, including conflicts.

## 3. A natural flow (adapt freely)

1. Warm open: *"I'll help set up your Kinweave Persona so I can find people nearby you'd actually click with. To start — what do you love doing with your time?"*
2. Pull on the interests thread → concrete hobby tags + any community/scene.
3. Move to their idea of fun → activity kinds, energy, setting, group size, novelty.
4. Availability → the rough windows they're usually free.
5. Values & boundaries → the vibe they click with, and any hard limits.
6. **Identity, framed and last (optional).** *"Last thing — want to add a first name and a way to reach you day-of? These stay on your device and are shared only after you and the other person both say yes."* A **display handle** (not their real name) is fine for the public card. Ask for a **coarse neighborhood word** at most for location (e.g. `northside`) — never a precise place.
7. **Confirm.** Reflect a short, plain-language summary back: *"Here's what I've got — outdoorsy, small groups, weekend mornings, sober-friendly, no alcohol. Good to build it?"* Fix anything, then save (§6).

## 4. What stays on the device (you never touch these)

Added locally by `assembleProfile` / `deriveInterestVector` — do **not** put them in the draft:

- `legalName`, `homeCoordinate`, the raw `interestVector` — never leave the device in raw form.
- `firstName`, `contact` — collected locally (optional), disclosed only late in the ladder and only with the owner's approval.

## 5. The draft you produce (controlled vocabulary)

Every field is coarse and safe to negotiate over. Vocabularies are closed sets — map answers onto these exact values (source: `src/types/vocab.ts`); anything off-list is dropped by `validateDraft`.

| Field | Type / vocabulary | Notes |
|---|---|---|
| `handle` | string | A **display name**, not their real name. Public (tier T0). |
| `community` | string | The local/hobby community to discover within. Default `local`. |
| `hobbyTags` | string[] | Free-form, specific. **Highest leverage** — drives discovery + matching. |
| `geoCell` | string | Coarse neighborhood word only (e.g. `northside`). Never a coordinate. |
| `valueTags` | string[] | Vibe (e.g. `quiet`, `sober-friendly`). |
| `availabilityMask` | integer 0–15 | 4 bits, one per time band: bit0 `weekday_day` … bit3 `weekend_eve`. |
| `groupPref` | `one_on_one` \| `small` \| `either` | |
| `activityClasses` | subset of `games, food, outdoors, arts, sport, learning` | Also selects the neutral public **venue**. A hard match gate. |
| `energyLevel` | `low` \| `medium` \| `high` | |
| `timeBands` | subset of `weekday_day, weekday_eve, weekend_day, weekend_eve` | The other half of the hard match gate. |
| `settingPref` | `public_venue` \| `outdoor` \| `either` | |
| `hardConstraints` | string[] | e.g. `no_alcohol`. |
| `noveltyPref` | `familiar` \| `new` \| `either` | |

> Two of these are **hard gates**: two Personas are abandoned early if they share **no** `activityClasses` **and** no `timeBands`. Don't leave both thin.

## 6. Saving the Persona (auto-detect the path)

**If the Kinweave MCP tools are available** (you can see `kinweave_save_persona`): call it with the fields from §5. Identity fields (`handle`, `firstName`, `contact`) are optional there and stay on the device. That's the whole save.

**If you don't have the MCP tools** (someone just opened this repo in you): write the draft as JSON — exactly the §5 keys — to **`~/.kinweave/persona-draft.json`**, and show it to the owner. It gets adopted automatically the next time the Kinweave MCP connector starts, or the owner can paste it into the phone app via **"Paste a profile my AI built →"** on the onboarding screen. Then point them at `mcp/README.md` (connector) or the app (`README.md`) to actually connect.

Example draft JSON:

```json
{
  "handle": "trailmix",
  "community": "local",
  "hobbyTags": ["bouldering", "trail running", "specialty coffee"],
  "geoCell": "northside",
  "valueTags": ["outdoorsy", "sober-friendly"],
  "availabilityMask": 12,
  "groupPref": "small",
  "activityClasses": ["outdoors", "food"],
  "energyLevel": "high",
  "timeBands": ["weekend_day", "weekend_eve"],
  "settingPref": "outdoor",
  "hardConstraints": ["no_alcohol"],
  "noveltyPref": "new"
}
```

## 7. Tone

Warm, brief, and in the owner's interest. Curious, not clinical. Never pressure, never over-collect, and be transparent about what stays private — that candor is part of what makes Kinweave trustworthy.
