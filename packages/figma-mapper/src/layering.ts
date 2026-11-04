import { COLOR_SCOPES, MAX_VARIABLES } from "./catalogue";
import { primitiveName, sameColour } from "./infer";
import type {
  PlanCollection,
  PlanCollectionKind,
  PlanLayers,
  PlanOp,
  PlanPaint,
  PlanRun,
  PlanTextStyle,
  PlanVariable,
  PlanVarValue,
  SpacingKeys,
  StagedLayers,
  StagedVariable,
} from "./plan";

/**
 * Reshapes PR #7's Primitives and Theme collections into layered ones: raw values in Palette,
 * Spacing, Border radius and Typography; whatever switches by mode in Color Mode; and a final,
 * single-mode Theme with one token per variable a layer, text style or style uses, each aliasing
 * its source. Every binding moves to its Theme token.
 *
 * This is not a pure function: it rekeys `plan.ops` and `plan.textStyles`, and the input's effect
 * and gradient styles, in place. The returned variables and collections are new.
 */

/** Creation order: each collection only aliases the ones before it. */
const ORDER: PlanCollectionKind[] = [
  "palette",
  "spacing",
  "radius",
  "typography",
  "colorMode",
  "theme",
];

export const COLLECTION_NAMES: Record<PlanCollectionKind, string> = {
  palette: "Palette",
  spacing: "Spacing",
  radius: "Border radius",
  typography: "Typography",
  colorMode: "Color Mode",
  theme: "Theme",
};

const BASE_MODE = "Base";
const THEME_MODE = "Default";
/** The order Theme tokens are made in at the cap: the switching layer first. */
const TOKEN_PRIORITY: PlanCollectionKind[] = [
  "colorMode",
  "palette",
  "spacing",
  "radius",
  "typography",
];

const TYPE_SCOPES = new Set([
  "FONT_SIZE",
  "FONT_WEIGHT",
  "FONT_FAMILY",
  "FONT_STYLE",
  "LINE_HEIGHT",
  "LETTER_SPACING",
]);

const isAlias = (v: PlanVarValue): v is { alias: string } => typeof v === "object" && "alias" in v;

/** `group/name`, keeping a name already in the group; a bare group name repeats, as `radius/radius`. */
function grouped(group: string, name: string): string {
  if (name.startsWith(`${group}/`)) return name;
  return `${group}/${name.replaceAll("/", "-")}`;
}

/** `color/gray-200` is `gray/200`; `color/brand-primary` is `brand-primary`. */
export function paletteName(name: string): string {
  const bare = name.startsWith("color/") ? name.slice("color/".length) : name;
  const m = /^(.+?)-(\d+(?:-\d+)*)$/.exec(bare);
  return m ? `${m[1]}/${m[2]}` : bare;
}

/** A semantic colour, `color/<site name>`: `card` is `color/card`, `color-primary` `color/primary`. */
function colourName(name: string): string {
  const bare = name.startsWith("color-") ? name.slice("color-".length) : name;
  return grouped("color", bare);
}

function spacingName(name: string): string {
  if (name.startsWith("space/")) return `spacing/${name.slice("space/".length)}`;
  return grouped("spacing", name === "space" ? "spacing" : name);
}

/** Where a PR #7 variable goes, and its name there; null when it fits no collection. */
function placeOf(v: StagedVariable): { kind: PlanCollectionKind; name: string } | null {
  const switches = new Set(v.values.map((value) => JSON.stringify(value))).size > 1;
  if (v.collection === "theme" || switches) {
    return { kind: "colorMode", name: v.type === "COLOR" ? colourName(v.name) : v.name };
  }
  if (v.type === "COLOR") return { kind: "palette", name: paletteName(v.name) };
  if (v.scopes.includes("GAP") || v.scopes.includes("WIDTH_HEIGHT")) {
    return { kind: "spacing", name: spacingName(v.name) };
  }
  if (v.scopes.includes("CORNER_RADIUS"))
    return { kind: "radius", name: grouped("radius", v.name) };
  if (v.scopes.some((scope) => TYPE_SCOPES.has(scope))) return { kind: "typography", name: v.name };
  if (v.type === "FLOAT") return { kind: "spacing", name: v.name };
  return null;
}

/** `name`, or `name-2` and on: the first not in `taken`, recorded as taken. */
function free(name: string, taken: Set<string>): string {
  let out = name;
  for (let n = 2; taken.has(out); n++) out = `${name}-${n}`;
  taken.add(out);
  return out;
}

type Rekey = (key: string) => string | undefined;

