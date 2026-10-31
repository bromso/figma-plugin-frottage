import type { Capture, CaptureNode } from "../index";

const box = { x: 0, y: 0, w: 100, h: 50 };

const common = {
  box,
  paintOrder: 0,
  visible: true,
  opacity: 1,
  blendMode: "normal",
  semantic: { tag: "div" },
};

const black = { r: 0, g: 0, b: 0, a: 1 };
const none = { r: 0, g: 0, b: 0, a: 0 };
const noBorder = { width: 0, color: none, style: "none" };

export const imageStyle = {
  borderRadius: [0, 0, 0, 0],
  borders: { top: noBorder, right: noBorder, bottom: noBorder, left: noBorder },
};

export function elementNode(id: string, children: CaptureNode[] = []): CaptureNode {
  return {
    ...common,
    id,
    kind: "element",
    style: {
      backgroundColor: none,
      backgroundImages: [],
      borders: {
        top: noBorder,
        right: noBorder,
        bottom: noBorder,
        left: noBorder,
      },
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
  } as CaptureNode;
}

export function textNode(id: string, text = "Hi"): CaptureNode {
  return {
    ...common,
    id,
    kind: "text",
    text,
    lines: [box],
    runs: [
      {
        start: 0,
        end: text.length,
        family: "Inter",
        weight: 400,
        style: "normal",
        size: 16,
        lineHeight: null,
        letterSpacing: 0,
        color: black,
        decoration: "none",
        transform: "none",
        align: "start",
      },
    ],
  } as CaptureNode;
}

export function treeOfThree(): CaptureNode {
  return elementNode("a", [textNode("b"), elementNode("c")]);
}

export function minimalCapture(): Capture {
  return {
    schemaVersion: 1,
    capturedAt: "2026-10-31T00:00:00.000Z",
    tool: { name: "frottage", version: "0.0.0" },
    source: {
      url: "https://example.com/",
      title: "Example",
      viewport: { w: 1280, h: 800 },
      scrollSize: { w: 1280, h: 2000 },
      devicePixelRatio: 2,
      colorScheme: "light",
    },
    tokens: { cssCustomProperties: {} },
    fonts: [],
    assets: [],
    warnings: [],
    root: elementNode("root"),
  };
}
