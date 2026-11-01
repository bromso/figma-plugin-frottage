import type {
  FontRef,
  ImportOptions,
  PlanColor,
  PlanTextStyle,
  PlanTokens,
} from "@repo/figma-mapper";

/**
 * Settles a plan's tokens against the file: Frottage's own from an earlier import, then the user's,
 * and otherwise new ones. A user's tokens are only ever read and bound. Any failure here counts and
 * leaves the runs and paints with plain values. Types only from @repo/figma-mapper, as in the
 * applier.
 */

const NAMESPACE = "frottage";
const VALUE_KEY = "valueKey";
/** Half an 8-bit step: two colours this close are the same colour. */
const CHANNEL_TOLERANCE = 1 / 512;
/** Figma stores 32-bit numbers, so a size read back isn't quite the one that was set. */
const NUMBER_TOLERANCE = 1e-4;

export type TokenCounts = {
  stylesCreated: number;
  stylesReused: number;
  variablesCreated: number;
  variablesReused: number;
  /** Tokens that couldn't be made or applied; what they were for has plain values. */
  tokenFailures: number;
};

export const NO_TOKENS: TokenCounts = {
  stylesCreated: 0,
  stylesReused: 0,
  variablesCreated: 0,
  variablesReused: 0,
  tokenFailures: 0,
};

/** What the applier lends for one run: its time budget and its fonts. */
export type TokenRuntime = {
  overBudget(): boolean;
  /** Yields to Figma. */
  breathe(): Promise<unknown>;
  /** True once the font is loaded. */
  ensureFont(font: FontRef): Promise<boolean>;
};

type ColorBinding = { variable: Variable } | { paintStyleId: string };

const near = (a: number, b: number, tolerance = NUMBER_TOLERANCE) => Math.abs(a - b) <= tolerance;

function sameColor(a: RGB | RGBA, rgba: PlanColor["rgba"]): boolean {
  return (
    near(a.r, rgba.r, CHANNEL_TOLERANCE) &&
    near(a.g, rgba.g, CHANNEL_TOLERANCE) &&
    near(a.b, rgba.b, CHANNEL_TOLERANCE) &&
    near("a" in a ? a.a : 1, rgba.a, CHANNEL_TOLERANCE)
  );
}

function sameLineHeight(style: TextStyle, px: number | null): boolean {
  const { lineHeight } = style;
  if (px === null) return lineHeight.unit === "AUTO";
  return lineHeight.unit === "PIXELS" && near(lineHeight.value, px);
}

/** A style's letter spacing is often in percent of its size, which 0 px is the same as at 0%. */
function sameLetterSpacing(style: TextStyle, px: number): boolean {
  const { unit, value } = style.letterSpacing;
  return near(unit === "PIXELS" ? value : (value * style.fontSize) / 100, px);
}

/**
 * Imported text sets none of these, so a style that does would change the text once linked.
 * `textWrapStyle` stays out: imported text doesn't set it either way.
 */
function hasNeutralParagraph(style: TextStyle): boolean {
  return (
    style.paragraphSpacing === 0 &&
    style.paragraphIndent === 0 &&
    style.leadingTrim === "NONE" &&
    style.listSpacing === 0 &&
    !style.hangingPunctuation &&
    !style.hangingList
  );
}

function sameTextStyle(style: TextStyle, token: PlanTextStyle): boolean {
  return (
    style.fontName.family === token.fontName.family &&
    style.fontName.style === token.fontName.style &&
    near(style.fontSize, token.fontSize) &&
    sameLineHeight(style, token.lineHeight) &&
    sameLetterSpacing(style, token.letterSpacing) &&
    style.textDecoration === token.decoration &&
    style.textCase === token.textCase &&
    hasNeutralParagraph(style)
  );
}

/** The colour of a paint style that paints the same as a plain opaque colour would, else null. */
function solidColorOf(style: PaintStyle): RGB | null {
  const [paint, ...rest] = style.paints;
  const plain =
    paint?.type === "SOLID" &&
    rest.length === 0 &&
    paint.visible !== false &&
    (paint.opacity ?? 1) === 1 &&
    (paint.blendMode ?? "NORMAL") === "NORMAL";
  return plain ? paint.color : null;
}

/** The default mode's colour, or null for an alias: what it points at is matched on its own. */
function colorOf(variable: Variable, modes: Map<string, string>): RGBA | null {
  const mode = modes.get(variable.variableCollectionId);
  const value = mode === undefined ? undefined : variable.valuesByMode[mode];
  return typeof value === "object" && value !== null && "r" in value ? (value as RGBA) : null;
}

/**
 * A free name, recording it as taken. Numbered names continue after the highest in the file, so
 * `keepIfFree` is for names that only look numbered, such as `color/500` from a custom property.
 */
