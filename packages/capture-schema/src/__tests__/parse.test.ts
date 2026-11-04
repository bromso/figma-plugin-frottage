import { describe, expect, test } from "bun:test";
import { countNodes, parseCapture } from "../index";
import { elementNode, imageStyle, minimalCapture, textNode, treeOfThree } from "./fixtures";

test("accepts a minimal valid capture", () => {
  expect(parseCapture(minimalCapture()).ok).toBe(true);
});
test("rejects a capture with no root", () => {
  const { root, ...rest } = minimalCapture();
  expect(parseCapture(rest)).toMatchObject({ ok: false, reason: "invalid" });
});
test("reports a newer schema version without validating it", () => {
  expect(parseCapture({ schemaVersion: 2, anything: true })).toMatchObject({
    ok: false,
    reason: "newer-version",
  });
});
test("rejects a non-object", () => {
  expect(parseCapture("nope")).toMatchObject({ ok: false, reason: "invalid" });
});
test("counts nested nodes", () => {
  expect(countNodes(treeOfThree())).toBe(3);
});
test("accepts text, image, svg and placeholder children", () => {
  const c = minimalCapture() as any;
  const t = treeOfThree() as any;
  c.root.children = [
    t.children[0],
    {
      ...t.children[0],
      ...imageStyle,
      id: "i",
      kind: "image",
      fit: "cover",
      objectPosition: "50% 50%",
      assetHash: "abc",
    },
    { ...t.children[0], id: "s", kind: "svg", markup: "<svg/>" },
    {
      ...t.children[0],
      id: "p",
      kind: "placeholder",
      placeholderKind: "canvas",
    },
  ];
  // strip text-only fields from non-text nodes
  for (const n of c.root.children.slice(1)) {
    delete n.text;
    delete n.lines;
    delete n.runs;
  }
  expect(parseCapture(c)).toMatchObject({ ok: true });
});
test("rejects an unknown node kind", () => {
  const c = minimalCapture() as any;
  c.root.children = [{ ...c.root, id: "x", kind: "nope" }];
  expect(parseCapture(c)).toMatchObject({ ok: false, reason: "invalid" });
});

const red = { r: 1, g: 0, b: 0, a: 1 };
const shadow = { inset: false, x: 0, y: 2, blur: 4, spread: 0, color: red };
function withHover(hover: unknown) {
  const c = minimalCapture() as any;
  c.root.hover = hover;
  return c;
}
test("accepts hover differences on an element and keeps them", () => {
  const hover = {
    backgroundColor: red,
    color: red,
    borderColor: red,
    opacity: 0.5,
    boxShadows: [shadow],
    decoration: "underline",
  };
  const result = parseCapture(withHover(hover));
  expect(result.ok && (result.capture.root as any).hover).toEqual(hover);
});
test("rejects a hover with a bad color, opacity or shadow", () => {
  expect(parseCapture(withHover({ backgroundColor: { r: 2, g: 0, b: 0, a: 1 } })).ok).toBe(false);
  expect(parseCapture(withHover({ opacity: 3 })).ok).toBe(false);
  expect(parseCapture(withHover({ boxShadows: [{ ...shadow, x: "no" }] })).ok).toBe(false);
  expect(parseCapture(withHover("hover")).ok).toBe(false);
});
test("bounds the hover shadow list before reading it", () => {
  const many = Array.from({ length: 9 }, () => shadow);
  expect(parseCapture(withHover({ boxShadows: many }))).toMatchObject({
    ok: false,
    reason: "invalid",
  });
  expect(parseCapture(withHover({ boxShadows: many.slice(0, 8) })).ok).toBe(true);
});

test("keeps token refs on an element and a text node", () => {
  const refs = {
    background: "--color-card",
    radius: "--radius-lg",
    padding: ["--spacing*4", null, "--spacing*-0.5", "--spacing*4"] as [
      string,
      null,
      string,
      string,
    ],
    radiusClass: ["2xl", "2xl", null, "DEFAULT"] as [string, string, null, string],
  };
  const text = { ...textNode("t"), tokenRefs: { color: "--foreground" } };
  const c = { ...minimalCapture(), root: { ...elementNode("r", [text]), tokenRefs: refs } };
  const result = parseCapture(c);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.capture.root).toEqual(c.root);
});
test("rejects a token ref that is long, malformed or a padding of the wrong length", () => {
  const withRefs = (tokenRefs: unknown) => ({
    ...minimalCapture(),
    root: { ...minimalCapture().root, tokenRefs },
  });
  expect(parseCapture(withRefs({ color: `--${"a".repeat(79)}` })).ok).toBe(false);
  expect(parseCapture(withRefs({ color: "red" })).ok).toBe(false);
  expect(parseCapture(withRefs({ color: "--a*b" })).ok).toBe(false);
  expect(parseCapture(withRefs({ padding: ["--a", "--a", "--a"] })).ok).toBe(false);
  expect(parseCapture(withRefs({ radiusClass: ["md", "md", "md"] })).ok).toBe(false);
  expect(parseCapture(withRefs({ radiusClass: ["a".repeat(21), null, null, null] })).ok).toBe(
    false
  );
  expect(parseCapture(withRefs({ radiusClass: ["Md", null, null, null] })).ok).toBe(false);
  expect(parseCapture(withRefs({ radiusClass: ["md", null, null, "1.5"] })).ok).toBe(true);
  expect(parseCapture(withRefs({ padding: Array(100_000).fill("--a") }))).toMatchObject({
    ok: false,
    reason: "invalid",
  });
});

