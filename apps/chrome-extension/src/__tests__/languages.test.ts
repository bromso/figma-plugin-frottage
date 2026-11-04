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
    const doc = page(alternates(["en-gb", "en-us"]));
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

describe("languageName", () => {
  test("names a language in its own language", () => {
    expect(languageName("sv")).toBe("Svenska");
    expect(languageName("en")).toBe("English");
  });
  test("returns the code when it has no name", () => {
    expect(languageName("zz-qq")).toBe("zz-qq");
  });
});
