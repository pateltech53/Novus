"use client";

import { useEffect, useMemo, useState } from "react";

import { RARITY_COLORS, TIER_RARITY, type Tier } from "@/lib/rewards/tables";
import { play } from "@/lib/sound";

/**
 * The token shop — the agency valve.
 *
 * Randomness is tolerable when it is not the only road. A player who has
 * opened forty cases and still not seen the one skin they want can go and buy
 * it: slowly, with currency they earned, and knowing exactly what they are
 * getting. That is the difference between a system that feels like a
 * collection and one that feels like a slot machine.
 *
 * Nothing here is bought with money, in any code path, ever.
 */

interface ShopSkin { id: string; name: string; tier: number; collection: string; price: number }

export default function TokenShop({ onBought }: { onBought?: (briefcaseId: string) => void }) {
  const [tokens, setTokens] = useState(0);
  const [skins, setSkins] = useState<ShopSkin[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/rewards/shop", { credentials: "same-origin" });
    if (!res.ok) return;
    const data = await res.json();
    setTokens(data.tokens ?? 0);
    setSkins(data.skins ?? []);
  };
  useEffect(() => { void load(); }, []);

  const buy = async (skin: ShopSkin) => {
    setBusy(skin.id);
    setNote(null);
    const res = await fetch("/api/rewards/shop", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: "skin", skinId: skin.id }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok && data.briefcaseId) {
      play("success");
      // Bought items still arrive in a case (rule 5) — the SHORT ceremony,
      // because faking suspense on something the player chose is patronising.
      onBought?.(data.briefcaseId);
      void load();
    } else {
      play("error");
      setNote(data.error === "not enough tokens" ? "Not enough tokens yet." : (data.error ?? "That did not work."));
    }
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? skins.filter((s) => s.name.toLowerCase().includes(q)) : skins;
    // Cheapest first: the shop should open on something reachable, not on a
    // 6,000-token Legendary that reads as a wall.
    return [...list].sort((a, b) => a.price - b.price).slice(0, 40);
  }, [skins, query]);

  return (
    <section className="flex flex-col gap-4 p-4 pb-24 sm:p-6">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Token shop</h2>
          <p className="mt-0.5 text-2xs text-[var(--text-tertiary)]">
            Buy a skin outright. Earned tokens only — never money.
          </p>
        </div>
        <span className="tabular-nums text-sm font-bold text-[#F5C518]">{tokens.toLocaleString()}</span>
      </header>

      {note && (
        <p className="rounded-[var(--radius-row)] border border-[var(--hairline)] px-3 py-2 text-2xs">{note}</p>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search skins…"
        spellCheck={false}
        className="w-full rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-3 py-2 text-sm placeholder:text-[var(--n-6)] focus:border-[var(--n-11)] focus-visible:outline-none!"
      />

      <div className="flex flex-col gap-1.5">
        {matches.map((skin) => {
          const color = RARITY_COLORS[TIER_RARITY[skin.tier as Tier]];
          const afford = tokens >= skin.price;
          return (
            <button
              key={skin.id}
              disabled={busy !== null || !afford}
              onClick={() => void buy(skin)}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-row)] border border-[var(--hairline)] px-3 py-2 text-left disabled:opacity-45"
            >
              <span className="min-w-0 truncate text-sm">
                {skin.name}{" "}
                <span className="text-2xs font-bold" style={{ color }}>T{skin.tier}</span>
              </span>
              <span className="shrink-0 tabular-nums text-2xs font-bold" style={{ color: afford ? "#F5C518" : undefined }}>
                {skin.price.toLocaleString()}
              </span>
            </button>
          );
        })}
        {!matches.length && (
          <p className="text-2xs text-[var(--text-tertiary)]">
            {skins.length ? "Nothing matches that." : "You already own everything in the shop."}
          </p>
        )}
      </div>
    </section>
  );
}