function rekeyPaint(paint: PlanPaint | { colorKey?: string }, rekey: Rekey) {
  if (!("colorKey" in paint) || paint.colorKey === undefined) return;
  const key = rekey(paint.colorKey);
  if (key === undefined) delete paint.colorKey;
  else paint.colorKey = key;
}

function rekeyRuns(runs: PlanRun[], rekey: Rekey) {
  for (const run of runs) rekeyPaint(run, rekey);
}

function rekeySpacing(keys: SpacingKeys, rekey: Rekey) {
  for (const field of ["itemSpacing", "counterSpacing", "rowGap", "columnGap"] as const) {
    const key = keys[field];
    if (key === undefined) continue;
    const next = rekey(key);
    if (next === undefined) delete keys[field];
    else keys[field] = next;
  }
  if (keys.padding) {
    keys.padding = keys.padding.map((key) => (key === undefined ? key : rekey(key))) as [
      string?,
      string?,
      string?,
      string?,
    ];
  }
}

/** Every variable key a plan binds by, passed through `rekey`; paint-style keys pass through too. */
function visitKeys(layers: StagedLayers, plan: LayeringPlan, rekey: Rekey) {
  for (const op of plan.ops) {
    switch (op.op) {
      case "frame": {
        for (const paint of op.fills) rekeyPaint(paint, rekey);
        if (op.strokes) rekeyPaint(op.strokes, rekey);
        if (op.radiusKeys) {
          op.radiusKeys = op.radiusKeys.map((key) => (key === undefined ? key : rekey(key))) as [
            string?,
            string?,
            string?,
            string?,
          ];
        }
        if (op.layout.mode !== "NONE" && op.layout.spacingKeys) {
          rekeySpacing(op.layout.spacingKeys, rekey);
        }
        for (const patch of op.component?.hover ?? []) {
          for (const paint of patch.fills ?? []) rekeyPaint(paint, rekey);
        }
        break;
      }
      case "image":
        if (op.strokes) rekeyPaint(op.strokes, rekey);
        break;
      case "text":
        rekeyRuns(op.runs, rekey);
        break;
      case "instance":
        for (const o of op.overrides) if (o.kind === "text") rekeyRuns(o.runs, rekey);
        break;
    }
  }
  for (const style of plan.textStyles) {
    if (!style.bind) continue;
    for (const field of Object.keys(style.bind) as (keyof NonNullable<PlanTextStyle["bind"]>)[]) {
      const key = style.bind[field];
      if (key === undefined) continue;
      const next = rekey(key);
      if (next === undefined) delete style.bind[field];
      else style.bind[field] = next;
    }
    if (Object.keys(style.bind).length === 0) delete style.bind;
  }
  for (const style of layers.effectStyles) {
    style.colorKeys = style.colorKeys.map((key) => (key === null ? null : (rekey(key) ?? null)));
  }
  for (const style of layers.gradientStyles) {
    style.stopKeys = style.stopKeys.map((key) => (key === null ? null : (rekey(key) ?? null)));
  }
}

export type LayeringPlan = { ops: PlanOp[]; textStyles: PlanTextStyle[] };

