import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { readThemes } from "../themes";

const isColor = (v: string) => /^(#[0-9a-f]{3,8}|rgba?\(.*\)|oklch\(.*\)|red)$/i.test(v);

function themes(css: string, rootClass = "") {
  const win = new Window();
  const doc = win.document as unknown as Document;
  doc.head.innerHTML = `<style>${css}</style>`;
  doc.documentElement.className = rootClass;
  return readThemes(doc, doc.documentElement, isColor);
}

describe("readThemes", () => {
  test("reads a class context", () => {
    expect(themes(".dark{--background:oklch(14.5% 0 0)}")).toEqual([
      { context: ".dark", mode: "Dark", properties: { "--background": "oklch(14.5% 0 0)" } },
    ]);
  });

  test("reads a root attribute context", () => {
    expect(themes(':root[data-theme="dark"]{--bg:#000}')).toEqual([
      { context: ':root[data-theme="dark"]', mode: "Dark", properties: { "--bg": "#000" } },
    ]);
  });

  test("reads a prefers-color-scheme block", () => {
    expect(themes("@media (prefers-color-scheme: dark){:root{--bg:#000}}")).toEqual([
      {
        context: "@media (prefers-color-scheme: dark)",
        mode: "Dark",
        properties: { "--bg": "#000" },
      },
    ]);
  });

  test("names other modes in sentence case", () => {
    const found = themes(".theme-blue{--a:#00f}.light{--a:#fff}");
    expect(found?.map((t) => t.mode)).toEqual(["Theme blue", "Light"]);
  });

  test("ignores a rule that does not target the root", () => {
    expect(themes(".card{--x:1px}")).toBeUndefined();
    expect(themes(".a .dark{--x:1px}")).toBeUndefined();
  });

  test("matches whole words only", () => {
    expect(
      themes(".highlight{--x:#fff}.lightbox{--x:#fff}.modern{--x:#fff}.nightly{--x:#fff}")
    ).toBeUndefined();
    const found = themes(".high-contrast{--x:#fff}.color-scheme-dark{--x:#000}");
    expect(found?.map((t) => t.mode)).toEqual(["High contrast", "Color scheme dark"]);
  });

  test("a :root prefix makes any class a context", () => {
    expect(themes(":root.anything{--x:#fff}")?.[0]?.mode).toBe("Anything");
  });

  test("ignores theme rules under print, width and feature conditions", () => {
    expect(
      themes(
        "@media print{.dark{--x:#fff}}@media (min-width: 800px){.dark{--x:#fff}}@supports not (display:grid){.dark{--x:#fff}}"
      )
    ).toBeUndefined();
  });

  test("ignores a rule the root already matches", () => {
    expect(themes(".dark{--bg:#000}", "dark")).toBeUndefined();
    expect(themes(":root{--bg:#000}")).toBeUndefined();
  });

  test("merges contexts with one mode, later rules winning", () => {
    const found = themes(".dark{--a:#111;--b:#222}[data-theme=dark]{--a:#333}");
    expect(found).toHaveLength(1);
    expect(found?.[0]?.properties).toEqual({ "--a": "#333", "--b": "#222" });
  });

  test("keeps authored text and drops unsafe values", () => {
    const found = themes(
      '.dark{--r:calc(var(--radius) - 2px);--u:url("x.png");--tw-ring:1px;--c:var(--base)}'
    );
    expect(found?.[0]?.properties).toEqual({
      "--r": "calc(var(--radius) - 2px)",
      "--c": "var(--base)",
    });
  });

  test("keeps eight contexts of nine", () => {
    const css = Array.from({ length: 9 }, (_, i) => `.theme-${i}{--a:#00${i}}`).join("");
    expect(themes(css)).toHaveLength(8);
  });

  test("keeps 2,000 properties of a context", () => {
    const body = Array.from({ length: 2100 }, (_, i) => `--p${i}:1px`).join(";");
    const found = themes(`.dark{${body}}`);
    expect(Object.keys(found?.[0]?.properties ?? {})).toHaveLength(2000);
  });
});
