import type { CaptureNode } from "@repo/capture-schema";
import {
  type Catalogue,
  COLOR_SCOPES,
  followAlias,
  MAX_VARIABLES,
  radiusDiffers,
} from "./catalogue";
import { inferTheme, nearTwins, primitiveName, sameColour } from "./infer";
import type {
  PlanLayout,
  PlanOp,
  PlanRgb,
  PlanStyleColor,
  PlanVarValue,
  SpacingKeys,
  StagedLayers,
  StagedVariable,
} from "./plan";
import { effectStyles, gradientStyles } from "./styles-tokens";
import { colorKeyOf, MIN_USES, rgbaOf } from "./tokens";

/**
 * Binds each color, corner radius and spacing length in `ops` to a variable of the catalogue: the
 * one the site used, else the only theme variable whose value in the captured mode is equal, else
 * the only equal primitive. What none of those finds stays a plain value and is counted as raw.
 */

type Rgba = PlanRgb & { a: number };
export type RawCounts = { colors: number; radii: number; spacing: number };
/** What else binding needs from the capture, and the keys text styles bound, which stay. */
export type BindContext = {
  root?: CaptureNode;
  props?: Record<string, string>;
  keep?: Iterable<string>;
  /** Uses an unbound color needs before it is offered to the user's paint styles. */
  floor?: number;
};

/** Two lengths this close are the same length. */
const PX = 0.01;
const EPSILON = 1e-9;

type Field =
  | {
      kind: "colors";
      scope: string;
      value: Rgba;
      ref?: string;
      /** A gradient stop: it may bind to a theme color at its own strength. */
      stop?: boolean;
      bind(key: string): void;
    }
  | {
      kind: "radii" | "spacing";
      scope: string;
      value: number;
      ref?: string | null;
      /** A corner's `rounded-<name>` class, which names its variable. */
      name?: string | null;
      bind(key: string): void;
    };

const isColour = (v: PlanVarValue): v is Rgba => typeof v === "object" && "r" in v;

const sameLength = (a: number, b: number) => Math.abs(a - b) <= PX + EPSILON;

/**
 * Whether a value alone may bind a field to `v`: only where its name gave it the field's scope. A
 * length named for nothing, as `--blur-sm`, is in every scope, and binds only by a ref.
 */
const accepts = (v: StagedVariable, scope: string) => v.scopes.includes(scope);

/**
 * A color to bind. The paint keeps its captured opacity: the applier sets 1 only once the variable,
 * which carries the alpha, is bound, so a failed binding still shows the raw color.
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

/** A gradient stop to bind: no ref says which variable it came from, so it binds by value. */
function stopField(stop: { color: PlanRgb & { a: number }; colorKey?: string }): Field {
  return {
    kind: "colors",
    scope: "ALL_FILLS",
    value: stop.color,
    stop: true,
    bind(key) {
      stop.colorKey = key;
    },
  };
}

type Followed = (value: PlanVarValue | undefined) => PlanVarValue | null;

/** Whether some mode of `v` holds `px`. */
function holds(v: StagedVariable | null, px: number, followed: Followed): boolean {
  if (v?.type !== "FLOAT") return false;
  return v.values.some((value) => {
    const n = followed(value);
    return typeof n === "number" && sameLength(n, px);
  });
}

/**
 * The stroke a frame's padding sits inside, as CSS's border-box has it, or 0. A frame's padding
 * takes in its border, so `border p-6` is 25 px from the edge, not 24. Where the stroke is the same
 * on every side and the padding refs hold the padding without it, the padding is read inside the
 * stroke and the frame counts its strokes in its layout, so it lays out as before. A side whose
 * padding is the stroke alone (CSS padding 0 inside a border) is read the same way, as 0.
 */
function strokeInset(
  op: Extract<PlanOp, { op: "frame" }>,
  catalogue: Catalogue,
  followed: Followed
): number {
  const { layout, strokes } = op;
  const refs = op.refs?.padding;
  if (layout.mode === "NONE" || !strokes) return 0;
  const { top, right, bottom, left } = strokes.weights;
  if (!(top > 0) || ![right, bottom, left].every((w) => sameLength(w, top))) return 0;
  if (layout.padding.some((px) => px < top - PX)) return 0;
  // A side whose padding is only the border (CSS padding 0) has nothing of its own to bind.
  let inside = layout.padding.some((px) => sameLength(px, top));
  for (const [side, ref] of (refs ?? []).entries()) {
    const v = ref ? catalogue.resolveRef(ref) : null;
    if (!v) continue;
    const px = layout.padding[side] as number;
    // A ref that holds the whole inset says the stroke is not inside it.
    if (holds(v, px, followed)) return 0;
    if (holds(v, px - top, followed)) inside = true;
  }
  return inside ? top : 0;
}

