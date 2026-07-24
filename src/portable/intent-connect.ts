/**
 * Networked intent client (spec/10 — structured intent coordination). The
 * sibling of CommunityMembership (community-connect.ts): joins a community's
 * INTENT board over the SAME relay socket that carries mailbox envelopes and the
 * presence board (multiplexed — one connection), optionally posts this node's
 * signed OpenCall, and keeps a RE-VERIFIED local mirror of the other members'
 * calls. Every call read off the wire is re-verified here — the board is
 * untrusted transport, so calls are never taken on faith.
 *
 * Transport only. Matching (matchCall) and turning a matched call into a real
 * connection (the gated pairwise negotiation) happen in the caller — this module
 * never scores a preference and never negotiates.
 */

import { connectRelay, type RelayConn, type RelayConnOptions } from './relay-connect';
import { verifySig, callBody, type Node, type OpenCall, type WireEnvelope } from './crypto';
import type { IntentServerMsg } from '../net/intent-board';

export interface JoinIntentOptions {
  /** This node's own OpenCall to publish on join (optional — a lurker may just read). */
  call?: OpenCall;
  /** Called whenever the verified call list changes. */
  onCalls?: (calls: OpenCall[]) => void;
  /** Mailbox envelopes (for a negotiation running over the same socket). */
  onEnvelope?: (env: WireEnvelope) => void;
}

/**
 * A live membership in one community's intent board: the shared relay connection
 * + a verified mirror of the community's OpenCalls. The connection is reused for
 * any pairwise negotiation the caller starts (pass `onEnvelope`), so a node holds
 * ONE socket.
 */
export class IntentBoardMembership {
  private conn: RelayConn | null = null;
  private mirror = new Map<string, OpenCall>(); // pubKey -> verified call
  private onCalls?: (calls: OpenCall[]) => void;

  constructor(
    private readonly node: Node,
    private readonly relayUrl: string,
    private readonly communityId: string,
  ) {}

  /** Connect, subscribe to the intent board, and (optionally) publish our own call. */
  async join(opts: JoinIntentOptions = {}): Promise<void> {
    this.onCalls = opts.onCalls;
    const relayOpts: RelayConnOptions = { onIntent: (m) => this.handle(m) };
    this.conn = await connectRelay(this.relayUrl, this.node.identity, (env) => opts.onEnvelope?.(env), relayOpts);
    this.conn.subCalls(this.communityId);
    if (opts.call) this.conn.postCall(this.communityId, opts.call);
  }

  /** Publish (or replace) this node's OpenCall on the board. */
  postCall(call: OpenCall): void {
    this.conn?.postCall(this.communityId, call);
  }

  /** The verified calls currently on the board (excluding our own). */
  calls(): OpenCall[] {
    const me = this.node.identity.pubKey;
    return [...this.mirror.values()].filter((c) => c.pubKey !== me);
  }

  /** The shared connection — reuse it to run a gated pairwise negotiation. */
  connection(): RelayConn | null {
    return this.conn;
  }

  close(): void {
    this.conn?.unsubCalls(this.communityId);
    this.conn?.close();
  }

  private handle(m: IntentServerMsg): void {
    if (m.t !== 'community_calls' || m.community !== this.communityId) return;
    this.mirror.clear();
    for (const c of m.calls) {
      // Re-verify on read; the medium is untrusted. A call may only claim this community.
      if (c.community === this.communityId && verifySig(c.pubKey, callBody(c), c.sig)) this.mirror.set(c.pubKey, c);
    }
    this.onCalls?.(this.calls());
  }
}
