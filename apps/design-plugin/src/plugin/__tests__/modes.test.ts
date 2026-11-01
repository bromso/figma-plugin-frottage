import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IMPORT_OPTIONS,
  type FontRef,
  type ImportOptions,
  type ModeValue,
  type PlanColor,
  type PlanModeColor,
  type PlanModeSpacing,
  type PlanModeType,
  type PlanOp,
  type PlanVersionTokens,
} from "@repo/figma-mapper";
import { createApplier } from "../applier";
import { createTokenSet, type TokenRuntime } from "../tokens";
import { fakeFigma } from "./fake-figma";

type Fake = ReturnType<typeof fakeFigma>;
type Rgba = { r: number; g: number; b: number; a: number };

const inter: FontRef = { family: "Inter", style: "Regular" };
const meta = { name: "Import", fonts: [inter], totalOps: 2 };
const INK: Rgba = { r: 0.25, g: 0.25, b: 0.25, a: 1 };
const PAPER: Rgba = { r: 0.75, g: 0.75, b: 0.75, a: 1 };
const SKY: Rgba = { r: 0.25, g: 0.5, b: 0.75, a: 1 };

const hex = (c: Rgba) => `${c.r}.${c.g}.${c.b}`;
const perMode = <T>(list: T[]): ModeValue<T>[] => list.map((value, mode) => ({ mode, value }));

/** As `mergeVersions` makes it: the key is the name and the values by mode. */
function color(name: string, list: Rgba[], over: Partial<PlanModeColor> = {}): PlanModeColor {
  return {
    key: [name, ...list.map(hex)].join("|"),
    name,
    values: perMode(list),
    from: list.map(hex),
    ...over,
  };
}
function role(
  name: string,
  sizes: number[],
  lines: (number | null)[],
  over: Partial<PlanModeType> = {}
): PlanModeType {
  return {
    key: [name, ...sizes.map((s, i) => `${s}/${lines[i]}`)].join("|"),
    name,
    fontName: inter,
    letterSpacing: perMode(sizes.map(() => 0)),
    decoration: "NONE",
    textCase: "ORIGINAL",
    fontSize: perMode(sizes),
    lineHeight: perMode(lines),
    from: sizes.map((s, i) => `${name}:${s}/${lines[i]}`),
    ...over,
  };
}
const set = (over: Partial<PlanVersionTokens> = {}): PlanVersionTokens => ({
  collection: "example.com",
  modes: ["Light", "Dark"],
  colors: [color("color/primary", [INK, PAPER])],
  textStyles: [],
  ...over,
});
const options = (over: Partial<ImportOptions> = {}): ImportOptions => ({
  ...DEFAULT_IMPORT_OPTIONS,
  ...over,
});

const runtimeFor = (f: Fake, over: Partial<TokenRuntime> = {}): TokenRuntime => ({
  overBudget: () => false,
  breathe: async () => true,
  ensureFont: async (font) => {
    await f.figma.loadFontAsync(font);
    return true;
  },
  ...over,
});

/** Settles a set on its own, so a test can ask for its modes. */
async function settle(
  f: Fake,
  plan: PlanVersionTokens = set(),
  opts: ImportOptions = options(),
  runtime: TokenRuntime = runtimeFor(f)
) {
  const tokens = createTokenSet(f.figma);
  await tokens.resolveModes(plan, opts, runtime);
  return tokens;
}

/** A single file with one colour, imported to the end. */
async function importFile(f: Fake, colorToken: PlanColor) {
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.importTokens(
    { textStyles: [], colors: [colorToken], collection: "example.com" },
    options()
  );
  return a.end();
}

const collectionsIn = (f: Fake) => [...f.tokens.collections.values()] as any[];
const variablesIn = (f: Fake) => [...f.tokens.variables.values()] as any[];
const stylesIn = (f: Fake) => [...f.tokens.textStyles.values()] as any[];
const variableNamed = (f: Fake, name: string) => variablesIn(f).find((v) => v.name === name);
const modeNames = (c: any) => c.modes.map((m: any) => m.name);
const modeId = (c: any, name: string) => c.modes.find((m: any) => m.name === name).modeId;
/** The channel where the three test colours all differ. */
const channel = (v: { g: number }) => v.g;
/** Tags a variable as Frottage's, as Stages 1 and 2 left it. */
const tagged = (variable: any, key: string) => {
  variable.setSharedPluginData("frottage", "valueKey", key);
  return variable;
};

describe("modes", () => {
  test("a new collection names its default mode after the first version", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    expect(collection.modes[0].modeId).toBe(collection.defaultModeId);
    expect(collection.modes[0].name).toBe("Light");
  });

  test("each later version adds a mode", async () => {
    const f = fakeFigma();
    const tokens = await settle(f, set({ modes: ["Light", "Dark", "Dim"] }));
    const [collection] = collectionsIn(f);
    expect(modeNames(collection)).toEqual(["Light", "Dark", "Dim"]);
    expect(tokens.modeOf(0)).toEqual({ collection, modeId: modeId(collection, "Light") });
    expect(tokens.modeOf(2)).toEqual({ collection, modeId: modeId(collection, "Dim") });
    expect(tokens.modeOf(3)).toBeNull();
    expect(tokens.counts().modes).toBe(3);
    expect(tokens.counts().modesDropped).toBe(0);
  });

  test("a new collection is tagged, so that it stays Frottage's", async () => {
    const f = fakeFigma();
    await settle(f);
    expect(collectionsIn(f)[0].getSharedPluginData("frottage", "collection")).not.toBe("");
  });

  test("each value is set per mode, and a missing one reads the first", async () => {
    const f = fakeFigma();
    const token = color("color/primary", [INK, PAPER, SKY], {
      values: [
        { mode: 0, value: INK },
        { mode: 2, value: SKY },
      ],
    });
    await settle(f, set({ modes: ["A", "B", "C"], colors: [token] }));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "A")))).toBe(INK.g);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "B")))).toBe(INK.g);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "C")))).toBe(SKY.g);
    expect(variable.getSharedPluginData("frottage", "valueKey")).toBe(token.key);
  });

  test("a paint keyed by a merged token binds to its variable", async () => {
    const f = fakeFigma();
    const token = color("color/primary", [INK, PAPER]);
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importModes(set({ colors: [token] }), options());
    const op: PlanOp = {
      op: "frame",
      id: "a",
      parent: null,
      name: "a",
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      fills: [{ type: "SOLID", color: INK, opacity: 1, colorKey: token.key }],
      strokes: null,
      radius: [0, 0, 0, 0],
      opacity: 1,
      effects: [],
      clips: true,
      layout: { mode: "NONE" },
      childCount: 0,
    };
    await a.applyBatch([op]);
    const end = await a.end();
    expect(f.frame("Import").fills[0].boundVariables.color.id).toBe(variablesIn(f)[0].id);
    expect(end.modes).toBe(2);
    expect(end.modesDropped).toBe(0);
    expect(end.variablesCreated).toBe(1);
  });

  test("a single-file import reports no modes", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens({ textStyles: [], colors: [], collection: "example.com" }, options());
    const end = await a.end();
    expect(end.modes).toBe(0);
    expect(end.modesDropped).toBe(0);
  });

  test("tokens off makes no modes", async () => {
    const f = fakeFigma();
    await settle(f, set(), options({ tokens: false }));
    expect(f.tokens.collections.size).toBe(0);
  });

  test("an existing mode with the same label is reused", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["Light", "Dark"] }));
    f.tokens.writes.length = 0;
    const tokens = await settle(
      f,
      set({ modes: ["Dark", "Dim"], colors: [color("color/other", [SKY, PAPER])] })
    );
    const [collection] = collectionsIn(f);
    expect(modeNames(collection)).toEqual(["Light", "Dark", "Dim"]);
    expect(f.tokens.count("renameMode")).toBe(1);
    expect(tokens.modeOf(0)?.modeId).toBe(modeId(collection, "Dark"));
    const variable = variableNamed(f, "color/other");
    // The first version's mode isn't the default, which still needs its value.
    expect(channel(f.tokens.valueIn(variable, collection.defaultModeId))).toBe(SKY.g);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "Dark")))).toBe(SKY.g);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "Dim")))).toBe(PAPER.g);
  });
});

