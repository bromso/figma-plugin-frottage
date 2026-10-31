import type { CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import type { PlanChildLayout, PlanLayout, PlanTrack } from "./plan";

/**
 * Proposes Figma auto layout from captured layout: CSS says what was meant, measured boxes say what
 * happened, and where they disagree the frame stays NONE. The applier verifies what is proposed.
 */

type AutoLayout = Extract<PlanLayout, { mode: "HORIZONTAL" | "VERTICAL" }>;
type Align = AutoLayout["primaryAlign"];
type Box = { x: number; y: number; w: number; h: number };
type Four = [number, number, number, number];
type Axis = "H" | "V";

/** How far apart two measurements may be and still mean the same; the verifier's 1 px. */
const TOL = 1;
/** How close a wrapper's box must be to its child's for the two to be one thing. */
const MATCH = 0.5;

const NONE: PlanLayout = { mode: "NONE" };

const FLEX_PARENTS = new Set(["flex", "inline-flex"]);
const GRID_PARENTS = new Set(["grid", "inline-grid"]);
const BLOCK_PARENTS = new Set(["block", "flow-root", "list-item", "inline-block"]);
const BLOCK_CHILDREN = new Set(["block", "flow-root", "list-item", "flex", "grid", "table"]);
const GENERIC_TAGS = new Set(["div", "span"]);
const NO_MARGINS: Four = [0, 0, 0, 0];

const near = (a: number, b: number, tolerance = TOL) => Math.abs(a - b) <= tolerance;

/** Whether the mapper emits an op for this node, by the same rule as its walk. */
function renders(node: CaptureNode): boolean {
  if (node.kind === "text" && node.text.length === 0) return false;
  return node.visible || (node.kind === "element" && node.children.length > 0);
}

const isAbsolute = (node: CaptureNode) =>
  node.kind === "element" && /^(absolute|fixed)$/.test(node.layout.position);

const marginsOf = (node: CaptureNode): Four =>
  node.kind === "element" ? node.layout.margin : NO_MARGINS;

const autoMargins = (node: CaptureNode) =>
  node.kind === "element" ? node.layout.marginAuto : undefined;

/** The half-leading above a text's first line: the capture has the glyph box, Figma the line box. */
export function textLeading(node: TextNode): number {
  const lineHeight = node.runs[0]?.lineHeight;
  const first = node.lines[0];
  return lineHeight != null && first ? (lineHeight - first.h) / 2 : 0;
}

/** The box a node occupies in the flow, which for text is its line boxes. */
function flowBox(node: CaptureNode): Box {
  if (node.kind !== "text") return node.box;
  const leading = textLeading(node);
  return { ...node.box, y: node.box.y - leading, h: node.box.h + 2 * leading };
}

/** CSS padding plus border, in px from each edge: [top, right, bottom, left]. */
function insets(node: ElementNode): Four {
  const [top, right, bottom, left] = node.layout.padding;
  const { borders } = node.style;
  return [
    top + borders.top.width,
    right + borders.right.width,
    bottom + borders.bottom.width,
    left + borders.left.width,
  ];
}

/** A child along the frame's axes: main is the primary axis, cross the counter axis. */
type Slot = {
  node: CaptureNode;
  start: number;
  end: number;
  crossStart: number;
  crossEnd: number;
  marginStart: number;
  marginEnd: number;
  crossMarginStart: number;
  crossMarginEnd: number;
};

function toSlot(node: CaptureNode, horizontal: boolean): Slot {
  const b = flowBox(node);
  const [top, right, bottom, left] = marginsOf(node);
  return horizontal
    ? {
        node,
        start: b.x,
        end: b.x + b.w,
        crossStart: b.y,
        crossEnd: b.y + b.h,
        marginStart: left,
        marginEnd: right,
        crossMarginStart: top,
        crossMarginEnd: bottom,
      }
    : {
        node,
        start: b.y,
        end: b.y + b.h,
        crossStart: b.x,
        crossEnd: b.x + b.w,
        marginStart: top,
        marginEnd: bottom,
        crossMarginStart: left,
        crossMarginEnd: right,
      };
}

/** The frame's measurements along the same axes as its slots. */
type Span = {
  start: number;
  size: number;
  crossStart: number;
  crossSize: number;
  insetStart: number;
  insetEnd: number;
  crossInsetStart: number;
  crossInsetEnd: number;
};

function toSpan(node: ElementNode, horizontal: boolean): Span {
  const [top, right, bottom, left] = insets(node);
  const { x, y, w, h } = node.box;
  return horizontal
    ? {
        start: x,
        size: w,
        crossStart: y,
        crossSize: h,
        insetStart: left,
        insetEnd: right,
        crossInsetStart: top,
        crossInsetEnd: bottom,
      }
    : {
        start: y,
        size: h,
        crossStart: x,
        crossSize: w,
        insetStart: top,
        insetEnd: bottom,
        crossInsetStart: left,
        crossInsetEnd: right,
      };
}

const toPadding = (
  horizontal: boolean,
  start: number,
  end: number,
  crossStart: number,
  crossEnd: number
): Four => (horizontal ? [crossStart, end, crossEnd, start] : [start, crossEnd, end, crossStart]);

/** The order CSS says the children appear in: `order`, then DOM, then any reversal. */
function cssOrder(node: ElementNode, flow: CaptureNode[]): CaptureNode[] {
  const isFlex = FLEX_PARENTS.has(node.layout.display);
  const rank = (c: CaptureNode) => (isFlex && c.kind === "element" ? c.layout.order : 0);
  const sorted = [...flow].sort((a, b) => rank(a) - rank(b) || a.paintOrder - b.paintOrder);
  return isFlex && node.layout.flexDirection?.endsWith("reverse") ? sorted.reverse() : sorted;
}

const sameOrder = (a: CaptureNode[], b: CaptureNode[]) => a.every((c, i) => c === b[i]);

/**
 * Children in the order the applier should add them: visual under auto layout, and DOM otherwise,
 * so that paint order survives. Absolute children go last, as CSS paints them over the flow.
 */
export function visualOrder(
  node: ElementNode,
  children: CaptureNode[],
  layout: PlanLayout
): CaptureNode[] {
  if (layout.mode !== "HORIZONTAL" && layout.mode !== "VERTICAL") return children;
  const flow = children.filter((c) => renders(c) && !isAbsolute(c));
  const ordered = cssOrder(node, flow);
  if (sameOrder(flow, ordered)) return children;
  return [...ordered, ...children.filter((c) => renders(c) && isAbsolute(c))];
}

/**
 * Splits slots, in CSS order, into visual lines: each runs along the axis without going back. A
 * break is only allowed when wrapping and only onto a line below. Null when the boxes do not agree
 * with the order, or overlap.
 */
function toLines(slots: Slot[], wrap: boolean): Slot[][] | null {
  const lines: Slot[][] = [];
  let line: Slot[] = [];
  for (const slot of slots) {
    const prev = line[line.length - 1];
    if (prev && slot.start < prev.end - TOL) {
      if (!wrap) return null;
      const bottom = Math.max(...line.map((s) => s.crossEnd));
      if (slot.crossStart < bottom - TOL) return null;
      lines.push(line);
      line = [];
    }
    line.push(slot);
  }
  lines.push(line);
  return lines;
}

function justifyToAlign(justify: string, horizontal: boolean, reversed: boolean): Align | null {
  const flexStart = reversed ? "MAX" : "MIN";
  const flexEnd = reversed ? "MIN" : "MAX";
  switch (justify) {
    case "normal":
    case "stretch":
    case "flex-start":
      return flexStart;
    case "flex-end":
      return flexEnd;
    case "start":
      return "MIN";
    case "end":
      return "MAX";
    case "left":
      return "MIN";
    case "right":
      return horizontal ? "MAX" : "MIN";
    case "center":
      return "CENTER";
    case "space-between":
      return "SPACE_BETWEEN";
    case "space-around":
      return "SPACE_AROUND";
    case "space-evenly":
      return "SPACE_EVENLY";
    default:
      return null;
  }
}

function itemsToAlign(align: string, horizontal: boolean): AutoLayout["counterAlign"] | null {
  switch (align) {
    case "normal":
    case "stretch":
    case "flex-start":
    case "start":
    case "self-start":
      return "MIN";
    case "center":
      return "CENTER";
    case "flex-end":
    case "end":
    case "self-end":
      return "MAX";
    case "baseline":
    case "first baseline":
      return horizontal ? "BASELINE" : "MIN";
    default:
      return null;
  }
}

/** The one value all slots share, or 0. */
function shared(slots: Slot[], read: (s: Slot) => number): number {
  const first = read(slots[0] as Slot);
  return slots.every((s) => read(s) === first) ? first : 0;
}

/** What a child's sizing depends on among its siblings. */
type Siblings = { flow: number; equalGrowth: boolean };

function siblingsOf(children: CaptureNode[], horizontal: boolean): Siblings {
  const flow = children.filter((c) => renders(c) && !isAbsolute(c));
  const grown = flow.filter((c) => c.kind === "element" && c.layout.grow > 0);
  const size = (c: CaptureNode) => (horizontal ? c.box.w : c.box.h);
  const first = grown[0];
  return {
    flow: flow.length,
    // Figma shares free space equally among FILL children, whatever the grow factors.
    equalGrowth: !first || grown.every((c) => near(size(c), size(first))),
  };
}

const TEXT_ALIGN: Partial<Record<AutoLayout["counterAlign"], RegExp>> = {
  MIN: /^(left|start|justify)/,
  CENTER: /^center$/,
  MAX: /^(right|end)$/,
};

/**
 * Whether `child` fills its parent along an axis. `target` is what remains of it after collapsing.
 * Images and other leaves never do: a fixed size is never wrong on import, and wrapping parents
 * have no FILL that means what CSS meant.
 */
function fills(
  child: CaptureNode,
  target: CaptureNode,
  axis: Axis,
  layout: AutoLayout,
  parent: ElementNode,
  siblings: Siblings
): boolean {
  if (layout.wrap) return false;
  const primary = (layout.mode === "HORIZONTAL") === (axis === "H");
  if (target.kind === "text") {
    if (primary || axis === "V" || target.lines.length < 2) return false;
    // A wider box moves the text unless the text is set to the same side as the box.
    return TEXT_ALIGN[layout.counterAlign]?.test(target.runs[0]?.align ?? "left") ?? false;
  }
  if (child.kind !== "element" || target.kind !== "element") return false;

  const { display, alignItems } = parent.layout;
  const isFlex = FLEX_PARENTS.has(display);
  const [top, right, bottom, left] = layout.padding;
  const contentW = parent.box.w - left - right;
  const widthFills = !display.startsWith("inline") && near(child.box.w, contentW);
  if (primary) {
    if (isFlex && child.layout.grow > 0 && siblings.equalGrowth) return true;
    return axis === "H" && siblings.flow === 1 && widthFills;
  }
  const stretches = isFlex && /^(normal|stretch)$/.test(child.layout.alignSelf ?? alignItems ?? "");
  if (axis === "H") {
    return widthFills || (stretches && near(child.box.w, contentW));
  }
  return stretches && near(child.box.h, parent.box.h - top - bottom);
}

/** Whether each slot sits where the shared alignment puts it within `lo` to `hi`. */
function fitsCross(
  slots: Slot[],
  lo: number,
  hi: number,
  align: AutoLayout["counterAlign"],
  skip: (s: Slot) => boolean
): boolean {
  if (align === "BASELINE") return true;
  return slots.every((s) => {
    if (skip(s)) return true;
    if (align === "MIN") return near(s.crossStart, lo);
    if (align === "MAX") return near(s.crossEnd, hi);
    return near(s.crossStart - lo, hi - s.crossEnd);
  });
}

/** Sets the sizing of a finished proposal: HUG where the content accounts for the whole frame. */
function withSizing(
  layout: AutoLayout,
  node: ElementNode,
  children: CaptureNode[],
  slots: Slot[]
): AutoLayout {
  const horizontal = layout.mode === "HORIZONTAL";
  const span = toSpan(node, horizontal);
  const siblings = siblingsOf(children, horizontal);
  const anyFill = (axis: Axis) =>
    slots.some((s) => fills(s.node, s.node, axis, layout, node, siblings));
  const [top, right, bottom, left] = layout.padding;
  const [padStart, padEnd, crossPadStart, crossPadEnd] = horizontal
    ? [left, right, top, bottom]
    : [top, bottom, left, right];
  const extent = Math.max(...slots.map((s) => s.end)) - Math.min(...slots.map((s) => s.start));
  const crossExtent =
    Math.max(...slots.map((s) => s.crossEnd)) - Math.min(...slots.map((s) => s.crossStart));
  // SPACE_* means nothing on a hugging axis, and a hugging row never wraps.
  const primaryFixed =
    layout.wrap ||
    layout.primaryAlign.startsWith("SPACE_") ||
    anyFill(horizontal ? "H" : "V") ||
    !near(span.size, padStart + extent + padEnd);
  const crossFixed =
    anyFill(horizontal ? "V" : "H") ||
    !near(span.crossSize, crossPadStart + crossExtent + crossPadEnd);
  const primarySizing = primaryFixed ? "FIXED" : "HUG";
  const crossSizing = crossFixed ? "FIXED" : "HUG";
  return {
    ...layout,
    sizingH: horizontal ? primarySizing : crossSizing,
    sizingV: horizontal ? crossSizing : primarySizing,
  };
}

/** Whether auto margins follow the one pattern Figma can show: the last of two pushed away. */
function isPushedPair(slots: Slot[], horizontal: boolean): boolean {
  const [first, last] = slots;
  if (slots.length !== 2 || !first || !last) return false;
  const startSide = horizontal ? 3 : 0;
  const endSide = horizontal ? 1 : 2;
  const allowed = (auto: boolean[] | undefined, side: number) =>
    !auto || auto.every((on, i) => !on || i === side);
  const a = autoMargins(first.node);
  const b = autoMargins(last.node);
  return allowed(a, endSide) && allowed(b, startSide);
}

function inferFlex(node: ElementNode, children: CaptureNode[], flow: CaptureNode[]): PlanLayout {
  const { flexDirection = "row", flexWrap, gap, alignItems = "normal" } = node.layout;
  const horizontal = flexDirection.startsWith("row");
  const reversed = flexDirection.endsWith("reverse");
  const wrap = flexWrap === "wrap";
  if (flexWrap === "wrap-reverse" || (wrap && !horizontal)) return NONE;

  const slots = cssOrder(node, flow).map((c) => toSlot(c, horizontal));
  const lines = toLines(slots, wrap);
  if (!lines) return NONE;

  let justify = node.layout.justifyContent ?? "normal";
  if (slots.some((s) => autoMargins(s.node))) {
    if (wrap || !isPushedPair(slots, horizontal)) return NONE;
    const [first, last] = slots as [Slot, Slot];
    if (autoMargins(first.node)) first.marginEnd = 0;
    if (autoMargins(last.node)) last.marginStart = 0;
    justify = "space-between";
  }

  const [rowGap = 0, columnGap = 0] = gap ?? [];
  const cssGap = horizontal ? columnGap : rowGap;
  let primaryAlign = justifyToAlign(justify, horizontal, reversed);
  const counterAlign = itemsToAlign(alignItems, horizontal);
  if (!primaryAlign || !counterAlign) return NONE;
  if (slots.length === 1 && primaryAlign.startsWith("SPACE_")) {
    primaryAlign = primaryAlign === "SPACE_BETWEEN" ? "MIN" : "CENTER";
  }

  const span = toSpan(node, horizontal);
  const padStart = span.insetStart + (lines[0]?.[0]?.marginStart ?? 0);
  const padEnd = span.insetEnd + (lines[0]?.[lines[0].length - 1]?.marginEnd ?? 0);
  const contentStart = span.start + padStart;
  const contentEnd = span.start + span.size - padEnd;

  // Spacing: every gap between neighbours, measured, against what CSS accounts for.
  const between = (s: Slot, next: Slot) => cssGap + s.marginEnd + next.marginStart;
  const pairs = lines.flatMap((line) =>
    line.slice(1).map((next, i) => [line[i] as Slot, next] as const)
  );
  let itemSpacing = cssGap;
  if (primaryAlign.startsWith("SPACE_")) {
    const [one] = pairs;
    if (!one || lines.length > 1) return NONE;
    if (pairs.some(([s, next]) => between(s, next) !== cssGap)) return NONE;
    const measured = one[1].start - one[0].end;
    if (measured < cssGap - TOL) return NONE;
    if (!pairs.every(([s, next]) => near(next.start - s.end, measured))) return NONE;
    const free = measured - cssGap;
    const edge = { SPACE_BETWEEN: 0, SPACE_AROUND: free / 2, SPACE_EVENLY: free }[
      primaryAlign as "SPACE_BETWEEN" | "SPACE_AROUND" | "SPACE_EVENLY"
    ];
    const line = lines[0] as Slot[];
    if (!near((line[0] as Slot).start - contentStart, edge)) return NONE;
    if (!near(contentEnd - (line[line.length - 1] as Slot).end, edge)) return NONE;
  } else {
    const [one] = pairs;
    if (one) itemSpacing = between(one[0], one[1]);
    for (const [s, next] of pairs) {
      if (!near(between(s, next), itemSpacing)) return NONE;
      if (!near(next.start - s.end, itemSpacing)) return NONE;
    }
    for (const line of lines) {
      const lead = (line[0] as Slot).start - contentStart;
      const trail = contentEnd - (line[line.length - 1] as Slot).end;
      if (primaryAlign === "MIN" && !near(lead, 0)) return NONE;
      if (primaryAlign === "MAX" && !near(trail, 0)) return NONE;
      if (primaryAlign === "CENTER" && !near(lead, trail)) return NONE;
    }
  }

  // Cross axis: uniform margins fold into padding, and each line must show the alignment.
  const crossMarginStart = shared(slots, (s) => s.crossMarginStart);
  const crossMarginEnd = shared(slots, (s) => s.crossMarginEnd);
  const crossPadStart = span.crossInsetStart + crossMarginStart;
  const crossPadEnd = span.crossInsetEnd + crossMarginEnd;
  const lo = span.crossStart + crossPadStart;
  const hi = span.crossStart + span.crossSize - crossPadEnd;

  let counterSpacing: number | null = null;
  if (wrap) {
    const rowSpacing = rowGap + crossMarginStart + crossMarginEnd;
    if (lines.length > 1 && rowSpacing <= 0 && itemSpacing > 0) return NONE;
    if (rowSpacing > 0 && !near(rowSpacing, itemSpacing, 0)) counterSpacing = rowSpacing;
  }

  const layout: AutoLayout = {
    mode: horizontal ? "HORIZONTAL" : "VERTICAL",
    wrap,
    itemSpacing,
    counterSpacing,
    padding: toPadding(horizontal, padStart, padEnd, crossPadStart, crossPadEnd),
    primaryAlign,
    counterAlign,
    sizingH: "FIXED",
    sizingV: "FIXED",
  };

  const siblings = siblingsOf(children, horizontal);
  const crossAxis: Axis = horizontal ? "V" : "H";
  const skip = (s: Slot) => fills(s.node, s.node, crossAxis, layout, node, siblings);
  if (wrap) {
    let prevEnd: number | null = null;
    for (const line of lines) {
      const top = Math.min(...line.map((s) => s.crossStart));
      const bottom = Math.max(...line.map((s) => s.crossEnd));
      if (!near(top, prevEnd === null ? lo : prevEnd + (counterSpacing ?? itemSpacing)))
        return NONE;
      if (!fitsCross(line, top, bottom, counterAlign, skip)) return NONE;
      prevEnd = bottom;
    }
  } else if (!fitsCross(slots, lo, hi, counterAlign, skip)) {
    return NONE;
  }

  return withSizing(layout, node, children, slots);
}

/** Normal flow: a vertical stack whose gaps are collapsed margins and nothing else. */
function inferBlock(node: ElementNode, children: CaptureNode[], flow: CaptureNode[]): PlanLayout {
  for (const child of flow) {
    if (child.kind === "element" && !BLOCK_CHILDREN.has(child.layout.display)) return NONE;
  }
  const slots = cssOrder(node, flow).map((c) => toSlot(c, false));
  const lines = toLines(slots, false);
  if (!lines) return NONE;

  const span = toSpan(node, false);
  const first = slots[0] as Slot;
  const last = slots[slots.length - 1] as Slot;

  const lead = first.start - (span.start + span.insetStart);
  let padStart = span.insetStart;
  if (near(lead, first.marginStart)) padStart += first.marginStart;
  else if (!(near(lead, 0) && span.insetStart === 0)) return NONE;

  const trail = span.start + span.size - span.insetEnd - last.end;
  const padEnd = span.insetEnd + (near(trail, last.marginEnd) ? last.marginEnd : 0);

  // Adjoining vertical margins collapse to the larger.
  const spacings = slots.slice(1).map((next, i) => {
    const prev = slots[i] as Slot;
    return { css: Math.max(prev.marginEnd, next.marginStart), measured: next.start - prev.end };
  });
  const itemSpacing = spacings[0]?.css ?? 0;
  if (!spacings.every((g) => near(g.css, itemSpacing) && near(g.measured, g.css))) return NONE;

  const autoSides = slots.some((s) => autoMargins(s.node));
  const crossMarginStart = autoSides ? 0 : shared(slots, (s) => s.crossMarginStart);
  const crossMarginEnd = autoSides ? 0 : shared(slots, (s) => s.crossMarginEnd);
  const crossPadStart = span.crossInsetStart + crossMarginStart;
  const crossPadEnd = span.crossInsetEnd + crossMarginEnd;
  const lo = span.crossStart + crossPadStart;
  const hi = span.crossStart + span.crossSize - crossPadEnd;

  const siblings = siblingsOf(children, false);
  for (const counterAlign of ["MIN", "CENTER", "MAX"] as const) {
    const layout: AutoLayout = {
      mode: "VERTICAL",
      wrap: false,
      itemSpacing,
      counterSpacing: null,
      padding: toPadding(false, padStart, padEnd, crossPadStart, crossPadEnd),
      primaryAlign: "MIN",
      counterAlign,
      sizingH: "FIXED",
      sizingV: "FIXED",
    };
    const skip = (s: Slot) => fills(s.node, s.node, "H", layout, node, siblings);
    if (fitsCross(slots, lo, hi, counterAlign, skip)) {
      return withSizing(layout, node, children, slots);
    }
  }
  return NONE;
}

// ---------- Grid

/** Splits on whitespace outside parentheses, or on the given separator. */
function splitTop(value: string, separator?: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && (separator ? ch === separator : /\s/.test(ch))) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

const withoutLineNames = (value: string) => value.replace(/\[[^\]]*\]/g, " ");

