import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";

// The popup renders itself on import, so the page and `chrome` are set up first.
const en = { code: "en", name: "English", url: "https://site.test/", current: true };
const sv = { code: "sv", name: "Svenska", url: "https://sv.site.test/", current: false };
const de = { code: "de", name: "Deutsch", url: "https://site.test/de/", current: false };

type Sent = Record<string, unknown>;
let sent: Sent[] = [];
let requested: unknown[] = [];
let grant = true;
let languages: unknown[] = [en, sv];
let breakpoints: number[] = [];
let window: Window;
const saved = new Map<string, { had: boolean; value: unknown }>();
const g = globalThis as Record<string, unknown>;
const roots: { unmount(): void }[] = [];

beforeAll(async () => {
  window = new Window({ url: "https://site.test/" });
  window.document.body.innerHTML = '<div id="root"></div>';
  const w = window as unknown as Record<string, unknown>;
  // Every global that gets touched is snapshotted before any is assigned.
  const own = Object.getOwnPropertyNames(window).filter((key) => !(key in globalThis));
  const touched = [
    ...own,
    "window",
    "document",
    "navigator",
    "localStorage",
    "matchMedia",
    "chrome",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  for (const key of touched) saved.set(key, { had: key in g, value: g[key] });
  for (const key of own) {
    try {
      g[key] = w[key];
    } catch {}
  }
  // The popup mounts itself, so its roots are kept to unmount after each test.
  const client = { ...(await import("react-dom/client")) };
  mock.module("react-dom/client", () => ({
    ...client,
    createRoot: (...args: Parameters<typeof client.createRoot>) => {
      const root = client.createRoot(...args);
      roots.push(root);
      return root;
    },
  }));
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    matchMedia: window.matchMedia.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
    chrome: {
      action: { setBadgeText: async () => {} },
      tabs: {
        query: async () => [{ id: 7, url: "https://site.test/" }],
      },
      runtime: {
        getContexts: async () => [],
        onMessage: { addListener() {}, removeListener() {} },
        sendMessage: async (message: Sent) => {
          sent.push(message);
          if (message.type === "breakpoints") {
            return { ok: true, breakpoints, dark: false, languages };
          }
          return { ok: true };
        },
      },
      permissions: {
        request: async (asked: unknown) => {
          requested.push(asked);
          return grant;
        },
        contains: async () => false,
      },
    },
  });
});

