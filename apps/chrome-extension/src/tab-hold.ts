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
};

type TabInfo = {
  id?: number;
  windowId: number;
  index: number;
  pinned: boolean;
  groupId: number;
  url?: string;
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
    focused?: boolean;
    height?: number;
  }) => Promise<{ id?: number }>;
};

export type HoldApi = { tabs: TabsApi; windows: HoldWindowsApi };

/** Tall enough that a page's height is not what limits the capture. */
const RUN_WINDOW_HEIGHT = 900;

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
    url: runPageUrl,
    active: true,
  });
  const holderId = holder.id;
  if (holderId === undefined) throw new Error("The run page could not be opened");
  try {
    if (tab.groupId !== -1) await api.tabs.group({ groupId: tab.groupId, tabIds: [holderId] });
    const win = await api.windows.create({
      tabId,
      type: "popup",
      focused: false,
      height: RUN_WINDOW_HEIGHT,
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
    };
  } catch (error) {
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

/**
 * Gives the tab back where it was, and removes the holder. Every step tolerates what it restores
 * being gone, and none stops the next: a tab left a little out of place beats one left behind.
 */
export async function releaseTab(api: HoldApi, held: HeldTab): Promise<void> {
  const { tabId, holderId, windowId, index } = held;
  const tabIsThere = await api.tabs.get(tabId).then(
    () => true,
    () => false
  );
  if (!tabIsThere) {
    // The small window was closed, and the tab with it: the holder goes to the tab's address.
    await attempt(() => api.tabs.update(holderId, { url: held.url }));
    return;
  }
  const holderIsThere = await api.tabs.get(holderId).then(
    () => true,
    () => false
  );
  const target = holderIsThere ? index : -1;
  if (!(await attempt(() => api.tabs.move(tabId, { windowId, index: target })))) {
    // The home window is gone.
    await attempt(() => api.windows.create({ tabId, type: "normal" }));
  }
  let pinned = false;
  if (held.pinned) pinned = await attempt(() => api.tabs.update(tabId, { pinned: true }));
  if (held.groupId !== -1) {
    await attempt(() => api.tabs.group({ groupId: held.groupId, tabIds: [tabId] }));
  }
  if (pinned && holderIsThere) await attempt(() => api.tabs.move(tabId, { windowId, index }));
  await attempt(() => api.tabs.update(tabId, { active: true }));
  await attempt(() => api.tabs.remove(holderId));
}
