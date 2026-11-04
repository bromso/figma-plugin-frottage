import { describe, expect, test } from "bun:test";
import type { Capture, CaptureNode, PageLanguage } from "@repo/capture-schema";
import { languageHrefMap, pairTexts, textPath } from "../languages";
import { cap, el, run, textNode } from "./fixtures";

const t = (id: string, text: string, href?: string, runs = [run({ ...(href ? { href } : {}) })]) =>
  textNode(id, { text, runs });
const tagged = (tag: string, className?: string) => ({
  semantic: { tag, ...(className ? { className } : {}) },
});
const page = (...children: CaptureNode[]): Capture =>
  cap(el("r", [0, 0], [...children], tagged("body")));
const same = (m: string) => m;

describe("textPath", () => {
  test("steps by tag, class and index among alike siblings", () => {
    const root = el(
      "r",
      [0, 0],
      [el("a", [0, 0], [], tagged("div", "x")), el("m", [0, 0], [t("t1", "A"), t("t2", "B")])]
    );
    expect(textPath(root, "t2")).toBe("div#0/text#1");
    expect(textPath(root, "t1")).toBe("div#0/text#0");
    expect(textPath(root, "nope")).toBeNull();
  });
});

describe("pairTexts", () => {
  test("identical structure pairs every text", () => {
    const base = page(el("m", [0, 0], [t("a", "Hello"), t("b", "Bye")], tagged("main")));
    const other = page(el("m2", [0, 0], [t("x", "Hej"), t("y", "Hejdå")], tagged("main")));
    const r = pairTexts(base, other, same);
    expect(r.rate).toBe(1);
    expect(r.pairs.get("a")).toBe("Hej");
    expect(r.pairs.get("b")).toBe("Hejdå");
  });

  test("an extra banner leaves main's texts paired", () => {
    const base = page(el("m", [0, 0], [t("a", "Hello")], tagged("main")));
    const other = page(
      el("bn", [0, 0], [t("z", "Cookies")], tagged("section", "banner")),
      el("m2", [0, 0], [t("x", "Hej")], tagged("main"))
    );
    const r = pairTexts(base, other, same);
    expect(r.pairs.get("a")).toBe("Hej");
    expect(r.onlyOther).toBe(1);
    expect(r.onlyBase).toBe(0);
  });

  test("a link moved elsewhere pairs by its target", () => {
    const base = page(
      el("n", [0, 0], [t("a", "Pricing", "https://site/en/pricing")], tagged("nav"))
    );
    const other = page(
      el(
        "w",
        [0, 0],
        [el("n2", [0, 0], [t("x", "Priser", "https://site/sv/priser")], tagged("nav"))]
      )
    );
    const map = languageHrefMap(
      [
        { code: "en", name: "English", url: "https://site/en", current: true },
        { code: "sv", name: "Svenska", url: "https://site/sv", current: false },
      ],
      [["https://site/sv/priser", "https://site/en/pricing"]]
    );
    const r = pairTexts(base, other, map);
    expect(r.pairs.get("a")).toBe("Priser");
  });

  test("a bold run marks the text mixed", () => {
    const base = page(
      el(
        "m",
        [0, 0],
        [t("a", "Hello", undefined, [run({ end: 2 }), run({ start: 2, end: 5, weight: 700 })])],
        tagged("main")
      )
    );
    const other = page(el("m", [0, 0], [t("x", "Hej")], tagged("main")));
    const r = pairTexts(base, other, same);
    expect([...r.mixed]).toEqual(["a"]);
  });

  test("no texts gives rate 1", () => {
    const r = pairTexts(page(), page(), same);
    expect(r.rate).toBe(1);
    expect(r.pairs.size).toBe(0);
  });

  test("invisible and empty texts are ignored", () => {
    const base = page(
      el(
        "m",
        [0, 0],
        [t("a", "Hello"), textNode("b", { text: "  " }), textNode("c", { visible: false })]
      )
    );
    const r = pairTexts(base, base, same);
    expect(r.pairs.size).toBe(1);
    expect(r.rate).toBe(1);
  });
});

describe("languageHrefMap", () => {
  const prefix: PageLanguage[] = [
    { code: "en", name: "English", url: "https://site.com/en/", current: true },
    { code: "sv", name: "Svenska", url: "https://site.com/sv", current: false },
  ];
  test("swaps a path prefix", () => {
    const map = languageHrefMap(prefix);
    expect(map("https://site.com/sv/about")).toBe("https://site.com/en/about");
    expect(map("https://site.com/sv")).toBe("https://site.com/en");
    expect(map("https://site.com/svx/about")).toBe("https://site.com/svx/about");
    expect(map("https://other.com/")).toBe("https://other.com/");
  });
  test("swaps an origin", () => {
    const map = languageHrefMap([
      { code: "en", name: "English", url: "https://site.com/", current: true },
      { code: "sv", name: "Svenska", url: "https://sv.site.com/", current: false },
    ]);
    expect(map("https://sv.site.com/about")).toBe("https://site.com/about");
  });
  test("exact pairs win over prefixes", () => {
    const map = languageHrefMap(prefix, [
      ["https://site.com/sv/priser", "https://site.com/en/pricing"],
    ]);
    expect(map("https://site.com/sv/priser")).toBe("https://site.com/en/pricing");
  });
});
