import type {
  FontRef,
  ImportOptions,
  PlanLayers,
  PlanOp,
  PlanTokens,
  PlanVersionTokens,
} from "@repo/figma-mapper";
import { Networker } from "monorepo-networker";

/** Anything `figma.clientStorage` keeps. Stored values are untrusted when read back. */
export type StoredValue = string | number | boolean | object | null | undefined;

export const UI = Networker.createSide("UI-side").listens<{
  ping(): "pong";
  hello(text: string): void;
  importProgress(done: number, total: number): void;
}>();

export const PLUGIN = Networker.createSide("Plugin-side").listens<{
  ping(): "pong";
  hello(text: string): void;
  listFonts(): FontRef[];
  getPrefs(key: string): StoredValue;
  setPrefs(key: string, value: StoredValue): void;
  importBeginSet(): void;
  /**
   * Opens a device set: resolves the merged layers once and makes the section its frames go in,
   * on a new page named after the site or the current page. Each device then runs `importBegin`
   * (with `version` and `device`) to `importEnd`, and `importEndSet` keeps the set.
   */
  beginDeviceSet(meta: {
    name: string;
    layers: PlanLayers;
    options: ImportOptions;
    placement: "new-page" | "current-page";
  }): void;
  /** The mode limit Figma last refused a mode at, for this user, or null. */
  getModeLimit(): number | null;
  importBegin(meta: {
    name: string;
    fonts: FontRef[];
    totalOps: number;
    version?: { index: number; label: string };
    /** A device set's frame: its Device mode, and its Breakpoint mode when the page has any. */
    device?: { mode: string; breakpoint: string | null };
    /**
     * A device set's shared definitions, by key, which this frame's ops bring first: made once,
     * below the frames, on the widest frame's modes.
     */
    components?: { keys: string[]; device: { mode: string; breakpoint: string | null } };
  }): void;
  importTokens(tokens: PlanTokens, options: ImportOptions): void;
  importModes(tokens: PlanVersionTokens, options: ImportOptions): { droppedVersions: number[] };
  importImage(hash: string, bytes: Uint8Array): { ok: boolean; error?: string };
  importBatch(ops: PlanOp[]): void;
  importCancel(): void;
  importEnd(): {
    rootId: string;
    failedOps: number;
    missingImages: number;
    rewrappedTexts: number;
    textDriftCount: number;
    autoLayoutFrames: number;
    fallbackFrames: number;
    fallbackReasons: Record<string, number>;
    componentsCreated: number;
    instancesCreated: number;
    overrideFailures: number;
    overrideFailuresInMains: number;
    layoutFailures: number;
    hoverVariants: number;
    hoverFailures: number;
    paintFailures: number;
    resizedFallbacks: number;
    /** What Figma made of the component sets: sets it wouldn't combine, properties it refused. */
    componentNotes: string[];
    stylesCreated: number;
    stylesReused: number;
    variablesCreated: number;
    variablesReused: number;
    tokenFailures: number;
    modes: number;
    modesDropped: number;
    droppedVersions: number[];
    /** The Primitives and Theme collections' own counts, for a page with layers. */
    layers?: {
      variablesCreated: number;
      variablesReused: number;
      variablesRenamed: number;
      modesDropped: string[];
      /** The file already has the `· Primitives` and `· Theme` collections of an earlier version. */
      legacyCollections?: boolean;
      stylesCreated: number;
    };
  };
  importEndSet(): {
    rootIds: string[];
    layoutFailures: number;
    /** A device set's versions left plain, unbound: their Device or Breakpoint mode wasn't set. */
    plainVersions: number[];
    stylesCreated: number;
    stylesReused: number;
    variablesCreated: number;
    variablesReused: number;
    tokenFailures: number;
    modes: number;
    modesDropped: number;
    droppedVersions: number[];
    /** The layered collections' modes: those each has, and those added to one already there. */
    layers?: {
      modesDropped: string[];
      modes: { kind: string; collection: string; created: string[]; added: string[] }[];
    };
  };
}>();
