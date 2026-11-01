import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IMPORT_OPTIONS,
  type FontRef,
  type ImportOptions,
  mapCapture,
  type PlanColor,
  type PlanOp,
  type PlanRun,
  type PlanSpacing,
  type PlanTextStyle,
  type PlanTokens,
} from "@repo/figma-mapper";
import { createApplier } from "../applier";
import { fakeFigma } from "./fake-figma";

type Capture = Parameters<typeof mapCapture>[0];
type CaptureNode = Capture["root"];

const inter: FontRef = { family: "Inter", style: "Regular" };
const meta = { name: "Import", fonts: [inter], totalOps: 2 };
const INK = { r: 0x11 / 255, g: 0x11 / 255, b: 0x11 / 255 };

const ink: PlanColor = {
  key: "#111111",
  name: "color/primary",
  rgba: { ...INK, a: 1 },
  cssVar: "--color-primary",
};
const body: PlanTextStyle = {
  key: "body-key",
  name: "body/1",
  fontName: inter,
  fontSize: 16,
  lineHeight: 24,
  letterSpacing: 0,
  decoration: "NONE",
  textCase: "ORIGINAL",
};
const tokens = (over: Partial<PlanTokens> = {}): PlanTokens => ({
  textStyles: [body],
  colors: [ink],
  collection: "example.com",
  ...over,
});

const frame = (id: string, parent: string | null = null, extra: object = {}): PlanOp => ({
  op: "frame",
  id,
  parent,
  name: id,
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  fills: [{ type: "SOLID", color: INK, opacity: 1, colorKey: ink.key }],
  strokes: null,
  radius: [0, 0, 0, 0],
  opacity: 1,
  effects: [],
  clips: true,
  layout: { mode: "NONE" },
  childCount: 0,
  ...extra,
});
const run = (over: Partial<PlanRun> = {}): PlanRun => ({
  start: 0,
  end: 5,
  fontName: inter,
  fontSize: 16,
  lineHeight: 24,
  letterSpacing: 0,
  color: INK,
  opacity: 1,
  decoration: "NONE",
  textCase: "ORIGINAL",
  styleKey: body.key,
  colorKey: ink.key,
  ...over,
});
const text = (id: string, parent: string, runs: PlanRun[] = [run()]): PlanOp => ({
  op: "text",
  id,
  parent,
  name: id,
  x: 0,
  y: 0,
  w: 80,
  h: 24,
  text: "hello",
  runs,
  align: "LEFT",
  wrap: false,
  lineCount: 1,
});

const options = (over: Partial<ImportOptions> = {}): ImportOptions => ({
  ...DEFAULT_IMPORT_OPTIONS,
  ...over,
});

type Fake = ReturnType<typeof fakeFigma>;

async function runImport(
  f: Fake,
  plan: PlanTokens = tokens(),
  opts: ImportOptions = options(),
  ops: PlanOp[] = [frame("a"), text("t", "a")]
) {
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.importTokens(plan, opts);
  await a.applyBatch(ops);
  return a.end();
}

const textOf = (f: Fake) => [...f.created].reverse().find((n) => n.type === "TEXT") as any;
const rangesOf = (t: any, m: string) => (t.ranges ?? []).filter((r: any) => r.m === m);
const variablesIn = (f: Fake) => [...f.tokens.variables.values()];
const stylesIn = (f: Fake) => [...f.tokens.textStyles.values()];

describe("creating tokens", () => {
  test("a text style holds the planned values, under the planned name", async () => {
    const f = fakeFigma();
    const end = await runImport(f, tokens({ textStyles: [{ ...body, letterSpacing: 0.5 }] }));
    const [style] = stylesIn(f) as [any];
    expect(style.name).toBe("body/1");
    expect(style.fontName).toEqual(inter);
    expect(style.fontSize).toBe(16);
    expect(style.lineHeight).toEqual({ unit: "PIXELS", value: 24 });
    expect(style.letterSpacing).toEqual({ unit: "PIXELS", value: 0.5 });
    expect(style.getSharedPluginData("frottage", "valueKey")).toBe(body.key);
    expect(end.stylesCreated).toBe(1);
    expect(end.stylesReused).toBe(0);
    expect(end.failedOps).toBe(0);
  });

  test("a null line height is AUTO, and decoration and case carry over", async () => {
    const f = fakeFigma();
    await runImport(
      f,
      tokens({
        textStyles: [{ ...body, lineHeight: null, decoration: "UNDERLINE", textCase: "UPPER" }],
      })
    );
    const [style] = stylesIn(f) as [any];
    expect(style.lineHeight).toEqual({ unit: "AUTO" });
    expect(style.textDecoration).toBe("UNDERLINE");
    expect(style.textCase).toBe("UPPER");
  });

  test("a variable lives in a collection named after the host, in its default mode", async () => {
    const f = fakeFigma();
    const end = await runImport(f);
    const [collection] = [...f.tokens.collections.values()] as [any];
    const [variable] = variablesIn(f) as [any];
    expect(collection.name).toBe("example.com");
    expect(variable.variableCollectionId).toBe(collection.id);
    expect(variable.name).toBe("color/primary");
    expect(variable.valuesByMode[collection.defaultModeId].r).toBeCloseTo(INK.r, 6);
    expect(variable.valuesByMode[collection.defaultModeId].a).toBe(1);
    expect(variable.getSharedPluginData("frottage", "valueKey")).toBe(ink.key);
    expect(end.variablesCreated).toBe(1);
    expect(end.variablesReused).toBe(0);
  });

  test("a variable carries WEB code syntax", async () => {
    const f = fakeFigma();
    await runImport(f);
    expect((variablesIn(f)[0] as any).codeSyntax).toEqual({ WEB: "var(--color-primary)" });
  });

  test("a variable with no custom property has no code syntax", async () => {
    const { cssVar: _, ...plain } = ink;
    const f = fakeFigma();
    await runImport(f, tokens({ colors: [{ ...plain, name: "color/1" }] }));
    expect((variablesIn(f)[0] as any).codeSyntax).toEqual({});
    expect(f.tokens.count("setVariableCodeSyntax")).toBe(0);
  });

  test("no colours means no collection", async () => {
    const f = fakeFigma();
    await runImport(f, tokens({ colors: [] }));
    expect(f.tokens.collections.size).toBe(0);
  });
});