describe("text styles", () => {
  test("size and line height bind to float variables on the style", async () => {
    const f = fakeFigma();
    const body = role("body/1", [16, 14], [24, 20]);
    const tokens = await settle(f, set({ colors: [], textStyles: [body] }));
    const [collection] = collectionsIn(f);
    const [style] = stylesIn(f);
    const size = variableNamed(f, "type/body/1/size");
    const line = variableNamed(f, "type/body/1/line-height");
    expect(size.resolvedType).toBe("FLOAT");
    expect(line.variableCollectionId).toBe(collection.id);
    expect(style.boundVariables.fontSize.id).toBe(size.id);
    expect(style.boundVariables.lineHeight.id).toBe(line.id);
    expect(style.fontSize).toBe(16);
    expect(style.lineHeight).toEqual({ unit: "PIXELS", value: 24 });
    expect(f.tokens.valueIn(size, modeId(collection, "Dark"))).toBe(14);
    expect(f.tokens.valueIn(line, modeId(collection, "Dark"))).toBe(20);
    expect(tokens.textStyleId(body.key)).toBe(style.id);
    expect(tokens.counts()).toMatchObject({ stylesCreated: 1, variablesCreated: 2 });
  });

  test("letter spacing that varies binds to a tracking variable", async () => {
    const f = fakeFigma();
    const body = role("body/1", [16, 14], [24, 20], { letterSpacing: perMode([-0.32, -0.28]) });
    await settle(f, set({ colors: [], textStyles: [body] }));
    const [collection] = collectionsIn(f);
    const [style] = stylesIn(f);
    const tracking = variableNamed(f, "type/body/1/tracking");
    expect(tracking.resolvedType).toBe("FLOAT");
    expect(style.boundVariables.letterSpacing.id).toBe(tracking.id);
    expect(style.letterSpacing.value).toBeCloseTo(-0.32, 5);
    expect(f.tokens.valueIn(tracking, modeId(collection, "Dark"))).toBeCloseTo(-0.28, 5);
  });

  test("a repeat import reuses the tracking variable", async () => {
    const f = fakeFigma();
    const body = role("body/1", [16, 14], [24, 20], { letterSpacing: perMode([-0.32, -0.28]) });
    await settle(f, set({ colors: [], textStyles: [body] }));
    const again = await settle(f, set({ colors: [], textStyles: [body] }));
    expect(again.counts()).toMatchObject({ stylesCreated: 0, variablesCreated: 0 });
  });

  test("only what varies gets a variable", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [], textStyles: [role("body/1", [16, 14], [24, 24])] }));
    expect(variablesIn(f).map((v) => v.name)).toEqual(["type/body/1/size"]);
    expect(stylesIn(f)[0].boundVariables.lineHeight).toBeUndefined();
    expect(stylesIn(f)[0].boundVariables.letterSpacing).toBeUndefined();
  });

  test("a version with no line height leaves the variable at the first mode's", async () => {
    const f = fakeFigma();
    await settle(
      f,
      set({
        modes: ["A", "B", "C"],
        colors: [],
        textStyles: [role("body/1", [16, 16, 16], [24, null, 20])],
      })
    );
    const [collection] = collectionsIn(f);
    const line = variableNamed(f, "type/body/1/line-height");
    expect(f.tokens.valueIn(line, modeId(collection, "B"))).toBe(24);
    expect(f.tokens.valueIn(line, modeId(collection, "C"))).toBe(20);
  });

  test("a first version with no line height stays AUTO, with no variable", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [], textStyles: [role("body/1", [16, 14], [null, 20])] }));
    expect(variablesIn(f).map((v) => v.name)).toEqual(["type/body/1/size"]);
    expect(stylesIn(f)[0].lineHeight).toEqual({ unit: "AUTO" });
  });

  test("a role with one value everywhere has no variables and reuses a user's style", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedTextStyle("Body", {
      fontName: inter,
      fontSize: 16,
      lineHeight: { unit: "PIXELS", value: 24 },
      letterSpacing: { unit: "PIXELS", value: 0 },
    });
    const body = role("body/1", [16, 16], [24, 24]);
    const tokens = await settle(f, set({ colors: [], textStyles: [body] }));
    expect(tokens.textStyleId(body.key)).toBe(mine.id);
    expect(f.tokens.variables.size).toBe(0);
    expect(tokens.counts().stylesReused).toBe(1);
  });

  test("a varying role never binds a user's style that matches its first value", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedTextStyle("Body", {
      fontName: inter,
      fontSize: 16,
      lineHeight: { unit: "PIXELS", value: 24 },
      letterSpacing: { unit: "PIXELS", value: 0 },
    });
    const body = role("body/1", [16, 14], [24, 20]);
    const tokens = await settle(f, set({ colors: [], textStyles: [body] }));
    expect(tokens.textStyleId(body.key)).not.toBe(mine.id);
    expect(mine.boundVariables).toBeUndefined();
    expect(f.tokens.writes.filter((w) => w.startsWith("Body:"))).toEqual([]);
  });

  test("a style of Frottage's that varies isn't taken for a role with one value", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [], textStyles: [role("body/1", [16, 14], [24, 20])] }));
    const flat = role("note/1", [16, 16], [24, 24]);
    const tokens = await settle(f, set({ colors: [], textStyles: [flat] }));
    expect(tokens.counts().stylesCreated).toBe(1);
    expect(stylesIn(f)).toHaveLength(2);
  });

  test("a refused binding counts and takes the style away, so its runs stay plain", async () => {
    const f = fakeFigma({ failTokens: ["textStyle.setBoundVariable"] });
    const body = role("body/1", [16, 14], [24, 24]);
    const tokens = await settle(f, set({ colors: [], textStyles: [body] }));
    expect(tokens.textStyleId(body.key)).toBeUndefined();
    expect(stylesIn(f)).toHaveLength(0);
    expect(tokens.counts().tokenFailures).toBe(1);
    expect(tokens.counts().stylesCreated).toBe(0);
    expect(f.tokens.variables.size).toBe(0);
  });

  test("a field refused after another bound takes back the style and that variable", async () => {
    const f = fakeFigma({ failStyleBinding: "lineHeight" });
    const body = role("body/1", [16, 14], [24, 20]);
    const other = color("color/primary", [INK, PAPER]);
    const tokens = await settle(f, set({ colors: [other], textStyles: [body] }));
    expect(tokens.textStyleId(body.key)).toBeUndefined();
    expect(stylesIn(f)).toHaveLength(0);
    expect(variablesIn(f).map((v) => v.name)).toEqual(["color/primary"]);
    expect(tokens.counts()).toMatchObject({
      tokenFailures: 1,
      stylesCreated: 0,
      variablesCreated: 1,
    });
    expect(tokens.modeOf(1)).not.toBeNull();
  });

  test("a font that won't load counts and leaves the role plain", async () => {
    const f = fakeFigma();
    const body = role("body/1", [16, 14], [24, 20]);
    const tokens = await settle(
      f,
      set({ colors: [], textStyles: [body] }),
      options(),
      runtimeFor(f, { ensureFont: async () => false })
    );
    expect(tokens.textStyleId(body.key)).toBeUndefined();
    expect(tokens.counts().tokenFailures).toBe(1);
  });
});

