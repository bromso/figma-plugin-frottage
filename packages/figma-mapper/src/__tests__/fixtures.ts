import type { Capture, CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import type { FontRef, PlanOp } from "../plan";

export const inter: FontRef[] = [
  { family: "Inter", style: "Thin" },
  { family: "Inter", style: "Light" },
  { family: "Inter", style: "Regular" },
  { family: "Inter", style: "Semi Bold" },
  { family: "Inter", style: "Bold" },
  { family: "Inter", style: "Bold Italic" },
];

const clear = { r: 0, g: 0, b: 0, a: 0 };
const black = { r: 0, g: 0, b: 0, a: 1 };
const side = { width: 0, color: clear, style: "none" };
export const imageStyle = {
  borderRadius: [0, 0, 0, 0] as [number, number, number, number],
  borders: { top: side, right: side, bottom: side, left: side },
};

export function el(
  id: string,
  at: [number, number],
  children: CaptureNode[] = [],
  over: Partial<ElementNode> = {},
  size: [number, number] = [100, 100]
): ElementNode {
  return {
    id,
    kind: "element",
    box: { x: at[0], y: at[1], w: size[0], h: size[1] },
    paintOrder: 0,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    semantic: { tag: "div" },
    style: {
      backgroundColor: clear,
      backgroundImages: [],
      borders: { top: side, right: side, bottom: side, left: side },
      borderRadius: [0, 0, 0, 0],
      boxShadows: [],
      filters: [],
      overflow: "visible",
    },
    layout: {
      display: "block",
      position: "static",
      padding: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      order: 0,
      grow: 0,
      shrink: 1,
    },
    children,
    ...over,
  };
}

export function run(over: Partial<TextNode["runs"][number]> = {}): TextNode["runs"][number] {
  return {
    start: 0,
    end: 5,
    family: "Inter",
    weight: 400,
    style: "normal",
    size: 16,
    lineHeight: null,
    letterSpacing: 0,
    color: black,
    decoration: "none",
    transform: "none",
    align: "left",
    ...over,
  };
}

export function textNode(id: string, over: Partial<TextNode> = {}): TextNode {
  return {
    id,
    kind: "text",
    box: { x: 0, y: 0, w: 100, h: 20 },
    paintOrder: 0,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    semantic: { tag: "p" },
    text: "Hello",
    lines: [{ x: 0, y: 0, w: 100, h: 20 }],
    runs: [run()],
    ...over,
  };
}

export function cap(root: CaptureNode): Capture {
  return {
    schemaVersion: 1,
    capturedAt: "2026-01-01T00:00:00Z",
    tool: { name: "test", version: "0" },
    source: {
      url: "https://example.com",
      title: "t",
      viewport: { w: 800, h: 600 },
      scrollSize: { w: 800, h: 600 },
      devicePixelRatio: 1,
      colorScheme: "light",
    },
    tokens: { cssCustomProperties: {} },
    fonts: [],
    assets: [],
    warnings: [],
    root,
  };
}

export function nested(pos: { parent: [number, number]; child: [number, number] }): Capture {
  return cap(el("root", [0, 0], [el("parent", pos.parent, [el("child", pos.child)])]));
}

export function deepTree(depth = 5000): Capture {
  let node: ElementNode = el("n0", [0, 0]);
  for (let i = 1; i <= depth; i++) node = el(`n${i}`, [0, 0], [node]);
  return cap(node);
}

export function centredHeading(): Capture {
  return cap(
    el(
      "root",
      [0, 0],
      [
        textNode("h", {
          box: { x: 20, y: 0, w: 760, h: 80 },
          text: "A centred heading that wraps",
          lines: [
            { x: 20, y: 0, w: 700, h: 40 },
            { x: 20, y: 40, w: 300, h: 40 },
          ],
          runs: [run({ end: 28, align: "center" })],
        }),
      ]
    )
  );
}

export function withText(node: TextNode): Capture {
  return cap(el("root", [0, 0], [node]));
}

export function twoRunsSameFont(): Capture {
  return withText(
    textNode("t", {
      text: "Hello world",
      runs: [run({ start: 0, end: 5, color: black }), run({ start: 5, end: 11, size: 20 })],
    })
  );
}

export function usingFont(family: string): Capture {
  return withText(textNode("t", { runs: [run({ family })] }));
}

export function emptyRun(): TextNode {
  return textNode("t", {
    text: "Hello",
    runs: [run({ start: 0, end: 0 }), run({ start: 3, end: 2 }), run({ start: 0, end: 5 })],
  });
}

export const anyOp: PlanOp = {
  op: "placeholder",
  id: "p",
  parent: "root",
  name: "P",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  opacity: 1,
  label: "x",
};
