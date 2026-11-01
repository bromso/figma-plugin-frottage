import type { FakeNode } from "./fake-figma";

/**
 * Text styles, paint styles, variables and collections for the fake Figma, throwing where the real
 * API does. Numbers come back as Figma stores them, in 32 bits. Getters and style links really
 * suspend, so tests can reach what happens while they are pending.
 */

export type TokenOptions = {
  /** Names of token API calls that throw. */
  failTokens?: string[];
  /** A name that createVariable refuses. */
  failVariableName?: string;
  /** Modes a collection can hold: 10 on this owner's plan, 1 on Starter. */
  modeLimit?: number;
};

type Font = { family: string; style: string };
type Rgba = { r: number; g: number; b: number; a?: number };
type Fake = Record<string, any>;

const fontId = (f: Font) => `${f.family}|${f.style}`;
const hop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const stored = (c: Rgba) => ({
  r: Math.fround(c.r),
  g: Math.fround(c.g),
  b: Math.fround(c.b),
  a: Math.fround(c.a ?? 1),
});

/** What Figma keeps of a line height or letter spacing. */
function storedUnit<T extends { value?: number }>(v: T): T {
  return v.value === undefined ? v : { ...v, value: Math.fround(v.value) };
}

export function tokenModel(
  opts: TokenOptions,
  loaded: Set<string>,
  findAll: (test: (n: FakeNode) => boolean) => FakeNode[]
) {
  const textStyles = new Map<string, Fake>();
  const paintStyles = new Map<string, Fake>();
  const variables = new Map<string, Fake>();
  const collections = new Map<string, Fake>();
  /** Every write to a token, so a test can show that a user's were left alone. */
  const writes: string[] = [];
  /** Token API calls in order. */
  const log: string[] = [];
  let seq = 0;

  const called = (name: string) => {
    log.push(name);
    if (opts.failTokens?.includes(name)) throw new Error(`${name} failed`);
  };

  const pluginData = (target: Fake, label: () => string) => {
    const data = new Map<string, string>();
    target.getSharedPluginData = (ns: string, key: string) => data.get(`${ns}/${key}`) ?? "";
    target.setSharedPluginData = (ns: string, key: string, value: string) => {
      called("setSharedPluginData");
      writes.push(`${label()}: plugin data`);
      data.set(`${ns}/${key}`, value);
    };
  };

  function makeTextStyle(): Fake {
    const id = `S:text${++seq}`;
    const state: Fake = {
      fontName: { family: "Roboto", style: "Regular" },
      fontSize: 12,
      lineHeight: { unit: "AUTO" },
      letterSpacing: { unit: "PERCENT", value: 0 },
      textDecoration: "NONE",
      textCase: "ORIGINAL",
      paragraphSpacing: 0,
      paragraphIndent: 0,
      leadingTrim: "NONE",
      listSpacing: 0,
      hangingPunctuation: false,
      hangingList: false,
      name: "",
    };
    const style: Fake = {
      id,
      type: "TEXT",
      removed: false,
      remove() {
        called("textStyle.remove");
        style.removed = true;
        textStyles.delete(id);
      },
      async getStyleConsumersAsync() {
        called("getStyleConsumersAsync");
        await hop();
        return findAll((n) => (n.textStyleIds ?? new Set()).has(id)).map((node) => ({
          node,
          fields: ["textStyleId"],
        }));
      },
    };
    pluginData(style, () => state.name);
    for (const field of Object.keys(state)) {
      Object.defineProperty(style, field, {
        get: () => state[field],
        set: (v: any) => {
          writes.push(`${state.name}: ${field}`);
          // Figma refuses every type field while the style's font isn't loaded.
          const font = field === "fontName" ? v : state.fontName;
          if (field !== "name" && !loaded.has(fontId(font))) {
            throw new Error(`font not loaded: ${fontId(font)}`);
          }
          if (field === "fontSize") state[field] = Math.fround(v);
          else if (field === "lineHeight" || field === "letterSpacing")
            state[field] = storedUnit(v);
          else state[field] = v;
        },
      });
    }
    style.setBoundVariable = (field: string, variable: Fake) => {
      called("textStyle.setBoundVariable");
      writes.push(`${state.name}: bound ${field}`);
      if (typeof variable === "string") throw new Error("dynamic-page needs the variable");
      if (!["fontSize", "lineHeight"].includes(field)) throw new Error(`can't bind ${field}`);
      if (!variables.has(variable?.id)) throw new Error("unknown variable");
      if (variable.resolvedType !== "FLOAT") throw new Error("needs a number variable");
      if (!loaded.has(fontId(state.fontName))) throw new Error("font not loaded");
      style.boundVariables = {
        ...style.boundVariables,
        [field]: { type: "VARIABLE_ALIAS", id: variable.id },
      };
    };
    textStyles.set(id, style);
    return style;
  }

  function makePaintStyle(name: string, paints: any[]): Fake {
    const id = `S:paint${++seq}`;
    const style: Fake = {
      id,
      type: "PAINT",
      get name() {
        return name;
      },
      set name(v: string) {
        writes.push(`${name}: name`);
        name = v;
      },
      get paints() {
        log.push("paints");
        return paints;
      },
      set paints(v: any[]) {
        writes.push(`${name}: paints`);
        paints = v;
      },
    };
    pluginData(style, () => name);
    paintStyles.set(id, style);
    return style;
  }

  function makeCollection(name: string, modes = ["Mode 1"]): Fake {
    const id = `VC:${++seq}`;
    let nextMode = modes.length;
    const known = (modeId: string) => {
      const mode = collection.modes.find((m: { modeId: string }) => m.modeId === modeId);
      if (!mode) throw new Error("unknown mode");
      return mode;
    };
    const collection: Fake = {
      id,
      name,
      modes: modes.map((m, i) => ({ modeId: `${id}/${i}`, name: m })),
      defaultModeId: `${id}/0`,
      addMode(modeName: string) {
        called("addMode");
        const limit = opts.modeLimit ?? 10;
        if (collection.modes.length >= limit) {
          throw new Error(`in addMode: Limited to ${limit} modes only`);
        }
        writes.push(`${collection.name}: add mode ${modeName}`);
        const modeId = `${id}/${nextMode++}`;
        collection.modes = [...collection.modes, { modeId, name: modeName }];
        return modeId;
      },
      renameMode(modeId: string, modeName: string) {
        called("renameMode");
        writes.push(`${collection.name}: rename mode`);
        known(modeId).name = modeName;
      },
      removeMode(modeId: string) {
        called("removeMode");
        writes.push(`${collection.name}: remove mode`);
        known(modeId);
        if (modeId === collection.defaultModeId) throw new Error("can't remove the default mode");
        collection.modes = collection.modes.filter((m: { modeId: string }) => m.modeId !== modeId);
        for (const v of variables.values()) {
          if (v.variableCollectionId === id) delete v.valuesByMode[modeId];
        }
      },
      get variableIds() {
        return [...variables.values()]
          .filter((v) => v.variableCollectionId === id)
          .map((v) => v.id);
      },
      remove() {
        called("collection.remove");
        collection.removed = true;
        collections.delete(id);
        for (const v of [...variables.values()]) {
          if (v.variableCollectionId === id) variables.delete(v.id);
        }
      },
    };
    pluginData(collection, () => collection.name);
    collections.set(id, collection);
    return collection;
  }

  function makeVariable(name: string, collection: Fake, type = "COLOR"): Fake {
    if (!collections.has(collection?.id)) throw new Error("unknown collection");
    if (opts.failVariableName === name || /[.{}]/.test(name)) throw new Error(`bad name ${name}`);
    for (const v of variables.values()) {
      if (v.variableCollectionId === collection.id && v.name === name) {
        throw new Error(`a variable called ${name} already exists`);
      }
    }
    const id = `V:${++seq}`;
    const valuesByMode: Record<string, unknown> = {};
    const variable: Fake = {
      id,
      name,
      resolvedType: type,
      variableCollectionId: collection.id,
      valuesByMode,
      codeSyntax: {},
      removed: false,
      setValueForMode(modeId: string, value: any) {
        called("setValueForMode");
        writes.push(`${variable.name}: value`);
        if (!collection.modes.some((m: { modeId: string }) => m.modeId === modeId)) {
          throw new Error("unknown mode");
        }
        if (type === "FLOAT") {
          if (typeof value !== "number") throw new Error("needs a number");
          valuesByMode[modeId] = Math.fround(value);
        } else {
          if (typeof value === "number") throw new Error("needs a colour");
          valuesByMode[modeId] = value.type === "VARIABLE_ALIAS" ? value : stored(value);
        }
      },
      setVariableCodeSyntax(platform: string, value: string) {
        called("setVariableCodeSyntax");
        writes.push(`${variable.name}: code syntax`);
        variable.codeSyntax[platform] = value;
      },
      remove() {
        called("variable.remove");
        variable.removed = true;
        variables.delete(id);
      },
    };
    pluginData(variable, () => variable.name);
    variables.set(id, variable);
    return variable;
  }

  const api = {
    async getLocalTextStylesAsync() {
      called("getLocalTextStylesAsync");
      await hop();
      return [...textStyles.values()];
    },
    async getLocalPaintStylesAsync() {
      called("getLocalPaintStylesAsync");
      await hop();
      return [...paintStyles.values()];
    },
    createTextStyle() {
      called("createTextStyle");
      return makeTextStyle();
    },
    variables: {
      async getLocalVariablesAsync(type?: string) {
        called("getLocalVariablesAsync");
        await hop();
        return [...variables.values()].filter((v) => !type || v.resolvedType === type);
      },
      async getLocalVariableCollectionsAsync() {
        called("getLocalVariableCollectionsAsync");
        await hop();
        return [...collections.values()];
      },
      createVariableCollection(name: string) {
        called("createVariableCollection");
        return makeCollection(name);
      },
      createVariable(name: string, collection: Fake, type: string) {
        called("createVariable");
        if (typeof collection === "string") throw new Error("dynamic-page needs the collection");
        if (type !== "COLOR" && type !== "FLOAT") throw new Error("unexpected type");
        return makeVariable(name, collection, type);
      },
      setBoundVariableForPaint(paint: Fake, field: string, variable: Fake) {
        called("setBoundVariableForPaint");
        if (paint.type !== "SOLID" || field !== "color") throw new Error("not a bindable paint");
        if (!variables.has(variable?.id)) throw new Error("unknown variable");
        return {
          ...paint,
          boundVariables: { color: { type: "VARIABLE_ALIAS", id: variable.id } },
        };
      },
    },
  };

  const knownStyle = (map: Map<string, Fake>, id: string) => {
    const style = map.get(id);
    if (!style) throw new Error(`unknown style ${id}`);
    return style;
  };

  return {
    api,
    log,
    writes,
    textStyles,
    paintStyles,
    variables,
    collections,
    count: (name: string) => log.filter((x) => x === name).length,
    textStyleById: (id: string) => textStyles.get(id),
    /** What a variable reads in a mode, which is the default mode's value if it has none. */
    valueIn(variable: Fake, modeId: string) {
      const collection = collections.get(variable.variableCollectionId);
      return variable.valuesByMode[modeId] ?? variable.valuesByMode[collection?.defaultModeId];
    },

    /** A style someone else made. */
    seedTextStyle(name: string, fields: Fake) {
      const style = makeTextStyle();
      style.name = name;
      loaded.add(fontId(fields.fontName ?? style.fontName));
      for (const [key, value] of Object.entries(fields)) style[key] = value;
      writes.length = 0;
      return style;
    },
    seedPaintStyle: (name: string, paints: any[]) => makePaintStyle(name, paints),
    seedCollection: (name: string, modes?: string[]) => makeCollection(name, modes),
    /** A variable someone else made. */
    seedVariable(name: string, collection: Fake, value: any, type = "COLOR") {
      const variable = makeVariable(name, collection, type);
      variable.setValueForMode(collection.defaultModeId, value);
      writes.length = 0;
      return variable;
    },

    installNode(node: FakeNode) {
      const link = (method: "setFillStyleIdAsync" | "setStrokeStyleIdAsync", field: string) => {
        node[method] = async (id: string) => {
          called(method);
          await hop();
          knownStyle(paintStyles, id);
          node[field] = id;
        };
      };
      link("setFillStyleIdAsync", "fillStyleId");
      link("setStrokeStyleIdAsync", "strokeStyleId");
    },

    installText(t: FakeNode, chars: () => string, layout: () => void) {
      t.decorations = [] as { s: number; e: number; v: string }[];
      t.textStyleIds = new Set<string>();
      const range = (s: number, e: number) => {
        if (s >= e || s < 0 || e > chars().length) throw new Error(`bad range ${s}-${e}`);
      };
      t.setRangeTextStyleIdAsync = async (s: number, e: number, id: string) => {
        called("setRangeTextStyleIdAsync");
        await hop();
        if (t.removed || t.parent?.removed) throw new Error("the node was removed");
        range(s, e);
        const style = knownStyle(textStyles, id);
        if (!loaded.has(fontId(style.fontName))) throw new Error("the style's font isn't loaded");
        t.textStyleIds.add(id);
        if (!t.ranges) t.ranges = [];
        t.ranges.push({ m: "setRangeTextStyleIdAsync", s, e, v: id });
        // A style sets its own decoration over whatever the range had.
        t.decorations.push({ s, e, v: style.textDecoration });
        layout();
      };
      t.setRangeFillStyleIdAsync = async (s: number, e: number, id: string) => {
        called("setRangeFillStyleIdAsync");
        await hop();
        range(s, e);
        knownStyle(paintStyles, id);
        if (!t.ranges) t.ranges = [];
        t.ranges.push({ m: "setRangeFillStyleIdAsync", s, e, v: id });
      };
      t.getRangeTextDecoration = (s: number, e: number) => {
        const last = [...t.decorations].reverse().find((d) => d.s <= s && d.e >= e);
        return last?.v ?? "NONE";
      };
    },
  };
}
