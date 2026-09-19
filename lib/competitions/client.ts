"use client";
import { apiUrl, API_CREDENTIALS } from "@/lib/native/origin";
import {
  loadEntitlements,
  saveEntitlements,
  runStartLedger,
  runsPerDayFor,
  isPro,
} from "@/lib/monetization";
import { loadRun, listIslands, activeIsland } from "@/lib/engine/save";
import { buildTape } from "@/lib/leaderboard/recorder";
import type { RunState, Industry } from "@/lib/engine/types";
export async function competitionRequest(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const res = await fetch(apiUrl(path), {
    method,
    credentials: API_CREDENTIALS,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok || data.error)
    throw Object.assign(new Error(data.error || "Please try again."), {
      status: res.status,
    });
  return data;
}
export async function registerStart(industry: Industry, tutorial: boolean) {
  if (navigator.onLine === false) {
    const e = loadEntitlements();
    if (runStartLedger().started >= runsPerDayFor(e))
      throw new Error("Connect to use a run ticket.");
    return {
      seed: null,
      pro: isPro(e) || e.admin,
      ticket_used: false,
      tutorial,
    };
  }
  const signature = JSON.stringify({ industry, tutorial });
  let requestId = crypto.randomUUID();
  try {
    const pending = JSON.parse(
      sessionStorage.getItem("novus:pending-founding:v1") ?? "null",
    );
    if (pending?.signature === signature) requestId = pending.requestId;
    sessionStorage.setItem(
      "novus:pending-founding:v1",
      JSON.stringify({ signature, requestId }),
    );
  } catch {
    /* the in-flight guard still protects this page */
  }
  const ledger = runStartLedger();
  const data = await competitionRequest("/api/company/start", {
    requestId,
    industry,
    tutorial,
    day: ledger.dayISO,
    started: ledger.started,
  });
  saveEntitlements({
    ...loadEntitlements(),
    runTickets: Number(data.start.tickets) || 0,
  });
  return data.start as {
    seed: number | null;
    pro: boolean;
    ticket_used: boolean;
    tutorial: boolean;
  };
}
export function completeStart() {
  try {
    sessionStorage.removeItem("novus:pending-founding:v1");
  } catch {
    /* storage unavailable */
  }
}
type Snapshot = {
  run: RunState;
  tape: NonNullable<ReturnType<typeof buildTape>>;
  signature: string;
};
const pending = new Map<string, Snapshot>();
const synced = new Map<string, string>();
const ineligible = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let sending = false;
let lastSent = 0;
function schedule() {
  if (!timer && pending.size)
    timer = setTimeout(
      () => {
        timer = null;
        void flushCompetitionScore();
      },
      Math.max(500, 6000 - (Date.now() - lastSent)),
    );
}
export function queueCompetitionScore(
  run: RunState,
  snapshot?: ReturnType<typeof buildTape>,
) {
  if (ineligible.has(run.id)) return false;
  const tape = snapshot === undefined ? buildTape(run) : snapshot;
  if (!tape) return false;
  const signature = JSON.stringify(tape);
  if (synced.get(run.id) === signature) return false;
  pending.set(run.id, { run, tape, signature });
  schedule();
  return true;
}
/** Re-read each island's own tape after navigation or an offline session. */
export async function syncSavedCompetitionScores() {
  const active = activeIsland();
  const islands = listIslands().sort(
    (a, b) => Number(b.slot === active) - Number(a.slot === active),
  );
  let queued = 0;
  for (const island of islands) {
    const run = loadRun(island.slot);
    if (run && queueCompetitionScore(run, buildTape(run, island.slot)))
      queued++;
  }
  await flushCompetitionScore();
  return queued;
}
export async function flushCompetitionScore() {
  if (!pending.size || sending) return;
  const [id, next] = pending.entries().next().value!;
  pending.delete(id);
  sending = true;
  try {
    const result = await competitionRequest("/api/competitions/score", {
      tape: next.tape,
      peak: Math.max(next.run.peakValuation ?? 0, next.run.stats.valuation),
      years: Math.max(1, next.run.year - (next.run.alive ? 1 : 0)),
    });
    if (!result.count) {
      ineligible.add(id);
      pending.delete(id);
    } else synced.set(id, next.signature);
    window.dispatchEvent(
      new CustomEvent("novus:competition-sync", {
        detail: { runId: next.run.id, ...result },
      }),
    );
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    if ((!status || status >= 500 || status === 429) && !pending.has(id))
      pending.set(id, next);
    window.dispatchEvent(
      new CustomEvent("novus:competition-sync", {
        detail: { error: (e as Error).message },
      }),
    );
  } finally {
    sending = false;
    lastSent = Date.now();
    schedule();
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushCompetitionScore());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushCompetitionScore();
  });
}
