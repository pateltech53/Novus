/**
 * Seeded randomness, shared by the daily generator and the roller.
 *
 * Split out of roll.ts on purpose. roll.ts is `server-only` — the acceptance
 * criteria want a grep proving no client bundle can roll a tier — but the
 * DAILY GENERATOR is not secret: it produces the same five challenges for
 * everyone, and the client is welcome to recompute them. Keeping the RNG here
 * lets the generator stay importable (and testable in plain Node) without
 * dragging the roller's server-only guard along with it.
 */

/** FNV-1a, 32-bit. Turns a string seed into the integer mulberry32 wants. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, and good enough for cosmetics. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFor = (seed: string) => mulberry32(fnv1a(seed));

/** Pick from a {key: weight} table. Weights are percents but need not sum to 100. */
export function weighted<K extends string | number>(
  odds: Record<K, number>,
  rand: () => number,
): K {
  const entries = (Object.entries(odds) as [K, number][]).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}
