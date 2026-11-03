import type { Catalogue } from "./catalogue";
import type {
  PlanLayers,
  PlanLayout,
  PlanOp,
  PlanRgb,
  PlanVariable,
  PlanVarValue,
  SpacingKeys,
} from "./plan";

/**
 * Binds each colour, corner radius and spacing length in `ops` to a variable of the catalogue: the
 * one the site used, else the only theme variable whose Light value is equal, else the only equal
 * primitive. What none of those finds stays a plain value and is counted as raw.
 */

type Rgba = PlanRgb & { a: number };
export type RawCounts = { colors: number; radii: number; spacing: number };

/** Two colours this close in every channel, alpha included, are the same colour. */
const CHANNEL = 1 / 255;
/** Two lengths this close are the same length. */
const PX = 0.01;
const EPSILON = 1e-9;
const MAX_ALIAS_DEPTH = 16;

type Field =
  | { kind: "colors"; scope: string; value: Rgba; ref?: string; bind(key: string): void }
  | {
      kind: "radii" | "spacing";
      scope: string;
      value: number;
      ref?: string | null;
      bind(key: string): void;
    };

const isColour = (v: PlanVarValue): v is Rgba => typeof v === "object" && "r" in v;

const sameColour = (a: Rgba, b: Rgba) =>
  Math.abs(a.r - b.r) <= CHANNEL + EPSILON &&
  Math.abs(a.g - b.g) <= CHANNEL + EPSILON &&
  Math.abs(a.b - b.b) <= CHANNEL + EPSILON &&
  Math.abs(a.a - b.a) <= CHANNEL + EPSILON;

const sameLength = (a: number, b: number) => Math.abs(a - b) <= PX + EPSILON;

const accepts = (v: PlanVariable, scope: string) =>
  v.scopes.includes(scope) || v.scopes.includes("ALL_SCOPES");

/**
 * A colour to bind. The paint keeps its captured opacity: the applier sets 1 only once the variable,
 * which carries the alpha, is bound, so a failed binding still shows the raw colour.
 */
function colourField(
  paint: { color: PlanRgb; opacity: number; colorKey?: string },
  scope: string,
  ref: string | undefined
): Field {
  return {
    kind: "colors",
    scope,
    value: { ...paint.color, a: paint.opacity },
    ref,
    bind(key) {
      paint.colorKey = key;
    },
  };
}

/** The lengths auto layout or a grid sets, each with its ref. Zero is no spacing and isn't counted. */
function spacingFields(layout: PlanLayout, refs: PlanOp["refs"], out: Field[]) {
  if (layout.mode === "NONE") return;
  const keys = (): SpacingKeys => {
    layout.spacingKeys ??= {};
    return layout.spacingKeys;
  };
  const push = (value: number, ref: string | null | undefined, bind: (key: string) => void) => {
    if (value > 0) out.push({ kind: "spacing", scope: "GAP", value, ref, bind });
  };
  layout.padding.forEach((px, side) => {
    push(px, refs?.padding?.[side], (key) => {
      const k = keys();
      k.padding ??= [undefined, undefined, undefined, undefined];
      k.padding[side] = key;
    });
  });
  const gap = (px: number, field: keyof Omit<SpacingKeys, "padding">) =>
    push(px, refs?.gap, (key) => {
      keys()[field] = key;
    });
  if (layout.mode === "GRID") {
    gap(layout.rowGap, "rowGap");
    gap(layout.columnGap, "columnGap");
  } else {
    gap(layout.itemSpacing, "itemSpacing");
    if (layout.wrap && layout.counterSpacing !== null) {
      gap(layout.counterSpacing, "counterSpacing");
    }
  }
}

function fieldsOf(op: PlanOp, out: Field[]) {
  const refs = op.refs;
  switch (op.op) {
    case "frame": {
      for (const paint of op.fills) {
        if (paint.type === "SOLID") out.push(colourField(paint, "ALL_FILLS", refs?.background));
      }
      if (op.strokes) out.push(colourField(op.strokes, "STROKE_COLOR", refs?.border));
      op.radius.forEach((px, corner) => {
        if (!(px > 0)) return;
        out.push({
          kind: "radii",
          scope: "CORNER_RADIUS",
          value: px,
          ref: refs?.radius,
          bind(key) {
            op.radiusKeys ??= [undefined, undefined, undefined, undefined];
            op.radiusKeys[corner] = key;
          },
        });
      });
      spacingFields(op.layout, refs, out);
      break;
    }
    case "image":
      if (op.strokes) out.push(colourField(op.strokes, "STROKE_COLOR", undefined));
      break;
    case "text":
      for (const run of op.runs) out.push(colourField(run, "ALL_FILLS", run.refs?.color));
      break;
  }
}

