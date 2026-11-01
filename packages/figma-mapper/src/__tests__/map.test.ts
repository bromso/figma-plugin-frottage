import { describe, expect, test } from "bun:test";
import type { CaptureNode, ElementNode } from "@repo/capture-schema";
import {
  batchOps,
  DEFAULT_IMPORT_OPTIONS,
  mapCapture,
  missingFonts,
  type PlanOp,
  type PlanPaint,
} from "../index";
import {
  anyOp,
  cap,
  centredHeading,
  deepTree,
  el,
  emptyRun,
  imageStyle,
  inter,
  nested,
  run,
  textNode,
  twoRunsSameFont,
  usingFont,
  withText,
} from "./fixtures";

type TextPlanOp = Extract<PlanOp, { op: "text" }>;
type FramePlanOp = Extract<PlanOp, { op: "frame" }>;

function textOp(capture: Parameters<typeof mapCapture>[0]): TextPlanOp {
  const o = mapCapture(capture, inter).ops.find((x) => x.op === "text");
  if (o?.op !== "text") throw new Error("no text op");
  return o;
}
const frame = (c: Parameters<typeof mapCapture>[0], id: string) =>
  mapCapture(c, inter).ops.find((o) => o.id === id) as FramePlanOp;

describe("text alignment", () => {
  test.each(["constructor", "__proto__", "toString"])("%s falls back to LEFT", (align) => {
    const op = textOp(withText(textNode("t", { runs: [run({ align })] })));
    expect(op.align).toBe("LEFT");
  });
});

