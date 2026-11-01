import { describe, expect, test } from "bun:test";
import type { CaptureNode, TextNode } from "@repo/capture-schema";
import { mapCapture } from "../map";
import { DEFAULT_IMPORT_OPTIONS } from "../options";
import type {
  LayerPlan,
  PlanColor,
  PlanHoverPatch,
  PlanOp,
  PlanOverride,
  PlanPaint,
  PlanRun,
  PlanTextStyle,
} from "../plan";
import { mergeVersions } from "../versions";
import { cap, el, inter, run, textNode } from "./fixtures";

const rgb = (hex: string) => ({
  r: Number.parseInt(hex.slice(1, 3), 16) / 255,
  g: Number.parseInt(hex.slice(3, 5), 16) / 255,
  b: Number.parseInt(hex.slice(5, 7), 16) / 255,
});
const rgba = (hex: string) => ({ ...rgb(hex), a: 1 });

const color = (key: string, name: string, cssVar?: string): PlanColor => ({
  key,
  name,
  rgba: rgba(key),
  ...(cssVar ? { cssVar } : {}),
});

const style = (name: string, over: Partial<PlanTextStyle> = {}): PlanTextStyle => {
  const t = {
    fontName: { family: "Inter", style: "Bold" },
    fontSize: 32,
    lineHeight: 40 as number | null,
    letterSpacing: 0,
    decoration: "NONE" as const,
    textCase: "ORIGINAL" as const,
    ...over,
  };
  const key = JSON.stringify([t.fontName.family, t.fontName.style, t.fontSize, t.lineHeight]);
  return { key: over.key ?? key, name, ...t };
};

const paint = (colorKey?: string): PlanPaint => ({
  type: "SOLID",
  color: rgb("#000000"),
  opacity: 1,
  ...(colorKey ? { colorKey } : {}),
});

const textRun = (styleKey?: string, colorKey?: string): PlanRun => ({
  start: 0,
  end: 1,
  fontName: { family: "Inter", style: "Bold" },
  fontSize: 32,
  lineHeight: 40,
  letterSpacing: 0,
  color: rgb("#000000"),
  opacity: 1,
  decoration: "NONE",
  textCase: "ORIGINAL",
  ...(styleKey ? { styleKey } : {}),
  ...(colorKey ? { colorKey } : {}),
});

type TextOp = Extract<PlanOp, { op: "text" }>;

const box = { x: 0, y: 0, w: 10, h: 10 };
const frame = (
  id: string,
  fills: PlanPaint[],
  over: Partial<Extract<PlanOp, { op: "frame" }>> = {}
): PlanOp => ({
  op: "frame",
  id,
  parent: null,
  name: id,
  ...box,
  fills,
  strokes: null,
  radius: [0, 0, 0, 0],
  opacity: 1,
  effects: [],
  clips: false,
  layout: { mode: "NONE" },
  childCount: 0,
  ...over,
});
const text = (id: string, runs: PlanRun[], words = "x"): PlanOp => ({
  op: "text",
  id,
  parent: "f",
  name: id,
  ...box,
  text: words,
  runs,
  align: "LEFT",
  wrap: false,
  lineCount: 1,
});
const instance = (id: string, overrides: PlanOverride[]): PlanOp => ({
  op: "instance",
  id,
  parent: "f",
  name: id,
  ...box,
  key: "component",
  resize: false,
  overrides,
});

const planOf = (
  tokens: { colors?: PlanColor[]; styles?: PlanTextStyle[] },
  ops: PlanOp[] = []
): LayerPlan => ({
  ops,
  tokens: {
    colors: tokens.colors ?? [],
    textStyles: tokens.styles ?? [],
    collection: "example.com",
  },
  fonts: [],
  assetHashes: [],
  report: {
    nodes: ops.length,
    texts: 0,
    images: 0,
    placeholders: 0,
    downscaledImages: 0,
    substitutedFonts: [],
    warnings: [],
    components: 0,
    instances: 0,
  },
});

const version = (label: string, plan: LayerPlan, cssValues: Record<string, string> = {}) => ({
  label,
  plan,
  cssValues,
});

/** Every token key in a plan's ops, read from the JSON so that no place can be left out. */
function keysIn(ops: PlanOp[]) {
  const found = { colors: [] as string[], styles: [] as string[] };
  JSON.stringify(ops, (field, value) => {
    if (field === "colorKey") found.colors.push(value);
    if (field === "styleKey") found.styles.push(value);
    return value;
  });
  return found;
}

const colorNamed = (r: ReturnType<typeof mergeVersions>, name: string) =>
  r.tokens.colors.find((c) => c.name === name);
const styleNamed = (r: ReturnType<typeof mergeVersions>, name: string) =>
  r.tokens.textStyles.find((s) => s.name === name);

