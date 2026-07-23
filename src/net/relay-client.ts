/**
 * RelayClient — a PeerTransport over a WebSocket relay. Reconnect/backoff is
 * elided for MVP; the contract matches the in-memory transport so the device
 * code (and tests) are identical against either. Draining a mailbox answers the
 * server's challenge by signing the nonce with the node's Identity.
 */

import { WebSocket } from 'ws';
import type { Identity } from '../core/identity';
import type { WireEnvelope } from '../core/transport';
import type { Delivery, PeerTransport } from './peer-transport';
import type { ClientMsg, ServerMsg } from './wire-protocol';

export class RelayClient implements PeerTransport {
  private ws?: WebSocket;
  private onDelivery?: (d: Delivery) => void;
  private sendWaiters: ((r: { accepted: boolean; reason?: string }) => void)[] = [];
  private subResolve?: () => void;
  private subReject?: (reason: string) => void;

  /** `identity` is required only to DRAIN a mailbox (answer the auth challenge). */
  constructor(private readonly url: string, private readonly identity?: Identity) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => this.onServer(JSON.parse(raw.toString()) as ServerMsg));
    });
  }

  private onServer(m: ServerMsg): void {
    switch (m.t) {
      case 'accepted':
        this.sendWaiters.shift()?.({ accepted: true });
        break;
      case 'rejected':
        this.sendWaiters.shift()?.({ accepted: false, reason: m.reason });
        break;
      case 'challenge':
        if (this.identity) this.raw({ t: 'auth', pubKey: this.identity.pubKey, sig: this.identity.sign(m.nonce) });
        break;
      case 'subscribed':
        this.subResolve?.();
        break;
      case 'auth_rejected':
        this.subReject?.(m.reason);
        break;
      case 'deliver':
        this.onDelivery?.({ mailId: m.mailId, env: m.env });
        break;
    }
  }

  async send(env: WireEnvelope): Promise<{ accepted: boolean; reason?: string }> {
    return new Promise((resolve) => {
      this.sendWaiters.push(resolve);
      this.raw({ t: 'send', env });
    });
  }

  async subscribe(fingerprint: string, onDelivery: (d: Delivery) => void): Promise<() => void> {
    this.onDelivery = onDelivery;
    const done = new Promise<void>((resolve, reject) => {
      this.subResolve = resolve;
      this.subReject = (reason) => reject(new Error(reason));
    });
    this.raw({ t: 'subscribe', fingerprint });
    await done;
    return () => this.close();
  }

  async ack(mailIds: string[]): Promise<void> {
    this.raw({ t: 'ack', mailIds });
  }

  close(): void {
    this.ws?.close();
  }

  private raw(m: ClientMsg): void {
    this.ws?.send(JSON.stringify(m));
  }
}
