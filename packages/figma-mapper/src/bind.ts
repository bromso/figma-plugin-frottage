import type { CaptureNode } from "@repo/capture-schema";
import { type Catalogue, COLOR_SCOPES, followAlias, MAX_VARIABLES } from "./catalogue";
import { inferTheme, nearTwins, primitiveName, sameColour } from "./infer";
import type {
  PlanLayers,
  PlanLayout,
  PlanOp,
  PlanRgb,
  PlanVariable,
  PlanVarValue,
  SpacingKeys,
} from "./plan";
import { effectStyles, gradientStyles } from "./styles-tokens";
import { colorKeyOf, MIN_USES, rgbaOf } from "./tokens";

/**
 * Binds each colour, corner radius and spacing length in `ops` to a variable of the catalogue: the
 * one the site used, else the only theme variable whose Light value is equal, else the only equal
 * primitive. What none of those finds stays a plain value and is counted as raw.
 */

type Rgba = PlanRgb & { a: number };
export type RawCounts = { colors: number; radii: number; spacing: number };
/** What else binding needs from the capture, and the keys text styles bound, which stay. */
export type BindContext = {
  root?: CaptureNode;
  props?: Record<string, string>;
  keep?: Iterable<string>;
};

/** Two lengths this close are the same length. */
const PX = 0.01;
const EPSILON = 1e-9;

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
  ops: PlanOp[],
  context: BindContext = {}
): { layers: PlanLayers; raw: RawCounts } {
  // Aliases point at variables the catalogue made up front, never at a step made on demand.
  const byKey = new Map(catalogue.variables.map((v) => [v.key, v]));
  const followed = (value: PlanVarValue | undefined) => followAlias(byKey, value);
  // Read before inference adds any: a site that names colours gets no unnamed primitives.
  const siteColours = catalogue.variables.some((v) => v.type === "COLOR");

  const fields: Field[] = [];
  for (const op of ops) fieldsOf(op, fields);

  const bound = new Set<string>(context.keep);
  const bind = (field: Field, v: PlanVariable) => {
    field.bind(v.key);
    bound.add(v.key);
  };

  // (1) The ref, where the variable is of the field's type. A length must also hold the field's
  // value in some mode, as a frame's padding takes in its border.
  let unbound: Field[] = [];
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

  // Roles inferred for a page with no theme join the catalogue here, before values are matched,
  // unless some layer or text style bound to a site variable by its ref.
  if (bound.size === 0 && context.root) inferTheme(catalogue, ops, context.root);

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
  const match = (field: Field) => only(field, theme) ?? only(field, primitives);

  // On a site that names no colours, an opaque colour used `MIN_USES` times that no variable takes
  // becomes a primitive named by family and step, and its uses bind to it.
  if (!siteColours) {
    const groups = new Map<string, Field[]>();
    for (const field of unbound) {
      if (field.kind !== "colors" || field.value.a < 1 - EPSILON) continue;
      const key = colorKeyOf(field.value);
      const list = groups.get(key);
      if (list) list.push(field);
      else groups.set(key, [field]);
    }
    const names = new Set(primitives.map((v) => v.name));
    const made = new Set<Field>();
    const repeated = [...groups]
      .filter(([, list]) => list.length >= MIN_USES)
      .sort(([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : 1));
    for (const [key, list] of repeated) {
      if (match(list[0] as Field)) continue;
      if (catalogue.variables.length >= MAX_VARIABLES) {
        catalogue.dropped++;
        continue;
      }
      const value = rgbaOf(key);
      const name = primitiveName(value, names);
      names.add(name);
      const v: PlanVariable = {
        key: `primitives:${name}`,
        name,
        collection: "primitives",
        type: "COLOR",
        values: [value],
        description: `Inferred: used ${list.length} times`,
        scopes: COLOR_SCOPES,
      };
      catalogue.variables.push(v);
      primitives.push(v);
      for (const field of list) {
        bind(field, v);
        made.add(field);
      }
    }
    unbound = unbound.filter((field) => !made.has(field));
  }

  // Pages repeat few values, so each is looked up once.
  const matches = new Map<string, PlanVariable | null>();
  const raw: RawCounts = { colors: 0, radii: 0, spacing: 0 };
  for (const field of unbound) {
    const at = `${field.kind}|${field.scope}|${JSON.stringify(field.value)}`;
    let v = matches.get(at);
    if (v === undefined) {
      v = match(field);
      matches.set(at, v);
    }
    if (v) bind(field, v);
    else raw[field.kind]++;
  }

  // Shadows and gradients the page repeats; their colours bind as a field's would.
  const matchColour = (value: Rgba, scope: string) => {
    const v = match({ kind: "colors", scope, value, bind() {} });
    if (v) bound.add(v.key);
    return v?.key ?? null;
  };
  const effects = effectStyles(ops, context.props ?? {}, matchColour);
  const gradients = gradientStyles(ops, matchColour);

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
      effectStyles: effects,
      gradientStyles: gradients,
      // Read after binding: refs may have asked for spacing steps past the cap.
      notes: {
        twins: nearTwins(kept),
        inferred:
          catalogue.themeSource === "inferred"
            ? theme.filter((v) => v.description.startsWith("Inferred:")).map((v) => v.name)
            : [],
        droppedPrimitives: unused + catalogue.dropped,
      },
    },
    raw,
  };
}