describe("mode limits", () => {
  const three = (over: Partial<PlanVersionTokens> = {}) =>
    set({
      modes: ["A", "B", "C"],
      colors: [color("color/primary", [INK, PAPER, SKY])],
      ...over,
    });

  test("Limited to N modes keeps every frame, uses the first values and reports it", async () => {
    const f = fakeFigma({ modeLimit: 2 });
    const tokens = await settle(f, three());
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(modeNames(collection)).toEqual(["A", "B"]);
    expect(tokens.modeOf(1)).not.toBeNull();
    expect(tokens.modeOf(2)).toBeNull();
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "B")))).toBe(PAPER.g);
    expect(tokens.counts()).toMatchObject({ modes: 2, modesDropped: 1, tokenFailures: 0 });
    expect(tokens.color(color("color/primary", [INK, PAPER, SKY]).key)).toBeDefined();
  });

  test("Starter's limit of one mode behaves the same", async () => {
    const f = fakeFigma({ modeLimit: 1 });
    const token = color("color/primary", [INK, PAPER]);
    const tokens = await settle(f, set({ colors: [token] }));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(modeNames(collection)).toEqual(["Light"]);
    expect(channel(variable.valuesByMode[collection.defaultModeId])).toBe(INK.g);
    expect(tokens.modeOf(0)).not.toBeNull();
    expect(tokens.modeOf(1)).toBeNull();
    expect(tokens.counts()).toMatchObject({ modes: 1, modesDropped: 1, tokenFailures: 0 });
  });

  test("with one mode left, a varying token reuses a user's variable like any other", async () => {
    const f = fakeFigma({ modeLimit: 1 });
    const library = f.tokens.seedCollection("Brand");
    const mine = f.tokens.seedVariable("ink", library, INK);
    const token = color("color/primary", [INK, PAPER]);
    const tokens = await settle(f, set({ colors: [token] }));
    expect((tokens.color(token.key) as any).variable).toBe(mine);
    // Nothing needed the collection, so it goes, and no version has a mode.
    expect(collectionsIn(f)).toEqual([library]);
    expect(tokens.modeOf(0)).toBeNull();
    // The first version keeps its tokens: only the second lost anything.
    expect(tokens.counts()).toMatchObject({ modes: 0, modesDropped: 1, droppedVersions: [1] });
  });

  test("with one mode left, a varying role keeps its first values and no variables", async () => {
    const f = fakeFigma({ modeLimit: 1 });
    await settle(f, set({ colors: [], textStyles: [role("body/1", [16, 14], [24, 20])] }));
    expect(f.tokens.variables.size).toBe(0);
    expect(stylesIn(f)[0].fontSize).toBe(16);
  });

  test("any other addMode failure counts and stops the rest", async () => {
    const f = fakeFigma({ failTokens: ["addMode"] });
    const tokens = await settle(f, three());
    expect(f.tokens.count("addMode")).toBe(1);
    expect(tokens.counts()).toMatchObject({ modes: 1, modesDropped: 2, tokenFailures: 1 });
  });

  test("a collection that can't be made counts and reports every version", async () => {
    const f = fakeFigma({ failTokens: ["createVariableCollection"] });
    const tokens = await settle(f, set());
    expect(tokens.counts()).toMatchObject({ modes: 0, modesDropped: 2, tokenFailures: 1 });
  });

  test("a collection whose modes can't be settled fits no variable", async () => {
    const f = fakeFigma();
    const token = color("color/flat", [INK, INK]);
    await settle(f, set({ colors: [token] }));
    const [collection] = collectionsIn(f);
    Object.defineProperty(collection, "modes", {
      get: () => {
        throw new Error("no modes");
      },
    });
    const tokens = await settle(f, set({ colors: [token] }));
    expect(tokens.color(token.key)).toBeUndefined();
    expect(tokens.counts().tokenFailures).toBe(1);
  });

  test("a full collection still reuses the labels it has", async () => {
    const f = fakeFigma({ modeLimit: 2 });
    await settle(f, set({ modes: ["A", "B"] }));
    const tokens = await settle(
      f,
      set({ modes: ["C", "B"], colors: [color("color/other", [SKY, PAPER])] })
    );
    const [collection] = collectionsIn(f);
    expect(modeNames(collection)).toEqual(["A", "B"]);
    // No room for its label, so the first version takes the default mode, which nobody claimed.
    expect(tokens.modeOf(0)?.modeId).toBe(collection.defaultModeId);
    expect(tokens.modeOf(1)?.modeId).toBe(modeId(collection, "B"));
    expect(tokens.counts()).toMatchObject({ modes: 2, modesDropped: 0 });
    const variable = variableNamed(f, "color/other");
    expect(channel(variable.valuesByMode[collection.defaultModeId])).toBe(SKY.g);
    expect(channel(variable.valuesByMode[modeId(collection, "B")])).toBe(PAPER.g);
  });

  test("a new variable's default mode takes the first value, unless a version holds it", async () => {
    const f = fakeFigma({ modeLimit: 3 });
    await settle(f, set({ modes: ["A", "B"] }));
    await settle(f, set({ modes: ["Y", "B", "Z"], colors: [color("color/y", [SKY, PAPER, INK])] }));
    const [collection] = collectionsIn(f);
    const y = variableNamed(f, "color/y");
    expect(channel(y.valuesByMode[collection.defaultModeId])).toBe(SKY.g);

    await settle(f, set({ modes: ["W", "A", "B"], colors: [color("color/w", [SKY, INK, PAPER])] }));
    const w = variableNamed(f, "color/w");
    expect(modeNames(collection)).toEqual(["A", "B", "Y"]);
    expect(channel(w.valuesByMode[collection.defaultModeId])).toBe(INK.g);
    expect(channel(f.tokens.valueIn(w, modeId(collection, "B")))).toBe(PAPER.g);
  });
});

describe("whose collection", () => {
  test("a user's collection of the same name is left alone", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedCollection("example.com", ["Value"]);
    const theirs = f.tokens.seedVariable("ink", mine, SKY);
    const tokens = await settle(f);
    const made = collectionsIn(f).find((c) => c !== mine);
    expect(made.name).toBe("example.com (Frottage)");
    expect(modeNames(mine)).toEqual(["Value"]);
    expect(theirs.variableCollectionId).toBe(mine.id);
    expect(tokens.modeOf(1)?.collection.id).toBe(made.id);
    expect(f.tokens.writes.filter((w) => w.startsWith("example.com:"))).toEqual([]);
    expect(f.tokens.writes.filter((w) => w.startsWith("ink:"))).toEqual([]);
  });

  test("a repeat import finds the collection named for Frottage first", async () => {
    const f = fakeFigma();
    f.tokens.seedCollection("example.com", ["Value"]);
    await settle(f);
    await settle(f, set({ colors: [color("color/other", [SKY, PAPER])] }));
    expect(collectionsIn(f)).toHaveLength(2);
    const made = collectionsIn(f).find((c) => c.name === "example.com (Frottage)");
    expect(variableNamed(f, "color/other").variableCollectionId).toBe(made.id);
  });

  test("the collection named for Frottage wins over an older one of the plain name", async () => {
    const f = fakeFigma();
    const older = f.tokens.seedCollection("example.com");
    tagged(f.tokens.seedVariable("color/old", older, SKY), "old");
    const newer = f.tokens.seedCollection("example.com (Frottage)");
    tagged(f.tokens.seedVariable("color/new", newer, SKY), "new");
    const tokens = await settle(f);
    expect(tokens.modeOf(0)?.collection.id).toBe(newer.id);
    expect(modeNames(older)).toEqual(["Mode 1"]);
  });

  test("a single file's collection is tagged as well", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    const ink = { key: "#404040", name: "color/ink", rgba: INK, uses: 3 };
    await a.importTokens({ textStyles: [], colors: [ink], collection: "example.com" }, options());
    await a.end();
    expect(collectionsIn(f)[0].getSharedPluginData("frottage", "collection")).not.toBe("");
  });

  test("an empty collection of the same name isn't Frottage's", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedCollection("example.com", ["Value"]);
    await settle(f);
    expect(mine.variableIds).toEqual([]);
    expect(modeNames(mine)).toEqual(["Value"]);
  });

  test("a collection with one variable of the user's isn't Frottage's", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedCollection("example.com", ["Value"]);
    tagged(f.tokens.seedVariable("old", mine, SKY), "#404080");
    f.tokens.seedVariable("gap", mine, 8, "FLOAT");
    await settle(f);
    expect(modeNames(mine)).toEqual(["Value"]);
    expect(collectionsIn(f)).toHaveLength(2);
  });

  test("an older Frottage collection is recognised by its tagged variables", async () => {
    const f = fakeFigma();
    const older = f.tokens.seedCollection("example.com");
    tagged(f.tokens.seedVariable("color/old", older, SKY), "#4080bf");
    const tokens = await settle(f);
    expect(collectionsIn(f)).toEqual([older]);
    // Its default mode exists, so it keeps its name.
    expect(modeNames(older)).toEqual(["Mode 1", "Light", "Dark"]);
    expect(older.getSharedPluginData("frottage", "collection")).not.toBe("");
    expect(tokens.modeOf(0)?.modeId).toBe(modeId(older, "Light"));
    const variable = variableNamed(f, "color/primary");
    expect(channel(f.tokens.valueIn(variable, older.defaultModeId))).toBe(INK.g);
    expect(channel(f.tokens.valueIn(variable, modeId(older, "Dark")))).toBe(PAPER.g);
  });

  test("a tagged collection stays Frottage's after the user adds a variable", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    const theirs = f.tokens.seedVariable("mine", collection, SKY);
    await settle(f, set({ colors: [color("color/other", [SKY, PAPER])] }));
    expect(collectionsIn(f)).toEqual([collection]);
    expect(Object.keys(theirs.valuesByMode)).toEqual([collection.defaultModeId]);
  });
});

