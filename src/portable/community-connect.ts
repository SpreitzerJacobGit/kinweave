/**
 * Networked discovery client (spec/10 §3–4). Joins a community board over the
 * SAME relay socket that carries mailbox envelopes (multiplexed — one connection),
 * posts this node's signed T0 beacon, and keeps a verified local mirror of the
 * other members. Every beacon read off the wire is RE-VERIFIED here — the board
 * is untrusted transport, so members are never taken on faith.
 *
 * Discovery only. Turning a discovered member into a real connection reuses the
 * existing gated pairwise negotiation (build an invite from their beacon); this
 * module never negotiates and never sees a preference.
 */

import { connectRelay, type RelayConn, type RelayConnOptions } from './relay-connect';
import { verifySig, beaconBody, fingerprint, type Node, type PresenceBeacon, type WireEnvelope } from './crypto';
import type { CommunityServerMsg } from '../net/community-board';

export interface CommunityMember {
  beacon: PresenceBeacon;
  id: string; // counterpart fingerprint
}

export interface JoinOptions {
  hobbyTags: string[];
  geoCell: string;
  /** Called whenever the verified member list changes. */
  onMembers?: (members: CommunityMember[]) => void;
  /** Mailbox envelopes (for a negotiation running over the same socket). */
  onEnvelope?: (env: WireEnvelope) => void;
}

/**
 * A live membership in one community: the shared relay connection + a verified
 * mirror of the community's beacons. The connection is reused for any pairwise
 * negotiation the caller starts (pass `onEnvelope`), so a node holds ONE socket.
 */
export class CommunityMembership {
  private conn: RelayConn | null = null;
  private mirror = new Map<string, PresenceBeacon>(); // pubKey -> verified beacon
  private onMembers?: (members: CommunityMember[]) => void;

  constructor(
    private readonly node: Node,
    private readonly relayUrl: string,
    private readonly communityId: string,
  ) {}

  /** Connect, subscribe to the community, and announce this node's presence. */
  async join(opts: JoinOptions): Promise<void> {
    this.onMembers = opts.onMembers;
    const relayOpts: RelayConnOptions = { onCommunity: (m) => this.handle(m) };
    this.conn = await connectRelay(this.relayUrl, this.node.identity, (env) => opts.onEnvelope?.(env), relayOpts);
    this.conn.subCommunity(this.communityId);
    const beacon = this.node.beacon(this.communityId, opts.hobbyTags, opts.geoCell);
    this.conn.postBeacon(this.communityId, beacon);
  }

  /** The verified members currently on the board (excluding self). */
  members(): CommunityMember[] {
    const me = this.node.identity.pubKey;
    return [...this.mirror.values()]
      .filter((b) => b.pubKey !== me)
      .map((b) => ({ beacon: b, id: fingerprint(b.pubKey) }));
  }

  /** The shared connection — reuse it to run a gated pairwise negotiation. */
  connection(): RelayConn | null {
    return this.conn;
  }

  close(): void {
    this.conn?.unsubCommunity(this.communityId);
    this.conn?.close();
  }

  private handle(m: CommunityServerMsg): void {
    if (m.t !== 'community_beacons' || m.community !== this.communityId) return;
    this.mirror.clear();
    for (const b of m.beacons) {
      // Re-verify on read; the medium is untrusted. A beacon may only claim this community.
      if (b.community === this.communityId && verifySig(b.pubKey, beaconBody(b), b.sig)) this.mirror.set(b.pubKey, b);
    }
    this.onMembers?.(this.members());
  }
}