describe("mapCapture", () => {
  test("positions children relative to their parent", () => {
    const { ops } = mapCapture(nested({ parent: [100, 50], child: [130, 90] }), inter);
    expect(ops.find((o) => o.id === "child")).toMatchObject({ x: 30, y: 40 });
  });
  test("lists parents before children", () => {
    const seen = new Set<string | null>([null]);
    for (const op of mapCapture(deepTree(), inter).ops) {
      expect(seen.has(op.parent)).toBe(true);
      seen.add(op.id);
    }
  });
  test("walks 50,000 levels without recursing", () => {
    expect(mapCapture(deepTree(50000), inter).ops).toHaveLength(50001);
  });
  test("centred wrapped text keeps its width and alignment", () => {
    expect(textOp(centredHeading())).toMatchObject({ align: "CENTER", wrap: true, w: 760 });
  });
  test("lineCount comes from the capture's lines", () => {
    expect(textOp(centredHeading()).lineCount).toBe(2);
    expect(textOp(withText(textNode("t", {}))).lineCount).toBe(1);
  });
  test("collects each needed font once", () => {
    expect(mapCapture(twoRunsSameFont(), inter).fonts).toHaveLength(1);
  });
  test("a missing family becomes Inter Regular and is reported", () => {
    const plan = mapCapture(usingFont("Nimbus Sans"), inter);
    expect(plan.report.substitutedFonts).toEqual([{ from: "Nimbus Sans", to: "Inter Regular" }]);
    expect(plan.fonts).toEqual([{ family: "Inter", style: "Regular" }]);
  });
  test("a font override replaces a missing family with the chosen one", () => {
    const available = [...inter, { family: "Roboto", style: "Regular" }];
    const plan = mapCapture(usingFont("Nimbus Sans"), available, DEFAULT_IMPORT_OPTIONS, {
      "Nimbus Sans": "Roboto",
    });
    expect(plan.fonts).toEqual([{ family: "Roboto", style: "Regular" }]);
    expect(plan.report.substitutedFonts).toEqual([{ from: "Nimbus Sans", to: "Roboto Regular" }]);
  });
  test("an override naming a family that is not available falls back as before", () => {
    const plan = mapCapture(usingFont("Nimbus Sans"), inter, DEFAULT_IMPORT_OPTIONS, {
      "Nimbus Sans": "Gone",
    });
    expect(plan.fonts).toEqual([{ family: "Inter", style: "Regular" }]);
  });
  test("missingFonts lists each substituted family with its nearest match", () => {
    const plan = mapCapture(usingFont("Nimbus Sans"), inter);
    expect(missingFonts(plan.report, inter)).toEqual([{ family: "Nimbus Sans", nearest: "Inter" }]);
    expect(missingFonts(mapCapture(usingFont("Inter"), inter).report, inter)).toEqual([]);
  });
  test("a run with no text produces no empty range", () => {
    const runs = textOp(withText(emptyRun())).runs;
    expect(runs).toHaveLength(1);
    expect(runs.every((r) => r.end > r.start)).toBe(true);
  });
  test("run offsets beyond the text are clamped or dropped", () => {
    const t = textNode("t", {
      text: "Hello",
      runs: [run({ start: 3, end: 99 }), run({ start: 50, end: 60 })],
    });
    expect(textOp(withText(t)).runs).toMatchObject([
      { start: 0, end: 3 },
      { start: 3, end: 5 },
    ]);
  });
  test("maps run styling", () => {
    const t = textNode("t", {
      runs: [
        run({
          lineHeight: 24,
          letterSpacing: 1.5,
          decoration: "underline solid rgb(0, 0, 0)",
          transform: "uppercase",
          color: { r: 1, g: 0, b: 0, a: 0.5 },
          size: 18,
        }),
      ],
    });
    expect(textOp(withText(t)).runs[0]).toEqual({
      start: 0,
      end: 5,
      fontName: { family: "Inter", style: "Regular" },
      fontSize: 18,
      lineHeight: 24,
      letterSpacing: 1.5,
      color: { r: 1, g: 0, b: 0 },
      opacity: 0.5,
      decoration: "UNDERLINE",
      textCase: "UPPER",
    });
  });
  test("names are the capitalised tag", () => {
    const { ops } = mapCapture(nested({ parent: [0, 0], child: [0, 0] }), inter);
    expect(ops[0]?.name).toBe("Div");
  });
  test("transparent backgrounds get no fill; colours become solid paints", () => {
    const c = cap(
      el(
        "root",
        [0, 0],
        [
          el("a", [0, 0]),
          el("b", [0, 0], [], {
            style: {
              ...el("x", [0, 0]).style,
              backgroundColor: { r: 1, g: 0, b: 0, a: 0.5 },
            },
          }),
        ]
      )
    );
    expect(frame(c, "a").fills).toEqual([]);
    expect(frame(c, "b").fills).toEqual([
      { type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 0.5 },
    ]);
  });
  test("image backgrounds become image paints, reversed, and are collected", () => {
    const base = el("x", [0, 0]).style;
    const c = cap(
      el("root", [0, 0], [], {
        style: {
          ...base,
          backgroundColor: { r: 0, g: 0, b: 1, a: 1 },
          backgroundImages: [
            { type: "image", css: "", assetHash: "h1", size: "cover" },
            { type: "image", css: "", assetHash: "h2", size: "contain" },
            { type: "linear-gradient", css: "" },
          ],
        },
      })
    );
    const plan = mapCapture(c, inter);
    expect((plan.ops[0] as FramePlanOp).fills.map((f) => f.type)).toEqual([
      "SOLID",
      "IMAGE",
      "IMAGE",
    ]);
    expect((plan.ops[0] as FramePlanOp).fills[1]).toEqual({
      type: "IMAGE",
      hash: "h2",
      fit: "FIT",
    });
    expect([...plan.assetHashes].sort()).toEqual(["h1", "h2"]);
  });
  test("per-side strokes, radii, opacity, shadows and clipping", () => {
    const base = el("x", [0, 0]).style;
    const red = { r: 1, g: 0, b: 0, a: 1 };
    const none = { width: 0, color: red, style: "none" };
    const c = cap(
      el("root", [0, 0], [], {
        opacity: 0.4,
        style: {
          ...base,
          overflow: "hidden",
          borderRadius: [1, 2, 3, 4],
          borders: {
            top: { width: 2, color: red, style: "solid" },
            right: none,
            bottom: { width: 4, color: red, style: "solid" },
            left: none,
          },
          boxShadows: [
            { inset: false, x: 1, y: 2, blur: 3, spread: 4, color: { r: 0, g: 0, b: 0, a: 0.25 } },
            { inset: true, x: 0, y: 0, blur: 5, spread: 0, color: red },
          ],
        },
      })
    );
    expect(frame(c, "root")).toMatchObject({
      opacity: 0.4,
      clips: true,
      radius: [1, 2, 3, 4],
      strokes: {
        color: { r: 1, g: 0, b: 0 },
        opacity: 1,
        weights: { top: 2, right: 0, bottom: 4, left: 0 },
      },
      effects: [
        {
          type: "DROP_SHADOW",
          offset: { x: 1, y: 2 },
          radius: 3,
          spread: 4,
          color: { r: 0, g: 0, b: 0, a: 0.25 },
        },
        { type: "INNER_SHADOW", radius: 5 },
      ],
    });
  });
  test("no borders means no stroke", () => {
    expect(frame(nested({ parent: [0, 0], child: [0, 0] }), "root").strokes).toBeNull();
  });
  test("images, placeholders and svg", () => {
    const common = el("x", [0, 0]);
    const base = {
      box: common.box,
      paintOrder: 0,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      semantic: { tag: "img" },
    };
    const c = cap(
      el(
        "root",
        [0, 0],
        [
          {
            ...base,
            ...imageStyle,
            id: "i",
            kind: "image",
            assetHash: "hh",
            fit: "cover",
            objectPosition: "",
          },
          {
            ...base,
            ...imageStyle,
            id: "i2",
            kind: "image",
            fit: "none",
            objectPosition: "",
            sourceUrl: "u",
          },
          { ...base, id: "p", kind: "placeholder", placeholderKind: "video" },
          { ...base, id: "s", kind: "svg", markup: "<svg/>" },
          { ...base, id: "gone", kind: "svg", markup: "", visible: false },
        ]
      )
    );
    const plan = mapCapture(c, inter);
    expect(plan.ops.find((o) => o.id === "i")).toMatchObject({
      op: "image",
      hash: "hh",
      fit: "FILL",
    });
    expect(plan.ops.find((o) => o.id === "i2")?.op).toBe("placeholder");
    expect(plan.ops.find((o) => o.id === "p")?.op).toBe("placeholder");
    expect(plan.ops.find((o) => o.id === "s")?.op).toBe("svg");
    expect(plan.ops.find((o) => o.id === "gone")).toBeUndefined();
    expect(plan.assetHashes).toEqual(["hh"]);
    expect(plan.report).toMatchObject({ nodes: 5, texts: 0, images: 1, placeholders: 2 });
  });
  describe("svg", () => {
    const svgBase = {
      box: { x: 10, y: 20, w: 24, h: 24 },
      paintOrder: 0,
      visible: true,
      opacity: 0.5,
      blendMode: "normal",
      semantic: { tag: "svg" },
    };
    const withSvg = (markup: string, over: object = {}) =>
      cap(el("root", [0, 0], [{ ...svgBase, id: "s", kind: "svg", markup, ...over }]));
    test("svg nodes become svg ops", () => {
      expect(mapCapture(withSvg("<svg/>"), inter).ops.find((o) => o.op === "svg")).toMatchObject({
        op: "svg",
        id: "s",
        parent: "root",
        name: "Icon",
        x: 10,
        y: 20,
        w: 24,
        h: 24,
        markup: "<svg/>",
        opacity: 0.5,
      });
    });
    test("clips follows the captured overflow and defaults to clipping", () => {
      const clips = (over: object) =>
        (
          mapCapture(withSvg("<svg/>", over), inter).ops.find((o) => o.id === "s") as {
            clips?: boolean;
          }
        ).clips;
      expect(clips({})).toBe(true);
      expect(clips({ overflow: "hidden" })).toBe(true);
      expect(clips({ overflow: "visible" })).toBe(false);
      expect(clips({ overflow: "visible hidden" })).toBe(true);
    });
    test("an svg with no markup stays a placeholder", () => {
      const op = mapCapture(withSvg(""), inter).ops.find((o) => o.id === "s");
      expect(op).toMatchObject({ op: "placeholder", label: "SVG" });
    });
    test("an svg is placed relative to its parent and listed after it", () => {
      const c = cap(
        el(
          "root",
          [5, 5],
          [
            el(
              "box",
              [15, 25],
              [
                {
                  ...svgBase,
                  id: "s",
                  kind: "svg",
                  markup: "<svg/>",
                  box: { x: 30, y: 40, w: 8, h: 8 },
                },
              ]
            ),
          ]
        )
      );
      const { ops } = mapCapture(c, inter);
      expect(ops.map((o) => o.id)).toEqual(["root", "box", "s"]);
      expect(ops[2]).toMatchObject({ op: "svg", parent: "box", x: 15, y: 15, w: 8, h: 8 });
    });
    test("an invisible svg is skipped", () => {
      expect(mapCapture(withSvg("<svg/>", { visible: false }), inter).ops.map((o) => o.id)).toEqual(
        ["root"]
      );
    });
  });
  test("images keep opacity, radius and border; placeholders keep opacity", () => {
    const red = { r: 1, g: 0, b: 0, a: 1 };
    const side = { width: 4, color: red, style: "solid" };
    const base = {
      box: { x: 0, y: 0, w: 10, h: 10 },
      paintOrder: 0,
      visible: true,
      blendMode: "normal",
      semantic: { tag: "img" },
      fit: "cover" as const,
      objectPosition: "",
      kind: "image" as const,
    };
    const c = cap(
      el(
        "root",
        [0, 0],
        [
          {
            ...base,
            id: "round",
            opacity: 0.5,
            assetHash: "h",
            borderRadius: [5, 6, 7, 8],
            borders: { top: side, right: side, bottom: side, left: side },
          },
          { ...base, ...imageStyle, id: "ghost", opacity: 0, assetHash: "h" },
          { ...base, ...imageStyle, id: "blocked", opacity: 0.25 },
          {
            ...base,
            kind: "placeholder",
            placeholderKind: "canvas",
            id: "canvas",
            opacity: 0.75,
          } as never,
        ]
      )
    );
    const ops = mapCapture(c, inter).ops;
    expect(ops.find((o) => o.id === "round")).toMatchObject({
      op: "image",
      opacity: 0.5,
      radius: [5, 6, 7, 8],
      strokes: {
        color: { r: 1, g: 0, b: 0 },
        opacity: 1,
        weights: { top: 4, right: 4, bottom: 4, left: 4 },
      },
    });
    expect(ops.find((o) => o.id === "ghost")).toMatchObject({
      op: "image",
      opacity: 0,
      strokes: null,
    });
    expect(ops.find((o) => o.id === "blocked")).toMatchObject({ op: "placeholder", opacity: 0.25 });
    expect(ops.find((o) => o.id === "canvas")).toMatchObject({ op: "placeholder", opacity: 0.75 });
  });
  test("image fit mapping", () => {
    const common = el("x", [0, 0]);
    const mk = (id: string, fit: "cover" | "contain" | "fill" | "none" | "tile") => ({
      id,
      kind: "image" as const,
      ...imageStyle,
      box: common.box,
      paintOrder: 0,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      semantic: { tag: "img" },
      assetHash: "h",
      fit,
      objectPosition: "",
    });
    const plan = mapCapture(
      cap(
        el(
          "root",
          [0, 0],
          [mk("a", "cover"), mk("b", "contain"), mk("c", "fill"), mk("d", "none"), mk("e", "tile")]
        )
      ),
      inter
    );
    expect(plan.ops.slice(1).map((o) => (o as { fit: string }).fit)).toEqual([
      "FILL",
      "FIT",
      "FILL",
      "CROP",
      "TILE",
    ]);
  });
  test.each([
    ["cover", "repeat", "FILL"],
    ["cover", "no-repeat", "FILL"],
    ["contain", "repeat", "FIT"],
    ["contain", "no-repeat", "FIT"],
    ["auto", "repeat", "TILE"],
    ["auto", "no-repeat", "FILL"],
  ])("background size %s with %s maps to %s", (size, repeat, fit) => {
    const style = {
      ...el("x", [0, 0]).style,
      backgroundImages: [{ type: "image" as const, css: "", assetHash: "h", size, repeat }],
    };
    const c = cap(el("root", [0, 0], [], { style }));
    expect(frame(c, "root").fills[0]).toEqual({ type: "IMAGE", hash: "h", fit: fit as "FILL" });
  });
  test("line height moves text up by half the leading, or down when tighter", () => {
    const at = (lineHeight: number | null, h = 18) =>
      textOp(
        withText(
          textNode("t", {
            box: { x: 0, y: 100, w: 100, h },
            lines: [{ x: 0, y: 100, w: 100, h }],
            runs: [run({ lineHeight })],
          })
        )
      ).y;
    expect(at(24)).toBe(97);
    expect(at(null)).toBe(100);
    expect(at(12)).toBe(103);
  });
  test("a text op's box is its line box, which is what auto layout stacks", () => {
    const op = textOp(
      withText(
        textNode("t", {
          box: { x: 0, y: 100, w: 100, h: 18 },
          lines: [{ x: 0, y: 100, w: 100, h: 18 }],
          runs: [run({ lineHeight: 24 })],
        })
      )
    );
    expect(op).toMatchObject({ y: 97, h: 24 });
  });
  test("frames count the direct child ops the applier will receive", () => {
    const empty = textNode("gone", { text: "", runs: [] });
    const c = cap(
      el(
        "root",
        [0, 0],
        [el("a", [0, 0], [textNode("t", {}), empty, el("b", [0, 0])]), el("c", [0, 0])]
      )
    );
    const { ops } = mapCapture(c, inter);
    const count = (id: string) => (ops.find((o) => o.id === id) as FramePlanOp).childCount;
    expect(count("root")).toBe(ops.filter((o) => o.parent === "root").length);
    expect(count("root")).toBe(2);
    expect(count("a")).toBe(2);
    expect(count("b")).toBe(0);
  });
  test("text with no line boxes keeps its y", () => {
    const op = textOp(
      withText(
        textNode("t", {
          box: { x: 0, y: 7, w: 9, h: 9 },
          lines: [],
          runs: [run({ lineHeight: 24 })],
        })
      )
    );
    expect(op.y).toBe(7);
  });
  test("counts downscaled images", () => {
    const asset = { hash: "h", mime: "image/png", width: 1, height: 1, sourceUrl: "u" };
    const c = cap(el("root", [0, 0]));
    expect(mapCapture(c, inter).report.downscaledImages).toBe(0);
    c.assets = [asset, { ...asset, downscaledFrom: { w: 9, h: 9 } }];
    expect(mapCapture(c, inter).report.downscaledImages).toBe(1);
  });
  test("carries the capture's warnings", () => {
    const c = cap(el("root", [0, 0]));
    c.warnings = [{ code: "w", detail: "careful" }];
    expect(mapCapture(c, inter).report.warnings).toEqual(["careful"]);
  });
  test("output survives a JSON round trip", () => {
    const plan = mapCapture(centredHeading(), inter);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});

describe("run coverage and visibility", () => {
  const covers = (runs: { start: number; end: number }[], len: number) => {
    let at = 0;
    for (const r of runs) {
      expect(r.start).toBe(at);
      at = r.end;
    }
    expect(at).toBe(len);
  };
  test("runs: [] gets a full-range Inter Regular run, listed in fonts", () => {
    const plan = mapCapture(withText(textNode("t", { runs: [] })), inter);
    const t = plan.ops.find((o) => o.op === "text") as TextPlanOp;
    covers(t.runs, 5);
    expect(t.runs[0]?.fontName).toEqual({ family: "Inter", style: "Regular" });
    expect(plan.fonts).toContainEqual({ family: "Inter", style: "Regular" });
  });
  test("partial coverage is filled, overlaps trimmed", () => {
    const t = textNode("t", {
      text: "0123456789",
      runs: [
        run({ start: 6, end: 8, family: "Inter", weight: 700 }),
        run({ start: 2, end: 4 }),
        run({ start: 3, end: 5 }),
      ],
    });
    const plan = mapCapture(withText(t), inter);
    const op = plan.ops.find((o) => o.op === "text") as TextPlanOp;
    covers(op.runs, 10);
    expect(op.runs.map((r) => [r.start, r.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
      [5, 6],
      [6, 8],
      [8, 10],
    ]);
    expect(plan.fonts).toContainEqual({ family: "Inter", style: "Regular" });
  });
  test("with no Inter available the first font is used and reported", () => {
    const avail = [{ family: "Roboto", style: "Light" }];
    const plan = mapCapture(withText(textNode("t", { runs: [] })), avail);
    const t = plan.ops.find((o) => o.op === "text") as TextPlanOp;
    expect(t.runs[0]?.fontName).toEqual(avail[0]);
    expect(plan.fonts).toEqual(avail);
    expect(plan.report.substitutedFonts).toEqual([{ from: "Inter", to: "Roboto Light" }]);
  });
  test("an invisible parent with a visible child becomes an unpainted frame", () => {
    const hiddenStyle = {
      ...el("x", [0, 0]).style,
      backgroundColor: { r: 1, g: 0, b: 0, a: 1 },
    };
    const c = cap(
      el(
        "root",
        [0, 0],
        [
          el("hid", [10, 10], [el("kid", [15, 25])], { visible: false, style: hiddenStyle }),
          el("leaf", [0, 0], [], { visible: false }),
          textNode("txt", { visible: false }),
        ]
      )
    );
    const plan = mapCapture(c, inter);
    expect(plan.ops.map((o) => o.id)).toEqual(["root", "hid", "kid"]);
    expect(plan.ops[1]).toMatchObject({ fills: [], strokes: null, effects: [] });
    expect(plan.ops[2]).toMatchObject({ x: 5, y: 15 });
  });
  test("align comes from the longest run, first on ties", () => {
    const t = textNode("t", {
      text: "abcdefgh",
      runs: [run({ start: 0, end: 2, align: "left" }), run({ start: 2, end: 8, align: "right" })],
    });
    expect(textOp(withText(t)).align).toBe("RIGHT");
    const tie = textNode("t", {
      text: "abcd",
      runs: [run({ start: 0, end: 2, align: "center" }), run({ start: 2, end: 4, align: "right" })],
    });
    expect(textOp(withText(tie)).align).toBe("CENTER");
  });
});

describe("batchOps", () => {
  test("batches hold 50 ops", () => {
    expect(batchOps(new Array(120).fill(anyOp)).map((b) => b.length)).toEqual([50, 50, 20]);
  });
  test("custom size, and bad sizes fall back", () => {
    expect(batchOps(new Array(5).fill(anyOp), 2).map((b) => b.length)).toEqual([2, 2, 1]);
    expect(batchOps(new Array(3).fill(anyOp), 0).map((b) => b.length)).toEqual([3]);
  });
});

describe("mapCapture options", () => {
  const tree = () =>
    cap(
      el(
        "root",
        [0, 0],
        [
          el(
            "row",
            [0, 0],
            [el("a", [0, 0], [], {}, [40, 20]), el("b", [50, 0], [], {}, [40, 20])],
            { layout: { ...el("x", [0, 0]).layout, display: "flex" } },
            [100, 20]
          ),
        ]
      )
    );
  test("autoLayout on infers layout, off gives NONE for every frame", () => {
    const on = mapCapture(tree(), inter).ops.filter((o) => o.op === "frame");
    expect(on.some((o) => o.layout.mode !== "NONE")).toBe(true);
    const off = mapCapture(tree(), inter, {
      ...DEFAULT_IMPORT_OPTIONS,
      autoLayout: false,
    }).ops.filter((o) => o.op === "frame");
    expect(off.length).toBe(on.length);
    for (const o of off) expect(o.layout).toEqual({ mode: "NONE" });
    for (const o of mapCapture(tree(), inter, { ...DEFAULT_IMPORT_OPTIONS, autoLayout: false })
      .ops) {
      expect(o.childLayout).toBeUndefined();
    }
  });
  test("htmlNames switches every frame to tag names", () => {
    const names = mapCapture(tree(), inter, { ...DEFAULT_IMPORT_OPTIONS, htmlNames: true })
      .ops.filter((o) => o.op === "frame")
      .map((o) => o.name);
    expect(names.every((n) => n === "div")).toBe(true);
  });
});

describe("hyperlinks", () => {
  const linked = (hrefs: (string | undefined)[], text = "abcdefghij") =>
    withText(
      textNode("t", {
        text,
        runs: hrefs.map((href, i) =>
          run({ start: i * 3, end: Math.min(i * 3 + 3, text.length), ...(href ? { href } : {}) })
        ),
      })
    );
  const hrefs = (c: Parameters<typeof mapCapture>[0], opts = DEFAULT_IMPORT_OPTIONS) => {
    const o = mapCapture(c, inter, opts).ops.find((x) => x.op === "text") as TextPlanOp;
    return o.runs.map((r) => [r.start, r.end, r.href]);
  };
  test("a link covering part of a text block links only that range", () => {
    expect(hrefs(linked([undefined, "https://example.com/a", undefined, undefined]))).toEqual([
      [0, 3, undefined],
      [3, 6, "https://example.com/a"],
      [6, 9, undefined],
      [9, 10, undefined],
    ]);
  });
  test("a block link applies to every run of its text", () => {
    const u = "https://example.com/b";
    expect(hrefs(linked([u, u, u, u])).every((r) => r[2] === u)).toBe(true);
  });
  test("javascript, mailto, tel, data, fragment and empty links are not set", () => {
    const bad = ["javascript:alert(1)", "mailto:a@b.co", "tel:1", "data:text/html,x", "#top", ""];
    for (const b of bad) {
      expect(hrefs(linked([b, "https://example.com/ok"], "abcdef")).map((r) => r[2])).toEqual([
        undefined,
        "https://example.com/ok",
      ]);
    }
  });
  test("http and https are kept", () => {
    expect(
      hrefs(linked(["http://a.test/x", "https://a.test/y"], "abcdef")).map((r) => r[2])
    ).toEqual(["http://a.test/x", "https://a.test/y"]);
  });
  test("hyperlinks off puts no href on any run", () => {
    const plan = mapCapture(linked(["https://example.com/a"], "abc"), inter, {
      ...DEFAULT_IMPORT_OPTIONS,
      hyperlinks: false,
    });
    expect(JSON.stringify(plan)).not.toContain("href");
  });
  test("a link on a non-text element does not reach the plan", () => {
    const c = cap(
      el("root", [0, 0], [el("x", [0, 0], [], { semantic: { tag: "a", href: "https://e.test/" } })])
    );
    expect(JSON.stringify(mapCapture(c, inter))).not.toContain("e.test");
  });
});

describe("stacking order", () => {
  const abs = (z?: number) => ({
    layout: { ...el("x", [0, 0]).layout, position: "absolute" },
    ...(z === undefined ? {} : { zIndex: z }),
  });
  const kids = (children: ReturnType<typeof el>[], parent: Partial<ReturnType<typeof el>> = {}) =>
    mapCapture(cap(el("root", [0, 0], [el("p", [0, 0], children, parent, [200, 200])])), inter)
      .ops.filter((o) => o.parent === "p")
      .map((o) => o.id);

  test("a positioned sibling with z-index paints above a later one", () => {
    const order = kids([
      el("hi", [0, 0], [], abs(2), [50, 50]),
      el("lo", [10, 10], [], abs(1), [50, 50]),
    ]);
    expect(order).toEqual(["lo", "hi"]);
  });
  test("negative z-index goes under flow content", () => {
    const order = kids([
      el("flow", [0, 0], [], {}, [50, 50]),
      el("under", [0, 0], [], abs(-1), [50, 50]),
      el("over", [0, 0], [], abs(), [50, 50]),
      el("top", [0, 0], [], abs(5), [50, 50]),
    ]);
    expect(order).toEqual(["under", "flow", "over", "top"]);
  });
  test("flow children keep their relative order in an auto layout parent", () => {
    const row = {
      layout: { ...el("x", [0, 0]).layout, display: "flex", flexDirection: "row" },
    };
    const rel = { layout: { ...el("x", [0, 0]).layout, position: "relative" }, zIndex: 3 };
    const order = kids(
      [
        el("a", [0, 0], [], rel, [40, 40]),
        el("badge", [0, 0], [], abs(-1), [10, 10]),
        el("b", [40, 0], [], { paintOrder: 1 }, [40, 40]),
      ],
      row
    );
    expect(order.filter((id) => id !== "badge")).toEqual(["a", "b"]);
    expect(order[0]).toBe("badge");
  });

  describe("under auto layout", () => {
    /** One frame of 200 by 100 holding `children`, with the mode the plan gave it. */
    const stacked = (children: ReturnType<typeof el>[], parent = {}) => {
      const root = el("root", [0, 0], [el("p", [0, 0], children, parent, [200, 100])]);
      const { ops } = mapCapture(cap(root), inter);
      const frame = ops.find((o) => o.id === "p") as FramePlanOp;
      return {
        mode: frame.layout.mode,
        order: ops.filter((o) => o.parent === "p").map((o) => o.id),
      };
    };
    const rel = (over = {}) => ({
      layout: { ...el("x", [0, 0]).layout, position: "relative" },
      ...over,
    });
    const content = (over = {}) => el("content", [0, 0], [], over, [200, 100]);
    const backdrop = (z?: number) => el("backdrop", [0, 0], [], abs(z), [200, 100]);

    test("content that is positioned stays over an absolute backdrop before it", () => {
      expect(stacked([backdrop(), content(rel())])).toEqual({
        mode: "VERTICAL",
        order: ["backdrop", "content"],
      });
    });
    test("content with a z-index stays over the backdrop", () => {
      expect(stacked([backdrop(), content(rel({ zIndex: 1 }))]).order).toEqual([
        "backdrop",
        "content",
      ]);
    });
    test("a transform, opacity or filter puts content on the same level", () => {
      const transform: ElementNode["transform"] = [1, 0, 0, 1, 2, 0];
      const filtered = { style: { ...el("x", [0, 0]).style, filters: ["brightness(1.2)"] } };
      for (const over of [{ transform }, { opacity: 0.9 }, filtered]) {
        const { mode, order } = stacked([backdrop(), content(over)]);
        expect(mode).toBe("VERTICAL");
        expect(order).toEqual(["backdrop", "content"]);
      }
    });
    test("under auto layout the backdrop goes before the content, whatever comes after", () => {
      const footer = el("footer", [0, 60], [], {}, [200, 40]);
      for (const over of [rel(), { opacity: 0.9 }]) {
        const hero = el("content", [0, 0], [], over, [200, 60]);
        const { mode, order } = stacked([backdrop(), hero, footer]);
        expect(mode).toBe("VERTICAL");
        expect(order).toEqual(["backdrop", "content", "footer"]);
      }
    });
    test("absolutes keep their stacked order, each before the first flow item above it", () => {
      const hero = el("content", [0, 0], [], rel(), [200, 60]);
      const footer = el("footer", [0, 60], [], {}, [200, 40]);
      const { order } = stacked([
        el("top", [0, 0], [], abs(3), [10, 10]),
        backdrop(),
        el("under", [0, 0], [], abs(-1), [10, 10]),
        hero,
        footer,
      ]);
      expect(order).toEqual(["under", "backdrop", "content", "footer", "top"]);
    });
    test("a static child still goes under an absolute one, as CSS paints it", () => {
      expect(stacked([backdrop(), content()]).order).toEqual(["content", "backdrop"]);
    });
    test("content through a collapsed wrapper keeps its level", () => {
      const inner = el("inner", [0, 0], [], rel(), [200, 100]);
      const wrapper = el("content", [0, 0], [inner], {}, [200, 100]);
      expect(stacked([backdrop(), wrapper]).order).toEqual(["backdrop", "inner"]);
    });
    test("a negative z-index goes under the flow", () => {
      expect(stacked([content(rel()), backdrop(-1)]).order).toEqual(["backdrop", "content"]);
    });
    test("flow slots keep CSS order while an absolute keeps its paint slot", () => {
      const row = {
        layout: { ...el("x", [0, 0]).layout, display: "flex", flexDirection: "row" },
      };
      const { mode, order } = stacked(
        [
          el("a", [0, 0], [], {}, [100, 100]),
          el("mid", [0, 0], [], abs(), [100, 100]),
          el("b", [100, 0], [], rel(), [100, 100]),
        ],
        row
      );
      expect(mode).toBe("HORIZONTAL");
      expect(order).toEqual(["a", "mid", "b"]);
    });
    test("an item painted before its flow neighbour does not leave its flow slot", () => {
      const row = {
        layout: { ...el("x", [0, 0]).layout, display: "flex", flexDirection: "row" },
      };
      const { order } = stacked(
        [
          el("a", [0, 0], [], rel({ zIndex: 2 }), [100, 100]),
          el("b", [100, 0], [], {}, [100, 100]),
        ],
        row
      );
      expect(order).toEqual(["a", "b"]);
    });
    test("members of one level stay in tree order", () => {
      const { order } = stacked([
        el("one", [0, 0], [], abs(), [10, 10]),
        el("flow", [0, 0], [], rel(), [200, 100]),
        el("two", [0, 0], [], abs(), [10, 10]),
        el("three", [0, 0], [], abs(0), [10, 10]),
      ]);
      expect(order).toEqual(["one", "flow", "two", "three"]);
    });
  });

  test("a relative z-auto child goes over a static later sibling in a frame with no layout", () => {
    const rel = { layout: { ...el("x", [0, 0]).layout, position: "relative" } };
    const order = kids([
      el("over", [0, 0], [], rel, [50, 50]),
      el("under", [20, 20], [], {}, [50, 50]),
    ]);
    expect(order).toEqual(["under", "over"]);
  });
  test("a frame with no layout counts a transform as the z-0 level", () => {
    const transform: ElementNode["transform"] = [1, 0, 0, 1, 2, 0];
    const order = kids([
      el("over", [0, 0], [], { transform }, [50, 50]),
      el("under", [20, 20], [], {}, [50, 50]),
    ]);
    expect(order).toEqual(["under", "over"]);
  });
});

describe("gradients", () => {
  type Grad = Extract<PlanPaint, { transform: unknown }>;
  const red = { r: 1, g: 0, b: 0, a: 1 };
  const blue = { r: 0, g: 0, b: 1, a: 0.5 };
  const stops = [
    { color: red, position: 0 },
    { color: blue, position: 1 },
  ];
  function planWith(
    backgroundImages: ElementNode["style"]["backgroundImages"],
    size: [number, number] = [100, 100],
    backgroundColor = { r: 0, g: 0, b: 0, a: 0 }
  ) {
    const base = el("x", [0, 0]).style;
    const c = cap(
      el("root", [0, 0], [], { style: { ...base, backgroundColor, backgroundImages } }, size)
    );
    const plan = mapCapture(c, inter);
    return { fills: (plan.ops[0] as FramePlanOp).fills, plan };
  }
  const linear = (angle: number, css = "linear-gradient()") => ({
    type: "linear-gradient" as const,
    css,
    angle,
    stops,
  });
  // The t a point has along the gradient, from the first row of the transform.
  const t = (g: Grad, x: number, y: number) =>
    g.transform[0][0] * x + g.transform[0][1] * y + g.transform[0][2];

  test("to right on any box is the identity row", () => {
    for (const size of [
      [100, 100],
      [200, 50],
    ] as [number, number][]) {
      const g = planWith([linear(90)], size).fills[0] as Grad;
      expect(g.type).toBe("GRADIENT_LINEAR");
      const want = [
        [1, 0, 0],
        [0, 1, 0],
      ];
      for (const [i, row] of g.transform.entries()) {
        for (const [j, v] of row.entries()) {
          expect(Math.abs(v - (want[i]?.[j] ?? 0))).toBeLessThan(1e-9);
        }
      }
    }
  });
  test("to bottom", () => {
    const g = planWith([linear(180)], [80, 120]).fills[0] as Grad;
    expect(g.transform[0][0]).toBeCloseTo(0, 9);
    expect(g.transform[0][1]).toBeCloseTo(1, 9);
    expect(g.transform[0][2]).toBeCloseTo(0, 9);
  });
  test("45deg on a 200 by 100 box reaches the corners", () => {
    const g = planWith([linear(45)], [200, 100]).fills[0] as Grad;
    expect(t(g, 0, 1)).toBeCloseTo(0, 6);
    expect(t(g, 1, 0)).toBeCloseTo(1, 6);
  });
  test("stops carry their colour, alpha and position", () => {
    const g = planWith([linear(90)]).fills[0] as Grad;
    expect(g.stops).toEqual(stops);
  });
  test("radial farthest-corner is centred", () => {
    const { fills, plan } = planWith([
      { type: "radial-gradient", css: "radial-gradient(rgb(255, 0, 0), rgb(0, 0, 255))", stops },
    ]);
    const s = 1 / Math.SQRT2;
    expect(fills[0]).toMatchObject({ type: "GRADIENT_RADIAL" });
    const g = fills[0] as Grad;
    expect(g.transform[0][0]).toBeCloseTo(s, 9);
    expect(g.transform[1][2]).toBeCloseTo(0.5 - s / 2, 9);
    expect(plan.report.warnings).toEqual([]);
  });
  test("a radial with another position is drawn centred and reported", () => {
    const { fills, plan } = planWith([
      {
        type: "radial-gradient",
        css: "radial-gradient(circle at 10% 20%, rgb(255, 0, 0), rgb(0, 0, 255))",
        stops,
      },
    ]);
    expect(fills[0]).toMatchObject({ type: "GRADIENT_RADIAL" });
    expect(plan.report.warnings.join(" ")).toMatch(/approximate/i);
  });
  test("conic becomes angular and the angle rotates it about the centre", () => {
    const zero = planWith([{ type: "conic-gradient", css: "conic-gradient()", stops }])
      .fills[0] as Grad;
    expect(zero.type).toBe("GRADIENT_ANGULAR");
    expect(zero.transform[0][0]).toBeCloseTo(1, 9);
    const quarter = planWith([
      { type: "conic-gradient", css: "conic-gradient()", angle: 90, stops },
    ]).fills[0] as Grad;
    expect(quarter.transform[0][0]).toBeCloseTo(0, 9);
    // The centre stays put.
    const [r0, r1] = quarter.transform;
    expect(r0[0] * 0.5 + r0[1] * 0.5 + r0[2]).toBeCloseTo(0.5, 9);
    expect(r1[0] * 0.5 + r1[1] * 0.5 + r1[2]).toBeCloseTo(0.5, 9);
  });
  test("layers stay in order with images and colour", () => {
    const { fills } = planWith(
      [
        linear(90, "top"),
        { type: "image", css: "", assetHash: "h1" },
        { type: "radial-gradient", css: "radial-gradient()", stops },
      ],
      [100, 100],
      { r: 0, g: 0, b: 1, a: 1 }
    );
    // CSS lists the top layer first; Figma lists it last.
    expect(fills.map((f) => f.type)).toEqual([
      "SOLID",
      "GRADIENT_RADIAL",
      "IMAGE",
      "GRADIENT_LINEAR",
    ]);
  });
  test("repeating gradient uses the first cycle and is reported", () => {
    const { fills, plan } = planWith([
      {
        type: "linear-gradient",
        css: "repeating-linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255) 20%)",
        angle: 180,
        stops: [
          { color: red, position: 0 },
          { color: blue, position: 0.2 },
        ],
      },
    ]);
    expect((fills[0] as Grad).stops.map((s) => s.position)).toEqual([0, 1]);
    expect(plan.report.warnings.join(" ")).toMatch(/repeating/i);
  });
  test("background-clip: text puts no background on the frame and colours transparent text", () => {
    const base = el("x", [0, 0]).style;
    const c = cap(
      el(
        "root",
        [0, 0],
        [
          el("h", [0, 0], [textNode("t", { runs: [run({ color: { r: 0, g: 0, b: 0, a: 0 } })] })], {
            style: {
              ...base,
              backgroundClip: "text",
              backgroundImages: [linear(90)],
            },
          }),
        ]
      )
    );
    const plan = mapCapture(c, inter);
    expect((plan.ops.find((o) => o.id === "h") as FramePlanOp).fills).toEqual([]);
    const text = plan.ops.find((o) => o.op === "text") as TextPlanOp;
    expect(text.runs[0]).toMatchObject({ color: { r: 1, g: 0, b: 0 }, opacity: 1 });
    expect(plan.report.warnings.filter((w) => /clip/i.test(w))).toHaveLength(1);
  });
  test("a longer list of stops than a capture may hold loses the excess, with a warning", () => {
    const stops = Array.from({ length: 300 }, (_, i) => ({ color: red, position: i / 299 }));
    const { fills, plan } = planWith([
      { type: "linear-gradient", css: "linear-gradient()", angle: 90, stops },
    ]);
    expect((fills[0] as Grad).stops).toHaveLength(256);
    expect(plan.report.warnings.join(" ")).toMatch(/more than 256 colour stops/);
  });
  describe("transparent text clipped to a background", () => {
    type Background = ElementNode["style"]["backgroundImages"][number];
    const clear = { r: 0, g: 0, b: 0, a: 0 };
    const clippedRun = (style: Partial<ElementNode["style"]>) => {
      const base = el("x", [0, 0]).style;
      const text = textNode("t", { runs: [run({ color: clear })] });
      const root = el("root", [0, 0], [text], {
        style: { ...base, backgroundClip: "text", ...style },
      });
      const plan = mapCapture(cap(root), inter);
      const op = plan.ops.find((o) => o.op === "text") as TextPlanOp;
      return { paint: op.runs[0], warnings: plan.report.warnings.filter((w) => /clip/i.test(w)) };
    };

    test("takes the first stop that shows, not a clear one", () => {
      const fade: Background = {
        type: "linear-gradient",
        css: "linear-gradient()",
        angle: 90,
        stops: [
          { color: clear, position: 0 },
          { color: red, position: 1 },
        ],
      };
      const { paint, warnings } = clippedRun({ backgroundImages: [fade] });
      expect(paint).toMatchObject({ color: { r: 1, g: 0, b: 0 }, opacity: 1 });
      expect(warnings).toHaveLength(1);
    });
    test("takes the next layer when the top gradient is clear throughout", () => {
      const none: Background = {
        type: "linear-gradient",
        css: "linear-gradient()",
        stops: [{ color: clear, position: 0 }],
      };
      const { paint } = clippedRun({ backgroundImages: [none, linear(90)] });
      expect(paint).toMatchObject({ color: { r: 1, g: 0, b: 0 }, opacity: 1 });
    });
    test("takes the background colour when no gradient shows", () => {
      const { paint, warnings } = clippedRun({ backgroundColor: { r: 0, g: 1, b: 0, a: 1 } });
      expect(paint).toMatchObject({ color: { r: 0, g: 1, b: 0 }, opacity: 1 });
      expect(warnings.join(" ")).toMatch(/background colour/);
    });
    test("comes out black on an image, with a warning", () => {
      const image: Background = { type: "image", css: "url()", assetHash: "h" };
      const { paint, warnings } = clippedRun({ backgroundImages: [image] });
      expect(paint).toMatchObject({ color: { r: 0, g: 0, b: 0 }, opacity: 1 });
      expect(warnings.join(" ")).toMatch(/image.*black/);
    });
    test("stays clear with no background at all, as CSS shows nothing", () => {
      expect(clippedRun({}).paint).toMatchObject({ opacity: 0 });
    });
  });
  test("opaque text under a clipped element keeps its colour", () => {
    const base = el("x", [0, 0]).style;
    const c = cap(
      el("root", [0, 0], [textNode("t", { runs: [run()] })], {
        style: { ...base, backgroundClip: "text", backgroundImages: [linear(90)] },
      })
    );
    const text = mapCapture(c, inter).ops.find((o) => o.op === "text") as TextPlanOp;
    expect(text.runs[0]).toMatchObject({ color: { r: 0, g: 0, b: 0 }, opacity: 1 });
  });
  test("a transparent stop takes its neighbour's colour, so it does not fade through black", () => {
    const clear = { r: 0, g: 0, b: 0, a: 0 };
    const g = planWith([
      {
        type: "linear-gradient",
        css: "linear-gradient()",
        angle: 90,
        stops: [
          { color: red, position: 0 },
          { color: clear, position: 0.5 },
          { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
        ],
      },
    ]).fills[0] as Grad;
    expect(g.stops).toEqual([
      { position: 0, color: red },
      { position: 0.5, color: { r: 1, g: 0, b: 0, a: 0 } },
      { position: 0.5, color: { r: 0, g: 0, b: 1, a: 0 } },
      { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
    ]);
    const tail = planWith([
      {
        type: "linear-gradient",
        css: "linear-gradient()",
        angle: 90,
        stops: [
          { color: red, position: 0 },
          { color: clear, position: 1 },
        ],
      },
    ]).fills[0] as Grad;
    expect(tail.stops[1]).toEqual({ position: 1, color: { r: 1, g: 0, b: 0, a: 0 } });
  });
  test("a sized layer smaller than the box is a pattern: left out and reported", () => {
    const { fills, plan } = planWith([{ ...linear(90), size: "20px 20px" }], [100, 100], {
      r: 0,
      g: 0,
      b: 1,
      a: 1,
    });
    expect(fills.map((f) => f.type)).toEqual(["SOLID"]);
    expect(plan.report.warnings.join(" ")).toMatch(/pattern/i);
    for (const size of ["auto", "cover", "contain", "100% 100%", "100px 100px", "auto auto"]) {
      expect(planWith([{ ...linear(90), size }]).fills).toHaveLength(1);
    }
    expect(planWith([{ ...linear(90), size: "50%" }]).fills).toEqual([]);
  });
  test("stops are sorted and a stop outside the line is clamped and reported", () => {
    const { fills, plan } = planWith([
      {
        type: "linear-gradient",
        css: "linear-gradient()",
        angle: 90,
        stops: [
          { color: blue, position: 1.5 },
          { color: red, position: 0 },
        ],
      },
    ]);
    expect((fills[0] as Grad).stops.map((s) => s.position)).toEqual([0, 1]);
    expect((fills[0] as Grad).stops[0]?.color).toEqual(red);
    expect(plan.report.warnings.filter((w) => /outside/.test(w))).toHaveLength(1);
  });
  test("a gradient without stops is left out and reported", () => {
    const { fills, plan } = planWith([
      { type: "linear-gradient", css: "linear-gradient(var(--x))" },
    ]);
    expect(fills).toEqual([]);
    expect(plan.report.warnings.join(" ")).toMatch(/gradient/i);
  });
});

describe("filters", () => {
  const styled = (over: Partial<ElementNode["style"]>) =>
    cap(el("root", [0, 0], [], { style: { ...el("x", [0, 0]).style, ...over } }));

  test("blur(4px) is a layer blur of radius 8", () => {
    expect(frame(styled({ filters: ["blur(4px)"] }), "root").effects).toEqual([
      { type: "LAYER_BLUR", radius: 8 },
    ]);
  });
  test("drop-shadow(1px 2px 3px red) is a drop shadow of radius 6", () => {
    // Computed style puts the colour first.
    const effects = frame(
      styled({ filters: ["drop-shadow(rgb(255, 0, 0) 1px 2px 3px)"] }),
      "root"
    ).effects;
    expect(effects).toEqual([
      {
        type: "DROP_SHADOW",
        color: { r: 1, g: 0, b: 0, a: 1 },
        offset: { x: 1, y: 2 },
        radius: 6,
        spread: 0,
      },
    ]);
    // And the authored order, colour last.
    expect(
      frame(styled({ filters: ["drop-shadow(1px 2px 3px rgba(0, 0, 255, 0.5))"] }), "root")
        .effects[0]
    ).toMatchObject({ color: { r: 0, g: 0, b: 1, a: 0.5 }, offset: { x: 1, y: 2 }, radius: 6 });
  });
  test("backdrop-filter: blur(10px) is a background blur of radius 20", () => {
    expect(frame(styled({ backdropFilter: "blur(10px)" }), "root").effects).toEqual([
      { type: "BACKGROUND_BLUR", radius: 20 },
    ]);
  });
  test("box shadows come first, then drop shadows, then blurs", () => {
    const shadow = {
      inset: false,
      x: 0,
      y: 0,
      blur: 1,
      spread: 0,
      color: { r: 0, g: 0, b: 0, a: 1 },
    };
    const types = frame(
      styled({
        boxShadows: [shadow],
        filters: ["blur(1px)", "drop-shadow(rgb(0, 0, 0) 1px 1px 1px)"],
        backdropFilter: "blur(1px)",
      }),
      "root"
    ).effects.map((e) => e.type);
    expect(types).toEqual(["DROP_SHADOW", "DROP_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"]);
  });
  test("grayscale(1) is ignored and reported once with a count", () => {
    const c = cap(
      el(
        "root",
        [0, 0],
        [
          el("a", [0, 0], [], { style: { ...el("x", [0, 0]).style, filters: ["grayscale(1)"] } }),
          el("b", [0, 0], [], {
            style: { ...el("x", [0, 0]).style, filters: ["grayscale(0.5)", "sepia(1)"] },
          }),
        ]
      )
    );
    const plan = mapCapture(c, inter);
    expect(frame(c, "a").effects).toEqual([]);
    const notes = plan.report.warnings.filter((w) => w.includes("grayscale"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("grayscale (2)");
    expect(notes[0]).toContain("sepia (1)");
  });
});

describe("transforms", () => {
  type Matrix = NonNullable<ElementNode["transform"]>;
  const rotate = (deg: number, scale = 1): Matrix => {
    const t = (deg * Math.PI) / 180;
    return [
      scale * Math.cos(t),
      scale * Math.sin(t),
      -scale * Math.sin(t),
      scale * Math.cos(t),
      0,
      0,
    ];
  };
  const withTransform = (transform: Matrix | undefined) => {
    const c = cap(el("root", [0, 0], [el("a", [10, 10], [], transform ? { transform } : {})]));
    return { plan: mapCapture(c, inter), op: frame(c, "a") };
  };

  test("translate only sets no rotation", () => {
    const { op, plan } = withTransform([1, 0, 0, 1, 40, 20]);
    expect(op.rotation).toBeUndefined();
    expect(plan.report.warnings).toEqual([]);
  });
  test("no transform sets no rotation", () => {
    expect(withTransform(undefined).op.rotation).toBeUndefined();
  });
  test("rotate(30deg) gives rotation 30", () => {
    const { op, plan } = withTransform(rotate(30));
    expect(op.rotation).toBeCloseTo(30, 6);
    expect(plan.report.warnings).toEqual([]);
  });
  test("a negative angle stays negative", () => {
    expect(withTransform(rotate(-45)).op.rotation).toBeCloseTo(-45, 6);
  });
  test("the box keeps its unrotated size", () => {
    const { op } = withTransform(rotate(30));
    expect([op.x, op.y, op.w, op.h]).toEqual([10, 10, 100, 100]);
  });
  test("scale is left out and reported", () => {
    const { op, plan } = withTransform([2, 0, 0, 2, 0, 0]);
    expect(op.rotation).toBeUndefined();
    expect([op.w, op.h]).toEqual([100, 100]);
    expect(plan.report.warnings.join(" ")).toMatch(/scale.*1 layer\b/i);
  });
  test("a rotation with scale keeps the rotation", () => {
    const { op, plan } = withTransform(rotate(90, 1.5));
    expect(op.rotation).toBeCloseTo(90, 6);
    expect(plan.report.warnings.join(" ")).toMatch(/scale/i);
  });
  test("skew keeps the rotation and is reported", () => {
    // rotate(20deg) then skewX(15deg): the x axis keeps its 20 degrees, the y axis leans.
    const r = (20 * Math.PI) / 180;
    const k = Math.tan((15 * Math.PI) / 180);
    const [a, b, c, d] = rotate(20);
    const matrix: Matrix = [a, b, c + a * k, d + b * k, 0, 0];
    const { op, plan } = withTransform(matrix);
    expect(op.rotation).toBeCloseTo((r * 180) / Math.PI, 6);
    expect(plan.report.warnings.join(" ")).toMatch(/skew/i);
  });
  test("a mirror is reported as scale and not rotated", () => {
    const { op, plan } = withTransform([-1, 0, 0, 1, 0, 0]);
    expect(op.rotation).toBeUndefined();
    expect(plan.report.warnings.join(" ")).toMatch(/scale/i);
  });
  test("images and svg carry the rotation, text does not", () => {
    const base = {
      box: { x: 0, y: 0, w: 40, h: 20 },
      paintOrder: 0,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      semantic: { tag: "img" },
      transform: rotate(10),
    };
    const c = cap(
      el(
        "root",
        [0, 0],
        [
          {
            ...base,
            ...imageStyle,
            id: "i",
            kind: "image",
            assetHash: "h",
            fit: "cover",
            objectPosition: "",
          },
          { ...base, id: "s", kind: "svg", markup: "<svg/>" },
          textNode("t", { transform: rotate(10) }),
        ]
      )
    );
    const ops = mapCapture(c, inter).ops;
    const rotation = (id: string) =>
      (ops.find((o) => o.id === id) as { rotation?: number }).rotation;
    expect(rotation("i")).toBeCloseTo(10, 6);
    expect(rotation("s")).toBeCloseTo(10, 6);
    expect(rotation("t")).toBeUndefined();
  });
});

describe("rotation edge cases", () => {
  const spin = (m: ElementNode["transform"], kids: ElementNode[] = []) =>
    cap(el("root", [0, 0], [el("a", [10, 10], kids, { transform: m })]));
  const t360 = (360 * Math.PI) / 180;

  test("rotate(360deg) and rotate(0) set no rotation", () => {
    const full = frame(
      spin([Math.cos(t360), Math.sin(t360), -Math.sin(t360), Math.cos(t360), 0, 0]),
      "a"
    );
    expect(full.rotation).toBeUndefined();
    expect(frame(spin([1, 0, 0, 1, 0, 0]), "a").rotation).toBeUndefined();
  });
  test("a rotated import root is not turned, says so once, and leaves its content", () => {
    const t = Math.PI / 6;
    const kid = el("kid", [30, 40], [], {}, [20, 10]);
    const root = el("root", [0, 0], [kid], {
      transform: [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0],
    });
    const plan = mapCapture(cap(root), inter);
    expect(plan.ops.find((o) => o.id === "root")).not.toHaveProperty("rotation");
    expect(plan.report.warnings.filter((w) => w.includes("root layer"))).toHaveLength(1);
    expect(plan.ops.find((o) => o.id === "kid")).toMatchObject({ x: 30, y: 40, w: 20, h: 10 });
  });
  test("content of a rotated and scaled frame is reported as not corrected", () => {
    const t = Math.PI / 6;
    const m: ElementNode["transform"] = [
      2 * Math.cos(t),
      2 * Math.sin(t),
      -2 * Math.sin(t),
      2 * Math.cos(t),
      0,
      0,
    ];
    const plan = mapCapture(spin(m, [el("kid", [10, 10])]), inter);
    expect(plan.report.warnings.filter((w) => w.includes("not corrected"))).toHaveLength(1);
    expect(
      mapCapture(spin(m), inter).report.warnings.some((w) => w.includes("not corrected"))
    ).toBe(false);
  });
});

describe("content of rotated frames", () => {
  type Matrix = NonNullable<ElementNode["transform"]>;
  type B = { x: number; y: number; w: number; h: number };
  const matrix = (deg: number): Matrix => {
    const t = (deg * Math.PI) / 180;
    return [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0];
  };
  /** Where a browser reports a local box once its parent turns by `deg` about `centre`. */
  function forward(b: B, centre: { x: number; y: number }, deg: number): B {
    const t = (deg * Math.PI) / 180;
    // A browser's own maths gives whole numbers at right angles; so does this.
    const c = Math.round(Math.cos(t) * 1e12) / 1e12;
    const s = Math.round(Math.sin(t) * 1e12) / 1e12;
    const dx = b.x + b.w / 2 - centre.x;
    const dy = b.y + b.h / 2 - centre.y;
    const x = centre.x + dx * c - dy * s;
    const y = centre.y + dx * s + dy * c;
    const w = b.w * Math.abs(c) + b.h * Math.abs(s);
    const h = b.w * Math.abs(s) + b.h * Math.abs(c);
    return { x: x - w / 2, y: y - h / 2, w, h };
  }
  const close = (op: PlanOp | undefined, [x, y, w, h]: number[]) => {
    expect(op).toBeDefined();
    const o = op as PlanOp;
    expect([o.x, o.y, o.w, o.h].map((n) => Number(n.toFixed(6)))).toEqual([x, y, w, h]);
  };
  const frameBox: B = { x: 100, y: 100, w: 200, h: 100 };
  const centre = { x: 200, y: 150 };
  const kidLocal: B = { x: 110, y: 120, w: 40, h: 20 };
  const textLocal: B = { x: 160, y: 140, w: 60, h: 16 };
  const rotatedPage = (deg: number) => {
    const text = textNode("t", {
      box: forward(textLocal, centre, deg),
      lines: [forward(textLocal, centre, deg)],
    });
    const kid = el("kid", [0, 0], [], {}, [0, 0]);
    kid.box = forward(kidLocal, centre, deg);
    const parent = el("p", [frameBox.x, frameBox.y], [kid, text], { transform: matrix(deg) }, [
      frameBox.w,
      frameBox.h,
    ]);
    return cap(el("root", [0, 0], [parent], {}, [800, 600]));
  };
  const ops = (c: Parameters<typeof mapCapture>[0]) => mapCapture(c, inter).ops;

  test.each([30, -20, 90, 180, 270])(
    "a child and a text land in local space at %i degrees",
    (deg) => {
      const c = rotatedPage(deg);
      const plan = ops(c);
      close(
        plan.find((o) => o.id === "kid"),
        [10, 20, 40, 20]
      );
      const t = plan.find((o) => o.id === "t") as PlanOp;
      expect(t.x).toBeCloseTo(60, 6);
      expect(t.w).toBeCloseTo(60, 6);
      expect((t as { rotation?: number }).rotation).toBeUndefined();
      expect(plan.find((o) => o.id === "p")).toMatchObject({ x: 100, y: 100, w: 200, h: 100 });
    }
  );
  test("90 degrees swaps width and height exactly", () => {
    const kid = ops(rotatedPage(90)).find((o) => o.id === "kid") as PlanOp;
    expect([kid.x, kid.y, kid.w, kid.h]).toEqual([10, 20, 40, 20]);
  });
  test("nested rotations accumulate", () => {
    // Inner frame: local box inside the outer frame, turned 20 degrees more.
    const innerLocal: B = { x: 120, y: 110, w: 100, h: 60 };
    const innerCentre = { x: 170, y: 140 };
    const leafLocal: B = { x: 140, y: 125, w: 30, h: 10 };
    const outerDeg = 30;
    const innerDeg = 20;
    // The inner frame is untransformed-size and centred where the outer turn puts its centre.
    const innerPage = forward({ ...innerLocal }, centre, outerDeg);
    const innerCentrePage = {
      x: innerPage.x + innerPage.w / 2,
      y: innerPage.y + innerPage.h / 2,
    };
    const innerBox = {
      x: innerCentrePage.x - 50,
      y: innerCentrePage.y - 30,
      w: 100,
      h: 60,
    };
    // The leaf turns by the inner angle about the inner centre, then by the outer one.
    const afterInner = forward(leafLocal, innerCentre, innerDeg);
    const leaf = el("leaf", [0, 0], [], {}, [0, 0]);
    leaf.box = forward(afterInner, centre, outerDeg);
    // forward() swells the bounds by each turn in turn; the true bounds are those of the total.
    const total = forward(leafLocal, innerCentre, innerDeg + outerDeg);
    leaf.box = {
      ...leaf.box,
      w: total.w,
      h: total.h,
      x: leaf.box.x + leaf.box.w / 2 - total.w / 2,
      y: leaf.box.y + leaf.box.h / 2 - total.h / 2,
    };
    const inner = el(
      "inner",
      [innerBox.x, innerBox.y],
      [leaf],
      { transform: matrix(innerDeg) },
      [100, 60]
    );
    const outer = el("outer", [100, 100], [inner], { transform: matrix(outerDeg) }, [200, 100]);
    const plan = ops(cap(el("root", [0, 0], [outer], {}, [800, 600])));
    const p = (id: string) => plan.find((o) => o.id === id) as PlanOp;
    expect(p("outer")).toMatchObject({ rotation: 30 });
    expect((p("inner") as { rotation?: number }).rotation).toBeCloseTo(20, 4);
    expect(p("inner").x).toBeCloseTo(20, 4);
    expect(p("inner").y).toBeCloseTo(10, 4);
    expect(p("leaf").w).toBeCloseTo(30, 4);
    expect(p("leaf").h).toBeCloseTo(10, 4);
    expect(p("leaf").x).toBeCloseTo(20, 4);
    expect(p("leaf").y).toBeCloseTo(15, 4);
  });
  test("45 degrees keeps the rotated bounds and reports once", () => {
    const c = rotatedPage(45);
    const plan = mapCapture(c, inter);
    const warnings = plan.report.warnings.filter((w) => w.includes("rotated-content"));
    expect(warnings).toHaveLength(1);
    const kid = plan.ops.find((o) => o.id === "kid") as PlanOp;
    const bounds = forward(kidLocal, centre, 45);
    expect(kid.w).toBeCloseTo(bounds.w, 6);
    expect(kid.h).toBeCloseTo(bounds.h, 6);
  });
  test("a rotated svg with no children is unchanged", () => {
    const base = {
      box: { x: 10, y: 10, w: 40, h: 20 },
      paintOrder: 0,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      semantic: { tag: "svg" },
      transform: matrix(30),
    };
    const c = cap(el("root", [0, 0], [{ ...base, id: "s", kind: "svg", markup: "<svg/>" }]));
    const s = ops(c).find((o) => o.id === "s") as PlanOp;
    expect([s.x, s.y, s.w, s.h]).toEqual([10, 10, 40, 20]);
  });
  test("an element with its own transform keeps its size", () => {
    const c = rotatedPage(30);
    const parent = c.root.kind === "element" ? (c.root.children[0] as ElementNode) : undefined;
    const spinning = el("spin", [0, 0], [], { transform: matrix(10) }, [40, 20]);
    const at = forward({ x: 120, y: 120, w: 40, h: 20 }, centre, 30);
    spinning.box = { x: at.x + at.w / 2 - 20, y: at.y + at.h / 2 - 10, w: 40, h: 20 };
    parent?.children.push(spinning);
    const spin = ops(c).find((o) => o.id === "spin") as PlanOp;
    expect([spin.w, spin.h]).toEqual([40, 20]);
    expect(spin.x).toBeCloseTo(20, 6);
    expect(spin.y).toBeCloseTo(20, 6);
  });
  test("a page without rotation is untouched", () => {
    const c = cap(el("root", [0, 0], [el("a", [10, 10])]));
    expect(ops(c).find((o) => o.id === "a")).toMatchObject({ x: 10, y: 10, w: 100, h: 100 });
  });
});

describe("a rotated layer with nothing to rotate", () => {
  const quarter: ElementNode["transform"] = [0, 1, -1, 0, 0, 0];
  const warningsFor = (child: CaptureNode) =>
    mapCapture(cap(el("root", [0, 0], [child])), inter).report.warnings.filter((w) =>
      /rotation/i.test(w)
    );
  const blocked: CaptureNode = {
    id: "p",
    kind: "placeholder",
    box: { x: 0, y: 0, w: 10, h: 10 },
    paintOrder: 1,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    semantic: { tag: "img" },
    placeholderKind: "blocked-image",
  };

  test("a placeholder says its rotation was left out, once", () => {
    expect(warningsFor({ ...blocked, transform: quarter })).toEqual([
      "A rotation on a placeholder was left out.",
    ]);
  });
  test("an image with no asset says so too", () => {
    const image = {
      ...blocked,
      kind: "image",
      transform: quarter,
      fit: "fill",
      objectPosition: "50% 50%",
      ...imageStyle,
    } as CaptureNode;
    expect(warningsFor(image)).toHaveLength(1);
  });
  test("a placeholder with no rotation says nothing", () => {
    expect(warningsFor(blocked)).toEqual([]);
  });
});