describe("one version", () => {
  test("one version gives one mode and the same tokens", () => {
    const ink = color("#112233", "color/ink", "--ink");
    const h1 = style("heading/1");
    const r = mergeVersions([
      version("1440", planOf({ colors: [ink], styles: [h1] }, [frame("f", [paint(ink.key)])])),
    ]);
    expect(r.tokens.collection).toBe("example.com");
    expect(r.tokens.modes).toEqual(["1440"]);
    expect(r.tokens.colors).toMatchObject([
      {
        name: "color/ink",
        cssVar: "--ink",
        values: [{ mode: 0, value: ink.rgba }],
        from: [ink.key],
      },
    ]);
    expect(r.tokens.textStyles).toMatchObject([
      {
        name: "heading/1",
        fontName: h1.fontName,
        letterSpacing: [{ mode: 0, value: 0 }],
        decoration: "NONE",
        textCase: "ORIGINAL",
        fontSize: [{ mode: 0, value: 32 }],
        lineHeight: [{ mode: 0, value: 40 }],
        from: [h1.key],
      },
    ]);
    expect(r.report).toEqual([]);
  });

  test("no versions give an empty set", () => {
    expect(mergeVersions([])).toEqual({
      tokens: { collection: "", modes: [], colors: [], textStyles: [] },
      plans: [],
      report: [],
    });
  });
});

describe("matching colours", () => {
  test("the same custom property with two values is one variable with two modes", () => {
    const r = mergeVersions([
      version("Light", planOf({ colors: [color("#ffffff", "color/bg", "--bg")] })),
      version("Dark", planOf({ colors: [color("#000000", "color/bg", "--bg")] })),
    ]);
    expect(r.tokens.colors).toHaveLength(1);
    expect(r.tokens.colors[0]).toMatchObject({
      name: "color/bg",
      cssVar: "--bg",
      values: [
        { mode: 0, value: rgba("#ffffff") },
        { mode: 1, value: rgba("#000000") },
      ],
      from: ["#ffffff", "#000000"],
    });
  });

  test("a custom property that a later version holds under another token's name still matches", () => {
    // In the second version --ink shares #222222 with --a, whose name is the one the token shows.
    const r = mergeVersions([
      version("Light", planOf({ colors: [color("#111111", "color/ink", "--ink")] })),
      version("Dark", planOf({ colors: [color("#222222", "color/a", "--a")] }), {
        "--a": "#222222",
        "--ink": "var(--a)",
      }),
    ]);
    expect(r.tokens.colors).toHaveLength(1);
    expect(r.tokens.colors[0]?.from).toEqual(["#111111", "#222222"]);
    expect(r.report).toEqual([]);
  });

  test("without a custom property, the same value matches", () => {
    const r = mergeVersions([
      version("1440", planOf({ colors: [color("#112233", "color/1")] })),
      version("768", planOf({ colors: [color("#112233", "color/4")] })),
    ]);
    expect(r.tokens.colors).toHaveLength(1);
    expect(r.tokens.colors[0]).toMatchObject({
      name: "color/1",
      from: ["#112233", "#112233"],
      values: [
        { mode: 0, value: rgba("#112233") },
        { mode: 1, value: rgba("#112233") },
      ],
    });
  });

  test("an unmatched colour stays a plain value in its own frame", () => {
    const shared = color("#112233", "color/1");
    const stray = color("#abcdef", "color/2");
    const later = planOf({ colors: [shared, stray] }, [
      frame("a", [paint(shared.key)]),
      frame("b", [paint(stray.key)]),
    ]);
    const r = mergeVersions([version("1440", planOf({ colors: [shared] })), version("768", later)]);
    expect(r.tokens.colors).toHaveLength(1);
    expect(keysIn(r.plans[1]?.ops ?? []).colors).toHaveLength(1);
    const plain = r.plans[1]?.ops[1];
    expect(plain).toMatchObject({ fills: [{ color: rgb("#000000") }] });
    expect((plain as Extract<PlanOp, { op: "frame" }>).fills[0]).not.toHaveProperty("colorKey");
    expect(r.report).toEqual(["768: 1 colour stayed a plain value."]);
  });

  test("a token only in the first version has one value, and later frames don't use it", () => {
    const only = color("#112233", "color/1");
    const r = mergeVersions([
      version("1440", planOf({ colors: [only] }, [frame("a", [paint(only.key)])])),
      version("768", planOf({ colors: [] }, [frame("b", [paint()])])),
    ]);
    expect(r.tokens.colors[0]).toMatchObject({
      values: [{ mode: 0, value: rgba("#112233") }],
      from: ["#112233", null],
    });
    expect(keysIn(r.plans[0]?.ops ?? []).colors).toEqual([r.tokens.colors[0]?.key as string]);
    expect(keysIn(r.plans[1]?.ops ?? []).colors).toEqual([]);
    expect(r.report).toEqual([]);
  });

  test("a gap in the middle leaves that mode out", () => {
    const ink = color("#112233", "color/1");
    const r = mergeVersions([
      version("a", planOf({ colors: [ink] })),
      version("b", planOf({})),
      version("c", planOf({ colors: [ink] })),
    ]);
    expect(r.tokens.colors[0]?.values.map((v) => v.mode)).toEqual([0, 2]);
    expect(r.tokens.colors[0]?.from).toEqual(["#112233", null, "#112233"]);
  });
});