function takeName(name: string, taken: Set<string>, keepIfFree: boolean): string {
  let out = name;
  const numbered = /^(.*\/)\d+$/.exec(name)?.[1];
  if (numbered !== undefined && !(keepIfFree && !taken.has(name))) {
    let highest = 0;
    for (const t of taken) {
      const rest = t.startsWith(numbered) ? t.slice(numbered.length) : "";
      if (/^\d+$/.test(rest)) highest = Math.max(highest, Number(rest));
    }
    out = `${numbered}${highest + 1}`;
  } else {
    for (let n = 2; taken.has(out); n++) out = `${name}-${n}`;
  }
  taken.add(out);
  return out;
}

/** Tokens Frottage made, by the value each was made for. The value may have changed since. */
function byOwnKey<T extends TextStyle | Variable>(list: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const token of list) {
    const key = token.getSharedPluginData(NAMESPACE, VALUE_KEY);
    if (!key) continue;
    const same = out.get(key);
    if (same) same.push(token);
    else out.set(key, [token]);
  }
  return out;
}

/** Layers bound to these variables. Mixed text fills aren't read: Figma has no quick way to. */
function boundOnPage(page: PageNode, ids: Set<string>): Set<string> {
  const used = new Set<string>();
  const note = (paints: unknown) => {
    if (!Array.isArray(paints)) return;
    for (const paint of paints as Paint[]) {
      const id = paint.type === "SOLID" ? paint.boundVariables?.color?.id : undefined;
      if (id !== undefined && ids.has(id)) used.add(id);
    }
  };
  page.findAll((node) => {
    if ("fills" in node) note(node.fills);
    if ("strokes" in node) note(node.strokes);
    return false;
  });
  return used;
}

