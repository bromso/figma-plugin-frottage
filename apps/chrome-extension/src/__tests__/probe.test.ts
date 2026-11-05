import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { probePage, probeReply } from "../probe";

const isColor = (v: string) => /^(#[0-9a-f]{3,8}|rgba?\(.*\))$/i.test(v);

function probe(css: string) {
  const win = new Window();
  const doc = win.document as unknown as Document;
  doc.head.innerHTML = `<style>${css}</style>`;
  return probePage(doc, doc.documentElement, isColor);
}

describe("probePage", () => {
  test("a page with a dark theme says so, and keeps its breakpoints", () => {
    const found = probe(".dark{--x:#000} @media (min-width: 768px){a{color:red}}");
    expect(found.dark).toBe(true);
    expect(found.widths).toEqual([768]);
  });
  test("a page without one does not", () => {
    expect(probe("a{color:red}").dark).toBe(false);
  });
  test("a failing theme read leaves the breakpoints", () => {
    const win = new Window();
    const doc = win.document as unknown as Document;
    doc.head.innerHTML = "<style>@media (min-width: 640px){a{color:red}}</style>";
    const root = {
      matches: () => {
        throw new Error("no");
      },
    } as unknown as Element;
    const found = probePage(doc, root, () => {
      throw new Error("no");
    });
    expect(found.dark).toBe(false);
    expect(found.widths).toEqual([640]);
  });
});

describe("probePage languages", () => {
  test("finds languages, and a throwing language read leaves breakpoints and dark", () => {
    const win = new Window();
    const doc = win.document as unknown as Document;
    doc.head.innerHTML =
      '<style>@media (min-width: 640px){a{color:red}}</style><link rel="alternate" hreflang="en" href="/en/"><link rel="alternate" hreflang="sv" href="/sv/">';
    const found = probePage(doc, doc.documentElement, isColor, "https://site.test/en/");
    expect(found.languages?.map((l) => l.code)).toEqual(["en", "sv"]);
    // A head whose reads throw: the language read fails, the others do not use it.
    const head = doc.head;
    head.querySelectorAll = () => {
      throw new Error("no");
    };
    const bad = probePage(doc, doc.documentElement, isColor, "https://site.test/en/");
    expect(bad.languages).toEqual([]);
    expect(bad.widths).toEqual([640]);
    expect(bad.dark).toBe(false);
  });
});

describe("probeReply", () => {
  test("reads widths and dark", () => {
    expect(probeReply({ widths: [640, 1.5, "x"], dark: true })).toEqual({
      breakpoints: [640],
      dark: true,
      languages: [],
    });
  });
  test("an older or missing result is no breakpoints and no dark", () => {
    expect(probeReply({ widths: [640] })).toEqual({
      breakpoints: [640],
      dark: false,
      languages: [],
    });
    expect(probeReply(undefined)).toEqual({ breakpoints: [], dark: false, languages: [] });
  });
});