/** Computed tracks as pixels, or null for anything else, such as `none` or `subgrid`. */
function parsePixels(value: string | undefined): number[] | null {
  if (!value) return null;
  const tokens = splitTop(withoutLineNames(value));
  if (tokens.length === 0 || !tokens.every((t) => /^[\d.]+px$/.test(t))) return null;
  return tokens.map(Number.parseFloat);
}

/** Authored track list with `repeat()` written out; null past `limit`, or for auto-repeat. */
function expandRepeats(value: string, limit: number): string[] | null {
  const out: string[] = [];
  for (const token of splitTop(withoutLineNames(value))) {
    const repeat = /^repeat\((.*)\)$/.exec(token);
    if (!repeat) {
      out.push(token);
    } else {
      const [count, ...rest] = splitTop(repeat[1] as string, ",");
      const times = Number(count);
      const inner = expandRepeats(rest.join(","), limit);
      if (!inner || !Number.isInteger(times) || times * inner.length > limit) return null;
      for (let i = 0; i < times; i++) out.push(...inner);
    }
    if (out.length > limit) return null;
  }
  return out;
}

function authoredTrack(token: string, px: number): PlanTrack | null {
  const fr = (t: string) => (/^[\d.]+fr$/.test(t) ? Number.parseFloat(t) : null);
  const minmax = /^minmax\((.*)\)$/.exec(token);
  const flex = fr(minmax ? (splitTop(minmax[1] as string, ",")[1] ?? "") : token);
  if (flex !== null) return flex > 0 ? { type: "FLEX", value: flex } : null;
  if (minmax) return null;
  if (/^(auto|min-content|max-content|fit-content\(.*\))$/.test(token)) {
    return { type: "HUG", value: px };
  }
  if (/^[\d.]+px$/.test(token)) {
    return near(Number.parseFloat(token), px) ? { type: "FIXED", value: px } : null;
  }
  return /^([\d.]+[a-z%]+|calc\(.*\))$/.test(token) ? { type: "FIXED", value: px } : null;
}