test("an image keeps its token refs, and malformed ones are refused", () => {
  const image = (tokenRefs: unknown) => ({
    ...minimalCapture(),
    root: {
      ...elementNode("r"),
      children: [
        {
          id: "i",
          kind: "image",
          box: { x: 0, y: 0, w: 10, h: 10 },
          paintOrder: 0,
          visible: true,
          opacity: 1,
          blendMode: "normal",
          semantic: { tag: "img" },
          ...imageStyle,
          fit: "cover",
          objectPosition: "50% 50%",
          tokenRefs,
        },
      ],
    },
  });
  const refs = { radius: "--radius*2", radiusClass: ["2xl", "2xl", "2xl", "2xl"] };
  const result = parseCapture(image(refs));
  expect(result.ok).toBe(true);
  if (result.ok) {
    const node = (result.capture.root as { children: Array<{ tokenRefs?: unknown }> }).children[0];
    expect(node?.tokenRefs).toEqual(refs);
  }
  expect(parseCapture(image({ radiusClass: ["md", "md", "md"] })).ok).toBe(false);
  expect(parseCapture(image({ radius: "red" })).ok).toBe(false);
});

test("a capture without version still parses", () => {
  const result = parseCapture(minimalCapture());
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.capture.version).toBeUndefined();
});
test("a capture with a version keeps it", () => {
  const result = parseCapture({ ...minimalCapture(), version: { label: "Dark", kind: "theme" } });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.capture.version).toEqual({ label: "Dark", kind: "theme" });
});
test("a label over 40 characters is refused", () => {
  const ok = { label: "x".repeat(40), kind: "language" };
  expect(parseCapture({ ...minimalCapture(), version: ok }).ok).toBe(true);
  const long = { label: "x".repeat(41), kind: "language" };
  expect(parseCapture({ ...minimalCapture(), version: long })).toMatchObject({
    ok: false,
    reason: "invalid",
  });
});
test("an empty label or an unknown kind is refused", () => {
  expect(parseCapture({ ...minimalCapture(), version: { label: "", kind: "theme" } }).ok).toBe(
    false
  );
  expect(parseCapture({ ...minimalCapture(), version: { label: "A", kind: "mood" } }).ok).toBe(
    false
  );
});

const themeOf = (n: number, properties: Record<string, string> = { "--a": "#000" }) => ({
  context: `.t${n}`,
  mode: `T${n}`,
  properties,
});

test("authored tokens and themes parse like the schema does", async () => {
  const { captureSchema } = await import("../index");
  const input = {
    ...minimalCapture(),
    tokens: {
      cssCustomProperties: { "--a": "1px" },
      authored: { "--a": "calc(var(--b) * 2)" },
      themes: [themeOf(1), themeOf(2)],
    },
  };
  const result = parseCapture(input);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.capture).toEqual(captureSchema.parse(input));
});

test("themes: at most 8, and 2,000 properties each", () => {
  const withThemes = (themes: unknown) => ({
    ...minimalCapture(),
    tokens: { cssCustomProperties: {}, themes },
  });
  expect(parseCapture(withThemes(Array.from({ length: 8 }, (_, i) => themeOf(i)))).ok).toBe(true);
  expect(parseCapture(withThemes(Array.from({ length: 9 }, (_, i) => themeOf(i)))).ok).toBe(false);
  const props = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`--p${i}`, "1"]));
  expect(parseCapture(withThemes([themeOf(0, props(2000))])).ok).toBe(true);
  expect(parseCapture(withThemes([themeOf(0, props(2001))])).ok).toBe(false);
  expect(parseCapture(withThemes([themeOf(0, { "--a": 1 as never })])).ok).toBe(false);
});

test("the active theme and the root's base values parse like the schema does", async () => {
  const { captureSchema } = await import("../index");
  const input = {
    ...minimalCapture(),
    tokens: {
      cssCustomProperties: { "--bg": "#000" },
      themes: [{ context: ".dark", mode: "Dark", properties: { "--bg": "#000" } }],
      activeTheme: "Dark",
      base: { "--bg": "#fff" },
    },
  };
  const result = parseCapture(input);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.capture).toEqual(captureSchema.parse(input));
});

