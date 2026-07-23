/** Client <-> relay framing (portable crypto variant). See src/net/wire-protocol.ts. */
import type { WireEnvelope } from './crypto';
import type { CommunityClientMsg, CommunityServerMsg } from '../net/community-board';

export type ClientMsg =
  | { t: 'send'; env: WireEnvelope }
  | { t: 'subscribe'; fingerprint: string }
  | { t: 'auth'; pubKey: string; sig: string }
  | { t: 'ack'; mailIds: string[] }
  | CommunityClientMsg;

export type ServerMsg =
  | { t: 'accepted' }
  | { t: 'rejected'; reason: string }
  | { t: 'challenge'; nonce: string }
  | { t: 'subscribed' }
  | { t: 'auth_rejected'; reason: string }
  | { t: 'deliver'; mailId: string; env: WireEnvelope }
  | CommunityServerMsg;
