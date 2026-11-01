// Extension build: popup, run and offscreen pages, service worker (ESM), capture script (IIFE)
// and manifest.
//   bun build.ts              one production-or-dev build (NODE_ENV decides)
//   bun build.ts --watch      rebuild on changes under the source dirs
//   bun build.ts --analyze    also write dist/meta-*.json
import { watch } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import tailwind from "bun-plugin-tailwind";
import type manifestShape from "./chrome.manifest";

type Manifest = typeof manifestShape;

const root = import.meta.dir;
const src = path.resolve(root, "src");
const watched = [
  src,
  path.resolve(root, "../../packages/ui/src"),
  path.resolve(root, "../../packages/capture-dom/src"),
  path.resolve(root, "../../packages/capture-schema/src"),
];
const manifestFile = path.resolve(root, "chrome.manifest.ts");
const outdir = path.resolve(root, "dist");

const isProd = process.env.NODE_ENV === "production";
const args = new Set(Bun.argv.slice(2));
const watchMode = args.has("--watch");
const analyze = args.has("--analyze");

const sourcemap = isProd ? "none" : "inline";
const define = { "process.env.NODE_ENV": JSON.stringify(isProd ? "production" : "development") };

async function writeMetafile(name: string, metafile: Bun.BuildOutput["metafile"]) {
  if (!metafile) return;
  const json = typeof metafile === "string" ? metafile : JSON.stringify(metafile, null, 2);
  await Bun.write(path.join(outdir, name), json);
}

function failOnErrors(name: string, result: Bun.BuildOutput) {
  for (const log of result.logs) console.warn(log);
  if (!result.success) throw new Error(`${name} build failed`);
}

// Popup, run and offscreen pages. Not `compile`d: an extension page may load its own script
// files, and MV3's default CSP forbids inline scripts, so the output keeps them external.
async function buildPages() {
  const result = await Bun.build({
    entrypoints: [
      path.join(src, "popup/popup.html"),
      path.join(src, "run/run.html"),
      path.join(src, "offscreen.html"),
    ],
    target: "browser",
    outdir,
    naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    reactCompiler: true,
    plugins: [tailwind],
    minify: isProd,
    sourcemap,
    define,
    metafile: analyze,
  });
  failOnErrors("pages", result);
  await writeMetafile("meta-pages.json", result.metafile);
}

async function buildWorker() {
  const result = await Bun.build({
    entrypoints: [path.join(src, "service-worker.ts")],
    target: "browser",
    format: "esm",
    outdir,
    naming: "service-worker.[ext]",
    minify: isProd,
    sourcemap,
    define,
    metafile: analyze,
  });
  failOnErrors("service worker", result);
  await writeMetafile("meta-service-worker.json", result.metafile);
}

async function buildCaptureEntry() {
  const result = await Bun.build({
    entrypoints: [path.join(src, "capture-entry.ts")],
    target: "browser",
    format: "iife",
    outdir,
    naming: "capture-entry.[ext]",
    minify: isProd,
    sourcemap,
    define,
    metafile: analyze,
  });
  failOnErrors("capture script", result);
  await writeMetafile("meta-capture-entry.json", result.metafile);
}

function loadManifest(): Manifest {
  // Drop the cached module so edits are picked up in --watch.
  delete require.cache[manifestFile];
  delete require.cache[path.resolve(root, "package.json")];
  const mod = require(manifestFile) as { default: Manifest };
  return mod.default;
}

async function writeManifest() {
  await Bun.write(
    path.join(outdir, "manifest.json"),
    `${JSON.stringify(loadManifest(), null, 2)}\n`
  );
}

async function build() {
  const started = performance.now();
  await buildPages();
  await buildWorker();
  await buildCaptureEntry();
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
  for (const dir of watched) watch(dir, { recursive: true }, schedule);
  // Watch the directory, not the file: atomic-save editors replace the inode.
  watch(root, (_event, filename) => {
    if (filename === "chrome.manifest.ts" || filename === "package.json") schedule();
  });
  console.log("[build] watching for changes… (Ctrl+C to stop)");
} else if (!(await runOnce())) {
  process.exit(1);
}
