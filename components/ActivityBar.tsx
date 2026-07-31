"use client";

/**
 * The activity bar — BitLife's Occupation/Assets/Relationships row.
 * Every tab opens optional actions that do NOT advance time. That separation
 * is what makes the advance button feel like the heartbeat.
 */
export type ActivityTab =
  | "company"
  | "team"
  | "product"
  | "assets"
  | "market"
  | "closet";

const TABS: { id: ActivityTab; label: string; glyph: React.ReactNode }[] = [
  { id: "company", label: "Company", glyph: <BuildingGlyph /> },
  { id: "team", label: "Team", glyph: <TeamGlyph /> },
  { id: "product", label: "Product", glyph: <ProductGlyph /> },
  { id: "assets", label: "Assets", glyph: <AssetsGlyph /> },
  { id: "market", label: "Market", glyph: <MarketGlyph /> },
  { id: "closet", label: "Closet", glyph: <ClosetGlyph /> },
];

import { Glass } from "@/components/ui/Glass";

export function ActivityBar({
  active,
  onOpen,
}: {
  active: ActivityTab | null;
  onOpen: (tab: ActivityTab) => void;
}) {
  return (
    // One of the five sanctioned glass surfaces. It floats over scrolling
    // content, carries no financial figure, and never overlaps the canvas.
    <Glass
      as="nav"
      aria-label="Activities"
      /*
       * Six tabs, and at 320px six columns is 53px each — which truncates
       * COMPANY to "COMPAN…" and PRODUCT to "PRODUC…". Measured, not guessed.
       *
       * The 12px type floor is not negotiable and neither is showing what a tab
       * is, so the only remaining axis is layout: two rows of three below 360px,
       * one row of six above it. It costs ~28px of height on the smallest phones
       * and nothing clips at any width.
       */
      className="mx-auto grid w-full max-w-2xl grid-cols-3 rounded-t-[var(--radius-card)] pt-1 pb-[max(0.375rem,env(safe-area-inset-bottom))] min-[360px]:grid-cols-6"
    >
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            data-sfx="tab"
            onClick={() => onOpen(tab.id)}
            aria-current={isActive ? "page" : undefined}
            // The active tab was the accent. A tab indicator is explicitly not
            // what the accent is for — weight and a neutral fill say "here"
            // just as clearly, and leave the orange to the one control that
            // actually asks you to do something.
            // px-0 and no letter-spacing: six tabs at 320px leaves ~53px each, and
            // the 12px type floor is not negotiable, so the horizontal budget has
            // to come out of the padding and the tracking instead.
            className={`nv-press flex min-w-0 flex-col items-center gap-1 rounded-lg px-0 py-1.5 ${
              isActive
                ? "bg-[var(--surface-elevated)] font-bold text-[var(--text-primary)]"
                : "text-[var(--text-tertiary)]"
            }`}
          >
            <span aria-hidden="true">{tab.glyph}</span>
            <span className="block w-full truncate text-center text-2xs font-bold">
              {tab.label.toUpperCase()}
            </span>
          </button>
        );
      })}
    </Glass>
  );
}

function BuildingGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
      <rect x="2.5" y="4" width="7" height="11.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="7.5" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 7h2M5 10h2M12 10.5h1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
/** A stacked shelf — the things you made, ranked. Not a shopping bag. */
function ProductGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
      <rect x="2.5" y="2.5" width="13" height="4" rx="1.1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.5" y="8" width="13" height="4" rx="1.1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 15h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function TeamGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
      <circle cx="6.5" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.8 15c0-2.7 2.1-4.3 4.7-4.3s4.7 1.6 4.7 4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 11c2 0 3.3 1.2 3.3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function AssetsGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="5.5" width="14" height="9.5" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 5.5V4.2c0-.8.6-1.4 1.4-1.4h2.2c.8 0 1.4.6 1.4 1.4v1.3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 9.5h14" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function MarketGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
      <path d="M2.5 12.5 6.5 8l3 2.8 5.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 4.8h4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ClosetGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
      <path
        d="M7 3.2 3 5.4v3l1.8-.6v6.8h8.4V7.8L15 8.4v-3l-4-2.2a2.2 2.2 0 0 1-4 0Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
