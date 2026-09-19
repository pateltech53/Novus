export interface Prize {
  place: number;
  kind: "chest" | "runs";
  quantity: number;
  tier: number | null;
}
export interface CompetitionSpec {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  enrollment: "automatic" | "opt_in";
  audience: "all" | "selected";
  students: string[];
  prizes: Prize[];
}
export function parseCompetition(
  value: unknown,
  now = Date.now(),
): CompetitionSpec {
  if (!value || typeof value !== "object")
    throw new Error("Complete the competition details.");
  const v = value as Record<string, unknown>;
  const title = typeof v.title === "string" ? v.title.trim() : "";
  const description =
    typeof v.description === "string" ? v.description.trim() : "";
  const start = typeof v.startsAt === "string" ? Date.parse(v.startsAt) : NaN;
  const end = typeof v.endsAt === "string" ? Date.parse(v.endsAt) : NaN;
  if (!title || title.length > 100 || description.length > 1000)
    throw new Error(
      "Use a title of 1–100 characters and a description up to 1,000 characters.",
    );
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start <= now ||
    end <= start
  )
    throw new Error("Choose a future start and an end after the start.");
  if (
    !["automatic", "opt_in"].includes(String(v.enrollment)) ||
    !["all", "selected"].includes(String(v.audience))
  )
    throw new Error("Choose enrollment and eligible students.");
  const students = Array.isArray(v.students) ? [...new Set(v.students)] : [];
  if (
    students.length > 10000 ||
    students.some(
      (id) =>
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    ) ||
    (v.audience === "selected" && !students.length)
  )
    throw new Error("Select at least one student from this enterprise.");
  if (!Array.isArray(v.prizes) || v.prizes.length < 1 || v.prizes.length > 100)
    throw new Error("Configure prizes for 1–100 places.");
  const seen = new Set<number>();
  const prizes = v.prizes.map((raw: unknown): Prize => {
    const p = raw as Prize | null;
    if (
      !p ||
      !Number.isInteger(p.place) ||
      p.place < 1 ||
      p.place > 100 ||
      seen.has(p.place) ||
      !["chest", "runs"].includes(p.kind) ||
      !Number.isInteger(p.quantity) ||
      p.quantity < 1 ||
      p.quantity > 100 ||
      (p.kind === "chest" &&
        (!Number.isInteger(p.tier) || p.tier! < 1 || p.tier! > 5))
    )
      throw new Error(
        "Each prize needs a unique place, a quantity of 1–100, and a chest tier from 1–5.",
      );
    seen.add(p.place);
    return {
      place: p.place,
      kind: p.kind,
      quantity: p.quantity,
      tier: p.kind === "chest" ? p.tier : null,
    };
  });
  return {
    title,
    description,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    enrollment: v.enrollment as CompetitionSpec["enrollment"],
    audience: v.audience as CompetitionSpec["audience"],
    students: students as string[],
    prizes,
  };
}
export const prizeLabel = (p: Prize) =>
  p.kind === "runs"
    ? `${p.quantity} run ticket${p.quantity === 1 ? "" : "s"}`
    : `${p.quantity} tier ${p.tier} chest${p.quantity === 1 ? "" : "s"}`;
