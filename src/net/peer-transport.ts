/**
 * PeerTransport — the interface a device codes against, so the in-memory relay
 * (tests) and the real WebSocket relay client are swappable. A transport carries
 * sealed `WireEnvelope`s only; it never sees plaintext or holds a key.
 */

import { verifySig } from '../core/identity';
import { signedBody, type WireEnvelope } from '../core/transport';

export interface Delivery {
  mailId: string;
  env: WireEnvelope;
}

export interface PeerTransport {
  send(env: WireEnvelope): Promise<{ accepted: boolean; reason?: string }>;
  /** Drain stored mail for `fingerprint` and receive future deliveries. Returns an unsubscribe. */
  subscribe(fingerprint: string, onDelivery: (d: Delivery) => void): Promise<() => void>;
  ack(mailIds: string[]): Promise<void>;
}

/**
 * In-memory store-and-forward relay — the test double for the real WS relay.
 * Verifies the sender signature over the (encrypted) body; stores ciphertext
 * keyed by recipient fingerprint; delivers on subscribe/live and on ack removes.
 * Holds only public keys + ciphertext — never a private key, never plaintext.
 */
export class InMemoryRelayHub {
  private mail = new Map<string, Delivery[]>();
  private subs = new Map<string, (d: Delivery) => void>();
  private delivered = new Set<string>();
  private counter = 0;

  send(env: WireEnvelope): { accepted: boolean; reason?: string } {
    if (!verifySig(env.from, signedBody(env), env.sig)) return { accepted: false, reason: 'bad-signature' };
    const d: Delivery = { mailId: `mail-${++this.counter}`, env };
    const q = this.mail.get(env.to) ?? [];
    q.push(d);
    this.mail.set(env.to, q);
    const sub = this.subs.get(env.to);
    if (sub) {
      this.delivered.add(d.mailId);
      sub(d);
    }
    return { accepted: true };
  }

  subscribe(fingerprint: string, cb: (d: Delivery) => void): () => void {
    this.subs.set(fingerprint, cb);
    for (const d of this.mail.get(fingerprint) ?? []) {
      if (this.delivered.has(d.mailId)) continue;
      this.delivered.add(d.mailId);
      cb(d);
    }
    return () => {
      if (this.subs.get(fingerprint) === cb) this.subs.delete(fingerprint);
    };
  }

  ack(fingerprint: string, mailIds: string[]): void {
    const q = this.mail.get(fingerprint) ?? [];
    this.mail.set(fingerprint, q.filter((d) => !mailIds.includes(d.mailId)));
  }

  /** Everything the relay can observe — used by tests to prove it holds only ciphertext. */
  observable(): WireEnvelope[] {
    return [...this.mail.values()].flat().map((d) => d.env);
  }
}

/** A PeerTransport client bound to an in-memory hub (tests / local demo). */
export class InMemoryTransport implements PeerTransport {
  private fingerprint = '';
  constructor(private readonly hub: InMemoryRelayHub) {}

  async send(env: WireEnvelope) {
    return this.hub.send(env);
  }

  async subscribe(fingerprint: string, onDelivery: (d: Delivery) => void) {
    this.fingerprint = fingerprint;
    return this.hub.subscribe(fingerprint, onDelivery);
  }

  async ack(mailIds: string[]) {
    this.hub.ack(this.fingerprint, mailIds);
  }
}
