import { describe, expect, it } from 'vitest';
import type { Profile } from '@shortlist-ai/shared';
import { createFakeDb } from './fakeDb';
import { createProfileRepo } from './profileRepo';

const profile = (name: string): Profile => ({
  name,
  email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
  onboardingStep: 'welcome',
  onboardingCompletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('profileRepo', () => {
  it('creates once and returns the existing profile on a repeat', async () => {
    const repo = createProfileRepo(createFakeDb().db, 't');
    await repo.createIfMissing('a', profile('Alex Example'));
    const again = await repo.createIfMissing('a', profile('Someone Else'));
    expect(again.name).toBe('Alex Example');
  });

  it('user A cannot read or modify user B', async () => {
    const repo = createProfileRepo(createFakeDb().db, 't');
    await repo.createIfMissing('a', profile('Alex Example'));
    await repo.createIfMissing('b', profile('Blake Sample'));

    expect((await repo.get('a'))?.name).toBe('Alex Example');
    expect((await repo.get('b'))?.name).toBe('Blake Sample');
    expect(await repo.get('c')).toBeNull();

    await repo.updateName('a', 'Alex Renamed');
    expect((await repo.get('b'))?.name).toBe('Blake Sample');
    expect(await repo.updateName('c', 'Nobody')).toBeNull();
  });

  it('deleteAll removes only that user partition', async () => {
    const { db, items } = createFakeDb();
    const repo = createProfileRepo(db, 't');
    await repo.createIfMissing('a', profile('Alex Example'));
    await repo.createIfMissing('b', profile('Blake Sample'));
    items.set('USER#a|RESUME#1', { pk: 'USER#a', sk: 'RESUME#1' });

    await repo.deleteAll('a');

    expect(await repo.get('a')).toBeNull();
    expect([...items.keys()].some((k) => k.startsWith('USER#a'))).toBe(false);
    expect((await repo.get('b'))?.name).toBe('Blake Sample');
  });
});