describe("binding", () => {
  test("a paint with a token is bound to its variable, keeping its opacity", async () => {
    const f = fakeFigma();
    await runImport(f);
    const [variable] = variablesIn(f) as [any];
    const fill = f.frame("Import").fills[0];
    expect(fill.boundVariables.color.id).toBe(variable.id);
    expect(fill.opacity).toBe(1);
  });

  test("strokes bind too", async () => {
    const f = fakeFigma();
    const stroke = {
      color: INK,
      opacity: 1,
      colorKey: ink.key,
      weights: { top: 1, right: 1, bottom: 1, left: 1 },
    };
    await runImport(f, tokens(), options(), [frame("a", null, { strokes: stroke })]);
    const [variable] = variablesIn(f) as [any];
    expect(f.frame("Import").strokes[0].boundVariables.color.id).toBe(variable.id);
  });

  test("a paint without a key, or with one nothing made, stays plain", async () => {
    const f = fakeFigma();
    const fills = [
      { type: "SOLID", color: INK, opacity: 0.5 },
      { type: "SOLID", color: INK, opacity: 1, colorKey: "#nothing" },
    ];
    await runImport(f, tokens(), options(), [frame("a", null, { fills })]);
    for (const fill of f.frame("Import").fills) expect(fill.boundVariables).toBeUndefined();
  });

  test("a run with a style is linked first, and doesn't override the style's fields", async () => {
    const f = fakeFigma();
    await runImport(f);
    const t = textOf(f);
    const [style] = stylesIn(f) as [any];
    const order = t.ranges.map((r: any) => r.m);
    expect(order[0]).toBe("setRangeTextStyleIdAsync");
    expect(t.ranges[0]).toMatchObject({ s: 0, e: 5, v: style.id });
    for (const field of [
      "setRangeFontName",
      "setRangeFontSize",
      "setRangeLineHeight",
      "setRangeLetterSpacing",
      "setRangeTextDecoration",
      "setRangeTextCase",
    ]) {
      expect(rangesOf(t, field)).toHaveLength(0);
    }
  });

  test("a styled run binds its colour, which a text style doesn't hold", async () => {
    const f = fakeFigma();
    await runImport(f);
    const [variable] = variablesIn(f) as [any];
    const [fill] = rangesOf(textOf(f), "setRangeFills");
    expect(fill.v[0].boundVariables.color.id).toBe(variable.id);
  });

  test("a run with no style sets its own fields", async () => {
    const f = fakeFigma();
    const plain = run();
    delete plain.styleKey;
    await runImport(f, tokens(), options(), [frame("a"), text("t", "a", [plain])]);
    expect(rangesOf(textOf(f), "setRangeFontSize")).toHaveLength(1);
    expect(rangesOf(textOf(f), "setRangeTextStyleIdAsync")).toHaveLength(0);
  });

  test("each run links its own range", async () => {
    const f = fakeFigma();
    const other = { ...body, key: "other", name: "body/2", fontSize: 12, lineHeight: 18 };
    await runImport(f, tokens({ textStyles: [body, other] }), options(), [
      frame("a"),
      text("t", "a", [run({ end: 2 }), run({ start: 2, styleKey: "other", fontSize: 12 })]),
    ]);
    const links = rangesOf(textOf(f), "setRangeTextStyleIdAsync");
    expect(links.map((l: any) => [l.s, l.e])).toEqual([
      [0, 2],
      [2, 5],
    ]);
  });

  test("a linked run in a style keeps its link and the page's decoration", async () => {
    const f = fakeFigma();
    await runImport(f, tokens(), options(), [
      frame("a"),
      text("t", "a", [run({ href: "https://a.test/x" })]),
    ]);
    const t = textOf(f);
    expect(rangesOf(t, "setRangeHyperlink")).toHaveLength(1);
    expect(t.getRangeTextDecoration(0, 5)).toBe("NONE");
    const fills = rangesOf(t, "setRangeFills");
    expect(fills.at(-1).v[0].boundVariables).toBeDefined();
  });

  test("a styled link whose style underlines needs no override", async () => {
    const f = fakeFigma();
    await runImport(f, tokens({ textStyles: [{ ...body, decoration: "UNDERLINE" }] }), options(), [
      frame("a"),
      text("t", "a", [run({ href: "https://a.test/x", decoration: "UNDERLINE" })]),
    ]);
    expect(rangesOf(textOf(f), "setRangeTextDecoration")).toHaveLength(0);
  });

  test("line heights from a style reach text measurement", async () => {
    const f = fakeFigma({ lineHeight: 12 });
    await runImport(f);
    expect(textOf(f).height).toBe(24);
  });
});

