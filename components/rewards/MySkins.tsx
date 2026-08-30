"use client";

import { useEffect, useMemo, useState } from "react";

import { RARITY_COLORS, TIER_RARITY, type Tier } from "@/lib/rewards/tables";
import { play } from "@/lib/sound";

/**
 * MY SKINS — the collection, including everything not in it.
 *
 * ── Why the locked ones are shown at all ────────────────────────────────────
 *
 * A grid of what you own is an inventory. A grid where most cells are
 * silhouettes is a COLLECTION — the empty slots are the whole feeling, and
 * they are what makes the next case worth opening. Hiding them would leave a
 * player who owns four skins looking at a screen that says, truthfully and
 * uselessly, "you have four skins".
 *
 * So every design in the catalog gets a cell. Owned ones show the render;
 * locked ones show the same silhouette in the tier's colour at low opacity,
 * with the name withheld — the shape is a hint, not a spoiler.
 *
 * ── Collections, not one long grid ──────────────────────────────────────────
 *
 * 101 cells in one scroll is a wall. Grouped by collection they become ten
 * short goals ("three left in Garage Days"), which is the unit a player
 * actually chases.
 */

interface CatalogSkin {
  id: string;
  name: string;
  tier: number;
  collection: string;
  in_pool: boolean;
}

interface OwnedRow {
  item_id: string;
  kind: string;
  equipped: boolean;
}

const COLLECTION_NAMES: Record<string, string> = {
  garage: "Garage Days",
  office: "First Office",
  corporate: "Corporate Ladder",
  street: "Street CEO",
  retro: "Retro Business",
  tech: "Tech Visionary",
  world: "World Tour Tailoring",
  industry: "Industry Pro",
  seasonal: "Seasonal & Events",
  legendary: "Legendary Founders",
  milestone_only: "Milestone",
};

/** Which founder the wardrobe is previewing. Every design ships on both. */
type Base = "novus" | "nova";

