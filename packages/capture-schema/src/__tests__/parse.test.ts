import { expect, test } from "bun:test";
import { countNodes, parseCapture } from "../index";
import { minimalCapture, treeOfThree } from "./fixtures";

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
