import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type RunningServer } from '../server/index';
import { Node } from '../src/portable/crypto';
import { connectRelay } from '../src/portable/relay-connect';
import { Session } from '../src/portable/session';
import { NegotiationDriver } from '../src/core/negotiation-driver';
import { makePair, ava, ben } from '../src/sim/fixtures';
import { approveAll } from '../src/persona/owner';
import { negotiate } from '../src/core/state-machine';
import type { DriverTerminal } from '../src/types/negotiation';

describe('end-to-end over the real server (portable crypto + relay + session + driver)', () => {
  let server: RunningServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('two devices reach the same committed hangout; the relay only relays ciphertext', async () => {
    server = await startServer(0);
    const url = `ws://127.0.0.1:${server.port}/relay`;

    const [pa, pb] = makePair(ava, ben, approveAll, approveAll);
    const nodeA = new Node();
    const nodeB = new Node();
    const driverA = new NegotiationDriver(pa, pb.ownerId, 'initiator');
    const driverB = new NegotiationDriver(pb, pa.ownerId, 'responder');

    let doneA!: (t: DriverTerminal) => void;
    let doneB!: (t: DriverTerminal) => void;
    const termA = new Promise<DriverTerminal>((r) => (doneA = r));
    const termB = new Promise<DriverTerminal>((r) => (doneB = r));

    let sessA: Session;
    let sessB: Session;
    const connA = await connectRelay(url, nodeA.identity, (env) => sessA.onEnvelope(env));
    const connB = await connectRelay(url, nodeB.identity, (env) => sessB.onEnvelope(env));

    // Initiator knows the peer's node keys from the scanned QR beacon.
    sessA = new Session(nodeA, driverA, { pubKey: nodeB.identity.pubKey, encPubKey: nodeB.enc.pubKey }, {
      send: connA.send,
      onGateRequest: (req) => sessA.resolveGate(pa.decideGate(req)),
      onTerminal: doneA,
    });
    // Responder learns the peer from the first inbound envelope.
    sessB = new Session(nodeB, driverB, null, {
      send: connB.send,
      onGateRequest: (req) => sessB.resolveGate(pb.decideGate(req)),
      onTerminal: doneB,
    });

    sessB.start();
    sessA.start();

    const [ra, rb] = makePair(ava, ben, approveAll, approveAll);
    const ref = negotiate(ra, rb);

    const [ta, tb] = await Promise.all([termA, termB]);
    expect(ta.outcome).toBe('committed');
    expect(tb.outcome).toBe('committed');
    expect(ta.artifact?.versionHash).toBe(ref.artifact?.versionHash);
    expect(tb.artifact?.versionHash).toBe(ref.artifact?.versionHash);

    connA.close();
    connB.close();
  }, 20000);
});
