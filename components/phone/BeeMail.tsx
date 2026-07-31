"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import type { RunState } from "@/lib/engine/types";
import { deriveRunwayMonths } from "@/lib/engine/sim";
import { fmtMoney, fmtMonths } from "@/lib/engine/format";
import { holdingsValue } from "@/lib/engine/holdings";
import { industryByCode } from "@/lib/engine/constants";

/**
 * BeeMail — the inbox is generated from the run, never authored ahead of time.
 * Every message quotes a real number, so the fiction and the books can never
 * disagree with each other.
 */
export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  preview: string;
  body: string;
  tone: "neutral" | "good" | "bad";
  unread: boolean;
}

/** Shape of a message before read-state is stamped on it. */
type Draft = Omit<MailMessage, "unread" | "preview">;

/**
 * The list view shows one line, so the preview is derived rather than authored
 * — a hand-written preview drifts out of sync with the body the moment either
 * one is edited.
 */
function previewOf(body: string): string {
  const first = body.split("\n\n")[0].replace(/\s+/g, " ").trim();
  return first.length > 84 ? `${first.slice(0, 83).trimEnd()}…` : first;
}

/**
 * Pure: the same run always produces the same inbox. Situational mail carries
 * the fiscal stamp in its id so a problem that comes back gets a fresh unread
 * message instead of silently staying "read" forever.
 */
