"use client";

import { useEffect, useMemo, useState } from "react";

import { RARITY_COLORS, TIER_RARITY, type Tier } from "@/lib/rewards/tables";
import {
  syncWornFromInventory,
  takeOffRewardSkin,
  wearRewardSkin,
} from "@/lib/rewards/wear";
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
 * locked ones show the same artwork flattened to a silhouette, with the name
 * withheld — the shape is a hint, not a spoiler.
 *
 * ── What the first version got wrong, and the owner's report ────────────────
 *
 * "Like 100 black squares." The cells sat on a hard-coded near-black ground,
 * the locked silhouette was drawn at 13% opacity and then darkened further,
 * and a dozen designs are in the catalog ahead of their artwork — so on a
 * light-theme screen the grid was a hundred dark tiles with nothing legible
 * in most of them, and the Closet, which embedded this grid, inherited the
 * wall. Three things changed:
 *
 *   · The cell ground is a design token (`--surface-elevated`), so the tiles
 *     are white cards in the light theme and raised cards in the dark one,
 *     and the transparent renders sit on them the way the tier portraits sit
 *     on the Closet.
 *   · The locked silhouette is `contrast(0)` at a real opacity — that filter
 *     collapses every pixel to a flat mid-grey while keeping the artwork's
 *     alpha, which is a true silhouette that reads on BOTH themes without a
 *     theme-specific colour. The tier lives on the ring and the dot.
 *   · Every render has an `onError` fallback: a tier-coloured ring with a
 *     lock (not collected) or a "?" (collected, art on its way). A missing
 *     file is never an empty box.
 *
 * The Closet no longer embeds this grid at all (components/rewards/
 * ClosetRewards.tsx explains); it is the MY SKINS tab on /rewards and nothing
 * else, which is why the `embedded` mode went with it.
 *
 * ── Wearing ─────────────────────────────────────────────────────────────────
 *
 * Equipping is a POST the server records, and — new — a write to the
 * device-local record in lib/rewards/wear.ts, which is what every mounted
 * FounderAvatar actually reads. The server wins: every inventory load runs
 * `syncWornFromInventory`, so a device that disagrees with the account is
 * corrected here. The worn cell carries a TAKE OFF control; taking off is the
 * same POST with `itemId: null`.
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

const EQUIP_HEADERS = { "Content-Type": "application/json" };

