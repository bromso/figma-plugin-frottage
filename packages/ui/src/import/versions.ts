import type { Capture } from "@repo/capture-schema";

/** One unpacked file. `assets` may be empty when only the capture is needed. */
export type LoadedFile = { name: string; capture: Capture; assets: Map<string, Uint8Array> };

/** The files of one page, in the order they import: widest viewport first, then themes and languages. */
export type VersionSet = { url: string; versions: LoadedFile[] };

/** Pages compare by the stored, already cleaned URL, ignoring a trailing slash. */
export function pageKey(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Group files by page. Sets keep the order their page first appears in. Within a set, viewport
 * versions (and files with no version) come first by width, widest first; theme and language
 * versions follow in file order. `viewport.w` is the client width, so it orders but never names:
 * a file without a label is labelled by its width.
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
  const isViewport = (f: LoadedFile) => f.capture.version?.kind === "viewport";
  for (const set of sets.values()) {
    const viewports = set.versions
      .filter(isViewport)
      .sort((a, b) => b.capture.source.viewport.w - a.capture.source.viewport.w);
    set.versions = [...viewports, ...set.versions.filter((f) => !isViewport(f))];
  }
  return [...sets.values()];
}
