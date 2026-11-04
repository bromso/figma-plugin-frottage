import { type Capture, FrottageFileError, unpackFrottageSet } from "@repo/capture-schema";
import { sha256Hex } from "@repo/capture-schema/hash";
import {
  batchOps,
  COLLECTION_NAMES,
  captureWidth,
  DEFAULT_IMPORT_OPTIONS,
  type DeviceEntry,
  type FontRef,
  type ImportOptions,
  type ImportReport,
  mapCapture,
  mergeDevices,
  mergeVersions,
  missingFonts,
  type PlanLayers,
  type PlanOp,
  type PlanTokens,
  type PlanVersionTokens,
  stripTokens,
} from "@repo/figma-mapper";
import { messageForError } from "./messages";
import { groupVersions, isExtra, type LoadedFile, type VersionSet } from "./versions";

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
  /** What the theme import did, for a page imported on its own with layers. */
  theme?: ThemeReport;
};

/** The theme side of a layered import: the plan's notes and what the sandbox did about them. */
export type ThemeReport = {
  source: "site" | "inferred" | "none";
  /** The colours that are near twins of another. */
  twins: number;
  inferred: string[];
  /** Variables created as `name (2)` because a variable of that name held other values. */
  variablesRenamed: number;
  /** Theme modes the file had no room for. */
  modesDropped: string[];
  /** The file has collections from an earlier Frottage version, which were left as they are. */
  legacyCollections: boolean;
};

export type VersionReport = VersionResult & { name: string; label: string };

/** What a set of versions shares, which no one version reports. */
export type SetReport = {
  /** The page's name. */
  name: string;
  modes: number;
  /** Versions that asked for a mode and got none. */
  modesDropped: number;
  /** Frames that stayed, of those versions, which keep plain values and bind no tokens. */
  plainFrames: number;
  stylesCreated: number;
  stylesReused: number;
  variablesCreated: number;
  variablesReused: number;
  tokenFailures: number;
  layoutFailures: number;
  /** The tokens that stayed plain values in one version, in words. */
  notes: string[];
  /** A device set's theme, reported once for its frames, which share it. */
  theme?: Pick<VersionResult, "report" | "theme">;
};

export type FileFailure = {
  name: string;
  message: string;
  /** A size (one capture of a file) that failed, not a whole file. */
  size?: boolean;
};

export type Placement = "new-page" | "current-page";

/** What a device set's collections and mode warnings come to, for the ticks given. */
export type ContentsSummary = { collections: string; overLimit: string[] };

/** What a device set holds, shown before import: its captures, ticked, and what they make. */
export type ReviewContents = {
  devices: { name: string; width: number; on: boolean }[];
  extras: { breakpoint: string; width: number; on: boolean }[];
  /** The collections the ticked captures make, in one line. */
  collections: string;
  placement: Placement;
  /** One warning per collection that needs more modes than the remembered limit. */
  overLimit: string[];
  /** The line and warnings again, for other ticks: one boolean per device and per extra. */
  summarize?: (devices: boolean[], extras: boolean[]) => ContentsSummary;
};

export type ImportState =
  | { step: "idle" }
  | {
      step: "review";
      missing: ReviewFont[];
      /** Every available family, for the choices. */
      families: string[];
      options: ImportOptions;
      hostname: string;
      /** The first device set of the drop, when it has one. */
      contents?: ReviewContents;
      /** The user asked for the options, which a device set's review otherwise keeps closed. */
      optionsOpen?: boolean;
    }
  | {
      step: "working";
      done: number;
      total: number;
      /** Which file of the drop is in hand; `index` counts from 1. */
      file: { index: number; total: number; name: string; unit: "file" | "size" };
    }
  | ({ step: "done" } & VersionResult & {
        /** One report per imported version, in import order. */
        versions: VersionReport[];
        /** One report per set of two or more versions that left anything. */
        sets: SetReport[];
        /** Files that could not be imported, by name. */
        failures: FileFailure[];
      })
  | { step: "error"; message: string };

