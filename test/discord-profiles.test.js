import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, User } from 'discord.js';
import { createDiscordProfileLookup } from '../src/discord-profiles.js';

const id = '123456789012345678';
const anotherId = '223456789012345678';
const hash = 'a'.repeat(32);
const url = `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`;
const makeUser = (overrides = {}) => ({
  id, username: 'discord.name', globalName: 'Nome no Discord', bot: false,
  displayAvatarURL: options => {
    assert.deepEqual(options, { extension: 'png', size: 128, forceStatic: true });
    return url;
  },
  ...overrides,
});
const client = fetch => ({ isReady: () => true, users: { fetch } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Discord profiles fetch the global user avatar and expose only public display fields', async () => {
  const lookup = createDiscordProfileLookup(client(async (value, options) => {
    assert.equal(value, id);
    assert.deepEqual(options, { force: true, cache: false });
    return makeUser({ email: 'private@example.invalid', token: 'private' });
  }));
  assert.deepEqual(await lookup(id), { id, username: 'discord.name', display_name: 'Nome no Discord', avatar_url: url });
  assert.ok(Object.isFrozen(await lookup(id)));
});

test('Default Discord avatars and usernames without a global display name are supported', async () => {
  const lookup = createDiscordProfileLookup(client(async () => makeUser({ globalName: null, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/5.png' })));
  assert.deepEqual(await lookup(id), { id, username: 'discord.name', display_name: 'discord.name', avatar_url: 'https://cdn.discordapp.com/embed/avatars/5.png' });
});

test('Real discord.js users produce valid global photos for static, Nitro and default avatars', async () => {
  const discord = new Client({ intents: [] });
  try {
    for (const avatar of [hash, `a_${hash}`, null]) {
      const user = new User(discord, { id, username: 'member.name', global_name: 'Nome no Discord', discriminator: '0', avatar, bot: false });
      const result = await createDiscordProfileLookup(client(async () => user))(id);
      assert.equal(result.id, id);
      assert.equal(result.display_name, 'Nome no Discord');
      assert.match(result.avatar_url, /\.png(?:\?size=128)?$/);
      assert.equal(result.avatar_url.includes('/embed/avatars/'), avatar === null);
    }
  } finally {
    await discord.destroy();
  }
});

test('Untrusted avatar URLs, other user IDs and bot users never become profile photos', async () => {
  const invalidUrls = [
    url.replace('https:', 'http:'), url.replace('cdn.discordapp.com', 'evil.example'),
    url.replace('cdn.discordapp.com', 'cdn.discordapp.com.evil.example'),
    url.replace('https://', 'https://user:password@'), url.replace('.com/', '.com:8443/'),
    url.replace(`/avatars/${id}/`, `/avatars/${anotherId}/`),
    `https://cdn.discordapp.com/attachments/${id}/${id}/avatar.png`,
    'https://cdn.discordapp.com/embed/avatars/99.png', url + '#fragment',
    url + '&redirect=https://evil.example', url.replace('.png', '.svg'), 'invalid URL',
  ];
  for (const avatar of invalidUrls) {
    const lookup = createDiscordProfileLookup(client(async () => makeUser({ displayAvatarURL: () => avatar })));
    assert.equal(await lookup(id), null, avatar);
  }
  for (const user of [null, makeUser({ id: anotherId }), makeUser({ bot: true }), makeUser({ username: '' })]) {
    assert.equal(await createDiscordProfileLookup(client(async () => user))(id), null);
  }
});

test('Invalid identifiers and unavailable clients perform no Discord API request', async () => {
  let calls = 0;
  const bot = client(async () => { calls += 1; return makeUser(); });
  const lookup = createDiscordProfileLookup(bot);
  for (const value of [null, undefined, 123, '', 'name', '1', `${id} `, `../${id}`]) assert.equal(await lookup(value), null);
  bot.isReady = () => false;
  assert.equal(await lookup(id), null);
  assert.equal(await createDiscordProfileLookup(null)(id), null);
  assert.equal(await createDiscordProfileLookup({ isReady() { throw Error('offline'); } })(id), null);
  assert.equal(calls, 0);
});

test('Cached avatars refresh after five minutes and remain available while Discord is offline', async () => {
  let clock = 0, calls = 0;
  const bot = client(async () => {
    calls += 1;
    return makeUser({ globalName: `Nome ${calls}`, displayAvatarURL: () => url.replace(hash, String(calls).repeat(32)) });
  });
  const lookup = createDiscordProfileLookup(bot, { now: () => clock });
  assert.equal((await lookup(id)).display_name, 'Nome 1');
  clock = 299_999;
  assert.equal((await lookup(id)).display_name, 'Nome 1');
  assert.equal(calls, 1);
  clock = 300_000;
  assert.equal((await lookup(id)).display_name, 'Nome 2');
  assert.equal(calls, 2);
  bot.isReady = () => false;
  clock = 999_999;
  assert.equal((await lookup(id)).display_name, 'Nome 2');
  assert.equal(calls, 2);
});

test('Concurrent requests for the same Discord user share one network fetch', async () => {
  const pending = deferred();
  let calls = 0;
  const lookup = createDiscordProfileLookup(client(() => { calls += 1; return pending.promise; }));
  const results = [lookup(id), lookup(id), lookup(id)];
  await tick();
  assert.equal(calls, 1);
  pending.resolve(makeUser());
  assert.equal((await Promise.all(results)).filter(Boolean).length, 3);
});

test('Failures use short backoff, preserve a known avatar and recover on a later lookup', async () => {
  let clock = 0, calls = 0, failed = true;
  const lookup = createDiscordProfileLookup(client(async () => {
    calls += 1;
    if (failed) throw Error('Discord unavailable');
    return makeUser();
  }), { now: () => clock, ttlMs: 100, failureTtlMs: 20 });
  assert.equal(await lookup(id), null);
  clock = 19;
  assert.equal(await lookup(id), null);
  assert.equal(calls, 1);
  clock = 20; failed = false;
  assert.equal((await lookup(id)).id, id);
  assert.equal(calls, 2);
  clock = 120; failed = true;
  assert.equal((await lookup(id)).id, id);
  clock = 139;
  assert.equal((await lookup(id)).id, id);
  assert.equal(calls, 3);
});

test('Slow requests do not block the panel or exceed concurrency, and late success refreshes the cache', async () => {
  const pending = deferred();
  let calls = 0;
  const lookup = createDiscordProfileLookup(client(() => { calls += 1; return pending.promise; }), { timeoutMs: 20, maxConcurrent: 1 });
  assert.equal(await lookup(id), null);
  assert.equal(await lookup(anotherId), null);
  assert.equal(await lookup(id), null);
  assert.equal(calls, 1);
  pending.resolve(makeUser());
  await tick();
  assert.equal((await lookup(id)).id, id);
});

test('A rejected request after the caller times out is handled and releases the concurrency slot', async () => {
  const pending = deferred();
  let calls = 0;
  const lookup = createDiscordProfileLookup(client(() => {
    calls += 1;
    return calls === 1 ? pending.promise : makeUser({ id: anotherId, displayAvatarURL: () => url.replace(id, anotherId) });
  }), { timeoutMs: 20, maxConcurrent: 1 });
  assert.equal(await lookup(id), null);
  pending.reject(Error('Late network failure'));
  await tick();
  assert.equal((await lookup(anotherId)).id, anotherId);
  assert.equal(calls, 2);
});

test('The profile cache is bounded and evicts the least recently used entry', async () => {
  const ids = [id, anotherId, '323456789012345678'];
  const calls = [];
  const lookup = createDiscordProfileLookup(client(async value => {
    calls.push(value);
    return makeUser({ id: value, displayAvatarURL: () => url.replace(id, value) });
  }), { maxEntries: 2 });
  await lookup(ids[0]); await lookup(ids[1]); await lookup(ids[0]); await lookup(ids[2]); await lookup(ids[0]); await lookup(ids[1]);
  assert.deepEqual(calls, [ids[0], ids[1], ids[2], ids[1]]);
});

test('A full dashboard batch is queued with two concurrent requests and resolves every profile', async () => {
  let running = 0, maximum = 0, calls = 0;
  const lookup = createDiscordProfileLookup(client(async value => {
    running += 1; calls += 1; maximum = Math.max(maximum, running);
    await tick();
    running -= 1;
    return makeUser({ id: value, displayAvatarURL: () => url.replace(id, value) });
  }));
  const ids = Array.from({ length: 20 }, (_, index) => String(BigInt(id) + BigInt(index)));
  assert.deepEqual((await Promise.all(ids.map(lookup))).map(profile => profile.id), ids);
  assert.equal(maximum, 2);
  assert.equal(calls, 20);
});

test('The pending queue is bounded and expires without issuing delayed stale requests', async () => {
  const pending = deferred();
  const calls = [];
  const lookup = createDiscordProfileLookup(client(value => { calls.push(value); return pending.promise; }), { timeoutMs: 30, maxConcurrent: 1, maxPending: 2 });
  const first = lookup(id), waiting = lookup(anotherId);
  assert.equal(await lookup('323456789012345678'), null);
  assert.deepEqual(await Promise.all([first, waiting]), [null, null]);
  pending.resolve(makeUser());
  await tick();
  assert.deepEqual(calls, [id]);
});
