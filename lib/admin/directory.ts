import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/admin/guard";

/** One server-side query for the directory, billing lists and CSV exports.
 * Compose filters before the range; quoted PostgREST literals keep a name
 * containing commas or parentheses from becoming filter syntax. */
export const DIRECTORY_FILTERS = [
  "paid",
  "gifted",
  "chapter",
  "playing",
  "mismatch",
  "admins",
  "anonymous",
  "not-granted",
  "not-billed",
  "cancelling",
  "past-due",
] as const;
export function boundedInt(
  value: string | null,
  fallback: number,
  max: number,
) {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > max)
    throw new Error("Invalid page or page size.");
  return n;
}
export const searchPattern = (value: string) =>
  `"%${value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/"/g, '\\"')}%"`;
export function directoryQuery(params: URLSearchParams) {
  const filters = (params.get("filters") ?? "").split(",").filter(Boolean);
  if (
    filters.some((f) => !(DIRECTORY_FILTERS as readonly string[]).includes(f))
  )
    throw new Error("Unknown account filter.");
  const sort = params.get("sort") ?? "joined";
  if (!["joined", "seen", "runs", "value"].includes(sort))
    throw new Error("Unknown account sort.");
  const sortColumn = {
    joined: "created_at",
    seen: "last_seen",
    runs: "runs_completed",
    value: "top_valuation",
  }[sort];
  if (!sortColumn) throw new Error("Unknown account sort.");
  const needle = (params.get("q") ?? "").trim().slice(0, 200);
  let query = adminClient()
    .from("admin_directory")
    .select("*", { count: "exact" });
  if (needle) {
    if (isUuid(needle)) query = query.eq("id", needle);
    else {
      const pattern = searchPattern(needle);
      query = query.or(
        `email.ilike.${pattern},display_name.ilike.${pattern},board_handle.ilike.${pattern}`,
      );
    }
  }
  for (const filter of filters) {
    switch (filter) {
      case "paid":
        query = query.eq("paid", true);
        break;
      case "gifted":
        query = query.eq("comp_pro", true);
        break;
      case "chapter":
        query = query.or("chapter.not.is.null,owns_chapter_status.eq.active");
        break;
      case "playing":
        query = query.gt("companies_alive", 0);
        break;
      case "mismatch":
        query = query.not("billing_mismatch", "is", null);
        break;
      case "admins":
        query = query.eq("role", "admin");
        break;
      case "anonymous":
        query = query.eq("is_anonymous", true);
        break;
      case "not-granted":
        query = query.eq("billing_mismatch", "stripe-not-granted");
        break;
      case "not-billed":
        query = query.eq("billing_mismatch", "granted-not-billed");
        break;
      case "cancelling":
        query = query
          .eq("cancel_at_period_end", true)
          .in("subscription_status", ["active", "trialing", "past_due"]);
        break;
      case "past-due":
        query = query.eq("subscription_status", "past_due");
        break;
    }
  }
  return query
    .order(sortColumn, { ascending: false, nullsFirst: false })
    .order("id", { ascending: true });
}

/** CSV text must remain text when a spreadsheet opens it. Quoting alone does
 * not neutralize a formula supplied as a player's display name. */
export const csvCell = (value: unknown): string => {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
