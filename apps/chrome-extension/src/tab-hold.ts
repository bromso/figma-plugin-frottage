/** What the tab was before the run, and the two pages that hold its place. */
export type HeldTab = {
  tabId: number;
  windowId: number;
  index: number;
  pinned: boolean;
  /** -1 when the tab was in no group. */
  groupId: number;
  url: string;
  /** The run page that took the tab's place. */
  holderId: number;
  /** The small window the tab moved to. */
  runWindowId: number;
  /** Whether the tab is in an Incognito window, which a new window for it must be too. */
  incognito: boolean;
};

type TabInfo = {
  id?: number;
  windowId: number;
  index: number;
  pinned: boolean;
  groupId: number;
  url?: string;
  incognito?: boolean;
};

/** The part of `chrome.tabs` the hold uses, so it can be tested. */
export type TabsApi = {
  get: (tabId: number) => Promise<TabInfo>;
  create: (info: {
    windowId: number;
    index: number;
    url: string;
    active: boolean;
  }) => Promise<TabInfo>;
  group: (info: { groupId?: number; tabIds: number[] }) => Promise<number>;
  move: (tabId: number, info: { windowId?: number; index: number }) => Promise<unknown>;
  update: (
    tabId: number,
    info: { url?: string; pinned?: boolean; active?: boolean }
  ) => Promise<unknown>;
  remove: (tabId: number) => Promise<unknown>;
};

/** The part of `chrome.windows` the hold uses. */
export type HoldWindowsApi = {
  create: (info: {
    tabId: number;
    type?: "popup" | "normal";
    incognito?: boolean;
    focused?: boolean;
    height?: number;
    left?: number;
    top?: number;
  }) => Promise<{ id?: number }>;
  get: (windowId: number) => Promise<unknown>;
};

export type HoldApi = { tabs: TabsApi; windows: HoldWindowsApi };

/** Tall enough that a page's height is not what limits the capture. */
const RUN_WINDOW_HEIGHT = 900;

/**
 * What an Incognito tab's holder shows. A spanning extension can't load its own page in an Incognito
 * window, so the holder there is this static page: no scripts, light or dark as the browser is.
 */