export type ImportPort = {
  getPrefs(key: string): Promise<unknown>;
  setPrefs(key: string, value: unknown): Promise<void>;
  listFonts(): Promise<FontRef[]>;
  /** Opens a set of versions; only `endSet` or `cancel` closes it. */
  beginSet(): Promise<void>;
  /** Opens a device set with its merged layers; only `endSet` or `cancel` closes it. */
  beginDeviceSet(meta: {
    name: string;
    layers: PlanLayers;
    options: ImportOptions;
    placement: Placement;
  }): Promise<void>;
  /** The mode limit Figma last refused a mode at, or null. */
  getModeLimit(): Promise<number | null>;
  begin(meta: {
    name: string;
    fonts: FontRef[];
    totalOps: number;
    version?: { index: number; label: string };
    device?: DeviceModes;
  }): Promise<void>;
  tokens(tokens: PlanTokens, options: ImportOptions): Promise<void>;
  /** A set's tokens. Gives the versions that got no mode, which must lose their tokens. */
  importModes(
    tokens: PlanVersionTokens,
    options: ImportOptions
  ): Promise<{ droppedVersions: number[] }>;
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
    layers?: { variablesRenamed: number; modesDropped: string[]; legacyCollections?: boolean };
  }>;
  endSet(): Promise<SetResult>;
  /** Takes back the import in hand: a whole set, when one is open. */
  cancel(): Promise<void>;
};

/** A device frame's Device mode, and its Breakpoint mode when the page has any. */
type DeviceModes = { mode: string; breakpoint: string | null };

/** A collection's modes as the sandbox settled them: those it has, and those added to it now. */
type SettledModes = { kind: string; collection: string; created: string[]; added: string[] };

type SetResult = {
  rootIds: string[];
  layoutFailures: number;
  /** A device set's frames that got no Device or Breakpoint mode. */
  plainVersions?: number[];
  stylesCreated: number;
  stylesReused: number;
  variablesCreated: number;
  variablesReused: number;
  tokenFailures: number;
  modes: number;
  modesDropped: number;
  /** The layered collections' modes, for a set with layers. */
  layers?: { modesDropped: string[]; modes: SettledModes[] };
};

/**
 * What the user confirmed in the review step. `fonts` maps a missing family to a chosen one;
 * `contents` has a tick per device and per extra of the review's contents, and where they go.
 */
export type ReviewDecision = {
  options: ImportOptions;
  fonts: ReadonlyMap<string, string>;
  contents?: { devices: boolean[]; extras: boolean[]; placement: Placement };
};

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
/** Captures in one drop, over all its files. */
export const MAX_CAPTURES = 16;
export const MAX_TOTAL_BYTES = 600 * 1024 * 1024;

/** Shared by the screen's partial and all-failed reports. */
export function failureHeading(count: number, noun: "file" | "size" = "file"): string {
  return count === 1
    ? `1 ${noun} could not be imported`
    : `${count} ${noun}s could not be imported`;
}

/** The heading for a list of failures: sizes when every one is a size of a file, else files. */
export function failuresHeading(failures: FileFailure[]): string {
  const sizes = failures.length > 0 && failures.every((f) => f.size);
  return failureHeading(failures.length, sizes ? "size" : "file");
}

const TOO_MANY_FILES = `Frottage imports up to ${MAX_FILES} files at a time. Choose fewer files and try again.`;
const TOO_MANY_CAPTURES = `Frottage imports up to ${MAX_CAPTURES} sizes at a time. Choose fewer files and try again.`;
const TOO_MANY_BYTES = "These files add up to more than 600 MB. Choose fewer files and try again.";

/**
 * Read and unpack one file, giving one entry per capture in it. `verify` also checks every image
 * against its hash. A file of several captures names each version by its page, not the file.
 */
export async function loadFile(file: File, verify = true): Promise<LoadedFile[]> {
  if (file.size > MAX_FILE_BYTES) throw new FrottageFileError("too-large");
  await yieldToPaint();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { captures, assets } = unpackFrottageSet(bytes);
  if (verify) await verifyAssets(assets);
  const several = captures.length > 1;
  return captures.map((capture) => ({
    name: several ? importName(capture.source) : file.name,
    capture,
    assets,
    several,
  }));
}

type FileInfo = { index: number; total: number; name: string; unit: "file" | "size" };

type Plan = ReturnType<typeof mapCapture>;

/** One version, ready to create: its plan, its images and the names the report uses. */
export type PreparedVersion = {
  plan: Plan;
  assets: Map<string, Uint8Array>;
  /** The root layer's name. */
  rootName: string;
  version: { name: string; label: string };
  /** This version's index in its set, when it's in one of two or more. */
  setIndex?: number;
  /** A device set's frame: its modes. It sends its own tokens, which carry the set's layers. */
  device?: DeviceModes;
};

