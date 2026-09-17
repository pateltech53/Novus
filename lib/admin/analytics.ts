/** Cohort ages are measured from the end of a UTC signup week. A window
 * that has not elapsed is unavailable, in both chart and table. */
export function cohortRate(
  week: string,
  cohort: number,
  count: number,
  days: number,
  now = Date.now(),
): number | null {
  const end = Date.parse(`${week}T00:00:00Z`) + (7 + days) * 86400000;
  return cohort > 0 && now >= end ? Math.round((count / cohort) * 100) : null;
}