describe("whose variable", () => {
  test("a user's variable is never given a mode value", async () => {
    const f = fakeFigma();
    const library = f.tokens.seedCollection("Brand");
    const mine = f.tokens.seedVariable("ink", library, INK);
    const token = color("color/primary", [INK, PAPER]);
    const tokens = await settle(f, set({ colors: [token] }));
    const binding = tokens.color(token.key) as { variable: { id: string } };
    expect(binding.variable.id).not.toBe(mine.id);
    expect(f.tokens.writes.filter((w) => w.startsWith("ink:"))).toEqual([]);
    expect(f.tokens.writes.filter((w) => w.startsWith("Brand:"))).toEqual([]);
  });

  test("a single-value token still reuses a user's variable", async () => {
    const f = fakeFigma();
    const library = f.tokens.seedCollection("Brand");
    const mine = f.tokens.seedVariable("ink", library, INK);
    const token = color("color/primary", [INK, INK]);
    const tokens = await settle(f, set({ colors: [token] }));
    expect((tokens.color(token.key) as any).variable).toBe(mine);
    expect(tokens.counts()).toMatchObject({ variablesReused: 1, variablesCreated: 0 });
    expect(f.tokens.writes.filter((w) => w.startsWith("ink:"))).toEqual([]);
    expect(f.tokens.collections.size).toBe(1);
    expect(tokens.modeOf(0)).toBeNull();
    expect(tokens.counts()).toMatchObject({ modes: 0, modesDropped: 0 });
  });

  test("a single-value token still reuses a user's paint style", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedPaintStyle("Ink", [
      { type: "SOLID", color: { r: INK.r, g: INK.g, b: INK.b } },
    ]);
    const token = color("color/primary", [INK, INK]);
    const tokens = await settle(f, set({ colors: [token] }));
    expect(tokens.color(token.key)).toEqual({ paintStyleId: mine.id });
  });

  test("a single-value token with local reuse off makes a variable", async () => {
    const f = fakeFigma();
    f.tokens.seedVariable("ink", f.tokens.seedCollection("Brand"), INK);
    const token = color("color/primary", [INK, INK]);
    const tokens = await settle(f, set({ colors: [token] }), options({ useLocalStyles: false }));
    expect(tokens.counts().variablesCreated).toBe(1);
    expect(modeNames(tokens.modeOf(1)?.collection)).toEqual(["Light", "Dark"]);
  });

  test("a single-value token reuses a single file's variable by its value's key", async () => {
    const f = fakeFigma();
    const older = f.tokens.seedCollection("example.com");
    const made = tagged(f.tokens.seedVariable("color/primary", older, INK), hex(INK));
    const token = color("color/primary", [INK, INK]);
    const tokens = await settle(f, set({ colors: [token] }), options({ useLocalStyles: false }));
    expect(tokens.color(token.key)).toEqual({ variable: made });
  });

  test("a varying variable of Frottage's isn't taken for a single value", async () => {
    const f = fakeFigma();
    await settle(f);
    const token = color("color/flat", [INK, INK]);
    const tokens = await settle(f, set({ colors: [token] }));
    expect(tokens.counts()).toMatchObject({ variablesCreated: 1, variablesReused: 0 });
  });

  test("a varying variable in another collection is left where it is", async () => {
    const f = fakeFigma();
    const token = color("color/primary", [INK, PAPER]);
    const elsewhere = f.tokens.seedCollection("Moved", ["Light", "Dark"]);
    const moved = tagged(f.tokens.seedVariable("moved", elsewhere, INK), token.key);
    f.tokens.writes.length = 0;
    const tokens = await settle(f, set({ colors: [token] }));
    const binding = tokens.color(token.key) as { variable: { id: string } };
    expect(binding.variable.id).not.toBe(moved.id);
    expect(f.tokens.writes.filter((w) => w.startsWith("moved:"))).toEqual([]);
  });

  test("a changed value makes a new variable beside the old one", async () => {
    const f = fakeFigma();
    await settle(f);
    await settle(f, set({ colors: [color("color/primary", [INK, SKY])] }));
    expect(variablesIn(f).map((v) => v.name)).toEqual(["color/primary", "color/primary-2"]);
  });

  test("a variable the user changed isn't reused, and stays as it is", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    variable.setValueForMode(modeId(collection, "Dark"), SKY);
    f.tokens.writes.length = 0;
    const tokens = await settle(f);
    expect(tokens.counts()).toMatchObject({ variablesCreated: 1, variablesReused: 0 });
    expect(channel(variable.valuesByMode[modeId(collection, "Dark")])).toBe(SKY.g);
  });
});

describe("repeat imports", () => {
  const full = () =>
    set({
      colors: [color("color/primary", [INK, PAPER], { cssVar: "--ink" })],
      textStyles: [role("body/1", [16, 14], [24, 20])],
    });

  test("a repeat import of the same set creates nothing", async () => {
    const f = fakeFigma();
    await settle(f, full());
    f.tokens.writes.length = 0;
    const tokens = await settle(f, full());
    expect(f.tokens.writes).toEqual([]);
    expect(tokens.counts()).toMatchObject({
      stylesCreated: 0,
      stylesReused: 1,
      variablesCreated: 0,
      variablesReused: 3,
      modes: 2,
      modesDropped: 0,
      tokenFailures: 0,
    });
    expect(tokens.modeOf(1)).not.toBeNull();
  });

  test("a repeat import of values that don't vary finds its modes", async () => {
    const f = fakeFigma();
    const flat = () => set({ colors: [color("color/primary", [INK, INK])] });
    await settle(f, flat());
    f.tokens.writes.length = 0;
    const tokens = await settle(f, flat());
    expect(f.tokens.writes).toEqual([]);
    expect(tokens.modeOf(1)).not.toBeNull();
  });

  test("the same values under new labels fill the modes they add", async () => {
    const f = fakeFigma();
    await settle(f);
    const tokens = await settle(f, set({ modes: ["Day", "Night"] }));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(tokens.counts()).toMatchObject({ variablesCreated: 0, variablesReused: 1 });
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "Night")))).toBe(PAPER.g);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "Day")))).toBe(INK.g);
  });

  test("a mode Figma copied gets the value asked for, with no duplicate", async () => {
    const f = fakeFigma();
    const flat = () => color("color/a", [INK, PAPER]);
    await settle(f, set({ colors: [flat()] }));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    // The new mode copies Dark, but holds the first value in this set.
    const tokens = await settle(f, set({ modes: ["Day", "Dark"], colors: [flat()] }));
    expect(modeNames(collection)).toEqual(["Light", "Dark", "Day"]);
    expect(channel(variable.valuesByMode[modeId(collection, "Day")])).toBe(INK.g);
    expect(tokens.counts()).toMatchObject({ variablesCreated: 0, variablesReused: 1 });
    expect(variablesIn(f)).toHaveLength(1);
  });

  test("a bound style survives a mode Figma copied", async () => {
    const f = fakeFigma();
    const body = () => role("body/1", [16, 14], [24, 24]);
    await settle(f, set({ colors: [], textStyles: [body()] }));
    const [collection] = collectionsIn(f);
    const tokens = await settle(
      f,
      set({ modes: ["Day", "Dark"], colors: [], textStyles: [body()] })
    );
    expect(stylesIn(f)).toHaveLength(1);
    expect(tokens.counts()).toMatchObject({ stylesReused: 1, variablesReused: 1 });
    const size = variableNamed(f, "type/body/1/size");
    expect(size.valuesByMode[modeId(collection, "Day")]).toBe(16);
  });

  test("a value the user changed in a mode that was there still rules a variable out", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    variable.setValueForMode(modeId(collection, "Dark"), SKY);
    const tokens = await settle(f, set({ modes: ["Day", "Dark"] }));
    expect(tokens.counts()).toMatchObject({ variablesCreated: 1, variablesReused: 0 });
  });

  test("a reused role fills the modes it adds, and gains no new binding", async () => {
    const f = fakeFigma();
    await settle(f, full());
    const [collection] = collectionsIn(f);
    await settle(f, { ...full(), modes: ["Day", "Night"] });
    const size = variableNamed(f, "type/body/1/size");
    expect(f.tokens.valueIn(size, modeId(collection, "Night"))).toBe(14);
    expect(f.tokens.count("textStyle.setBoundVariable")).toBe(2);
  });

  test("a style made while modes were out of reach isn't taken for a varying role", async () => {
    const limits = { modeLimit: 1 };
    const f = fakeFigma(limits);
    const roles = [role("body/1", [16, 14], [24, 24]), role("note/1", [12, 12], [18, 16])];
    await settle(f, set({ colors: [], textStyles: roles }));
    const flat = stylesIn(f);
    limits.modeLimit = 10;
    await settle(f, set({ colors: [], textStyles: roles }));
    expect(stylesIn(f)).toHaveLength(4);
    expect(flat.map((s) => s.boundVariables)).toEqual([undefined, undefined]);
  });
});