type VersionContext = {
  port: ImportPort;
  onState: (s: ImportState) => void;
  signal?: AbortSignal;
  options: ImportOptions;
  file: FileInfo;
  /** A set counts all its versions' ops: those before this version's, and the whole. */
  progress?: { done: number; total: number };
};

/** The sandbox's end() result and the plan's report, as the screen shows them. */
function versionResult(
  report: ImportReport,
  result: Awaited<ReturnType<ImportPort["end"]>>,
  layers?: PlanTokens["layers"]
): VersionResult {
  return {
    report,
    ...(layers
      ? {
          theme: {
            source: layers.themeSource,
            twins: new Set(layers.notes.twins.flat()).size,
            inferred: layers.notes.inferred,
            variablesRenamed: result.layers?.variablesRenamed ?? 0,
            modesDropped: result.layers?.modesDropped ?? [],
            legacyCollections: result.layers?.legacyCollections ?? false,
          },
        }
      : {}),
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
 * Create one version in Figma, from a plan and its verified images. Returns null when the
 * user cancelled (the sandbox is already undone, the whole set with it); throws on failure, after
 * undoing what it made. In a set, the sandbox clears a failed version once the next one begins or
 * the set ends: cancelling would take the rest of the set too.
 */
export async function importVersion(
  prepared: PreparedVersion,
  ctx: VersionContext
): Promise<VersionReport | null> {
  const { port, onState, signal, file } = ctx;
  const { plan, assets, version, setIndex, device } = prepared;
  const inSet = setIndex !== undefined;
  const before = ctx.progress?.done ?? 0;
  let begun = false;
  const stop = async () => {
    if (begun) {
      begun = false;
      await port.cancel();
    }
    return null;
  };
  try {
    const total = ctx.progress?.total ?? plan.ops.length;
    onState({ step: "working", done: before, total, file });

    // Set first: a begin that fails halfway may still have created state to cancel.
    begun = true;
    await port.begin({
      name: prepared.rootName,
      fonts: plan.fonts,
      totalOps: plan.ops.length,
      ...(inSet ? { version: { index: setIndex, label: version.label } } : {}),
      ...(device ? { device } : {}),
    });
    // A Cancel pressed while begin ran waits for it to return, then undoes what it made.
    if (signal?.aborted) return await stop();
    // A set's tokens went ahead of its first version. A device set's layers did, but each device
    // still sends its own text styles, with the layers they bind to.
    if (!inSet || device) await port.tokens(plan.tokens, ctx.options);

    for (const hash of plan.assetHashes) {
      if (signal?.aborted) return await stop();
      const data = assets.get(hash);
      // A failed image is not an error here; the sandbox counts it in `missingImages` at end().
      if (data) await port.image(hash, data);
    }

    let done = before;
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
    onState({ step: "working", done: before + plan.ops.length, total, file });
    return { ...versionResult(plan.report, result, plan.tokens.layers), ...version };
  } catch (error) {
    if (begun && !inSet) {
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
export function mergeMissing(
  into: Map<string, string>,
  found: { family: string; nearest: string }[]
) {
  for (const { family, nearest } of found) if (!into.has(family)) into.set(family, nearest);
}

type SetContext = Pick<VersionContext, "port" | "onState" | "signal" | "options"> & {
  /** One plan per version. */
  plans: Plan[];
  /** The file number of the set's first version, from 1, and the files in the drop. */
  firstFile: number;
  totalFiles: number;
  /** A version's images, read again. */
  assetsOf(version: LoadedFile): Promise<Map<string, Uint8Array>>;
  fail(name: string, error: unknown, size?: boolean): void;
  /** What the progress counts: the dropped files, or the sizes of one file. */
  unit: FileInfo["unit"];
};

type SetOutcome = { versions: VersionReport[]; report: SetReport | null; cancelled: boolean };

/** One frame of a set: its version, its plan, and the label its frame and mode go by. */
type SetMember = { version: LoadedFile; plan: Plan; label: string; device?: DeviceModes };

/** How one kind of set opens and reports. Made inside the set's try, so a merge that throws fails it. */
type SetSpec = {
  members: SetMember[];
  /** Opens the set in the sandbox. Gives the members that got no mode, or null when cancelled. */
  open(): Promise<Set<number> | null>;
  /** The set's report lines, from what `endSet` gave. */
  notes(result: SetResult): string[];
  /** Whether a member left without its mode counts as a plain frame of `modesDropped`. */
  modesOwnFrames: boolean;
  /** The frames share one theme, which the set reports once rather than each frame. */
  sharedTheme: boolean;
};

/** The theme its frames share, reported once: their raw values summed, their notes joined. */
function sharedTheme(kept: VersionReport[]): SetReport["theme"] {
  const themed = kept.filter((v) => v.theme);
  const first = themed[0];
  if (!first?.theme) return undefined;
  const raws = themed.flatMap((v) => (v.report.raw ? [v.report.raw] : []));
  const raw =
    raws.length > 0
      ? {
          ...raws[0],
          colors: raws.reduce((n, r) => n + r.colors, 0),
          radii: raws.reduce((n, r) => n + r.radii, 0),
          spacing: raws.reduce((n, r) => n + r.spacing, 0),
        }
      : undefined;
  const themes = themed.map((v) => v.theme as ThemeReport);
  return {
    report: { ...first.report, ...(raw ? { raw } : {}) },
    theme: {
      ...first.theme,
      twins: Math.max(...themes.map((t) => t.twins)),
      inferred: [...new Set(themes.flatMap((t) => t.inferred))],
      variablesRenamed: Math.max(...themes.map((t) => t.variablesRenamed)),
      modesDropped: [...new Set(themes.flatMap((t) => t.modesDropped))],
      legacyCollections: themes.some((t) => t.legacyCollections),
    },
  };
}

/** A version named by its size first, since the page title is the same for all of a file. */
const nameOf = (v: LoadedFile) => {
  const label = v.capture.version?.label;
  return label ? `${label} · ${v.name}` : v.name;
};

/** A set of theme or language versions: one token collection, a mode per version (Stage 3). */
function modesSpec(set: VersionSet, ctx: SetContext): SetSpec {
  const { port, signal, options, plans } = ctx;
  const merged = mergeVersions(
    set.versions.map((v, i) => ({
      label: v.capture.version?.label ?? "",
      plan: plans[i] as Plan,
      cssValues: v.capture.tokens.cssCustomProperties,
    }))
  );
  plans.length = 0;
  return {
    // Mode names are the labels made unique, so the frames are told apart the same way.
    members: set.versions.map((version, i) => ({
      version,
      plan: merged.plans[i] as Plan,
      label: merged.tokens.modes[i] ?? "",
    })),
    async open() {
      await port.beginSet();
      if (signal?.aborted) return null;
      return new Set((await port.importModes(merged.tokens, options)).droppedVersions);
    },
    notes: () => merged.report,
    modesOwnFrames: true,
    sharedTheme: false,
  };
}

/** The sentence for frames a device set left without their Device or Breakpoint mode. */
export function plainFramesLine(count: number): string {
  return count === 1
    ? "1 frame couldn't get its device or breakpoint modes and keeps its captured values, not linked to variables."
    : `${count} frames couldn't get their device or breakpoint modes and keep their captured values, not linked to variables.`;
}

/** A page captured on devices, and extra captures for its breakpoints: a frame per device. */
function devicesSpec(set: VersionSet, ctx: SetContext, placement: Placement): SetSpec {
  const { port, signal, options, plans } = ctx;
  const merge = mergeDevices(
    set.versions.map((v, i): DeviceEntry => ({ capture: v.capture, plan: plans[i] as Plan }))
  );
  plans.length = 0;
  const { layers } = merge;
  return {
    members: merge.frames.map((frame) => ({
      version: set.versions[frame.index] as LoadedFile,
      plan: merge.plans[frame.index] as Plan,
      label: frame.device,
      device: { mode: frame.device, breakpoint: frame.breakpoint },
    })),
    async open() {
      const first = set.versions[0] as LoadedFile;
      await port.beginDeviceSet({
        name: importName(first.capture.source),
        layers,
        options,
        placement,
      });
      return signal?.aborted ? null : new Set();
    },
    notes(result) {
      const lines: string[] = [];
      // The modes Figma made, not the ones planned: a mode limit can leave some out.
      const settled = result.layers?.modes ?? [];
      const made = (kind: "device" | "breakpoint") =>
        settled.find((m) => m.kind === kind)?.created ?? [];
      const devices = made("device");
      const breakpoints = made("breakpoint");
      if (devices.length > 0) lines.push(`${COLLECTION_NAMES.device}: ${devices.join(", ")}`);
      if (breakpoints.length > 0) {
        lines.push(`${COLLECTION_NAMES.breakpoint}: ${breakpoints.join(", ")}`);
      }
      for (const { collection, added } of settled) {
        if (added.length > 0) lines.push(`Modes added: ${collection} ${added.join(", ")}.`);
      }
      const dropped = [...new Set(result.layers?.modesDropped ?? [])];
      if (dropped.length > 0) lines.push(`Not created: ${dropped.join(", ")}.`);
      lines.push(...merge.report);
      const plain = result.plainVersions?.length ?? 0;
      if (plain > 0) lines.push(plainFramesLine(plain));
      return lines;
    },
    modesOwnFrames: false,
    sharedTheme: true,
  };
}

/**
 * Create one page's set of frames: one collection set, the modes each frame takes, one undo step.
 * A frame that fails is named and the others stay, and a set with none left is undone. Cancel
 * takes back the whole set.
 */
async function importSet(
  set: VersionSet,
  ctx: SetContext,
  makeSpec: () => SetSpec
): Promise<SetOutcome> {
  const { port, onState, signal, options, fail, unit } = ctx;
  const kept: VersionReport[] = [];
  const failed = new Set<LoadedFile>();
  let members: SetMember[] = [];
  let open = false;
  const cancelled = { versions: [], report: null, cancelled: true };
  const stop = async () => {
    if (open) {
      open = false;
      await port.cancel();
    }
    return cancelled;
  };

  try {
    const spec = makeSpec();
    members = spec.members;
    const total = members.reduce((sum, m) => sum + m.plan.ops.length, 0);

    // Set first: an open that fails halfway may still have created state to cancel.
    open = true;
    const dropped = await spec.open();
    if (!dropped || signal?.aborted) return await stop();

    let plainFrames = 0;
    let done = 0;
    for (const [i, member] of members.entries()) {
      if (signal?.aborted) return await stop();
      const { version } = member;
      const index = ctx.firstFile + i;
      const file: FileInfo = { index, total: ctx.totalFiles, name: version.name, unit };
      onState({ step: "working", done, total, file });
      const plan = dropped.has(i) ? stripTokens(member.plan) : member.plan;
      try {
        const report = await importVersion(
          {
            plan,
            assets: await ctx.assetsOf(version),
            rootName: importName(version.capture.source),
            version: { name: version.name, label: member.label },
            setIndex: i,
            ...(member.device ? { device: member.device } : {}),
          },
          { port, onState, signal, options, file, progress: { done, total } }
        );
        if (!report) {
          open = false;
          return cancelled;
        }
        kept.push(report);
        if (dropped.has(i)) plainFrames += 1;
      } catch (error) {
        failed.add(version);
        fail(nameOf(version), error, version.several);
      }
      done += plan.ops.length;
      // Let this frame's plan go before the next is made.
      member.plan = undefined as unknown as Plan;
    }

    if (signal?.aborted) return await stop();
    const result = await port.endSet();
    open = false;
    if (kept.length === 0) return { versions: [], report: null, cancelled: false };
    const theme = spec.sharedTheme ? sharedTheme(kept) : undefined;
    if (spec.sharedTheme) for (const version of kept) delete version.theme;
    return {
      versions: kept,
      cancelled: false,
      report: {
        name: importName((set.versions[0] as LoadedFile).capture.source),
        modes: result.modes,
        modesDropped: spec.modesOwnFrames ? result.modesDropped : 0,
        plainFrames,
        stylesCreated: result.stylesCreated,
        stylesReused: result.stylesReused,
        variablesCreated: result.variablesCreated,
        variablesReused: result.variablesReused,
        tokenFailures: result.tokenFailures,
        layoutFailures: result.layoutFailures,
        notes: spec.notes(result),
        ...(theme ? { theme } : {}),
      },
    };
  } catch (error) {
    // Nothing of the set is left, so every frame of it failed.
    if (open) {
      try {
        await port.cancel();
      } catch {
        // The failures below are what matter.
      }
    }
    const frames = members.length > 0 ? members.map((m) => m.version) : set.versions;
    for (const version of frames)
      if (!failed.has(version)) fail(nameOf(version), error, version.several);
    return { versions: [], report: null, cancelled: false };
  }
}

/** Whether a set imports as devices: two or more captures, none of them a theme or a language. */
export function isDeviceSet(set: VersionSet): boolean {
  return (
    set.versions.length > 1 &&
    set.versions.every((v) => (v.capture.version?.kind ?? "viewport") === "viewport")
  );
}

/** Collections that switch by mode, listed with their counts; the rest are listed by name. */
const SWITCHING = new Set(["device", "breakpoint", "colorMode"]);

/** The collections a device set's layers make, in one line, and the modes over `limit`. */
export function summarizeLayers(layers: PlanLayers, limit: number | null): ContentsSummary {
  const switching: string[] = [];
  const named: string[] = [];
  const overLimit: string[] = [];
  for (const { kind, name, modes } of layers.collections) {
    if (!SWITCHING.has(kind)) {
      named.push(name);
      continue;
    }
    const n = modes.length;
    switching.push(
      switching.length === 0 ? `${name} ${n} ${n === 1 ? "mode" : "modes"}` : `${name} ${n}`
    );
    if (limit !== null && n > limit) {
      overLimit.push(
        `${name} needs ${n} modes. This file allows ${limit}, so ${n - limit} will be left out.`
      );
    }
  }
  const parts = [...switching, ...(named.length > 0 ? [named.join(", ")] : [])];
  return { collections: parts.join(" · "), overLimit };
}

/** The versions of a device set the ticks keep: one tick per device, then one per extra. */
function ticked<T>(
  versions: T[],
  isExtraAt: (v: T) => boolean,
  devices: boolean[],
  extras: boolean[]
): T[] {
  let d = 0;
  let e = 0;
  return versions.filter((v) => (isExtraAt(v) ? extras[e++] : devices[d++]) !== false);
}

/**
 * Import the chosen files. Files of one page form a set: two or more import together, with a mode
 * per version, and a page with one file takes the single-file flow. Sets import one after another,
 * each its own undo step. The review step shows once, with the missing fonts of every file. A bad
 * file is reported by name and the others carry on.
 *
 * Cancel stops the run and undoes the set or the file in hand; those already finished stay.
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
  const fail = (name: string, error: unknown, size = false) =>
    failures.push({ name, message: messageForError(error), ...(size ? { size } : {}) });
  const unit = files.length === 1 ? "size" : "file";
  const finishWithError = () => {
    const message =
      failures.length === 1
        ? (failures[0]?.message ?? "")
        : [failuresHeading(failures), ...failures.map((f) => `${f.name}: ${f.message}`)].join("\n");
    onState({ step: "error", message });
  };
  /** Counts the files until they are read, then the versions in them. */
  let counted = files.length;
  /** Files are numbered one way throughout: by position in the order they were dropped. */
  const working = (index: number, name: string, done = 0, total = 0): ImportState => ({
    step: "working",
    done,
    total,
    file: { index, total: counted, name, unit },
  });

  try {
    if (files.length > MAX_FILES) return onState({ step: "error", message: TOO_MANY_FILES });
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
      return onState({ step: "error", message: TOO_MANY_BYTES });
    }

    // Pass 1, one file at a time: keep each capture but let its images go, unless it is the only
    // capture. The images are read again when their version imports.
    const sources = new Map<Capture["source"], { file: File; index: number }>();
    const assetKeys = new Map<Capture["source"], Set<string>>();
    const light: LoadedFile[] = [];
    for (const [i, file] of files.entries()) {
      onState(working(i + 1, file.name));
      try {
        const loaded = await loadFile(file, files.length === 1);
        for (const [index, one] of loaded.entries()) {
          sources.set(one.capture.source, { file, index });
          assetKeys.set(one.capture.source, new Set(one.assets.keys()));
          light.push(one);
        }
        // Only a drop of one capture keeps its images; they are read again for any other.
        if (!(files.length === 1 && loaded.length === 1)) {
          for (const one of loaded) {
            one.assets.clear();
            one.assets = new Map();
          }
        }
      } catch (error) {
        fail(file.name, error);
      }
      if (signal?.aborted) return onState({ step: "idle" });
    }
    if (light.length === 0) return finishWithError();
    if (light.length > MAX_CAPTURES) return onState({ step: "error", message: TOO_MANY_CAPTURES });
    const single = light.length === 1;
    if (!single) for (const one of light) one.assets = new Map();
    // Progress counts versions from here on.
    counted = light.length;

    const sets = groupVersions(light);
    const ordered = sets.flatMap((s) => s.versions);
    // Grouping may relabel (copy) a file, but its capture's source object stays the same.
    const sourceOf = (v: LoadedFile) =>
      sources.get(v.capture.source) as { file: File; index: number };

    await yieldToPaint();
    const available = await port.listFonts();
    // One review for the drop, so its options belong to the first version's page alone.
    const hostname = hostnameOf(ordered[0]?.capture.source.url ?? "");
    let options = sanitizeOptions(
      hostname ? await readPref(port, `options:${hostname}`) : undefined
    );

    const missing = new Map<string, string>();
    let firstPlan: Plan | undefined;
    // A page imported on its own, or on devices, gets the layered collections; a set of themes or
    // languages keeps one.
    const alone = (o: ImportOptions) => ({ ...o, layers: true });
    const layered = new Set(sets.filter(isDeviceSet).flatMap((s) => s.versions));
    /** The review shows the first device set's contents, from these plans. */
    const firstDevices = sets.find(isDeviceSet);
    const previewPlans = new Map<LoadedFile, Plan>();
    for (const v of ordered) {
      const layers = ordered.length === 1 || layered.has(v);
      const plan = mapCapture(v.capture, available, layers ? alone(options) : options);
      if (ordered.length === 1) firstPlan = plan;
      if (session && firstDevices?.versions.includes(v)) previewPlans.set(v, plan);
      mergeMissing(missing, missingFonts(plan.report, available));
    }
    const contents =
      session && firstDevices
        ? await reviewContents(firstDevices, previewPlans, await readModeLimit(port))
        : undefined;

    let overrides: Record<string, string> | undefined;
    let deviceChoice: ReviewDecision["contents"];
    /** A set as it imports: without the captures the user unticked, of the set the review showed. */
    const keptOf = (whole: VersionSet): VersionSet => {
      const choice = whole === firstDevices ? deviceChoice : undefined;
      return choice
        ? { ...whole, versions: ticked(whole.versions, isExtra, choice.devices, choice.extras) }
        : whole;
    };
    /** The frames a set makes: a device set's ticked devices, or every version. */
    const framesOf = (whole: VersionSet) => {
      const { versions } = keptOf(whole);
      return isDeviceSet(whole) ? versions.filter((v) => !isExtra(v)).length : versions.length;
    };
    /** Progress counts frames, so extras and unticked devices are left out of it. */
    const countFrames = () => {
      counted = sets.reduce((sum, whole) => sum + framesOf(whole), 0);
    };
    if (session && (missing.size > 0 || session.forceReview || contents)) {
      const families = [...new Set(available.map((f) => f.family))];
      const reviewFonts: ReviewFont[] = [];
      for (const [family, nearest] of missing) {
        const stored = await readPref(port, `font:${family}`);
        const choice = typeof stored === "string" && families.includes(stored) ? stored : nearest;
        reviewFonts.push({ family, choice });
      }
      onState({
        step: "review",
        missing: reviewFonts,
        families,
        options,
        hostname,
        ...(contents ? { contents, optionsOpen: session.forceReview } : {}),
      });
      const decision = await session.decide();
      if (!decision) return onState({ step: "idle" });
      if (contents) deviceChoice = sanitizeContents(decision.contents);
      countFrames();
      // The review is gone: show progress at once, with a Cancel that works.
      onState(working(1, ordered[0]?.name ?? ""));
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
      firstPlan = undefined;
      await yieldToPaint();
      if (hostname) await writePref(port, `options:${hostname}`, options);
      for (const [family, chosen] of changed) await writePref(port, `font:${family}`, chosen);
    }
    // The review is over, and its summary with it: the plans go, to be made again below.
    previewPlans.clear();

    // A set's plans are built after the review and before its first begin, so their tokens can be
    // merged; each plan is dropped once its version is created.
    const versions: VersionReport[] = [];
    const reports: SetReport[] = [];
    /** What stayed, or null with nothing to show. */
    const doneState = (): ImportState | null => {
      const first = versions[0];
      return first ? { ...first, step: "done", versions, sets: reports, failures } : null;
    };
    /** A Cancel takes back the set in hand. Sets finished before it stay, so they're reported. */
    const cancelled = () => onState(doneState() ?? { step: "idle" });
    const assetsOf = async (version: LoadedFile) => {
      // The first read checked the images only for a drop of one file; any other is read again.
      if (single && files.length === 1) return version.assets;
      const { file, index } = sourceOf(version);
      const again = (await loadFile(file))[index];
      if (!again || !sameKeys(again.assets, assetKeys.get(version.capture.source))) {
        throw new FrottageFileError("invalid-capture");
      }
      return again.assets;
    };
    const placement = deviceChoice?.placement ?? "new-page";
    countFrames();
    let index = 0;
    for (const whole of sets) {
      const devices = isDeviceSet(whole);
      const set = keptOf(whole);
      const firstFile = index + 1;
      index += framesOf(whole);
      if (signal?.aborted) return cancelled();
      // With every device unticked there is nothing to make.
      if (devices && !set.versions.some((v) => !isExtra(v))) continue;
      // A set counts uses across its versions, in `mergeVersions`, so each plan proposes them all.
      const planOptions =
        set.versions.length > 1 && !devices ? { ...options, tokenFloor: 1 } : alone(options);
      const plans = set.versions.map(
        (v) => firstPlan ?? mapCapture(v.capture, available, planOptions, overrides)
      );

      if (set.versions.length > 1 || devices) {
        onState(working(firstFile, set.versions[0]?.name ?? ""));
        const ctx: SetContext = {
          port,
          onState,
          signal,
          options,
          plans,
          firstFile,
          totalFiles: counted,
          assetsOf,
          fail,
          unit,
        };
        const outcome = await importSet(set, ctx, () =>
          devices ? devicesSpec(set, ctx, placement) : modesSpec(set, ctx)
        );
        if (outcome.cancelled) return cancelled();
        versions.push(...outcome.versions);
        if (outcome.report) reports.push(outcome.report);
        continue;
      }

      const version = set.versions[0] as LoadedFile;
      onState(working(firstFile, version.name));
      try {
        const report = await importVersion(
          {
            plan: plans[0] as Plan,
            assets: await assetsOf(version),
            rootName: importName(version.capture.source),
            version: { name: version.name, label: version.capture.version?.label ?? "" },
          },
          {
            port,
            onState,
            signal,
            options,
            file: { index: firstFile, total: counted, name: version.name, unit },
          }
        );
        if (!report) return cancelled();
        versions.push(report);
      } catch (error) {
        fail(version.name, error);
      }
    }

    const done = doneState();
    if (!done) return finishWithError();
    onState(done);
  } catch (error) {
    onState({ step: "error", message: messageForError(error) });
  }
}

async function readModeLimit(port: ImportPort): Promise<number | null> {
  try {
    const limit = await port.getModeLimit();
    return typeof limit === "number" && limit > 0 ? limit : null;
  } catch {
    return null;
  }
}

/** A device set's contents as the review shows them, all ticked, with what they make. */
async function reviewContents(
  set: VersionSet,
  plans: ReadonlyMap<LoadedFile, Plan>,
  limit: number | null
): Promise<ReviewContents> {
  await yieldToPaint();
  // The width a capture was laid out at, as the merge places it; a device without device data
  // goes by the width its label chose, as its Device mode does.
  const width = (v: LoadedFile) => captureWidth(v.capture);
  const devices = set.versions.filter((v) => !isExtra(v));
  const extras = set.versions.filter(isExtra);
  const summarize = (deviceTicks: boolean[], extraTicks: boolean[]): ContentsSummary => {
    const kept = ticked(set.versions, isExtra, deviceTicks, extraTicks);
    if (!kept.some((v) => !isExtra(v))) return { collections: "", overLimit: [] };
    const entries = kept.map(
      (v): DeviceEntry => ({ capture: v.capture, plan: plans.get(v) as Plan })
    );
    return summarizeLayers(mergeDevices(entries).layers, limit);
  };
  return {
    devices: devices.map((v) => ({
      name: v.capture.version?.device?.name ?? String(width(v)),
      width: width(v),
      on: true,
    })),
    extras: extras.map((v) => ({
      breakpoint: v.capture.version?.breakpoint ?? "",
      width: width(v),
      on: true,
    })),
    placement: "new-page",
    ...summarize(
      devices.map(() => true),
      extras.map(() => true)
    ),
    summarize,
  };
}

/** The review's ticks are untrusted: anything that isn't false stays ticked. */
function sanitizeContents(raw: ReviewDecision["contents"]): ReviewDecision["contents"] {
  if (!raw) return undefined;
  const ticks = (list: unknown) => (Array.isArray(list) ? list.map((t) => t !== false) : []);
  return {
    devices: ticks(raw.devices),
    extras: ticks(raw.extras),
    placement: raw.placement === "current-page" ? "current-page" : "new-page",
  };
}

/** A file re-read for its images must still hold the images it held when it was planned. */
function sameKeys(assets: Map<string, Uint8Array>, expected: Set<string> | undefined): boolean {
  return (
    !!expected && assets.size === expected.size && [...assets.keys()].every((k) => expected.has(k))
  );
}