export function inboxFor(run: RunState): MailMessage[] {
  const drafts: Draft[] = [];
  const { stats } = run;
  const stamp = `${run.year}-${run.month}`;
  const runway = deriveRunwayMonths(run);
  const industry = industryByCode(run.industry);
  const first = (full: string) => full.split(" ")[0];

  // ── The shark opens the account ──────────────────────────────────────────
  if (run.year === 1 && run.month <= 1) {
    drafts.push({
      id: "mail-welcome",
      from: "The Shark",
      subject: "You said yes to this",
      tone: "neutral",
      body: [
        `Congratulations. You now own a company called ${run.companyName}, which means you also own every problem inside it.`,
        "Here is the only advice that costs you nothing. Cash is oxygen. Revenue is a rumour until it clears. Burn rate is the speed you are walking towards the wall.",
        "I see you at the end of every fiscal year. Bring numbers, not adjectives.",
      ].join("\n\n"),
    });
  }

  // ── The accountant, who has already checked twice ────────────────────────
  if (Number.isFinite(runway) && runway < 5) {
    drafts.push({
      id: `mail-runway-${stamp}`,
      from: "Priya Nair · Accounts",
      subject: `Runway: ${fmtMonths(runway)}`,
      tone: "bad",
      body: [
        "I ran it again this morning in case the first run was wrong. It was not.",
        `${fmtMoney(stats.cash)} in the account against ${fmtMoney(stats.burnMonthly)} a month leaves you ${fmtMonths(runway)}. That is not a forecast. It is division.`,
        "Tell me which line you want cut and I will do the unpleasant part. Tell me nothing and the calendar decides for you.",
      ].join("\n\n"),
    });
  }

  // ── The bank, formally ───────────────────────────────────────────────────
  if (stats.cash < 0) {
    drafts.push({
      id: `mail-bank-${stamp}`,
      from: "Meridian Business Bank",
      subject: `Account overdrawn — ${run.companyName}`,
      tone: "bad",
      body: [
        `Dear ${run.founderName || "Founder"},`,
        `Our records show that the business current account held in the name of ${run.companyName} is overdrawn by ${fmtMoney(Math.abs(stats.cash))} as at today's date.`,
        "Charges apply from the fifth working day. We would welcome a conversation about your plans for the account. We would welcome it considerably more than the alternative.",
        "Yours sincerely,\nBusiness Lending, Meridian",
      ].join("\n\n"),
    });
  }

  // ── A recruiter, working the least loyal person on your roster ───────────
  // Only the weakest link writes; a flooded inbox stops being a signal.
  const flightRisk = run.roster
    .filter((e) => e.loyalty < 40)
    .sort((a, b) => a.loyalty - b.loyalty)[0];
  if (flightRisk) {
    drafts.push({
      id: `mail-poach-${flightRisk.id}-${run.year}`,
      from: "Talia Brandt · Kestrel Search",
      subject: `Quick word about ${flightRisk.name}`,
      tone: "bad",
      body: [
        `You do not know me. ${flightRisk.name} does — we spoke on Tuesday.`,
        `I will not insult you with a pretext. ${first(flightRisk.name)} is your ${flightRisk.role} and somebody with a larger budget has noticed. The conversation is already happening. The only open question is whether you are in it.`,
        "People leave managers, not companies. You have my number either way.",
      ].join("\n\n"),
    });
  }

  // ── Nobody is writing back ───────────────────────────────────────────────
  if (stats.brand < 25) {
    drafts.push({
      id: `mail-silence-${stamp}`,
      from: "BeeMail Delivery",
      subject: "3 messages, no replies",
      tone: "bad",
      body: [
        "Automatic summary. You sent three messages this month. None of them were opened.",
        "Nobody has blocked you. Nobody has answered you either. From where you are standing those are the same thing.",
        "This notice was generated automatically. It is the only mail you received today that was written for you.",
      ].join("\n\n"),
    });
  }

  // ── The month the line flips ─────────────────────────────────────────────
  if (stats.burnMonthly <= 0 && stats.revenueAnnual > 0) {
    drafts.push({
      id: `mail-profit-${run.year}`,
      from: "Priya Nair · Accounts",
      subject: "The number went the other way",
      tone: "good",
      body: [
        `For the first time the monthly line points inwards: ${fmtMoney(Math.abs(stats.burnMonthly))} in, not out.`,
        "Do not spend it in one place, and do not tell the team it is permanent. It is not permanent. It is a month.",
      ].join("\n\n"),
    });
  }

  // ── Fame arrives as a booking request ────────────────────────────────────
  if (stats.brand > 60) {
    drafts.push({
      id: `mail-pod-${run.year}`,
      from: "The Compounding Podcast",
      subject: `Guest slot — ${run.companyName}`,
      tone: "good",
      body: [
        "Sixty minutes, no notes, and we always ask about the year you nearly went under.",
        `${run.companyName} keeps turning up in our listener mail, which is either a compliment or a warning. Either way it fills an episode.`,
        "We record Thursdays. Name a date and we will send a car.",
      ].join("\n\n"),
    });
  }

  // ── Owning things has a subscription attached ────────────────────────────
  if (run.holdings.length > 0) {
    const insured = holdingsValue(run);
    drafts.push({
      id: `mail-insure-${run.year}`,
      from: "Hallward Commercial",
      subject: `Renewal — ${run.holdings.length} insured ${run.holdings.length === 1 ? "item" : "items"}`,
      tone: "neutral",
      body: [
        `Your cover renews next month. ${run.holdings.length} ${run.holdings.length === 1 ? "item sits" : "items sit"} on the schedule, valued together at ${fmtMoney(insured)}.`,
        `Premiums are up. Premiums are always up. The alternative is owning ${fmtMoney(insured)} of things and hoping.`,
        "No action needed unless you want to change the sums insured.",
      ].join("\n\n"),
    });
  }

  // ── The money you took out of the company ────────────────────────────────
  if (run.positions.length > 0 || run.brokerageCash > 0) {
    drafts.push({
      id: `mail-broker-${stamp}`,
      from: "RobinGhood",
      subject: "Your statement is ready",
      tone: "neutral",
      body: [
        `${run.positions.length} open ${run.positions.length === 1 ? "position" : "positions"}. Uninvested cash: ${fmtMoney(run.brokerageCash)}.`,
        "Money parked here is money the company cannot spend on staying alive. That trade is yours to make. We only keep the receipts.",
        "Past performance is not indicative of anything, as our lawyers insist we tell you.",
      ].join("\n\n"),
    });
  }

  // ── Evergreen: three messages that arrive no matter how the run is going ──
  drafts.push({
    id: `mail-payroll-${stamp}`,
    from: "Coilworth Payroll",
    subject: "Payroll runs on the 28th",
    tone: "neutral",
    body: [
      `${stats.employees} ${stats.employees === 1 ? "person is" : "people are"} due to be paid on the 28th, same as last month.`,
      "Nothing needs approving. We send this because the founders who stop noticing payroll are the ones who miss the month it stops clearing.",
    ].join("\n\n"),
  });

  drafts.push({
    id: `mail-digest-${stamp}`,
    from: "The Sector Weekly",
    subject: `${industry.name} — the week in five lines`,
    tone: "neutral",
    body: [
      "Two of your competitors raised. A third quietly did not, and the trade press has already forgotten which is which.",
      "Nothing in this digest will help you today. It exists so that when somebody at a party mentions the sector, you can nod at the correct moment.",
      "You receive this because you once entered your email address to download a PDF.",
    ].join("\n\n"),
  });

  drafts.push({
    // Quarterly, because that is roughly how often this person gives up.
    id: `mail-outbound-${run.year}-${Math.ceil(run.month / 3)}`,
    from: "Devon at GrowthLoop",
    subject: `Idea for ${run.companyName} (2 mins)`,
    tone: "neutral",
    body: [
      `Hi ${run.founderName || "there"} — saw that ${run.companyName} is scaling and thought I would reach out.`,
      "We help founders like you unlock 10x pipeline with an AI-native go-to-market motion. Worth fifteen minutes on Thursday?",
      "Best,\nDevon",
      "P.S. Following up as I did not hear back. I will follow up again.",
    ].join("\n\n"),
  });

  // ── Pro, stated plainly (Brand Law 4) ────────────────────────────────────
  drafts.push(
    run.pro
      ? {
          id: "mail-pro-receipt",
          from: "Novus",
          subject: "Receipt — Novus Pro",
          tone: "neutral",
          body: [
            "Thanks. Pro is active on this account.",
            "It gives you more industries, more candidates, more asset classes and more of the closet. It gives you no points, no revives and no advantage over anyone on Still Standing.",
            "You are paying for more world, not for a better ending.",
          ].join("\n\n"),
        }
      : {
          id: "mail-pro",
          from: "Novus",
          subject: "Pro: more world, same judgment",
          tone: "neutral",
          body: [
            "Pro adds industries, candidates, asset classes and cosmetics.",
            "It does not add a point to your score, save a company that was going under, or move you one place on Still Standing. That is not a promise we are making. It is the design.",
            "The shark is unbribable. Everybody gets the same judgment.",
          ].join("\n\n"),
        },
  );

  return drafts.map((d) => ({
    ...d,
    preview: previewOf(d.body),
    unread: !run.readMail.includes(d.id),
  }));
}

