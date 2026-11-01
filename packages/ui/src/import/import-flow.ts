import { type Capture, FrottageFileError, unpackFrottage } from "@repo/capture-schema";
import { sha256Hex } from "@repo/capture-schema/hash";
import {
  batchOps,
  DEFAULT_IMPORT_OPTIONS,
  type FontRef,
  type ImportOptions,
  type ImportReport,
  mapCapture,
  missingFonts,
  type PlanOp,
  type PlanTokens,
} from "@repo/figma-mapper";
import { messageForError } from "./messages";
import { groupVersions, type LoadedFile } from "./versions";

export { messageForError };

/** A font the file uses that the user does not have, with the available family chosen for it. */
export type ReviewFont = { family: string; choice: string };

/** What one imported version reports. */
export type VersionResult = {
  report: ImportReport;
  failedOps: number;
  missingImages: number;
  rewrappedTexts: number;
  textDriftCount: number;
  autoLayoutFrames: number;
  fallbackFrames: number;
  componentsCreated: number;
  instancesCreated: number;
  overrideFailures: number;
  overrideFailuresInMains: number;
  layoutFailures: number;
  hoverVariants: number;
  hoverFailures: number;
  paintFailures: number;
  resizedFallbacks: number;
  stylesCreated: number;
  stylesReused: number;
  variablesCreated: number;
  variablesReused: number;
  tokenFailures: number;
};

export type VersionReport = VersionResult & { name: string; label: string };

export type FileFailure = { name: string; message: string };

export type ImportState =
  | { step: "idle" }
  | {
      step: "review";
      missing: ReviewFont[];
      /** Every available family, for the choices. */
      families: string[];
      options: ImportOptions;
      hostname: string;
    }
  | {
      step: "working";
      done: number;
      total: number;
      /** Which file of the drop is in hand; `index` counts from 1. */
      file: { index: number; total: number; name: string };
    }
  | ({ step: "done" } & VersionResult & {
        /** One report per imported version, in import order. Task 7 adds the set around them. */
        versions: VersionReport[];
        /** Files that could not be imported, by name. */
        failures: FileFailure[];
      })
  | { step: "error"; message: string };

export type ImportPort = {
  getPrefs(key: string): Promise<unknown>;
  setPrefs(key: string, value: unknown): Promise<void>;
  listFonts(): Promise<FontRef[]>;
  begin(meta: { name: string; fonts: FontRef[]; totalOps: number }): Promise<void>;
  tokens(tokens: PlanTokens, options: ImportOptions): Promise<void>;
  image(hash: string, bytes: Uint8Array): Promise<{ ok: boolean }>;
  batch(ops: PlanOp[]): Promise<void>;
  end(): Promise<{
    rootId: string;
    failedOps: number;
    missingImages?: number;
    rewrappedTexts?: number;
    textDriftCount?: number;
    autoLayoutFrames?: number;
    fallbackFrames?: number;
    componentsCreated?: number;
    instancesCreated?: number;
    overrideFailures?: number;
    overrideFailuresInMains?: number;
    layoutFailures?: number;
    hoverVariants?: number;
    hoverFailures?: number;
    paintFailures?: number;
    resizedFallbacks?: number;
    stylesCreated?: number;
    stylesReused?: number;
    variablesCreated?: number;
    variablesReused?: number;
    tokenFailures?: number;
  }>;
  cancel(): Promise<void>;
};

/** What the user confirmed in the review step. `fonts` maps a missing family to a chosen one. */
export type ReviewDecision = { options: ImportOptions; fonts: ReadonlyMap<string, string> };

export type ReviewSession = {
  /** Review even when no font is missing. */
  forceReview: boolean;
  /** Resolves when the user confirms, or with null when they cancel. */
  decide(): Promise<ReviewDecision | null>;
};

