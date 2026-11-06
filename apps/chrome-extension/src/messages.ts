import type { PageLanguage } from "@repo/capture-schema";
import type { RunStatus } from "./capture-run";
import type { ChunkMessage } from "./chunks";
import type { RunWidth } from "./plan-widths";
import type { HeldTab, ReleaseOutcome } from "./tab-hold";

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

/**
 * A run at several widths. `runWidths` names each capture's device or breakpoint; a re-run from a
 * status an older build saved has plain `widths` only.
 */
export type ViewportRequest = {
  tabId: number;
  runWidths?: RunWidth[];
  widths?: number[];
  collapseWrappers?: boolean;
  versionLabel?: string;
  /** Which themes to import, when the page has a choice. */
  themes?: { light: boolean; dark: boolean };
  /** The languages to capture, current first; sent only when more than the current one is ticked. */
  languages?: PageLanguage[];
  /** A line for each language the popup left out because its site refused access. */
  leftOut?: string[];
};

/** Popup to worker. */
export type SwMessage =
  | {
      target: "sw";
      type: "start";
      tabId: number;
      collapseWrappers?: boolean;
      versionLabel?: string;
      /** The device or breakpoint this capture of a run is for. */
      device?: RunWidth["device"];
      breakpoint?: string;
      /** Which themes the capture records as the ones to import. */
      themes?: { light: boolean; dark: boolean };
      /** The language the capture records, in a run with languages. */
      language?: PageLanguage;
    }
  | ({ target: "sw"; type: "viewport-start" } & ViewportRequest)
  /** Reads the page's breakpoints for the popup. */
  | { target: "sw"; type: "breakpoints"; tabId: number }
  | { target: "sw"; type: "download"; url: string; filename: string }
  | { target: "sw"; type: "tab-origin"; tabId: number }
  | { target: "sw"; type: "tab-address"; tabId: number }
  /** Loads a language's address in the held tab and answers once it has loaded. */
  | { target: "sw"; type: "load-tab"; tabId: number; url: string }
  | { target: "sw"; type: "page-width"; tabId: number }
  /** Reads a loaded language page's `<html lang>`. */
  | { target: "sw"; type: "page-language"; tabId: number }
  /** Moves the tab to a small window and holds its place with the run page. */
  | { target: "sw"; type: "hold-tab"; tabId: number }
  /** Gives the tab back where it was. */
  | { target: "sw"; type: "release-tab"; held: HeldTab }
  | { target: "sw"; type: "window-open"; runWindowId: number }
  | { target: "sw"; type: "resize-window"; runWindowId: number; width: number }
  /** The run is over: the worker badges the icon and opens the popup in the user's window. */
  | { target: "sw"; type: "run-finished"; failed: boolean; windowId?: number }
  | { target: "sw"; type: "close-offscreen" };

/** Worker and popup messages to the offscreen document. */
export type OffscreenMessage =
  | { target: "offscreen"; type: "run-start"; runId: string }
  | ({ target: "offscreen"; type: "viewport-start" } & ViewportRequest)
  | { target: "offscreen"; type: "viewport-cancel" }
  | { target: "offscreen"; type: "inject-failed"; runId: string; detail: string }
  | { target: "offscreen"; type: "run-live"; runId: string }
  | { target: "offscreen"; type: "get-status" };

/** Offscreen document to the popup. */
export type PopupMessage = { target: "popup"; type: "status"; status: RunStatus };

/**
 * `filename` is the saved basename, set by the worker for downloads. `origin`, `address`, `held`,
 * `released`, `open` and `width` answer `tab-origin`, `tab-address`, `hold-tab`, `release-tab`,
 * `window-open`, and `resize-window` or `page-width`; `lang` answers `page-language`;
 * `breakpoints` answers `breakpoints`.
 */
export type Reply =
  | {
      ok: true;
      filename?: string;
      origin?: string | null;
      address?: string | null;
      held?: HeldTab;
      released?: ReleaseOutcome;
      open?: boolean;
      width?: number;
      lang?: string | null;
      /** The page's breakpoints, answering `breakpoints`. */
      breakpoints?: number[];
      /** Whether the page defines a dark theme, answering `breakpoints`. */
      dark?: boolean;
      /** The languages the page is offered in, answering `breakpoints`. */
      languages?: PageLanguage[];
    }
  | { ok: false; error: string };
