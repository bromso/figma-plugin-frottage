import type { RunStatus } from "./capture-run";
import type { ChunkMessage } from "./chunks";
import type { WindowState } from "./viewport-run";

/** Prefix of the port the page script opens to the service worker. */
export const CAPTURE_PORT = "frottage-capture:";
/** Prefix of the port the service worker opens to the offscreen document to pass chunks on. */
export const RELAY_PORT = "frottage-relay:";

/** Prefix of the port the page script opens, one per image: `<prefix><runId>:<nonce>`. */
export const IMAGE_PORT = "frottage-image:";

/** Page script to worker, once per image port. */
export type ImageRequest = { type: "fetch-image"; url: string };

/** Worker to page script. Never carries the URL. */
export type ImageReply =
  | { type: "image-chunk"; mime: string; index: number; total: number; data: string }
  | { type: "image-error"; message: string };

/** What the page script sends over its port. */
export type PageMessage =
  | ChunkMessage
  | { type: "heartbeat" }
  | { type: "end" }
  | { type: "error"; message: string };

/** Popup to worker. */
export type SwMessage =
  | {
      target: "sw";
      type: "start";
      tabId: number;
      collapseWrappers?: boolean;
      versionKind?: string;
      versionLabel?: string;
      /** This capture is one of a viewport run's. A plain capture can be labelled viewport too. */
      viewport?: boolean;
    }
  | { target: "sw"; type: "viewport-start"; tabId: number; widths: number[] }
  | { target: "sw"; type: "download"; url: string; filename: string }
  | { target: "sw"; type: "tab-origin"; tabId: number }
  | { target: "sw"; type: "page-width"; tabId: number }
  | { target: "sw"; type: "window-state"; tabId: number }
  | { target: "sw"; type: "window-open"; windowId: number }
  | { target: "sw"; type: "resize-window"; windowId: number; width: number; left?: number }
  | { target: "sw"; type: "restore-window"; window: WindowState }
  | { target: "sw"; type: "close-offscreen" };

/** Worker and popup messages to the offscreen document. */
export type OffscreenMessage =
  /** `viewport` marks a capture that belongs to the viewport run. */
  | { target: "offscreen"; type: "run-start"; runId: string; viewport?: boolean }
  | { target: "offscreen"; type: "viewport-start"; tabId: number; widths: number[] }
  | { target: "offscreen"; type: "viewport-cancel" }
  | { target: "offscreen"; type: "inject-failed"; runId: string; detail: string }
  | { target: "offscreen"; type: "run-live"; runId: string }
  | { target: "offscreen"; type: "get-status" };

/** Offscreen document to the popup. */
export type PopupMessage = { target: "popup"; type: "status"; status: RunStatus };

/**
 * `filename` is the saved basename, set by the worker for downloads. `origin`, `window`, `open` and
 * `width` answer `tab-origin`, `window-state`, `window-open`, and `resize-window` or `page-width`.
 */
export type Reply =
  | {
      ok: true;
      filename?: string;
      origin?: string | null;
      window?: WindowState;
      open?: boolean;
      width?: number;
    }
  | { ok: false; error: string };
