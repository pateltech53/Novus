"use client";

import { useEffect, useMemo, useState } from "react";

import { ThemeToggle } from "@/components/ui/ThemeToggle";

/**
 * /admin/assets — the briefcase art review wall.
 *
 * A looking glass, not a feature: it renders whatever
 * public/briefcase/manifest.json currently holds so the art can be judged
 * before any of it is wired into the game. Nothing here reads a player, a
 * session or the database — the files are public either way — so unlike the
 * console next door it needs no privilege to be honest; it lives under
 * /admin because that is where the operator already goes to look at things.
 *
 * Two decisions the art has to survive, both of which the page makes easy:
 * the skins are worn by a shark on a DARK app surface (so the checker/dark
 * grounds matter — a white halo from a bad key shows up there and nowhere
 * else), and every skin ships on both founders (so novus/nova sit side by
 * side, never in separate tabs).
 *
 * Deliberately absent: equipping, editing, uploading. When the art is
 * approved it gets wired in properly, against the reward system, not here.
 */

// ── manifest.json shapes ─────────────────────────────────────────────────────

type Pair = { novus: string | null; nova: string | null };

interface SkinEntry {
  name: string;
  tier: number;
  collection: string;
  inPool: boolean;
  rarity: string;
  color: string;
  urls: Pair | null;
  png: Pair | null;
}

interface CaseEntry {
  name: string;
  tier: number;
  reskin?: boolean;
  states: Record<string, string | null> | null;
  png: Record<string, string | null> | null;
}

interface KeyEntry {
  tier: number;
  url: string | null;
  png: string | null;
}

interface PropEntry {
  name: string;
  kind: string;
  base?: string;
  url: string | null;
  png: string | null;
}

interface FxSet {
  name: string;
  sprites: Record<string, string | null>;
  png: Record<string, string | null>;
}

interface Manifest {
  version: number;
  styleVersion: string;
  formats?: string[];
  skins: Record<string, SkinEntry>;
  cases: Record<string, CaseEntry>;
  keys: Record<string, KeyEntry>;
  props: Record<string, PropEntry>;
  fx: Record<string, FxSet>;
}

const COLLECTIONS: Record<string, string> = {
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
  milestone_only: "Milestone only",
};

const TIER_NAMES: Record<number, string> = {
  1: "T1 Common",
  2: "T2 Uncommon",
  3: "T3 Rare",
  4: "T4 Epic",
  5: "T5 Legendary",
};

/** The three grounds art has to survive: the app's dark surface, paper, and
 *  a checker that makes a bad alpha edge impossible to miss. */
type Ground = "dark" | "light" | "checker";

const GROUND_STYLE: Record<Ground, React.CSSProperties> = {
  dark: { background: "#0B1220" },
  light: { background: "#FFFFFF" },
  checker: {
    backgroundImage:
      "linear-gradient(45deg,#c7ced8 25%,transparent 25%),linear-gradient(-45deg,#c7ced8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#c7ced8 75%),linear-gradient(-45deg,transparent 75%,#c7ced8 75%)",
    backgroundSize: "16px 16px",
    backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
    backgroundColor: "#eef1f5",
  },
};

function Tile({
  src,
  png,
  label,
  alt,
  sub,
  color,
  ground,
  size = 160,
}: {
  src: string | null;
  png?: string | null;
  label: string;
  /** Distinct from `label` when two tiles share a caption (novus vs nova). */
  alt?: string;
  sub?: string;
  color?: string;
  ground: Ground;
  size?: number;
}) {
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div
        className="relative grid place-items-center overflow-hidden rounded-[var(--radius-row)] border border-[var(--hairline)]"
        style={{ ...GROUND_STYLE[ground], height: size }}
      >
        {src ? (
          // Plain <img>: these are review pixels, not app pixels — next/image
          // would resample them and hide exactly the softness we are judging.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt ?? label} loading="lazy" className="max-h-full max-w-full object-contain" />
        ) : (
          // Fixed slate, not a theme token: the grounds below are literal hex
          // and do not flip with the theme, so a token here went to ~2.4:1 on
          // half the combinations.
          <span className="text-2xs tracking-[0.08em] text-[#5b6472]">NOT GENERATED</span>
        )}
        {color && (
          <span
            className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full"
            style={{ background: color }}
            aria-hidden
          />
        )}
      </div>
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="truncate text-2xs font-bold tracking-[0.04em]">{label}</span>
        {sub && <span className="shrink-0 text-2xs text-[var(--text-tertiary)]">{sub}</span>}
      </figcaption>
      {png && (
        // A repo path, not a link: the PNGs are tracked but deliberately not
        // deployed (see PNG_OUT in scripts/build-briefcase-art.mjs), so an
        // <a href> here would 404. Shown so the file is findable.
        <code className="truncate text-2xs text-[var(--text-tertiary)]" title={png}>
          {png.replace("art-review/briefcase/", "")}
        </code>
      )}
    </figure>
  );
}

