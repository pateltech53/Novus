import type { StageNum } from "@/lib/engine/types";
import { caseColourFor, fade, lit, shade } from "@/lib/color";

/**
 * An island, drawn rather than photographed.
 *
 * ── What changed, and why ──────────────────────────────────────────────────
 *
 * This used to be a diagram of an island: two flat rings of `--sea-crest` for
 * water, a green ellipse for land, a stroked palm, and a skyline of grey
 * rectangles. It read as a legend entry rather than as a place, and the two
 * water rings were the worst of it — a disc of flat blue under every island,
 * drawn to fake a waterline against a flat sea, which is exactly the "island
 * background" that had to go the moment there was a real ocean behind it.
 *
 * It is now the object the brief asked for: a sand mound with a palm on it and
 * a briefcase standing in the sand. Same idea, drawn as a thing.
 *
 * ── Clay, without a single gradient ────────────────────────────────────────
 *
 * The reference is a soft-lit claymation render, and design.md §1.2 gives real
 * lighting to the STAGE layer only — the mascot and the panel room — while
 * §1.4 keeps a ledger of exactly three gradients in the whole app. Both hold
 * here. The clay look is built entirely from STEPPED FLAT FILLS: two or three
 * solid tones per form, light one above shadow, which is how the look was made
 * before renderers existed and what `lib/color.ts` derives. Nothing below emits
 * a gradient, a blur or a filter.
 *
 * The light comes from the upper left on every form, without exception. One
 * light direction is most of what separates "modelled" from "coloured in".
 *
 * ── What it encodes ────────────────────────────────────────────────────────
 *
 *   · **Stage** builds the skyline behind the palm. One hut at Idea, a
 *     four-tower row at Scale. It is the one piece of progress a player can
 *     read across the whole archipelago without opening anything.
 *   · **The briefcase colour** is what tells two companies apart. Derived from
 *     the run id through `caseColourFor`, and every face of it derived from
 *     that one colour by `lit`/`shade` — so recolouring an island is one
 *     value, not five. `caseColour` is also a prop, so a caller can override
 *     it outright.
 *   · **Ended** replaces every structure with a headstone and drains the
 *     colour out of the land. Not a red cross or a skull — this is handed to
 *     minors and a company going under is already the harshest moment in the
 *     product. A quiet grey stone is the register the rest of the app uses for
 *     Chapter Seven.
 *
 * ── The contract with the screen ───────────────────────────────────────────
 *
 * `height = size * 0.72` is load-bearing and must not drift: `SeaEmpty` and
 * `SeaLocked` in app/islands/page.tsx reserve exactly that footprint so that
 * founding a company changes the shape on the water without reflowing the
 * scene. `aria-hidden`, likewise — the company name and its status are already
 * text beside this, and a screen reader announcing "island" would be repeating
 * the card in a worse voice.
 *
 * It is drawn at two very different sizes: ~36 px at the far edge of the map,
 * and 236 px in the gallery. Every shape below has to survive the small one,
 * which is why the detail is in the SILHOUETTE — a palm crown, a case, a
 * skyline — and never in a line thinner than the mound it sits on.
 */
