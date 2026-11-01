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
  /** Turned about its centre: its width and height are its own, not what the layout sees. */
  rotated?: boolean;
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
  containsText: boolean;
  sizingH: Sizing;
  sizingV: Sizing;
  children: ExpectedChild[];
};

export type Verdict = { ok: boolean; reason?: string };

type Read = { x: number; y: number; width: number; height: number };
/** The part of a FrameNode that is read. */
export type LaidOutFrame = { width: number; height: number; children: readonly Read[] };

/** How far apart a captured and a laid out measurement may be; the mapper's own tolerance. */
export const TOL = 1;

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

/** How much of a span's size text accounts for, signed. */
const drift = (span: Span, free: boolean) => (free ? span.size - span.capSize : 0);

function toItem(read: Read, c: ExpectedChild, horizontal: boolean): Item {
  const h: Span = { at: read.x, size: read.width, capAt: c.x, capSize: c.w };
  const v: Span = { at: read.y, size: read.height, capAt: c.y, capSize: c.h };
  const freeH = c.text || c.rotated || (c.sizingH === "HUG" && c.containsText);
  const freeV = c.text || c.rotated || (c.sizingV === "HUG" && c.containsText);
  const fillH = c.sizingH === "FILL";
  const fillV = c.sizingV === "FILL";
  return horizontal
    ? { main: h, cross: v, freeMain: freeH, freeCross: freeV, fillMain: fillH, fillCross: fillV }
    : { main: v, cross: h, freeMain: freeV, freeCross: freeH, fillMain: fillV, fillCross: fillH };
}

/**
 * What text did to the length of a run. It nets out: one text wider and one narrower move nothing
 * beyond them. A FILL child takes up the difference instead of adding to it.
 */
const explainedMain = (items: Item[]) =>
  Math.abs(items.reduce((sum, i) => sum + (i.fillMain ? 0 : drift(i.main, i.freeMain)), 0));
/** What text did to the thickness of a run: the largest child decides, so it does not add up. */
const explainedCross = (items: Item[]) =>
  items.reduce((most, i) => Math.max(most, Math.abs(drift(i.cross, i.freeCross))), 0);

/**
 * How far a frame may be from its captured size along an axis: a FILL axis follows its parent and a
 * HUG axis its text. Null if the frame is off with nothing to explain it.
 */
function frameSlack(size: number, capSize: number, sizing: Sizing, containsText: boolean) {
  const off = Math.abs(size - capSize);
  if (sizing === "FILL" || (sizing === "HUG" && containsText)) return off;
  return off > TOL ? null : 0;
}

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

/** Space past the furthest child across the axis, as at capture. */
function crossTrailFits(items: Item[], crossSize: number, capCrossSize: number, slack: number) {
  const end = Math.max(...items.map((i) => i.cross.at + i.cross.size));
  const capEnd = Math.max(...items.map((i) => i.cross.capAt + i.cross.capSize));
  return Math.abs(crossSize - end - (capCrossSize - capEnd)) <= TOL + slack;
}

/** The breaks greedy wrapping makes at `room`, as lengths of its lines. */
function wrapAt(sizes: number[], room: number, spacing: number): number[] {
  const lengths: number[] = [];
  let used = 0;
  let count = 0;
  for (const size of sizes) {
    if (count > 0 && used + spacing + size > room) {
      lengths.push(count);
      used = 0;
      count = 0;
    }
    used += (count > 0 ? spacing : 0) + size;
    count++;
  }
  lengths.push(count);
  return lengths;
}

const sameLengths = (lengths: number[], lines: Item[][]) =>
  lengths.length === lines.length && lengths.every((n, i) => n === lines[i]?.length);

/** Whether each line comes after the one before it, reading down the frame. */
function readsDown(lines: Item[][]): boolean {
  return lines.every((line, i) => {
    const before = lines[i - 1];
    if (!before) return true;
    const band = bandOf(before);
    return bandOf(line).at >= band.at + band.size - TOL;
  });
}

/**
 * A line's place along the axis, from the padding: with its children moved between lines, there is
 * no captured offset to compare a line with.
 */