export function createTokenSet(api: PluginAPI) {
  const styleIds = new Map<string, string>();
  const colors = new Map<string, ColorBinding>();
  const counts = { ...NO_TOKENS };
  let createdStyles: TextStyle[] = [];
  let createdVariables: Variable[] = [];
  let createdCollection: VariableCollection | null = null;
  /** Set once the import is abandoned: nothing may be created after that. */
  let closed = false;

  function failed(n = 1) {
    counts.tokenFailures += n;
  }

  function createStyle(token: PlanTextStyle, taken: Set<string>): TextStyle {
    const style = api.createTextStyle();
    try {
      // First: every other type field needs the style's font loaded.
      style.fontName = token.fontName;
      style.name = takeName(token.name, taken, false);
      style.fontSize = token.fontSize;
      style.lineHeight =
        token.lineHeight === null ? { unit: "AUTO" } : { unit: "PIXELS", value: token.lineHeight };
      style.letterSpacing = { unit: "PIXELS", value: token.letterSpacing };
      style.textDecoration = token.decoration;
      style.textCase = token.textCase;
      style.setSharedPluginData(NAMESPACE, VALUE_KEY, token.key);
    } catch (e) {
      style.remove();
      throw e;
    }
    return style;
  }

  async function resolveTextStyles(
    tokens: PlanTextStyle[],
    useLocal: boolean,
    runtime: TokenRuntime
  ): Promise<void> {
    if (tokens.length === 0) return;
    const existing = await api.getLocalTextStylesAsync();
    const taken = new Set(existing.map((s) => s.name));
    const own = byOwnKey(existing);
    for (const token of tokens) {
      if (runtime.overBudget()) await runtime.breathe();
      // Linking a style needs its font, so a font that won't load rules out even an exact match.
      const ready = await runtime.ensureFont(token.fontName);
      if (closed) return;
      try {
        if (!ready) throw new Error("font unavailable");
        const found =
          own.get(token.key)?.find((s) => sameTextStyle(s, token)) ??
          (useLocal ? existing.find((s) => sameTextStyle(s, token)) : undefined);
        if (found) {
          styleIds.set(token.key, found.id);
          counts.stylesReused++;
          continue;
        }
        const style = createStyle(token, taken);
        createdStyles.push(style);
        styleIds.set(token.key, style.id);
        counts.stylesCreated++;
      } catch {
        failed();
      }
    }
  }

  function createVariable(
    token: PlanColor,
    collection: VariableCollection,
    taken: Set<string>
  ): Variable {
    const name = takeName(token.name, taken, token.cssVar !== undefined);
    const variable = api.variables.createVariable(name, collection, "COLOR");
    try {
      variable.setValueForMode(collection.defaultModeId, token.rgba);
      if (token.cssVar) variable.setVariableCodeSyntax("WEB", `var(${token.cssVar})`);
      variable.setSharedPluginData(NAMESPACE, VALUE_KEY, token.key);
    } catch (e) {
      variable.remove();
      throw e;
    }
    return variable;
  }

  async function resolveColors(
    plan: PlanTokens,
    useLocal: boolean,
    runtime: TokenRuntime
  ): Promise<void> {
    if (plan.colors.length === 0) return;
    const variables = await api.variables.getLocalVariablesAsync("COLOR");
    const collections = await api.variables.getLocalVariableCollectionsAsync();
    const paintStyles = useLocal ? await api.getLocalPaintStylesAsync() : [];
    if (closed) return;

    const modes = new Map(collections.map((c) => [c.id, c.defaultModeId]));
    // Read once: a file can hold hundreds, and each read crosses into Figma.
    const values = new Map(variables.map((v) => [v.id, colorOf(v, modes)]));
    const matches = (v: Variable, token: PlanColor) => {
      const value = values.get(v.id);
      return value != null && sameColor(value, token.rgba);
    };
    const solids = paintStyles.flatMap((s) => {
      const color = solidColorOf(s);
      return color ? [{ id: s.id, color }] : [];
    });
    const own = byOwnKey(variables);
    const local = useLocal ? variables : [];

    let target: { collection: VariableCollection; taken: Set<string> } | null = null;
    /** Made only when a variable needs it, so that an import that reuses all adds nothing. */
    const home = () => {
      if (target) return target;
      let collection = collections.find((c) => c.name === plan.collection);
      if (!collection) {
        collection = api.variables.createVariableCollection(plan.collection);
        createdCollection = collection;
      }
      const { id } = collection;
      const names = variables.filter((v) => v.variableCollectionId === id).map((v) => v.name);
      target = { collection, taken: new Set(names) };
      return target;
    };

    for (const token of plan.colors) {
      if (runtime.overBudget()) {
        await runtime.breathe();
        if (closed) return;
      }
      try {
        const reused =
          own.get(token.key)?.find((v) => matches(v, token)) ??
          local.find((v) => matches(v, token));
        if (reused) {
          colors.set(token.key, { variable: reused });
          counts.variablesReused++;
          continue;
        }
        const style = solids.find((s) => sameColor(s.color, token.rgba));
        if (style) {
          colors.set(token.key, { paintStyleId: style.id });
          counts.stylesReused++;
          continue;
        }
        const { collection, taken } = home();
        const variable = createVariable(token, collection, taken);
        createdVariables.push(variable);
        colors.set(token.key, { variable });
        counts.variablesCreated++;
      } catch {
        failed();
      }
    }
    if (createdCollection && createdVariables.length === 0) {
      createdCollection.remove();
      createdCollection = null;
    }
  }

  /** Whether each variable is held by something outside the import, which is already removed. */
  async function usedVariables(variables: Variable[]): Promise<Set<string>> {
    const ids = new Set(variables.map((v) => v.id));
    const used = boundOnPage(api.currentPage, ids);
    for (const v of await api.variables.getLocalVariablesAsync("COLOR")) {
      if (ids.has(v.id)) continue;
      for (const value of Object.values(v.valuesByMode)) {
        if (typeof value !== "object" || !("type" in value)) continue;
        if (value.type === "VARIABLE_ALIAS" && ids.has(value.id)) used.add(value.id);
      }
    }
    for (const style of await api.getLocalPaintStylesAsync()) {
      for (const paint of style.paints) {
        const id = paint.type === "SOLID" ? paint.boundVariables?.color?.id : undefined;
        if (id !== undefined && ids.has(id)) used.add(id);
      }
    }
    return used;
  }

  return {
    /** Works out every token in the plan. Never throws: what fails stays plain. */
    async resolve(plan: PlanTokens, options: ImportOptions, runtime: TokenRuntime): Promise<void> {
      if (!options.tokens) return;
      try {
        await resolveTextStyles(plan.textStyles, options.useLocalStyles, runtime);
      } catch {
        failed(Math.max(plan.textStyles.length - styleIds.size, 1));
      }
      if (closed) return;
      try {
        await resolveColors(plan, options.useLocalStyles, runtime);
      } catch {
        failed(Math.max(plan.colors.length - colors.size, 1));
      }
    },

    textStyleId: (key: string | undefined) => (key ? styleIds.get(key) : undefined),
    color: (key: string | undefined) => (key ? colors.get(key) : undefined),
    failed,
    counts: () => ({ ...counts }),

    /**
     * Takes back what this import made, where nothing else uses it. When usage can't be read, the
     * token stays: a leftover is reused by the next import, and a removal can't be taken back.
     */
    async discard(): Promise<void> {
      closed = true;
      const styles = createdStyles;
      const variables = createdVariables;
      const collection = createdCollection;
      createdStyles = [];
      createdVariables = [];
      createdCollection = null;
      for (const style of styles) {
        try {
          if ((await style.getStyleConsumersAsync()).length === 0) style.remove();
        } catch {
          // keep it
        }
      }
      if (variables.length === 0 && !collection) return;
      try {
        const used = await usedVariables(variables);
        for (const variable of variables) if (!used.has(variable.id)) variable.remove();
        if (collection?.variableIds.length === 0) collection.remove();
      } catch {
        // keep them
      }
    },
  };
}

export type TokenSet = ReturnType<typeof createTokenSet>;