describe("a custom property's value in a later version", () => {
  const seed = color("#111111", "color/bg", "--bg");
  const merged = (cssValues: Record<string, string>, colors: PlanColor[] = []) =>
    mergeVersions([
      version("Light", planOf({ colors: [seed] })),
      version("Dark", planOf({ colors }, [frame("f", [paint("#111111")])]), cssValues),
    ]);

  test("gives the mode its value with no token there, and from stays null", () => {
    const r = merged({ "--bg": "#222222" });
    expect(r.tokens.colors[0]).toMatchObject({
      values: [
        { mode: 0, value: rgba("#111111") },
        { mode: 1, value: rgba("#222222") },
      ],
      from: ["#111111", null],
    });
    expect(r.report).toEqual([]);
  });

  test("resolves through var()", () => {
    const r = merged({ "--bg": "var(--ink)", "--ink": "#222222" });
    expect(r.tokens.colors[0]?.values[1]?.value).toEqual(rgba("#222222"));
  });

  test("carries alpha for a translucent value", () => {
    for (const translucent of ["rgba(255, 0, 0, 0.5)", "#ff000080", "rgb(255 0 0 / 50%)"]) {
      const value = merged({ "--bg": translucent }).tokens.colors[0]?.values[1]?.value;
      expect(value?.r).toBe(1);
      expect(value?.g).toBe(0);
      expect(value?.a).toBeCloseTo(0.5, 2);
    }
  });

  test("an alpha of 1 is opaque", () => {
    const value = merged({ "--bg": "rgba(34, 34, 34, 1)" }).tokens.colors[0]?.values[1]?.value;
    expect(value).toEqual(rgba("#222222"));
  });

  test("blocks a value match when it's opaque, and leaves the bare token plain and counted", () => {
    const r = merged({ "--bg": "#222222" }, [color("#111111", "color/1")]);
    expect(r.tokens.colors[0]?.from).toEqual(["#111111", null]);
    expect(r.tokens.colors[0]?.values[1]?.value).toEqual(rgba("#222222"));
    expect(keysIn(r.plans[1]?.ops ?? []).colors).toEqual([]);
    expect(r.report).toEqual(["Dark: 1 colour stayed a plain value."]);
  });

  test("blocks a value match when it's translucent", () => {
    const r = merged({ "--bg": "rgba(0, 0, 0, 0.5)" }, [color("#111111", "color/1")]);
    expect(r.tokens.colors[0]?.from).toEqual(["#111111", null]);
    expect(r.tokens.colors[0]?.values[1]?.value.a).toBeCloseTo(0.5, 2);
  });

  test("blocks a value match when it can't be parsed, and gives no value", () => {
    for (const unreadable of ["oklch(0.5 0.1 200)", "rebeccapurple", "16px"]) {
      const r = merged({ "--bg": unreadable }, [color("#111111", "color/1")]);
      expect(r.tokens.colors[0]?.from).toEqual(["#111111", null]);
      expect(r.tokens.colors[0]?.values.map((v) => v.mode)).toEqual([0]);
      expect(r.report).toEqual(["Dark: 1 colour stayed a plain value."]);
    }
  });

  test("a property the later version doesn't have still lets the value match", () => {
    const r = merged({}, [color("#111111", "color/1")]);
    expect(r.tokens.colors[0]?.from).toEqual(["#111111", "#111111"]);
  });

  test("the key changes when the property changes", () => {
    const keyOf = (value: string) => merged({ "--bg": value }).tokens.colors[0]?.key;
    expect(keyOf("#222222")).toBe("color/bg|Dark=#222222|Light=#111111");
    expect(keyOf("#333333")).not.toBe(keyOf("#222222") as string);
    expect(keyOf("rgba(34, 34, 34, 0.5)")).not.toBe(keyOf("#222222") as string);
  });
});

