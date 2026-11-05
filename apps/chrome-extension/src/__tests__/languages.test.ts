import { describe, expect, test } from "bun:test";
import { languageName } from "@repo/capture-schema";
import { Window } from "happy-dom";
import { findLanguages } from "../languages";

function page(head: string, body = "") {
  const doc = new Window().document as unknown as Document;
  doc.head.innerHTML = head;
  doc.body.innerHTML = body;
  return doc;
}

describe("findLanguages", () => {
  test("reads hreflang alternates, skipping x-default", () => {
    const doc = page(`
      <link rel="alternate" hreflang="en" href="/en/">
      <link rel="alternate" hreflang="sv" href="/sv/">
      <link rel="alternate" hreflang="x-default" href="/">`);
    expect(findLanguages(doc, "https://site.test/en/")).toEqual([
      { code: "en", name: "English", url: "https://site.test/en/", current: true },
      { code: "sv", name: "Svenska", url: "https://site.test/sv/", current: false },
    ]);
  });
  test("falls back to the html lang for the current one, and puts it first", () => {
    const doc = page(`
      <link rel="alternate" hreflang="en" href="/en/">
      <link rel="alternate" hreflang="sv" href="/sv/">`);
    doc.documentElement.setAttribute("lang", "sv-SE");
    const found = findLanguages(doc, "https://site.test/other");
    expect(found.map((l) => [l.code, l.current])).toEqual([
      ["sv", true],
      ["en", false],
    ]);
  });
  test("finds a language path pattern in the page's links", () => {
    const doc = page("", `<a href="/sv/pricing">Svenska</a><a href="/about">About</a>`);
    const found = findLanguages(doc, "https://site.test/en/pricing");
    expect(found.map((l) => [l.code, l.url, l.current])).toEqual([
      ["en", "https://site.test/en/pricing", true],
      ["sv", "https://site.test/sv/pricing", false],
    ]);
  });
  test("a path segment that names no language isn't one", () => {
    const doc = page("", `<a href="/us/app">US</a>`);
    expect(findLanguages(doc, "https://site.test/js/app")).toEqual([]);
    const mixed = page("", `<a href="/js/pricing">JS</a><a href="/sv/pricing">Svenska</a>`);
    const found = findLanguages(mixed, "https://site.test/en/pricing");
    expect(found.map((l) => l.code)).toEqual(["en", "sv"]);
  });
  test("finds switcher links with hreflang or lang, on the same site only", () => {
    const doc = page(
      "",
      `<a hreflang="de" href="/deutsch">DE</a><a lang="fr" href="/francais">FR</a><a hreflang="es" href="https://other.test/">ES</a>`
    );
    doc.documentElement.setAttribute("lang", "de");
    const found = findLanguages(doc, "https://site.test/");
    expect(found.map((l) => l.code)).toEqual(["de", "fr"]);
  });
  test("a single hreflang is not a language switch", () => {
    const doc = page(`<link rel="alternate" hreflang="en" href="/en/">`);
    expect(findLanguages(doc, "https://site.test/en/")).toEqual([]);
  });
  test("keeps at most 8 languages", () => {
    const codes = ["en", "sv", "de", "fr", "es", "it", "nl", "pt", "da", "fi", "no", "pl"];
    const doc = page(
      codes.map((c) => `<link rel="alternate" hreflang="${c}" href="/${c}/">`).join("")
    );
    expect(findLanguages(doc, "https://site.test/en/")).toHaveLength(8);
  });
});

