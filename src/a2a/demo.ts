/**
 * Live A2A demo: `npm run a2a:demo`. Starts Ben's Kinweave agent as an A2A HTTP
 * service (Agent Card + JSON-RPC), then has Ava's agent discover it and negotiate
 * a hangout over standard A2A message/send.
 */

import { A2ABridge, negotiateOverA2A } from './bridge';
import { startA2AServer } from './server';
import { Node } from '../portable/crypto';
import { ava, ben } from '../sim/fixtures';

const w = (s = '') => process.stdout.write(s + '\n');

const bridge = new A2ABridge(new Node(), ben, "Ben's Kinweave agent");
const server = await startA2AServer(bridge);

w();
w("Ben's agent is live over A2A:");
w(`  Agent Card:  http://127.0.0.1:${server.port}/.well-known/agent-card.json`);
w(`  JSON-RPC:    ${server.url}`);
w();
w('Any A2A client can discover it, e.g.:');
w(`  curl -s http://127.0.0.1:${server.port}/.well-known/agent-card.json`);
w();
w("Ava's agent now discovers Ben's card and negotiates a hangout over A2A...");

const hangout = await negotiateOverA2A(new Node(), ava, `http://127.0.0.1:${server.port}/.well-known/agent-card.json`);

if (hangout) {
  const p = hangout.plan;
  w();
  w(`COMMITTED HANGOUT  (${hangout.versionHash})`);
  w(`  activity: ${p.activity.specific || p.activity.class}`);
  w(`  place:    ${p.place.name ?? p.place.type}  (public=${p.place.isPublic})`);
  w(`  time:     ${p.time?.date ?? ''} ${p.time?.start ?? ''}`);
  w(`  match:    ${hangout.compatibilityRationale.label}`);
} else {
  w('\nNo match this time.');
}

// Exit cleanly (the OS reclaims the port); avoids a libuv mid-close race on Windows.
process.exit(0);