describe("repeat imports", () => {
  test("a repeat import reuses Frottage's tokens", async () => {
    const f = fakeFigma();
    await runImport(f);
    const second = await runImport(f);
    expect(second).toMatchObject({
      stylesCreated: 0,
      stylesReused: 1,
      variablesCreated: 0,
      variablesReused: 1,
      tokenFailures: 0,
    });
    expect(f.tokens.textStyles.size).toBe(1);
    expect(f.tokens.variables.size).toBe(1);
    expect(f.tokens.collections.size).toBe(1);
  });

  test("the second import binds to the same tokens as the first", async () => {
    const f = fakeFigma();
    await runImport(f);
    const [variable] = variablesIn(f) as [any];
    const [style] = stylesIn(f) as [any];
    await runImport(f);
    const fills = f.created.filter((n) => n.type === "FRAME").map((n) => n.fills[0]);
    expect(fills.map((p) => p.boundVariables.color.id)).toEqual([variable.id, variable.id]);
    expect(rangesOf(textOf(f), "setRangeTextStyleIdAsync")[0].v).toBe(style.id);
  });

  test("fractional sizes survive Figma's 32-bit storage on a repeat import", async () => {
    const f = fakeFigma();
    const fine = { ...body, fontSize: 13.3333, lineHeight: 19.2, letterSpacing: 0.1 };
    await runImport(f, tokens({ textStyles: [fine] }));
    const second = await runImport(f, tokens({ textStyles: [fine] }));
    expect(second.stylesCreated).toBe(0);
    expect(second.stylesReused).toBe(1);
  });

  test("a repeat import doesn't touch the tokens it reuses", async () => {
    const f = fakeFigma();
    await runImport(f);
    f.tokens.writes.length = 0;
    await runImport(f);
    expect(f.tokens.writes).toEqual([]);
  });

  test("a new value continues the numbering after what the file has", async () => {
    const f = fakeFigma();
    const first = { ...ink, key: "#111111", name: "color/1", rgba: { ...INK, a: 1 } };
    const { cssVar: _, ...numbered } = first;
    await runImport(f, tokens({ colors: [numbered] }));
    const blue = { key: "#0000ff", name: "color/1", rgba: { r: 0, g: 0, b: 1, a: 1 } };
    await runImport(f, tokens({ colors: [blue] }));
    expect(variablesIn(f).map((v) => v.name)).toEqual(["color/1", "color/2"]);
    const big = { ...body, key: "big", name: "body/1", fontSize: 99 };
    await runImport(f, tokens({ textStyles: [big], colors: [] }));
    expect(stylesIn(f).map((s) => s.name)).toEqual(["body/1", "body/2"]);
  });

  test("a value that lost its name to another gets a free one", async () => {
    const f = fakeFigma();
    await runImport(f);
    const blue = {
      ...ink,
      key: "#0000ff",
      rgba: { r: 0, g: 0, b: 1, a: 1 },
    };
    const end = await runImport(f, tokens({ colors: [blue] }));
    expect(end.tokenFailures).toBe(0);
    expect(new Set(variablesIn(f).map((v) => v.name)).size).toBe(2);
  });

  test("a custom name that is free is kept, even when it looks numbered", async () => {
    const f = fakeFigma();
    const shade = { ...ink, name: "color/500", cssVar: "--c-500" };
    await runImport(f, tokens({ colors: [shade] }));
    expect(variablesIn(f)[0]?.name).toBe("color/500");
  });

  test("a Frottage token the user changed is left alone and not reused", async () => {
    const f = fakeFigma();
    await runImport(f);
    const [style] = stylesIn(f) as [any];
    const [variable] = variablesIn(f) as [any];
    style.fontSize = 18;
    variable.setValueForMode(`${variable.variableCollectionId}/0`, { r: 1, g: 0, b: 0 });
    f.tokens.writes.length = 0;
    const end = await runImport(f);
    expect(end).toMatchObject({ stylesCreated: 1, variablesCreated: 1 });
    expect(style.fontSize).toBe(18);
    expect(f.tokens.writes.filter((w) => w.startsWith(`${style.name}:`))).not.toContain(
      `${style.name}: fontSize`
    );
    expect(new Set(variablesIn(f).map((v) => v.name)).size).toBe(2);
  });

  test("a collection is found by name, and a new host gets its own", async () => {
    const f = fakeFigma();
    await runImport(f);
    const blue = { ...ink, key: "#0000ff", name: "color/blue", rgba: { r: 0, g: 0, b: 1, a: 1 } };
    await runImport(f, tokens({ colors: [blue] }));
    expect(f.tokens.collections.size).toBe(1);
    const green = { ...ink, key: "#00ff00", name: "color/g", rgba: { r: 0, g: 1, b: 0, a: 1 } };
    await runImport(f, tokens({ colors: [green], collection: "other.test" }));
    expect([...f.tokens.collections.values()].map((c) => c.name)).toEqual([
      "example.com",
      "other.test",
    ]);
  });
});