export function holderPage(): string {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Frottage is capturing this page</title><style>:root{color-scheme:light dark;font:14px system-ui,sans-serif;background:#fff;color:#1a1a1a}@media (prefers-color-scheme:dark){:root{background:#2c2c2c;color:#f5f5f5}}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center;box-sizing:border-box}h1{font-size:16px;margin:0}p{margin:0;opacity:.75}</style></head><body><h1>Frottage is capturing this page</h1><p>Leave the small window open. Your tab comes back here when it's done.</p><p>To stop, click the Frottage icon.</p></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Moves the tab to a small popup window and puts a run page where it was, so the window the user
 * works in stays as it is. The holder joins the tab's group first: a group closes when its last
 * tab leaves, and the tab must find it again.
 */
export async function holdTab(api: HoldApi, tabId: number, runPageUrl: string): Promise<HeldTab> {
  const tab = await api.tabs.get(tabId);
  const holder = await api.tabs.create({
    windowId: tab.windowId,
    index: tab.index + 1,
    url: tab.incognito ? holderPage() : runPageUrl,
    active: true,
  });
  const holderId = holder.id;
  if (holderId === undefined) throw new Error("The run page could not be opened");
  try {
    // A holder in another window, or profile, could not take the tab back: no run starts.
    if (holder.windowId !== tab.windowId) throw new Error("The run page could not be opened here");
    if (tab.groupId !== -1) {
      await api.tabs.group({ groupId: tab.groupId, tabIds: [holderId] });
    }
    const win = await api.windows.create({
      tabId,
      type: "popup",
      focused: false,
      height: RUN_WINDOW_HEIGHT,
      // At the screen's corner, so no width up to the screen's own is refused for its bounds.
      left: 0,
      top: 0,
      // The extension runs in spanning mode, so a tab in Incognito must stay in Incognito.
      incognito: tab.incognito,
    });
    if (win.id === undefined) throw new Error("The small window could not be opened");
    return {
      tabId,
      windowId: tab.windowId,
      index: tab.index,
      pinned: tab.pinned,
      groupId: tab.groupId,
      url: tab.url ?? "",
      holderId,
      runWindowId: win.id,
      incognito: tab.incognito === true,
    };
  } catch (error) {
    // The holder took focus; the user's tab gets it back before the holder goes.
    await api.tabs.update(tabId, { active: true }).catch(() => {});
    await api.tabs.remove(holderId).catch(() => {});
    throw error;
  }
}

/** Runs a step whose target may be gone; a missing one is not a reason to skip the next step. */
const attempt = async (step: () => Promise<unknown>): Promise<boolean> =>
  step().then(
    () => true,
    () => false
  );

/** Chrome refuses tab edits for a moment now and then, as during the user's tab drag. */
const RETURN_ATTEMPTS = 5;
const RETURN_WAIT_MS = 500;

export type ReleaseOptions = { delay?: (ms: number) => Promise<void> };

/** "back": the tab is out of the small window. "stranded": it could not be moved, and the holder stays. */
export type ReleaseOutcome = "back" | "stranded";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Where = "gone" | "run-window" | "out";

async function whereIs(api: HoldApi, held: HeldTab): Promise<Where> {
  try {
    const tab = await api.tabs.get(held.tabId);
    return tab.windowId === held.runWindowId ? "run-window" : "out";
  } catch {
    return "gone";
  }
}

/** One go at moving the tab out of the small window, to where the holder stands. */
async function moveBack(api: HoldApi, held: HeldTab): Promise<void> {
  const { tabId, groupId } = held;
  const holder = await api.tabs.get(held.holderId).catch(() => null);
  const windowId = holder?.windowId ?? held.windowId;
  // A pinned tab's holder stands past the pinned ones, so its own index is the one to give back.
  const index = !holder ? -1 : held.pinned ? held.index : holder.index;
  // Joining a group crosses windows by itself, and Chrome refuses a plain move into the middle of one.
  if (groupId !== -1 && (await attempt(() => api.tabs.group({ groupId, tabIds: [tabId] })))) {
    if (holder) await attempt(() => api.tabs.move(tabId, { index }));
    return;
  }
  if (await attempt(() => api.tabs.move(tabId, { windowId, index }))) return;
  // Refused: a closed window and a refusal are different, and only a closed window needs a new one.
  if (!(await attempt(() => api.windows.get(windowId)))) {
    await attempt(() => api.windows.create({ tabId, type: "normal", incognito: held.incognito }));
    return;
  }
  await attempt(() => api.tabs.move(tabId, { windowId, index: -1 }));
}

/**
 * Gives the tab back where it was, and removes the holder once the tab is out of the small window.
 * Chrome can refuse for a moment, so the return is tried a few times over about two seconds; if it
 * never works the tab is "stranded", and the holder stays so the user's window does not close.
 */
export async function releaseTab(
  api: HoldApi,
  held: HeldTab,
  { delay = sleep }: ReleaseOptions = {}
): Promise<ReleaseOutcome> {
  const { tabId, holderId, index } = held;
  let where = await whereIs(api, held);
  for (let i = 0; where === "run-window" && i < RETURN_ATTEMPTS; i++) {
    if (i > 0) await delay(RETURN_WAIT_MS);
    await moveBack(api, held);
    where = await whereIs(api, held);
  }
  if (where === "gone") {
    // The small window was closed, and the tab with it: the holder goes to the tab's address.
    const holder = await api.tabs.get(holderId).catch(() => null);
    if (held.url !== "" && holder?.windowId === held.windowId) {
      await attempt(() => api.tabs.update(holderId, { url: held.url }));
    }
    return "back";
  }
  if (where === "run-window") return "stranded";

  // Every step tolerates what it restores being gone, and none stops the next.
  const tab = await api.tabs.get(tabId).catch(() => null);
  if (held.pinned && tab && !tab.pinned)
    await attempt(() => api.tabs.update(tabId, { pinned: true }));
  if (held.groupId !== -1 && tab && tab.groupId !== held.groupId) {
    await attempt(() => api.tabs.group({ groupId: held.groupId, tabIds: [tabId] }));
  }
  if (held.pinned) await attempt(() => api.tabs.move(tabId, { index }));
  await attempt(() => api.tabs.update(tabId, { active: true }));
  await attempt(() => api.tabs.remove(holderId));
  return "back";
}
