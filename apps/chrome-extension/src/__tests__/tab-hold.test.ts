import { describe, expect, test } from "bun:test";
import { type HoldApi, holdTab, releaseTab } from "../tab-hold";

type FakeTab = {
  id: number;
  windowId: number;
  pinned: boolean;
  groupId: number;
  active: boolean;
  url: string;
};
type FakeWindow = { id: number; type: "normal" | "popup" };

const RUN_PAGE = "chrome-extension://abc/run.html";

/**
 * Stand-ins for `chrome.tabs` and `chrome.windows`, behaving as measured on Chromium: a window
 * closes when its last tab leaves (a popup too), a group disappears with its last tab, and pinning
 * moves a tab to the end of the pinned ones.
 */
function fakeChrome(layout: { pinned?: boolean; groupId?: number; others?: number } = {}) {
  const windows: FakeWindow[] = [{ id: 1, type: "normal" }];
  let tabs: FakeTab[] = [];
  let nextTab = 100;
  let nextWindow = 2;
  const calls = { windowsCreate: [] as unknown[], groupCalls: [] as unknown[] };
  const mk = (id: number, windowId: number, over: Partial<FakeTab> = {}): FakeTab => ({
    id,
    windowId,
    pinned: false,
    groupId: -1,
    active: false,
    url: `https://example.com/${id}`,
    ...over,
  });
  const inWindow = (windowId: number) => tabs.filter((t) => t.windowId === windowId);
  const info = (t: FakeTab) => ({
    id: t.id,
    windowId: t.windowId,
    index: inWindow(t.windowId).indexOf(t),
    pinned: t.pinned,
    groupId: t.groupId,
    url: t.url,
  });
  const find = (id: number) => {
    const t = tabs.find((x) => x.id === id);
    if (!t) throw new Error(`No tab with id: ${id}.`);
    return t;
  };
  const closeEmptyWindows = () => {
    for (const w of [...windows]) {
      if (inWindow(w.id).length === 0) windows.splice(windows.indexOf(w), 1);
    }
  };
  const place = (tab: FakeTab, windowId: number, index: number) => {
    tabs = tabs.filter((t) => t !== tab);
    tab.windowId = windowId;
    const rest = inWindow(windowId);
    const at = index < 0 ? rest.length : Math.min(index, rest.length);
    const before = rest[at];
    if (before) tabs.splice(tabs.indexOf(before), 0, tab);
    else tabs.push(tab);
    closeEmptyWindows();
  };
  const groupExists = (id: number) => tabs.some((t) => t.groupId === id);

  // Window 1: [others before], the tab, [others after]
  const before = layout.others ?? 1;
  for (let i = 0; i < before; i++) tabs.push(mk(10 + i, 1, { pinned: layout.pinned && i === 0 }));
  const target = mk(5, 1, {
    active: true,
    pinned: layout.pinned ?? false,
    groupId: layout.groupId ?? -1,
  });
  tabs.push(target);
  tabs.push(mk(20, 1));

  const api: HoldApi = {
    tabs: {
      get: async (id) => info(find(id)),
      create: async ({ windowId, index, url, active }) => {
        if (!windows.some((w) => w.id === windowId)) throw new Error("No window");
        const t = mk(nextTab++, windowId, { url, active });
        if (active) for (const o of inWindow(windowId)) o.active = false;
        tabs.push(t);
        place(t, windowId, index);
        return info(t);
      },
      group: async ({ groupId, tabIds }) => {
        calls.groupCalls.push({ groupId, tabIds });
        if (groupId !== undefined && !groupExists(groupId)) throw new Error("No group");
        for (const id of tabIds) find(id).groupId = groupId ?? 77;
        return groupId ?? 77;
      },
      move: async (id, { windowId, index }) => {
        const t = find(id);
        const dest = windowId ?? t.windowId;
        if (!windows.some((w) => w.id === dest)) throw new Error("No window");
        place(t, dest, index);
      },
      update: async (id, props) => {
        const t = find(id);
        if (props.url !== undefined) t.url = props.url;
        if (props.active) {
          for (const o of inWindow(t.windowId)) o.active = false;
          t.active = true;
        }
        if (props.pinned !== undefined && props.pinned !== t.pinned) {
          t.pinned = props.pinned;
          const pinnedCount = inWindow(t.windowId).filter((o) => o.pinned && o !== t).length;
          place(t, t.windowId, pinnedCount);
        }
      },
      remove: async (id) => {
        const t = find(id);
        tabs = tabs.filter((x) => x !== t);
        closeEmptyWindows();
      },
    },
    windows: {
      create: async (opts) => {
        calls.windowsCreate.push(opts);
        const t = find(opts.tabId);
        const win: FakeWindow = { id: nextWindow++, type: opts.type ?? "normal" };
        windows.push(win);
        place(t, win.id, 0);
        return { id: win.id };
      },
    },
  };
  return {
    api,
    calls,
    windows,
    tab: () => tabs.find((t) => t.id === 5),
    tabs: () => tabs,
    infoOf: (id: number) => info(find(id)),
    /** The user closes a window, and every tab in it. */
    closeWindow: (id: number) => {
      tabs = tabs.filter((t) => t.windowId !== id);
      windows.splice(
        windows.findIndex((w) => w.id === id),
        1
      );
    },
    removeTab: (id: number) => {
      tabs = tabs.filter((t) => t.id !== id);
      closeEmptyWindows();
    },
  };
}