describe("a user's own tokens", () => {
  const userText = {
    fontName: inter,
    fontSize: 16,
    lineHeight: { unit: "PIXELS", value: 24 },
    letterSpacing: { unit: "PIXELS", value: 0 },
  };

  test("existing local styles match by exact value, and aren't changed", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedTextStyle("Brand/Body", userText);
    const snapshot = JSON.stringify([mine.name, mine.fontName, mine.fontSize, mine.lineHeight]);
    const end = await runImport(f);
    expect(f.tokens.textStyles.size).toBe(1);
    expect(rangesOf(textOf(f), "setRangeTextStyleIdAsync")[0].v).toBe(mine.id);
    expect(JSON.stringify([mine.name, mine.fontName, mine.fontSize, mine.lineHeight])).toBe(
      snapshot
    );
    expect(mine.getSharedPluginData("frottage", "valueKey")).toBe("");
    expect(f.tokens.writes.filter((w) => w.startsWith("Brand/Body"))).toEqual([]);
    expect(end).toMatchObject({ stylesCreated: 0, stylesReused: 1 });
  });

  test("letter spacing of 0% is the same as 0 px", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedTextStyle("Brand/Body", {
      ...userText,
      letterSpacing: { unit: "PERCENT", value: 0 },
    });
    await runImport(f);
    expect(rangesOf(textOf(f), "setRangeTextStyleIdAsync")[0].v).toBe(mine.id);
  });

  test("letter spacing in percent compares by the size it comes to", async () => {
    const f = fakeFigma();
    f.tokens.seedTextStyle("Brand/Body", {
      ...userText,
      letterSpacing: { unit: "PERCENT", value: 10 },
    });
    const end = await runImport(f, tokens({ textStyles: [{ ...body, letterSpacing: 1.6 }] }));
    expect(end).toMatchObject({ stylesCreated: 0, stylesReused: 1 });
  });

  test.each([
    ["font size", { fontSize: 15 }],
    ["line height", { lineHeight: { unit: "PIXELS", value: 25 } }],
    ["AUTO line height", { lineHeight: { unit: "AUTO" } }],
    ["letter spacing", { letterSpacing: { unit: "PIXELS", value: 1 } }],
    ["decoration", { textDecoration: "UNDERLINE" }],
    ["case", { textCase: "UPPER" }],
    ["font", { fontName: { family: "Inter", style: "Bold" } }],
    ["paragraph spacing", { paragraphSpacing: 8 }],
    ["paragraph indent", { paragraphIndent: 16 }],
    ["leading trim", { leadingTrim: "CAP_HEIGHT" }],
    ["list spacing", { listSpacing: 4 }],
    ["hanging punctuation", { hangingPunctuation: true }],
    ["hanging list", { hangingList: true }],
  ])("a style with a different %s doesn't match", async (_, change) => {
    const f = fakeFigma();
    f.tokens.seedTextStyle("Brand/Body", { ...userText, ...change });
    const end = await runImport(f);
    expect(end.stylesCreated).toBe(1);
    expect(f.tokens.textStyles.size).toBe(2);
  });

  test("a user's variable matches by value and isn't changed", async () => {
    const f = fakeFigma();
    const collection = f.tokens.seedCollection("Brand");
    const mine = f.tokens.seedVariable("ink", collection, { ...INK, a: 1 });
    const end = await runImport(f);
    expect(f.frame("Import").fills[0].boundVariables.color.id).toBe(mine.id);
    expect(f.tokens.variables.size).toBe(1);
    expect(f.tokens.collections.size).toBe(1);
    expect(f.tokens.writes.filter((w) => w.startsWith("ink"))).toEqual([]);
    expect(mine.getSharedPluginData("frottage", "valueKey")).toBe("");
    expect(end).toMatchObject({ variablesCreated: 0, variablesReused: 1 });
  });

  test("a value within 1/512 per channel is equal", async () => {
    const f = fakeFigma();
    const collection = f.tokens.seedCollection("Brand");
    const mine = f.tokens.seedVariable("ink", collection, { ...INK, r: INK.r + 1 / 600, a: 1 });
    await runImport(f);
    expect(f.frame("Import").fills[0].boundVariables.color.id).toBe(mine.id);
  });

  test("a near match doesn't bind", async () => {
    const f = fakeFigma();
    const collection = f.tokens.seedCollection("Brand");
    const near = { r: 0x11 / 255, g: 0x11 / 255, b: 0x12 / 255, a: 1 };
    const mine = f.tokens.seedVariable("ink", collection, near);
    const end = await runImport(f);
    expect(f.frame("Import").fills[0].boundVariables.color.id).not.toBe(mine.id);
    expect(end.variablesCreated).toBe(1);
  });

  test("a translucent variable doesn't match an opaque colour", async () => {
    const f = fakeFigma();
    const collection = f.tokens.seedCollection("Brand");
    f.tokens.seedVariable("ink", collection, { ...INK, a: 0.5 });
    expect((await runImport(f)).variablesCreated).toBe(1);
  });

  test("a variable only matches on its default mode", async () => {
    const f = fakeFigma();
    const collection = f.tokens.seedCollection("Brand", ["Light", "Dark"]);
    const mine = f.tokens.seedVariable("ink", collection, { r: 1, g: 1, b: 1, a: 1 });
    mine.setValueForMode(collection.modes[1].modeId, { ...INK, a: 1 });
    expect((await runImport(f)).variablesCreated).toBe(1);
  });

  test("an alias is skipped, and the variable behind it matches", async () => {
    const f = fakeFigma();
    const collection = f.tokens.seedCollection("Brand");
    const alias = f.tokens.seedVariable("alias", collection, { r: 1, g: 1, b: 1, a: 1 });
    const base = f.tokens.seedVariable("base", collection, { ...INK, a: 1 });
    alias.setValueForMode(collection.defaultModeId, { type: "VARIABLE_ALIAS", id: base.id });
    await runImport(f);
    expect(f.frame("Import").fills[0].boundVariables.color.id).toBe(base.id);
  });

  test("a user's paint style binds fills, strokes and text, without changing it", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedPaintStyle("Ink", [
      { type: "SOLID", color: INK, opacity: 1, blendMode: "NORMAL", visible: true },
    ]);
    const stroke = {
      color: INK,
      opacity: 1,
      colorKey: ink.key,
      weights: { top: 1, right: 1, bottom: 1, left: 1 },
    };
    const end = await runImport(f, tokens(), options(), [
      frame("a", null, { strokes: stroke }),
      text("t", "a"),
    ]);
    const root = f.frame("Import");
    expect(root.fillStyleId).toBe(mine.id);
    expect(root.strokeStyleId).toBe(mine.id);
    expect(root.fills[0].boundVariables).toBeUndefined();
    expect(rangesOf(textOf(f), "setRangeFillStyleIdAsync")[0].v).toBe(mine.id);
    expect(f.tokens.writes.filter((w) => w.startsWith("Ink"))).toEqual([]);
    expect(end).toMatchObject({ variablesCreated: 0, variablesReused: 0, stylesReused: 1 });
  });

  test("a fill style would replace a whole fill list, so a layered fill stays plain", async () => {
    const f = fakeFigma();
    f.tokens.seedPaintStyle("Ink", [{ type: "SOLID", color: INK, opacity: 1 }]);
    const fills = [
      { type: "SOLID", color: INK, opacity: 1, colorKey: ink.key },
      { type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 },
    ];
    await runImport(f, tokens(), options(), [frame("a", null, { fills })]);
    expect(f.tokens.count("setFillStyleIdAsync")).toBe(0);
    expect(f.frame("Import").fills).toHaveLength(2);
  });

  test.each([
    [
      "two paints",
      [
        { type: "SOLID", color: INK },
        { type: "SOLID", color: INK },
      ],
    ],
    ["a translucent paint", [{ type: "SOLID", color: INK, opacity: 0.5 }]],
    ["a hidden paint", [{ type: "SOLID", color: INK, visible: false }]],
    ["a blended paint", [{ type: "SOLID", color: INK, blendMode: "MULTIPLY" }]],
    ["a gradient", [{ type: "GRADIENT_LINEAR", gradientStops: [] }]],
  ])("a paint style with %s doesn't match", async (_, paints) => {
    const f = fakeFigma();
    f.tokens.seedPaintStyle("Ink", paints);
    expect((await runImport(f)).variablesCreated).toBe(1);
  });

  test("each paint style is read once, however many colours there are", async () => {
    const f = fakeFigma();
    f.tokens.seedPaintStyle("Ink", [{ type: "SOLID", color: INK }]);
    const blue = { ...ink, key: "#0000ff", name: "color/b", rgba: { r: 0, g: 0, b: 1, a: 1 } };
    const green = { ...ink, key: "#00ff00", name: "color/g", rgba: { r: 0, g: 1, b: 0, a: 1 } };
    await runImport(f, tokens({ colors: [blue, green, ink] }));
    expect(f.tokens.count("paints")).toBe(1);
  });

  test("Frottage's own token comes before a user's of the same value", async () => {
    const f = fakeFigma();
    await runImport(f);
    const [own] = variablesIn(f) as [any];
    const [ownStyle] = stylesIn(f) as [any];
    const brand = f.tokens.seedCollection("Brand");
    f.tokens.seedVariable("ink", brand, { ...INK, a: 1 });
    f.tokens.seedTextStyle("Brand/Body", userText);
    await runImport(f);
    expect(f.lastFrame().fills[0].boundVariables.color.id).toBe(own.id);
    expect(rangesOf(textOf(f), "setRangeTextStyleIdAsync")[0].v).toBe(ownStyle.id);
  });

  test("useLocalStyles off skips the user's tokens but still reuses Frottage's", async () => {
    const f = fakeFigma();
    await runImport(f, tokens({ colors: [] }));
    const brand = f.tokens.seedCollection("Brand");
    const mine = f.tokens.seedVariable("ink", brand, { ...INK, a: 1 });
    f.tokens.seedPaintStyle("Ink", [{ type: "SOLID", color: INK }]);
    const end = await runImport(f, tokens(), options({ useLocalStyles: false }));
    expect(end).toMatchObject({ stylesCreated: 0, stylesReused: 1, variablesCreated: 1 });
    expect(f.lastFrame().fills[0].boundVariables.color.id).not.toBe(mine.id);
    expect(f.tokens.count("setFillStyleIdAsync")).toBe(0);
  });

  test("a new name steers clear of a user's style or variable of that name", async () => {
    const f = fakeFigma();
    f.tokens.seedTextStyle("body/1", { ...userText, fontSize: 99 });
    const collection = f.tokens.seedCollection("example.com");
    collection.setSharedPluginData("frottage", "collection", "example.com");
    f.tokens.seedVariable("color/primary", collection, { r: 1, g: 0, b: 0, a: 1 });
    const end = await runImport(f, tokens(), options({ useLocalStyles: false }));
    expect(end.tokenFailures).toBe(0);
    expect(new Set(stylesIn(f).map((s) => s.name)).size).toBe(2);
    expect(new Set(variablesIn(f).map((v) => v.name)).size).toBe(2);
    expect(f.tokens.collections.size).toBe(1);
  });
});