describe("taking it back", () => {
  test("cancel removes created modes and variables", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["Mode 0"] }));
    const [collection] = collectionsIn(f);
    const before = variablesIn(f);
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importModes(
      set({
        modes: ["Mode 0", "Dark"],
        colors: [color("color/other", [SKY, PAPER])],
        textStyles: [role("body/1", [16, 14], [24, 20])],
      }),
      options()
    );
    expect(modeNames(collection)).toEqual(["Mode 0", "Dark"]);
    await a.cancel();
    expect(modeNames(collection)).toEqual(["Mode 0"]);
    expect(variablesIn(f)).toEqual(before);
    expect(stylesIn(f)).toEqual([]);
    expect(collectionsIn(f)).toEqual([collection]);
  });

  test("cancel removes a collection it made whole", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importModes(set(), options());
    await a.cancel();
    expect(f.tokens.collections.size).toBe(0);
    expect(f.tokens.count("removeMode")).toBe(0);
  });

  test("cancel leaves modes a variable still in use needs", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["One"] }));
    const [collection] = collectionsIn(f);
    const token = color("color/other", [SKY, PAPER]);
    const tokens = createTokenSet(f.figma);
    await tokens.resolveModes(
      set({ modes: ["One", "Two"], colors: [token] }),
      options(),
      runtimeFor(f)
    );
    const { variable } = tokens.color(token.key) as { variable: any };
    const elsewhere = f.tokens.seedVariable("alias", collection, {
      type: "VARIABLE_ALIAS",
      id: variable.id,
    });
    await tokens.discard();
    expect(elsewhere.valuesByMode[collection.defaultModeId].id).toBe(variable.id);
    expect(variablesIn(f)).toContain(variable);
    expect(modeNames(collection)).toEqual(["One", "Two"]);
  });

  test("cancel keeps a float variable that a kept style is bound to", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [color("color/a", [INK, PAPER])] }));
    const body = role("body/1", [16, 14], [24, 24]);
    const tokens = createTokenSet(f.figma);
    await tokens.resolveModes(set({ colors: [], textStyles: [body] }), options(), runtimeFor(f));
    const style = f.tokens.textStyleById(tokens.textStyleId(body.key) as string) as any;
    style.getStyleConsumersAsync = async () => [{ node: {}, fields: ["textStyleId"] }];
    await tokens.discard();
    expect(variableNamed(f, "type/body/1/size")).toBeDefined();
  });

  test("a cancel during mode writes leaves nothing behind", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["One"], colors: [color("color/a", [INK])] }));
    const [collection] = collectionsIn(f);
    const before = variablesIn(f);
    const tokens = createTokenSet(f.figma);
    let breaths = 0;
    let discarding: Promise<void> | undefined;
    await tokens.resolveModes(
      set({ modes: ["One", "Two", "Three"], colors: [color("color/b", [SKY, PAPER, INK])] }),
      options(),
      runtimeFor(f, {
        overBudget: () => true,
        breathe: async () => {
          // After the modes, while the new variable's values go in.
          if (++breaths === 3) discarding = tokens.discard();
          await new Promise((resolve) => setTimeout(resolve, 0));
          return true;
        },
      })
    );
    await discarding;
    expect(variablesIn(f)).toEqual(before);
    expect(modeNames(collection)).toEqual(["One"]);
  });
});

describe("the time budget", () => {
  test("mode writes yield to Figma", async () => {
    const f = fakeFigma();
    let breaths = 0;
    await settle(
      f,
      set({ modes: ["A", "B", "C", "D"], colors: [color("color/a", [INK, PAPER, SKY, INK])] }),
      options(),
      runtimeFor(f, {
        overBudget: () => true,
        breathe: async () => {
          breaths++;
          return true;
        },
      })
    );
    // One for each mode added, one for the token, and one for each value past the default.
    expect(breaths).toBeGreaterThanOrEqual(3 + 1 + 2);
  });
});

describe("every mode holds a value", () => {
  test("a new variable has one in every mode, outside the set too", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["Old", "Other"] }));
    await settle(f, set({ modes: ["Other", "New"], colors: [color("color/b", [SKY, PAPER])] }));
    const [collection] = collectionsIn(f);
    const variable = variableNamed(f, "color/b");
    expect(Object.keys(variable.valuesByMode).sort()).toEqual(
      collection.modes.map((m: any) => m.modeId).sort()
    );
    expect(channel(variable.valuesByMode[modeId(collection, "Old")])).toBe(SKY.g);
  });

  test("a single value is set in every mode", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [color("color/flat", [INK, INK])] }));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(channel(variable.valuesByMode[modeId(collection, "Dark")])).toBe(INK.g);
  });

  test("a single file's new variable is set in every mode of a Frottage collection", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    await importFile(f, { key: "#4080bf", name: "color/sky", rgba: SKY, uses: 3 });
    const variable = variableNamed(f, "color/sky");
    expect(channel(variable.valuesByMode[modeId(collection, "Dark")])).toBe(SKY.g);
  });

  test("a reused variable of Frottage's gets a value in an added mode", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [color("color/flat", [INK, INK])] }));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    const tokens = await settle(
      f,
      set({ modes: ["Light", "Dim"], colors: [color("color/flat", [INK, INK])] })
    );
    expect(channel(variable.valuesByMode[modeId(collection, "Dim")])).toBe(INK.g);
    expect(tokens.counts()).toMatchObject({ variablesCreated: 0, variablesReused: 1 });
  });

  test("a variable of Frottage's with an unset mode is filled in", async () => {
    const f = fakeFigma();
    const older = f.tokens.seedCollection("example.com", ["One", "Two"]);
    const token = color("color/flat", [INK, INK]);
    const made = tagged(f.tokens.seedVariable("color/flat", older, INK), token.key);
    await settle(f, set({ modes: ["One", "Two"], colors: [token] }));
    expect(channel(made.valuesByMode[modeId(older, "Two")])).toBe(INK.g);
  });

  test("a reused variable of Frottage's is filled in outside the set too", async () => {
    const f = fakeFigma();
    const older = f.tokens.seedCollection("example.com", ["One", "Two", "Three"]);
    const token = color("color/flat", [INK, INK]);
    const made = tagged(f.tokens.seedVariable("color/flat", older, INK), token.key);
    await settle(f, set({ modes: ["One", "Two"], colors: [token] }));
    expect(channel(made.valuesByMode[modeId(older, "Three")])).toBe(INK.g);
  });

  test("the earliest version leads, though a later one's label was found first", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["X", "B"] }));
    await settle(
      f,
      set({ modes: ["A", "B"], colors: [], textStyles: [role("note/1", [12, 12], [null, 20])] })
    );
    expect(stylesIn(f)[0].lineHeight).toEqual({ unit: "AUTO" });
  });

  test("a user's variable in Frottage's collection isn't used for a mode it has no value in", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    const theirs = f.tokens.seedVariable("mine", collection, SKY);
    theirs.setValueForMode(modeId(collection, "Dark"), SKY);
    f.tokens.writes.length = 0;
    const token = color("color/sky", [SKY, SKY]);
    const tokens = await settle(f, set({ modes: ["Light", "Added"], colors: [token] }));
    expect(tokens.counts()).toMatchObject({ variablesCreated: 1, variablesReused: 0 });
    expect(f.tokens.writes.filter((w) => w.startsWith("mine:"))).toEqual([]);
  });
});

describe("a later version on the only mode left", () => {
  /** One slot, taken by label by the second version, while the first can't be placed. */
  async function lastModeHeld(f: Fake, plan: PlanVersionTokens) {
    const tokens = await settle(f, plan);
    expect(tokens.modeOf(0)).toBeNull();
    expect(tokens.modeOf(1)).not.toBeNull();
    return tokens;
  }

  test("a colour, size, line height and tracking all come from the held version", async () => {
    const f = fakeFigma({ modeLimit: 2 });
    await settle(f, set({ modes: ["A", "B"] }));
    const paint = color("color/late", [SKY, PAPER]);
    const body = role("body/1", [16, 14], [24, 20], {
      letterSpacing: [
        { mode: 0, value: 0 },
        { mode: 1, value: 1 },
      ],
    });
    const tokens = await lastModeHeld(
      f,
      set({ modes: ["Z", "A"], colors: [paint], textStyles: [body] })
    );
    expect(tokens.counts().droppedVersions).toEqual([0]);
    const [collection] = collectionsIn(f);
    const variable = variableNamed(f, "color/late");
    expect(channel(variable.valuesByMode[modeId(collection, "A")])).toBe(PAPER.g);
    const style = stylesIn(f).at(-1);
    expect(style.fontSize).toBe(14);
    expect(style.lineHeight).toEqual({ unit: "PIXELS", value: 20 });
    expect(style.letterSpacing).toEqual({ unit: "PIXELS", value: 1 });
    expect(style.boundVariables).toBeUndefined();
  });

  test("the held value matches a user's variable, not the dropped one's", async () => {
    const f = fakeFigma({ modeLimit: 2 });
    await settle(f, set({ modes: ["A", "B"] }));
    const mine = f.tokens.seedVariable("mine", f.tokens.seedCollection("Brand"), PAPER);
    const token = color("color/late", [SKY, PAPER]);
    const tokens = await lastModeHeld(f, set({ modes: ["Z", "A"], colors: [token] }));
    expect((tokens.color(token.key) as any).variable).toBe(mine);
  });
});

describe("a single file and the user's collection", () => {
  const sky = { key: "#4080bf", name: "color/sky", rgba: SKY, uses: 3 };

  test("a user's collection of the same name is left alone", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedCollection("example.com");
    f.tokens.seedVariable("ink", mine, INK);
    await importFile(f, sky);
    const variable = variableNamed(f, "color/sky");
    expect(variable.variableCollectionId).not.toBe(mine.id);
    expect(f.tokens.collections.get(variable.variableCollectionId)?.name).toBe(
      "example.com (Frottage)"
    );
    await importFile(f, { key: "#bfbfbf", name: "color/paper", rgba: PAPER, uses: 3 });
    expect(collectionsIn(f)).toHaveLength(2);
  });

  test("an older Frottage collection is still used", async () => {
    const f = fakeFigma();
    const older = f.tokens.seedCollection("example.com");
    tagged(f.tokens.seedVariable("color/old", older, INK), "#404040");
    await importFile(f, sky);
    expect(variableNamed(f, "color/sky").variableCollectionId).toBe(older.id);
  });
});