/** The lengths auto layout or a grid sets, each with its ref. Zero is no spacing and isn't counted. */
function spacingFields(layout: PlanLayout, refs: PlanOp["refs"], inset: number, out: Field[]) {
  if (layout.mode === "NONE") return;
  const keys = (): SpacingKeys => {
    layout.spacingKeys ??= {};
    return layout.spacingKeys;
  };
  const push = (value: number, ref: string | null | undefined, bind: (key: string) => void) => {
    if (value > 0) out.push({ kind: "spacing", scope: "GAP", value, ref, bind });
  };
  layout.padding.forEach((px, side) => {
    push(px - inset, refs?.padding?.[side], (key) => {
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

/** Each rounded corner of a frame or an image, with its ref and the class that named it. */
function cornerFields(op: Extract<PlanOp, { op: "frame" | "image" }>, out: Field[]) {
  op.radius.forEach((px, corner) => {
    if (!(px > 0)) return;
    out.push({
      kind: "radii",
      scope: "CORNER_RADIUS",
      value: px,
      ref: op.refs?.radius,
      name: op.refs?.radiusClass?.[corner],
      bind(key) {
        op.radiusKeys ??= [undefined, undefined, undefined, undefined];
        op.radiusKeys[corner] = key;
      },
    });
  });
}

function fieldsOf(op: PlanOp, out: Field[], catalogue: Catalogue, followed: Followed) {
  const refs = op.refs;
  switch (op.op) {
    case "frame": {
      for (const paint of op.fills) {
        if (paint.type === "SOLID") out.push(colourField(paint, "ALL_FILLS", refs?.background));
        // A gradient's stops bind one by one, so a gradient used once still switches by mode.
        else if (paint.type !== "IMAGE") for (const stop of paint.stops) out.push(stopField(stop));
      }
      if (op.strokes) out.push(colourField(op.strokes, "STROKE_COLOR", refs?.border));
      cornerFields(op, out);
      const inset = strokeInset(op, catalogue, followed);
      if (inset > 0 && op.layout.mode !== "NONE") op.layout.strokesIncluded = true;
      spacingFields(op.layout, refs, inset, out);
      break;
    }
    case "image":
      if (op.strokes) out.push(colourField(op.strokes, "STROKE_COLOR", undefined));
      cornerFields(op, out);
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
): { layers: StagedLayers; raw: RawCounts; warnings: string[] } {
  // Aliases point at variables the catalogue made up front, never at a step made on demand.
  const byKey = new Map(catalogue.variables.map((v) => [v.key, v]));
  const followed = (value: PlanVarValue | undefined) => followAlias(byKey, value);
  // Read before inference adds any: a site that names colors gets no unnamed primitives.
  const siteColours = catalogue.variables.some((v) => v.type === "COLOR");

  const fields: Field[] = [];
  for (const op of ops) fieldsOf(op, fields, catalogue, followed);

  const bound = new Set<string>(context.keep);
  const bind = (field: Field, v: StagedVariable) => {
    field.bind(v.key);
    bound.add(v.key);
  };

  // (1) The ref, where the variable is of the field's type. A length must also hold the field's
  // value in some mode, as a frame's padding takes in its border.
  const byRef = (field: Field): boolean => {
    const v = field.ref ? catalogue.resolveRef(field.ref) : null;
    let fits = false;
    if (v && field.kind === "colors") fits = v.type === "COLOR";
    else if (v && field.kind !== "colors") fits = holds(v, field.value, followed);
    if (v && fits) bind(field, v);
    return Boolean(v && fits);
  };
  // A ref to a variable that switches with the mode is the site's own token for the corner, and
  // beats the class that names it where it holds the corner; any other ref waits for the name.
  const multiMode = (field: Field): boolean => {
    const v = field.ref ? catalogue.resolveRef(field.ref) : null;
    if (!v) return false;
    return v.collection === "theme" || new Set(v.values.map((x) => JSON.stringify(x))).size > 1;
  };
  let unbound: Field[] = [];
  const named: Field[] = [];
  for (const field of fields) {
    if (field.kind !== "radii" || !field.name) {
      if (!byRef(field)) unbound.push(field);
    } else if (!(multiMode(field) && byRef(field))) named.push(field);
  }

  // Roles inferred for a page with no theme join the catalogue here, before values are matched,
  // unless some layer or text style bound to a site variable by its ref. Corners named by a
  // rounding class bind after this, so they never keep a page's colors from being inferred.
  if (bound.size === 0 && context.root) inferTheme(catalogue, ops, context.root);

  // A corner a `rounded-<name>` class set binds to `radius/<name>`, made with the first value it
  // meets; a corner of that name with another value is reported once and goes on as any other.
  const warnings: string[] = [];
  const differing = new Set<string>();
  for (const field of named) {
    if (field.kind !== "radii" || !field.name) continue;
    const { variable, differs, name } = catalogue.namedRadius(field.name, field.value);
    if (variable) {
      bind(field, variable);
      continue;
    }
    if (differs && !differing.has(name)) {
      differing.add(name);
      warnings.push(radiusDiffers(name));
    }
    if (!byRef(field)) unbound.push(field);
  }

  // (2) The only theme variable whose value in the mode the page was captured in is equal, (3)
  // else the only equal primitive. The page's values are that mode's, Light or not.
  const active = Math.max(0, catalogue.modes.indexOf(catalogue.activeMode));
  const equal = (field: Field, v: StagedVariable): boolean => {
    if (!accepts(v, field.scope)) return false;
    const held = followed(v.values[active] ?? v.values[0]);
    if (held === null) return false;
    if (field.kind === "colors") return isColour(held) && sameColour(held, field.value);
    return typeof held === "number" && sameLength(held, field.value);
  };
  const theme = catalogue.variables.filter((v) => v.collection === "theme");
  const primitives = catalogue.variables.filter((v) => v.collection === "primitives");
  const only = (field: Field, among: StagedVariable[]) => {
    let found: StagedVariable | null = null;
    for (const v of among) {
      if (!equal(field, v)) continue;
      if (found) return null;
      found = v;
    }
    return found;
  };
  const match = (field: Field) => only(field, theme) ?? only(field, primitives);

  // On a site that names no colors, an opaque color used `MIN_USES` times that no variable takes
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
      const v: StagedVariable = {
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

  // A gradient's stops name no variable: one that equals several theme colors binds to the first
  // only when they hold the same color in every mode, and one that is a theme color at partial
  // strength (`from-primary/50`) binds to that color made translucent in every mode.
  const modeCount = catalogue.modes.length;
  const everyMode = (v: StagedVariable) =>
    Array.from({ length: modeCount }, (_, m) => followed(v.values[m] ?? v.values[0]) ?? null);
  const alike = (vs: StagedVariable[]) =>
    vs.every(
      (v) => JSON.stringify(everyMode(v)) === JSON.stringify(everyMode(vs[0] as StagedVariable))
    );
  const themeOfStop = (value: Rgba): StagedVariable | null => {
    const translucent = value.a < 1 - EPSILON;
    // An opaque stop equals the color; a translucent one is an opaque theme color at its strength.
    const equal = theme.filter((v) => {
      const held = followed(v.values[active] ?? v.values[0]);
      if (held === null || !isColour(held)) return false;
      if (!translucent) return sameColour(held, value);
      return held.a >= 1 - EPSILON && sameColour(held, { ...value, a: 1 });
    });
    if (equal.length === 0 || !alike(equal)) return null;
    const base = equal[0] as StagedVariable;
    if (value.a >= 1 - EPSILON) return base;
    const pct = Math.round(value.a * 100);
    const name = `${base.name}-a${pct}`;
    const key = `theme:${name}`;
    const have = theme.find((v) => v.key === key);
    if (have) return have;
    if (catalogue.variables.length >= MAX_VARIABLES) {
      catalogue.dropped++;
      return null;
    }
    const values = everyMode(base).map((held) =>
      held !== null && isColour(held)
        ? { ...held, a: Math.round(held.a * value.a * 1000) / 1000 }
        : held
    ) as PlanVarValue[];
    // A mode with no color to hold makes no translucent version of it.
    if (values.some((held) => held === null)) return null;
    const made: StagedVariable = {
      key,
      name,
      collection: "theme",
      type: "COLOR",
      values,
      description: `Inferred: ${base.name} at ${pct}%`,
      scopes: COLOR_SCOPES,
    };
    catalogue.variables.push(made);
    theme.push(made);
    return made;
  };

  // Pages repeat few values, so each is looked up once.
  const matches = new Map<string, StagedVariable | null>();
  const raw: RawCounts = { colors: 0, radii: 0, spacing: 0 };
  const stayed: Field[] = [];
  for (const field of unbound) {
    const at = `${field.kind}|${field.scope}|${field.kind === "colors" && field.stop ? "stop|" : ""}${JSON.stringify(field.value)}`;
    let v = matches.get(at);
    if (v === undefined) {
      v = match(field);
      if (!v && field.kind === "colors" && field.stop && catalogue.modes.length > 1) {
        v = themeOfStop(field.value);
      }
      matches.set(at, v);
    }
    if (v) bind(field, v);
    else {
      raw[field.kind]++;
      if (field.kind === "colors" && field.value.a >= 1 - EPSILON) stayed.push(field);
    }
  }

  // An opaque color that stayed raw and repeats may still be one of the user's paint styles, as
  // on the single-collection path: the sandbox links it where one matches, else leaves it plain.
  const floor = context.floor ?? MIN_USES;
  const byColour = new Map<string, Field[]>();
  for (const field of stayed) {
    const key = `paint:${colorKeyOf(field.value as Rgba)}`;
    const list = byColour.get(key);
    if (list) list.push(field);
    else byColour.set(key, [field]);
  }
  const styleColors: PlanStyleColor[] = [];
  for (const [key, list] of byColour) {
    if (list.length < floor) continue;
    for (const field of list) field.bind(key);
    styleColors.push({ key, rgba: rgbaOf(key.slice("paint:".length)), uses: list.length });
  }

  // Shadows and gradients the page repeats; their colors bind as a field's would.
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
      activeMode: catalogue.activeMode,
      themeSource: catalogue.themeSource,
      variables: kept,
      effectStyles: effects,
      gradientStyles: gradients,
      styleColors,
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
    warnings,
  };
}