/** Tracks from the authored value, if it describes the tracks the browser computed. */
function fromAuthored(authored: string | undefined, px: number[]): PlanTrack[] | null {
  if (!authored) return null;
  const tokens = expandRepeats(authored, px.length);
  if (!tokens || tokens.length !== px.length) return null;
  const tracks: PlanTrack[] = [];
  let unit: number | null = null;
  for (const [i, token] of tokens.entries()) {
    const size = px[i] as number;
    const track = authoredTrack(token, size);
    if (!track) return null;
    if (track.type === "FLEX") {
      // A floor from minmax() breaks the proportion that FLEX would keep.
      unit ??= size / track.value;
      if (!near(size / track.value, unit)) return null;
    }
    tracks.push(track);
  }
  return tracks;
}

function toTracks(authored: string | undefined, px: number[], hugging: boolean): PlanTrack[] {
  const tracks =
    fromAuthored(authored, px) ??
    px.map(
      (size): PlanTrack =>
        px.filter((other) => near(other, size, MATCH)).length > 1
          ? { type: "FLEX", value: 1 }
          : { type: "FIXED", value: size }
    );
  // Figma rejects FLEX tracks in a HUG container.
  return hugging
    ? tracks.map((t, i) => (t.type === "FLEX" ? { type: "FIXED", value: px[i] as number } : t))
    : tracks;
}

