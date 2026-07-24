/**
 * Public community INTENT board (spec/10 — structured intent coordination). The
 * sibling of the presence board (src/net/community-board.ts): the ONE shared
 * module both relays delegate to (server/index.ts `attachRelay` and
 * src/net/relay-server.ts), so intent logic lives in exactly one place and the
 * two relays cannot drift.
 *
 * Keyed by COMMUNITY ID. It stores ONLY public, signed OpenCall atoms — T0/T1
 * coarse fields, no coordinate, no exact time, no PII. Like the presence board it
 * can never read prefs, matchmake, or rank: it returns the raw verified call set
 * and ALL selection/matching happens client-side. Anti-abuse is structural:
 * signature gate, community-match gate, per-pubKey dedup (one active call per
 * caller, last-wins), self-expiry + TTL, per-community size cap, and a per-key
 * re-post rate limit. Uses portable crypto so the same verifier matches by
 * construction on both relays.
 */

import { verifySig, callBody, type OpenCall } from '../portable/crypto';

// ---- wire messages (folded into both ClientMsg/ServerMsg unions) -----------

export type IntentClientMsg =
  | { t: 'post_call'; community: string; call: OpenCall }
  | { t: 'sub_calls'; community: string }
  | { t: 'unsub_calls'; community: string };

export type IntentServerMsg =
  | { t: 'community_calls'; community: string; calls: OpenCall[] }
  | { t: 'call_ok'; community: string }
  | { t: 'call_rejected'; community: string; reason: string };

/** Minimal socket handle — both `ws` and the browser WebSocket satisfy it. */
export interface IntentBoardSocket {
  send(data: string): void;
}

export interface IntentBoardOptions {
  /** Upper bound on how long a posted call lives before it is swept (default 60 min). */
  ttlMs?: number;
  /** Max distinct calls (by pubKey) per community (default 10000). */
  maxPerCommunity?: number;
  /** Minimum interval between re-posts by the same key (default 500 ms). */
  minRepostMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface Entry {
  call: OpenCall;
  expiresAt: number;
}

export type PostResult = { ok: true } | { ok: false; reason: string };

export class IntentBoardStore {
  private boards = new Map<string, Map<string, Entry>>(); // communityId -> pubKey -> entry
  private subs = new Map<string, Set<IntentBoardSocket>>(); // communityId -> subscriber sockets
  private lastPost = new Map<string, number>(); // `${communityId}:${pubKey}` -> ts
  private readonly ttlMs: number;
  private readonly maxPerCommunity: number;
  private readonly minRepostMs: number;
  private readonly now: () => number;

  constructor(opts: IntentBoardOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
    this.maxPerCommunity = opts.maxPerCommunity ?? 10000;
    this.minRepostMs = opts.minRepostMs ?? 500;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Publish a signed OpenCall into a community. Broadcasts to subscribers on success. */
  post(communityId: string, call: OpenCall): PostResult {
    if (!verifySig(call.pubKey, callBody(call), call.sig)) return { ok: false, reason: 'bad-signature' };
    // A call may only enter the community it names — keeps community-match meaningful.
    if (call.community !== communityId) return { ok: false, reason: 'community-mismatch' };
    // A call that is already expired never enters the board.
    if (call.expiry <= this.now()) return { ok: false, reason: 'expired' };

    const rateKey = `${communityId}:${call.pubKey}`;
    const last = this.lastPost.get(rateKey);
    if (last !== undefined && this.now() - last < this.minRepostMs) return { ok: false, reason: 'rate-limited' };

    const board = this.boards.get(communityId) ?? new Map<string, Entry>();
    this.sweepBoard(board);
    if (!board.has(call.pubKey) && board.size >= this.maxPerCommunity) return { ok: false, reason: 'community-full' };

    // Honor the call's own expiry as well as the board's TTL ceiling.
    const expiresAt = Math.min(call.expiry, this.now() + this.ttlMs);
    board.set(call.pubKey, { call, expiresAt }); // dedup by pubKey (last-wins)
    this.boards.set(communityId, board);
    this.lastPost.set(rateKey, this.now());
    this.broadcast(communityId);
    return { ok: true };
  }

  /** Subscribe a socket and return the current live call snapshot. Public read. */
  subscribe(communityId: string, sock: IntentBoardSocket): OpenCall[] {
    const set = this.subs.get(communityId) ?? new Set<IntentBoardSocket>();
    set.add(sock);
    this.subs.set(communityId, set);
    return this.calls(communityId);
  }

  unsubscribe(communityId: string, sock: IntentBoardSocket): void {
    this.subs.get(communityId)?.delete(sock);
  }

  /** Drop a socket from every community it was subscribed to (call on ws close). */
  removeSocket(sock: IntentBoardSocket): void {
    for (const set of this.subs.values()) set.delete(sock);
  }

  /** Live (unexpired) calls for a community. */
  calls(communityId: string): OpenCall[] {
    const board = this.boards.get(communityId);
    if (!board) return [];
    this.sweepBoard(board);
    return [...board.values()].map((e) => e.call);
  }

  private broadcast(communityId: string): void {
    const set = this.subs.get(communityId);
    if (!set || set.size === 0) return;
    const msg: IntentServerMsg = { t: 'community_calls', community: communityId, calls: this.calls(communityId) };
    const data = JSON.stringify(msg);
    for (const sock of set) {
      try {
        sock.send(data);
      } catch {
        /* a dead socket is cleaned up on close */
      }
    }
  }

  private sweepBoard(board: Map<string, Entry>): void {
    const t = this.now();
    for (const [k, e] of board) if (e.expiresAt <= t) board.delete(k);
  }
}

/**
 * Delegate an intent-board wire message to the shared store. `send` replies to
 * the originating socket; the store broadcasts to community subscribers itself.
 */
export function handleIntentMsg(
  store: IntentBoardStore,
  sock: IntentBoardSocket,
  m: IntentClientMsg,
  send: (msg: IntentServerMsg) => void,
): void {
  if (m.t === 'post_call') {
    const r = store.post(m.community, m.call);
    send(r.ok ? { t: 'call_ok', community: m.community } : { t: 'call_rejected', community: m.community, reason: r.reason });
  } else if (m.t === 'sub_calls') {
    const calls = store.subscribe(m.community, sock);
    send({ t: 'community_calls', community: m.community, calls });
  } else if (m.t === 'unsub_calls') {
    store.unsubscribe(m.community, sock);
  }
}
