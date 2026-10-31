import type { FontRef, PlanOp } from "@repo/figma-mapper";
import { Networker } from "monorepo-networker";

export const UI = Networker.createSide("UI-side").listens<{
  ping(): "pong";
  hello(text: string): void;
  importProgress(done: number, total: number): void;
}>();

export const PLUGIN = Networker.createSide("Plugin-side").listens<{
  ping(): "pong";
  hello(text: string): void;
  listFonts(): FontRef[];
  importBegin(meta: { name: string; fonts: FontRef[]; totalOps: number }): void;
  importImage(hash: string, bytes: Uint8Array): { ok: boolean; error?: string };
  importBatch(ops: PlanOp[]): void;
  importCancel(): void;
  importEnd(): {
    rootId: string;
    failedOps: number;
    missingImages: number;
    rewrappedTexts: number;
    autoLayoutFrames: number;
    fallbackFrames: number;
    fallbackReasons: Record<string, number>;
  };
}>();