describe("matching text styles", () => {
  test("heading/1 matches heading/1 by role, with size per mode", () => {
    const r = mergeVersions([
      version("1440", planOf({ styles: [style("heading/1", { fontSize: 48, lineHeight: 56 })] })),
      version("390", planOf({ styles: [style("heading/1", { fontSize: 28, lineHeight: 32 })] })),
    ]);
    expect(r.tokens.textStyles).toHaveLength(1);
    expect(r.tokens.textStyles[0]).toMatchObject({
      name: "heading/1",
      fontSize: [
        { mode: 0, value: 48 },
        { mode: 1, value: 28 },
      ],
      lineHeight: [
        { mode: 0, value: 56 },
        { mode: 1, value: 32 },
      ],
    });
  });

  test("AUTO line height joins AUTO", () => {
    const r = mergeVersions([
      version("a", planOf({ styles: [style("body/1", { lineHeight: null })] })),
      version("b", planOf({ styles: [style("body/1", { lineHeight: null, fontSize: 20 })] })),
    ]);
    expect(r.tokens.textStyles[0]?.lineHeight).toEqual([
      { mode: 0, value: null },
      { mode: 1, value: null },
    ]);
  });

  test("AUTO and a number don't join: a float variable can't be AUTO", () => {
    const r = mergeVersions([
      version("a", planOf({ styles: [style("body/1", { lineHeight: 40 })] })),
      version("b", planOf({ styles: [style("body/1", { lineHeight: null, fontSize: 20 })] })),
    ]);
    expect(r.tokens.textStyles[0]?.from[1]).toBeNull();
    expect(r.report).toEqual(["b: 1 text style stayed a plain value."]);
  });

  test("letter spacing in proportion to size joins, with a value per mode", () => {
    const r = mergeVersions([
      version("a", planOf({ styles: [style("body/1", { fontSize: 32, letterSpacing: -0.64 })] })),
      version("b", planOf({ styles: [style("body/1", { fontSize: 16, letterSpacing: -0.32 })] })),
    ]);
    expect(r.tokens.textStyles[0]?.letterSpacing).toEqual([
      { mode: 0, value: -0.64 },
      { mode: 1, value: -0.32 },
    ]);
  });

  test("letter spacing out of proportion doesn't join", () => {
    const r = mergeVersions([
      version("a", planOf({ styles: [style("body/1", { fontSize: 32, letterSpacing: -0.64 })] })),
      version("b", planOf({ styles: [style("body/1", { fontSize: 16, letterSpacing: -0.64 })] })),
    ]);
    expect(r.tokens.textStyles[0]?.from[1]).toBeNull();
  });

  describe("by shared text", () => {
    const said = (id: string, words: string, s: PlanTextStyle) =>
      text(id, [{ ...textRun(s.key), end: words.length }], words);

    test("h2 and h3 that collapse into one style both take its value", () => {
      const h2 = style("heading/2", { fontSize: 32 });
      const h3 = style("heading/3", { fontSize: 24 });
      const small = style("heading/1", { fontSize: 20 });
      const r = mergeVersions([
        version(
          "1440",
          planOf({ styles: [h2, h3] }, [said("a", "A longer heading", h2), said("b", "Short", h3)])
        ),
        version(
          "390",
          planOf({ styles: [small] }, [
            said("a", "A longer heading", small),
            said("b", "Short", small),
          ])
        ),
      ]);
      const second = styleNamed(r, "heading/2");
      const third = styleNamed(r, "heading/3");
      expect(second?.from).toEqual([h2.key, small.key]);
      expect(third?.from).toEqual([h3.key, null]);
      expect(second?.fontSize[1]).toEqual({ mode: 1, value: 20 });
      expect(third?.fontSize[1]).toEqual({ mode: 1, value: 20 });
      expect(keysIn(r.plans[1]?.ops ?? []).styles).toEqual([
        second?.key as string,
        second?.key as string,
      ]);
      expect(r.report).toEqual([]);
    });

    test("a title that falls under the heading ratio keeps its role by its text", () => {
      const title = style("heading/1", { fontSize: 48 });
      const smallTitle = style("body/2", { fontSize: 20 });
      const other = style("heading/1", { fontSize: 30 });
      const r = mergeVersions([
        version("1440", planOf({ styles: [title] }, [said("t", "The page title", title)])),
        version(
          "390",
          planOf({ styles: [other, smallTitle] }, [
            said("o", "Something else", other),
            said("t", "The page title", smallTitle),
          ])
        ),
      ]);
      expect(r.tokens.textStyles[0]?.from).toEqual([title.key, smallTitle.key]);
      expect(r.tokens.textStyles[0]?.fontSize[1]).toEqual({ mode: 1, value: 20 });
      expect(r.report).toEqual(["390: 1 text style stayed a plain value."]);
    });

    test("a language pair shares no text and falls back to roles", () => {
      const h1 = style("heading/1", { fontSize: 48 });
      const body = style("body/1", { fontSize: 16 });
      const svH1 = style("heading/1", { fontSize: 44 });
      const svBody = style("body/1", { fontSize: 15 });
      const r = mergeVersions([
        version(
          "English",
          planOf({ styles: [h1, body] }, [said("a", "Welcome", h1), said("b", "Read on", body)])
        ),
        version(
          "Svenska",
          planOf({ styles: [svH1, svBody] }, [
            said("a", "Välkommen", svH1),
            said("b", "Läs vidare", svBody),
          ])
        ),
      ]);
      expect(styleNamed(r, "heading/1")?.from).toEqual([h1.key, svH1.key]);
      expect(styleNamed(r, "body/1")?.from).toEqual([body.key, svBody.key]);
    });

    test("more shared characters win, and a tie goes to the first seed", () => {
      const a = style("heading/1", { fontSize: 40 });
      const b = style("heading/2", { fontSize: 30 });
      const token = style("heading/1", { fontSize: 20 });
      const ops = [said("a", "same", a), said("b", "size", b)];
      const later = [said("a", "same", token), said("b", "size", token)];
      const r = mergeVersions([
        version("a", planOf({ styles: [a, b] }, ops)),
        version("b", planOf({ styles: [token] }, later)),
      ]);
      expect(styleNamed(r, "heading/1")?.from[1]).toBe(token.key);
      expect(styleNamed(r, "heading/2")?.from[1]).toBeNull();
    });

    test("the seed with more text in common takes the token, whichever comes first", () => {
      const few = style("heading/1", { fontSize: 40 });
      const many = style("heading/2", { fontSize: 30 });
      const token = style("heading/1", { fontSize: 20 });
      const r = mergeVersions([
        version(
          "a",
          planOf({ styles: [few, many] }, [
            said("a", "Short", few),
            said("b", "Rather longer", many),
          ])
        ),
        version(
          "b",
          planOf({ styles: [token] }, [
            said("a", "Short", token),
            said("b", "Rather longer", token),
          ])
        ),
      ]);
      expect(styleNamed(r, "heading/2")?.from[1]).toBe(token.key);
      expect(styleNamed(r, "heading/1")?.from[1]).toBeNull();
    });

    test("a string repeated more in one version counts only as often as both have it", () => {
      const seed = style("heading/1", { fontSize: 40 });
      const repeated = style("body/1", { fontSize: 20 });
      const once = style("body/2", { fontSize: 18 });
      const r = mergeVersions([
        version(
          "a",
          planOf({ styles: [seed] }, [said("a", "Go", seed), said("b", "Menu title", seed)])
        ),
        version(
          "b",
          planOf({ styles: [repeated, once] }, [
            ...Array.from({ length: 10 }, (_, i) => said(`g${i}`, "Go", repeated)),
            said("m", "Menu title", once),
          ])
        ),
      ]);
      expect(r.tokens.textStyles[0]?.from[1]).toBe(once.key);
    });

    test("shared text doesn't join a different look", () => {
      const seed = style("heading/1");
      const other = style("heading/2", { fontName: { family: "Inter", style: "Light" } });
      const r = mergeVersions([
        version("a", planOf({ styles: [seed] }, [said("t", "Title", seed)])),
        version("b", planOf({ styles: [other] }, [said("t", "Title", other)])),
      ]);
      expect(r.tokens.textStyles[0]?.from[1]).toBeNull();
    });

    test("a seed with no shared text doesn't take a token another seed joined by text", () => {
      const first = style("heading/1", { fontSize: 40 });
      const second = style("heading/2", { fontSize: 30 });
      const token = style("heading/2", { fontSize: 20 });
      const r = mergeVersions([
        version("a", planOf({ styles: [first, second] }, [said("t", "Title", first)])),
        version("b", planOf({ styles: [token] }, [said("t", "Title", token)])),
      ]);
      expect(styleNamed(r, "heading/1")?.from[1]).toBe(token.key);
      expect(styleNamed(r, "heading/2")?.from[1]).toBeNull();
      expect(styleNamed(r, "heading/2")?.fontSize).toHaveLength(1);
    });

    test("text in an instance's override counts", () => {
      const seed = style("heading/2", { fontSize: 40 });
      const token = style("body/1", { fontSize: 20 });
      const copy = (s: PlanTextStyle) => {
        const runs = [{ ...textRun(s.key), end: 5 }];
        return instance("i", [{ path: [0], kind: "text", text: "Title", runs }]);
      };
      const r = mergeVersions([
        version("a", planOf({ styles: [seed] }, [copy(seed)])),
        version("b", planOf({ styles: [token] }, [copy(token)])),
      ]);
      expect(r.tokens.textStyles[0]?.from[1]).toBe(token.key);
    });

    test("only a run's own slice of the text counts", () => {
      const seed = style("heading/1", { fontSize: 40 });
      const near = style("body/1", { fontSize: 20 });
      const rest = style("body/2", { fontSize: 18 });
      const r = mergeVersions([
        version("a", planOf({ styles: [seed] }, [said("t", "Title", seed)])),
        version(
          "b",
          planOf({ styles: [near, rest] }, [
            text(
              "t",
              [
                { ...textRun(rest.key), end: 6 },
                { ...textRun(near.key), start: 6, end: 11 },
              ],
              "Intro Title"
            ),
          ])
        ),
      ]);
      expect(r.tokens.textStyles[0]?.from[1]).toBe(near.key);
    });

    test("whitespace alone shares nothing", () => {
      const seed = style("heading/1", { fontSize: 40 });
      const named = style("heading/1", { fontSize: 30 });
      const blank = style("body/1", { fontSize: 20 });
      const r = mergeVersions([
        version("a", planOf({ styles: [seed] }, [said("t", "   ", seed)])),
        version(
          "b",
          planOf({ styles: [blank, named] }, [said("t", "   ", blank), said("u", "x", named)])
        ),
      ]);
      expect(r.tokens.textStyles[0]?.from[1]).toBe(named.key);
    });

    test("four versions of 20,000 text nodes stay linear", () => {
      const styles = Array.from({ length: 200 }, (_, i) =>
        style(`body/${i}`, { fontSize: 8 + i, key: `k${i}` })
      );
      const big = planOf(
        { styles },
        Array.from({ length: 20_000 }, (_, i) =>
          said(`t${i}`, `text ${i}`, styles[i % 200] as PlanTextStyle)
        )
      );
      const started = performance.now();
      const r = mergeVersions(["a", "b", "c", "d"].map((label) => version(label, big)));
      expect(performance.now() - started).toBeLessThan(2000);
      expect(r.tokens.textStyles).toHaveLength(200);
      expect(r.report).toEqual([]);
    });
  });

  test("a role with a different font stays a separate style", () => {
    const later = style("heading/1", { fontName: { family: "Inter", style: "Light" } });
    const r = mergeVersions([
      version("1440", planOf({ styles: [style("heading/1")] })),
      version("390", planOf({ styles: [later] }, [text("t", [textRun(later.key)])])),
    ]);
    expect(r.tokens.textStyles).toHaveLength(1);
    expect(r.tokens.textStyles[0]?.fontSize).toEqual([{ mode: 0, value: 32 }]);
    expect(r.tokens.textStyles[0]?.from[1]).toBeNull();
    expect(keysIn(r.plans[1]?.ops ?? []).styles).toEqual([]);
    expect(r.report).toEqual(["390: 1 text style stayed a plain value."]);
  });

  test.each([
    ["letterSpacing", { letterSpacing: 1 }],
    ["decoration", { decoration: "UNDERLINE" as const }],
    ["textCase", { textCase: "UPPER" as const }],
  ])("a different %s doesn't match either", (_, over) => {
    const r = mergeVersions([
      version("a", planOf({ styles: [style("body/1")] })),
      version("b", planOf({ styles: [style("body/1", over)] })),
    ]);
    expect(r.tokens.textStyles[0]?.from[1]).toBeNull();
  });
});

