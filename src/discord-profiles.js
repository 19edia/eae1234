const snowflake = /^\d{17,20}$/;
const positive = (value, fallback) => Number.isSafeInteger(value) && value > 0 ? value : fallback;

function publicProfile(user, expectedId) {
  try {
    if (!user || user.bot || user.id !== expectedId || typeof user.username !== 'string' || !user.username) return null;
    const avatar = new URL(user.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }));
    const ownAvatar = new RegExp(`^/avatars/${expectedId}/(?:a_)?[a-f0-9]{32}\\.png$`);
    if (avatar.protocol !== 'https:' || avatar.hostname !== 'cdn.discordapp.com' || avatar.username || avatar.password || avatar.port || avatar.hash) return null;
    if (!ownAvatar.test(avatar.pathname) && !/^\/embed\/avatars\/[0-5]\.png$/.test(avatar.pathname)) return null;
    for (const [key, value] of avatar.searchParams) if (key !== 'size' || value !== '128') return null;
    return Object.freeze({
      id: expectedId,
      username: user.username,
      display_name: user.globalName || user.username,
      avatar_url: avatar.href,
    });
  } catch {
    return null;
  }
}

// These profiles are presentation data only; a lookup never grants membership or permissions.
export function createDiscordProfileLookup(client, options = {}) {
  const now = options.now || Date.now;
  const ttlMs = positive(options.ttlMs, 5 * 60_000);
  const failureTtlMs = positive(options.failureTtlMs, 20_000);
  const timeoutMs = positive(options.timeoutMs, 4_000);
  const maxEntries = positive(options.maxEntries, 500);
  const maxConcurrent = positive(options.maxConcurrent, 2);
  const maxPending = positive(options.maxPending, 40);
  const cache = new Map();
  const inflight = new Map();
  const queue = [];
  let active = 0;

  function remember(id, profile, ttl) {
    cache.delete(id);
    cache.set(id, { profile, expiresAt: now() + ttl });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  function expire(job) {
    if (job.expired || job.finished) return;
    job.expired = true;
    remember(job.id, job.known, failureTtlMs);
    if (!job.running) {
      const index = queue.indexOf(job);
      if (index !== -1) queue.splice(index, 1);
      inflight.delete(job.id);
    }
    job.complete(job.known);
  }

  function drain() {
    while (active < maxConcurrent && queue.length) {
      const job = queue.shift();
      if (job.expired || Date.now() >= job.deadline) {
        expire(job);
        continue;
      }
      job.running = true;
      active += 1;
      function finish(profile, ttl) {
        job.finished = true;
        clearTimeout(job.timer);
        remember(job.id, profile, ttl);
        inflight.delete(job.id);
        active -= 1;
        job.complete(profile);
        drain();
      }
      // Keep the real request counted after the caller times out. Otherwise slow
      // Discord requests could accumulate indefinitely as dashboard pages reload.
      Promise.resolve()
        .then(() => {
          if (!client.isReady()) throw new Error('Discord offline');
          return client.users.fetch(job.id, { force: true, cache: false });
        })
        .then(
          user => {
            const profile = publicProfile(user, job.id);
            finish(profile, profile ? ttlMs : failureTtlMs);
          },
          () => finish(job.known, failureTtlMs),
        );
    }
  }

  return async function getDiscordProfile(discordId) {
    if (typeof discordId !== 'string' || !snowflake.test(discordId)) return null;
    const cached = cache.get(discordId);
    if (cached) {
      cache.delete(discordId);
      cache.set(discordId, cached);
    }
    const known = cached?.profile || null;
    try {
      if (!client?.isReady?.() || typeof client.users?.fetch !== 'function') return known;
    } catch {
      return known;
    }
    if (cached && cached.expiresAt > now()) return known;
    if (inflight.has(discordId)) return inflight.get(discordId).result;
    if (inflight.size >= maxPending) return known;
    let complete;
    const result = new Promise(resolve => { complete = resolve; });
    const job = { id: discordId, known, complete, result, deadline: Date.now() + timeoutMs };
    job.timer = setTimeout(() => expire(job), timeoutMs);
    inflight.set(discordId, job);
    queue.push(job);
    drain();
    return result;
  };
}