describe("findLanguages, the current language", () => {
  const alternates = (codes: string[]) =>
    codes.map((c) => `<link rel="alternate" hreflang="${c}" href="/${c}/">`).join("");
  test("a trailing slash and a hash do not tell pages apart, a query does", () => {
    const doc = page(alternates(["en", "sv"]));
    expect(findLanguages(doc, "https://site.test/en#top")[0]).toMatchObject({
      code: "en",
      current: true,
    });
    expect(findLanguages(doc, "https://site.test/sv")[0]).toMatchObject({
      code: "sv",
      current: true,
    });
    expect(findLanguages(doc, "https://site.test/en/?x=1")).toEqual([]);
  });
  test("the html lang matches exactly before by primary subtag", () => {
    const doc = page(alternates(["en-gb", "en-us", "sv"]));
    doc.documentElement.setAttribute("lang", "en-US");
    expect(findLanguages(doc, "https://site.test/x")[0]).toMatchObject({
      code: "en-us",
      current: true,
    });
  });
  test("no way to tell the current language gives none", () => {
    const doc = page("", `<a hreflang="de" href="/de">DE</a><a hreflang="fr" href="/fr">FR</a>`);
    expect(findLanguages(doc, "https://site.test/")).toEqual([]);
  });
});

describe("findLanguages, the page's own language and one per language", () => {
  const alternates = (codes: string[]) =>
    codes.map((c) => `<link rel="alternate" hreflang="${c}" href="/${c}/">`).join("");
  test("adds the page's own language when only the other one is listed", () => {
    const doc = page(alternates(["en-gb"]));
    doc.documentElement.setAttribute("lang", "sv");
    expect(findLanguages(doc, "https://riksbank.test/sv/#top")).toEqual([
      { code: "sv", name: "Svenska", url: "https://riksbank.test/sv/", current: true },
      { code: "en-gb", name: "English", url: "https://riksbank.test/en-gb/", current: false },
    ]);
  });
  test("names a language by its primary subtag and keeps the full code", () => {
    const doc = page(alternates(["en-GB"]));
    doc.documentElement.setAttribute("lang", "sv-SE");
    const found = findLanguages(doc, "https://kth.test/sv/");
    expect(found.map((l) => [l.code, l.name])).toEqual([
      ["sv-se", "Svenska"],
      ["en-gb", "English"],
    ]);
  });
  test("keeps one regional variant per language, preferring the current region", () => {
    const doc = page(alternates(["ar-AE", "ar-BH", "en-AE", "en-SE", "de-DE", "de-AT"]));
    doc.documentElement.setAttribute("lang", "sv-SE");
    const found = findLanguages(doc, "https://apple.test/se/");
    expect(found.map((l) => [l.code, l.name])).toEqual([
      ["sv-se", "Svenska"],
      ["ar-ae", "العربية"],
      ["en-se", "English"],
      ["de-de", "Deutsch"],
    ]);
  });
  test("prefers a variant with no region, else the first", () => {
    const doc = page(alternates(["en-us", "en-au", "fr-ca", "fr"]));
    doc.documentElement.setAttribute("lang", "sv-SE");
    const found = findLanguages(doc, "https://site.test/se/");
    expect(found.map((l) => l.code)).toEqual(["sv-se", "en-us", "fr"]);
  });
  test("two variants of one language on a page of another give one English", () => {
    const doc = page(alternates(["en-us", "en-au"]));
    doc.documentElement.setAttribute("lang", "sv-SE");
    expect(findLanguages(doc, "https://site.test/se/").map((l) => l.code)).toEqual([
      "sv-se",
      "en-us",
    ]);
  });
  test("a page listing itself behaves as before", () => {
    const doc = page(alternates(["en", "sv"]));
    doc.documentElement.setAttribute("lang", "sv");
    expect(findLanguages(doc, "https://site.test/sv/").map((l) => [l.code, l.current])).toEqual([
      ["sv", true],
      ["en", false],
    ]);
  });
  test("without an html lang the page's own language is not guessed", () => {
    expect(findLanguages(page(alternates(["en-gb"])), "https://site.test/sv/")).toEqual([]);
  });
});

describe("languageName", () => {
  test("names a language in its own language", () => {
    expect(languageName("sv")).toBe("Svenska");
    expect(languageName("en")).toBe("English");
  });
  test("returns the code when it has no name", () => {
    expect(languageName("zz-qq")).toBe("zz-qq");
  });
});
