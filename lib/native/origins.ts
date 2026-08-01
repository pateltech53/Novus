/**
 * The origins our own binaries run at.
 *
 * `server.hostname` in capacitor.config.ts, under each platform's scheme: iOS
 * serves the bundle over `capacitor://`, Android over `https://`. Kept in step
 * with that file by hand — there are two values and they change only when the
 * app is renamed.
 *
 * Deliberately its own module with no imports. Both the CSRF guard (Node, with
 * the Supabase SDK behind it) and the CORS middleware (Edge, which must stay
 * tiny) need this list, and neither should have to pull in the other's world
 * to get it.
 */
export const NATIVE_ORIGINS: ReadonlySet<string> = new Set([
  "capacitor://app.novuspitch.com",
  "https://app.novuspitch.com",
]);

export function isNativeOrigin(origin: string | null | undefined): boolean {
  return !!origin && NATIVE_ORIGINS.has(origin);
}