describe("the order", () => {
  test("the order is custom property, then role, then value", () => {
    // --a's later value equals the second seed's, so a value match first would steal it.
    const named = color("#111111", "color/a", "--a");
    const bare = color("#222222", "color/1");
    const moved = color("#222222", "color/a", "--a");
    const taken = color("#111111", "color/1");
    const r = mergeVersions([
      version("Light", planOf({ colors: [bare, named] })),
      version("Dark", planOf({ colors: [taken, moved] })),
    ]);
    expect(colorNamed(r, "color/a")?.from).toEqual(["#111111", "#222222"]);
    // The custom property took #222222, so `bare` has nothing left to match by value.
    expect(colorNamed(r, "color/1")?.from).toEqual(["#222222", null]);
    expect(r.report).toEqual(["Dark: 1 colour stayed a plain value."]);
  });

  test("text styles match by role alone, never by value", () => {
    const r = mergeVersions([
      version("a", planOf({ styles: [style("heading/2")] })),
      version("b", planOf({ styles: [style("body/1")] })),
    ]);
    expect(styleNamed(r, "heading/2")?.from[1]).toBeNull();
    expect(r.report).toEqual(["b: 1 text style stayed a plain value."]);
  });

  test("a later version's name never replaces the first version's", () => {
    const r = mergeVersions([
      version("a", planOf({ colors: [color("#111111", "color/x", "--x")] })),
      version("b", planOf({ colors: [color("#222222", "color/other", "--x")] })),
    ]);
    expect(r.tokens.colors[0]?.name).toBe("color/x");
  });
});

