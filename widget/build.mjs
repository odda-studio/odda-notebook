import { build, context } from "esbuild";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const banner = { js: `/*! odda-notebook-widget v${pkg.version} | Odda Notebook embeddable chat widget */` };
const common = { entryPoints: ["src/index.ts"], bundle: true, minify: true, target: "es2020", banner, legalComments: "none" };
const configs = [
  { ...common, format: "iife", outfile: "dist/odda-notebook-widget.js", sourcemap: true },
  { ...common, format: "esm", outfile: "dist/odda-notebook-widget.esm.js" },
];

export async function watch(onRebuild) {
  const ctxs = await Promise.all(configs.map((c) => context(c)));
  await Promise.all(ctxs.map((c) => c.watch()));
  return ctxs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await Promise.all(configs.map((c) => build(c)));
  const gz = gzipSync(readFileSync("dist/odda-notebook-widget.js")).length;
  console.log(`built dist/odda-notebook-widget.js (${(gz / 1024).toFixed(1)} KB gzip)`);
}