function lineFits(line: Item[], size: number, padStart: number, padEnd: number, align: string) {
  const first = (line[0] as Item).main;
  const last = (line[line.length - 1] as Item).main;
  const lead = first.at - padStart;
  const trail = size - padEnd - (last.at + last.size);
  if (align === "MIN" || align === "SPACE_BETWEEN") return Math.abs(lead) <= TOL;
  if (align === "MAX") return Math.abs(trail) <= TOL;
  return Math.abs(lead - trail) <= TOL;
}

function inBand(item: Item, band: { at: number; size: number }, align: Auto["counterAlign"]) {
  const { at, size } = item.cross;
  if (align === "MAX") return Math.abs(band.at + band.size - (at + size)) <= TOL;
  if (align === "CENTER") return Math.abs(at + size / 2 - (band.at + band.size / 2)) <= TOL;
  return align === "BASELINE" || Math.abs(at - band.at) <= TOL;
}

/**
 * Text moved children between lines, or something else did. Each line is judged on the frame's own
 * rules, and the breaks must be the ones wrapping makes in the captured width with the sizes as
 * they came out, where the captured sizes made the captured breaks. So drift got them there, and
 * neither a frame of another size nor a capture that broke its lines some other way.
 */
function verifyRebroken(
  items: Item[],
  lines: Item[][],
  laid: Item[][],
  layout: Auto,
  size: number,
  capSize: number
) {
  if (!readsDown(laid)) return fails("order");
  const [top, right, , left] = layout.padding;
  const lineGap = layout.counterSpacing ?? layout.itemSpacing;
  let bottom: number | null = null;
  for (const line of laid) {
    const band = bandOf(line);
    for (let i = 1; i < line.length; i++) {
      const a = (line[i - 1] as Item).main;
      const gap = (line[i] as Item).main.at - (a.at + a.size);
      const off = gap - layout.itemSpacing;
      if (layout.primaryAlign.startsWith("SPACE_") ? off < -TOL : Math.abs(off) > TOL) {
        return fails("gap");
      }
    }
    if (!lineFits(line, size, left, right, layout.primaryAlign)) return fails("padding");
    const expectedTop =
      bottom === null ? (layout.counterAlign === "MIN" ? top : band.at) : bottom + lineGap;
    if (Math.abs(band.at - expectedTop) > TOL) return fails("cross");
    if (!line.every((i) => inBand(i, band, layout.counterAlign))) return fails("cross");
    bottom = band.at + band.size;
  }
  const room = capSize - left - right;
  const spacing = layout.itemSpacing;
  const explains = (r: number) =>
    sameLengths(
      wrapAt(
        items.map((i) => i.main.size),
        r,
        spacing
      ),
      laid
    ) &&
    sameLengths(
      wrapAt(
        items.map((i) => i.main.capSize),
        r,
        spacing
      ),
      lines
    );
  return explains(room - TOL) || explains(room + TOL) ? PASS : fails("wrap");
}

function verifyWrap(
  items: Item[],
  layout: Auto,
  { size, capSize, crossSize, capCrossSize, slack, crossSlack, hugsCross }: Extents
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
  if (
    !sameLengths(
      lines.map((l) => l.length),
      laid
    )
  ) {
    const rebroken = verifyRebroken(items, lines, laid, layout, size, capSize);
    if (!rebroken.ok) return rebroken;
  } else {
    let above = 0;
    for (const line of lines) {
      const lineSlack = explainedMain(line) + slack;
      const reason = checkMain(line, size, capSize, layout.primaryAlign, false, lineSlack);
      if (reason) return fails(reason);
      const band = bandOf(line);
      const thickness = explainedCross(line);
      if (Math.abs(band.at - band.capAt) > TOL + above) return fails("cross");
      if (!crossFits(line, layout.counterAlign, band, thickness)) return fails("cross");
      above += thickness;
    }
  }
  // Lines stack, so what each line gained adds up.
  const across = laid.reduce((sum, line) => sum + explainedCross(line), 0);
  return crossTrailFits(items, crossSize, capCrossSize, hugsCross ? 0 : across + crossSlack)
    ? PASS
    : fails("padding");
}

