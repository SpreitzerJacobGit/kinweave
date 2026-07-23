/**
 * Client <-> relay framing (distinct from the peer<->peer `WireEnvelope`, which
 * the relay only forwards). Sending needs a valid envelope signature; DRAINING a
 * mailbox needs a challenge-response proving you hold the mailbox's key.
 */

import type { WireEnvelope } from '../core/transport';

export type ClientMsg =
  | { t: 'send'; env: WireEnvelope }
  | { t: 'subscribe'; fingerprint: string }
  | { t: 'auth'; pubKey: string; sig: string }
  | { t: 'ack'; mailIds: string[] };

export type ServerMsg =
  | { t: 'accepted' }
  | { t: 'rejected'; reason: string }
  | { t: 'challenge'; nonce: string }
  | { t: 'subscribed' }
  | { t: 'auth_rejected'; reason: string }
  | { t: 'deliver'; mailId: string; env: WireEnvelope };
