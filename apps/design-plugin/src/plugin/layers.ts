import type {
  ImportOptions,
  PlanEffect,
  PlanEffectStyle,
  PlanGradientStyle,
  PlanLayers,
  PlanVariable,
  PlanVarValue,
} from "@repo/figma-mapper";
import {
  COLLECTION_KEY,
  NAMESPACE,
  near,
  sameColor,
  type TokenRuntime,
  tagCollection,
  usedVariables,
  VALUE_KEY,
} from "./tokens";

/**
 * Settles a plan's Primitives and Theme collections, with its effect and gradient styles, against
 * the file. Frottage's own from an earlier import are reused where they hold the same values; a
 * user's are only ever read, and bound to. Any failure here counts and leaves what it was for
 * plain.
 */

export type LayerCounts = {
  variablesCreated: number;
  variablesReused: number;
  /** Theme modes the file had no room for. Their values weren't written. */
  modesDropped: string[];
  stylesCreated: number;
};

type Kind = PlanVariable["collection"];

/** A collection this import writes to, with the names taken in it and each plan mode's id. */
type Home = {
  collection: VariableCollection;
  taken: Set<string>;
  labels: string[];
  /** Per label, its mode, or null for one the file had no room for. */
  modeIds: (string | null)[];
  /** Modes added just now. Figma copies the previous mode's values in, so those mean nothing. */
  added: Set<string>;
};

const LABEL: Record<Kind, string> = { primitives: "Primitives", theme: "Theme" };
const tagOf = (hostname: string, kind: Kind) => `${hostname}#${kind}`;

/** `name`, or else `name (2)` and on: the first not taken, recorded as taken. */
function freeName(name: string, taken: Set<string>): string {
  let out = name;
  for (let n = 2; taken.has(out); n++) out = `${name} (${n})`;
  taken.add(out);
  return out;
}

/** Whether a name is `name` or one of its numbered copies. */
const ofName = (held: string, name: string) =>
  held === name || (held.startsWith(name) && /^ \(\d+\)$/.test(held.slice(name.length)));

const isAlias = (v: unknown): v is VariableAlias =>
  typeof v === "object" && v !== null && (v as { type?: unknown }).type === "VARIABLE_ALIAS";
const isColor = (v: unknown): v is RGB | RGBA =>
  typeof v === "object" && v !== null && "r" in v && "g" in v && "b" in v;
const isShadow = (e: Effect | undefined): e is DropShadowEffect | InnerShadowEffect =>
  e?.type === "DROP_SHADOW" || e?.type === "INNER_SHADOW";
const isBlur = (e: Effect | undefined): e is BlurEffect =>
  e?.type === "LAYER_BLUR" || e?.type === "BACKGROUND_BLUR";

/** Whether a variable holds this value; an alias by the variable it points at. */
function sameValue(held: VariableValue | undefined, want: VariableValue): boolean {
  if (held === undefined) return false;
  if (isAlias(want)) return isAlias(held) && held.id === want.id;
  if (isColor(want)) return isColor(held) && sameColor(held, { a: 1, ...want });
  if (typeof want === "number") return typeof held === "number" && near(held, want);
  return held === want;
}

/** An effect as the applier makes it. */
function effectOf(e: PlanEffect): Effect {
  if (!("color" in e)) return { type: e.type, blurType: "NORMAL", radius: e.radius, visible: true };
  const { type, color, offset, radius, spread } = e;
  return { type, color, offset, radius, spread, visible: true, blendMode: "NORMAL" };
}

const boundId = (target: { boundVariables?: { color?: VariableAlias } }) =>
  target.boundVariables?.color?.id;

/** A bound colour is the variable's: only the binding says whether it's the same. */
function sameEffect(held: Effect | undefined, want: Effect): boolean {
  if (held?.type !== want.type || held.visible !== want.visible) return false;
  if (isBlur(want)) return isBlur(held) && near(held.radius, want.radius);
  if (!isShadow(want) || !isShadow(held)) return false;
  const bound = boundId(want);
  return (
    near(held.radius, want.radius) &&
    boundId(held) === bound &&
    (bound !== undefined || sameColor(held.color, want.color)) &&
    near(held.offset.x, want.offset.x) &&
    near(held.offset.y, want.offset.y) &&
    near(held.spread ?? 0, want.spread ?? 0)
  );
}

function sameGradient(paints: readonly Paint[], want: GradientPaint): boolean {
  const [held, ...rest] = paints;
  if (rest.length > 0 || held?.type !== want.type || !("gradientStops" in held)) return false;
  const transform = want.gradientTransform.flat();
  const stops = held.gradientStops;
  return (
    held.gradientTransform.flat().every((v, i) => near(v, transform[i] ?? Number.NaN)) &&
    stops.length === want.gradientStops.length &&
    want.gradientStops.every((w, i) => {
      const stop = stops[i];
      const bound = boundId(w);
      return (
        stop !== undefined &&
        near(stop.position, w.position) &&
        boundId(stop) === bound &&
        (bound !== undefined || sameColor(stop.color, w.color))
      );
    })
  );
}

