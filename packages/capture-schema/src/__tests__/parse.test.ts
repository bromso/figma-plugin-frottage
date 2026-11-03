import { expect, test } from "bun:test";
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
test("rejects a hover with a bad colour, opacity or shadow", () => {
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
  expect(parseCapture(withRefs({ padding: Array(100_000).fill("--a") }))).toMatchObject({
    ok: false,
    reason: "invalid",
  });
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