export function IslandGlyph({
  stage,
  alive,
  seed = 0,
  size = 76,
  caseColour,
  className = "",
}: {
  stage: StageNum;
  alive: boolean;
  /** Any stable number for this company. Varies the palm, the drift and the case. */
  seed?: number;
  size?: number;
  /** Override the briefcase colour. Defaults to one derived from `seed`. */
  caseColour?: string;
  className?: string;
}) {
  /* Two independent, cheap variations. A shift rather than a second modulo so
     a seed that happens to be even does not correlate both of them — and the
     UNSIGNED shift, because run seeds are full unsigned 32-bit values out of
     `hashString` and the signed one reads over half of them as negative. See
     `caseColourFor` in lib/color.ts, where that cost the briefcase entirely. */
  const drift = (Math.abs(Math.trunc(seed)) % 5) - 2; // −2..2 px
  const palmLeft = ((Math.abs(Math.trunc(seed)) >>> 3) & 1) === 1;

  /* Dead islands lose their colour rather than gaining a symbol. The sand goes
     to the neutral ramp and the palm goes with it — there is nothing growing
     on it any more, which says more than a marker would. */
  const sand = alive ? "var(--sand)" : "var(--n-6)";
  const sandLit = alive ? "var(--sand-lit)" : "var(--n-7)";
  const sandShade = alive ? "var(--sand-shade)" : "var(--n-5)";
  const built = alive ? "var(--built)" : "var(--n-7)";

  return (
    <svg
      width={size}
      height={size * 0.72}
      viewBox="0 0 120 86"
      fill="none"
      className={className}
      aria-hidden
    >
      {/*
        The shadow the island casts on the water, and the ONLY thing left
        under it.

        Two `--sea-crest` ellipses used to sit here, sized like a plate, and
        they were the island's background: an opaque disc of a slightly wrong
        blue that made sense only while the sea behind it was one flat colour.
        Against real water they read as a coaster.

        This is the opposite of that shape — darker than the water rather than
        lighter, low opacity, and narrower than the mound so it reads as
        contact rather than as a ring. It is what makes the island sit IN the
        sea instead of on top of a picture of one.
      */}
      <ellipse
        cx={60 + drift}
        cy="64"
        rx="30"
        ry="5"
        fill={fade("var(--color-navy, black)", 0.16)}
      />

      {/* ── The mound ──────────────────────────────────────────────────────
          Three fills, one light direction. The underside is a tapering keel,
          which is what makes a flat ellipse read as an island rather than as
          a coin lying on the table; the body is the sand; the cap is the sun
          on the top of it, inset up and left. */}
      <path
        d={`M${28 + drift} 55 Q${60 + drift} 74 ${92 + drift} 55 Z`}
        fill={sandShade}
      />
      <ellipse cx={60 + drift} cy="55" rx="32" ry="9" fill={sand} />
      <ellipse cx={57 + drift} cy="52.5" rx="24" ry="5.6" fill={sandLit} />

      {alive ? (
        <>
          <Structures stage={stage} x={60 + drift} built={built} />
          <Palm x={(palmLeft ? 40 : 80) + drift} />
          <Briefcase
            x={(palmLeft ? 76 : 44) + drift}
            colour={caseColour ?? caseColourFor(seed)}
          />
        </>
      ) : (
        <Headstone x={60 + drift} />
      )}
    </svg>
  );
}

/**
 * What is standing on it, by stage.
 *
 * Hand-placed rather than generated: five silhouettes that each read instantly
 * at 36 px are worth more than an algorithm producing twenty that do not. The
 * heights climb monotonically, because that is the whole message — the island
 * gets taller as the company does.
 *
 * Set BACK, behind the palm and the case, and drawn in the surface tone rather
 * than in ink: at Idea it is one hut and should not be the loudest thing on a
 * beach, and at Scale it should read as a skyline in haze rather than as a bar
 * chart. Each tower gets a lit left face for the same reason everything else
 * does.
 */
function Structures({ stage, x, built }: { stage: StageNum; x: number; built: string }) {
  const BY_STAGE: Record<StageNum, { dx: number; w: number; h: number }[]> = {
    1: [{ dx: -5, w: 10, h: 10 }],
    2: [
      { dx: -13, w: 9, h: 9 },
      { dx: 1, w: 11, h: 13 },
    ],
    3: [
      { dx: -18, w: 9, h: 9 },
      { dx: -5, w: 10, h: 17 },
      { dx: 8, w: 9, h: 11 },
    ],
    4: [
      { dx: -20, w: 8, h: 12 },
      { dx: -9, w: 10, h: 22 },
      { dx: 4, w: 9, h: 15 },
      { dx: 16, w: 8, h: 10 },
    ],
    5: [
      { dx: -22, w: 8, h: 15 },
      { dx: -11, w: 10, h: 27 },
      { dx: 2, w: 9, h: 20 },
      { dx: 14, w: 8, h: 24 },
    ],
  };

  return (
    <g opacity="0.9">
      {BY_STAGE[stage].map((b, i) => (
        <g key={i}>
          <rect x={x + b.dx} y={50 - b.h} width={b.w} height={b.h} rx="1.6" fill={built} />
          {/* The lit face. A third of the width, on the left, in the same
              light as everything else on the island. */}
          <rect
            x={x + b.dx}
            y={50 - b.h}
            width={b.w / 3}
            height={b.h}
            rx="1.6"
            fill={lit(built, 0.16)}
          />
        </g>
      ))}
    </g>
  );
}

