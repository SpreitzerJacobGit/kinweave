/**
 * Disclosure Gate — THE single outbound chokepoint. Every field that leaves the
 * owner boundary (Zone O) passes through here. The Gate enforces the disclosure
 * ladder and the hard boundaries on OUTPUT, independent of whatever the Persona
 * model "decided" — so prompt-injection or an over-eager/jailbroken Persona can
 * never emit above the current consented tier or leak a never-disclose field.
 *
 * See spec/03-disclosure-ladder.md and spec/06-threat-model-and-safety.md.
 */

import { fieldTier, NEVER_DISCLOSE, Tier } from '../types/disclosure';
import type { ConsentLedger } from './consent-ledger';

export type RefusalReason =
  | 'hard-boundary' // field is in NEVER_DISCLOSE — refused at any tier
  | 'unknown-field' // field not classified — deny by default
  | 'above-current-tier' // field's tier exceeds the mutually consented tier
  | 'no-consent'; // T2+ field lacks a valid owner consent grant

export interface FilterInput {
  /** The tier the persona is currently permitted to disclose at (mutual + consented). */
  tier: Tier;
  /** Fields the persona wants to emit: key -> value. */
  fields: Record<string, unknown>;
  /** The counterpart handle these fields go to. */
  counterpart: string;
  /** id of the consent-grant authorizing this send (required for T2+ fields). */
  gateRef?: string;
  /** Set of field keys that are grounded in the owner's VERIFIED profile. */
  verifiedFields: ReadonlySet<string>;
  /** Confidence in the asserted values (0..1). */
  confidence?: number;
}

export interface FilterResult {
  allowed: Record<string, unknown>;
  refused: { key: string; reason: RefusalReason }[];
  /** Tier actually emitted (max tier among allowed fields). */
  emittedTier: Tier;
}

export class DisclosureGate {
  constructor(
    private readonly ownerId: string,
    private readonly counterpartOwner: string,
    private readonly ledger: ConsentLedger,
  ) {}

  /**
   * Filter a set of proposed outbound fields. Returns only the fields permitted
   * at the current tier with valid consent; everything else is refused and the
   * refusal is logged. This method is the ONLY path from Zone O to the channel.
   */
  filterOutbound(input: FilterInput): FilterResult {
    const allowed: Record<string, unknown> = {};
    const refused: { key: string; reason: RefusalReason }[] = [];
    let emittedTier = Tier.T0;

    for (const [key, value] of Object.entries(input.fields)) {
      // 1. Hard boundary — never leaves, at any tier, regardless of consent.
      if (NEVER_DISCLOSE.has(key)) {
        refused.push({ key, reason: 'hard-boundary' });
        this.logRefusal(input.counterpart, key, 'hard-boundary');
        continue;
      }

      // 2. Deny-by-default for unknown fields.
      const ft = fieldTier(key);
      if (ft === undefined) {
        refused.push({ key, reason: 'unknown-field' });
        this.logRefusal(input.counterpart, key, 'unknown-field');
        continue;
      }

      // 3. Tier ceiling — cannot emit above the mutually consented tier.
      if (ft > input.tier) {
        refused.push({ key, reason: 'above-current-tier' });
        this.logRefusal(input.counterpart, key, 'above-current-tier');
        continue;
      }

      // 4. T2+ fields require a valid owner consent grant referenced by gateRef.
      if (ft >= Tier.T2) {
        const ok =
          !!input.gateRef &&
          this.ledger.grantCovers(input.gateRef, input.counterpart, ft);
        if (!ok) {
          refused.push({ key, reason: 'no-consent' });
          this.logRefusal(input.counterpart, key, 'no-consent');
          continue;
        }
      }

      // Permitted. Over-sell guard: if the value is not grounded in the verified
      // profile, it is logged as an inferred claim, never as verified fact.
      const provenance = input.verifiedFields.has(key) ? 'verified' : 'inferred';
      allowed[key] = value;
      if (ft > emittedTier) emittedTier = ft;
      this.ledger.append({
        type: 'disclosure-out',
        counterpart: input.counterpart,
        tierTo: ft,
        fields: [key],
        authorizingConsent: input.gateRef,
        provenance,
        confidence: input.confidence,
      });
    }

    return { allowed, refused, emittedTier };
  }

  private logRefusal(counterpart: string, key: string, reason: RefusalReason): void {
    this.ledger.append({
      type: 'refusal',
      counterpart,
      fields: [key],
      reason,
    });
  }
}
