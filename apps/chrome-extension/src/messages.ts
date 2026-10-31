import type { RunStatus } from "./capture-run";
import type { ChunkMessage } from "./chunks";

/** Prefix of the port the page script opens to the service worker. */
export const CAPTURE_PORT = "frottage-capture:";
/** Prefix of the port the service worker opens to the offscreen document to pass chunks on. */
export const RELAY_PORT = "frottage-relay:";

/** What the page script sends over its port. */
export type PageMessage = ChunkMessage | { type: "end" } | { type: "error"; message: string };

/** Popup to worker. */
export type SwMessage =
  | { target: "sw"; type: "start"; tabId: number }
  | { target: "sw"; type: "download"; url: string; filename: string };

/** Worker, popup or tab events to the offscreen document. */
export type OffscreenMessage =
  | { target: "offscreen"; type: "run-start"; runId: string; tabId: number }
  | { target: "offscreen"; type: "inject-failed"; runId: string; detail: string }
  | { target: "offscreen"; type: "tab-event"; tabId: number }
  | { target: "offscreen"; type: "get-status" };

/** Offscreen document to the popup. */
export type PopupMessage = { target: "popup"; type: "status"; status: RunStatus };

export type Reply = { ok: true } | { ok: false; error: string };