describe("tokens off", () => {
  test("tokens off creates none", async () => {
    const f = fakeFigma();
    const end = await runImport(f, tokens(), options({ tokens: false }));
    expect(f.tokens.textStyles.size).toBe(0);
    expect(f.tokens.variables.size).toBe(0);
    expect(f.tokens.collections.size).toBe(0);
    expect(f.tokens.log).toEqual([]);
    expect(f.frame("Import").fills[0].boundVariables).toBeUndefined();
    expect(rangesOf(textOf(f), "setRangeFontSize")).toHaveLength(1);
    expect(end).toMatchObject({ stylesCreated: 0, variablesCreated: 0, tokenFailures: 0 });
  });

  test("an import that never sent tokens stays plain", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch([frame("a"), text("t", "a")]);
    const end = await a.end();
    expect(end).toMatchObject({ failedOps: 0, stylesCreated: 0, tokenFailures: 0 });
    expect(f.frame("Import").fills[0].boundVariables).toBeUndefined();
  });
});

describe("failures never fail the import", () => {
  test.each([
    ["getLocalTextStylesAsync", 1],
    ["createTextStyle", 1],
    ["getLocalVariablesAsync", 1],
    ["getLocalVariableCollectionsAsync", 1],
    ["getLocalPaintStylesAsync", 1],
    ["createVariableCollection", 1],
    ["createVariable", 1],
    ["setValueForMode", 1],
    ["setVariableCodeSyntax", 1],
    ["setBoundVariableForPaint", 3],
    ["setRangeTextStyleIdAsync", 1],
  ])("%s throwing counts and leaves plain values", async (call, failures) => {
    const f = fakeFigma({ failTokens: [call] });
    const end = await runImport(f);
    expect(end.failedOps).toBe(0);
    expect(end.rootId).not.toBe("");
    expect(end.tokenFailures).toBeGreaterThanOrEqual(failures > 1 ? 2 : 1);
    expect(textOf(f).characters).toBe("hello");
    if (call !== "setRangeTextStyleIdAsync" && !call.includes("TextStyle")) {
      expect(f.frame("Import").fills[0].boundVariables).toBeUndefined();
    }
    if (call === "setRangeTextStyleIdAsync" || call.includes("TextStyle")) {
      expect(rangesOf(textOf(f), "setRangeFontSize")).toHaveLength(1);
    }
  });

  test("a collection no variable made it into is taken back", async () => {
    const f = fakeFigma({ failTokens: ["createVariable"] });
    await runImport(f);
    expect(f.tokens.collections.size).toBe(0);
  });

  test("a half-made variable is taken back", async () => {
    const f = fakeFigma({ failTokens: ["setValueForMode"] });
    await runImport(f);
    expect(f.tokens.variables.size).toBe(0);
  });

  test("a half-made text style is taken back", async () => {
    const f = fakeFigma({ failFonts: ["Nope|Regular"] });
    const lost = { ...body, fontName: { family: "Nope", style: "Regular" } };
    const end = await runImport(f, tokens({ textStyles: [lost] }));
    expect(f.tokens.textStyles.size).toBe(0);
    expect(end.tokenFailures).toBe(1);
  });

  test("a font that isn't loaded yet is loaded before the style uses it", async () => {
    const f = fakeFigma();
    const bold = { family: "Inter", style: "Bold" };
    await runImport(f, tokens({ textStyles: [{ ...body, fontName: bold }] }));
    expect((stylesIn(f)[0] as any).fontName).toEqual(bold);
  });

  test("a style whose font can't load isn't linked; the run keeps its fallback", async () => {
    const f = fakeFigma({ failFonts: ["Nope|Regular"] });
    const lost = { family: "Nope", style: "Regular" };
    const end = await runImport(
      f,
      tokens({ textStyles: [{ ...body, fontName: lost }] }),
      options(),
      [frame("a"), text("t", "a", [run({ fontName: lost })])]
    );
    expect(end.failedOps).toBe(0);
    expect(rangesOf(textOf(f), "setRangeFontName")[0].v).toEqual(inter);
  });

  test("a user's style in a font that can't load isn't linked", async () => {
    const f = fakeFigma({ failFonts: ["Nope|Regular"] });
    const lost = { family: "Nope", style: "Regular" };
    const mine = f.tokens.seedTextStyle("Mine", {
      fontName: lost,
      fontSize: 16,
      lineHeight: { unit: "PIXELS", value: 24 },
    });
    await runImport(f, tokens({ textStyles: [{ ...body, fontName: lost }] }), options(), [
      frame("a"),
      text("t", "a", [run({ fontName: lost })]),
    ]);
    expect(rangesOf(textOf(f), "setRangeTextStyleIdAsync")).toHaveLength(0);
    expect(mine.removed).toBe(false);
  });

  test("a fill style that won't apply leaves the plain paint", async () => {
    const f = fakeFigma({ failTokens: ["setFillStyleIdAsync"] });
    f.tokens.seedPaintStyle("Ink", [{ type: "SOLID", color: INK }]);
    const end = await runImport(f);
    expect(end.failedOps).toBe(0);
    expect(end.tokenFailures).toBe(1);
    expect(f.frame("Import").fills[0].color).toEqual(INK);
  });
});

