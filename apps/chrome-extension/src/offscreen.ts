// Offscreen document. It owns the run state and the 60 s no-progress timeout, packs the
// .frottage file (Zod and fflate live here, not in the page script) and makes the Blob URL.
import { packFrottage, parseCapture } from "@repo/capture-schema";
import { CaptureRun, type RunStatus } from "./capture-run";
import {
  type OffscreenMessage,
  type PageMessage,
  type PopupMessage,
  RELAY_PORT,
  type Reply,
  type SwMessage,
} from "./messages";
import { CaptureGate, ViewportRun, type WindowState } from "./viewport-run";

/** Pages re-lay out on resize. */
const SETTLE_MS = 800;

/** Once a finished run's status has been read, the offscreen document has nothing left to hold. */
function finished(status?: RunStatus): void {
  if (
    status &&
    (status.state === "saved" || status.state === "error" || status.state === "viewport-done")
  ) {
    chrome.runtime.sendMessage({ target: "sw", type: "close-offscreen" }).catch(() => {});
  }
}

/** A reply means a popup is open and showed the status; otherwise it is held for the next open. */
function toPopup(status: RunStatus, acknowledge: (status: RunStatus) => RunStatus | undefined) {
  const message: PopupMessage = { target: "popup", type: "status", status };
  chrome.runtime
    .sendMessage(message)
    .then((reply?: { received?: boolean }) => {
      if (reply?.received) finished(acknowledge(status));
    })
    .catch(() => {});
}

/** The worker's answer to one window or tab call, which it turns into a thrown error. */
async function askWorker(message: SwMessage): Promise<Reply & { ok: true }> {
  const reply: Reply | undefined = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply ? reply.error : "The extension did not answer");
  return reply;
}

const gate = new CaptureGate();

const run: CaptureRun = new CaptureRun({
  parse: (text) => {
    const parsed = parseCapture(JSON.parse(text));
    if (!parsed.ok) throw new Error(parsed.detail ?? parsed.reason);
    return parsed.capture;
  },
  pack: packFrottage,
  makeBlobUrl: (bytes) =>
    URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" })),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  download: async ({ url, filename }) => {
    const reply: Reply | undefined = await chrome.runtime.sendMessage({
      target: "sw",
      type: "download",
      url,
      filename,
    });
    if (!reply?.ok) throw new Error(reply ? reply.error : "The download did not start");
    return reply.filename;
  },
  report: (status: RunStatus) => {
    if (gate.offer(status)) {
      // The viewport run has it, and a capture's finish must not reach the popup or close this
      // document: the run goes on.
      if (status.state === "saved" || status.state === "error") run.take();
      return;
    }
    toPopup(status, (s) => run.acknowledge(s));
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => new Date(),
  timeoutMs: 60_000,
});

// The tab and window of the run in progress. The worker keeps nothing between messages.
let viewportTab = 0;
let home: WindowState | null = null;

function savedWindow(): WindowState {
  if (!home) throw new Error("The window's state was not read");
  return home;
}

const viewport: ViewportRun = new ViewportRun({
  origin: async () => {
    const reply = await askWorker({ target: "sw", type: "tab-origin", tabId: viewportTab });
    return reply.origin ?? null;
  },
  remember: async () => {
    const reply = await askWorker({ target: "sw", type: "window-state", tabId: viewportTab });
    home = reply.window ?? null;
  },
  resize: async (width) => {
    const { windowId } = savedWindow();
    const reply = await askWorker({ target: "sw", type: "resize-window", windowId, width });
    return reply.width ?? width;
  },
  restore: async () => {
    await askWorker({ target: "sw", type: "restore-window", window: savedWindow() });
  },
  capture: (label) =>
    gate.run(() =>
      chrome.runtime.sendMessage({
        target: "sw",
        type: "start",
        tabId: viewportTab,
        versionKind: "viewport",
        versionLabel: label,
      } satisfies SwMessage)
    ),
  settle: () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
  onStatus: (status) => toPopup(status, (s) => viewport.acknowledge(s)),
});

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;
  switch (message.type) {
    case "run-start":
      try {
        if (viewport.running && !message.viewport) {
          throw new Error("A capture at several widths is already running");
        }
        run.start(message.runId);
        sendResponse({ ok: true } satisfies Reply);
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies Reply);
      }
      return;
    case "viewport-start":
      try {
        if (run.busy) throw new Error("A capture is already running");
        viewportTab = message.tabId;
        void viewport.start(message.widths);
        sendResponse({ ok: true } satisfies Reply);
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies Reply);
      }
      return;
    case "viewport-cancel":
      viewport.cancel();
      sendResponse({ ok: true } satisfies Reply);
      return;
    case "inject-failed":
      run.onInjectFailed(message.runId, message.detail);
      sendResponse({ ok: true } satisfies Reply);
      return;
    case "run-live":
      sendResponse(
        run.isLive(message.runId)
          ? ({ ok: true } satisfies Reply)
          : ({ ok: false, error: "No such run" } satisfies Reply)
      );
      return;
    case "get-status": {
      const status = viewport.status.state === "idle" ? run.take() : viewport.take();
      sendResponse(status);
      finished(status);
      return;
    }
  }
});

// The worker passes the page's messages on over this port.
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(RELAY_PORT)) return;
  const runId = port.name.slice(RELAY_PORT.length);
  port.onMessage.addListener((message: PageMessage) => {
    switch (message.type) {
      case "chunk":
        run.onChunk(runId, message);
        return;
      case "heartbeat":
        run.onHeartbeat(runId);
        return;
      case "end":
        run.onEnd(runId);
        return;
      case "error":
        run.onPageError(runId, message.message);
        return;
    }
  });
  port.onDisconnect.addListener(() => run.onPortClosed(runId));
});