test("an active theme over 40 characters, or base values past 2,000, are refused", () => {
  const withTokens = (extra: Record<string, unknown>) => ({
    ...minimalCapture(),
    tokens: { cssCustomProperties: {}, ...extra },
  });
  expect(parseCapture(withTokens({ activeTheme: "x".repeat(40) })).ok).toBe(true);
  expect(parseCapture(withTokens({ activeTheme: "x".repeat(41) })).ok).toBe(false);
  expect(parseCapture(withTokens({ activeTheme: 1 })).ok).toBe(false);
  const props = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`--p${i}`, "1"]));
  expect(parseCapture(withTokens({ base: props(2000) })).ok).toBe(true);
  expect(parseCapture(withTokens({ base: props(2001) })).ok).toBe(false);
  expect(parseCapture(withTokens({ base: { "--a": 1 } })).ok).toBe(false);
});

test("a theme's mode over 40 characters or context over 200 is refused", () => {
  const withTheme = (theme: object) => ({
    ...minimalCapture(),
    tokens: { cssCustomProperties: {}, themes: [{ ...themeOf(1), ...theme }] },
  });
  expect(parseCapture(withTheme({ mode: "m".repeat(40), context: "c".repeat(200) })).ok).toBe(true);
  expect(parseCapture(withTheme({ mode: "m".repeat(41) })).ok).toBe(false);
  expect(parseCapture(withTheme({ context: "c".repeat(201) })).ok).toBe(false);
});

describe("breakpoints and device versions", () => {
  const withBp = (extra: Record<string, unknown>) => ({ ...minimalCapture(), ...extra });
  test("a capture with breakpoints, device and breakpoint parses", () => {
    const input = withBp({
      breakpoints: { widths: [640, 1024], unreadable: 1 },
      version: {
        label: "Tablet",
        kind: "viewport",
        device: { id: "tablet-portrait", name: "Tablet portrait", height: 1194 },
        breakpoint: "md",
      },
    });
    const result = parseCapture(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.capture.breakpoints).toEqual({ widths: [640, 1024], unreadable: 1 });
      expect(result.capture.version?.device?.height).toBe(1194);
      expect(result.capture.version?.breakpoint).toBe("md");
    }
  });
  test("nine widths, a long name or a negative height are refused", () => {
    const nine = Array.from({ length: 9 }, (_, i) => i + 1);
    expect(parseCapture(withBp({ breakpoints: { widths: nine, unreadable: 0 } })).ok).toBe(false);
    expect(parseCapture(withBp({ breakpoints: { widths: [20000], unreadable: 0 } })).ok).toBe(
      false
    );
    const v = (device: unknown) => withBp({ version: { label: "A", kind: "viewport", device } });
    expect(parseCapture(v({ id: "a", name: "x".repeat(41), height: 10 })).ok).toBe(false);
    expect(parseCapture(v({ id: "a", name: "A", height: -1 })).ok).toBe(false);
  });
  test("a version records the width the page was laid out at, a whole positive number", () => {
    const v = (width: unknown) =>
      parseCapture(withBp({ version: { label: "lg", kind: "viewport", breakpoint: "lg", width } }));
    const ok = v(1024);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.capture.version?.width).toBe(1024);
    expect(v(0).ok).toBe(false);
    expect(v(10.5).ok).toBe(false);
    expect(v(200000).ok).toBe(false);
    expect(v("1024").ok).toBe(false);
  });
  test("an older capture without them parses unchanged", () => {
    const result = parseCapture(minimalCapture());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.capture.breakpoints).toBeUndefined();
  });
});

describe("themeChoice", () => {
  const withChoice = (themeChoice: unknown) => parseCapture({ ...minimalCapture(), themeChoice });
  test("a capture records which themes to import", () => {
    const result = withChoice({ light: false, dark: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.capture.themeChoice).toEqual({ light: false, dark: true });
  });
  test("non-booleans or missing fields are refused", () => {
    expect(withChoice({ light: "yes", dark: true }).ok).toBe(false);
    expect(withChoice({ light: true }).ok).toBe(false);
    expect(withChoice(1).ok).toBe(false);
  });
  test("an older capture without it parses unchanged", () => {
    const result = parseCapture(minimalCapture());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.capture.themeChoice).toBeUndefined();
  });
});

describe("language", () => {
  const SV = { code: "sv", name: "Svenska", url: "https://example.com/sv/", current: false };
  const withLanguage = (language: unknown) => parseCapture({ ...minimalCapture(), language });
  test("a capture records the language it was taken in", () => {
    const result = withLanguage(SV);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.capture.language).toEqual(SV);
  });
  test("a long URL, code or name is refused", () => {
    expect(withLanguage({ ...SV, url: `https://example.com/${"a".repeat(3000)}` }).ok).toBe(false);
    expect(withLanguage({ ...SV, code: "x".repeat(21) }).ok).toBe(false);
    expect(withLanguage({ ...SV, name: "x".repeat(41) }).ok).toBe(false);
  });
  test("missing fields or wrong types are refused", () => {
    expect(withLanguage({ ...SV, current: "no" }).ok).toBe(false);
    expect(withLanguage({ code: "sv" }).ok).toBe(false);
    expect(withLanguage("sv").ok).toBe(false);
  });
  test("an older capture without it parses unchanged", () => {
    const result = parseCapture(minimalCapture());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.capture.language).toBeUndefined();
  });
});
