import { describe, it, expect, afterEach } from 'vitest';
import { A2ABridge, negotiateOverA2A } from '../src/a2a/bridge';
import { startA2AServer, type RunningA2A } from '../src/a2a/server';
import { KINWEAVE_P2P_EXT } from '../src/a2a/agent-card';
import { Node } from '../src/portable/crypto';
import { makePair, ava, ben } from '../src/sim/fixtures';
import { approveAll } from '../src/persona/owner';
import { negotiate } from '../src/core/state-machine';
import type { AgentCard, JsonRpcResponse } from '../src/a2a/types';

describe('A2A bridge — discoverable Agent Card + negotiation over JSON-RPC', () => {
  let server: RunningA2A | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('serves a valid Agent Card advertising the negotiate-hangout skill', async () => {
    const bridge = new A2ABridge(new Node(), ben, "Ben's Kinweave agent");
    server = await startA2AServer(bridge);
    const card = (await (await fetch(`http://127.0.0.1:${server.port}/.well-known/agent-card.json`)).json()) as AgentCard;

    expect(card.protocolVersion).toBeTruthy();
    expect(card.url).toBe(server.url);
    expect(card.skills[0]!.id).toBe('negotiate-hangout');
    const ext = card.capabilities.extensions?.find((e) => e.uri.startsWith(KINWEAVE_P2P_EXT));
    expect(ext?.params?.ownerId).toBe(ben.ownerId); // native Kinweave peers can still discover the P2P beacon
  });

  it('two agents negotiate a committed hangout over A2A message/send', async () => {
    const bridge = new A2ABridge(new Node(), ben, "Ben's agent");
    server = await startA2AServer(bridge);
    const cardUrl = `http://127.0.0.1:${server.port}/.well-known/agent-card.json`;

    const hangout = await negotiateOverA2A(new Node(), ava, cardUrl);

    const ref = negotiate(...makePair(ava, ben, approveAll, approveAll));
    expect(hangout).toBeTruthy();
    expect(hangout!.versionHash).toBe(ref.artifact!.versionHash);
    expect(hangout!.plan.place.isPublic).toBe(true);
  }, 20000);

  it('rejects an unknown JSON-RPC method per spec', async () => {
    const bridge = new A2ABridge(new Node(), ben, "Ben's agent");
    server = await startA2AServer(bridge);
    const resp = (await (
      await fetch(server.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'does/notExist', params: {} }),
      })
    ).json()) as JsonRpcResponse;
    expect(resp.error?.code).toBe(-32601);
  });
});