/** Tracks a child can span: a `span n` value, or the distance between two numbered lines. */
function spanOf(value: string | undefined): number {
  if (!value) return 1;
  const span = /span\s+(\d+)/.exec(value);
  if (span) return Number(span[1]);
  const [start, end] = value.split("/").map((s) => Number(s.trim()));
  if (start === undefined || end === undefined) return 1;
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  return start > 0 && end > 0 ? Math.abs(end - start) : 2;
}

type GridLines = { columns: number[]; rows: number[]; columnAt: number[]; rowAt: number[] };

function trackStarts(tracks: number[], origin: number, gap: number): number[] {
  let at = origin;
  return tracks.map((size) => {
    const start = at;
    at += size + gap;
    return start;
  });
}

const gridLineCache = new WeakMap<ElementNode, GridLines | null>();

function gridLines(node: ElementNode): GridLines | null {
  const hit = gridLineCache.get(node);
  if (hit !== undefined) return hit;
  const columns = parsePixels(node.layout.gridTemplateColumns);
  const rows = parsePixels(node.layout.gridTemplateRows);
  const [top, , , left] = insets(node);
  const lines =
    columns && rows
      ? {
          columns,
          rows,
          columnAt: trackStarts(columns, node.box.x + left, columnGapOf(node)),
          rowAt: trackStarts(rows, node.box.y + top, rowGapOf(node)),
        }
      : null;
  gridLineCache.set(node, lines);
  return lines;
}

