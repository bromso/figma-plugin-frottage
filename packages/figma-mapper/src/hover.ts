import type { CaptureNode, ElementNode } from "@repo/capture-schema";
import type { PlanEffect, PlanOp, PlanPaint, PlanRgb, PlanRun } from "./plan";

type Color = { r: number; g: number; b: number; a: number };
type Hover = NonNullable<ElementNode["hover"]>;

/** A patch before it has a place in a definition. */
export type HoverPatch = {
  fills?: PlanPaint[];
  strokeColor?: Color;
  opacity?: number;
  effects?: PlanEffect[];
  textColor?: Color;
  ranges?: [number, number][];
  /** The colour text inherits at rest, so `ranges` can be found again in another text. */
  resting?: Color;
  decoration?: PlanRun["decoration"];
};

const rgb = (c: Color): PlanRgb => ({ r: c.r, g: c.g, b: c.b });
const sameColor = (p: Color, q: Color) => p.r === q.r && p.g === q.g && p.b === q.b && p.a === q.a;

function decorationOf(css: string): PlanRun["decoration"] {
  if (css.includes("underline")) return "UNDERLINE";
  if (css.includes("line-through")) return "STRIKETHROUGH";
  return "NONE";
}

const hasBorder = ({ borders }: ElementNode["style"]) =>
  Object.values(borders).some((b) => b.width > 0 && !/^(none|hidden)$/.test(b.style));

const cssRgb = ({ r, g, b }: Color) =>
  `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

const SHADOWS = new Set<PlanEffect["type"]>(["DROP_SHADOW", "INNER_SHADOW"]);

function boxPatch(node: ElementNode, hover: Hover, op: PlanOp, onLost: () => void): HoverPatch {
  const patch: HoverPatch = {};
  const { style } = node;
  if (hover.opacity !== undefined && hover.opacity !== node.opacity) patch.opacity = hover.opacity;
  if (op.op !== "frame") return patch;

  const clipped = (style.backgroundClip ?? "").split(/[\s,]+/).includes("text");
  const bg = hover.backgroundColor;
  if (bg && !clipped && !sameColor(bg, style.backgroundColor)) {
    // The background colour is the lowest fill, and only there when it was painted at all.
    const rest = style.backgroundColor.a > 0 ? op.fills.slice(1) : op.fills;
    const solid: PlanPaint = { type: "SOLID", color: rgb(bg), opacity: bg.a };
    patch.fills = bg.a > 0 ? [solid, ...rest] : rest;
  }

  const stroke = op.strokes;
  const edge = hover.borderColor;
  if (edge && stroke && !sameColor(edge, { ...stroke.color, a: stroke.opacity })) {
    patch.strokeColor = edge;
  } else if (edge && !stroke && hasBorder(style)) {
    // A border that paints nothing at rest has no stroke for a patch to recolour.
    onLost();
  }

  if (hover.boxShadows) {
    const shadows = hover.boxShadows.map(
      (s): PlanEffect => ({
        type: s.inset ? "INNER_SHADOW" : "DROP_SHADOW",
        color: { ...rgb(s.color), a: s.color.a },
        offset: { x: s.x, y: s.y },
        radius: s.blur,
        spread: s.spread,
      })
    );
    const effects = [...shadows, ...op.effects.filter((e) => !SHADOWS.has(e.type))];
    if (JSON.stringify(effects) !== JSON.stringify(op.effects)) patch.effects = effects;
  }
  return patch;
}

type Inherited = { color?: Color; resting?: Color; decoration?: string };

/** The ranges of runs coloured `resting`, or all runs when it is unknown, that are not `color` yet. */
export function inheritedRanges(
  runs: Extract<PlanOp, { op: "text" }>["runs"],
  color: Color,
  resting: Color | undefined
): [number, number][] {
  const ranges: [number, number][] = [];
  for (const run of runs) {
    const at = { ...run.color, a: run.opacity };
    if (resting && !sameColor(at, resting)) continue;
    if (sameColor(at, color)) continue;
    const last = ranges.at(-1);
    if (last && last[1] === run.start) last[1] = run.end;
    else ranges.push([run.start, run.end]);
  }
  return ranges;
}

/**
 * What `:hover` changes, per op id, compared with the look the plan already has. A colour or
 * decoration on a hovered element reaches the text below it, until a deeper element sets its own.
 * Hovering something inside also hovers what holds it, so what a holder sets is kept below.
 * `onLost` hears of each layer a hover changes that no patch can reach.
 */
export function hoverPatches(
  root: CaptureNode,
  ops: PlanOp[],
  onLost: () => void = () => {}
): Map<string, HoverPatch> {
  const byId = new Map(ops.map((op) => [op.id, op]));
  const out = new Map<string, HoverPatch>();
  const stack: { node: CaptureNode; inherited: Inherited }[] = [{ node: root, inherited: {} }];
  for (let at = stack.pop(); at; at = stack.pop()) {
    const { node } = at;
    let { inherited } = at;
    const op = byId.get(node.id);
    if (node.kind === "element") {
      const { hover } = node;
      if (hover) {
        inherited = {
          color: hover.color ?? inherited.color,
          resting: hover.color ? hover.restingColor : inherited.resting,
          decoration: hover.decoration ?? inherited.decoration,
        };
        const patch = op ? boxPatch(node, hover, op, onLost) : {};
        if (Object.keys(patch).length > 0) out.set(node.id, patch);
      }
      for (const child of node.children) stack.push({ node: child, inherited });
    } else if (node.kind === "text" && op?.op === "text") {
      const patch: HoverPatch = {};
      const color = inherited.color;
      if (color) {
        const ranges = inheritedRanges(op.runs, color, inherited.resting);
        if (ranges.length > 0) {
          patch.textColor = color;
          patch.ranges = ranges;
          if (inherited.resting) patch.resting = inherited.resting;
        }
      }
      if (inherited.decoration !== undefined) {
        const decoration = decorationOf(inherited.decoration);
        if (node.runs.some((r) => decorationOf(r.decoration) !== decoration)) {
          patch.decoration = decoration;
        }
      }
      if (Object.keys(patch).length > 0) out.set(node.id, patch);
    } else if (node.kind === "svg" && inherited.color) {
      // Colours are written out in the markup, so a vector drawn in the resting colour keeps it.
      const { resting } = inherited;
      if (!resting || node.markup.includes(cssRgb(resting))) onLost();
    }
  }
  return out;
}