describe("mode labels", () => {
  test("two labels the same become 1440 and 1440 (2)", () => {
    const r = mergeVersions([
      version("1440", planOf({})),
      version("1440", planOf({})),
      version("390", planOf({})),
      version("1440", planOf({})),
    ]);
    expect(r.tokens.modes).toEqual(["1440", "1440 (2)", "390", "1440 (3)"]);
  });

  test("a label that already reads 1440 (2) stays unique too", () => {
    const r = mergeVersions([
      version("1440", planOf({})),
      version("1440 (2)", planOf({})),
      version("1440", planOf({})),
    ]);
    expect(r.tokens.modes).toEqual(["1440", "1440 (2)", "1440 (3)"]);
  });

  test("a clash with a numbered label counts on from it, and never doubles the suffix", () => {
    const r = mergeVersions([
      version("1440", planOf({})),
      version("1440", planOf({})),
      version("1440 (2)", planOf({})),
    ]);
    expect(r.tokens.modes).toEqual(["1440", "1440 (2)", "1440 (3)"]);
  });

  test("the report names the unique label and counts both kinds", () => {
    const r = mergeVersions([
      version("1440", planOf({})),
      version(
        "1440",
        planOf({
          colors: [color("#111111", "color/1"), color("#222222", "color/2")],
          styles: [style("body/1")],
        })
      ),
    ]);
    expect(r.report).toEqual(["1440 (2): 2 colours and 1 text style stayed plain values."]);
  });
});

describe("keys", () => {
  const set = (dark: string) => [
    version("Light", planOf({ colors: [color("#ffffff", "color/bg", "--bg")] })),
    version("Dark", planOf({ colors: [color(dark, "color/bg", "--bg")] })),
  ];

  test("keys are stable across runs, and a value change gives a new key", () => {
    const first = mergeVersions(set("#000000")).tokens.colors[0]?.key;
    expect(mergeVersions(set("#000000")).tokens.colors[0]?.key).toBe(first as string);
    expect(mergeVersions(set("#010101")).tokens.colors[0]?.key).not.toBe(first as string);
  });

  test("a key carries each value with its label, sorted by label", () => {
    expect(mergeVersions(set("#101010")).tokens.colors[0]?.key).toBe(
      "color/bg|Dark=#101010|Light=#ffffff"
    );
  });

  test("the same versions the other way round give the same key", () => {
    const reversed = set("#101010").reverse();
    expect(mergeVersions(reversed).tokens.colors[0]?.key).toBe(
      mergeVersions(set("#101010")).tokens.colors[0]?.key as string
    );
  });

  test("a mode with no value leaves its label out", () => {
    const r = mergeVersions([
      version("b", planOf({ colors: [color("#112233", "color/1")] })),
      version("a", planOf({})),
    ]);
    expect(r.tokens.colors[0]?.key).toBe("color/1|b=#112233");
  });

  test("swapping values between modes gives a new key", () => {
    const swapped = [
      version("Light", planOf({ colors: [color("#000000", "color/bg", "--bg")] })),
      version("Dark", planOf({ colors: [color("#ffffff", "color/bg", "--bg")] })),
    ];
    expect(mergeVersions(swapped).tokens.colors[0]?.key).not.toBe(
      mergeVersions(set("#000000")).tokens.colors[0]?.key as string
    );
  });

  test("a value in a different mode gives a new key", () => {
    const ink = color("#112233", "color/1");
    const keyOf = (plans: LayerPlan[]) =>
      mergeVersions(plans.map((p, i) => version(`v${i}`, p))).tokens.colors[0]?.key;
    expect(keyOf([planOf({ colors: [ink] }), planOf({}), planOf({ colors: [ink] })])).not.toBe(
      keyOf([planOf({ colors: [ink] }), planOf({ colors: [ink] }), planOf({})]) as string
    );
  });

  test("a font change gives a text style a new key, though sizes are the same", () => {
    const keyOf = (family: string) =>
      mergeVersions([
        version(
          "a",
          planOf({
            styles: [
              style("body/1", {
                fontName: { family, style: "Bold" },
                key: `["${family}"]`,
              }),
            ],
          })
        ),
      ]).tokens.textStyles[0]?.key;
    expect(keyOf("Inter")).not.toBe(keyOf("Roboto") as string);
  });

  test("the name is part of the key, so equal values under two names stay two tokens", () => {
    const r = mergeVersions([
      version(
        "a",
        planOf({
          styles: [style("body/1", { key: "same" }), style("body/2", { key: "same" })],
        })
      ),
    ]);
    expect(new Set(r.tokens.textStyles.map((s) => s.key)).size).toBe(2);
  });
});

