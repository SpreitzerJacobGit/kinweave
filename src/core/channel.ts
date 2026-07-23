/**
 * In-memory pull-delivery mailbox between two Personas.
 *
 * Delivery is PULL, never push: a message is returned as data when the recipient
 * calls `read()`; it is never injected into the recipient's context. The full
 * transcript is retained and is observable by both owners (full observability).
 * See spec/02-message-schema.md.
 */

import type { Message } from '../types/envelope';

export class Channel {
  private log: Message[] = [];
  private seq = 0;

  constructor(public readonly channelId: string) {}

  /** Post a message. The channel stamps the monotonic per-channel seq. */
  post(msg: Message): Message {
    const stamped: Message = {
      ...msg,
      env: { ...msg.env, channelId: this.channelId, seq: ++this.seq },
    };
    this.log.push(stamped);
    return stamped;
  }

  /** Pull-delivery: messages after `sinceSeq`, optionally addressed from a peer. */
  read(sinceSeq = 0, fromPersona?: string): Message[] {
    return this.log.filter(
      (m) =>
        m.env.seq > sinceSeq &&
        (fromPersona === undefined || m.env.fromPersona === fromPersona),
    );
  }

  /** The complete, observable transcript. */
  transcript(): readonly Message[] {
    return this.log;
  }
}