/**
 * One palm. The thing that makes a sand-coloured ellipse an island.
 *
 * The trunk was a 2.2px stroke and is now a stack of five tapering segments,
 * because a stroked line has no thickness to be lit — and a trunk that is not
 * lit is the one element that gives away that the rest is a drawing. The
 * segments also give it the joints a palm actually has.
 *
 * Six fronds, three either side, each a filled leaf rather than a stroke:
 * a filled crown holds its shape at 36 px where six hairlines turn into a
 * smudge. Three coconuts at the collar, in the bark tone.
 */
function Palm({ x }: { x: number }) {
  /* The trunk leans right and thins as it climbs. Each segment is drawn from
     its own centre so the lean accumulates rather than shearing the whole
     shape. */
  const SEGMENTS = [
    { y: 50, w: 5.0, h: 4.2, dx: 0 },
    { y: 45.6, w: 4.6, h: 4.0, dx: 0.5 },
    { y: 41.4, w: 4.2, h: 3.8, dx: 1.2 },
    { y: 37.4, w: 3.8, h: 3.6, dx: 2.1 },
    { y: 33.6, w: 3.4, h: 3.4, dx: 3.2 },
  ];

  return (
    <g>
      {SEGMENTS.map((s, i) => (
        <g key={i}>
          <ellipse cx={x + s.dx} cy={s.y} rx={s.w / 2} ry={s.h / 2} fill="var(--bark)" />
          <ellipse
            cx={x + s.dx - s.w / 6}
            cy={s.y - s.h / 8}
            rx={s.w / 3.4}
            ry={s.h / 2.8}
            fill={lit("var(--bark)", 0.18)}
          />
        </g>
      ))}

      {/* The crown. Drawn from the collar outward, shaded ones first so the
          lit fronds sit in front — the same stacking a real crown has. */}
      {(() => {
        const cx = x + 3.6;
        const cy = 31.5;
        const FRONDS = [
          { dx: -13, dy: 2.5, cw: -7, ch: -6 },
          { dx: -10, dy: -3.5, cw: -6, ch: -6.5 },
          { dx: -3.5, dy: -7.5, cw: -2, ch: -6 },
          { dx: 3.5, dy: -7.5, cw: 2, ch: -6 },
          { dx: 10, dy: -3.5, cw: 6, ch: -6.5 },
          { dx: 13, dy: 2.5, cw: 7, ch: -6 },
        ];
        return FRONDS.map((f, i) => (
          <path
            key={i}
            /* A leaf: out along the top edge, back along the bottom. The two
               control points are what give it the droop a palm frond has
               rather than the straight spoke a stroke would draw. */
            d={
              `M${cx} ${cy} ` +
              `Q${cx + f.cw} ${cy + f.ch} ${cx + f.dx} ${cy + f.dy} ` +
              `Q${cx + f.cw * 0.7} ${cy + f.ch * 0.25} ${cx} ${cy + 1.6} Z`
            }
            /* The outer two either side are the ones the light misses. */
            fill={i === 0 || i === 5 ? "var(--palm)" : "var(--palm-lit)"}
          />
        ));
      })()}

      {/* Coconuts at the collar. Three, clustered, never in a row. */}
      <g fill="var(--bark)">
        <circle cx={x + 1.6} cy="32.6" r="1.5" />
        <circle cx={x + 4.8} cy="33.2" r="1.4" />
        <circle cx={x + 3.2} cy="30.4" r="1.2" />
      </g>
    </g>
  );
}