/** Stored options are untrusted: take each boolean field that is one, and keep the default for the rest. */
export function sanitizeOptions(raw: unknown): ImportOptions {
  const options = { ...DEFAULT_IMPORT_OPTIONS };
  if (typeof raw !== "object" || raw === null) return options;
  for (const key of Object.keys(options) as (keyof ImportOptions)[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "boolean") options[key] = value;
  }
  return options;
}

/** Prefs never block an import: a failing read is as good as nothing stored. */
async function readPref(port: ImportPort, key: string): Promise<unknown> {
  try {
    return await port.getPrefs(key);
  } catch {
    return undefined;
  }
}

async function writePref(port: ImportPort, key: string, value: unknown): Promise<void> {
  try {
    await port.setPrefs(key, value);
  } catch {
    // Not remembering is the only cost.
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Files above this are refused before reading; the container enforces the real limits. */
export const MAX_FILE_BYTES = 300 * 1024 * 1024;

const SHA256_KEY = /^[0-9a-f]{64}$/i;

/** A hidden iframe gets no animation frames, so the import never waits longer than this for one. */
const PAINT_WAIT_MS = 100;

/** Let the browser paint and handle input; safe where requestAnimationFrame is absent or stalled. */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve);
      return;
    }
    const fallback = setTimeout(resolve, PAINT_WAIT_MS);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      setTimeout(resolve);
    });
  });
}

/** The root layer's name: the page title, else its hostname, never anything from the query. */
function importName({ title, url }: Capture["source"]): string {
  const name = title.trim();
  if (name) return name;
  try {
    return new URL(url).hostname || "Frottage import";
  } catch {
    return "Frottage import";
  }
}

async function verifyAssets(assets: Map<string, Uint8Array>): Promise<void> {
  for (const [key, bytes] of assets) {
    if (!SHA256_KEY.test(key)) continue;
    if (sha256Hex(bytes) !== key.toLowerCase()) throw new FrottageFileError("corrupt-asset");
    await yieldToPaint();
  }
}

/** Files and bytes in one drop. Over either, nothing is read. */
export const MAX_FILES = 8;
export const MAX_TOTAL_BYTES = 600 * 1024 * 1024;

const TOO_MANY_FILES = `Frottage imports up to ${MAX_FILES} files at a time. Choose fewer files and try again.`;
const TOO_MANY_BYTES = "These files add up to more than 600 MB. Choose fewer files and try again.";

/** Read and unpack one file. `verify` also checks every image against its hash. */
export async function loadFile(file: File, verify = true): Promise<LoadedFile> {
  if (file.size > MAX_FILE_BYTES) throw new FrottageFileError("too-large");
  await yieldToPaint();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { capture, assets } = unpackFrottage(bytes);
  if (verify) await verifyAssets(assets);
  return { name: file.name, capture, assets };
}

type FileInfo = { index: number; total: number; name: string };

type VersionContext = {
  port: ImportPort;
  onState: (s: ImportState) => void;
  signal?: AbortSignal;
  available: FontRef[];
  options: ImportOptions;
  overrides?: Record<string, string>;
  file: FileInfo;
};

/** The sandbox's end() result and the plan's report, as the screen shows them. */
function versionResult(
  report: ImportReport,
  result: Awaited<ReturnType<ImportPort["end"]>>
): VersionResult {
  return {
    report,
    failedOps: result.failedOps,
    missingImages: result.missingImages ?? 0,
    rewrappedTexts: result.rewrappedTexts ?? 0,
    textDriftCount: result.textDriftCount ?? 0,
    autoLayoutFrames: result.autoLayoutFrames ?? 0,
    fallbackFrames: result.fallbackFrames ?? 0,
    componentsCreated: result.componentsCreated ?? 0,
    instancesCreated: result.instancesCreated ?? 0,
    overrideFailures: result.overrideFailures ?? 0,
    overrideFailuresInMains: result.overrideFailuresInMains ?? 0,
    layoutFailures: result.layoutFailures ?? 0,
    hoverVariants: result.hoverVariants ?? 0,
    hoverFailures: result.hoverFailures ?? 0,
    paintFailures: result.paintFailures ?? 0,
    resizedFallbacks: result.resizedFallbacks ?? 0,
    stylesCreated: result.stylesCreated ?? 0,
    stylesReused: result.stylesReused ?? 0,
    variablesCreated: result.variablesCreated ?? 0,
    variablesReused: result.variablesReused ?? 0,
    tokenFailures: result.tokenFailures ?? 0,
  };
}

