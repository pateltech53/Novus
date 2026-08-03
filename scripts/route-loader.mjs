/**
 * Loader shim so route handlers can be imported by a plain `node` script.
 *
 * Chains in front of `ts-loader.mjs`, which already strips types and maps the
 * `@/` alias but knows nothing about Next's package layout. Two gaps to close:
 *
 *   · `next/server` has no extensionless ESM resolution outside a Next build,
 *     so bare Node cannot find it. Point it at the real file.
 *   · `server-only` exists to make importing a module from a Client Component
 *     a build error. Under Node there is no client, and its package exports
 *     have no plain-node condition, so it is stubbed to nothing.
 *
 * Test-only. Nothing the app ships goes through this.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

const EMPTY = pathToFileURL(resolvePath(projectRoot, "scripts/empty-module.mjs")).href;

export function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: EMPTY, format: "module", shortCircuit: true };
  }
  if (specifier === "next/server") {
    return next(pathToFileURL(require.resolve("next/server.js")).href, context);
  }
  // `ts-loader.mjs` maps the "@/" alias but leaves it extensionless, which is
  // fine for the engine (imported by full path) and not for route handlers.
  if (specifier.startsWith("@/")) {
    const base = resolvePath(projectRoot, specifier.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}