const TONE_DOT: Record<MailMessage["tone"], string> = {
  // Darkened on white for legibility (brand rule); navy carries the neutral.
  bad: "var(--alert)",
  good: "var(--solvency)",
  neutral: "var(--text-primary)",
};

export function BeeMail({ onRead }: { onRead: (id: string) => void }) {
  const { run } = useGame();
  const [openId, setOpenId] = useState<string | null>(null);

  const messages = useMemo(() => (run ? inboxFor(run) : []), [run]);
  const open = messages.find((m) => m.id === openId) ?? null;

  if (!run) return null;

  if (open) {
    return (
      <motion.article
        key={open.id}
        className="px-4 pt-3 pb-6"
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <button
          type="button"
          onClick={() => setOpenId(null)}
          aria-label="Back to inbox"
          className="rounded-full bg-[var(--chip)] px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)] transition-transform duration-150 active:scale-[0.97]"
        >
          ‹ INBOX
        </button>

        <h3 className="mt-4 text-lg font-extrabold leading-tight tracking-[-0.01em]">
          {open.subject}
        </h3>
        <p className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: TONE_DOT[open.tone] }}
          />
          <span className="min-w-0 truncate">{open.from}</span>
        </p>

        <div className="mt-4 space-y-3">
          {open.body.split("\n\n").map((para, i) => (
            <p
              key={i}
              className="text-[0.9375rem] leading-relaxed whitespace-pre-line text-[var(--text)]"
            >
              {para}
            </p>
          ))}
        </div>
      </motion.article>
    );
  }

  const unread = messages.filter((m) => m.unread).length;

  return (
    <div className="px-3 pt-3 pb-6">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 className="text-lg font-extrabold tracking-[-0.01em]">Inbox</h3>
        <span className="tnum text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
          {unread} UNREAD
        </span>
      </div>

      <ul className="mt-3 space-y-2">
        {messages.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => {
                setOpenId(m.id);
                onRead(m.id);
              }}
              aria-label={`${m.from}: ${m.subject}${m.unread ? ", unread" : ""}`}
              className="nv-card flex w-full min-w-0 items-start gap-2.5 px-3.5 py-3 text-left transition-transform duration-150 active:scale-[0.985]"
            >
              <span
                aria-hidden="true"
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: m.unread ? TONE_DOT[m.tone] : "transparent",
                  opacity: m.unread ? 1 : 0,
                }}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-xs ${
                    m.unread
                      ? "font-bold text-[var(--text)]"
                      : "font-semibold text-[var(--text-secondary)]"
                  }`}
                >
                  {m.from}
                </span>
                <span
                  className={`mt-0.5 block truncate text-[0.9375rem] leading-snug ${
                    m.unread ? "font-bold" : "font-semibold text-[var(--text-secondary)]"
                  }`}
                >
                  {m.subject}
                </span>
                <span className="mt-0.5 block truncate text-xs leading-snug text-[var(--text-tertiary)]">
                  {m.preview}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
