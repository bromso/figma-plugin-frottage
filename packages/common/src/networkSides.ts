import type {
  FontRef,
  ImportOptions,
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
  importBegin(meta: {
    name: string;
    fonts: FontRef[];
    totalOps: number;
    version?: { index: number; label: string };
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
    stylesCreated: number;
    stylesReused: number;
    variablesCreated: number;
    variablesReused: number;
    tokenFailures: number;
    modes: number;
    modesDropped: number;
    droppedVersions: number[];
  };
  importEndSet(): {
    rootIds: string[];
    layoutFailures: number;
    stylesCreated: number;
    stylesReused: number;
    variablesCreated: number;
    variablesReused: number;
    tokenFailures: number;
    modes: number;
    modesDropped: number;
    droppedVersions: number[];
  };
}>();