describe("a renamed collection", () => {
  test("is found by its tag", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    collection.name = "Web tokens";
    const tokens = await settle(f, set({ colors: [color("color/b", [SKY, PAPER])] }));
    expect(collectionsIn(f)).toEqual([collection]);
    expect(tokens.modeOf(0)?.collection.id).toBe(collection.id);
  });

  test("tagged for another host isn't taken for this one by its name", async () => {
    const f = fakeFigma();
    await settle(f, set({ collection: "other.org" }));
    const [theirs] = collectionsIn(f);
    theirs.name = "example.com";
    await settle(f);
    expect(modeNames(theirs)).toEqual(["Light", "Dark"]);
    expect(collectionsIn(f).at(-1).name).toBe("example.com (Frottage)");
    expect(variablesIn(f)).toHaveLength(2);
  });

  test("an early tag with no host counts as tagged, by name", async () => {
    const f = fakeFigma();
    const early = f.tokens.seedCollection("example.com");
    early.setSharedPluginData("frottage", "collection", "1");
    f.tokens.seedVariable("mine", early, SKY);
    const tokens = await settle(f);
    expect(collectionsIn(f)).toEqual([early]);
    expect(tokens.modeOf(0)?.collection.id).toBe(early.id);
  });

  test("an early tag on a collection of another name isn't this host's", async () => {
    const f = fakeFigma();
    const early = f.tokens.seedCollection("other.org");
    early.setSharedPluginData("frottage", "collection", "1");
    await settle(f);
    expect(collectionsIn(f)).toHaveLength(2);
    expect(modeNames(early)).toEqual(["Mode 1"]);
  });

  test("of another host isn't", async () => {
    const f = fakeFigma();
    await settle(f, set({ collection: "other.org" }));
    const [theirs] = collectionsIn(f);
    theirs.name = "Web tokens";
    await settle(f);
    expect(collectionsIn(f)).toHaveLength(2);
  });
});

describe("a role's own style", () => {
  const body = () => role("body/1", [16, 14], [24, 24]);

  test("bound outside the home collection makes a new style", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [], textStyles: [body()] }));
    const [style] = stylesIn(f);
    const other = f.tokens.seedCollection("Sizes", ["Light", "Dark"]);
    style.setBoundVariable("fontSize", f.tokens.seedVariable("size", other, 16, "FLOAT"));
    await settle(f, set({ colors: [], textStyles: [body()] }));
    expect(stylesIn(f)).toHaveLength(2);
  });

  test("bound to values that no longer match makes a new style", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [], textStyles: [body()] }));
    const [collection] = collectionsIn(f);
    variableNamed(f, "type/body/1/size").setValueForMode(modeId(collection, "Dark"), 30);
    const tokens = await settle(f, set({ colors: [], textStyles: [body()] }));
    expect(stylesIn(f)).toHaveLength(2);
    expect(tokens.counts().stylesReused).toBe(0);
    expect(stylesIn(f).at(-1).boundVariables.fontSize).toBeDefined();
  });

  test("bound to a field that doesn't vary here is checked as well", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [], textStyles: [body()] }));
    const [style] = stylesIn(f);
    const other = f.tokens.seedCollection("Lines", ["Light", "Dark"]);
    style.setBoundVariable("lineHeight", f.tokens.seedVariable("line", other, 24, "FLOAT"));
    await settle(f, set({ colors: [], textStyles: [body()] }));
    expect(stylesIn(f)).toHaveLength(2);
  });
});

describe("a collection with no room", () => {
  test("Starter's existing collection gives the first version its default mode", async () => {
    const f = fakeFigma({ modeLimit: 1 });
    await settle(f, set({ modes: ["Only"] }));
    const [collection] = collectionsIn(f);
    f.tokens.writes.length = 0;
    const token = color("color/b", [SKY, PAPER]);
    const tokens = await settle(f, set({ modes: ["New", "Other"], colors: [token] }));
    expect(tokens.modeOf(0)?.modeId).toBe(collection.defaultModeId);
    expect(tokens.modeOf(1)).toBeNull();
    expect(modeNames(collection)).toEqual(["Only"]);
    expect(f.tokens.count("renameMode")).toBe(1);
    expect(tokens.counts()).toMatchObject({ modes: 1, modesDropped: 1, droppedVersions: [1] });
    expect(tokens.color(token.key)).toBeDefined();
  });

  test("the default mode stays with a version whose label it has", async () => {
    const f = fakeFigma({ modeLimit: 2 });
    await settle(f, set({ modes: ["A", "B"] }));
    const tokens = await settle(
      f,
      set({ modes: ["Z", "A"], colors: [color("color/b", [SKY, PAPER])] })
    );
    expect(tokens.modeOf(0)).toBeNull();
    expect(tokens.counts().droppedVersions).toEqual([0]);
  });
});

describe("an edited variable", () => {
  test("with all labels new isn't reused or written", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    variable.setValueForMode(collection.defaultModeId, SKY);
    f.tokens.writes.length = 0;
    const tokens = await settle(f, set({ modes: ["Day", "Night"] }));
    expect(tokens.counts()).toMatchObject({ variablesCreated: 1, variablesReused: 0 });
    expect(f.tokens.writes.filter((w) => w.startsWith("color/primary:"))).toEqual([]);
  });
});

describe("what the report gets", () => {
  test("a role that's AUTO in every version stays AUTO", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [], textStyles: [role("body/1", [16, 14], [null, null])] }));
    expect(stylesIn(f)[0].lineHeight).toEqual({ unit: "AUTO" });
    expect(variablesIn(f).map((v) => v.name)).toEqual(["type/body/1/size"]);
  });

  test("reading the file failing still reports the versions without a mode", async () => {
    const f = fakeFigma({ failTokens: ["getLocalVariablesAsync"] });
    const tokens = await settle(f);
    expect(tokens.counts()).toMatchObject({
      modes: 0,
      modesDropped: 2,
      droppedVersions: [0, 1],
      tokenFailures: 1,
    });
  });

  test("no version is dropped when nothing needed a mode", async () => {
    const f = fakeFigma();
    f.tokens.seedVariable("ink", f.tokens.seedCollection("Brand"), INK);
    const tokens = await settle(f, set({ colors: [color("color/flat", [INK, INK])] }));
    expect(tokens.counts().droppedVersions).toEqual([]);
    expect(tokens.modeOf(0)).toBeNull();
  });
});

describe("collections Frottage can't change", () => {
  test.each(["isExtension", "remote"])(
    "a tagged collection with %s is left alone",
    async (flag) => {
      const f = fakeFigma();
      await settle(f);
      const [collection] = collectionsIn(f);
      collection[flag] = true;
      await settle(f);
      expect(collectionsIn(f)).toHaveLength(2);
    }
  );
});

describe("cancel and a frame's bound variables", () => {
  test("a variable a frame's field is bound to stays", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["One"] }));
    const body = role("body/1", [16, 14], [24, 24]);
    const tokens = createTokenSet(f.figma);
    await tokens.resolveModes(
      set({ modes: ["One", "Two"], colors: [], textStyles: [body] }),
      options(),
      runtimeFor(f)
    );
    const size = variableNamed(f, "type/body/1/size");
    const node = f.figma.createFrame() as any;
    node.boundVariables = { itemSpacing: { type: "VARIABLE_ALIAS", id: size.id } };
    f.figma.currentPage.appendChild(node);
    await tokens.discard();
    expect(variableNamed(f, "type/body/1/size")).toBeDefined();
    expect(modeNames(collectionsIn(f)[0])).toEqual(["One", "Two"]);
  });
});