afterAll(() => {
  for (const [key, { had, value }] of saved) {
    try {
      if (had) g[key] = value;
      else delete g[key];
    } catch {}
  }
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

beforeEach(() => {
  sent = [];
  requested = [];
  grant = true;
  languages = [en, sv];
  breakpoints = [];
});

async function open() {
  window.document.body.innerHTML = '<div id="root"></div>';
  window.localStorage.clear();
  await act(async () => {
    await import(`../popup/popup?${Math.random()}`);
  });
  // The probe has answered once the Capture button is there and, when it finds languages, the group.
  await waitFor(
    () => /Capture/.test(text()) && (languages.length < 2 || text().includes("Languages"))
  );
}

async function waitFor(ready: () => boolean, timeout = 2000) {
  const end = Date.now() + timeout;
  while (!ready()) {
    if (Date.now() > end) throw new Error("Timed out waiting for the popup");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

const codes = (start: Sent | undefined) =>
  ((start?.languages ?? []) as { code: string }[]).map((l) => l.code);
const box = (id: string) => window.document.getElementById(id) as unknown as HTMLInputElement;
const text = () => window.document.body.textContent ?? "";
const press = (el: unknown) =>
  act(async () => {
    (el as HTMLElement).click();
  });
const capture = () =>
  press(
    [...window.document.querySelectorAll("button")].find((b) =>
      /^Capture/.test(b.textContent ?? "")
    ) ?? null
  );

describe("popup languages", () => {
  test("lists the languages with the current one ticked and disabled", async () => {
    await open();
    expect(text()).toContain("Languages");
    expect(text()).toContain("English");
    expect(text()).toContain("Svenska");
    expect(box("language-en").getAttribute("aria-checked")).toBe("true");
    expect(box("language-en").hasAttribute("disabled")).toBe(true);
    expect(box("language-sv").getAttribute("aria-checked")).toBe("false");
    expect(text()).not.toContain("captures:");
  });

  test("shows no group for one language", async () => {
    languages = [en];
    await open();
    expect(text()).not.toContain("Languages");
  });

  test("a second language adds up the captures", async () => {
    await open();
    await press(box("language-sv"));
    expect(text()).toContain("captures:");
    expect(text()).toMatch(/\d+ captures: \d+ devices? × 2 languages/);
  });

  test("capture sends the ticked languages, current first, and asks for another origin", async () => {
    languages = [sv, en];
    await open();
    await press(box("language-sv"));
    await capture();
    expect(requested).toEqual([{ origins: ["https://sv.site.test/*"] }]);
    const start = sent.find((m) => m.type === "viewport-start");
    expect(codes(start)).toEqual(["en", "sv"]);
  });

  test("a refused origin leaves its language out and says so", async () => {
    grant = false;
    await open();
    await press(box("language-sv"));
    await capture();
    const start = sent.find((m) => m.type === "viewport-start");
    expect(start && "languages" in start).toBe(false);
    expect(text()).toContain("Svenska needs access to sv.site.test, so it was left out.");
  });

  test("a refused origin's line goes with the run, so it outlives the popup", async () => {
    grant = false;
    languages = [en, sv, de];
    await open();
    await press(box("language-sv"));
    await press(box("language-de"));
    await capture();
    const start = sent.find((m) => m.type === "viewport-start");
    expect(start?.leftOut).toEqual(["Svenska needs access to sv.site.test, so it was left out."]);
    expect(codes(start)).toEqual(["en", "de"]);
  });

  test("the first progress counts every language's captures", async () => {
    languages = [en, de];
    await open();
    await press(box("language-de"));
    const total = /(\d+) captures:/.exec(text())?.[1];
    expect(total).toBeDefined();
    await capture();
    expect(text()).toContain(`of ${total})`);
  });

  test("a same-origin language asks for nothing", async () => {
    languages = [en, de];
    await open();
    await press(box("language-de"));
    await capture();
    expect(requested).toEqual([]);
    const start = sent.find((m) => m.type === "viewport-start");
    expect(codes(start)).toEqual(["en", "de"]);
  });

  test("only the current language sends no languages", async () => {
    await open();
    await capture();
    const start = sent.find((m) => m.type === "viewport-start");
    expect(start && "languages" in start).toBe(false);
  });
});

describe("popup breakpoints", () => {
  const TAILWIND = [640, 768, 1024, 1280, 1536];
  const startOf = () => sent.find((m) => m.type === "viewport-start");
  const widthsOf = () => ((startOf()?.runWidths ?? []) as { width: number }[]).map((w) => w.width);
  const rowOf = (name: string) =>
    [...window.document.querySelectorAll("[data-breakpoint]")].find(
      (el) => el.getAttribute("data-breakpoint") === name
    ) as HTMLElement | undefined;
  const sizesButton = () =>
    [...window.document.querySelectorAll("button")].find((b) =>
      /^Capture/.test(b.textContent ?? "")
    )?.textContent;

  async function openWith(found: number[]) {
    breakpoints = found;
    languages = [en];
    await open();
    await waitFor(() => found.length === 0 || text().includes("Breakpoints"));
  }

  test("lists a row per range under a Breakpoints label, covered ones naming the device", async () => {
    await openWith(TAILWIND);
    expect(text()).toContain("Breakpoints");
    const row = (name: string) => rowOf(name)?.textContent ?? "";
    expect(row("base")).toContain("390");
    expect(row("base")).toContain("Phone portrait");
    expect(row("sm")).toContain("640");
    expect(rowOf("sm")?.querySelector("button[role=checkbox]")).not.toBeNull();
    expect(row("md")).toContain("Tablet portrait");
    expect(rowOf("md")?.querySelector("button[role=checkbox]")).toBeNull();
    expect(row("xl")).toContain("Laptop");
    expect(row("2xl")).toContain("1536");
    expect(rowOf("2xl")?.querySelector("button[role=checkbox]")).not.toBeNull();
  });

  test("shows no group without breakpoints, and never the old extras line", async () => {
    await openWith([]);
    expect(text()).not.toContain("Breakpoints");
    expect(text()).not.toContain("Also captures");
  });

  test("the old extras line is gone with breakpoints too", async () => {
    await openWith(TAILWIND);
    expect(text()).not.toContain("Also captures");
  });

  test("unticking a breakpoint drops it from the count and the request", async () => {
    await openWith(TAILWIND);
    const before = Number(/Capture (\d+) sizes/.exec(sizesButton() ?? "")?.[1]);
    await press(box("breakpoint-on-sm"));
    expect(Number(/Capture (\d+) sizes/.exec(sizesButton() ?? "")?.[1])).toBe(before - 1);
    await capture();
    expect(widthsOf()).not.toContain(640);
    expect(widthsOf()).toContain(1024);
  });

  test("an unticked name survives a device change", async () => {
    await openWith(TAILWIND);
    await press(box("breakpoint-on-lg"));
    // Laptop 1512 covers xl; ticking Desktop 1440 (also xl) and unticking Tablet portrait uncovers md.
    await press(box("size-on-desktop"));
    await press(box("size-on-tablet-portrait"));
    expect(box("breakpoint-on-lg").getAttribute("aria-checked")).toBe("false");
    expect(box("breakpoint-on-md").getAttribute("aria-checked")).toBe("true");
    await capture();
    expect(widthsOf()).not.toContain(1024);
    expect(widthsOf()).toContain(768);
  });

  test("unticked breakpoints are sent nowhere but as the widths left out", async () => {
    await openWith(TAILWIND);
    await press(box("breakpoint-on-sm"));
    await capture();
    expect(JSON.stringify(startOf())).not.toContain("skip");
    expect(startOf()?.runWidths).toBeDefined();
  });

  test("unticking a device uncovers its range, which then gets a checkbox", async () => {
    await openWith(TAILWIND);
    expect(rowOf("xl")?.querySelector("button[role=checkbox]")).toBeNull();
    await press(box("size-on-laptop"));
    expect(rowOf("xl")?.querySelector("button[role=checkbox]")).not.toBeNull();
  });
});