function Band({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-baseline gap-2 text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
        {title.toUpperCase()}
        {count && <span className="font-normal normal-case tracking-normal">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

export default function AssetReviewPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ground, setGround] = useState<Ground>("dark");
  const [tier, setTier] = useState<number | null>(null);

  useEffect(() => {
    fetch("/briefcase/manifest.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
      .then(setManifest)
      .catch((e: Error) => setError(e.message));
  }, []);

  const skinsByCollection = useMemo(() => {
    if (!manifest) return [];
    // Sort by id first: "100" and "101" are canonical integer keys, so JS
    // enumerates them ahead of "001" and the wall would open on the
    // Legendary collection. Ids are fixed-width, so string order is catalog
    // order.
    const entries = Object.entries(manifest.skins).sort(([a], [b]) => a.localeCompare(b));
    const groups = new Map<string, [string, SkinEntry][]>();
    for (const entry of entries) {
      if (tier && entry[1].tier !== tier) continue;
      const list = groups.get(entry[1].collection) ?? [];
      list.push(entry);
      groups.set(entry[1].collection, list);
    }
    return [...groups.entries()];
  }, [manifest, tier]);

  const stats = useMemo(() => {
    if (!manifest) return null;
    const skins = Object.values(manifest.skins);
    const withArt = skins.filter((s) => s.urls?.novus || s.urls?.nova).length;
    const renders = skins.reduce(
      (n, s) => n + (s.urls?.novus ? 1 : 0) + (s.urls?.nova ? 1 : 0),
      0,
    );
    return { designs: skins.length, withArt, renders };
  }, [manifest]);

  if (error)
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-sm text-[var(--text-secondary)]">
          No manifest at <code>/briefcase/manifest.json</code> ({error}). Run{" "}
          <code>npm run art:briefcase:build</code>.
        </p>
      </main>
    );

  if (!manifest)
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">LOADING…</p>
      </main>
    );

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--hairline)] pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Briefcase art review</h1>
          <p className="mt-1 text-2xs leading-relaxed text-[var(--text-tertiary)]">
            Everything the reward system will show, before any of it is wired in.
            {stats && (
              <>
                {" "}
                {stats.renders} renders across {stats.withArt}/{stats.designs} designs · style{" "}
                {manifest.styleVersion}
              </>
            )}
            {" "}Tiles are the shipped webp; the lossless PNG of each sits at the path beneath it, under{" "}
            <code>art-review/briefcase/</code>.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="sticky top-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-3 bg-[var(--surface)]/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">GROUND</span>
          {(["dark", "light", "checker"] as Ground[]).map((g) => (
            <button
              key={g}
              onClick={() => setGround(g)}
              aria-pressed={ground === g}
              className={`rounded-[var(--radius-row)] border px-2 py-1 text-2xs tracking-[0.06em] ${
                ground === g
                  ? "border-[var(--n-11)] font-bold"
                  : "border-[var(--hairline)] text-[var(--text-tertiary)]"
              }`}
            >
              {g.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">TIER</span>
          <button
            onClick={() => setTier(null)}
            aria-pressed={tier === null}
            className={`rounded-[var(--radius-row)] border px-2 py-1 text-2xs ${
              tier === null
                ? "border-[var(--n-11)] font-bold"
                : "border-[var(--hairline)] text-[var(--text-tertiary)]"
            }`}
          >
            ALL
          </button>
          {[1, 2, 3, 4, 5].map((t) => (
            <button
              key={t}
              onClick={() => setTier(tier === t ? null : t)}
              aria-pressed={tier === t}
              className={`rounded-[var(--radius-row)] border px-2 py-1 text-2xs ${
                tier === t
                  ? "border-[var(--n-11)] font-bold"
                  : "border-[var(--hairline)] text-[var(--text-tertiary)]"
              }`}
            >
              T{t}
            </button>
          ))}
        </div>
      </div>

      {/* Skins — the bulk of the set, both founders side by side */}
      {skinsByCollection.map(([collection, skins]) => (
        <Band
          key={collection}
          title={COLLECTIONS[collection] ?? collection}
          count={`${skins.length} design${skins.length === 1 ? "" : "s"}`}
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-5">
            {skins.map(([id, s]) => (
              // A real pair box, not display:contents. Dissolving the wrapper
              // made both figures direct grid items, so at most widths a
              // design's novus landed at the end of one row and its nova at
              // the start of the next — which defeats the whole point of
              // showing them together.
              <div key={id} className="grid grid-cols-2 gap-2">
                <Tile
                  src={s.urls?.novus ?? null}
                  png={s.png?.novus ?? null}
                  label={`${id} ${s.name}`}
                  alt={`${s.name} on Novus`}
                  sub="novus"
                  color={s.color}
                  ground={ground}
                />
                <Tile
                  src={s.urls?.nova ?? null}
                  png={s.png?.nova ?? null}
                  label={`${id} ${s.name}`}
                  alt={`${s.name} on Nova`}
                  sub="nova"
                  color={s.color}
                  ground={ground}
                />
              </div>
            ))}
          </div>
        </Band>
      ))}

      {/* Cases — three states each, read left to right as the ceremony plays.
          Tiered like skins, so the filter reaches them too. */}
      <Band
        title="Briefcases"
        count={`${Object.entries(manifest.cases).filter(([, c]) => !tier || c.tier === tier).length} shown`}
      >
        <div className="flex flex-col gap-5">
          {Object.entries(manifest.cases).filter(([, c]) => !tier || c.tier === tier).map(([id, c]) => (
            <div key={id}>
              <p className="mb-2 text-2xs font-bold tracking-[0.06em]">
                {c.name}
                {c.reskin && <span className="ml-1 font-normal text-[var(--text-tertiary)]">(reskin)</span>}
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                {["closed", "glow", "open"].map((state) => (
                  <Tile
                    key={state}
                    src={c.states?.[state] ?? null}
                    png={c.png?.[state] ?? null}
                    label={state}
                    sub={TIER_NAMES[c.tier]}
                    ground={ground}
                    size={190}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Band>

      <Band
        title="Keys"
        count={`${Object.entries(manifest.keys).filter(([, k]) => !tier || k.tier === tier).length} shown`}
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
          {Object.entries(manifest.keys).filter(([, k]) => !tier || k.tier === tier).map(([id, k]) => (
            <Tile key={id} src={k.url} png={k.png} label={id} sub={TIER_NAMES[k.tier]} ground={ground} />
          ))}
        </div>
      </Band>

      {/* Props and FX carry no tier, so the filter cannot narrow them — say
          so rather than leaving them looking unfiltered by oversight. */}
      <Band
        title="Props"
        count={tier ? `${Object.keys(manifest.props).length} — untiered, filter does not apply` : `${Object.keys(manifest.props).length}`}
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {Object.entries(manifest.props).map(([id, p]) => (
            <Tile key={id} src={p.url} png={p.png} label={p.name} sub={p.kind} ground={ground} size={190} />
          ))}
        </div>
      </Band>

      <Band
        title="FX sprites"
        count={tier ? `${Object.keys(manifest.fx).length} sets — untiered, filter does not apply` : `${Object.keys(manifest.fx).length} sets`}
      >
        <div className="flex flex-col gap-5">
          {Object.entries(manifest.fx).map(([setId, set]) => (
            <div key={setId}>
              <p className="mb-2 text-2xs font-bold tracking-[0.06em]">{set.name}</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
                {Object.entries(set.sprites).map(([id, url]) => (
                  <Tile
                    key={id}
                    src={url}
                    png={set.png?.[id] ?? null}
                    label={id}
                    ground={ground}
                    size={120}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Band>
    </main>
  );
}