/**
 * The briefcase, and the only thing on the island whose colour is a variable.
 *
 * Every face of it comes from ONE colour through `lib/color.ts`: the front is
 * that colour, the lid catches the light, the base is turned away from it. So
 * recolouring an island is one value — `caseColour`, or the seed that derives
 * it — and there is no second place to forget.
 *
 * The clasp and the two side latches are `--color-prestige`, which is the
 * app's existing gold (design.md §1.1 locks the brand constants, and inventing
 * a second gold here would be a fourth brand colour by accident).
 *
 * The handle is an arc above the body rather than a hole through it: a hole
 * would show the sand through a 2 px gap, which at 36 px is a dirty edge.
 */
function Briefcase({ x, colour }: { x: number; colour: string }) {
  /* The fallback is not decoration. The glyph root is `fill="none"` and `fill`
     inherits, so a missing colour here does not draw a black case — it draws
     nothing at all, and the gold clasp keeps rendering over bare sand. */
  const body = colour || "var(--case)";
  const lid = lit(body, 0.2);
  const base = shade(body, 0.3);
  const gold = "var(--color-prestige)";

  return (
    <g>
      {/* Handle, behind the lid so it reads as attached to the back of it. */}
      <path
        d={`M${x - 3.2} 40.8 Q${x} 36.6 ${x + 3.2} 40.8`}
        stroke={base}
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
      />

      {/* The case: body, then the lid band across the top, then the shadowed
          foot. Three flat tones, light above dark. */}
      <rect x={x - 9} y={40.5} width="18" height="11" rx="1.8" fill={body} />
      <rect x={x - 9} y={40.5} width="18" height="3.4" rx="1.6" fill={lid} />
      <rect x={x - 9} y={49.2} width="18" height="2.3" rx="1.6" fill={base} />

      {/* The clasp, centred on the seam, and the two side latches. */}
      <rect x={x - 1.8} y={42.4} width="3.6" height="3" rx="0.7" fill={gold} />
      <g fill={gold} opacity="0.85">
        <rect x={x - 6.6} y={43.1} width="1.6" height="1.6" rx="0.4" />
        <rect x={x + 5} y={43.1} width="1.6" height="1.6" rx="0.4" />
      </g>
    </g>
  );
}

/**
 * What is left when the company is not.
 *
 * A rounded stone, not a cross: a cross is a religion this game has no
 * business assigning to anybody's company, and the same shape reads as "grave"
 * everywhere without it.
 *
 * The inscription cuts used to be drawn in `--surface`, which was the card
 * colour behind the glyph back when there was a card. There is not, so they
 * are drawn as a darker cut into the stone instead — which is also what a cut
 * into stone looks like.
 */
function Headstone({ x }: { x: number }) {
  const stone = "var(--n-7)";
  return (
    <g>
      <path
        d={`M${x - 9} 51 L${x - 9} 38 A9 9 0 0 1 ${x + 9} 38 L${x + 9} 51 Z`}
        fill={stone}
      />
      {/* The lit left face, in the same light every other form on the island
          is in — the company ended, the sun did not. */}
      <path
        d={`M${x - 9} 51 L${x - 9} 38 A9 9 0 0 1 ${x - 2} 29.4 L${x - 2} 51 Z`}
        fill={lit(stone, 0.14)}
      />
      {/* Two cut lines where an inscription would be. Suggested, never
          written — the company's name is already on the card in full. */}
      <g stroke={shade(stone, 0.3)} strokeWidth="1.6" strokeLinecap="round">
        <path d={`M${x - 4.5} 41 H${x + 4.5}`} />
        <path d={`M${x - 3} 45.5 H${x + 3}`} />
      </g>
    </g>
  );
}
