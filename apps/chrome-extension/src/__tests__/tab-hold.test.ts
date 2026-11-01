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
type Spec = { id: number; pinned?: boolean; groupId?: number };

const RUN_PAGE = "chrome-extension://abc/run.html";
const BUSY = "Tabs cannot be edited right now (user may be dragging a tab).";

/** Window 1 holds a plain tab among others, the tab being 5. */
const PLAIN: Spec[] = [{ id: 10 }, { id: 5 }, { id: 20 }];

/**
 * Stand-ins for `chrome.tabs` and `chrome.windows`, behaving as measured on Chromium: a window
 * closes when its last tab leaves (a popup too), a group disappears with its last tab, a tab
 * moved to another window loses its pin and its group, a cross-window move refuses an index
 * between two tabs of one group, and pinning moves a tab to the end of the pinned ones.
 */
function fakeChrome(spec: Spec[] = PLAIN) {
  const windows: FakeWindow[] = [{ id: 1, type: "normal" }];
  let tabs: FakeTab[] = [];
  let nextTab = 100;
  let nextWindow = 2;
  const calls = { windowsCreate: [] as unknown[], groupCalls: [] as unknown[] };
  const updates: { id: number; props: Record<string, unknown> }[] = [];
  /** How many tab edits Chrome refuses, as it does during the user's tab drag. */
  const refuse = { count: 0 };
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
    incognito: false,
  });
  const find = (id: number) => {
    const t = tabs.find((x) => x.id === id);
    if (!t) throw new Error(`No tab with id: ${id}.`);
    return t;
  };
  const windowExists = (id: number) => windows.some((w) => w.id === id);
  const closeEmptyWindows = () => {
    for (const w of [...windows]) {
      if (inWindow(w.id).length === 0) windows.splice(windows.indexOf(w), 1);
    }
  };
  const checkBusy = () => {
    if (refuse.count > 0) {
      refuse.count--;
      throw new Error(BUSY);
    }
  };
  /** Puts `tab` at `index` among its window's other tabs, kept inside the pinned zone or past it. */
  const place = (tab: FakeTab, windowId: number, index: number) => {
    tabs = tabs.filter((t) => t !== tab);
    tab.windowId = windowId;
    const rest = inWindow(windowId);
    const pinnedCount = rest.filter((t) => t.pinned).length;
    let at = index < 0 ? rest.length : Math.min(index, rest.length);
    at = tab.pinned ? Math.min(at, pinnedCount) : Math.max(at, pinnedCount);
    const before = rest[at];
    if (before) tabs.splice(tabs.indexOf(before), 0, tab);
    else tabs.push(tab);
    closeEmptyWindows();
  };
  const groupExists = (id: number) => tabs.some((t) => t.groupId === id);

  for (const s of spec) {
    tabs.push(
      mk(s.id, 1, {
        pinned: s.pinned ?? false,
        groupId: s.groupId ?? -1,
        active: s.id === 5,
      })
    );
  }

  const api: HoldApi = {
    tabs: {
      get: async (id) => info(find(id)),
      create: async ({ windowId, index, url, active }) => {
        if (!windowExists(windowId)) throw new Error("No window");
        const t = mk(nextTab++, windowId, { url, active });
        if (active) for (const o of inWindow(windowId)) o.active = false;
        tabs.push(t);
        place(t, windowId, index);
        return info(t);
      },
      group: async ({ groupId, tabIds }) => {
        calls.groupCalls.push({ groupId, tabIds });
        checkBusy();
        if (groupId !== undefined && !groupExists(groupId)) throw new Error("No group");
        for (const id of tabIds) {
          const t = find(id);
          if (groupId !== undefined) {
            // Joins at the end of the group, in the group's window, as Chrome does.
            const members = tabs.filter((o) => o.groupId === groupId && o !== t);
            const last = members[members.length - 1];
            if (last) {
              t.pinned = false;
              place(t, last.windowId, inWindow(last.windowId).indexOf(last) + 1);
            }
          }
          t.groupId = groupId ?? 77;
        }
        return groupId ?? 77;
      },
      move: async (id, { windowId, index }) => {
        checkBusy();
        const t = find(id);
        const dest = windowId ?? t.windowId;
        if (!windowExists(dest)) throw new Error("No window");
        if (dest !== t.windowId) {
          const rest = inWindow(dest);
          const at = index < 0 ? rest.length : Math.min(index, rest.length);
          const prev = rest[at - 1];
          const next = rest[at];
          if (prev && next && prev.groupId !== -1 && prev.groupId === next.groupId) {
            throw new Error("Group contiguity is not respected.");
          }
          t.pinned = false;
          t.groupId = -1;
        }
        place(t, dest, index);
      },
      update: async (id, props) => {
        updates.push({ id, props });
        checkBusy();
        const t = find(id);
        if (props.url !== undefined) t.url = props.url;
        if (props.active) {
          for (const o of inWindow(t.windowId)) o.active = false;
          t.active = true;
        }
        if (props.pinned !== undefined && props.pinned !== t.pinned) {
          t.pinned = props.pinned;
          const pinnedCount = inWindow(t.windowId).filter((o) => o.pinned && o !== t).length;
          place(t, t.windowId, props.pinned ? pinnedCount : -1);
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
        t.pinned = false;
        t.groupId = -1;
        place(t, win.id, 0);
        return { id: win.id };
      },
      get: async (id) => {
        if (!windowExists(id)) throw new Error(`No window with id: ${id}.`);
        return { id };
      },
    },
  };
  return {
    api,
    calls,
    updates,
    refuse,
    windows,
    tab: () => tabs.find((t) => t.id === 5),
    tabs: () => tabs,
    order: () => inWindow(1).map((t) => t.id),
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
    setGroup: (ids: number[], groupId: number) => {
      for (const id of ids) find(id).groupId = groupId;
    },
  };
}

