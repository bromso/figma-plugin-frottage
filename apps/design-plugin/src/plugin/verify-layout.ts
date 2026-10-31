import type { PlanChildLayout, PlanLayout } from "@repo/figma-mapper";

/**
 * Compares a frame's auto layout with the capture. Everything is relative to the frame, so an error
 * up the tree does not count against what is below it. Only reads values Figma already has. Text
 * measures differently from the browser, so what text can explain is not a failure: a text node's
 * size is not checked, and neither is a HUG frame's when it holds text, whose own frame was checked
 * first; what those sizes do to their siblings is allowed for instead.
 */

type Sizing = PlanChildLayout["sizingH"];
type Laid = Exclude<PlanLayout, { mode: "NONE" }>;
type Auto = Extract<Laid, { mode: "HORIZONTAL" | "VERTICAL" }>;
type Grid = Extract<Laid, { mode: "GRID" }>;

/** A child as captured, relative to the frame. Text boxes are line boxes. */
export type ExpectedChild = {
  x: number;
  y: number;
  w: number;
  h: number;
  absolute: boolean;
  text: boolean;
  containsText: boolean;
  sizingH: Sizing;
  sizingV: Sizing;
};

/** What the frame's op proposed, and the children that were created, in frame order. */
export type ExpectedLayout = {
  layout: Laid;
  w: number;
  h: number;
  sizingH: Sizing;
  sizingV: Sizing;
  children: ExpectedChild[];
};

export type Verdict = { ok: boolean; reason?: string };

type Read = { x: number; y: number; width: number; height: number };
/** The part of a FrameNode that is read. */
export type LaidOutFrame = { width: number; height: number; children: readonly Read[] };

/** How far apart a captured and a laid out measurement may be; the mapper's own tolerance. */
const TOL = 1;

/** One axis of a child: as laid out, as captured, and how it may differ. */
type Span = { at: number; size: number; capAt: number; capSize: number };
type Item = {
  main: Span;
  cross: Span;
  /** Whether text accounts for this axis' size. */
  freeMain: boolean;
  freeCross: boolean;
  fillMain: boolean;
  fillCross: boolean;
};

const fails = (reason: string): Verdict => ({ ok: false, reason });
const PASS: Verdict = { ok: true };

/** How much of a span's size difference text explains. */
const drift = (span: Span, free: boolean) => (free ? Math.abs(span.size - span.capSize) : 0);

function toItem(read: Read, c: ExpectedChild, horizontal: boolean): Item {
  const h: Span = { at: read.x, size: read.width, capAt: c.x, capSize: c.w };
  const v: Span = { at: read.y, size: read.height, capAt: c.y, capSize: c.h };
  const freeH = c.text || (c.sizingH === "HUG" && c.containsText);
  const freeV = c.text || (c.sizingV === "HUG" && c.containsText);
  const fillH = c.sizingH === "FILL";
  const fillV = c.sizingV === "FILL";
  return horizontal
    ? { main: h, cross: v, freeMain: freeH, freeCross: freeV, fillMain: fillH, fillCross: fillV }
    : { main: v, cross: h, freeMain: freeV, freeCross: freeH, fillMain: fillV, fillCross: fillH };
}

/** Text drift that moves other children: a FILL child takes up the difference instead of adding to it. */
const explainedMain = (items: Item[]) =>
  items.reduce((sum, i) => sum + (i.fillMain ? 0 : drift(i.main, i.freeMain)), 0);
const explainedCross = (items: Item[]) =>
  items.reduce((sum, i) => sum + drift(i.cross, i.freeCross), 0);

function sizesMatch(items: Item[], mainSlack: number, crossSlack: number): boolean {
  return items.every((i) => {
    const main = i.freeMain || nearSize(i.main, i.fillMain ? mainSlack : 0);
    return main && (i.freeCross || nearSize(i.cross, i.fillCross ? crossSlack : 0));
  });
}

const nearSize = (span: Span, slack: number) => Math.abs(span.size - span.capSize) <= TOL + slack;

/** How far each end of a run of children may move when `slack` px of space appear or vanish. */
function edgeSlack(align: Auto["primaryAlign"], hugging: boolean, slack: number) {
  if (hugging || align === "SPACE_BETWEEN") return { lead: 0, trail: 0 };
  if (align === "MIN") return { lead: 0, trail: slack };
  if (align === "MAX") return { lead: slack, trail: 0 };
  return { lead: slack / 2, trail: slack / 2 };
}

/** Order, gaps and both ends of one run along the primary axis. */
function checkMain(
  line: Item[],
  size: number,
  capSize: number,
  align: Auto["primaryAlign"],
  hugging: boolean,
  slack: number
): string | null {
  const gapSlack = align.startsWith("SPACE_") ? slack / Math.max(line.length - 1, 1) : 0;
  for (let i = 1; i < line.length; i++) {
    const a = (line[i - 1] as Item).main;
    const b = (line[i] as Item).main;
    if (b.at - a.at < -TOL && b.capAt - a.capAt > TOL) return "order";
    if (b.at - a.at > TOL && b.capAt - a.capAt < -TOL) return "order";
    const gap = b.at - (a.at + a.size);
    const capGap = b.capAt - (a.capAt + a.capSize);
    if (Math.abs(gap - capGap) > TOL + gapSlack) return "gap";
  }
  const first = (line[0] as Item).main;
  const last = (line[line.length - 1] as Item).main;
  const ends = edgeSlack(align, hugging, slack);
  if (Math.abs(first.at - first.capAt) > TOL + ends.lead) return "padding";
  const trail = size - (last.at + last.size);
  const capTrail = capSize - (last.capAt + last.capSize);
  return Math.abs(trail - capTrail) > TOL + ends.trail ? "padding" : null;
}