export function layerCollections(layers: StagedLayers, plan: LayeringPlan): PlanLayers {
  const byKey = new Map(layers.variables.map((v) => [v.key, v]));
  const taken = new Map<PlanCollectionKind, Set<string>>(ORDER.map((kind) => [kind, new Set()]));
  /** Each placed PR #7 variable, by its old key. */
  const moved = new Map<string, PlanVariable>();
  /** Each staged collection's old names, to new ones, for the near-twin lines. */
  const renamed = new Map<string, string>();
  let dropped = 0;

  for (const v of layers.variables) {
    const place = placeOf(v);
    if (!place) {
      dropped++;
      continue;
    }
    const name = free(place.name, taken.get(place.kind) as Set<string>);
    moved.set(v.key, {
      ...v,
      key: `${place.kind}:${name}`,
      name,
      collection: place.kind,
      values: [...v.values],
    });
    renamed.set(`${v.collection}:${v.name}`, name);
  }

  /** `color/<family>-<step>` names in use, so `primitiveName` numbers a clash. */
  const rawNames = new Set<string>();
  for (const v of moved.values()) {
    if (v.collection === "palette") rawNames.add(`color/${v.name.replace("/", "-")}`);
  }

  // Aliases follow their target; one into a variable left out holds that variable's value.
  for (const [oldKey, v] of moved) {
    const from = byKey.get(oldKey) as StagedVariable;
    v.values = v.values.map((value) => {
      if (!isAlias(value)) return value;
      const target = moved.get(value.alias);
      if (target) return { alias: target.key };
      return byKey.get(value.alias)?.values[0] ?? value;
    });
    // `Near twin of <name>` names a variable of the same collection, which may have moved.
    v.description = v.description.replace(/^Near twin of (.+)$/m, (line, twin: string) => {
      const name = renamed.get(`${from.collection}:${twin}`);
      return name ? `Near twin of ${name}` : line;
    });
  }

  // Every Color Mode colour aliases a Palette colour, adding one where none matches.
  const palette = [...moved.values()].filter((v) => v.collection === "palette");
  const paletteNames = taken.get("palette") as Set<string>;
  for (const v of moved.values()) {
    if (v.collection !== "colorMode" || v.type !== "COLOR") continue;
    v.values = v.values.map((value, i) => {
      if (isAlias(value) || typeof value !== "object") return value;
      const same = palette.filter((p) => {
        const c = p.values[0];
        return typeof c === "object" && !isAlias(c) && sameColour(c, value);
      });
      if (same.length > 0) {
        same.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        return { alias: same[0].key };
      }
      if (moved.size >= MAX_VARIABLES) {
        dropped++;
        return value;
      }
      const alpha = (value as { a?: number }).a ?? 1;
      const opaque = alpha >= 1 - 1e-6;
      // A translucent colour is named for its alpha too: `gray/50-a10`, not `gray/50-2`.
      const base = paletteName(primitiveName(value, opaque ? rawNames : new Set()));
      const name = free(opaque ? base : `${base}-a${Math.round(alpha * 100)}`, paletteNames);
      rawNames.add(`color/${name.replace("/", "-")}`);
      const entry: PlanVariable = {
        key: `palette:${name}`,
        name,
        collection: "palette",
        type: "COLOR",
        values: [value],
        description: `${
          v.cssVar ? `From the site: ${v.cssVar}` : `Inferred: value of ${v.name}`
        } (${layers.modes[i] ?? BASE_MODE})`,
        scopes: [...COLOR_SCOPES],
      };
      moved.set(entry.key, entry);
      palette.push(entry);
      return { alias: entry.key };
    });
  }

  // The sources layers use, each with one Theme token, the switching layer first at the cap.
  const used = new Set<string>();
  visitKeys(layers, plan, (key) => {
    if (moved.has(key)) used.add(key);
    return key;
  });
  const sources = [...used].sort(
    (a, b) =>
      TOKEN_PRIORITY.indexOf((moved.get(a) as PlanVariable).collection) -
      TOKEN_PRIORITY.indexOf((moved.get(b) as PlanVariable).collection)
  );
  const themeNames = taken.get("theme") as Set<string>;
  const tokenOf = new Map<string, string>();
  const tokens: PlanVariable[] = [];
  for (const oldKey of sources) {
    const source = moved.get(oldKey) as PlanVariable;
    if (moved.size + tokens.length >= MAX_VARIABLES) {
      dropped++;
      continue;
    }
    const base = source.collection === "palette" ? `color/${source.name}` : source.name;
    const name = free(base, themeNames);
    tokens.push({
      key: `theme:${name}`,
      name,
      collection: "theme",
      type: source.type,
      values: [{ alias: source.key }],
      description: `Final theme token; source: ${COLLECTION_NAMES[source.collection]}`,
      scopes: source.scopes,
      ...(source.cssVar ? { cssVar: source.cssVar } : {}),
    });
    tokenOf.set(oldKey, `theme:${name}`);
  }
  // A paint-style key links a user's style, not a variable, and stays.
  visitKeys(layers, plan, (key) => (key.startsWith("paint:") ? key : tokenOf.get(key)));

  const variables = [...moved.values(), ...tokens];
  const collections: PlanCollection[] = ORDER.filter(
    (kind) => kind === "theme" || variables.some((v) => v.collection === kind)
  ).map((kind) => ({
    kind,
    name: COLLECTION_NAMES[kind],
    modes: kind === "colorMode" ? [...layers.modes] : [kind === "theme" ? THEME_MODE : BASE_MODE],
  }));
  const rank = (v: PlanVariable) => ORDER.indexOf(v.collection);

  const twins: [string, string][] = [];
  for (const [a, b] of layers.notes.twins) {
    const x = moved.get(a);
    const y = moved.get(b);
    if (x && y) twins.push([x.key, y.key]);
  }

  return {
    ...layers,
    collections,
    // A stable sort keeps each collection's variables in the order PR #7 made them.
    variables: variables.sort((a, b) => rank(a) - rank(b)),
    notes: {
      ...layers.notes,
      twins,
      droppedPrimitives: layers.notes.droppedPrimitives + dropped,
    },
  };
}
