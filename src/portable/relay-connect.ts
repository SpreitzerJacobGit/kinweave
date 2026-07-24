/**
 * Connect to the relay from either the browser (native WebSocket) or Node (the
 * `ws` package, dynamically imported only when there's no global WebSocket).
 * Answers the mailbox-drain auth challenge by signing the nonce. One code path,
 * both runtimes.
 */

import type { Identity, WireEnvelope, PresenceBeacon, OpenCall } from './crypto';
import type { ClientMsg, ServerMsg } from './wire-protocol';
import type { CommunityServerMsg } from '../net/community-board';
import type { IntentServerMsg } from '../net/intent-board';

export interface RelayConn {
  send(env: WireEnvelope): void;
  /** Post a signed T0 beacon into a community board. */
  postBeacon(community: string, beacon: PresenceBeacon): void;
  /** Subscribe to a community board (public read; snapshot + live pushes). */
  subCommunity(community: string): void;
  unsubCommunity(community: string): void;
  /** Post a signed OpenCall into a community intent board. */
  postCall(community: string, call: OpenCall): void;
  /** Subscribe to a community intent board (public read; snapshot + live pushes). */
  subCalls(community: string): void;
  unsubCalls(community: string): void;
  close(): void;
}

export interface RelayConnOptions {
  /** Community board frames (multiplexed over the same socket). */
  onCommunity?: (m: CommunityServerMsg) => void;
  /** Intent board frames (multiplexed over the same socket). */
  onIntent?: (m: IntentServerMsg) => void;
}

export async function connectRelay(
  url: string,
  identity: Identity,
  onEnvelope: (env: WireEnvelope) => void,
  opts: RelayConnOptions = {},
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
      else if (m.t === 'subscribed')
        resolve({
          send: (env) => raw({ t: 'send', env }),
          postBeacon: (community, beacon) => raw({ t: 'post_beacon', community, beacon }),
          subCommunity: (community) => raw({ t: 'sub_community', community }),
          unsubCommunity: (community) => raw({ t: 'unsub_community', community }),
          postCall: (community, call) => raw({ t: 'post_call', community, call }),
          subCalls: (community) => raw({ t: 'sub_calls', community }),
          unsubCalls: (community) => raw({ t: 'unsub_calls', community }),
          close: () => ws.close(),
        });
      else if (m.t === 'auth_rejected') reject(new Error(m.reason));
      else if (m.t === 'deliver') {
        onEnvelope(m.env);
        raw({ t: 'ack', mailIds: [m.mailId] });
      } else if (m.t === 'community_beacons' || m.t === 'post_ok' || m.t === 'post_rejected') {
        opts.onCommunity?.(m);
      } else if (m.t === 'community_calls' || m.t === 'call_ok' || m.t === 'call_rejected') {
        opts.onIntent?.(m);
      }
    };
  });
}