/** Each child's place across a band: the frame, or one wrapped line of it. */
function crossFits(
  items: Item[],
  align: Auto["counterAlign"],
  band: { at: number; size: number; capAt: number; capSize: number },
  slack: number
): boolean {
  return items.every(({ cross: c }) => {
    const start = c.at - band.at;
    const capStart = c.capAt - band.capAt;
    if (align === "MAX") {
      const far = band.size - (start + c.size);
      return Math.abs(far - (band.capSize - (capStart + c.capSize))) <= TOL;
    }
    if (align === "CENTER") {
      const off = start + c.size / 2 - band.size / 2;
      return Math.abs(off - (capStart + c.capSize / 2 - band.capSize / 2)) <= TOL;
    }
    // Baselines cannot be read from boxes, so a baseline row can only be held to its text's drift.
    return Math.abs(start - capStart) <= TOL + (align === "BASELINE" ? slack : 0);
  });
}

/** Splits a run where it goes back along the axis, by `at` and `size` of each child. */
function toLines<T>(items: T[], at: (t: T) => number, size: (t: T) => number): T[][] {
  const lines: T[][] = [];
  let line: T[] = [];
  for (const item of items) {
    const prev = line[line.length - 1];
    if (prev !== undefined && at(item) < at(prev) + size(prev) - TOL) {
      lines.push(line);
      line = [];
    }
    line.push(item);
  }
  lines.push(line);
  return lines;
}

function bandOf(line: Item[]) {
  const start = Math.min(...line.map((i) => i.cross.at));
  const capStart = Math.min(...line.map((i) => i.cross.capAt));
  return {
    at: start,
    size: Math.max(...line.map((i) => i.cross.at + i.cross.size)) - start,
    capAt: capStart,
    capSize: Math.max(...line.map((i) => i.cross.capAt + i.cross.capSize)) - capStart,
  };
}

function verifyWrap(
  items: Item[],
  layout: Auto,
  size: number,
  capSize: number,
  slack: number
): Verdict {
  const lines = toLines(
    items,
    (i) => i.main.capAt,
    (i) => i.main.capSize
  );
  const laid = toLines(
    items,
    (i) => i.main.at,
    (i) => i.main.size
  );
  if (lines.length !== laid.length || lines.some((l, i) => l.length !== laid[i]?.length)) {
    return slack > TOL ? PASS : fails("wrap");
  }
  const crossSlack = explainedCross(items);
  for (const line of lines) {
    const reason = checkMain(line, size, capSize, layout.primaryAlign, false, slack);
    if (reason) return fails(reason);
    const band = bandOf(line);
    if (Math.abs(band.at - band.capAt) > TOL + crossSlack) return fails("cross");
    if (!crossFits(line, layout.counterAlign, band, crossSlack)) return fails("cross");
  }
  return PASS;
}

function verifyAuto(frame: LaidOutFrame, expected: ExpectedLayout, layout: Auto, flow: Item[]) {
  const horizontal = layout.mode === "HORIZONTAL";
  const [size, capSize, crossSize, capCrossSize] = horizontal
    ? [frame.width, expected.w, frame.height, expected.h]
    : [frame.height, expected.h, frame.width, expected.w];
  const hugging = (horizontal ? expected.sizingH : expected.sizingV) === "HUG";
  const explained = explainedMain(flow);
  const crossDelta = Math.abs(crossSize - capCrossSize);
  const slack = explained + Math.abs(size - capSize);
  if (!sizesMatch(flow, slack, crossDelta)) return fails("size");
  if (layout.wrap) return verifyWrap(flow, layout, size, capSize, slack);

  const reason = checkMain(flow, size, capSize, layout.primaryAlign, hugging, slack);
  if (reason) return fails(reason);
  const band = { at: 0, size: crossSize, capAt: 0, capSize: capCrossSize };
  return crossFits(flow, layout.counterAlign, band, explainedCross(flow)) ? PASS : fails("cross");
}

function verifyGrid(frame: LaidOutFrame, expected: ExpectedLayout, layout: Grid, flow: Item[]) {
  // Across and down: `main` is horizontal here. Only a HUG track can pass text drift along.
  const hugs = (tracks: Grid["rows"]) => tracks.some((t) => t.type === "HUG");
  const slackX =
    (hugs(layout.columns) ? explainedMain(flow) : 0) + Math.abs(frame.width - expected.w);
  const slackY =
    (hugs(layout.rows) ? explainedCross(flow) : 0) + Math.abs(frame.height - expected.h);
  if (!sizesMatch(flow, slackX, slackY)) return fails("size");
  const inCell = (i: Item) =>
    Math.abs(i.main.at - i.main.capAt) <= TOL + slackX &&
    Math.abs(i.cross.at - i.cross.capAt) <= TOL + slackY;
  return flow.every(inCell) ? PASS : fails("cell");
}

export function verifyFrame(frame: LaidOutFrame, expected: ExpectedLayout): Verdict {
  const { layout, children } = expected;
  if (frame.children.length !== children.length) return fails("children");
  const horizontal = layout.mode !== "VERTICAL";
  const flow: Item[] = [];
  for (const [i, child] of children.entries()) {
    if (!child.absolute) flow.push(toItem(frame.children[i] as Read, child, horizontal));
  }
  if (flow.length === 0) return fails("children");
  return layout.mode === "GRID"
    ? verifyGrid(frame, expected, layout, flow)
    : verifyAuto(frame, expected, layout, flow);
}