const rowGapOf = (node: ElementNode) => node.layout.rowGap ?? node.layout.gap?.[0] ?? 0;
const columnGapOf = (node: ElementNode) => node.layout.columnGap ?? node.layout.gap?.[1] ?? 0;

function trackAt(start: number, size: number, starts: number[], tracks: number[]): number {
  return starts.findIndex((s, i) => near(start, s) && size <= (tracks[i] as number) + TOL);
}

function cellOf(child: CaptureNode, lines: GridLines): { row: number; column: number } | null {
  const b = flowBox(child);
  const column = trackAt(b.x, b.w, lines.columnAt, lines.columns);
  const row = trackAt(b.y, b.h, lines.rowAt, lines.rows);
  return column < 0 || row < 0 ? null : { row, column };
}

function inferGrid(node: ElementNode, flow: CaptureNode[], context: LayoutContext): PlanLayout {
  const lines = gridLines(node);
  if (!lines) return NONE;
  const taken = new Set<string>();
  for (const child of flow) {
    if (child.kind === "element") {
      if (spanOf(child.layout.gridColumn) > 1 || spanOf(child.layout.gridRow) > 1) return NONE;
    }
    const cell = cellOf(child, lines);
    if (!cell) return NONE;
    const key = `${cell.row}:${cell.column}`;
    if (taken.has(key)) return NONE;
    taken.add(key);
  }
  const parent = context.parent;
  const auto = parent?.mode === "HORIZONTAL" || parent?.mode === "VERTICAL" ? parent : undefined;
  const hugsH = auto?.sizingH === "HUG" || node.layout.display === "inline-grid";
  return {
    mode: "GRID",
    rows: toTracks(node.layout.authoredGridTemplateRows, lines.rows, auto?.sizingV === "HUG"),
    columns: toTracks(node.layout.authoredGridTemplateColumns, lines.columns, hugsH),
    rowGap: rowGapOf(node),
    columnGap: columnGapOf(node),
    padding: insets(node),
  };
}

