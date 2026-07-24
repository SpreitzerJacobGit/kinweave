/**
 * Public community board (spec/10 §3) — the ONE shared module both relays
 * delegate to (server/index.ts `attachRelay` and src/net/relay-server.ts), so the
 * board logic lives in exactly one place and the two relays cannot drift.
 *
 * Keyed by COMMUNITY ID (a separate concern from the point-to-point mailbox,
 * which is keyed by recipient fingerprint). It stores ONLY public, signed T0
 * presence beacons — it can never read prefs, matchmake, rank, or hold a private
 * key. Reads are public (beacons are T0) and re-verified client-side. Anti-abuse
 * is structural: signature gate, community-match gate, per-pubKey dedup, TTL,
 * per-community size cap, and a per-key re-post rate limit.
 *
 * Uses the portable crypto (beacons are always signed by portable crypto on the
 * clients), so the same verifier matches by construction on both relays.
 */

import { verifySig, beaconBody, type PresenceBeacon } from '../portable/crypto';

// ---- wire messages (folded into both ClientMsg/ServerMsg unions) -----------

export type CommunityClientMsg =
  | { t: 'post_beacon'; community: string; beacon: PresenceBeacon }
  | { t: 'sub_community'; community: string }
  | { t: 'unsub_community'; community: string };

export type CommunityServerMsg =
  | { t: 'community_beacons'; community: string; beacons: PresenceBeacon[] }
  | { t: 'post_ok'; community: string }
  | { t: 'post_rejected'; community: string; reason: string };

/** Minimal socket handle — both `ws` and the browser WebSocket satisfy it. */
export interface BoardSocket {
  send(data: string): void;
}

export interface BoardOptions {
  /** How long a posted beacon lives before it is swept (default 30 min). */
  ttlMs?: number;
  /** Max distinct beacons (by pubKey) per community (default 10000). */
  maxPerCommunity?: number;
  /** Minimum interval between re-posts by the same key (default 500 ms). */
  minRepostMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface Entry {
  beacon: PresenceBeacon;
  expiresAt: number;
}

/** Serializable form of the board (public signed beacons only — no sockets). */
export interface CommunityBoardSnapshot {
  boards: [string, Entry[]][]; // communityId -> live entries
  lastPost: [string, number][];
}

export type PostResult = { ok: true } | { ok: false; reason: string };

export class CommunityBoardStore {
  private boards = new Map<string, Map<string, Entry>>(); // communityId -> pubKey -> entry
  private subs = new Map<string, Set<BoardSocket>>(); // communityId -> subscriber sockets
  private lastPost = new Map<string, number>(); // `${communityId}:${pubKey}` -> ts
  private readonly ttlMs: number;
  private readonly maxPerCommunity: number;
  private readonly minRepostMs: number;
  private readonly now: () => number;

  constructor(opts: BoardOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 30 * 60 * 1000;
    this.maxPerCommunity = opts.maxPerCommunity ?? 10000;
    this.minRepostMs = opts.minRepostMs ?? 500;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Publish a signed T0 beacon into a community. Broadcasts to subscribers on success. */
  post(communityId: string, beacon: PresenceBeacon): PostResult {
    if (!verifySig(beacon.pubKey, beaconBody(beacon), beacon.sig)) return { ok: false, reason: 'bad-signature' };
    // A beacon may only enter the community it names — keeps community-match meaningful.
    if (beacon.community !== communityId) return { ok: false, reason: 'community-mismatch' };

    const rateKey = `${communityId}:${beacon.pubKey}`;
    const last = this.lastPost.get(rateKey);
    if (last !== undefined && this.now() - last < this.minRepostMs) return { ok: false, reason: 'rate-limited' };

    const board = this.boards.get(communityId) ?? new Map<string, Entry>();
    this.sweepBoard(board);
    if (!board.has(beacon.pubKey) && board.size >= this.maxPerCommunity) return { ok: false, reason: 'community-full' };

    board.set(beacon.pubKey, { beacon, expiresAt: this.now() + this.ttlMs }); // dedup by pubKey (last-wins)
    this.boards.set(communityId, board);
    this.lastPost.set(rateKey, this.now());
    this.broadcast(communityId);
    return { ok: true };
  }

  /** Subscribe a socket and return the current live beacon snapshot. Public read. */
  subscribe(communityId: string, sock: BoardSocket): PresenceBeacon[] {
    const set = this.subs.get(communityId) ?? new Set<BoardSocket>();
    set.add(sock);
    this.subs.set(communityId, set);
    return this.beacons(communityId);
  }

  unsubscribe(communityId: string, sock: BoardSocket): void {
    this.subs.get(communityId)?.delete(sock);
  }

  /** Drop a socket from every community it was subscribed to (call on ws close). */
  removeSocket(sock: BoardSocket): void {
    for (const set of this.subs.values()) set.delete(sock);
  }

  /** Live (unexpired) beacons for a community. */
  beacons(communityId: string): PresenceBeacon[] {
    const board = this.boards.get(communityId);
    if (!board) return [];
    this.sweepBoard(board);
    return [...board.values()].map((e) => e.beacon);
  }

  /**
   * Snapshot the live (unexpired) board for durability. Only public signed T0
   * presence beacons and re-post timestamps — never a socket or a private key.
   */
  toSnapshot(): CommunityBoardSnapshot {
    const boards: [string, Entry[]][] = [];
    for (const [c, m] of this.boards) {
      this.sweepBoard(m);
      if (m.size) boards.push([c, [...m.values()]]);
    }
    return { boards, lastPost: [...this.lastPost] };
  }

  /** Restore a snapshot on boot, dropping anything that expired while down. */
  loadSnapshot(snap: CommunityBoardSnapshot): void {
    const t = this.now();
    for (const [c, entries] of snap.boards) {
      const m = this.boards.get(c) ?? new Map<string, Entry>();
      for (const e of entries) if (e.expiresAt > t) m.set(e.beacon.pubKey, e);
      if (m.size) this.boards.set(c, m);
    }
    for (const [k, ts] of snap.lastPost) this.lastPost.set(k, ts);
  }

  private broadcast(communityId: string): void {
    const set = this.subs.get(communityId);
    if (!set || set.size === 0) return;
    const msg: CommunityServerMsg = { t: 'community_beacons', community: communityId, beacons: this.beacons(communityId) };
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
 * Delegate a community wire message to the shared store. `send` replies to the
 * originating socket; the store broadcasts to community subscribers itself.
 */
export function handleCommunityMsg(
  store: CommunityBoardStore,
  sock: BoardSocket,
  m: CommunityClientMsg,
  send: (msg: CommunityServerMsg) => void,
): void {
  if (m.t === 'post_beacon') {
    const r = store.post(m.community, m.beacon);
    send(r.ok ? { t: 'post_ok', community: m.community } : { t: 'post_rejected', community: m.community, reason: r.reason });
  } else if (m.t === 'sub_community') {
    const beacons = store.subscribe(m.community, sock);
    send({ t: 'community_beacons', community: m.community, beacons });
  } else if (m.t === 'unsub_community') {
    store.unsubscribe(m.community, sock);
  }
}