/**
 * Create one version in Figma, from a file already loaded and verified. Returns null when the
 * user cancelled (the sandbox is already undone); throws on failure, after undoing what it made.
 */
export async function importVersion(
  loaded: LoadedFile,
  ctx: VersionContext
): Promise<VersionResult | null> {
  const { port, onState, signal, file } = ctx;
  const { capture, assets } = loaded;
  let begun = false;
  const stop = async () => {
    if (begun) {
      begun = false;
      await port.cancel();
    }
    return null;
  };
  try {
    const plan = mapCapture(capture, ctx.available, ctx.options, ctx.overrides);
    const total = plan.ops.length;
    onState({ step: "working", done: 0, total, file });

    // Set first: a begin that fails halfway may still have created state to cancel.
    begun = true;
    await port.begin({ name: importName(capture.source), fonts: plan.fonts, totalOps: total });
    // A Cancel pressed while begin ran waits for it to return, then undoes what it made.
    if (signal?.aborted) return await stop();
    await port.tokens(plan.tokens, ctx.options);

    for (const hash of plan.assetHashes) {
      if (signal?.aborted) return await stop();
      const data = assets.get(hash);
      // A failed image is not an error here; the sandbox counts it in `missingImages` at end().
      if (data) await port.image(hash, data);
    }

    let done = 0;
    for (const ops of batchOps(plan.ops)) {
      if (signal?.aborted) return await stop();
      await port.batch(ops);
      done += ops.length;
      onState({ step: "working", done, total, file });
    }

    if (signal?.aborted) return await stop();
    const result = await port.end();
    if (!result.rootId) throw new Error("Nothing was created");
    begun = false;
    onState({ step: "working", done: total, total, file });
    return versionResult(plan.report, result);
  } catch (error) {
    if (begun) {
      try {
        await port.cancel();
      } catch {
        // The error below is what matters.
      }
    }
    throw error;
  }
}

/** Fold one more file's missing fonts into the set's, by family; the first `nearest` stays. */
function mergeMissing(into: Map<string, string>, found: { family: string; nearest: string }[]) {
  for (const { family, nearest } of found) if (!into.has(family)) into.set(family, nearest);
}

/**
 * Import the chosen files. Files of one page form a set, imported in order, each through the
 * single-file flow. The review step shows once, with the missing fonts of every file. A bad file
 * is reported by name and the others carry on.
 *
 * Cancel stops the run and undoes the version in hand; versions already finished stay. Removing
 * a whole set is the sandbox's job (Task 7).
 */
