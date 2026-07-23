/**
 * Build an A2A Agent Card for a Kinweave agent. Served at
 * /.well-known/agent-card.json so any A2A client can discover it. Advertises the
 * `negotiate-hangout` skill, and carries a Kinweave P2P extension (owner id +
 * signed beacon) so native Kinweave peers can also reach it over the relay.
 */

import type { AgentCard } from './types';
import type { PresenceBeacon } from '../portable/crypto';

export const KINWEAVE_P2P_EXT = 'https://kinweave.dev/ext/p2p/v1';

export function buildAgentCard(opts: { name: string; url: string; ownerId: string; beacon: PresenceBeacon }): AgentCard {
  return {
    protocolVersion: '0.3.0',
    name: opts.name,
    description:
      "A Kinweave personal agent. Negotiates a compatible local hangout with another person's agent on its owner's behalf — privacy-gated, with the owner approving each disclosure and the final plan.",
    url: opts.url,
    version: '0.1.0',
    preferredTransport: 'JSONRPC',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [
        {
          uri: KINWEAVE_P2P_EXT,
          description: 'Native Kinweave peer-to-peer discovery: signed presence beacon + relay, for end-to-end-encrypted negotiation without a central endpoint.',
          params: { ownerId: opts.ownerId, beacon: opts.beacon },
        },
      ],
    },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json', 'text/plain'],
    skills: [
      {
        id: 'negotiate-hangout',
        name: 'Negotiate a hangout',
        description:
          "Given another person's agent, privately negotiate a compatible local hangout (activity + place + time) and return a proposed plan. Each owner approves every disclosure and the final plan; raw preferences and exact location never leave the owner boundary.",
        tags: ['social', 'matchmaking', 'scheduling', 'kinweave'],
        examples: ["Connect with this person's agent and see if we can plan something to do together."],
      },
    ],
    provider: { organization: 'Kinweave', url: 'https://github.com/SpreitzerJacobGit/kinweave' },
  };
}
