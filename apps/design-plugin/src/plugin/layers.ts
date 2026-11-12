import {
  COLLECTION_NAMES,
  type ImportOptions,
  type PlanCollection,
  type PlanCollectionKind,
  type PlanEffect,
  type PlanEffectStyle,
  type PlanGradientStyle,
  type PlanLayers,
  type PlanVariable,
  type PlanVarValue,
} from "@repo/figma-mapper";
import {
  COLLECTION_KEY,
  NAMESPACE,
  near,
  sameColor,
  solidColorOf,
  CHANNEL_TOLERANCE as TOLERANCE,
  type TokenRuntime,
  tagCollection,
  usedVariables,
  VALUE_KEY,
} from "./tokens";

/**
 * Settles a plan's layered collections (Palette, Spacing, Border radius, Typography, Color Mode
 * and Theme), with its effect and gradient styles, against the file. Frottage's own from an
 * earlier import are reused where they hold the same values; a user's are only ever read, and
 * bound to. PR #7's two collections are never touched. Any failure here counts and leaves what it
 * was for plain.
 */

export type LayerCounts = {
  variablesCreated: number;
  variablesReused: number;
  /** Of those created, the ones numbered `(2)` because a variable of that name held other values. */
  variablesRenamed: number;
  /** Theme modes the file had no room for. Their values weren't written. */
  modesDropped: string[];
  /**
   * Per collection settled, the modes it has for the plan, and of those the ones added just now to
   * a collection an earlier import made.
   */
  modes: LayerModes[];
  stylesCreated: number;
  /** The user's paint styles that raw colors linked to. */
  stylesReused: number;
  /** The file holds PR #7's `· Primitives` or `· Theme` collection for this host, left as it is. */
  legacyCollections: boolean;
};

export type LayerModes = {
  kind: PlanCollectionKind;
  collection: string;
  created: string[];
  added: string[];
};

/** Where the file's mode limit is kept, per user, once Figma has refused a mode. */
export const MODE_LIMIT_KEY = "modeLimit";

/** The mode limit Figma last refused a mode at, or null if it hasn't or what's stored isn't one. */
export async function getModeLimit(api: PluginAPI): Promise<number | null> {
  try {
    const held: unknown = await api.clientStorage.getAsync(MODE_LIMIT_KEY);
    return typeof held === "number" && Number.isInteger(held) && held > 0 ? held : null;
  } catch {
    return null;
  }
}