export default function MySkins({ base = "novus" }: { base?: Base }) {
  const [catalog, setCatalog] = useState<CatalogSkin[]>([]);
  const [owned, setOwned] = useState<OwnedRow[]>([]);
  const [tokens, setTokens] = useState(0);
  const [tierFilter, setTierFilter] = useState<Tier | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Base>(base);

  const load = async () => {
    const res = await fetch("/api/rewards/inventory", { credentials: "same-origin" });
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setCatalog(data.catalog ?? []);
    setOwned(data.owned ?? []);
    setTokens(data.tokens ?? 0);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const ownedIds = useMemo(
    () => new Set(owned.filter((o) => o.kind === "skin").map((o) => o.item_id)),
    [owned],
  );
  const equippedId = owned.find((o) => o.kind === "skin" && o.equipped)?.item_id ?? null;

  const groups = useMemo(() => {
    const map = new Map<string, CatalogSkin[]>();
    for (const skin of catalog) {
      if (tierFilter && skin.tier !== tierFilter) continue;
      const list = map.get(skin.collection) ?? [];
      list.push(skin);
      map.set(skin.collection, list);
    }
    return [...map.entries()];
  }, [catalog, tierFilter]);

  const ownedCount = catalog.filter((s) => ownedIds.has(`skin_${s.id}`)).length;

  const equip = async (skinId: string) => {
    play("click");
    const res = await fetch("/api/rewards/equip", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: `skin_${skinId}` }),
    });
    if (res.ok) { play("success"); void load(); }
  };

  if (loading) {
    return <p className="p-6 text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">LOADING…</p>;
  }

  return (
    <div className="pb-24">
      <header className="flex flex-wrap items-baseline justify-between gap-3 px-4 pt-4 sm:px-6">
        <div>
          <h2 className="text-base font-bold tracking-tight">My skins</h2>
          <p className="mt-0.5 text-2xs text-[var(--text-tertiary)]">
            {ownedCount} of {catalog.length} collected · {tokens} Shark Tokens
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {(["novus", "nova"] as Base[]).map((b) => (
            <button
              key={b}
              onClick={() => setPreview(b)}
              aria-pressed={preview === b}
              className={`rounded-[var(--radius-row)] border px-2 py-1 text-2xs tracking-[0.06em] ${
                preview === b ? "border-[var(--n-11)] font-bold" : "border-[var(--hairline)] text-[var(--text-tertiary)]"
              }`}
            >
              {b.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* A collection is chased tier by tier as often as collection by
          collection, so both cuts are one tap away. */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 sm:px-6">
        <button
          onClick={() => setTierFilter(null)}
          aria-pressed={tierFilter === null}
          className={`rounded-[var(--radius-row)] border px-2 py-1 text-2xs ${
            tierFilter === null ? "border-[var(--n-11)] font-bold" : "border-[var(--hairline)] text-[var(--text-tertiary)]"
          }`}
        >
          ALL
        </button>
        {([1, 2, 3, 4, 5] as Tier[]).map((t) => (
          <button
            key={t}
            onClick={() => setTierFilter(tierFilter === t ? null : t)}
            aria-pressed={tierFilter === t}
            className="rounded-[var(--radius-row)] border px-2 py-1 text-2xs"
            style={{
              borderColor: tierFilter === t ? RARITY_COLORS[TIER_RARITY[t]] : "var(--hairline)",
              color: RARITY_COLORS[TIER_RARITY[t]],
              fontWeight: tierFilter === t ? 700 : 400,
            }}
          >
            T{t}
          </button>
        ))}
      </div>

      {groups.map(([collection, skins]) => {
        const have = skins.filter((s) => ownedIds.has(`skin_${s.id}`)).length;
        return (
          <section key={collection} className="mt-5 px-4 sm:px-6">
            <h3 className="mb-2 flex items-baseline gap-2 text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
              {(COLLECTION_NAMES[collection] ?? collection).toUpperCase()}
              <span className="font-normal tracking-normal">{have}/{skins.length}</span>
            </h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
              {skins.map((skin) => {
                const itemId = `skin_${skin.id}`;
                const isOwned = ownedIds.has(itemId);
                const isEquipped = equippedId === itemId;
                const color = RARITY_COLORS[TIER_RARITY[skin.tier as Tier]];
                return (
                  <button
                    key={skin.id}
                    type="button"
                    disabled={!isOwned}
                    onClick={() => isOwned && equip(skin.id)}
                    className="group relative flex flex-col gap-1 text-left disabled:cursor-default"
                    title={isOwned ? `${skin.name} — tap to wear` : "Not collected yet"}
                  >
                    <div
                      className="relative grid aspect-square place-items-center overflow-hidden rounded-[var(--radius-row)] border"
                      style={{
                        borderColor: isEquipped ? color : "var(--hairline)",
                        background: "#0B1220",
                        boxShadow: isEquipped ? `0 0 0 2px ${color}66` : undefined,
                      }}
                    >
                      {isOwned ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/briefcase/skins/t${skin.tier}/${skin.id}_${preview}.webp`}
                          alt={skin.name}
                          loading="lazy"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        /*
                         * The silhouette. Same artwork, flattened to the tier's
                         * colour at low opacity — a shape you can almost read,
                         * which is the point: enough to want it, not enough to
                         * have seen it.
                         */
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/briefcase/skins/t${skin.tier}/${skin.id}_${preview}.webp`}
                          alt=""
                          aria-hidden
                          loading="lazy"
                          className="h-full w-full object-contain opacity-[0.13]"
                          style={{ filter: "grayscale(1) brightness(0.35)" }}
                        />
                      )}
                      <span
                        className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
                        style={{ background: color, opacity: isOwned ? 1 : 0.3 }}
                        aria-hidden
                      />
                    </div>
                    <span
                      className={`truncate text-2xs ${isOwned ? "" : "text-[var(--text-tertiary)]"}`}
                    >
                      {isOwned ? skin.name : "———"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
