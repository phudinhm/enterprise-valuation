// Bundles the TypeScript verification suite (resolving the "@/" alias the way
// Next does) and runs it. Kept out of the app bundle entirely.

import * as esbuild from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(mkdtempSync(join(tmpdir(), "verify-")), "verify.mjs");

await esbuild.build({
  entryPoints: [join(root, "scripts/verify-analytics.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: out,
  alias: { "@": root },
  logLevel: "warning",
});

await import(pathToFileURL(out).href);
