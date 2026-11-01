// Service worker. Holds no run state: Chrome stops it when idle, so the run lives in the
// offscreen document and the page script. Everything here is a stateless relay.
import { serveImagePort } from "./image-fetch";
import {
  CAPTURE_PORT,
  IMAGE_PORT,
  type OffscreenMessage,
  RELAY_PORT,
  type Reply,
  type SwMessage,
} from "./messages";
import { pageOrigin } from "./page";
import { resizeWindow, restoreWindow, type WindowsApi } from "./viewport-run";

const OFFSCREEN_URL = "offscreen.html";
const DOWNLOAD_POLL_MS = 250;
const DOWNLOAD_MAX_POLLS = 240;

const WINDOWS: WindowsApi = {
  get: (windowId) => chrome.windows.get(windowId),
  update: (windowId, info) => chrome.windows.update(windowId, info),
};

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

/** Asks the offscreen document, without creating it, whether this run is still going. */
async function runIsLive(runId: string): Promise<boolean> {
  try {
    const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (existing.length === 0) return false;
    const reply: Reply | undefined = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "run-live",
      runId,
    } satisfies OffscreenMessage);
    return reply?.ok === true;
  } catch {
    return false;
  }
}

const hasImageAccess = (): Promise<boolean> =>
  chrome.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false);

async function startCapture(
  tabId: number,
  collapseWrappers: boolean,
  versionKind: string,
  versionLabel: string,
  viewport: boolean
): Promise<Reply> {
  const runId = crypto.randomUUID();
  const started = await toOffscreen({
    target: "offscreen",
    type: "run-start",
    runId,
    viewport,
  });
  if (!started?.ok) return started ?? { ok: false, error: "The capture could not start" };
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      // The run's settings travel with its id; the worker keeps nothing between messages.
      func: (id: string, collapse: boolean, imageAccess: boolean, kind: string, label: string) => {
        const win = window as unknown as {
          __frottageRunId?: string;
          __frottageCollapse?: boolean;
          __frottageImageAccess?: boolean;
          __frottageVersionKind?: string;
          __frottageVersionLabel?: string;
        };
        win.__frottageRunId = id;
        win.__frottageCollapse = collapse;
        win.__frottageImageAccess = imageAccess;
        win.__frottageVersionKind = kind;
        win.__frottageVersionLabel = label;
      },
      args: [runId, collapseWrappers, await hasImageAccess(), versionKind, versionLabel],
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

/** Runs one stateless window or tab call, turning a throw (a closed window) into a reply. */
function answer(call: () => Promise<Reply>, sendResponse: (reply: Reply) => void): true {
  call().then(sendResponse, (e) => sendResponse({ ok: false, error: errorText(e) }));
  return true;
}

// Listeners are registered at the top level so they exist on every worker start.
chrome.runtime.onMessage.addListener((message: SwMessage, _sender, sendResponse) => {
  if (message?.target !== "sw") return;
  if (message.type === "start") {
    startCapture(
      message.tabId,
      message.collapseWrappers === true,
      message.versionKind ?? "",
      message.versionLabel ?? "",
      message.viewport === true
    ).then(sendResponse, (e) => sendResponse({ ok: false, error: errorText(e) }));
    return true;
  }
  if (message.type === "download") {
    saveFile(message.url, message.filename).then(sendResponse);
    return true;
  }
  if (message.type === "viewport-start") {
    return answer(
      async () =>
        (await toOffscreen({ ...message, target: "offscreen" })) ?? {
          ok: false,
          error: "The capture could not start",
        },
      sendResponse
    );
  }
  if (message.type === "tab-origin") {
    return answer(async () => {
      const tab = await chrome.tabs.get(message.tabId);
      return { ok: true, origin: pageOrigin(tab.url) };
    }, sendResponse);
  }
  if (message.type === "window-state") {
    return answer(async () => {
      const { windowId } = await chrome.tabs.get(message.tabId);
      const { state, width, height, left, top } = await chrome.windows.get(windowId);
      return { ok: true, window: { windowId, state, width, height, left, top } };
    }, sendResponse);
  }
  if (message.type === "window-open") {
    return answer(
      () =>
        chrome.windows.get(message.windowId).then(
          () => ({ ok: true, open: true }),
          () => ({ ok: true, open: false })
        ),
      sendResponse
    );
  }
  if (message.type === "resize-window") {
    return answer(
      async () => ({
        ok: true,
        width: await resizeWindow(WINDOWS, message.windowId, message.width, message.left),
      }),
      sendResponse
    );
  }
  if (message.type === "restore-window") {
    return answer(async () => {
      await restoreWindow(WINDOWS, message.window);
      return { ok: true };
    }, sendResponse);
  }
  if (message.type === "close-offscreen") {
    chrome.offscreen.closeDocument().catch(() => {});
    return;
  }
});

// The page script's port ends here; every message is passed on to the offscreen document
// over a second port, so a closed or navigated page shows up there as a disconnect.
chrome.runtime.onConnect.addListener((port) => {
  // One image per port, fetched here because the worker is not bound by the page's CORS rules.
  // Not relayed: serveImagePort answers on the same port, after checking the sender.
  if (port.name.startsWith(IMAGE_PORT)) {
    serveImagePort(port, {
      fetch: (url, init) => fetch(url, init),
      extensionId: chrome.runtime.id,
      hasAccess: hasImageAccess,
      runIsLive,
    });
    return;
  }
  if (!port.name.startsWith(CAPTURE_PORT)) return;
  const runId = port.name.slice(CAPTURE_PORT.length);
  const relay = chrome.runtime.connect({ name: `${RELAY_PORT}${runId}` });
  port.onMessage.addListener((message) => relay.postMessage(message));
  port.onDisconnect.addListener(() => relay.disconnect());
  relay.onDisconnect.addListener(() => port.disconnect());
});