describe("spacing across modes", () => {
  /** As `mergeVersions` makes it: the key is the property and the values by mode. */
  function spacing(cssVar: string, list: number[], over: Partial<PlanModeSpacing> = {}) {
    return {
      key: [`spacing:${cssVar}`, ...list.map((px, i) => `m${i}=${px}`)].join("|"),
      name: `spacing/${cssVar.slice(2)}`,
      cssVar,
      values: perMode(list),
      from: list.map((px) => `${cssVar}=${px}`),
      ...over,
    } satisfies PlanModeSpacing;
  }
  const only = (spacingTokens: PlanModeSpacing[], over: Partial<PlanVersionTokens> = {}) =>
    set({ colors: [], spacing: spacingTokens, ...over });

  test("a spacing variable holds one value per mode, and is named spacing/<name>", async () => {
    const f = fakeFigma();
    await settle(f, only([spacing("--gap", [24, 12])]));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(variable.name).toBe("spacing/gap");
    expect(variable.resolvedType).toBe("FLOAT");
    expect(variable.codeSyntax.WEB).toBe("var(--gap)");
    expect(f.tokens.valueIn(variable, modeId(collection, "Light"))).toBe(24);
    expect(f.tokens.valueIn(variable, modeId(collection, "Dark"))).toBe(12);
  });

  test("modes vary by custom property name: a mode with no value reads the first", async () => {
    const f = fakeFigma();
    const token = spacing("--gap", [24, 12], { values: [{ mode: 0, value: 24 }] });
    await settle(f, only([token], { modes: ["A", "B", "C"] }));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    for (const mode of ["A", "B", "C"]) {
      expect(f.tokens.valueIn(variable, modeId(collection, mode))).toBe(24);
    }
  });

  test("every mode gets a value, in the modes beyond the limit too", async () => {
    const f = fakeFigma({ modeLimit: 2 });
    const tokens = await settle(
      f,
      only([spacing("--gap", [24, 12, 8])], { modes: ["A", "B", "C"] })
    );
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(tokens.counts().modesDropped).toBe(1);
    for (const { modeId: id } of collection.modes) {
      expect(variable.valuesByMode[id]).not.toBeUndefined();
    }
  });

  /** One two-box row per version, its gap the token's value in that version's mode. */
  async function importRows(f: Fake, token: PlanModeSpacing, opts: { labels?: string[] } = {}) {
    const a = createApplier(f.figma);
    await a.beginSet();
    await a.importModes(only([token], { modes: opts.labels ?? ["Light", "Dark"] }), options());
    const frames: PlanOp[][] = token.values.map(({ value: px }) => [
      {
        op: "frame",
        id: "a",
        parent: null,
        name: "a",
        x: 0,
        y: 0,
        w: 100 + px,
        h: 40,
        fills: [],
        strokes: null,
        radius: [0, 0, 0, 0],
        opacity: 1,
        effects: [],
        clips: true,
        layout: {
          mode: "HORIZONTAL",
          wrap: false,
          itemSpacing: px,
          counterSpacing: null,
          padding: [0, 0, 0, 0],
          primaryAlign: "MIN",
          counterAlign: "MIN",
          sizingH: "FIXED",
          sizingV: "FIXED",
          spacingKeys: { itemSpacing: token.key },
        },
        childCount: 2,
      },
      ...[0, 50 + px].map(
        (x, i): PlanOp => ({
          op: "placeholder",
          id: `b${i}`,
          parent: "a",
          name: `b${i}`,
          x,
          y: 0,
          w: 50,
          h: 40,
          opacity: 1,
          label: "b",
          childLayout: { positioning: "AUTO", sizingH: "FIXED", sizingV: "FIXED" },
        })
      ),
    ]);
    for (const [i, ops] of frames.entries()) {
      await a.begin({ ...meta, version: { index: i, label: ["Light", "Dark"][i] as string } });
      await a.applyBatch(ops);
      await a.end();
    }
    return a.endSet();
  }

  test("a frame binds to the merged variable in each version's mode, with its own gap", async () => {
    const f = fakeFigma();
    await importRows(f, spacing("--gap", [24, 12]));
    const [variable] = variablesIn(f);
    const [collection] = collectionsIn(f);
    const bound = f.created.filter((n: any) => n.boundVariables?.itemSpacing) as any[];
    expect(bound).toHaveLength(2);
    expect(bound.map((n) => n.itemSpacing)).toEqual([24, 12]);
    for (const [i, node] of bound.entries()) {
      expect(node.boundVariables.itemSpacing.id).toBe(variable.id);
      // What the variable reads where the frame sits is what the frame holds.
      const mode = node.explicitModes[collection.id];
      expect(f.tokens.valueIn(variable, mode)).toBe(node.itemSpacing);
      expect(mode).toBe(modeId(collection, ["Light", "Dark"][i] as string));
    }
  });

  test("a refused mode keeps plain values and binds nothing in that version", async () => {
    const f = fakeFigma({ failExplicitMode: true });
    const end = await importRows(f, spacing("--gap", [24, 12]));
    const frames = f.created.filter((n: any) => n.layoutMode === "HORIZONTAL") as any[];
    expect(frames.map((n) => n.itemSpacing)).toEqual([24, 12]);
    for (const node of frames) expect(node.boundVariables ?? {}).toEqual({});
    expect(end.tokenFailures).toBeGreaterThan(0);
  });

  test("a second set finds the variable by its key", async () => {
    const f = fakeFigma();
    const token = spacing("--gap", [24, 12]);
    await settle(f, only([token]));
    await settle(f, only([token]));
    expect(variablesIn(f)).toHaveLength(1);
  });

  test("a refused value leaves no variable and counts", async () => {
    const f = fakeFigma({ failTokens: ["createVariable"] });
    const tokens = await settle(f, only([spacing("--gap", [24, 12])]));
    expect(variablesIn(f)).toHaveLength(0);
    expect(tokens.counts().tokenFailures).toBeGreaterThan(0);
  });

  test("a user's number variable is not matched by value", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedCollection("Mine");
    f.tokens.seedVariable("space", mine, 24, "FLOAT");
    await settle(f, only([spacing("--gap", [24, 24])]));
    expect(
      variablesIn(f)
        .map((v) => v.name)
        .sort()
    ).toEqual(["space", "spacing/gap"]);
    expect(f.tokens.writes.filter((w) => w.startsWith("space:"))).toEqual([]);
  });

  test("the options switch for styles and variables turns it off", async () => {
    const f = fakeFigma();
    await settle(f, only([spacing("--gap", [24, 12])]), options({ tokens: false }));
    expect(variablesIn(f)).toHaveLength(0);
  });
});

