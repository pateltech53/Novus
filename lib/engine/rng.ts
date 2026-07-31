/** Deterministic seeded RNG (mulberry32) — luck is retellable (GDD §6). */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** RNG seeded per run + fiscal position, so a reload retells the same luck. */
export function runRng(seed: number, year: number, month: number, salt = 0): Rng {
  return mulberry32((seed ^ (year * 2654435761) ^ (month * 40503) ^ salt) >>> 0);
}

/** One shared daily event, identical for every player: seeded by real date (UTC). */
export function todaysMarketSeed(date = new Date()): number {
  const key = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
  return hashString(`novus-market-${key}`);
}

/**
 * Luck band (Brand Law 2): perturb ±band, NEVER flip the sign of a result.
 * amount × (1 − band + 2·band·r) keeps sign for band < 1.
 */
export function jitter(amount: number, rng: Rng, band: number): number {
  if (amount === 0) return 0;
  const factor = 1 - band + 2 * band * rng();
  return amount * factor;
}

export function pickWeighted<T>(items: T[], weightOf: (t: T) => number, rng: Rng): T | null {
  const total = items.reduce((n, it) => n + Math.max(0, weightOf(it)), 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const it of items) {
    roll -= Math.max(0, weightOf(it));
    if (roll <= 0) return it;
  }
  return items[items.length - 1] ?? null;
}

export function pickOne<T>(items: T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length) % items.length];
}
