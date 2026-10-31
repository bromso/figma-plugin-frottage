// Plugin build: UI (single-file HTML), sandbox (IIFE) and manifest.
//   bun build.ts              one production-or-dev build (NODE_ENV decides)
//   bun build.ts --watch      rebuild on changes under the three source dirs
//   bun build.ts --analyze    also write dist/meta-ui.json and dist/meta-plugin.json
import { watch } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import tailwind from "bun-plugin-tailwind";
import type manifestShape from "./figma.manifest";

type Manifest = typeof manifestShape;

const root = import.meta.dir;
const uiSrc = path.resolve(root, "../../packages/ui/src");
const commonSrc = path.resolve(root, "../../packages/common/src");
const pluginSrc = path.resolve(root, "src/plugin");
const manifestFile = path.resolve(root, "figma.manifest.ts");
const outdir = path.resolve(root, "dist");

const isProd = process.env.NODE_ENV === "production";
const args = new Set(Bun.argv.slice(2));
const watchMode = args.has("--watch");
const analyze = args.has("--analyze");

const sourcemap = isProd ? "none" : "inline";

// Bun's `metafile` option is a boolean; the data comes back on the build result.
// bun-types declares `BuildOutput.metafile` as an object (`BuildMetafile`), but the
// `metafile` option's JSDoc example does `JSON.parse(result.metafile!)`, implying a
// string. Handle both.
async function writeMetafile(name: string, metafile: Bun.BuildOutput["metafile"]) {
  if (!metafile) return;
  const json = typeof metafile === "string" ? metafile : JSON.stringify(metafile, null, 2);
  await Bun.write(path.join(outdir, name), json);
}

async function buildUi() {
  const result = await Bun.build({
    entrypoints: [path.join(uiSrc, "index.html")],
    // compile + browser target = standalone HTML: JS, CSS and relative assets
    // are inlined. Figma requires the UI to be exactly one HTML file.
    compile: true,
    target: "browser",
    outdir,
    reactCompiler: true,
    plugins: [tailwind],
    minify: isProd,
    sourcemap,
    define: { "process.env.NODE_ENV": JSON.stringify(isProd ? "production" : "development") },
    metafile: analyze,
  });
  for (const log of result.logs) console.warn(log);
  await writeMetafile("meta-ui.json", result.metafile);
}

async function buildPlugin() {
  const result = await Bun.build({
    entrypoints: [path.join(pluginSrc, "plugin.ts")],
    target: "browser",
    format: "iife",
    outdir,
    naming: "plugin.[ext]",
    minify: isProd,
    sourcemap,
    define: { "process.env.NODE_ENV": JSON.stringify(isProd ? "production" : "development") },
    metafile: analyze,
  });
  for (const log of result.logs) console.warn(log);
  await writeMetafile("meta-plugin.json", result.metafile);
}

function loadManifest(): Manifest {
  // Drop the cached module so edits are picked up in --watch. A plain path works on
  // every platform; a `?t=` query on a file:// URL does not bust Bun's module cache.
  delete require.cache[manifestFile];
  const mod = require(manifestFile) as { default: Manifest };
  return mod.default;
}

async function writeManifest() {
  const manifest = loadManifest();
  await Bun.write(path.join(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function build() {
  const started = performance.now();
  await buildUi();
  await buildPlugin();
  await writeManifest();
  const ms = Math.round(performance.now() - started);
  console.log(`[build] ${isProd ? "production" : "development"} build done in ${ms}ms → ${outdir}`);
}

async function runOnce(): Promise<boolean> {
  try {
    await build();
    return true;
  } catch (error) {
    console.error("[build] failed:", error);
    return false;
  }
}

let running = false;
let rerun = false;

// Serialise builds: a change during an in-flight build queues exactly one more.
async function rebuild() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      await runOnce();
    } while (rerun);
  } finally {
    running = false;
  }
}

await rm(outdir, { recursive: true, force: true });

if (watchMode) {
  await runOnce();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  };
  for (const dir of [uiSrc, commonSrc, pluginSrc]) {
    watch(dir, { recursive: true }, schedule);
  }
  // Watch the directory, not the file: atomic-save editors replace the inode.
  watch(root, (_event, filename) => {
    if (filename === "figma.manifest.ts") schedule();
  });
  console.log("[build] watching for changes… (Ctrl+C to stop)");
} else if (!(await runOnce())) {
  process.exit(1);
}
