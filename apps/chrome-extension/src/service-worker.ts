// Service worker. Holds no run state: Chrome stops it when idle, so the run lives in the
// offscreen document and the page script. Everything here is a stateless relay.
import {
  CAPTURE_PORT,
  type OffscreenMessage,
  RELAY_PORT,
  type Reply,
  type SwMessage,
} from "./messages";

const OFFSCREEN_URL = "offscreen.html";
const DOWNLOAD_POLL_MS = 250;
const DOWNLOAD_MAX_POLLS = 240;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Concurrent callers share one createDocument call (the pattern in Chrome's docs). This
// only de-duplicates within one worker run; it is not state a run depends on.
let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["BLOBS"],
        justification: "Pack the capture and create a Blob URL for the download.",
      })
      .catch((error) => {
        if (!/single offscreen/i.test(errorText(error))) throw error;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

async function toOffscreen(message: OffscreenMessage): Promise<Reply | undefined> {
  await ensureOffscreen();
  return chrome.runtime.sendMessage(message);
}

async function startCapture(tabId: number): Promise<Reply> {
  const runId = crypto.randomUUID();
  const started = await toOffscreen({ target: "offscreen", type: "run-start", runId });
  if (!started?.ok) return started ?? { ok: false, error: "The capture could not start" };
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (id: string) => {
        (window as unknown as { __frottageRunId?: string }).__frottageRunId = id;
      },
      args: [runId],
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["capture-entry.js"] });
    return { ok: true };
  } catch (error) {
    const detail = errorText(error);
    await toOffscreen({ target: "offscreen", type: "inject-failed", runId, detail }).catch(
      () => {}
    );
    return { ok: false, error: detail };
  }
}

async function saveFile(url: string, filename: string): Promise<Reply> {
  try {
    const id = await chrome.downloads.download({ url, filename, saveAs: false });
    for (let i = 0; i < DOWNLOAD_MAX_POLLS; i++) {
      const [item] = await chrome.downloads.search({ id });
      if (item?.state === "complete") {
        return { ok: true, filename: item.filename.split(/[\\/]/).pop() };
      }
      if (item?.state === "interrupted") {
        return { ok: false, error: `The download was interrupted (${item.error})` };
      }
      await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_POLL_MS));
    }
    return { ok: false, error: "The download did not finish within 60 seconds" };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

// Listeners are registered at the top level so they exist on every worker start.
chrome.runtime.onMessage.addListener((message: SwMessage, _sender, sendResponse) => {
  if (message?.target !== "sw") return;
  if (message.type === "start") {
    startCapture(message.tabId).then(sendResponse, (e) =>
      sendResponse({ ok: false, error: errorText(e) })
    );
    return true;
  }
  if (message.type === "download") {
    saveFile(message.url, message.filename).then(sendResponse);
    return true;
  }
  if (message.type === "close-offscreen") {
    chrome.offscreen.closeDocument().catch(() => {});
    return;
  }
});

// The page script's port ends here; every message is passed on to the offscreen document
// over a second port, so a closed or navigated page shows up there as a disconnect.
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(CAPTURE_PORT)) return;
  const runId = port.name.slice(CAPTURE_PORT.length);
  const relay = chrome.runtime.connect({ name: `${RELAY_PORT}${runId}` });
  port.onMessage.addListener((message) => relay.postMessage(message));
  port.onDisconnect.addListener(() => relay.disconnect());
  relay.onDisconnect.addListener(() => port.disconnect());
});
