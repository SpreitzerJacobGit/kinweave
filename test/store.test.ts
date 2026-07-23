import { describe, it, expect } from 'vitest';
import { Identity, verifySig } from '../src/core/identity';
import { EncryptionKey } from '../src/core/transport';
import { Clock } from '../src/core/clock';
import { ConsentLedger } from '../src/core/consent-ledger';
import { MemoryDeviceStore } from '../src/store/memory-store';
import { exportAccount, importAccount, sealBundle, openBundle } from '../src/store/account-export';
import { ava } from '../src/sim/fixtures';

describe('key export/import — identity survives a device move', () => {
  it('an Ed25519 identity restored from its seed keeps the same public key and can sign', () => {
    const id = new Identity();
    const restored = Identity.fromSeed(id.exportSeed());
    expect(restored.pubKey).toBe(id.pubKey);
    expect(restored.id).toBe(id.id);
    const sig = restored.sign({ x: 1 });
    expect(verifySig(id.pubKey, { x: 1 }, sig)).toBe(true);
  });

  it('an X25519 encryption key restored from its seed still decrypts what its old self was sent', () => {
    const alice = new EncryptionKey();
    const bob = new EncryptionKey();
    const box = alice.sealTo(bob.pubKey, 'hi bob');
    const bobRestored = EncryptionKey.fromSeed(bob.exportSeed());
    expect(bobRestored.pubKey).toBe(bob.pubKey);
    expect(bobRestored.open(alice.pubKey, box)).toBe('hi bob');
  });
});

describe('consent ledger export/import round-trips and keeps appending', () => {
  it('rebuilds from persisted events and continues the sequence without id collision', () => {
    const l = new ConsentLedger('owner-x', new Clock());
    l.append({ type: 'consent-grant', counterpart: 'owner-y', tierTo: 2 });
    l.append({ type: 'disclosure-out', counterpart: 'owner-y', fields: ['activityClass'] });
    const events = l.exportEvents();

    const l2 = ConsentLedger.fromEvents('owner-x', new Clock(), events);
    expect(l2.all()).toHaveLength(2);
    const next = l2.append({ type: 'disclosure-out', counterpart: 'owner-y', fields: ['firstName'] });
    expect(next.seq).toBe(3);
    // id must not collide with the imported events
    expect(events.map((e) => e.id)).not.toContain(next.id);
  });
});

describe('DeviceStore + account export', () => {
  it('persists keys/profile/ledger and passphrase-seals a portable bundle', async () => {
    const store = new MemoryDeviceStore();
    const id = new Identity();
    const enc = new EncryptionKey();
    await store.keys.saveKeys({ idSeed: id.exportSeed(), encSeed: enc.exportSeed() });
    await store.profile.saveProfile(ava);
    await store.ledger.appendEvent({ id: 'owner-ava-evt-1', seq: 1, ts: 1, type: 'consent-grant', counterpart: 'owner-ben', tierTo: 2 });

    const bundle = await exportAccount(store);
    const passphrase = 'correct horse battery staple';
    const sealed = sealBundle(bundle, passphrase);

    // Wrong passphrase fails closed.
    expect(openBundle(sealed, 'wrong')).toBeNull();

    // Right passphrase restores onto a fresh device.
    const opened = openBundle(sealed, passphrase)!;
    const store2 = new MemoryDeviceStore();
    await importAccount(store2, opened);

    const keys2 = await store2.keys.loadKeys();
    expect(Identity.fromSeed(keys2!.idSeed).pubKey).toBe(id.pubKey);
    expect((await store2.profile.loadProfile())?.handle).toBe(ava.handle);
    expect(await store2.ledger.allEvents()).toHaveLength(1);
  });
});
