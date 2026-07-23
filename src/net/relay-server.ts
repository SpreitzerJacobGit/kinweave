/**
 * WebSocket store-and-forward relay (Zone T infrastructure). Untrusted: it
 * verifies the sender's signature over the ciphertext, stores sealed envelopes
 * keyed by recipient fingerprint, and delivers them — but holds no key and can
 * never read a message. Draining a mailbox requires proving you hold its key
 * (challenge-response), so a stranger cannot delete your mail. See spec/08.
 *
 * Run standalone: `tsx src/net/relay-server.ts [port]`.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { fingerprint, verifySig } from '../core/identity';
import { signedBody, type WireEnvelope } from '../core/transport';
import type { ClientMsg, ServerMsg } from './wire-protocol';
import { CommunityBoardStore, handleCommunityMsg } from './community-board';

interface Stored {
  mailId: string;
  env: WireEnvelope;
}

export class RelayServer {
  private wss?: WebSocketServer;
  private mail = new Map<string, Stored[]>();
  private subs = new Map<string, WebSocket>();
  private board = new CommunityBoardStore();
  private counter = 0;
  private mailboxTtlMs = 14 * 24 * 60 * 60 * 1000; // 14 days (sweep hook; unused in MVP tests)

  start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port });
      this.wss.on('error', reject);
      this.wss.on('listening', () => {
        const addr = this.wss!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
      this.wss.on('connection', (ws) => this.onConnection(ws));
    });
  }

  private onConnection(ws: WebSocket): void {
    let requested = '';
    let nonce = '';
    let authed = '';
    const reply = (m: ServerMsg) => ws.send(JSON.stringify(m));
    const deliver = (sock: WebSocket, s: Stored) => sock.send(JSON.stringify({ t: 'deliver', mailId: s.mailId, env: s.env } satisfies ServerMsg));

    ws.on('message', (raw) => {
      let m: ClientMsg;
      try {
        m = JSON.parse(raw.toString()) as ClientMsg;
      } catch {
        return;
      }
      if (m.t === 'send') {
        if (!verifySig(m.env.from, signedBody(m.env), m.env.sig)) return reply({ t: 'rejected', reason: 'bad-signature' });
        const stored: Stored = { mailId: `mail-${++this.counter}`, env: m.env };
        const q = this.mail.get(m.env.to) ?? [];
        q.push(stored);
        this.mail.set(m.env.to, q);
        const live = this.subs.get(m.env.to);
        if (live && live.readyState === WebSocket.OPEN) deliver(live, stored);
        reply({ t: 'accepted' });
      } else if (m.t === 'subscribe') {
        requested = m.fingerprint;
        nonce = `nonce-${++this.counter}-${requested}`;
        reply({ t: 'challenge', nonce });
      } else if (m.t === 'auth') {
        if (fingerprint(m.pubKey) !== requested) return reply({ t: 'auth_rejected', reason: 'fingerprint-mismatch' });
        if (!verifySig(m.pubKey, nonce, m.sig)) return reply({ t: 'auth_rejected', reason: 'bad-signature' });
        authed = requested;
        this.subs.set(authed, ws);
        reply({ t: 'subscribed' });
        for (const s of this.mail.get(authed) ?? []) deliver(ws, s);
      } else if (m.t === 'ack') {
        if (!authed) return;
        const q = this.mail.get(authed) ?? [];
        this.mail.set(authed, q.filter((s) => !m.mailIds.includes(s.mailId)));
      } else if (m.t === 'post_beacon' || m.t === 'sub_community' || m.t === 'unsub_community') {
        handleCommunityMsg(this.board, ws, m, (msg) => ws.send(JSON.stringify(msg)));
      }
    });

    ws.on('close', () => {
      if (authed && this.subs.get(authed) === ws) this.subs.delete(authed);
      this.board.removeSocket(ws);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) return resolve();
      for (const s of this.subs.values()) s.close();
      this.wss.close(() => resolve());
    });
  }
}

// Standalone entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 8787);
  new RelayServer().start(port).then((p) => process.stdout.write(`kinweave relay listening on ws://127.0.0.1:${p}\n`));
}
