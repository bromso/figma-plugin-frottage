import { describe, expect, test } from "bun:test";
import { batchOps, DEFAULT_IMPORT_OPTIONS, mapCapture, type PlanOp } from "../index";
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