describe("a width added to a set", () => {
  const TWO = ["1512", "834"];
  const THREE = ["1512", "834", "390"];
  const gap = (px: number[]): PlanModeSpacing => ({
    key: ["spacing:--gap", ...px].join("|"),
    name: "spacing/gap",
    cssVar: "--gap",
    values: perMode(px),
    from: px.map(() => "--gap"),
  });
  const body = (sizes: number[], lines: number[]) => role("body/1", sizes, lines);
  const ink = (list: Rgba[]) => color("color/ink", list);

  test("creates nothing but a mode", async () => {
    const f = fakeFigma();
    await settle(
      f,
      set({
        modes: TWO,
        colors: [ink([INK, PAPER])],
        textStyles: [body([16, 14], [24, 20])],
        spacing: [gap([24, 16])],
      })
    );
    const [collection] = collectionsIn(f);
    const variables = variablesIn(f).length;
    const styles = stylesIn(f).length;
    const tokens = await settle(
      f,
      set({
        modes: THREE,
        colors: [ink([INK, PAPER, SKY])],
        textStyles: [body([16, 14, 12], [24, 20, 18])],
        spacing: [gap([24, 16, 8])],
      })
    );
    expect(collectionsIn(f)).toEqual([collection]);
    expect(modeNames(collection)).toEqual(THREE);
    expect(variablesIn(f)).toHaveLength(variables);
    expect(stylesIn(f)).toHaveLength(styles);
    expect(tokens.counts()).toMatchObject({
      variablesCreated: 0,
      stylesCreated: 0,
      tokenFailures: 0,
    });
    const narrow = modeId(collection, "390");
    expect(channel(variableNamed(f, "color/ink").valuesByMode[narrow])).toBeCloseTo(SKY.g);
    expect(variableNamed(f, "spacing/gap").valuesByMode[narrow]).toBe(8);
    expect(variableNamed(f, "type/body/1/size").valuesByMode[narrow]).toBe(12);
    expect(variableNamed(f, "type/body/1/line-height").valuesByMode[narrow]).toBe(18);
    expect(tokens.textStyleId(body([16, 14, 12], [24, 20, 18]).key)).toBe(stylesIn(f)[0].id);
  });

  test("a colour the same in all three finds its variable, with local reuse off", async () => {
    const f = fakeFigma();
    const opts = options({ useLocalStyles: false });
    await settle(f, set({ modes: TWO, colors: [ink([INK, INK])] }), opts);
    const tokens = await settle(f, set({ modes: THREE, colors: [ink([INK, INK, INK])] }), opts);
    expect(variablesIn(f)).toHaveLength(1);
    expect(tokens.counts().variablesCreated).toBe(0);
    const narrow = modeId(collectionsIn(f)[0], "390");
    expect(channel(variableNamed(f, "color/ink").valuesByMode[narrow])).toBeCloseTo(INK.g);
  });

  test("a style the same in all three finds itself by name", async () => {
    const f = fakeFigma();
    const opts = options({ useLocalStyles: false });
    await settle(f, set({ modes: TWO, textStyles: [body([16, 16], [24, 24])] }), opts);
    const tokens = await settle(
      f,
      set({ modes: THREE, textStyles: [body([16, 16, 16], [24, 24, 24])] }),
      opts
    );
    expect(stylesIn(f)).toHaveLength(1);
    expect(tokens.counts().stylesCreated).toBe(0);
  });

  test("a style flat so far that varies now keeps its style and gains a variable", async () => {
    const f = fakeFigma();
    const flat = body([16, 16], [24, 24]);
    await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])], textStyles: [flat] }));
    const [style] = stylesIn(f);
    const next = body([16, 16, 12], [24, 24, 24]);
    const colors = [ink([INK, PAPER, SKY])];
    const tokens = await settle(f, set({ modes: THREE, colors, textStyles: [next] }));
    expect(stylesIn(f)).toEqual([style]);
    expect(tokens.textStyleId(next.key)).toBe(style.id);
    expect(style.boundVariables.fontSize.id).toBe(variableNamed(f, "type/body/1/size").id);
    expect(tokens.counts()).toMatchObject({ stylesCreated: 0, variablesCreated: 1 });
  });

  test("a binding refused on a style that was there leaves it, and its runs plain", async () => {
    const f = fakeFigma({ failStyleBinding: "fontSize" });
    const flat = body([16, 16], [24, 24]);
    await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])], textStyles: [flat] }));
    const [style] = stylesIn(f);
    const next = body([16, 16, 12], [24, 24, 24]);
    const colors = [ink([INK, PAPER, SKY])];
    const tokens = await settle(f, set({ modes: THREE, colors, textStyles: [next] }));
    expect(stylesIn(f)).toEqual([style]);
    expect(tokens.textStyleId(next.key)).toBeUndefined();
    expect(variablesIn(f).map((v) => v.name)).toEqual(["color/ink"]);
    expect(tokens.counts().tokenFailures).toBe(1);
  });

  test("a wider width ahead of the others finds the same style", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: TWO, colors: [], textStyles: [body([16, 14], [24, 20])] }));
    const next = body([18, 16, 14], [26, 24, 20]);
    const tokens = await settle(
      f,
      set({ modes: ["1920", ...TWO], colors: [], textStyles: [next] })
    );
    expect(stylesIn(f)).toHaveLength(1);
    expect(tokens.counts()).toMatchObject({ stylesCreated: 0, variablesCreated: 0 });
    const wide = modeId(collectionsIn(f)[0], "1920");
    expect(variableNamed(f, "type/body/1/size").valuesByMode[wide]).toBe(18);
  });

  test("a style whose shared width no longer matches isn't taken", async () => {
    const f = fakeFigma();
    const flat = body([16, 16], [24, 24]);
    await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])], textStyles: [flat] }));
    const next = body([16, 15, 12], [24, 24, 24]);
    await settle(f, set({ modes: THREE, colors: [ink([INK, PAPER, SKY])], textStyles: [next] }));
    expect(stylesIn(f)).toHaveLength(2);
  });

  test("a style from before there were modes has no width to share", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: TWO, colors: [], textStyles: [body([16, 16], [24, 24])] }));
    await settle(
      f,
      set({ modes: THREE, colors: [], textStyles: [body([16, 16, 12], [24, 24, 24])] })
    );
    expect(stylesIn(f)).toHaveLength(2);
  });

  test("a variable whose shared width changed isn't taken", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])] }));
    await settle(f, set({ modes: THREE, colors: [ink([INK, SKY, SKY])] }));
    expect(variablesIn(f)).toHaveLength(2);
    expect(channel(variablesIn(f)[0].valuesByMode[modeId(collectionsIn(f)[0], "834")])).toBeCloseTo(
      PAPER.g
    );
  });

  test("a width dropped and one added: the width they share decides", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])] }));
    await settle(f, set({ modes: ["834", "390"], colors: [ink([PAPER, SKY])] }));
    expect(variablesIn(f)).toHaveLength(1);
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(channel(variable.valuesByMode[modeId(collection, "1512")])).toBeCloseTo(INK.g);
    expect(channel(variable.valuesByMode[modeId(collection, "390")])).toBeCloseTo(SKY.g);
  });

  test("with no width shared, a name is no evidence", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])] }));
    await settle(f, set({ modes: ["390", "320"], colors: [ink([INK, SKY])] }));
    expect(variablesIn(f)).toHaveLength(2);
  });

  test("a user's variable of that name is left alone", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])] }));
    const [collection] = collectionsIn(f);
    const mine = f.tokens.seedVariable("color/mine", collection, INK);
    mine.setValueForMode(modeId(collection, "834"), PAPER);
    const writes = f.tokens.writes.length;
    await settle(f, set({ modes: THREE, colors: [color("color/mine", [INK, PAPER, SKY])] }));
    expect(f.tokens.writes.slice(writes).filter((w) => w.startsWith("color/mine:"))).toEqual([]);
    expect(variablesIn(f).map((v) => v.name)).toContain("color/mine-2");
  });

  describe("a style taken over", () => {
    const WIDE = ["1728", "1512", "834"];
    const flatThree = () =>
      set({
        modes: ["1512", "1024", "834"],
        colors: [ink([INK, PAPER, INK])],
        textStyles: [body([48, 48, 48], [56, 56, 56])],
      });

    test("a mode outside the set keeps reading what the style held", async () => {
      const f = fakeFigma();
      await settle(f, flatThree());
      const next = body([56, 48, 48], [56, 56, 56]);
      await settle(f, set({ modes: WIDE, colors: [ink([INK, INK, INK])], textStyles: [next] }));
      const [collection] = collectionsIn(f);
      const size = variableNamed(f, "type/body/1/size");
      expect(stylesIn(f)).toHaveLength(1);
      expect(size.valuesByMode[modeId(collection, "1024")]).toBe(48);
      expect(size.valuesByMode[modeId(collection, "1728")]).toBe(56);
    });

    test("a field refused after another bound leaves no binding to a removed variable", async () => {
      const f = fakeFigma({ failStyleBinding: "lineHeight" });
      const flat = body([48, 48], [56, 56]);
      await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])], textStyles: [flat] }));
      const [style] = stylesIn(f);
      const next = body([48, 48, 32], [56, 56, 40]);
      const colors = [ink([INK, PAPER, SKY])];
      const tokens = await settle(f, set({ modes: THREE, colors, textStyles: [next] }));
      expect(style.boundVariables ?? {}).toEqual({});
      expect(variablesIn(f).map((v) => v.name)).toEqual(["color/ink"]);
      expect(tokens.textStyleId(next.key)).toBeUndefined();
      expect(tokens.counts().tokenFailures).toBe(1);
    });

    test("an unbinding that fails keeps the variable it would have left dangling", async () => {
      const f = fakeFigma({ failStyleBinding: "lineHeight" });
      const flat = body([48, 48], [56, 56]);
      await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])], textStyles: [flat] }));
      const [style] = stylesIn(f);
      const bind = style.setBoundVariable;
      style.setBoundVariable = (field: string, variable: unknown) => {
        if (variable === null) throw new Error("no unbinding");
        bind(field, variable);
      };
      const colors = [ink([INK, PAPER, SKY])];
      const next = body([48, 48, 32], [56, 56, 40]);
      await settle(f, set({ modes: THREE, colors, textStyles: [next] }));
      expect(f.tokens.variables.has(style.boundVariables.fontSize.id)).toBe(true);
    });

    test("Cancel takes its binding back, with the variable and the mode", async () => {
      const f = fakeFigma();
      const flat = body([48, 48], [56, 56]);
      await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])], textStyles: [flat] }));
      const [style] = stylesIn(f);
      const next = body([48, 48, 32], [56, 56, 56]);
      const colors = [ink([INK, PAPER, SKY])];
      const tokens = await settle(f, set({ modes: THREE, colors, textStyles: [next] }));
      expect(style.boundVariables.fontSize).toBeDefined();
      await tokens.discard();
      expect(style.boundVariables).toEqual({});
      expect(variablesIn(f).map((v) => v.name)).toEqual(["color/ink"]);
      expect(modeNames(collectionsIn(f)[0])).toEqual(TWO);
    });

    test("a binding it had before stays on Cancel", async () => {
      const f = fakeFigma();
      await settle(f, set({ modes: TWO, colors: [], textStyles: [body([16, 14], [24, 24])] }));
      const [style] = stylesIn(f);
      const tokens = await settle(
        f,
        set({ modes: THREE, colors: [], textStyles: [body([16, 14, 12], [24, 24, 24])] })
      );
      await tokens.discard();
      expect(style.boundVariables.fontSize).toBeDefined();
    });

    test("1512+834 then 834+390 shares one style, its bound fields read by their variables", async () => {
      const f = fakeFigma();
      await settle(f, set({ modes: TWO, colors: [], textStyles: [body([16, 14], [24, 20])] }));
      const tokens = await settle(
        f,
        set({ modes: ["834", "390"], colors: [], textStyles: [body([14, 12], [20, 18])] })
      );
      expect(stylesIn(f)).toHaveLength(1);
      expect(tokens.counts()).toMatchObject({ stylesCreated: 0, variablesCreated: 0 });
      expect(modeNames(collectionsIn(f)[0])).toEqual([...TWO, "390"]);
    });

    test("an unbound field outside the default still has to read the same at shared widths", async () => {
      const f = fakeFigma();
      const flat = body([16, 16], [24, 24]);
      await settle(f, set({ modes: TWO, colors: [ink([INK, PAPER])], textStyles: [flat] }));
      const next = body([15, 12], [24, 24]);
      await settle(
        f,
        set({ modes: ["834", "390"], colors: [ink([PAPER, SKY])], textStyles: [next] })
      );
      expect(stylesIn(f)).toHaveLength(2);
    });
  });
});
