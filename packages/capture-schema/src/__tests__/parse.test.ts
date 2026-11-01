import { expect, test } from "bun:test";
import { countNodes, parseCapture } from "../index";
import { imageStyle, minimalCapture, treeOfThree } from "./fixtures";

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