export default function MySkins({ base = "novus" }: { base?: Base }) {
  const [catalog, setCatalog] = useState<CatalogSkin[]>([]);
  const [owned, setOwned] = useState<OwnedRow[]>([]);
  const [tokens, setTokens] = useState(0);
  const [tierFilter, setTierFilter] = useState<Tier | null>(null);
  const [loading, setLoading] = useState(true);
  /** The gate answered 404 — signed out, or a server without the schema. */
  const [absent, setAbsent] = useState(false);
  const [preview, setPreview] = useState<Base>(base);
  /**
   * Renders that 404'd, keyed `<id>_<base>`. A design can exist for one
   * founder and not the other mid-rollout, so the key carries the base; the
   * set only grows, because a file that was missing is not going to appear
   * before the next deploy.
   */
  const [missing, setMissing] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/rewards/inventory", { credentials: "same-origin" });
    if (!res.ok) { setAbsent(true); setLoading(false); return; }
    const data = await res.json();
    const nextCatalog: CatalogSkin[] = data.catalog ?? [];
    const nextOwned: OwnedRow[] = data.owned ?? [];
    setCatalog(nextCatalog);
    setOwned(nextOwned);
    setTokens(data.tokens ?? 0);
    setLoading(false);
    // The server's equipped row is the truth; the portrait's record follows.
    syncWornFromInventory(nextOwned, nextCatalog);
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

  const equip = async (skin: CatalogSkin) => {
    if (busy) return;
    setBusy(true);
    play("click");
    try {
      const res = await fetch("/api/rewards/equip", {
        method: "POST",
        credentials: "same-origin",
        headers: EQUIP_HEADERS,
        body: JSON.stringify({ itemId: `skin_${skin.id}` }),
      });
      if (res.ok) {
        play("success");
        // The founder changes on the tap; the reload confirms it from the server.
        wearRewardSkin({ id: skin.id, tier: skin.tier as Tier, name: skin.name });
        void load();
      } else {
        play("error");
      }
    } catch {
      play("error");
    } finally {
      setBusy(false);
    }
  };

  const takeOff = async () => {
    if (busy) return;
    setBusy(true);
    play("click");
    try {
      const res = await fetch("/api/rewards/equip", {
        method: "POST",
        credentials: "same-origin",
        headers: EQUIP_HEADERS,
        body: JSON.stringify({ itemId: null }),
      });
      // See ClosetRewards.tsx's takeOff() for why a 404 clears the record too:
      // a signed-out device has no server row left to disagree with.
      if (res.ok || res.status === 404) {
        takeOffRewardSkin();
        void load();
      } else {
        play("error");
      }
    } catch {
      play("error");
    } finally {
      setBusy(false);
    }
  };

  const markMissing = (key: string) =>
    setMissing((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));

  // Nothing to show — signed out, or the account's server has no rewards
  // schema. The tab stays empty rather than explaining itself; RewardsHome
  // owns the surrounding state.
  if (absent) return null;
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
                const artKey = `${skin.id}_${preview}`;
                const src = `/briefcase/skins/t${skin.tier}/${artKey}.webp`;
                const artMissing = missing.has(artKey);
                return (
                  <div key={skin.id} className="flex flex-col gap-1">
                    <button
                      type="button"
                      disabled={!isOwned || isEquipped || busy}
                      onClick={() => { if (isOwned && !isEquipped) void equip(skin); }}
                      aria-pressed={isEquipped}
                      className="group relative text-left disabled:cursor-default"
                      title={
                        isEquipped ? `${skin.name} — wearing`
                        : isOwned ? `${skin.name} — tap to wear`
                        : "Not collected yet"
                      }
                    >
                      <div
                        className="relative grid aspect-square place-items-center overflow-hidden rounded-[var(--radius-row)] border bg-[var(--surface-elevated)]"
                        style={{
                          borderColor: isEquipped ? color : "var(--hairline)",
                          boxShadow: isEquipped ? `0 0 0 2px ${color}66` : undefined,
                        }}
                      >
                        {artMissing ? (
                          <ArtFallback
                            color={color}
                            locked={!isOwned}
                            label={isOwned ? `${skin.name} (render on its way)` : "Not collected yet"}
                          />
                        ) : isOwned ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={src}
                            alt={skin.name}
                            loading="lazy"
                            onError={() => markMissing(artKey)}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          /*
                           * The silhouette. Same artwork, flattened to one
                           * grey by `contrast(0)` (every channel collapses
                           * to 50%, alpha survives) — a shape you can read,
                           * which is the point: enough to want it, not
                           * enough to have seen it. A flat mid-grey holds on
                           * the white card and the dark one alike, so no
                           * theme-specific ink is needed.
                           */
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={src}
                            alt=""
                            aria-hidden
                            loading="lazy"
                            onError={() => markMissing(artKey)}
                            className="h-full w-full object-contain opacity-70"
                            style={{ filter: "contrast(0)" }}
                          />
                        )}
                        <span
                          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
                          style={{ background: color, opacity: isOwned ? 1 : 0.55 }}
                          aria-hidden
                        />
                        {isEquipped && (
                          // Tier ink on the page surface rather than page ink
                          // on tier colour: gold and blue each defeat one of
                          // the two themes' text colours, and the surface
                          // token holds either way.
                          <span
                            className="absolute bottom-1 left-1 rounded-[var(--radius-chip)] border bg-[var(--surface)] px-1 py-0.5 text-2xs font-bold tracking-[0.1em]"
                            style={{ borderColor: color, color }}
                            aria-hidden
                          >
                            WEARING
                          </span>
                        )}
                      </div>
                    </button>
                    <span
                      className={`truncate text-2xs ${isOwned ? "" : "text-[var(--text-tertiary)]"}`}
                    >
                      {isOwned ? skin.name : "———"}
                    </span>
                    {isEquipped && (
                      <button
                        type="button"
                        onClick={() => void takeOff()}
                        disabled={busy}
                        className="rounded-[var(--radius-chip)] border py-1 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)] disabled:opacity-60"
                        style={{ borderColor: color }}
                        aria-label={`Take off ${skin.name}`}
                      >
                        TAKE OFF
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * What a cell shows when its render is not on disk.
 *
 * A tier-coloured ring so the cell still says which case it came from, and
 * inside it a padlock for a design not yet collected or a "?" for one that is
 * owned but whose artwork has not shipped. Drawn as SVG rather than fetched,
 * so the fallback cannot itself fail to load.
 */
function ArtFallback({ color, locked, label }: { color: string; locked: boolean; label: string }) {
  return (
    <span className="grid h-full w-full place-items-center" role="img" aria-label={label}>
      <svg viewBox="0 0 48 48" className="h-1/2 w-1/2" aria-hidden>
        <circle
          cx="24"
          cy="24"
          r="21"
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          opacity={locked ? 0.6 : 1}
        />
        {locked ? (
          <g
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          >
            <rect x="16" y="22" width="16" height="12" rx="2.5" />
            <path d="M19 22v-4a5 5 0 0 1 10 0v4" />
          </g>
        ) : (
          <text
            x="24"
            y="31"
            textAnchor="middle"
            fontSize="20"
            fontWeight="800"
            fill={color}
          >
            ?
          </text>
        )}
      </svg>
    </span>
  );
}
