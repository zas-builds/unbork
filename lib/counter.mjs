// How many checks were run, and nothing else.
//
// The whole file exists to answer one question: is anybody using Unbork? So it
// stores one number per day and no second fact. No address, no IP, no browser,
// no time of day, no country, no identifier of any kind. There is nothing in
// here that could be pointed at a person, even by us, even later.
//
// Shape of the stored value:
//   { days: { "2026-11-18": { ok: 3, failed: 1 } }, total: { ok: 3, failed: 1 } }
//
// "ok" is a report that was produced. "failed" is a paste we could not check at
// all (not a real address, site down, our own fault). Both are worth knowing:
// a pile of failures means the box is confusing people.

const KEY = 'daily';
const KEEP_DAYS = 90;
const BUDGET_MS = 1200;

export const STORE_NAME = 'unbork-usage';

export function isoDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function num(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
}

function tally(value) {
  return { ok: num(value && value.ok), failed: num(value && value.failed) };
}

// Pure, so the retry logic below can be tested without a store at all.
export function bump(current, day, outcome) {
  const field = outcome === 'ok' ? 'ok' : 'failed';
  const days = {};
  const source = current && typeof current.days === 'object' && current.days ? current.days : {};
  for (const key of Object.keys(source)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) days[key] = tally(source[key]);
  }
  days[day] = days[day] || { ok: 0, failed: 0 };
  days[day][field] += 1;

  const kept = Object.keys(days).sort().slice(-KEEP_DAYS);
  const trimmed = {};
  for (const key of kept) trimmed[key] = days[key];

  const total = tally(current && current.total);
  total[field] += 1;
  return { days: trimmed, total };
}

// Netlify Blobs, loaded only when it is really there. Locally, in tests and on
// any host without it, this returns null and every function below shrugs.
export async function openStore() {
  try {
    const mod = await import('@netlify/blobs');
    if (!mod || typeof mod.getStore !== 'function') return null;
    return mod.getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch {
    return null;
  }
}

async function withinBudget(work) {
  let timer = null;
  try {
    return await Promise.race([
      work(),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), BUDGET_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Add one. Two checks finishing at the same moment must not lose a count, so
// the write is conditional on the value we read (Netlify Blobs onlyIfMatch /
// onlyIfNew) and we try again if somebody got in first.
export async function recordScan(store, outcome, now = new Date()) {
  if (!store) return false;
  const day = isoDay(now);
  const result = await withinBudget(async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let current = null;
      let etag = null;
      const got = await store.getWithMetadata(KEY, { type: 'json' });
      if (got) { current = got.data; etag = got.etag; }
      const next = bump(current, day, outcome);
      const condition = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
      const written = await store.setJSON(KEY, next, condition);
      if (!written || written.modified !== false) return { counted: true };
    }
    return { counted: false };
  });
  return Boolean(result && result.counted);
}

// Never let counting break a check. A report that arrives is worth more than a
// number that is right.
export async function recordScanQuietly(outcome, now = new Date()) {
  try {
    const store = await openStore();
    return await recordScan(store, outcome, now);
  } catch {
    return false;
  }
}

export async function readStats(store, days = 14, now = new Date()) {
  if (!store) return null;
  const result = await withinBudget(async () => {
    const got = await store.get(KEY, { type: 'json' });
    return { value: got || null };
  });
  if (!result || result.timedOut) return null;
  const value = result.value;
  const source = value && typeof value.days === 'object' && value.days ? value.days : {};
  const recent = {};
  for (const key of Object.keys(source).sort().slice(-days)) recent[key] = tally(source[key]);
  return { total: tally(value && value.total), today: tally(source[isoDay(now)]), days: recent };
}
