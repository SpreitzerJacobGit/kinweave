/**
 * Consent Ledger — append-only, owner-scoped source of truth for consent and
 * disclosure. Cannot be disabled (there is no delete/mutate method). Never
 * exposed to a counterpart. See spec/06-threat-model-and-safety.md §Auditability.
 */

import type { LedgerEvent } from '../types/consent';
import type { Tier } from '../types/disclosure';
import type { Clock } from './clock';

export class ConsentLedger {
  private events: LedgerEvent[] = [];
  private seq = 0;
  private counter = 0;

  constructor(
    public readonly ownerId: string,
    private readonly clock: Clock,
  ) {}

  /** Append an event. This is the ONLY mutation — there is no edit or delete. */
  append(e: Omit<LedgerEvent, 'id' | 'seq' | 'ts'>): LedgerEvent {
    const event: LedgerEvent = {
      ...e,
      id: `${this.ownerId}-evt-${++this.counter}`,
      seq: ++this.seq,
      ts: this.clock.tick(),
    };
    this.events.push(event);
    return event;
  }

  all(): readonly LedgerEvent[] {
    return this.events;
  }

  /** Snapshot the events for on-device persistence / account export. */
  exportEvents(): LedgerEvent[] {
    return this.events.map((e) => ({ ...e }));
  }

  /** Rebuild a ledger from persisted events, preserving append-only continuation. */
  static fromEvents(ownerId: string, clock: Clock, events: readonly LedgerEvent[]): ConsentLedger {
    const l = new ConsentLedger(ownerId, clock);
    l.events = events.map((e) => ({ ...e }));
    l.seq = events.reduce((m, e) => Math.max(m, e.seq), 0);
    l.counter = events.reduce((m, e) => {
      const n = Number(e.id.slice(e.id.lastIndexOf('-') + 1));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    return l;
  }

  find(pred: (e: LedgerEvent) => boolean): LedgerEvent | undefined {
    return this.events.find(pred);
  }

  filter(pred: (e: LedgerEvent) => boolean): LedgerEvent[] {
    return this.events.filter(pred);
  }

  /** True if a valid consent-grant exists for this counterpart covering `tier`. */
  hasGrantForTier(counterpart: string, tier: Tier): boolean {
    return this.events.some(
      (e) =>
        e.type === 'consent-grant' &&
        e.counterpart === counterpart &&
        e.tierTo !== undefined &&
        e.tierTo >= tier,
    );
  }

  /** Look up a consent-grant by id and confirm it covers `tier` for `counterpart`. */
  grantCovers(grantId: string, counterpart: string, tier: Tier): boolean {
    const g = this.find((e) => e.id === grantId && e.type === 'consent-grant');
    return (
      !!g &&
      g.counterpart === counterpart &&
      g.tierTo !== undefined &&
      g.tierTo >= tier
    );
  }
}