describe("the end of an import", () => {
  test("importTokens needs a begun import", async () => {
    const a = createApplier(fakeFigma().figma);
    await expect(a.importTokens(tokens(), options())).rejects.toThrow("import not started");
  });

  test("the time budget yields between creations", async () => {
    const f = fakeFigma();
    const many = Array.from({ length: 5 }, (_, i) => ({ ...body, key: `k${i}`, fontSize: 20 + i }));
    const realNow = Date.now;
    let now = 0;
    Date.now = () => (now += 600);
    try {
      const a = createApplier(f.figma);
      await a.begin(meta);
      let ticks = 0;
      const realSet = globalThis.setTimeout;
      globalThis.setTimeout = ((fn: () => void, ms?: number) => {
        ticks++;
        return realSet(fn, ms);
      }) as typeof setTimeout;
      await a.importTokens(tokens({ textStyles: many, colors: [] }), options());
      globalThis.setTimeout = realSet;
      expect(ticks).toBeGreaterThan(2);
      expect(f.tokens.textStyles.size).toBe(5);
    } finally {
      Date.now = realNow;
    }
  });

  test("cancel removes tokens this import created and nothing else", async () => {
    const f = fakeFigma();
    await runImport(f, tokens({ textStyles: [] }));
    const [earlier] = variablesIn(f) as [any];
    const mine = f.tokens.seedTextStyle("Brand/Body", { fontName: inter, fontSize: 99 });
    const a = createApplier(f.figma);
    await a.begin(meta);
    const blue = { ...ink, key: "#0000ff", name: "color/b", rgba: { r: 0, g: 0, b: 1, a: 1 } };
    await a.importTokens(tokens({ colors: [ink, blue] }), options());
    await a.applyBatch([frame("a"), text("t", "a")]);
    expect(f.tokens.textStyles.size).toBe(2);
    expect(f.tokens.variables.size).toBe(2);
    await a.cancel();
    expect(variablesIn(f)).toEqual([earlier]);
    expect(stylesIn(f)).toEqual([mine]);
    expect(f.tokens.collections.size).toBe(1);
  });

  test("cancel removes a collection it created and leaves one it found", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    await a.cancel();
    expect(f.tokens.collections.size).toBe(0);

    const kept = f.tokens.seedCollection("example.com");
    const b = createApplier(f.figma);
    await b.begin(meta);
    await b.importTokens(tokens(), options());
    await b.cancel();
    expect([...f.tokens.collections.values()]).toEqual([kept]);
  });

  test("a created style something else now uses stays", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    await a.applyBatch([frame("a"), text("t", "a")]);
    const [style] = stylesIn(f) as [any];
    const other = f.raw_createText();
    other.characters = "mine";
    await other.setRangeTextStyleIdAsync(0, 4, style.id);
    await a.cancel();
    expect(stylesIn(f)).toEqual([style]);
  });

  test("a created variable a layer outside the import uses stays", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    await a.applyBatch([frame("a")]);
    const [variable] = variablesIn(f) as [any];
    const outside = f.figma.createFrame() as any;
    outside.fills = [
      f.figma.variables.setBoundVariableForPaint({ type: "SOLID", color: INK }, "color", variable),
    ];
    await a.cancel();
    expect(variablesIn(f)).toEqual([variable]);
    expect(f.tokens.collections.size).toBe(1);
  });

  test("a created variable another variable points at stays", async () => {
    const f = fakeFigma();
    const brand = f.tokens.seedCollection("Brand");
    const alias = f.tokens.seedVariable("alias", brand, { r: 1, g: 1, b: 1, a: 1 });
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    const [, made] = variablesIn(f) as [any, any];
    alias.setValueForMode(brand.defaultModeId, { type: "VARIABLE_ALIAS", id: made.id });
    await a.cancel();
    expect(f.tokens.variables.has(made.id)).toBe(true);
  });

  test("when usage can't be read, a token stays", async () => {
    const f = fakeFigma({ failTokens: ["getStyleConsumersAsync"] });
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens({ colors: [] }), options());
    await a.cancel();
    expect(f.tokens.textStyles.size).toBe(1);
  });

  test("cancel while tokens are being made leaves none behind", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    const pending = a.importTokens(tokens(), options());
    await a.cancel();
    await pending;
    expect(f.tokens.textStyles.size).toBe(0);
    expect(f.tokens.variables.size).toBe(0);
    expect(f.tokens.collections.size).toBe(0);
  });

  test("cancel during a style link stops the op without touching the next import", async () => {
    const f = fakeFigma();
    // With only reused tokens, cancelling has nothing to clean, so the next begin comes first.
    await runImport(f);
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    await a.applyBatch([frame("a")]);
    // The first text is now suspended in its style link.
    const batch = a.applyBatch([text("t1", "a"), text("t2", "a")]);
    await a.cancel();
    await a.begin(meta);
    await batch;
    await a.importTokens(tokens({ textStyles: [], colors: [] }), options());
    await a.applyBatch([frame("b")]);
    const end = await a.end();
    expect(end.failedOps).toBe(0);
    expect(end.rootId).not.toBe("");
    expect(f.created.filter((n) => n.type === "TEXT")).toHaveLength(2);
  });

  test("a finished import keeps its tokens, even when it is cancelled afterwards", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    await a.applyBatch([frame("a"), text("t", "a")]);
    await a.end();
    await a.cancel();
    expect(f.tokens.textStyles.size).toBe(1);
    expect(f.tokens.variables.size).toBe(1);
  });

  test("a finished import keeps a token that nothing ended up using", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    await a.applyBatch([frame("a", null, { fills: [] })]);
    await a.end();
    await a.begin(meta);
    expect(f.tokens.textStyles.size).toBe(1);
    expect(f.tokens.variables.size).toBe(1);
  });

  test("an import whose root failed keeps no tokens", async () => {
    const f = fakeFigma({ failOn: "Import" });
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    await a.applyBatch([frame("a")]);
    const end = await a.end();
    expect(end.rootId).toBe("");
    await a.begin(meta);
    expect(f.tokens.textStyles.size).toBe(0);
    expect(f.tokens.variables.size).toBe(0);
  });

  test("a new import waits for the last one's cleaning", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    await a.applyBatch([frame("a")]);
    void a.cancel();
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    await a.applyBatch([frame("b"), text("t", "b")]);
    const end = await a.end();
    expect(end).toMatchObject({ stylesCreated: 1, variablesCreated: 1, tokenFailures: 0 });
    expect(f.tokens.textStyles.size).toBe(1);
    expect(f.tokens.variables.size).toBe(1);
  });

  test("a cancelled end reports no tokens", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(tokens(), options());
    await a.cancel();
    await expect(a.end()).rejects.toThrow("import not started");
  });
});

