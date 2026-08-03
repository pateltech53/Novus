/**
 * Which boards exist. Deliberately its own module, and deliberately NOT
 * server-only.
 *
 * This vocabulary is needed on both sides: the screen renders a segmented
 * control from it, the read route validates a query parameter against it. It
 * used to live in `season.ts`, which opens with `import "server-only"` because
 * it also carries `MODERATOR_TOKEN` and the service-role-adjacent config.
 *
 * A client component importing a type from that file is erased at compile time
 * and works — right up until somebody needs a value from it too, at which point
 * the build either breaks loudly or, worse, the import is "fixed" by removing
 * the `server-only` guard. Splitting the two-line vocabulary out means the
 * guard never has to be argued with.
 */

export const BOARDS = ["survival", "valuation"] as const;

export type Board = (typeof BOARDS)[number];

export const isBoard = (value: unknown): value is Board =>
  typeof value === "string" && (BOARDS as readonly string[]).includes(value);