export function bindLayers(
  catalogue: Catalogue,
  ops: PlanOp[]
): { layers: PlanLayers; raw: RawCounts } {
  // Aliases point at variables the catalogue made up front, never at a step made on demand.
  const byKey = new Map(catalogue.variables.map((v) => [v.key, v]));
  /** A value with its alias followed, or null. */
  const followed = (value: PlanVarValue | undefined): PlanVarValue | null => {
    let at = value;
    for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
      if (at === undefined) return null;
      if (typeof at !== "object" || !("alias" in at)) return at;
      at = byKey.get(at.alias)?.values[0];
    }
    return null;
  };

  const fields: Field[] = [];
  for (const op of ops) fieldsOf(op, fields);

  const bound = new Set<string>();
  const bind = (field: Field, v: PlanVariable) => {
    field.bind(v.key);
    bound.add(v.key);
  };

  // (1) The ref, where the variable is of the field's type. A length must also hold the field's
  // value in some mode, as a frame's padding takes in its border.
  const unbound: Field[] = [];
  for (const field of fields) {
    const v = field.ref ? catalogue.resolveRef(field.ref) : null;
    let fits = false;
    if (v && field.kind === "colors") fits = v.type === "COLOR";
    else if (v && field.kind !== "colors" && v.type === "FLOAT") {
      fits = v.values.some((value) => {
        const n = followed(value);
        return typeof n === "number" && sameLength(n, field.value);
      });
    }
    if (v && fits) bind(field, v);
    else unbound.push(field);
  }

  // Roles inferred for a page with no theme join the catalogue here, before values are matched.

  // (2) The only theme variable whose Light value is equal, (3) else the only equal primitive.
  const equal = (field: Field, v: PlanVariable): boolean => {
    if (!accepts(v, field.scope)) return false;
    const light = followed(v.values[0]);
    if (light === null) return false;
    if (field.kind === "colors") return isColour(light) && sameColour(light, field.value);
    return typeof light === "number" && sameLength(light, field.value);
  };
  const theme = catalogue.variables.filter((v) => v.collection === "theme");
  const primitives = catalogue.variables.filter((v) => v.collection === "primitives");
  const only = (field: Field, among: PlanVariable[]) => {
    let found: PlanVariable | null = null;
    for (const v of among) {
      if (!equal(field, v)) continue;
      if (found) return null;
      found = v;
    }
    return found;
  };
  // Pages repeat few values, so each is looked up once.
  const matches = new Map<string, PlanVariable | null>();
  const raw: RawCounts = { colors: 0, radii: 0, spacing: 0 };
  for (const field of unbound) {
    const at = `${field.kind}|${field.scope}|${JSON.stringify(field.value)}`;
    let v = matches.get(at);
    if (v === undefined) {
      v = only(field, theme) ?? only(field, primitives);
      matches.set(at, v);
    }
    if (v) bind(field, v);
    else raw[field.kind]++;
  }

  // (4) The rest stayed raw. Every theme variable stays, and the primitives bound or aliased.
  for (const v of theme) {
    for (const value of v.values) {
      if (typeof value === "object" && "alias" in value) bound.add(value.alias);
    }
  }
  const kept = catalogue.variables.filter((v) => v.collection === "theme" || bound.has(v.key));
  // A spacing step made on demand and then not used was never one of the page's properties.
  const unused = primitives.filter((v) => !bound.has(v.key) && v.cssVar !== undefined).length;
  return {
    layers: {
      hostname: catalogue.hostname,
      modes: catalogue.modes,
      themeSource: catalogue.themeSource,
      variables: kept,
      effectStyles: [],
      gradientStyles: [],
      // Read after binding: refs may have asked for spacing steps past the cap.
      notes: { twins: [], inferred: [], droppedPrimitives: unused + catalogue.dropped },
    },
    raw,
  };
}
