import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type RunningServer } from '../server/index';
import { Node } from '../src/portable/crypto';
import { KinweaveAgent } from '../src/portable/agent';
import { makePair, ava, ben } from '../src/sim/fixtures';
import { approveAll } from '../src/persona/owner';
import { negotiate } from '../src/core/state-machine';

/**
 * Proves the Claude-connector path end-to-end WITHOUT Claude: two KinweaveAgents
 * (what the MCP server wraps) reach a committed hangout over the real relay,
 * driven exactly as Claude would drive the tools — connect with a code, then
 * approve each gate as it appears.
 */
describe('MCP agent — two devices connect by code and negotiate a hangout', () => {
  let server: RunningServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('makeConnectCode -> useConnectCode -> approve gates -> committed', async () => {
    server = await startServer(0);
    const url = `ws://127.0.0.1:${server.port}/relay`;

    const A = new KinweaveAgent(new Node(), ava, url); // scanner / initiator
    const B = new KinweaveAgent(new Node(), ben, url); // shows the code / responder

    const codeB = await B.makeConnectCode();
    await A.useConnectCode(codeB);

    const drive = async (ag: KinweaveAgent) => {
      let guard = 0;
      while (!ag.status().outcome && guard++ < 40) {
        await ag.waitForNext(8000);
        if (ag.status().pendingApproval) ag.approve();
      }
    };
    await Promise.all([drive(A), drive(B)]);

    expect(A.status().outcome).toBe('committed');
    expect(B.status().outcome).toBe('committed');
    expect(A.status().hangout).toBeTruthy();

    // The committed plan matches the reference negotiation.
    const ref = negotiate(...makePair(ava, ben, approveAll, approveAll));
    expect(A.status().hangout).toContain(ref.artifact!.plan.time.date);

    A.close();
    B.close();
  }, 30000);
});
