import { describe, it, expect } from 'vitest';
import { CommunityBook } from '../src/portable/community-book';
import { mintCommunity, rotateCommunity, type CommunityDescriptorV1 } from '../src/portable/community';
import { Node } from '../src/portable/crypto';

function mkDescriptor(name = 'Northside Climbers', relays: string[] = ['ws://r']): CommunityDescriptorV1 {
  return mintCommunity({ name, relays }).descriptor;
}

describe('CommunityBook', () => {
  it('creates a community, stores it with its secret, and makes it active', () => {
    const book = new CommunityBook();
    const founder = new Node().identity.pubKey;
    const c = book.create({ name: 'Board Gamers', founder, relays: ['ws://r'] });
    expect(book.list()).toHaveLength(1);
    expect(book.activeId()).toBe(c.descriptor.community.id);
    expect(c.secret).toBeTruthy(); // we minted it → we hold the rotate key
    expect(c.descriptor.trustRoots).toContain(founder);
  });

  it('joins a valid descriptor and rejects a tampered one', () => {
    const book = new CommunityBook();
    const d = mkDescriptor();
    expect(book.join(d).ok).toBe(true);
    expect(book.get(d.community.id)).toBeTruthy();
    expect(book.list()[0]!.secret).toBeUndefined(); // joined, not minted → no secret

    const tampered: CommunityDescriptorV1 = { ...d, relays: ['ws://evil'] };
    const r = book.join(tampered);
    expect(r).toEqual({ ok: false, reason: 'invalid-or-expired-descriptor' });
  });

  it('rejects an expired descriptor', () => {
    const { descriptor } = mintCommunity({ name: 'X', relays: [], ttlMs: 1000, now: 0 });
    const book = new CommunityBook();
    expect(book.join(descriptor, 5000)).toEqual({ ok: false, reason: 'invalid-or-expired-descriptor' });
    expect(book.join(descriptor, 500).ok).toBe(true); // still valid before exp
  });

  it('dedups by community id (re-join replaces, keeps our mint secret)', () => {
    const book = new CommunityBook();
    const created = book.create({ name: 'Mine', relays: ['ws://r'] });
    const id = created.descriptor.community.id;
    // A re-scan of our own community (no secret in the scanned descriptor) must not drop the secret.
    const rescan = book.join(created.descriptor);
    expect(rescan.ok).toBe(true);
    expect(book.list()).toHaveLength(1);
    expect(book.get(id)!.secret).toBeTruthy();
  });

  it('switches the active community and validates the target exists', () => {
    const book = new CommunityBook();
    const a = book.create({ name: 'A', relays: [] });
    const b = book.create({ name: 'B', relays: [] });
    expect(book.activeId()).toBe(b.descriptor.community.id); // create makes it active
    expect(book.setActive(a.descriptor.community.id)).toBe(true);
    expect(book.activeId()).toBe(a.descriptor.community.id);
    expect(book.setActive('kw_nonexistent')).toBe(false);
    expect(book.setActive(null)).toBe(true);
    expect(book.activeId()).toBeNull();
  });

  it('removing the active community falls back to another (or null)', () => {
    const book = new CommunityBook();
    const a = book.create({ name: 'A', relays: [] });
    const b = book.create({ name: 'B', relays: [] });
    book.setActive(b.descriptor.community.id);
    book.remove(b.descriptor.community.id);
    expect(book.activeId()).toBe(a.descriptor.community.id);
    book.remove(a.descriptor.community.id);
    expect(book.activeId()).toBeNull();
    expect(book.list()).toHaveLength(0);
  });

  it('round-trips through JSON, preserving active selection and secrets', () => {
    const book = new CommunityBook();
    book.create({ name: 'A', relays: ['ws://r'] });
    const b = book.create({ name: 'B', relays: [] });
    book.setActive(b.descriptor.community.id);

    const restored = CommunityBook.fromJSON(book.toJSON());
    expect(restored.activeId()).toBe(book.activeId());
    expect(restored.list()).toHaveLength(2);
    expect(restored.active()!.secret).toBeTruthy();
  });

  it('accepts a rotated descriptor (higher epoch) as a re-join', () => {
    const { descriptor, secret } = mintCommunity({ name: 'Rotating', relays: ['ws://r'] });
    const book = new CommunityBook();
    book.join(descriptor);
    const rotated = rotateCommunity(descriptor, secret, { relays: ['ws://r2'] });
    expect(book.join(rotated).ok).toBe(true);
    expect(book.get(descriptor.community.id)!.descriptor.relays).toEqual(['ws://r2']);
    expect(book.get(descriptor.community.id)!.descriptor.community.epoch).toBe(1);
  });
});