/** A frame's measurements along its axes, and how far its own size may be off along each. */
type Extents = {
  size: number;
  capSize: number;
  crossSize: number;
  capCrossSize: number;
  slack: number;
  crossSlack: number;
  hugsCross: boolean;
};

function verifyAuto(frame: LaidOutFrame, expected: ExpectedLayout, layout: Auto, flow: Item[]) {
  const horizontal = layout.mode === "HORIZONTAL";
  const { w, h, sizingH, sizingV, containsText } = expected;
  const [size, capSize, crossSize, capCrossSize] = horizontal
    ? [frame.width, w, frame.height, h]
    : [frame.height, h, frame.width, w];
  const [mainSizing, crossSizing] = horizontal ? [sizingH, sizingV] : [sizingV, sizingH];
  const slack = frameSlack(size, capSize, mainSizing, containsText);
  const crossSlack = frameSlack(crossSize, capCrossSize, crossSizing, containsText);
  if (slack === null || crossSlack === null) return fails("size");
  if (!sizesMatch(flow, explainedMain(flow) + slack, crossSlack)) return fails("size");
  const hugsCross = crossSizing === "HUG";
  if (layout.wrap) {
    const extents = { size, capSize, crossSize, capCrossSize, slack, crossSlack, hugsCross };
    return verifyWrap(flow, layout, extents);
  }

  const hugging = mainSizing === "HUG";
  const runSlack = explainedMain(flow) + slack;
  const reason = checkMain(flow, size, capSize, layout.primaryAlign, hugging, runSlack);
  if (reason) return fails(reason);
  const band = { at: 0, size: crossSize, capAt: 0, capSize: capCrossSize };
  const thickness = explainedCross(flow);
  if (!crossFits(flow, layout.counterAlign, band, thickness)) return fails("cross");
  return crossTrailFits(flow, crossSize, capCrossSize, hugsCross ? 0 : thickness + crossSlack)
    ? PASS
    : fails("padding");
}

function verifyGrid(frame: LaidOutFrame, expected: ExpectedLayout, layout: Grid, flow: Item[]) {
  const { w, h, sizingH, sizingV, containsText } = expected;
  const offH = frameSlack(frame.width, w, sizingH, containsText);
  const offV = frameSlack(frame.height, h, sizingV, containsText);
  if (offH === null || offV === null) return fails("size");
  // Across and down: `main` is horizontal here. Only a HUG track can pass text drift along, and
  // each track passes on its own, so unlike a run this adds up.
  const hugs = (tracks: Grid["rows"]) => tracks.some((t) => t.type === "HUG");
  const total = (read: (i: Item) => number) => flow.reduce((sum, i) => sum + Math.abs(read(i)), 0);
  const slackX = (hugs(layout.columns) ? total((i) => drift(i.main, i.freeMain)) : 0) + offH;
  const slackY = (hugs(layout.rows) ? total((i) => drift(i.cross, i.freeCross)) : 0) + offV;
  if (!sizesMatch(flow, slackX, slackY)) return fails("size");
  const inCell = (i: Item) =>
    Math.abs(i.main.at - i.main.capAt) <= TOL + slackX &&
    Math.abs(i.cross.at - i.cross.capAt) <= TOL + slackY;
  return flow.every(inCell) ? PASS : fails("cell");
}

export function verifyFrame(frame: LaidOutFrame, expected: ExpectedLayout): Verdict {
  const { layout, children } = expected;
  // Each read of `children` builds a new array in Figma.
  const reads = frame.children;
  if (reads.length !== children.length) return fails("children");
  const horizontal = layout.mode !== "VERTICAL";
  const flow: Item[] = [];
  for (const [i, child] of children.entries()) {
    if (!child.absolute) flow.push(toItem(reads[i] as Read, child, horizontal));
  }
  if (flow.length === 0) return fails("children");
  return layout.mode === "GRID"
    ? verifyGrid(frame, expected, layout, flow)
    : verifyAuto(frame, expected, layout, flow);
}
