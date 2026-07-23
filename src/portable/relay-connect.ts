/**
 * Connect to the relay from either the browser (native WebSocket) or Node (the
 * `ws` package, dynamically imported only when there's no global WebSocket).
 * Answers the mailbox-drain auth challenge by signing the nonce. One code path,
 * both runtimes.
 */

import type { Identity, WireEnvelope } from './crypto';
import type { ClientMsg, ServerMsg } from './wire-protocol';

export interface RelayConn {
  send(env: WireEnvelope): void;
  close(): void;
}

export async function connectRelay(
  url: string,
  identity: Identity,
  onEnvelope: (env: WireEnvelope) => void,
): Promise<RelayConn> {
  const g = globalThis as unknown as { WebSocket?: unknown };
  const WSImpl = (g.WebSocket ?? (await import('ws')).WebSocket) as unknown as {
    new (u: string): {
      onopen: (() => void) | null;
      onerror: ((e: unknown) => void) | null;
      onmessage: ((ev: { data: unknown }) => void) | null;
      send(d: string): void;
      close(): void;
    };
  };
  const ws = new WSImpl(url);
  const raw = (m: ClientMsg) => ws.send(JSON.stringify(m));

  return await new Promise<RelayConn>((resolve, reject) => {
    ws.onerror = (e) => reject(e);
    ws.onopen = () => raw({ t: 'subscribe', fingerprint: identity.id });
    ws.onmessage = (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
      let m: ServerMsg;
      try {
        m = JSON.parse(data) as ServerMsg;
      } catch {
        return;
      }
      if (m.t === 'challenge') raw({ t: 'auth', pubKey: identity.pubKey, sig: identity.sign(m.nonce) });
      else if (m.t === 'subscribed') resolve({ send: (env) => raw({ t: 'send', env }), close: () => ws.close() });
      else if (m.t === 'auth_rejected') reject(new Error(m.reason));
      else if (m.t === 'deliver') {
        onEnvelope(m.env);
        raw({ t: 'ack', mailIds: [m.mailId] });
      }
    };
  });
}
