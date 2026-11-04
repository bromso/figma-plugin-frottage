import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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
let window: Window;
const saved = new Map<string, unknown>();

beforeAll(async () => {
  window = new Window({ url: "https://site.test/" });
  window.document.body.innerHTML = '<div id="root"></div>';
  for (const key of Object.getOwnPropertyNames(window)) {
    if (key in globalThis) continue;
    try {
      (globalThis as Record<string, unknown>)[key] = (window as unknown as Record<string, unknown>)[
        key
      ];
      saved.set(key, undefined);
    } catch {}
  }
  for (const key of ["window", "document", "navigator", "localStorage", "matchMedia", "self"]) {
    saved.set(key, (globalThis as Record<string, unknown>)[key]);
  }
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
            return { ok: true, breakpoints: [], dark: false, languages };
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
  for (const [key, value] of saved) {
    if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = value;
  }
});

beforeEach(() => {
  sent = [];
  requested = [];
  grant = true;
  languages = [en, sv];
});

async function open() {
  window.document.body.innerHTML = '<div id="root"></div>';
  window.localStorage.clear();
  await act(async () => {
    await import(`../popup/popup?${Math.random()}`);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
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