export async function runImports(
  files: File[],
  port: ImportPort,
  onState: (s: ImportState) => void,
  session?: ReviewSession,
  /** Aborted by the user's Cancel; checked between steps, images and batches. */
  signal?: AbortSignal
): Promise<void> {
  const failures: FileFailure[] = [];
  const fail = (name: string, error: unknown) =>
    failures.push({ name, message: messageForError(error) });
  const finishWithError = () => {
    const message =
      failures.length === 1
        ? (failures[0]?.message ?? "")
        : failures.map((f) => `${f.name}: ${f.message}`).join("\n");
    onState({ step: "error", message });
  };

  try {
    if (files.length > MAX_FILES) return onState({ step: "error", message: TOO_MANY_FILES });
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
      return onState({ step: "error", message: TOO_MANY_BYTES });
    }

    // Pass 1, one file at a time: keep each capture but let its images go, unless it is the only
    // file. The images are read again when their version imports.
    const sources = new Map<Capture["source"], File>();
    const light: LoadedFile[] = [];
    for (const [i, file] of files.entries()) {
      onState({
        step: "working",
        done: 0,
        total: 0,
        file: { index: i + 1, total: files.length, name: file.name },
      });
      try {
        const loaded = await loadFile(file, files.length === 1);
        const kept = files.length === 1 ? loaded : { ...loaded, assets: new Map() };
        sources.set(kept.capture.source, file);
        light.push(kept);
      } catch (error) {
        fail(file.name, error);
      }
      if (signal?.aborted) return onState({ step: "idle" });
    }
    if (light.length === 0) return finishWithError();

    const sets = groupVersions(light);
    const ordered = sets.flatMap((s) => s.versions);
    // Grouping may relabel (copy) a file, but its capture's source object stays the same.
    const fileOf = (v: LoadedFile): File => sources.get(v.capture.source) as File;

    await yieldToPaint();
    const available = await port.listFonts();
    const hostname = hostnameOf(ordered[0]?.capture.source.url ?? "");
    let options = sanitizeOptions(
      hostname ? await readPref(port, `options:${hostname}`) : undefined
    );

    const missing = new Map<string, string>();
    for (const v of ordered) {
      mergeMissing(
        missing,
        missingFonts(mapCapture(v.capture, available, options).report, available)
      );
    }

    let overrides: Record<string, string> | undefined;
    if (session && (missing.size > 0 || session.forceReview)) {
      const families = [...new Set(available.map((f) => f.family))];
      const reviewFonts: ReviewFont[] = [];
      for (const [family, nearest] of missing) {
        const stored = await readPref(port, `font:${family}`);
        const choice = typeof stored === "string" && families.includes(stored) ? stored : nearest;
        reviewFonts.push({ family, choice });
      }
      onState({ step: "review", missing: reviewFonts, families, options, hostname });
      const decision = await session.decide();
      if (!decision) return onState({ step: "idle" });
      options = sanitizeOptions(decision.options);
      // Prefilled choices the user left alone still apply to the plan, but are not remembered.
      overrides = Object.create(null) as Record<string, string>;
      const changed: [string, string][] = [];
      for (const { family, choice } of reviewFonts) {
        const picked = decision.fonts.get(family);
        const chosen = typeof picked === "string" && families.includes(picked) ? picked : choice;
        overrides[family] = chosen;
        if (chosen !== choice) changed.push([family, chosen]);
      }
      await yieldToPaint();
      if (hostname) await writePref(port, `options:${hostname}`, options);
      for (const [family, chosen] of changed) await writePref(port, `font:${family}`, chosen);
    }

    // Pass 2: the set loop. Task 7 puts a set (one token collection, one mode per version) around
    // each iteration of the inner loop.
    const versions: VersionReport[] = [];
    let index = 0;
    for (const set of sets) {
      for (const version of set.versions) {
        index += 1;
        if (signal?.aborted) return onState({ step: "idle" });
        const info: FileInfo = { index, total: ordered.length, name: version.name };
        onState({ step: "working", done: 0, total: 0, file: info });
        try {
          const source = fileOf(version);
          const full =
            files.length === 1 ? version : { ...version, assets: (await loadFile(source)).assets };
          const result = await importVersion(full, {
            port,
            onState,
            signal,
            available,
            options,
            overrides,
            file: info,
          });
          if (!result) return onState({ step: "idle" });
          versions.push({
            ...result,
            name: version.name,
            label: version.capture.version?.label ?? "",
          });
        } catch (error) {
          fail(version.name, error);
        }
      }
    }

    const first = versions[0];
    if (!first) return finishWithError();
    onState({ ...first, step: "done", versions, failures });
  } catch (error) {
    onState({ step: "error", message: messageForError(error) });
  }
}