export function createLayerSet(api: PluginAPI) {
  const variables = new Map<string, Variable>();
  const effectIds = new Map<string, string>();
  const gradientIds = new Map<string, string>();
  const homes = new Map<Kind, Home>();
  const counts: LayerCounts = {
    variablesCreated: 0,
    variablesReused: 0,
    modesDropped: [],
    stylesCreated: 0,
  };
  let failures = 0;
  let createdVariables: Variable[] = [];
  let createdCollections: VariableCollection[] = [];
  /** Modes added to a collection that was already there. A created one goes whole. */
  let createdModes: { collection: VariableCollection; modeId: string }[] = [];
  let createdStyles: (EffectStyle | PaintStyle)[] = [];
  /** Set once the import is abandoned: nothing may be created after that. */
  let closed = false;

  /** Gives each label a mode, adding those missing until the file's limit. */
  function settleModes(collection: VariableCollection, labels: string[], fresh: boolean) {
    const [first] = labels;
    if (fresh && first !== undefined) {
      try {
        collection.renameMode(collection.defaultModeId, first);
      } catch {
        failures++;
      }
    }
    const named = new Map(collection.modes.map((m) => [m.name, m.modeId]));
    const modeIds: (string | null)[] = [];
    const added = new Set<string>();
    let full = false;
    for (const [i, label] of labels.entries()) {
      let modeId = named.get(label) ?? (i === 0 ? collection.defaultModeId : null);
      if (modeId === null && !full) {
        try {
          modeId = collection.addMode(label);
          added.add(modeId);
          if (!fresh) createdModes.push({ collection, modeId });
        } catch (e) {
          // A plan's limit is a limit, not a failure: `modesDropped` says so.
          if (!String(e).includes("Limited to")) failures++;
          full = true;
        }
      }
      if (modeId === null) counts.modesDropped.push(label);
      modeIds.push(modeId);
    }
    return { modeIds, added };
  }

  async function settle(plan: PlanLayers, useLocal: boolean, runtime: TokenRuntime) {
    const existing = await api.variables.getLocalVariablesAsync();
    const collections = await api.variables.getLocalVariableCollectionsAsync();
    const effectStyles = plan.effectStyles.length > 0 ? await api.getLocalEffectStylesAsync() : [];
    const paintStyles = plan.gradientStyles.length > 0 ? await api.getLocalPaintStylesAsync() : [];
    if (closed) return;

    const pause = async () => {
      if (runtime.overBudget()) await runtime.breathe();
      return !closed;
    };
    const tagged = (c: VariableCollection) => c.getSharedPluginData(NAMESPACE, COLLECTION_KEY);
    const ownCollections = new Set(collections.filter((c) => tagged(c) !== "").map((c) => c.id));
    const isOwn = (v: Variable) =>
      ownCollections.has(v.variableCollectionId) || v.getSharedPluginData(NAMESPACE, VALUE_KEY);
    const defaults = new Map(collections.map((c) => [c.id, c.defaultModeId]));
    // Colours only, as before layers: a number or a string says too little to take a user's.
    const local = useLocal ? existing.filter((v) => v.resolvedType === "COLOR" && !isOwn(v)) : [];
    const planned = new Map(plan.variables.map((v) => [v.key, v]));

    /** Frottage's collection of this kind, by its tag, else a new one. Made only when needed. */
    const homeOf = (kind: Kind): Home => {
      const known = homes.get(kind);
      if (known) return known;
      const tag = tagOf(plan.hostname, kind);
      let collection = collections.find((c) => !c.remote && !c.isExtension && tagged(c) === tag);
      const fresh = !collection;
      if (!collection) {
        const name = `${plan.hostname} · ${LABEL[kind]}`;
        // A user's of this name stays as it is, beside this one.
        const free = !collections.some((c) => c.name === name);
        collection = api.variables.createVariableCollection(free ? name : `${name} (Frottage)`);
        createdCollections.push(collection);
        tagCollection(collection, tag);
      }
      const labels = kind === "primitives" ? ["Value"] : plan.modes;
      const { id } = collection;
      const names = existing.filter((v) => v.variableCollectionId === id).map((v) => v.name);
      const home = {
        collection,
        taken: new Set(names),
        labels,
        ...settleModes(collection, labels, fresh),
      };
      homes.set(kind, home);
      return home;
    };

    /** A plan value as Figma holds it: an alias goes to the variable its key settled on. */
    const figmaValue = (value: PlanVarValue): VariableValue => {
      if (typeof value !== "object" || !("alias" in value)) return value;
      const target = variables.get(value.alias);
      if (target) return api.variables.createVariableAlias(target);
      // With no variable for it, the value it holds, so that the theme still reads right.
      const held = planned.get(value.alias)?.values[0];
      if (held === undefined || (typeof held === "object" && "alias" in held)) {
        throw new Error("alias to nothing");
      }
      return held;
    };

    /** Frottage's variable of this key or name in the home, holding these values, if any. */
    const reuse = async (
      token: PlanVariable,
      wants: Map<string, VariableValue>,
      { collection, added }: Home
    ): Promise<Variable | null> => {
      const fits = (v: Variable) => {
        if (v.variableCollectionId !== collection.id || v.resolvedType !== token.type) return false;
        if (
          v.getSharedPluginData(NAMESPACE, VALUE_KEY) !== token.key &&
          !ofName(v.name, token.name)
        )
          return false;
        const held = v.valuesByMode;
        return [...wants].every(
          ([modeId, want]) => added.has(modeId) || sameValue(held[modeId], want)
        );
      };
      const found = existing.find(fits);
      if (!found) return null;
      // A mode added just now reads what the one before it held.
      for (const modeId of added) {
        const want = wants.get(modeId);
        if (want === undefined) continue;
        if (!(await pause())) return null;
        found.setValueForMode(modeId, want);
      }
      return found;
    };

    const create = async (
      token: PlanVariable,
      wants: Map<string, VariableValue>,
      first: VariableValue,
      { collection, taken }: Home
    ): Promise<Variable | null> => {
      const variable = api.variables.createVariable(
        freeName(token.name, taken),
        collection,
        token.type
      );
      // Now, not at the end: writing the modes yields, and `discard` may run during it.
      createdVariables.push(variable);
      try {
        // Every mode: an unset one reads a blank, not the default.
        for (const { modeId } of collection.modes) {
          if (!(await pause())) return null;
          variable.setValueForMode(modeId, wants.get(modeId) ?? first);
        }
        variable.description = token.description;
        if (token.cssVar) variable.setVariableCodeSyntax("WEB", `var(${token.cssVar})`);
        variable.setSharedPluginData(NAMESPACE, VALUE_KEY, token.key);
      } catch (e) {
        createdVariables = createdVariables.filter((v) => v !== variable);
        variable.remove();
        throw e;
      }
      try {
        variable.scopes = token.scopes as VariableScope[];
      } catch {
        // It still binds, in every field.
        failures++;
      }
      return variable;
    };

    const settleVariable = async (token: PlanVariable): Promise<void> => {
      const [lead] = token.values;
      if (lead === undefined) throw new Error("no value");
      const first = figmaValue(lead);
      if (token.collection === "primitives" && token.type === "COLOR" && local.length > 0) {
        const theirs = local.find((v) =>
          sameValue(v.valuesByMode[defaults.get(v.variableCollectionId) ?? ""], first)
        );
        if (theirs) {
          variables.set(token.key, theirs);
          counts.variablesReused++;
          return;
        }
      }
      const home = homeOf(token.collection);
      const wants = new Map<string, VariableValue>();
      for (const [i, modeId] of home.modeIds.entries()) {
        const value = token.values[i];
        if (modeId !== null) wants.set(modeId, value === undefined ? first : figmaValue(value));
      }
      const reused = await reuse(token, wants, home);
      if (closed) return;
      if (reused) {
        variables.set(token.key, reused);
        counts.variablesReused++;
        return;
      }
      const variable = await create(token, wants, first, home);
      if (!variable) return;
      variables.set(token.key, variable);
      counts.variablesCreated++;
    };

    /** Binds a colour to its variable. A refused binding stays plain. */
    const bindEffect = (effect: Effect, key: string | null | undefined): Effect => {
      const variable = key ? variables.get(key) : undefined;
      if (!variable || !isShadow(effect)) return effect;
      try {
        return api.variables.setBoundVariableForEffect(effect, "color", variable);
      } catch {
        failures++;
        return effect;
      }
    };

    const gradientOf = ({ paint, stopKeys }: PlanGradientStyle): GradientPaint => ({
      type: paint.type,
      gradientTransform: paint.transform,
      gradientStops: paint.stops.map((stop, i): ColorStop => {
        const key = stopKeys[i];
        const variable = key ? variables.get(key) : undefined;
        if (!variable) return stop;
        return { ...stop, boundVariables: { color: api.variables.createVariableAlias(variable) } };
      }),
    });

    /** Frottage's style of this key or name that looks the same, else a new one. */
    const settleStyle = <S extends EffectStyle | PaintStyle>(
      token: PlanEffectStyle | PlanGradientStyle,
      styles: S[],
      taken: Set<string>,
      same: (style: S) => boolean,
      make: () => S,
      fill: (style: S) => void
    ): string => {
      const found = styles.find((s) => {
        const key = s.getSharedPluginData(NAMESPACE, VALUE_KEY);
        return key !== "" && (key === token.key || ofName(s.name, token.name)) && same(s);
      });
      if (found) return found.id;
      const style = make();
      createdStyles.push(style);
      try {
        style.name = freeName(token.name, taken);
        fill(style);
        style.setSharedPluginData(NAMESPACE, VALUE_KEY, token.key);
      } catch (e) {
        createdStyles = createdStyles.filter((s) => s !== style);
        style.remove();
        throw e;
      }
      counts.stylesCreated++;
      return style.id;
    };

    try {
      // Primitives first, so that the theme's aliases have them to point at.
      const order = [
        ...plan.variables.filter((v) => v.collection === "primitives"),
        ...plan.variables.filter((v) => v.collection === "theme"),
      ];
      for (const token of order) {
        if (!(await pause())) return;
        try {
          await settleVariable(token);
        } catch {
          failures++;
        }
        if (closed) return;
      }
      const effectNames = new Set(effectStyles.map((s) => s.name));
      for (const token of plan.effectStyles) {
        if (!(await pause())) return;
        try {
          const effects = token.shadows.map((s, i) => bindEffect(effectOf(s), token.colorKeys[i]));
          const id = settleStyle(
            token,
            effectStyles,
            effectNames,
            (s) =>
              s.effects.length === effects.length &&
              effects.every((e, i) => sameEffect(s.effects[i], e)),
            () => api.createEffectStyle(),
            (s) => {
              s.effects = effects;
            }
          );
          effectIds.set(token.key, id);
        } catch {
          failures++;
        }
      }
      const paintNames = new Set(paintStyles.map((s) => s.name));
      for (const token of plan.gradientStyles) {
        if (!(await pause())) return;
        try {
          const paint = gradientOf(token);
          const id = settleStyle(
            token,
            paintStyles,
            paintNames,
            (s) => sameGradient(s.paints, paint),
            () => api.createPaintStyle(),
            (s) => {
              s.paints = [paint];
            }
          );
          gradientIds.set(token.key, id);
        } catch {
          failures++;
        }
      }
    } finally {
      if (!closed) dropEmpty();
    }
  }

  /** A collection made just now that every variable failed in has nothing to show. */
  function dropEmpty(): void {
    createdCollections = createdCollections.filter((collection) => {
      if (collection.variableIds.length > 0) return true;
      collection.remove();
      for (const [kind, home] of homes) if (home.collection === collection) homes.delete(kind);
      return false;
    });
  }

  return {
    /** Works out the plan's collections and styles. Never throws: what fails stays plain. */
    async resolve(plan: PlanLayers, options: ImportOptions, runtime: TokenRuntime): Promise<void> {
      if (!options.tokens) return;
      try {
        await settle(plan, options.useLocalStyles, runtime);
      } catch {
        failures++;
      }
    },

    variable: (key: string): Variable | undefined => variables.get(key),
    effectStyleId: (key: string): string | undefined => effectIds.get(key),
    gradientStyleId: (key: string): string | undefined => gradientIds.get(key),

    /** A Theme mode by its label, or null for one the file had no room for. */
    themeMode(name: string): { collection: VariableCollection; modeId: string } | null {
      const home = homes.get("theme");
      const modeId = home?.modeIds[home.labels.indexOf(name)];
      return home && modeId ? { collection: home.collection, modeId } : null;
    },

    counts: (): LayerCounts => ({ ...counts, modesDropped: [...counts.modesDropped] }),
    failures: () => failures,

    /** Stops the import making anything more, ahead of `discard`. */
    close() {
      closed = true;
    },

    /**
     * Takes back what this import made, where nothing else uses it, as the token set does. Styles
     * go first: one that stays holds its variables.
     */
    async discard(): Promise<void> {
      closed = true;
      const styles = createdStyles;
      const made = createdVariables;
      const collections = createdCollections;
      const modes = createdModes;
      createdStyles = [];
      createdVariables = [];
      createdCollections = [];
      createdModes = [];
      for (const style of styles) {
        try {
          if ((await style.getStyleConsumersAsync()).length === 0) style.remove();
        } catch {
          // keep it
        }
      }
      if (made.length === 0 && collections.length === 0 && modes.length === 0) return;
      try {
        const used = await usedVariables(api, made, true);
        for (const variable of made) if (!used.has(variable.id)) variable.remove();
        for (const collection of collections) {
          if (collection.variableIds.length === 0) collection.remove();
        }
        // A variable that stays keeps the values it holds in these modes.
        if (used.size > 0) return;
        for (const { collection, modeId } of modes) collection.removeMode(modeId);
      } catch {
        // keep them
      }
    },
  };
}
