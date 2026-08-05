import type { StageNum } from "@/lib/engine/types";

/**
 * An island, drawn rather than photographed.
 *
 * ── Why a glyph and not the mascot ─────────────────────────────────────────
 *
 * The picker's cards used the founder portrait, which is the same face on
 * every card and says nothing about the company under it. The island is the
 * unit this screen is about, so the island is what it draws.
 *
 * Deliberately geometric and NOT in the mascot's rendered 3D style. Two
 * reasons: the 3D pieces are authored assets that would need one per state
 * per stage, and — the real one — design.md puts real lighting and geometry on
 * the STAGE layer only. A card is content. Flat shapes on the card and the lit
 * mascot on the stage keeps that line where the design system draws it.
 *
 * ── What it encodes ────────────────────────────────────────────────────────
 *
 * Everything on the island is read from the company, so two cards never look
 * the same by accident:
 *
 *   · **Stage** builds it up. One hut at Idea; a skyline at Scale. This is the
 *     one piece of progress a player can see across the whole archipelago at a
 *     glance, without reading a number.
 *   · **Ended** replaces every structure with a headstone and drains the
 *     colour out of the land. Not a red cross or a skull — the app is handed
 *     to minors and a company going under is already the harshest moment in
 *     it. A quiet grey stone is the register the rest of the app uses for
 *     Chapter Seven.
 *   · **The seed** — the run id — nudges the palm and the sea, so two Growth
 *     companies are recognisably two places rather than one drawing twice.
 *
 * Colours come from tokens on both paths, so this themes with everything else
 * and never needs a dark-mode variant.
 */
export function IslandGlyph({
  stage,
  alive,
  seed = 0,
  size = 76,
  className = "",
}: {
  stage: StageNum;
  alive: boolean;
  /** Any stable number for this company. Only varies decoration. */
  seed?: number;
  size?: number;
  className?: string;
}) {
  // Two independent, cheap variations. `>>` rather than a modulo chain so a
  // seed that happens to be even does not correlate both of them.
  const drift = (Math.abs(Math.trunc(seed)) % 5) - 2; // −2..2 px
  const palmLeft = ((Math.abs(Math.trunc(seed)) >> 3) & 1) === 1;

  const land = alive
    ? "color-mix(in oklch, var(--solvency) 46%, var(--surface-elevated))"
    : "var(--n-6)";
  const cliff = alive
    ? "color-mix(in oklch, var(--solvency) 22%, var(--n-7))"
    : "var(--n-7)";
  const sea = "var(--hairline)";
  const built = alive ? "var(--text-primary)" : "var(--n-8)";

  return (
    <svg
      width={size}
      height={size * 0.72}
      viewBox="0 0 120 86"
      fill="none"
      className={className}
      /* Decorative: the company name and its status are already text beside
         this, so a screen reader announcing "island" here would be repeating
         the card in a worse voice. */
      aria-hidden
    >
      {/* Sea — two rings, so the island reads as being IN something. */}
      <ellipse cx={60 + drift} cy="66" rx="46" ry="11" fill={sea} opacity="0.55" />
      <ellipse cx={60 + drift} cy="66" rx="32" ry="7.5" fill={sea} />

      {/* The underside. A tapering keel is what makes a flat ellipse read as
          an island rather than as a coin lying on the table. */}
      <path
        d={`M${26 + drift} 56 Q${60 + drift} 92 ${94 + drift} 56 Z`}
        fill={cliff}
      />
      {/* The land itself. */}
      <ellipse cx={60 + drift} cy="55" rx="34" ry="9.5" fill={land} />

      {alive ? (
        <>
          <Structures stage={stage} x={60 + drift} built={built} />
          <Palm x={(palmLeft ? 38 : 82) + drift} built={cliff} />
        </>
      ) : (
        <Headstone x={60 + drift} built={built} />
      )}
    </svg>
  );
}

/**
 * What is standing on it, by stage.
 *
 * Hand-placed rather than generated: five silhouettes that each read
 * instantly at 76px are worth more than an algorithm that produces twenty
 * that do not. The heights climb monotonically, because that is the whole
 * message — the island gets taller as the company does.
 */
function Structures({ stage, x, built }: { stage: StageNum; x: number; built: string }) {
  const BY_STAGE: Record<StageNum, { dx: number; w: number; h: number }[]> = {
    1: [{ dx: -5, w: 11, h: 12 }],
    2: [
      { dx: -13, w: 10, h: 11 },
      { dx: 1, w: 12, h: 15 },
    ],
    3: [
      { dx: -18, w: 10, h: 11 },
      { dx: -5, w: 11, h: 20 },
      { dx: 8, w: 10, h: 13 },
    ],
    4: [
      { dx: -20, w: 9, h: 14 },
      { dx: -9, w: 11, h: 26 },
      { dx: 4, w: 10, h: 18 },
      { dx: 16, w: 8, h: 12 },
    ],
    5: [
      { dx: -22, w: 9, h: 18 },
      { dx: -11, w: 11, h: 32 },
      { dx: 2, w: 10, h: 24 },
      { dx: 14, w: 9, h: 29 },
    ],
  };

  return (
    <g fill={built}>
      {BY_STAGE[stage].map((b, i) => (
        <rect
          key={i}
          x={x + b.dx}
          y={52 - b.h}
          width={b.w}
          height={b.h}
          rx="1.5"
          /* The back of the skyline sits back. Depth without a second colour,
             which keeps this readable when the card is 160px wide. */
          opacity={i % 2 === 0 ? 0.72 : 0.92}
        />
      ))}
    </g>
  );
}

/** One palm. The thing that makes a green ellipse an island and not a hill. */
function Palm({ x, built }: { x: number; built: string }) {
  return (
    <g stroke={built} strokeWidth="2.2" strokeLinecap="round" fill="none" opacity="0.9">
      <path d={`M${x} 52 Q${x - 1.5} 44 ${x + 1} 38`} />
      <path d={`M${x + 1} 38 Q${x - 5} 34 ${x - 9} 37`} />
      <path d={`M${x + 1} 38 Q${x + 7} 34 ${x + 11} 37`} />
      <path d={`M${x + 1} 38 Q${x + 3} 32 ${x + 1} 30`} strokeWidth="1.8" />
    </g>
  );
}

/**
 * What is left when the company is not.
 *
 * A rounded stone, not a cross: a cross is a religion this game has no
 * business assigning to anybody's company, and the same shape reads as "grave"
 * everywhere without it.
 */
function Headstone({ x, built }: { x: number; built: string }) {
  return (
    <g>
      <path
        d={`M${x - 9} 51 L${x - 9} 38 A9 9 0 0 1 ${x + 9} 38 L${x + 9} 51 Z`}
        fill={built}
        opacity="0.85"
      />
      {/* Two cut lines where an inscription would be. Suggested, never
          written — the company's name is already on the card in full. */}
      <g stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" opacity="0.75">
        <path d={`M${x - 4.5} 41 H${x + 4.5}`} />
        <path d={`M${x - 3} 45.5 H${x + 3}`} />
      </g>
    </g>
  );
}