// ---------- Public

export type LayoutContext = {
  /** The layout of the parent frame, when it has one: it decides what tracks are valid. */
  parent?: PlanLayout;
};

export function inferLayout(
  node: ElementNode,
  children: CaptureNode[],
  context: LayoutContext = {}
): PlanLayout {
  const shown = children.filter(renders);
  const flow = shown.filter((c) => !isAbsolute(c));
  if (flow.length === 0) return NONE;
  if (flow.some((c) => marginsOf(c).some((m) => m < 0))) return NONE;

  const { display } = node.layout;
  if (GRID_PARENTS.has(display)) return inferGrid(node, flow, context);
  if (BLOCK_PARENTS.has(display)) return inferBlock(node, children, flow);
  if (!FLEX_PARENTS.has(display)) return NONE;

  const layout = inferFlex(node, children, flow);
  if (layout.mode === "NONE") return layout;
  // Reordering changes what paints over what, which only an overlap can show.
  const ordered = cssOrder(node, flow);
  if (!sameOrder(flow, ordered)) {
    const absolutes = shown.filter(isAbsolute);
    if (absolutes.some((a) => flow.some((c) => overlaps(a.box, flowBox(c))))) return NONE;
  }
  return layout;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const siblingCache = new WeakMap<ElementNode, Siblings>();

function cachedSiblings(parent: ElementNode, horizontal: boolean): Siblings {
  let hit = siblingCache.get(parent);
  if (!hit) {
    hit = siblingsOf(parent.children, horizontal);
    siblingCache.set(parent, hit);
  }
  return hit;
}

/** What a node sizes itself to, apart from any parent: only auto layout frames and text can hug. */
function ownSizing(node: CaptureNode): { h: "FIXED" | "HUG"; v: "FIXED" | "HUG" } {
  if (node.kind === "text") return { h: node.lines.length > 1 ? "FIXED" : "HUG", v: "HUG" };
  if (node.kind !== "element") return { h: "FIXED", v: "FIXED" };
  const own = inferLayout(node, node.children);
  if (own.mode !== "HORIZONTAL" && own.mode !== "VERTICAL") return { h: "FIXED", v: "FIXED" };
  return { h: own.sizingH, v: own.sizingV };
}

/**
 * How `child` sits in its parent. When wrappers collapsed, `child` is the outermost wrapper, which
 * is what the parent laid out, and `target` the node that remains.
 */
export function inferChildLayout(
  child: CaptureNode,
  parent: PlanLayout,
  parentNode: ElementNode,
  target: CaptureNode = child
): PlanChildLayout {
  const positioning = isAbsolute(child) ? "ABSOLUTE" : "AUTO";
  if (parent.mode === "NONE") return { positioning, sizingH: "FIXED", sizingV: "FIXED" };
  const own = ownSizing(target);
  if (positioning === "ABSOLUTE") return { positioning, sizingH: own.h, sizingV: own.v };

  if (parent.mode === "GRID") {
    const lines = gridLines(parentNode);
    const cell = lines && cellOf(child, lines);
    const b = flowBox(child);
    const fillsTrack = (size: number, track: number | undefined) =>
      target.kind === "element" && track !== undefined && near(size, track);
    return {
      positioning,
      sizingH: fillsTrack(b.w, lines?.columns[cell?.column ?? -1]) ? "FILL" : own.h,
      sizingV: fillsTrack(b.h, lines?.rows[cell?.row ?? -1]) ? "FILL" : own.v,
      ...(cell ? { cell } : {}),
    };
  }

  const siblings = cachedSiblings(parentNode, parent.mode === "HORIZONTAL");
  // The parent judged the wrapper, which a collapsed target can differ from; FILL needs a FIXED axis.
  const fillsAxis = (axis: Axis, sizing: AutoLayout["sizingH"]) =>
    sizing === "FIXED" && fills(child, target, axis, parent, parentNode, siblings);
  return {
    positioning,
    sizingH: fillsAxis("H", parent.sizingH) ? "FILL" : own.h,
    sizingV: fillsAxis("V", parent.sizingV) ? "FILL" : own.v,
  };
}

// ---------- Collapse

const isPainted = ({ style }: ElementNode) =>
  style.backgroundColor.a > 0 ||
  style.backgroundImages.length > 0 ||
  style.boxShadows.length > 0 ||
  style.filters.length > 0 ||
  style.backdropFilter !== undefined ||
  style.clip !== undefined ||
  style.overflow.split(/\s+/).some((o) => o !== "" && o !== "visible") ||
  Object.values(style.borders).some((b) => b.width > 0);

/** What a run of same-shaped siblings shares; only one-child wrappers can collapse at all. */
function shapeOf(node: CaptureNode): string | null {
  if (node.kind !== "element") return null;
  const shown = node.children.filter(renders);
  const only = shown[0];
  if (!only || shown.length !== 1) return null;
  return `${node.semantic.tag}>${only.kind}:${only.semantic.tag}`;
}

/** Shapes that occur more than once among these children: repeated items, which Stage 2 reads. */
export function repeatedItems(children: CaptureNode[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const child of children) {
    const shape = shapeOf(child);
    if (shape === null) continue;
    if (seen.has(shape)) repeated.add(shape);
    seen.add(shape);
  }
  return repeated;
}

/** The node this one collapses into, if it is a wrapper that adds nothing. */
function wrappedChild(node: ElementNode): CaptureNode | null {
  // A custom element carries meaning Stage 2 needs, even when it paints nothing.
  if (node.semantic.tag.includes("-")) return null;
  if (!node.visible || node.opacity < 1 || node.blendMode !== "normal") return null;
  if (node.transform || isPainted(node)) return null;
  const shown = node.children.filter(renders);
  const child = shown[0];
  if (!child || shown.length !== 1 || !child.visible || isAbsolute(child)) return null;
  const b = flowBox(child);
  const { x, y, w, h } = node.box;
  return near(b.x, x, MATCH) && near(b.y, y, MATCH) && near(b.w, w, MATCH) && near(b.h, h, MATCH)
    ? child
    : null;
}

/** The inner node's own facts win; the outer one fills the gaps and names a generic tag. */
function mergeSemantic(
  outer: CaptureNode["semantic"],
  inner: CaptureNode["semantic"]
): CaptureNode["semantic"] {
  const tag = GENERIC_TAGS.has(inner.tag) ? outer.tag : inner.tag;
  return { ...outer, ...inner, tag };
}

/**
 * Follows a wrapper down to the node that stands for it, with semantics carried over. The result
 * keeps the child's id; the wrapper's is gone. `repeated` comes from `repeatedItems`.
 */
export function collapseTarget(node: CaptureNode, repeated: Set<string>): CaptureNode {
  const shape = shapeOf(node);
  if (node.kind !== "element" || (shape !== null && repeated.has(shape))) return node;
  let current: CaptureNode = node;
  let semantic = node.semantic;
  while (current.kind === "element") {
    const child: CaptureNode | null = wrappedChild(current);
    if (!child) break;
    semantic = mergeSemantic(semantic, child.semantic);
    current = child;
  }
  return current === node ? node : { ...current, semantic };
}