describe("ops", () => {
  const ink = color("#111111", "color/ink", "--ink");
  const inkDark = color("#eeeeee", "color/ink", "--ink");
  const stray = color("#abcdef", "color/stray");
  const h1 = style("heading/1");
  const h1Small = style("heading/1", { fontSize: 20 });
  const strayStyle = style("body/9", { fontSize: 9 });

  const everywhere = (c: PlanColor, s: PlanTextStyle): PlanOp[] => {
    const hover: PlanHoverPatch = { path: [0], fills: [paint(c.key), paint(stray.key)] };
    const stroke = { color: rgb("#000000"), opacity: 1, weights: BORDER };
    return [
      frame("def", [paint(c.key)], {
        component: { key: "component", name: "Card", hover: [hover] },
        strokes: { ...stroke, colorKey: c.key },
      }),
      text("t", [textRun(s.key, c.key), textRun(strayStyle.key, stray.key)]),
      {
        op: "image",
        id: "i",
        parent: "def",
        name: "i",
        ...box,
        hash: "h",
        fit: "FILL",
        opacity: 1,
        radius: [0, 0, 0, 0],
        strokes: { ...stroke, colorKey: stray.key },
      },
      instance("inst", [
        { path: [0], kind: "text", text: "y", runs: [textRun(s.key, c.key)] },
        { path: [1], kind: "text", text: "z", runs: [textRun(strayStyle.key, stray.key)] },
        { path: [2], kind: "image", hash: "h" },
        { path: [3], kind: "swap", key: "other" },
      ]),
    ];
  };
  const BORDER = { top: 1, right: 1, bottom: 1, left: 1 };

  const merged = () =>
    mergeVersions([
      version("Light", planOf({ colors: [ink], styles: [h1] }, everywhere(ink, h1))),
      version(
        "Dark",
        planOf(
          { colors: [inkDark, stray], styles: [h1Small, strayStyle] },
          everywhere(inkDark, h1Small)
        )
      ),
    ]);

  test("ops in each plan point only at merged tokens", () => {
    const r = merged();
    const colors = new Set(r.tokens.colors.map((c) => c.key));
    const styles = new Set(r.tokens.textStyles.map((s) => s.key));
    expect(colors.size).toBe(1);
    expect(styles.size).toBe(1);
    for (const plan of r.plans) {
      const found = keysIn(plan.ops);
      expect(found.colors.length).toBeGreaterThan(0);
      expect(found.styles.length).toBeGreaterThan(0);
      for (const key of found.colors) expect(colors.has(key)).toBe(true);
      for (const key of found.styles) expect(styles.has(key)).toBe(true);
    }
  });

  test("the keys a plan held are not left beside the merged set", () => {
    const r = merged();
    for (const plan of r.plans) {
      expect(plan.tokens.colors).toEqual([]);
      expect(plan.tokens.textStyles).toEqual([]);
      expect(plan.tokens.collection).toBe("example.com");
    }
  });

  test("components keep their token keys through the rewrite", () => {
    const key = merged().tokens.colors[0]?.key as string;
    const styleKey = merged().tokens.textStyles[0]?.key as string;
    for (const plan of merged().plans) {
      const main = plan.ops[0] as Extract<PlanOp, { op: "frame" }>;
      expect(main.fills[0]).toMatchObject({ colorKey: key });
      expect(main.strokes?.colorKey).toBe(key);
      const label = plan.ops[1] as Extract<PlanOp, { op: "text" }>;
      expect(label.runs[0]).toMatchObject({ colorKey: key, styleKey });
    }
  });

  test("hover patches and overrides are rewritten too", () => {
    const r = merged();
    const key = r.tokens.colors[0]?.key as string;
    const styleKey = r.tokens.textStyles[0]?.key as string;
    for (const plan of r.plans) {
      const main = plan.ops[0] as Extract<PlanOp, { op: "frame" }>;
      const fills = main.component?.hover?.[0]?.fills ?? [];
      expect(fills[0]).toMatchObject({ colorKey: key });
      expect(fills[1]).not.toHaveProperty("colorKey");
      const copy = plan.ops[3] as Extract<PlanOp, { op: "instance" }>;
      expect(copy.overrides[0]).toMatchObject({ runs: [{ colorKey: key, styleKey }] });
      const unmatched = copy.overrides[1] as Extract<PlanOverride, { kind: "text" }>;
      expect(unmatched.runs[0]).not.toHaveProperty("colorKey");
      expect(unmatched.runs[0]).not.toHaveProperty("styleKey");
      expect(copy.overrides.slice(2)).toEqual([
        { path: [2], kind: "image", hash: "h" },
        { path: [3], kind: "swap", key: "other" },
      ]);
    }
  });

  test("a stroke on an image goes plain with its token", () => {
    const image = merged().plans[1]?.ops[2] as Extract<PlanOp, { op: "image" }>;
    expect(image.strokes).not.toHaveProperty("colorKey");
    expect(image.strokes?.weights).toEqual(BORDER);
  });

  test("only keys change", () => {
    const r = merged();
    const strip = (ops: PlanOp[]) =>
      JSON.stringify(ops, (field, value) =>
        field === "colorKey" || field === "styleKey" ? undefined : value
      );
    expect(strip(r.plans[1]?.ops ?? [])).toBe(strip(everywhere(inkDark, h1Small)));
  });

  test("a run shared by an op and an override is rewritten in both", () => {
    const shared = [textRun(undefined, ink.key)];
    const r = mergeVersions([
      version(
        "a",
        planOf({ colors: [ink] }, [
          text("t", shared),
          instance("i", [{ path: [0], kind: "text", text: "x", runs: shared }]),
        ])
      ),
    ]);
    const key = r.tokens.colors[0]?.key as string;
    expect(keysIn(r.plans[0]?.ops ?? []).colors).toEqual([key, key]);
  });

  test("a key with no token behind it goes plain", () => {
    const r = mergeVersions([version("a", planOf({}, [frame("f", [paint("#nothing")])]))]);
    expect(keysIn(r.plans[0]?.ops ?? []).colors).toEqual([]);
  });

  test("the input plans aren't changed, and output ops are copies", () => {
    const input = [
      version("Light", planOf({ colors: [ink], styles: [h1] }, everywhere(ink, h1))),
      version("Dark", planOf({ colors: [inkDark, stray] }, everywhere(inkDark, h1Small))),
    ];
    const before = JSON.stringify(input);
    const r = mergeVersions(input);
    expect(JSON.stringify(input)).toBe(before);
    const runOf = (plan: LayerPlan) => (plan.ops[1] as TextOp).runs[0] as PlanRun;
    expect(runOf(r.plans[0] as LayerPlan)).not.toBe(runOf(input[0]?.plan as LayerPlan));
  });

  test("the rest of a plan passes through", () => {
    const plan = planOf({}, [frame("f", [])]);
    plan.fonts = [{ family: "Inter", style: "Bold" }];
    plan.assetHashes = ["h"];
    const r = mergeVersions([version("a", plan)]);
    expect(r.plans[0]?.fonts).toEqual(plan.fonts);
    expect(r.plans[0]?.assetHashes).toEqual(plan.assetHashes);
    expect(r.plans[0]?.report).toEqual(plan.report);
  });

  test("four versions of 20,000 nodes take a linear walk", () => {
    const tokens = Array.from({ length: 200 }, (_, i) =>
      color(`#${(i + 1).toString(16).padStart(6, "0")}`, `color/${i + 1}`)
    );
    const big = planOf(
      { colors: tokens },
      Array.from({ length: 20_000 }, (_, i) =>
        frame(`f${i}`, [paint(tokens[i % tokens.length]?.key)])
      )
    );
    const started = performance.now();
    const r = mergeVersions(["a", "b", "c", "d"].map((label) => version(label, big)));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(r.tokens.colors).toHaveLength(200);
    expect(r.plans[3]?.ops).toHaveLength(20_000);
  });
});

