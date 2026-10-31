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
} from "./messages";

/** Once a finished run's status has been read, the offscreen document has nothing left to hold. */
function finished(status?: RunStatus): void {
  if (status && (status.state === "saved" || status.state === "error")) {
    chrome.runtime.sendMessage({ target: "sw", type: "close-offscreen" }).catch(() => {});
  }
}

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
    const message: PopupMessage = { target: "popup", type: "status", status };
    // A reply means a popup is open and showed the status; otherwise the run holds it until
    // the popup next opens and asks.
    chrome.runtime
      .sendMessage(message)
      .then((reply?: { received?: boolean }) => {
        if (reply?.received) finished(run.acknowledge(status));
      })
      .catch(() => {});
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => new Date(),
  timeoutMs: 60_000,
});

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;
  switch (message.type) {
    case "run-start":
      try {
        run.start(message.runId);
        sendResponse({ ok: true } satisfies Reply);
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies Reply);
      }
      return;
    case "inject-failed":
      run.onInjectFailed(message.runId, message.detail);
      sendResponse({ ok: true } satisfies Reply);
      return;
    case "get-status": {
      const status = run.take();
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
