/**
 * Minimal TS loader for the simulation harness: strips types so the engine
 * modules can run under plain node. The engine is type-only TS (no decorators,
 * no enums), so transpiling with the bundled TypeScript compiler is enough.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolvePath(here, "..");

export function resolve(specifier, context, next) {
  /*
   * `server-only` is a bundler boundary marker, not a runtime dependency.
   *
   * Its index.js throws on import so that a Client Component pulling in server
   * code fails the BUILD. Under this harness there is no client boundary to
   * protect — there is no bundle at all — so the throw would only mean the
   * server-side modules are the ones that can never be tested, which is
   * exactly backwards: lib/rewards/roll.ts carries the odds every reward in
   * the game is drawn from. The package ships empty.js for this case (it is
   * what the "react-server" export condition resolves to); pointing at it here
   * keeps the build-time guard intact and makes the module reachable from a
   * test.
   */
  if (specifier === "server-only") {
    return next(pathToFileURL(resolvePath(projectRoot, "node_modules/server-only/empty.js")).href, context);
  }
  // Map the "@/..." path alias used by the app.
  if (specifier.startsWith("@/")) {
    const target = resolvePath(projectRoot, specifier.slice(2));
    // App code writes `@/lib/engine/run`, not `@/lib/engine/run.ts` — the
    // bundler adds the extension and node does not. Without this the alias
    // resolved to an extensionless path that exists as a file for nobody, and
    // anything outside lib/engine/ was unreachable from a harness.
    const withExt = /\.[a-z]+$/i.test(target) ? target : `${target}.ts`;
    return next(pathToFileURL(withExt).href, context);
  }
  // Allow extensionless relative imports between engine modules.
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[a-z]+$/i.test(specifier)
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    return next(pathToFileURL(resolvePath(parentDir, `${specifier}.ts`)).href, context);
  }
  return next(specifier, context);
}

export function load(url, context, next) {
  /*
   * JSON, the way a bundler hands it over.
   *
   * `import events from "@/data/events.json"` is a default import in app code.
   * Node's own JSON modules need an import attribute the app does not write and
   * TypeScript would not emit, so the file is wrapped as a module here instead.
   * The engine's own imports are all relative .ts, which is why this never came
   * up until something outside lib/engine/ needed loading.
   */
  if (url.endsWith(".json")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${source};`,
    };
  }
  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.Preserve,
      },
      fileName: fileURLToPath(url),
    });
    return { format: "module", shortCircuit: true, source: outputText };
  }
  return next(url, context);
}