/** The N of Figma's `Limited to N modes only`, or null for any other error. */
function limitIn(e: unknown): number | null {
  const n = Number(/Limited to (\d+) modes/.exec(String(e))?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Creation order: each collection only aliases the ones before it. */
const CREATION_ORDER: PlanCollectionKind[] = [
  "palette",
  "spacing",
  "radius",
  "typography",
  "device",
  "breakpoint",
  "colorMode",
  "language",
  "theme",
];
const ONE_MODE: Record<PlanCollectionKind, string> = {
  palette: "Base",
  spacing: "Base",
  radius: "Base",
  typography: "Base",
  device: "Default",
  breakpoint: "base",
  colorMode: "Light",
  language: "Default",
  theme: "Default",
};

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

/** A new namespace: PR #7's `<hostname>#primitives` and `#theme` are never matched. */
const tagOf = (hostname: string, kind: PlanCollectionKind) => `${hostname}#layer:${kind}`;
const legacyTags = (hostname: string) => [`${hostname}#primitives`, `${hostname}#theme`];

/** `name`, or else `name (2)` and on: the first not taken, recorded as taken. */
function freeName(name: string, taken: Set<string>): string {
  let out = name;
  for (let n = 2; taken.has(out); n++) out = `${name} (${n})`;
  taken.add(out);
  return out;
}

/** A name less any ` (n)` a copy has. */
const baseName = (name: string) => name.replace(/ \(\d+\)$/, "");

/** A color in 8-bit steps, as `sameColor` tells colors apart to about half of one. */
const step = (c: number) => Math.round(c * 255);
const stepKey = (c: RGB | RGBA) => [c.r, c.g, c.b, "a" in c ? c.a : 1].map(step).join(",");
/** The steps a color `sameColor` takes for this one may be in: at most two per channel. */
function nearKeys(c: RGB | RGBA): string[] {
  const span = (v: number) => [...new Set([step(v - TOLERANCE), step(v), step(v + TOLERANCE)])];
  let keys = [""];
  for (const v of [c.r, c.g, c.b, "a" in c ? c.a : 1]) {
    keys = keys.flatMap((k) => span(v).map((s) => (k ? `${k},${s}` : `${s}`)));
  }
  return keys;
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

/** A bound color is the variable's: only the binding says whether it's the same. */
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
  /** Raw colors' keys, to the user's paint style that holds the color. */
  const paintStyleIds = new Map<string, string>();
  const homes = new Map<PlanCollectionKind, Home>();
  const counts: LayerCounts = {
    variablesCreated: 0,
    variablesReused: 0,
    variablesRenamed: 0,
    modesDropped: [],
    modes: [],
    stylesCreated: 0,
    stylesReused: 0,
    legacyCollections: false,
  };
  let failures = 0;
  let createdVariables: Variable[] = [];
  let createdCollections: VariableCollection[] = [];
  /** Modes added to a collection that was already there. A created one goes whole. */
  let createdModes: { collection: VariableCollection; modeId: string }[] = [];
  let createdStyles: (EffectStyle | PaintStyle)[] = [];
  /** Set once the import is abandoned: nothing may be created after that. */
  let closed = false;
  /** The mode the page was captured in, which it opens in. */
  let activeMode = "Light";
  /** The file's mode limit: remembered from an earlier import, or met in this one. */
  let knownLimit: number | null = null;
  /** The mode limit being stored, which `resolve` waits for. */
  let limitWrite: Promise<unknown> = Promise.resolve();

  /** Keeps the limit Figma refused a mode at, for the popup to warn by before the next capture. */
  function rememberLimit(limit: number): void {
    try {
      const write = api.clientStorage.setAsync(MODE_LIMIT_KEY, limit).catch(() => undefined);
      limitWrite = Promise.all([limitWrite, write]);
    } catch {
      // only a warning goes without it
    }
  }

  /**
   * Gives each label a mode, smallest to largest as `labels` lists them. Under the file's mode
   * limit the ones kept are the first by `priority`. With a limit remembered from before they are
   * chosen up front; else every missing one is tried, and at a first `Limited to N modes only` the
   * modes just added, which hold no values yet, are taken back and the first N by priority added.
   * A collection already there keeps its modes, and new ones go after them.
   */
  function settleModes(
    collection: VariableCollection,
    labels: string[],
    fresh: boolean,
    priority: string[] = labels
  ) {
    const ranked = [
      ...priority.filter((l) => labels.includes(l)),
      ...labels.filter((l) => !priority.includes(l)),
    ];
    const named = new Map(collection.modes.map((m) => [m.name, m.modeId]));
    const defaultName = collection.modes.find((m) => m.modeId === collection.defaultModeId)?.name;
    // A collection already there whose default mode carries none of the labels: it is the first's.
    const [narrowest] = labels;
    const asDefault =
      !fresh && narrowest !== undefined && !labels.includes(defaultName ?? "") ? narrowest : null;
    const kept = new Map<string, string>(
      fresh ? [] : labels.flatMap((l) => (named.has(l) ? [[l, named.get(l) as string]] : []))
    );
    if (asDefault !== null && !kept.has(asDefault)) kept.set(asDefault, collection.defaultModeId);
    const wanted = ranked.filter((l) => !kept.has(l));
    /** Room for `limit` modes in all: the wanted labels kept, smallest to largest. */
    const pick = (limit: number | null) => {
      const room =
        limit === null ? wanted.length : Math.max(0, limit - (fresh ? 0 : collection.modes.length));
      const chosen = new Set(wanted.slice(0, room));
      return labels.filter((l) => chosen.has(l));
    };
    type Attempt = { ids: Map<string, string>; stopped: boolean; limit: number | null };
    const add = (label: string, ids: Map<string, string>) => {
      const modeId = collection.addMode(label);
      ids.set(label, modeId);
      if (!fresh) createdModes.push({ collection, modeId });
    };
    const attempt = (chosen: string[]): Attempt => {
      const ids = new Map<string, string>();
      for (const [i, label] of chosen.entries()) {
        if (fresh && i === 0) {
          try {
            collection.renameMode(collection.defaultModeId, label);
          } catch {
            failures++;
          }
          ids.set(label, collection.defaultModeId);
          continue;
        }
        try {
          add(label, ids);
        } catch (e) {
          // A plan's limit is a limit, not a failure: `modesDropped` says so.
          if (!String(e).includes("Limited to")) failures++;
          return { ids, stopped: true, limit: limitIn(e) };
        }
      }
      return { ids, stopped: false, limit: null };
    };
    /** Takes back the modes an attempt added; the default mode stays. */
    const undo = ({ ids }: Attempt) => {
      for (const modeId of ids.values()) {
        if (modeId === collection.defaultModeId) continue;
        try {
          collection.removeMode(modeId);
        } catch {
          failures++;
        }
        createdModes = createdModes.filter((m) => m.modeId !== modeId);
      }
    };

    let chosen = pick(knownLimit);
    let tried = attempt(chosen);
    const next = wanted.find((l) => !chosen.includes(l));
    if (!tried.stopped && knownLimit !== null && next !== undefined) {
      // The limit remembered may be another file's, or the plan's since raised: try one more.
      const probe: Attempt = { ids: new Map(), stopped: false, limit: null };
      try {
        add(next, probe.ids);
      } catch (e) {
        if (!String(e).includes("Limited to")) failures++;
      }
      if (probe.ids.size > 0) {
        undo(probe);
        undo(tried);
        chosen = pick(null);
        tried = attempt(chosen);
      }
    }
    if (tried.stopped && tried.limit !== null) {
      knownLimit = tried.limit;
      rememberLimit(tried.limit);
      undo(tried);
      tried = attempt(pick(tried.limit));
    }
    const modeIds = labels.map((l) => tried.ids.get(l) ?? kept.get(l) ?? null);
    for (const [i, label] of labels.entries()) {
      if (modeIds[i] === null) counts.modesDropped.push(label);
    }
    const added = new Set(
      [...tried.ids.values()].filter((modeId) => modeId !== collection.defaultModeId)
    );
    return { modeIds, added };
  }

  async function settle(plan: PlanLayers, useLocal: boolean, runtime: TokenRuntime) {
    knownLimit = await getModeLimit(api);
    const existing = await api.variables.getLocalVariablesAsync();
    const collections = await api.variables.getLocalVariableCollectionsAsync();
    const effectStyles = plan.effectStyles.length > 0 ? await api.getLocalEffectStylesAsync() : [];
    const styleColors = useLocal ? (plan.styleColors ?? []) : [];
    const paintStyles =
      plan.gradientStyles.length > 0 || styleColors.length > 0
        ? await api.getLocalPaintStylesAsync()
        : [];
    if (closed) return;

    const pause = async () => {
      if (runtime.overBudget()) await runtime.breathe();
      return !closed;
    };
    const tagged = (c: VariableCollection) => c.getSharedPluginData(NAMESPACE, COLLECTION_KEY);
    const tags = new Map(collections.map((c) => [c.id, tagged(c)]));
    const tagIn = (c: VariableCollection) => tags.get(c.id) ?? "";
    const ownCollections = new Set(collections.filter((c) => tagIn(c) !== "").map((c) => c.id));
    const legacy = legacyTags(plan.hostname);
    if (collections.some((c) => legacy.includes(tagIn(c)))) counts.legacyCollections = true;
    /** Every collection name in the file, with those made just now. */
    const collectionNames = new Set(collections.map((c) => c.name));
    const defaults = new Map(collections.map((c) => [c.id, c.defaultModeId]));
    const modeCounts = new Map(collections.map((c) => [c.id, c.modes.length]));
    // Each variable is read once here: a file can hold thousands, each read crosses into Figma,
    // and every token would otherwise look through them all.
    const held = existing.map((v, at) => ({
      v,
      at,
      collectionId: v.variableCollectionId,
      type: v.resolvedType,
      name: v.name,
      key: v.getSharedPluginData(NAMESPACE, VALUE_KEY),
    }));
    type Held = (typeof held)[number];
    const push = <K>(map: Map<K, Held[]>, key: K, h: Held) => {
      const list = map.get(key);
      if (list) list.push(h);
      else map.set(key, [h]);
    };
    /** Frottage's own, by collection and value key, and by collection and name, with and without any `(n)`. */
    const ownByKey = new Map<string, Held[]>();
    const ownByName = new Map<string, Held[]>();
    // Colors only, as before layers: a number or a string says too little to take a user's.
    /** The user's colors, by their default mode's value in 8-bit steps. */
    const theirs = new Map<string, { h: Held; value: VariableValue }[]>();
    for (const h of held) {
      const own = ownCollections.has(h.collectionId) || h.key !== "";
      if (own) {
        if (h.key) push(ownByKey, `${h.collectionId}\0${h.key}`, h);
        push(ownByName, `${h.collectionId}\0${h.name}`, h);
        const base = baseName(h.name);
        if (base !== h.name) push(ownByName, `${h.collectionId}\0${base}`, h);
      } else if (
        useLocal &&
        h.type === "COLOR" &&
        // A variable that switches by mode would carry the user's mode switch into the page.
        modeCounts.get(h.collectionId) === 1
      ) {
        const value = h.v.valuesByMode[defaults.get(h.collectionId) ?? ""];
        if (!isColor(value)) continue;
        const key = stepKey(value);
        const list = theirs.get(key);
        if (list) list.push({ h, value });
        else theirs.set(key, [{ h, value }]);
      }
    }
    /** The user's first color variable, in file order, holding `want`. */
    const theirColour = (want: VariableValue): Variable | null => {
      if (!isColor(want)) return null;
      let best: Held | null = null;
      for (const key of nearKeys(want)) {
        for (const { h, value } of theirs.get(key) ?? []) {
          if ((!best || h.at < best.at) && sameValue(value, want)) best = h;
        }
      }
      return best?.v ?? null;
    };
    const planned = new Map(plan.variables.map((v) => [v.key, v]));

    /** The plan's collection of a kind; a plan without them still names its six. */
    const described = (kind: PlanCollectionKind): PlanCollection =>
      plan.collections.find((c) => c.kind === kind) ?? {
        kind,
        name: COLLECTION_NAMES[kind],
        modes: kind === "colorMode" ? plan.modes : [ONE_MODE[kind]],
      };

    /**
     * A new collection's name: the plan's, else `<name> (Frottage)` beside a user's of that name,
     * or `<name> (<hostname>)` beside another host's; numbered on if that is taken too.
     */
    const nameFor = (name: string): string => {
      if (!collectionNames.has(name)) {
        collectionNames.add(name);
        return name;
      }
      const users = collections.some((c) => c.name === name && tagIn(c) === "");
      return freeName(`${name} (${users ? "Frottage" : plan.hostname})`, collectionNames);
    };

    /** Frottage's collection of this kind, by its tag, else a new one. Made only when needed. */
    const homeOf = (kind: PlanCollectionKind): Home => {
      const known = homes.get(kind);
      if (known) return known;
      const { name, modes, priority } = described(kind);
      const tag = tagOf(plan.hostname, kind);
      let collection = collections.find((c) => !c.remote && !c.isExtension && tagIn(c) === tag);
      const fresh = !collection;
      if (!collection) {
        collection = api.variables.createVariableCollection(nameFor(name));
        createdCollections.push(collection);
        tagCollection(collection, tag);
      }
      const labels = modes.length > 0 ? modes : [ONE_MODE[kind]];
      const { id } = collection;
      const names = held.filter((h) => h.collectionId === id).map((h) => h.name);
      const home = {
        collection,
        taken: new Set(names),
        labels,
        ...settleModes(collection, labels, fresh, priority),
      };
      counts.modes.push({
        kind,
        collection: collection.name,
        created: labels.filter((_, i) => home.modeIds[i] != null),
        added: fresh ? [] : labels.filter((_, i) => home.added.has(home.modeIds[i] ?? "")),
      });
      homes.set(kind, home);
      return home;
    };

    /** Whether a collection has its first mode and another: one mode has nothing to switch. */
    const switches = ({ modeIds }: Home) =>
      modeIds[0] != null && modeIds.filter((id) => id !== null).length > 1;

    /**
     * The value a missing mode falls back to: a Breakpoint variable's widest mode, its last, since
     * the modes run narrowest to widest; any other's first.
     */
    const widest = (v: PlanVariable): PlanVarValue | undefined =>
      v.collection === "breakpoint" ? v.values[v.values.length - 1] : v.values[0];

    /**
     * A plan value as Figma holds it: an alias goes to the variable its key settled on. With no
     * variable for it, down the chain to the first that has one, or to the value at its foot, so
     * that the theme still reads right.
     */
    const figmaValue = (value: PlanVarValue, depth = 0): VariableValue => {
      if (typeof value !== "object" || !("alias" in value)) return value;
      const target = variables.get(value.alias);
      if (target) return api.variables.createVariableAlias(target);
      const pointed = planned.get(value.alias);
      const next = pointed && widest(pointed);
      if (next === undefined || depth >= CREATION_ORDER.length) throw new Error("alias to nothing");
      return figmaValue(next, depth + 1);
    };

    /** Frottage's variable of this key or name in the home, holding these values, if any. */
    const reuse = async (
      token: PlanVariable,
      wants: Map<string, VariableValue>,
      { collection, added }: Home
    ): Promise<Variable | null> => {
      const fits = ({ v, type }: Held) => {
        if (type !== token.type) return false;
        const values = v.valuesByMode;
        return [...wants].every(
          ([modeId, want]) => added.has(modeId) || sameValue(values[modeId], want)
        );
      };
      // Its key or its name, in file order, as one scan of them all would find it.
      const at = `${collection.id}\0`;
      const byName = (ownByName.get(at + token.name) ?? []).filter((h) =>
        ofName(h.name, token.name)
      );
      const candidates = [...new Set([...(ownByKey.get(at + token.key) ?? []), ...byName])].sort(
        (a, b) => a.at - b.at
      );
      const found = candidates.find(fits)?.v;
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
      const lead = widest(token);
      if (lead === undefined) throw new Error("no value");
      const first = figmaValue(lead);
      if (token.collection === "palette" && token.type === "COLOR" && theirs.size > 0) {
        const match = theirColour(first);
        if (match) {
          variables.set(token.key, match);
          counts.variablesReused++;
          return;
        }
      }
      const home = homeOf(token.collection);
      // Texts show the page's own language, so Language needs it and another to switch to.
      if (token.collection === "language" && !switches(home)) return;
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
      if (variable.name !== token.name) counts.variablesRenamed++;
    };

    /** Binds a color to its variable. A refused binding stays plain. */
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
        // Only what Figma knows: a stop's own key is the mapper's, and Figma refuses the paint.
        const plain: ColorStop = { position: stop.position, color: stop.color };
        const key = stopKeys[i];
        const variable = key ? variables.get(key) : undefined;
        if (!variable) return plain;
        return { ...plain, boundVariables: { color: api.variables.createVariableAlias(variable) } };
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

    // A raw color links to the user's solid paint style of that color, as before layers.
    if (styleColors.length > 0) {
      const solids = paintStyles.flatMap((style) => {
        if (style.getSharedPluginData(NAMESPACE, VALUE_KEY) !== "") return [];
        const color = solidColorOf(style);
        return color ? [{ id: style.id, color }] : [];
      });
      for (const token of styleColors) {
        const style = solids.find((s) => sameColor(s.color, token.rgba));
        if (!style) continue;
        paintStyleIds.set(token.key, style.id);
        counts.stylesReused++;
      }
    }

    try {
      // In the plan's collection order, lower first, so that the aliases above have them to
      // point at; a kind the plan leaves out of its list comes after, in its usual place.
      const listed = plan.collections.map((c) => c.kind);
      const kinds = [...listed, ...CREATION_ORDER.filter((k) => !listed.includes(k))];
      const order = kinds.flatMap((kind) => plan.variables.filter((v) => v.collection === kind));
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
      for (const [kind, home] of homes) {
        if (home.collection !== collection) continue;
        homes.delete(kind);
        // Its modes went with it; the ones it had no room for are still in `modesDropped`.
        counts.modes = counts.modes.filter((m) => m.kind !== kind);
      }
      return false;
    });
  }

  /** A mode of a collection by its label, or null for one the file had no room for. */
  function modeOf(
    kind: PlanCollectionKind,
    name: string
  ): { collection: VariableCollection; modeId: string } | null {
    const home = homes.get(kind);
    const modeId = home?.modeIds[home.labels.indexOf(name)];
    return home && modeId ? { collection: home.collection, modeId } : null;
  }

  /** A Color Mode mode by its label, or null for one the file had no room for. */
  const themeMode = (name: string) => modeOf("colorMode", name);

  return {
    /** Works out the plan's collections and styles. Never throws: what fails stays plain. */
    async resolve(plan: PlanLayers, options: ImportOptions, runtime: TokenRuntime): Promise<void> {
      if (!options.tokens) return;
      activeMode = plan.activeMode ?? "Light";
      try {
        await settle(plan, options.useLocalStyles, runtime);
      } catch {
        failures++;
      }
      await limitWrite;
    },

    variable: (key: string): Variable | undefined => variables.get(key),
    effectStyleId: (key: string): string | undefined => effectIds.get(key),
    gradientStyleId: (key: string): string | undefined => gradientIds.get(key),
    paintStyleId: (key: string): string | undefined => paintStyleIds.get(key),

    modeOf,
    themeMode,

    /** The Color Mode mode a page opens in: the one it was captured in, else Light. */
    openingMode: () => themeMode(activeMode) ?? themeMode("Light"),

    counts: (): LayerCounts => ({
      ...counts,
      modesDropped: [...counts.modesDropped],
      modes: counts.modes.map((m) => ({ ...m, created: [...m.created], added: [...m.added] })),
    }),
    failures: () => failures,

    /** Stops the import making anything more, ahead of `discard`. */
    close() {
      closed = true;
    },

    /**
     * Takes back what this import made, where nothing else uses it, as the token set does. Styles
     * go first: one that stays holds its variables. Then the variables and collections from the
     * top layer down, so that each goes before the ones it aliases.
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
        for (const variable of [...made].reverse()) if (!used.has(variable.id)) variable.remove();
        for (const collection of [...collections].reverse()) {
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