const instant = async () => {};

describe("holdTab", () => {
  test("the tab moves to a popup window, unfocused, 900 high, and a holder takes its place", async () => {
    const c = fakeChrome();
    const held = await holdTab(c.api, 5, RUN_PAGE);
    expect(c.calls.windowsCreate).toEqual([
      { tabId: 5, type: "popup", focused: false, height: 900, incognito: false },
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
    const c = fakeChrome([{ id: 5 }]);
    const held = await holdTab(c.api, 5, RUN_PAGE);
    expect(c.windows.map((w) => w.id)).toContain(1);
    expect(c.infoOf(held.holderId).windowId).toBe(1);
  });

  test("the holder joins the tab's group, so a one-tab group survives", async () => {
    const c = fakeChrome([{ id: 10 }, { id: 5, groupId: 9 }, { id: 20 }]);
    const held = await holdTab(c.api, 5, RUN_PAGE);
    expect(c.calls.groupCalls[0]).toEqual({ groupId: 9, tabIds: [held.holderId] });
    expect(c.infoOf(held.holderId).groupId).toBe(9);
    expect(c.tab()?.windowId).toBe(held.runWindowId);
  });

  test("the holder sits right after the tab even when the tab has group-mates after it", async () => {
    const c = fakeChrome([{ id: 5, groupId: 9 }, { id: 31, groupId: 9 }, { id: 20 }]);
    const held = await holdTab(c.api, 5, RUN_PAGE);
    expect(c.infoOf(held.holderId).index).toBe(held.index);
  });

  test("a failed move takes the holder away and leaves the tab active", async () => {
    const c = fakeChrome();
    c.api.windows.create = async () => {
      throw new Error("refused");
    };
    const before = c.tabs().length;
    await expect(holdTab(c.api, 5, RUN_PAGE)).rejects.toThrow("refused");
    expect(c.tabs().length).toBe(before);
    expect(c.tab()?.active).toBe(true);
    expect(c.infoOf(5).windowId).toBe(1);
  });
});

describe("releaseTab", () => {
  const layouts: [string, Spec[]][] = [
    ["plain", PLAIN],
    [
      "pinned, not the last pinned tab",
      [{ id: 11, pinned: true }, { id: 5, pinned: true }, { id: 12, pinned: true }, { id: 20 }],
    ],
    [
      "pinned, the last pinned tab",
      [{ id: 11, pinned: true }, { id: 5, pinned: true }, { id: 20 }],
    ],
    ["alone in its group", [{ id: 10 }, { id: 5, groupId: 9 }, { id: 20 }]],
    [
      "in the middle of a group",
      [
        { id: 10 },
        { id: 30, groupId: 9 },
        { id: 5, groupId: 9 },
        { id: 31, groupId: 9 },
        { id: 20 },
      ],
    ],
    [
      "last in a group",
      [
        { id: 10 },
        { id: 30, groupId: 9 },
        { id: 31, groupId: 9 },
        { id: 5, groupId: 9 },
        { id: 20 },
      ],
    ],
    [
      "first in a group",
      [
        { id: 10 },
        { id: 5, groupId: 9 },
        { id: 30, groupId: 9 },
        { id: 31, groupId: 9 },
        { id: 20 },
      ],
    ],
  ];
  for (const [name, spec] of layouts) {
    test(`the tab comes back to its exact index, pinned, in its group, and active, and the holder is gone (${name})`, async () => {
      const c = fakeChrome(spec);
      const order = c.order();
      const original = c.infoOf(5);
      const held = await holdTab(c.api, 5, RUN_PAGE);
      const outcome = await releaseTab(c.api, held, { delay: instant });
      const back = c.infoOf(5);
      expect(outcome).toBe("back");
      expect(back.windowId).toBe(1);
      expect(back.index).toBe(original.index);
      expect(back.pinned).toBe(original.pinned);
      expect(back.groupId).toBe(original.groupId);
      expect(c.tab()?.active).toBe(true);
      expect(c.tabs().some((t) => t.id === held.holderId)).toBe(false);
      expect(c.order()).toEqual(order);
      expect(c.windows.map((w) => w.id)).toEqual([1]);
      // No second window flashed open on the way back.
      expect(c.calls.windowsCreate).toHaveLength(1);
    });
  }

  test("a closed small window sends the holder to the tab's address and leaves it open", async () => {
    const c = fakeChrome();
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.closeWindow(held.runWindowId);
    expect(await releaseTab(c.api, held, { delay: instant })).toBe("back");
    const holder = c.tabs().find((t) => t.id === held.holderId);
    expect(holder?.url).toBe("https://example.com/5");
    expect(c.tabs().some((t) => t.id === 5)).toBe(false);
  });

  test("a tab with no known address is not sent to an empty one", async () => {
    const c = fakeChrome();
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.closeWindow(held.runWindowId);
    await releaseTab(c.api, { ...held, url: "" }, { delay: instant });
    expect(c.updates.some((u) => u.props.url === "")).toBe(false);
    expect(c.updates.some((u) => "url" in u.props)).toBe(false);
  });

  test("a closed holder sends the tab to the end of its window", async () => {
    const c = fakeChrome();
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.removeTab(held.holderId);
    await releaseTab(c.api, held, { delay: instant });
    const back = c.infoOf(5);
    expect(back.windowId).toBe(1);
    expect(back.index).toBe(c.tabs().filter((t) => t.windowId === 1).length - 1);
  });

  test("a closed home window gives the tab a new normal window", async () => {
    const c = fakeChrome();
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.closeWindow(1);
    expect(await releaseTab(c.api, held, { delay: instant })).toBe("back");
    const win = c.windows.find((w) => w.id === c.infoOf(5).windowId);
    expect(win?.type).toBe("normal");
    expect(win?.id).not.toBe(1);
    expect(c.tab()?.active).toBe(true);
  });

  test("the tab takes the holder's place, so a tab opened to its left does not shift it", async () => {
    const c = fakeChrome();
    const held = await holdTab(c.api, 5, RUN_PAGE);
    await c.api.tabs.create({ windowId: 1, index: 0, url: "https://new.example", active: false });
    await releaseTab(c.api, held, { delay: instant });
    const order = c.order();
    expect(order.indexOf(5)).toBe(2);
    expect(order[order.indexOf(5) + 1]).toBe(20);
  });

  test("an index the user has since put inside a group falls back to the window's end", async () => {
    const c = fakeChrome([{ id: 10 }, { id: 5 }, { id: 20 }]);
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.setGroup([10, held.holderId], 9);
    expect(await releaseTab(c.api, held, { delay: instant })).toBe("back");
    expect(c.infoOf(5).windowId).toBe(1);
    expect(c.calls.windowsCreate).toHaveLength(1);
    expect(c.tabs().some((t) => t.id === held.holderId)).toBe(false);
  });

  test("a tab edit Chrome refuses for a moment is tried again, and the tab comes back", async () => {
    const c = fakeChrome([{ id: 10 }, { id: 5, groupId: 9 }, { id: 20 }]);
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.refuse.count = 3;
    const waits: number[] = [];
    const outcome = await releaseTab(c.api, held, {
      delay: async (ms) => {
        waits.push(ms);
      },
    });
    expect(outcome).toBe("back");
    expect(waits.length).toBeGreaterThan(0);
    expect(c.infoOf(5).windowId).toBe(1);
    expect(c.infoOf(5).groupId).toBe(9);
    expect(c.calls.windowsCreate).toHaveLength(1);
  });

  test("a tab that left its group on the way back is put in it again", async () => {
    const c = fakeChrome([{ id: 10 }, { id: 5, groupId: 9 }, { id: 20 }]);
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.refuse.count = 1; // the first join is refused, so the plain move runs and drops the group
    expect(await releaseTab(c.api, held, { delay: instant })).toBe("back");
    expect(c.infoOf(5).groupId).toBe(9);
    expect(c.infoOf(5).windowId).toBe(1);
  });

  test("a tab Chrome will not move is stranded, and the holder stays", async () => {
    const c = fakeChrome([{ id: 5 }]);
    const held = await holdTab(c.api, 5, RUN_PAGE);
    c.refuse.count = 1000;
    const waits: number[] = [];
    const outcome = await releaseTab(c.api, held, {
      delay: async (ms) => {
        waits.push(ms);
      },
    });
    expect(outcome).toBe("stranded");
    expect(c.infoOf(5).windowId).toBe(held.runWindowId);
    expect(c.tabs().some((t) => t.id === held.holderId)).toBe(true);
    expect(c.windows.map((w) => w.id)).toContain(1);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2500);
  });
});