describe("from a capture", () => {
  const clear = { r: 0, g: 0, b: 0, a: 0 };
  const side = { width: 0, color: clear, style: "none" };
  const common = {
    box: { x: 0, y: 0, w: 100, h: 20 },
    paintOrder: 0,
    visible: true,
    opacity: 1,
    blendMode: "normal",
  };
  const blue = { r: 0x12 / 255, g: 0x34 / 255, b: 0x56 / 255, a: 1 };
  const panel = (id: string, children: CaptureNode[] = []): CaptureNode => ({
    ...common,
    id,
    kind: "element",
    semantic: { tag: "div" },
    style: {
      backgroundColor: blue,
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
  });
  const line = (id: string): CaptureNode => ({
    ...common,
    id,
    kind: "text",
    semantic: { tag: "p" },
    text: "Hello",
    lines: [common.box],
    runs: [
      {
        start: 0,
        end: 5,
        family: "Inter",
        weight: 400,
        style: "normal",
        size: 13.3333,
        lineHeight: 19.2,
        letterSpacing: 0.1,
        color: blue,
        decoration: "none",
        transform: "none",
        align: "left",
      },
    ],
  });
  const capture = (): Capture => ({
    schemaVersion: 1,
    capturedAt: "2026-01-01T00:00:00Z",
    tool: { name: "test", version: "0" },
    source: {
      url: "https://www.example.com/a",
      title: "t",
      viewport: { w: 800, h: 600 },
      scrollSize: { w: 800, h: 600 },
      devicePixelRatio: 1,
      colorScheme: "light",
    },
    tokens: { cssCustomProperties: { "--color-brand": "#123456" } },
    fonts: [],
    assets: [],
    warnings: [],
    root: panel("root", [panel("a", [line("x"), line("y"), line("z")]), panel("b")]),
  });

  test("importing the same page twice creates no duplicates", async () => {
    const f = fakeFigma();
    const plan = mapCapture(capture(), [inter]);
    expect(plan.tokens.colors.map((c) => c.name)).toEqual(["color/brand"]);
    expect(plan.tokens.textStyles).toHaveLength(1);

    const first = await runImport(f, plan.tokens, options(), plan.ops);
    expect(first).toMatchObject({ stylesCreated: 1, variablesCreated: 1, tokenFailures: 0 });

    const again = mapCapture(capture(), [inter]);
    const second = await runImport(f, again.tokens, options(), again.ops);
    expect(second).toMatchObject({
      failedOps: 0,
      stylesCreated: 0,
      stylesReused: 1,
      variablesCreated: 0,
      variablesReused: 1,
      tokenFailures: 0,
    });
    expect(f.tokens.textStyles.size).toBe(1);
    expect(f.tokens.variables.size).toBe(1);
    expect(f.tokens.collections.size).toBe(1);
    expect([...f.tokens.collections.values()][0].name).toBe("www.example.com");
    expect((variablesIn(f)[0] as any).codeSyntax.WEB).toBe("var(--color-brand)");
  });
});

// ---------- Spacing

const gap: PlanSpacing = { key: "--space-4=16", name: "spacing/4", cssVar: "--space-4", px: 16 };
const auto = (keys: object, over: object = {}) => ({
  mode: "HORIZONTAL" as const,
  wrap: false,
  itemSpacing: 16,
  counterSpacing: null,
  padding: [16, 0, 8, 0] as [number, number, number, number],
  primaryAlign: "MIN" as const,
  counterAlign: "MIN" as const,
  sizingH: "FIXED" as const,
  sizingV: "FIXED" as const,
  spacingKeys: keys,
  ...over,
});
const bound = (f: Fake, name = "Import") => f.frame(name).boundVariables ?? {};
const spacingTokens = (spacing: PlanSpacing[] = [gap]) =>
  tokens({ textStyles: [], colors: [], spacing });

describe("spacing variables", () => {
  test("a gap and a side of padding bind to one Frottage number variable", async () => {
    const f = fakeFigma();
    const layout = auto({
      itemSpacing: gap.key,
      padding: [gap.key, undefined, undefined, undefined],
    });
    const end = await runImport(f, spacingTokens(), options(), [frame("a", null, { layout })]);
    const [variable] = variablesIn(f) as [any];
    expect(variable.name).toBe("spacing/4");
    expect(variable.resolvedType).toBe("FLOAT");
    expect(variable.codeSyntax.WEB).toBe("var(--space-4)");
    expect(variable.getSharedPluginData("frottage", "valueKey")).toBe(gap.key);
    expect(Object.values(variable.valuesByMode)).toEqual([16]);
    expect(bound(f).itemSpacing.id).toBe(variable.id);
    expect(bound(f).paddingTop.id).toBe(variable.id);
    expect(bound(f).paddingLeft).toBeUndefined();
    // The plain values are set as well.
    expect(f.frame("Import").itemSpacing).toBe(16);
    expect(f.frame("Import").paddingTop).toBe(16);
    expect(end.variablesCreated).toBe(1);
    expect(end.tokenFailures).toBe(0);
  });

  test("gaps and padding bind", async () => {
    const f = fakeFigma();
    const wrap = auto(
      {
        itemSpacing: gap.key,
        counterSpacing: gap.key,
        padding: [undefined, gap.key, gap.key, gap.key],
      },
      { wrap: true, counterSpacing: 16 }
    );
    const grid = {
      mode: "GRID" as const,
      rows: [{ type: "FIXED" as const, value: 20 }],
      columns: [{ type: "FIXED" as const, value: 20 }],
      rowGap: 16,
      columnGap: 16,
      padding: [0, 0, 0, 0] as [number, number, number, number],
      spacingKeys: { rowGap: gap.key, columnGap: gap.key },
    };
    await runImport(f, spacingTokens(), options(), [
      frame("a", null, { layout: wrap, childCount: 1 }),
      frame("g", "a", { layout: grid }),
    ]);
    const id = (variablesIn(f)[0] as any).id;
    expect(Object.fromEntries(Object.entries(bound(f)).map(([k, v]: any) => [k, v.id]))).toEqual({
      itemSpacing: id,
      counterAxisSpacing: id,
      paddingRight: id,
      paddingBottom: id,
      paddingLeft: id,
    });
    expect(bound(f, "g")).toMatchObject({ gridRowGap: { id }, gridColumnGap: { id } });
  });

  test("a refused binding keeps the plain value and counts", async () => {
    const f = fakeFigma({ failTokens: ["node.setBoundVariable"] });
    const layout = auto({ itemSpacing: gap.key });
    const end = await runImport(f, spacingTokens(), options(), [frame("a", null, { layout })]);
    expect(f.frame("Import").itemSpacing).toBe(16);
    expect(bound(f)).toEqual({});
    expect(end.tokenFailures).toBe(1);
    expect(end.failedOps).toBe(0);
  });

  test("a variable that cannot be made leaves plain values and counts", async () => {
    const f = fakeFigma({ failTokens: ["createVariable"] });
    const layout = auto({ itemSpacing: gap.key });
    const end = await runImport(f, spacingTokens(), options(), [frame("a", null, { layout })]);
    expect(f.frame("Import").itemSpacing).toBe(16);
    expect(end.tokenFailures).toBeGreaterThan(0);
  });

  test("a second import reuses the variable by its key", async () => {
    const f = fakeFigma();
    const layout = auto({ itemSpacing: gap.key });
    await runImport(f, spacingTokens(), options(), [frame("a", null, { layout })]);
    const end = await runImport(f, spacingTokens(), options(), [frame("a", null, { layout })]);
    expect(variablesIn(f)).toHaveLength(1);
    expect(end.variablesReused).toBe(1);
    expect(end.variablesCreated).toBe(0);
  });

  test("a user's number variable with the same value is neither bound nor written", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedCollection("Mine");
    const theirs = f.tokens.seedVariable("space", mine, 16, "FLOAT");
    const layout = auto({ itemSpacing: gap.key });
    await runImport(f, spacingTokens(), options(), [frame("a", null, { layout })]);
    expect(variablesIn(f)).toHaveLength(2);
    expect(bound(f).itemSpacing.id).not.toBe(theirs.id);
    expect(f.tokens.writes.filter((w) => w.startsWith("space:"))).toEqual([]);
  });

  test("the options switch for styles and variables turns it off", async () => {
    const f = fakeFigma();
    const layout = auto({ itemSpacing: gap.key });
    await runImport(f, spacingTokens(), options({ tokens: false }), [frame("a", null, { layout })]);
    expect(variablesIn(f)).toHaveLength(0);
    expect(bound(f)).toEqual({});
    expect(f.frame("Import").itemSpacing).toBe(16);
  });
});
