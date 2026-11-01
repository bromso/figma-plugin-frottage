import type { Capture } from "@repo/capture-schema";

/** One unpacked file. `assets` may be empty when only the capture is needed. */
export type LoadedFile = {
  name: string;
  capture: Capture;
  assets: Map<string, Uint8Array>;
  /** One of several captures in its file, so a version of that file rather than a file. */
  several?: boolean;
};

/** The files of one page, in the order they import: by `compareVersions`. */
export type VersionSet = { url: string; versions: LoadedFile[] };

/** Pages compare by origin and path: no query, no fragment, no trailing slash. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return url.replace(/\/+$/, "");
  }
}

const KINDS = ["viewport", "theme", "language"];

/**
 * Viewports, then themes, then languages; within a kind, widest first, then by label. The order
 * doesn't depend on which file came first, since the first version names a set's tokens.
 */
function compareVersions(a: LoadedFile, b: LoadedFile): number {
  const [x, y] = [a.capture, b.capture];
  const kinds = KINDS.indexOf(x.version?.kind ?? "") - KINDS.indexOf(y.version?.kind ?? "");
  if (kinds !== 0) return kinds;
  const widths = y.source.viewport.w - x.source.viewport.w;
  if (widths !== 0) return widths;
  const [p = "", q = ""] = [x.version?.label, y.version?.label];
  return p < q ? -1 : p > q ? 1 : 0;
}

/**
 * Group files by page. Sets keep the order their page first appears in, and a set's versions are
 * in `compareVersions` order. `viewport.w` is the client width, so it orders but never names: a
 * file without a label is labelled by its width.
 */
export function groupVersions(files: LoadedFile[]): VersionSet[] {
  const sets = new Map<string, VersionSet>();
  for (const file of files) {
    const key = pageKey(file.capture.source.url);
    let set = sets.get(key);
    if (!set) {
      set = { url: key, versions: [] };
      sets.set(key, set);
    }
    const { capture } = file;
    const labelled = capture.version
      ? file
      : {
          ...file,
          capture: {
            ...capture,
            version: { label: String(Math.round(capture.source.viewport.w)), kind: "viewport" },
          } as Capture,
        };
    set.versions.push(labelled);
  }
  for (const set of sets.values()) set.versions.sort(compareVersions);
  return [...sets.values()];
}
