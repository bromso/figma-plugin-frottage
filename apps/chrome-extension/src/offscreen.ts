// Offscreen document. It owns the run state, the 60 s no-progress timeout and the run's capture set,
// and packs the one file (Zod and fflate live here, not in the page script) and makes the Blob URL.
import { parseCapture } from "@repo/capture-schema";
import { CaptureRun, type RunStatus } from "./capture-run";
import { CaptureSet } from "./capture-set";
import {
  type OffscreenMessage,
  type PageMessage,
  type PopupMessage,
  RELAY_PORT,
  type Reply,
  type SwMessage,
} from "./messages";
import { captureFilename } from "./page";
import type { HeldTab } from "./tab-hold";
import { CaptureGate, startRefusal, ViewportRun } from "./viewport-run";

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

// The captures of the run in progress, packed into one file when it ends.
let captured = new CaptureSet();

const run: CaptureRun = new CaptureRun({
  parse: (text) => {
    const parsed = parseCapture(JSON.parse(text));
    if (!parsed.ok) throw new Error(parsed.detail ?? parsed.reason);
    return parsed.capture;
  },
  keep: (capture, assets) => captured.add(capture, assets),
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
  timeoutMs: 60_000,
});

// The run in progress. The worker keeps nothing between messages.
let viewportTab = 0;
let collapseWrappers = false;
let typedLabel = "";
let heldTab: HeldTab | null = null;

function held(): HeldTab {
  if (!heldTab) throw new Error("The tab was not moved");
  return heldTab;
}

const viewport: ViewportRun = new ViewportRun({
  origin: async () => {
    const reply = await askWorker({ target: "sw", type: "tab-origin", tabId: viewportTab });
    return reply.origin ?? null;
  },
  hold: async () => {
    const reply = await askWorker({ target: "sw", type: "hold-tab", tabId: viewportTab });
    if (!reply.held) throw new Error("The tab was not moved");
    heldTab = reply.held;
  },
  resize: async (width) => {
    const { runWindowId } = held();
    const reply = await askWorker({ target: "sw", type: "resize-window", runWindowId, width });
    return reply.width ?? width;
  },
  windowOpen: async () => {
    const { runWindowId } = held();
    const reply = await askWorker({ target: "sw", type: "window-open", runWindowId });
    return reply.open === true;
  },
  release: async () => {
    const reply = await askWorker({ target: "sw", type: "release-tab", held: held() });
    return reply.released ?? "stranded";
  },
  save: async () => {
    const bytes = captured.pack();
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: "application/octet-stream" })
    );
    try {
      const filename = captureFilename(held().url, new Date(), typedLabel);
      const reply = await askWorker({ target: "sw", type: "download", url, filename });
      return reply.filename ?? filename;
    } finally {
      URL.revokeObjectURL(url);
      // Whatever happened, the run's captures are not kept in memory after it.
      captured = new CaptureSet();
    }
  },
  announce: (failed) => {
    chrome.runtime
      .sendMessage({
        target: "sw",
        type: "run-finished",
        failed,
        ...(heldTab ? { windowId: heldTab.windowId } : {}),
      } satisfies SwMessage)
      .catch(() => {});
  },
  capture: () =>
    gate.run(() =>
      chrome.runtime.sendMessage({
        target: "sw",
        type: "start",
        tabId: viewportTab,
        ...(collapseWrappers ? { collapseWrappers: true } : {}),
        ...(typedLabel ? { versionLabel: typedLabel } : {}),
        viewport: true,
      } satisfies SwMessage)
    ),
  pageWidth: async () => {
    const reply = await askWorker({ target: "sw", type: "page-width", tabId: viewportTab });
    return reply.width ?? null;
  },
  settle: () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
  onStatus: (status) => toPopup(status, (s) => viewport.acknowledge(s)),
});

function refuseIfBusy(request: Parameters<typeof startRefusal>[0]): void {
  const refused = startRefusal(request, { capturing: run.busy, viewportRunning: viewport.running });
  if (refused) throw new Error(refused);
}

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;
  switch (message.type) {
    case "run-start":
      try {
        refuseIfBusy(message.viewport ? "width" : "capture");
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
        refuseIfBusy("viewport");
        viewportTab = message.tabId;
        collapseWrappers = message.collapseWrappers === true;
        typedLabel = message.versionLabel ?? "";
        heldTab = null;
        captured = new CaptureSet();
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
