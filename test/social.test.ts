import { describe, it, expect } from 'vitest';
import {
  emptyStore,
  upsertConnection,
  renameConnection,
  addTag,
  removeTag,
  deleteConnection,
  createGroup,
  setInGroup,
  deleteGroup,
  allTags,
  connectionsList,
  groupsFor,
} from '../src/portable/social';

describe('social store — connections, tags, groups', () => {
  it('upserts connections and merges on re-connect', () => {
    const s = emptyStore();
    upsertConnection(s, { id: 'kw_a', name: 'Ada', when: 1 });
    upsertConnection(s, { id: 'kw_a', name: '', when: 2, hangout: 'coffee sat' }); // keeps name, adds hangout
    expect(s.connections['kw_a']!.name).toBe('Ada');
    expect(s.connections['kw_a']!.lastHangout).toBe('coffee sat');
    expect(connectionsList(s)).toHaveLength(1);
  });

  it('adds/removes tags (deduped, lowercased) and lists all tags', () => {
    const s = emptyStore();
    upsertConnection(s, { id: 'kw_a', name: 'Ada', when: 1 });
    upsertConnection(s, { id: 'kw_b', name: 'Ben', when: 2 });
    addTag(s, 'kw_a', 'Climbing');
    addTag(s, 'kw_a', 'climbing'); // dedup after lowercasing
    addTag(s, 'kw_b', 'coffee');
    expect(s.connections['kw_a']!.tags).toEqual(['climbing']);
    expect(allTags(s)).toEqual(['climbing', 'coffee']);
    removeTag(s, 'kw_a', 'climbing');
    expect(s.connections['kw_a']!.tags).toEqual([]);
  });

  it('renames connections', () => {
    const s = emptyStore();
    upsertConnection(s, { id: 'kw_a', name: 'New connection', when: 1 });
    renameConnection(s, 'kw_a', 'Ada L.');
    expect(s.connections['kw_a']!.name).toBe('Ada L.');
  });

  it('forms groups and adds/removes members', () => {
    const s = emptyStore();
    upsertConnection(s, { id: 'kw_a', name: 'Ada', when: 1 });
    upsertConnection(s, { id: 'kw_b', name: 'Ben', when: 2 });
    createGroup(s, 'Climbing crew', 'g1');
    setInGroup(s, 'g1', 'kw_a', true);
    setInGroup(s, 'g1', 'kw_b', true);
    setInGroup(s, 'g1', 'kw_b', false);
    expect(s.groups[0]!.members).toEqual(['kw_a']);
    expect(groupsFor(s, 'kw_a').map((g) => g.name)).toEqual(['Climbing crew']);
  });

  it('deleting a connection removes it from groups', () => {
    const s = emptyStore();
    upsertConnection(s, { id: 'kw_a', name: 'Ada', when: 1 });
    createGroup(s, 'Crew', 'g1');
    setInGroup(s, 'g1', 'kw_a', true);
    deleteConnection(s, 'kw_a');
    expect(s.connections['kw_a']).toBeUndefined();
    expect(s.groups[0]!.members).toEqual([]);
  });

  it('deletes groups', () => {
    const s = emptyStore();
    createGroup(s, 'Crew', 'g1');
    deleteGroup(s, 'g1');
    expect(s.groups).toHaveLength(0);
  });
});