describe("through mapCapture", () => {
  const filled = (id: string, hex: string) => {
    const base = el(id, [0, 0]);
    return { ...base, style: { ...base.style, backgroundColor: rgba(hex) } };
  };
  const heading = (id: string, size: number): CaptureNode =>
    el(id, [0, 0], [textNode(`${id}t`, { runs: [run({ size })] }) as TextNode], {
      semantic: { tag: "h1", headingLevel: 1 },
    });
  const mapped = (
    bg: string,
    size: number,
    props: Record<string, string>
  ): { plan: LayerPlan; props: Record<string, string> } => {
    const capture = cap(
      el(
        "root",
        [0, 0],
        [
          ...["a", "b", "c"].map((id) => filled(id, bg)),
          ...["x", "y", "z"].map((id) => heading(id, size)),
        ]
      )
    );
    capture.tokens.cssCustomProperties = props;
    return { plan: mapCapture(capture, inter, DEFAULT_IMPORT_OPTIONS), props };
  };

  test("real plans of two themes merge into one variable and one style", () => {
    const light = mapped("#ffffff", 40, { "--color-bg": "#ffffff" });
    const dark = mapped("#101010", 24, { "--color-bg": "#101010" });
    const r = mergeVersions([
      version("Light", light.plan, light.props),
      version("Dark", dark.plan, dark.props),
    ]);
    const bg = colorNamed(r, "color/bg");
    expect(bg?.values).toHaveLength(2);
    const fills = (r.plans[1]?.ops ?? []).flatMap((op) => (op.op === "frame" ? op.fills : []));
    expect(fills.filter((f) => f.type === "SOLID" && f.colorKey === bg?.key)).toHaveLength(3);
    const h = styleNamed(r, "heading/1");
    expect(h?.fontSize.map((f) => f.value)).toEqual([40, 24]);
    expect(keysIn(r.plans[1]?.ops ?? []).styles).toEqual([
      h?.key as string,
      h?.key as string,
      h?.key as string,
    ]);
  });
});
