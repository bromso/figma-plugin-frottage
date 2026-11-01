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
  decoration?: PlanRun["decoration"];
};

const rgb = (c: Color): PlanRgb => ({ r: c.r, g: c.g, b: c.b });
const sameColor = (p: Color, q: Color) => p.r === q.r && p.g === q.g && p.b === q.b && p.a === q.a;

function decorationOf(css: string): PlanRun["decoration"] {
  if (css.includes("underline")) return "UNDERLINE";
  if (css.includes("line-through")) return "STRIKETHROUGH";
  return "NONE";
}

const SHADOWS = new Set<PlanEffect["type"]>(["DROP_SHADOW", "INNER_SHADOW"]);

function boxPatch(node: ElementNode, hover: Hover, op: PlanOp): HoverPatch {
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

type Inherited = { color?: Color; decoration?: string };

/**
 * What `:hover` changes, per op id, compared with the look the plan already has. A colour or
 * decoration on a hovered element reaches the text below it, until a deeper element sets its own.
 * Hovering something inside also hovers what holds it, so what a holder sets is kept below.
 */
export function hoverPatches(root: CaptureNode, ops: PlanOp[]): Map<string, HoverPatch> {
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
          decoration: hover.decoration ?? inherited.decoration,
        };
        const patch = op ? boxPatch(node, hover, op) : {};
        if (Object.keys(patch).length > 0) out.set(node.id, patch);
      }
      for (const child of node.children) stack.push({ node: child, inherited });
    } else if (node.kind === "text" && op?.op === "text") {
      const patch: HoverPatch = {};
      const color = inherited.color;
      if (color && node.runs.some((r) => !sameColor(r.color, color))) patch.textColor = color;
      if (inherited.decoration !== undefined) {
        const decoration = decorationOf(inherited.decoration);
        if (node.runs.some((r) => decorationOf(r.decoration) !== decoration)) {
          patch.decoration = decoration;
        }
      }
      if (Object.keys(patch).length > 0) out.set(node.id, patch);
    }
  }
  return out;
}