describe("holdTab", () => {
  test("the tab moves to a popup window, unfocused, 900 high, and a holder takes its place", async () => {
    const c = fakeChrome();
    const held = await holdTab(c.api, 5, RUN_PAGE);
    expect(c.calls.windowsCreate).toEqual([
      { tabId: 5, type: "popup", focused: false, height: 900 },
    ]);
    expect(c.tab()?.windowId).toBe(held.runWindowId);
    const holder = c.infoOf(held.holderId);
    expect(holder.windowId).toBe(1);
    expect(holder.url).toBe(RUN_PAGE);
    expect(holder.index).toBe(held.index);
    expect(c.tabs().find((t) => t.id === held.holderId)?.active).toBe(true);
    expect(held).toMatchObject({
      tabId: 5,
      windowId: 1,
      index: 1,
      pinned: false,
      groupId: -1,
      url: "https://example.com/5",
    });
  });

  test("a window's only tab leaves the window open", async () => {
    const c = fakeChrome({ others: 0 });
    c.tabs().splice(1, 1); // only the tab remains
    const held = await holdTab(c.api, 5, RUN_PAGE);
    expect(c.windows.map((w) => w.id)).toContain(1);
    expect(c.infoOf(held.holderId).windowId).toBe(1);
  });

  test("the holder joins the tab's group, so a one-tab group survives", async () => {
    const c = fakeChrome({ groupId: 9 });
    const held = await holdTab(c.api, 5, RUN_PAGE);
    expect(c.calls.groupCalls).toEqual([{ groupId: 9, tabIds: [held.holderId] }]);
    expect(c.infoOf(held.holderId).groupId).toBe(9);
    expect(c.tab()?.windowId).toBe(held.runWindowId);
  });

  test("a failed move takes the holder away again", async () => {
    const c = fakeChrome();
    c.api.windows.create = async () => {
      throw new Error("refused");
    };
    const before = c.tabs().length;
    await expect(holdTab(c.api, 5, RUN_PAGE)).rejects.toThrow("refused");
    expect(c.tabs().length).toBe(before);
  });
});

describe("releaseTab", () => {
  const layouts: [string, { pinned?: boolean; groupId?: number; others?: number }][] = [
    ["plain", {}],
    ["pinned", { pinned: true }],
    ["grouped", { groupId: 9 }],
  ];
  for (const [name, layout] of layouts) {
    test(`the tab comes back to its exact index, pinned, in its group, and active, and the holder is gone (${name})`, async () => {
      const c = fakeChrome(layout);
      const order = c.tabs().map((t) => t.id);
      const original = c.infoOf(5);
      const held = await holdTab(c.api, 5, RUN_PAGE);
      await releaseTab(c.api, held);
      const back = c.infoOf(5);
      expect(back.windowId).toBe(1);
      expect(back.index).toBe(original.index);
      expect(back.pinned).toBe(original.pinned);
      expect(back.groupId).toBe(original.groupId);
      expect(c.tab()?.active).toBe(true);
      expect(c.tabs().some((t) => t.id === held.holderId)).toBe(false);
      expect(c.tabs().map((t) => t.id)).toEqual(order);
      expect(c.windows.map((w) => w.id)).toEqual([1]);
    });
  }

  test("a closed small window sends the holder to the tab's address and leaves it open", async () => {
    const c = fakeChrome();
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.closeWindow(held.runWindowId);
    await releaseTab(c.api, held);
    const holder = c.tabs().find((t) => t.id === held.holderId);
    expect(holder?.url).toBe("https://example.com/5");
    expect(c.tabs().some((t) => t.id === 5)).toBe(false);
  });

  test("a closed holder sends the tab to the end of its window", async () => {
    const c = fakeChrome();
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.removeTab(held.holderId);
    await releaseTab(c.api, held);
    const back = c.infoOf(5);
    expect(back.windowId).toBe(1);
    expect(back.index).toBe(c.tabs().filter((t) => t.windowId === 1).length - 1);
  });

  test("a closed home window gives the tab a new normal window", async () => {
    const c = fakeChrome();
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.closeWindow(1);
    await releaseTab(c.api, held);
    const win = c.windows.find((w) => w.id === c.infoOf(5).windowId);
    expect(win?.type).toBe("normal");
    expect(win?.id).not.toBe(1);
    expect(c.tab()?.active).toBe(true);
  });
});
