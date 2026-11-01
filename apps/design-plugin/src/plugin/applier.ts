import type {
  FontRef,
  ImportOptions,
  PlanEffect,
  PlanOp,
  PlanPaint,
  PlanRgb,
  PlanRun,
  PlanStroke,
  PlanTokens,
  PlanTrack,
} from "@repo/figma-mapper";
import {
  alignedX,
  type Built,
  clampSize,
  createLayoutTracker,
  type TextFit,
  widenToLines,
} from "./layout-tracker";
import { createTokenSet, NO_TOKENS, type TokenCounts, type TokenSet } from "./tokens";

/**
 * Turns plan ops into Figma layers. Runs in the plugin sandbox. Only types come
 * from @repo/figma-mapper, so plugin.js never bundles Zod or fflate.
 */

export type ImportMeta = { name: string; fonts: FontRef[]; totalOps: number };
export type EndResult = TokenCounts & {
  rootId: string;
  failedOps: number;
  missingImages: number;
  rewrappedTexts: number;
  /** Text in verified frames that came out a different size from the capture: `text-drift`. */
  textDriftCount: number;
  /** Frames that were proposed auto layout and kept it. */
  autoLayoutFrames: number;
  /** Frames that were proposed auto layout and went back to absolute. */
  fallbackFrames: number;
  fallbackReasons: Record<string, number>;
};

type Corners = [number, number, number, number];
type FrameOp = Extract<PlanOp, { op: "frame" }>;
type TextOp = Extract<PlanOp, { op: "text" }>;

const FALLBACK: FontRef = { family: "Inter", style: "Regular" };
const GAP = 100;
/** The largest SVG source handed to Figma. Capture applies the same limit; a file can still hold more. */
const MAX_SVG_BYTES = 256 * 1024;
/**
 * Ops and verification share a batch's time, checked between them. This is half of the 2 s a batch
 * may take, as a single op or fallback can run on past it.
 */
const MAX_SLICE_MS = 1000;

/** What `end` returns when the import was cancelled under it. */
const CANCELLED: EndResult = {
  rootId: "",
  failedOps: 0,
  missingImages: 0,
  rewrappedTexts: 0,
  textDriftCount: 0,
  autoLayoutFrames: 0,
  fallbackFrames: 0,
  fallbackReasons: {},
  ...NO_TOKENS,
};

const fontKey = (f: FontRef) => `${f.family}\u0000${f.style}`;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** UTF-8 size without TextEncoder, which the plugin sandbox may not have. */
function utf8Bytes(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4; // a surrogate pair is one 4-byte character
      i++;
    } else n += 3;
  }
  return n;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createApplier(api: PluginAPI) {
  let active = false;
  let page: PageNode | null = null;
  let root: FrameNode | null = null;
  let rootName = "";
  let rootX = 0;
  let rootAttempted = false;
  let pending: SceneNode | null = null;
  let nodes = new Map<string, SceneNode>();
  let failed = new Set<string>();
  let images = new Map<string, string>();
  let loadedFonts = new Set<string>();
  let fallbackOk = true;
  let failedOps = 0;
  let missingImages = 0;
  let tracker = createLayoutTracker();
  /** Set while building FILL text, whose lines are judged once its width is final. */
  let fillFit: TextFit | null = null;
  let sliceStart = 0;
  /** Changes when an import ends, so that work suspended in a yield can tell. */
  let generation = 0;
  /** This import's tokens, from `importTokens` until they are kept or taken back. */
  let tokens: TokenSet | null = null;
  /** Taking tokens back is asynchronous, and the next import must not read them halfway. */
  let cleaning: Promise<unknown> = Promise.resolve();
  /** Style links for the op being built, which need the node finished and in the tree. */
  let styleLinks: (() => Promise<void>)[] = [];

  function reset() {
    generation++;
    if (root) {
      try {
        root.remove();
      } catch {
        // already gone
      }
    }
    if (tokens) cleaning = Promise.all([cleaning, tokens.discard()]);
    tokens = null;
    root = null;
    rootName = "";
    page = null;
    active = false;
    rootAttempted = false;
    pending = null;
    nodes = new Map();
    failed = new Set();
    images = new Map();
    loadedFonts = new Set();
    fallbackOk = true;
    failedOps = 0;
    missingImages = 0;
    tracker = createLayoutTracker();
    fillFit = null;
    styleLinks = [];
  }

  async function loadFont(f: FontRef): Promise<void> {
    try {
      await api.loadFontAsync(f);
      loadedFonts.add(fontKey(f));
    } catch {
      // stays out of loadedFonts; text using it falls back
    }
  }

  async function begin(meta: ImportMeta): Promise<void> {
    reset();
    await cleaning;
    api.commitUndo();
    active = true;
    rootName = meta.name;
    page = api.currentPage;
    await Promise.all([loadFont(FALLBACK), ...meta.fonts.map(loadFont)]);
    fallbackOk = loadedFonts.has(fontKey(FALLBACK));

    let right = 0;
    let any = false;
    for (const child of page.children) {
      const edge = child.x + child.width;
      if (!any || edge > right) right = edge;
      any = true;
    }
    rootX = any ? right + GAP : 0;
  }

  /** Settles the plan's tokens against the file. Comes before any batch that uses them. */
  async function importTokens(plan: PlanTokens, options: ImportOptions): Promise<void> {
    if (!active) throw new Error("import not started");
    const run = generation;
    tokens ??= createTokenSet(api);
    sliceStart = Date.now();
    await tokens.resolve(plan, options, {
      overBudget,
      breathe: () => breathe(run),
      ensureFont: async (font) => {
        if (!loadedFonts.has(fontKey(font))) await loadFont(font);
        return loadedFonts.has(fontKey(font));
      },
    });
  }

  async function addImage(
    hash: string,
    bytes: Uint8Array
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      images.set(hash, api.createImage(bytes).hash);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: message(e) };
    }
  }

  /** A plain paint, bound to its variable if it has one. A refused binding stays plain. */
  function solidPaint(color: PlanRgb, opacity: number, colorKey?: string): SolidPaint {
    const paint: SolidPaint = { type: "SOLID", color, opacity };
    const binding = tokens?.color(colorKey);
    if (!binding || !("variable" in binding)) return paint;
    try {
      return api.variables.setBoundVariableForPaint(paint, "color", binding.variable);
    } catch {
      tokens?.failed();
      return paint;
    }
  }

  function paintStyleId(colorKey?: string): string | undefined {
    const binding = tokens?.color(colorKey);
    return binding && "paintStyleId" in binding ? binding.paintStyleId : undefined;
  }

  function paints(list: PlanPaint[]): Paint[] {
    const out: Paint[] = [];
    for (const p of list) {
      if (p.type === "SOLID") {
        out.push(solidPaint(p.color, p.opacity, p.colorKey));
      } else if (p.type === "IMAGE") {
        const imageHash = images.get(p.hash);
        if (!imageHash) {
          missingImages++;
          continue;
        }
        out.push({ type: "IMAGE", imageHash, scaleMode: p.fit === "CROP" ? "FILL" : p.fit });
      } else {
        out.push({
          type: p.type,
          gradientTransform: p.transform,
          gradientStops: p.stops.map((s) => ({ position: s.position, color: s.color })),
        });
      }
    }
    return out;
  }

  function effects(list: PlanEffect[]): Effect[] {
    return list.map((e) => ({
      type: e.type,
      color: e.color,
      offset: e.offset,
      radius: e.radius,
      spread: e.spread,
      visible: true,
      blendMode: "NORMAL",
    }));
  }

  /** Adds a node to its parent, into its cell if it has one. A grid has no other way to place it. */
  function join(parent: FrameNode, node: Built, op: PlanOp) {
    const cell = op.childLayout?.cell;
    if (cell && parent.layoutMode === "GRID") parent.appendChildAt(node, cell.row, cell.column);
    else parent.appendChild(node);
  }

  /** Creates a frame under `parent`, or as the import root when `parent` is null. */
  function createFrame(parent: FrameNode | null, op: PlanOp, name: string): FrameNode {
    const node = api.createFrame();
    pending = node;
    if (parent) join(parent, node, op);
    else if (page && node.parent !== page) page.appendChild(node);
    node.name = name;
    return node;
  }

  function newFrame(parent: FrameNode, op: PlanOp, name: string): FrameNode {
    const node = createFrame(parent, op, name);
    node.resize(clampSize(op.w), clampSize(op.h));
    return node;
  }

  const inLayout = (parent: FrameNode | null): parent is FrameNode =>
    parent !== null && parent.layoutMode !== "NONE";

  /** Where the parent does not place the child, puts it at `x`, `y`. Needs the child in the parent. */
  function place(node: Built, parent: FrameNode | null, op: PlanOp, x = op.x, y = op.y) {
    const child = inLayout(parent) ? op.childLayout : undefined;
    if (child?.positioning === "AUTO") return;
    if (child) node.layoutPositioning = "ABSOLUTE";
    node.x = x;
    node.y = y;
  }

  function setTracks(tracks: GridTrackSize[], plan: PlanTrack[]) {
    for (const [i, track] of tracks.entries()) {
      const planned = plan[i] as PlanTrack;
      track.type = planned.type;
      if (planned.type !== "HUG") track.value = planned.value;
    }
  }

  /**
   * Turns on the op's layout and gives the frame its size, which a frame in auto layout must get
   * after its mode. Both axes start FIXED, as SPACE_* alignment and FLEX tracks need, so HUG comes
   * last. Refused settings leave the frame absolute: losing it would lose its subtree.
   */
  function setLayout(node: FrameNode, op: FrameOp) {
    const { layout } = op;
    const size = () => node.resize(clampSize(op.w), clampSize(op.h));
    if (layout.mode === "NONE") {
      size();
      return;
    }
    try {
      node.layoutMode = layout.mode;
      if (layout.mode === "GRID") {
        node.layoutSizingHorizontal = "FIXED";
        node.layoutSizingVertical = "FIXED";
      } else {
        node.primaryAxisSizingMode = "FIXED";
        node.counterAxisSizingMode = "FIXED";
      }
      size();
      [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft] = layout.padding;
      if (layout.mode === "GRID") {
        node.gridRowCount = layout.rows.length;
        node.gridColumnCount = layout.columns.length;
        setTracks(node.gridRowSizes, layout.rows);
        setTracks(node.gridColumnSizes, layout.columns);
        node.gridRowGap = layout.rowGap;
        node.gridColumnGap = layout.columnGap;
        return;
      }
      node.primaryAxisAlignItems = layout.primaryAlign;
      node.counterAxisAlignItems = layout.counterAlign;
      node.itemSpacing = layout.itemSpacing;
      if (layout.wrap) {
        node.layoutWrap = "WRAP";
        node.counterAxisSpacing = layout.counterSpacing;
      }
      if (layout.sizingH === "HUG") node.layoutSizingHorizontal = "HUG";
      if (layout.sizingV === "HUG") node.layoutSizingVertical = "HUG";
    } catch {
      node.layoutMode = "NONE";
      size();
      tracker.countFallback("apply");
    }
  }

  function parentOf(op: PlanOp): FrameNode {
    const p = nodes.get(op.parent as string);
    if (!p || failed.has(op.parent as string) || !("appendChild" in p)) {
      throw new Error("parent unavailable");
    }
    return p as FrameNode;
  }

  function usableFont(f: FontRef): FontRef {
    if (loadedFonts.has(fontKey(f))) return f;
    if (!fallbackOk) throw new Error(`font ${f.family} ${f.style} unavailable`);
    return FALLBACK;
  }

  /** Only http(s) pages are linked, whatever the plan says. */
  function isWebLink(href: string): boolean {
    return /^https?:\/\//i.test(href);
  }

  /** Whether the range took the style. If not, the run sets its own fields. */
  async function linkTextStyle(node: TextNode, styleId: string, start: number, end: number) {
    const set = tokens;
    try {
      await node.setRangeTextStyleIdAsync(start, end, styleId);
      return true;
    } catch {
      set?.failed();
      return false;
    }
  }

  /** A text style holds no colour, so this applies to every run. */
  async function paintRun(node: TextNode, run: PlanRun, start: number, end: number) {
    node.setRangeFills(start, end, [solidPaint(run.color, run.opacity, run.colorKey)]);
    const styleId = paintStyleId(run.colorKey);
    if (!styleId) return;
    const set = tokens;
    try {
      await node.setRangeFillStyleIdAsync(start, end, styleId);
    } catch {
      set?.failed();
    }
  }

  /** The style goes first, as linking one overrides the range's own type fields. */
  async function runProps(node: TextNode, run: PlanRun, start: number, end: number) {
    const styleId = tokens?.textStyleId(run.styleKey);
    const styled = styleId !== undefined && (await linkTextStyle(node, styleId, start, end));
    if (!styled) {
      node.setRangeFontName(start, end, usableFont(run.fontName));
      node.setRangeFontSize(start, end, run.fontSize);
      node.setRangeLineHeight(
        start,
        end,
        run.lineHeight === null ? { unit: "AUTO" } : { unit: "PIXELS", value: run.lineHeight }
      );
      node.setRangeLetterSpacing(start, end, { unit: "PIXELS", value: run.letterSpacing });
      node.setRangeTextDecoration(start, end, run.decoration);
      node.setRangeTextCase(start, end, run.textCase);
    }
    await paintRun(node, run, start, end);
    if (run.href !== undefined && isWebLink(run.href)) {
      try {
        node.setRangeHyperlink(start, end, { type: "URL", value: run.href });
      } catch {
        // Figma rejected the URL: the run stays, without its link.
        return;
      }
      // Figma restyles linked text (blue, underlined), so put the page's colour and decoration back.
      await paintRun(node, run, start, end);
      // On a styled run, only a real difference is worth an override of the style.
      if (!styled || node.getRangeTextDecoration(start, end) !== run.decoration) {
        node.setRangeTextDecoration(start, end, run.decoration);
      }
    }
  }

  const validWeight = (n: number) => Number.isFinite(n) && n >= 0;

  function setRadius(node: FrameNode | RectangleNode, radius: Corners) {
    node.topLeftRadius = radius[0];
    node.topRightRadius = radius[1];
    node.bottomRightRadius = radius[2];
    node.bottomLeftRadius = radius[3];
  }

  function setStroke(node: FrameNode | RectangleNode, s: PlanStroke | null) {
    if (!s || !Object.values(s.weights).every(validWeight)) return;
    node.strokes = [solidPaint(s.color, s.opacity, s.colorKey)];
    const styleId = paintStyleId(s.colorKey);
    if (styleId) styleLinks.push(() => node.setStrokeStyleIdAsync(styleId));
    node.strokeAlign = "INSIDE";
    node.strokeTopWeight = s.weights.top;
    node.strokeRightWeight = s.weights.right;
    node.strokeBottomWeight = s.weights.bottom;
    node.strokeLeftWeight = s.weights.left;
  }

  function fillParent(node: FrameNode, parent: FrameNode | null, op: PlanOp) {
    if (!inLayout(parent)) return;
    if (op.childLayout?.sizingH === "FILL") node.layoutSizingHorizontal = "FILL";
    if (op.childLayout?.sizingV === "FILL") node.layoutSizingVertical = "FILL";
  }

  function buildFrame(op: FrameOp, parent: FrameNode | null) {
    const name = parent ? op.name : rootName || op.name;
    const node = createFrame(parent, op, name);
    setLayout(node, op);
    node.clipsContent = op.clips;
    node.fills = paints(op.fills);
    // A fill style replaces the whole list, so it needs the solid to be the only fill.
    const [only] = op.fills;
    const fillStyle =
      op.fills.length === 1 && only?.type === "SOLID" ? paintStyleId(only.colorKey) : undefined;
    if (fillStyle) styleLinks.push(() => node.setFillStyleIdAsync(fillStyle));
    setRadius(node, op.radius);
    setStroke(node, op.strokes);
    node.effects = effects(op.effects);
    node.opacity = op.opacity;
    // The import root is placed by the applier, not at its captured offset.
    if (parent) place(node, parent, op);
    else place(node, null, op, rootX, 0);
    fillParent(node, parent, op);
    return node;
  }

  async function buildText(op: TextOp, parent: FrameNode): Promise<TextNode> {
    const font = usableFont(op.runs[0]?.fontName ?? FALLBACK);
    const node = api.createText();
    pending = node;
    join(parent, node, op);
    node.name = op.name;
    await setText(node, op, font);
    node.textAlignHorizontal = op.align;
    // Figma's Inter runs slightly wider than the browser's, so a box sized to the
    // captured width can wrap differently. Single-line text never wraps; wrapped
    // text is widened until it is back to the captured line count.
    node.textAutoResize = "WIDTH_AND_HEIGHT";
    if (!op.wrap) {
      place(node, parent, op, alignedX(op.align, op.x, op.w, node.width));
      return node;
    }
    // The tallest line sets the line height: the largest pixel value across runs,
    // or the measured one-line height when a run uses AUTO.
    const oneLine = node.height;
    const pixels = op.runs.flatMap((r) => (r.lineHeight === null ? [] : [r.lineHeight]));
    const lineHeight = Math.max(
      ...pixels,
      pixels.length < op.runs.length || pixels.length === 0 ? oneLine : 0
    );
    // Half a line of slack, so the check counts lines and ignores rounding.
    const fit: TextFit = { w: op.w, limit: (Math.max(op.lineCount, 1) + 0.5) * lineHeight };
    // Text that fitted a clipping parent stays inside it: an extra line is better than cut words.
    if (parent.clipsContent && op.x + op.w <= parent.width) fit.max = parent.width - op.x;
    node.textAutoResize = "HEIGHT";
    if (inLayout(parent) && op.childLayout?.sizingH === "FILL") {
      node.layoutSizingHorizontal = "FILL";
      fillFit = fit;
      place(node, parent, op);
      return node;
    }
    if (!widenToLines(node, fit)) tracker.noteRewrapped();
    place(node, parent, op, alignedX(op.align, op.x, op.w, node.width));
    return node;
  }

  /** Sets the characters and every run, which can take several trips to Figma. */
  async function setText(node: TextNode, op: TextOp, font: FontRef) {
    const run = generation;
    node.fontName = font;
    node.characters = op.text;
    for (const planned of op.runs) {
      const start = Math.max(planned.start, 0);
      const end = Math.min(planned.end, op.text.length);
      if (start >= end) continue;
      await runProps(node, planned, start, end);
      if (run !== generation) throw new Error("import ended");
    }
  }

  function build(op: PlanOp): Built | Promise<Built> {
    if (op.op === "frame" && op.parent === null) {
      if (rootAttempted) throw new Error("more than one root op");
      rootAttempted = true;
      const node = buildFrame(op, null);
      root = node;
      return node;
    }
    const parent = parentOf(op);
    switch (op.op) {
      case "frame":
        return buildFrame(op, parent);
      case "text":
        return buildText(op, parent);
      case "image": {
        const imageHash = images.get(op.hash);
        if (!imageHash) {
          missingImages++;
          const node = newFrame(parent, op, `Image (missing): ${op.name}`);
          node.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.08 }];
          setRadius(node, op.radius);
          node.opacity = op.opacity;
          place(node, parent, op);
          return node;
        }
        const node = api.createRectangle();
        pending = node;
        join(parent, node, op);
        node.name = op.name;
        node.resize(clampSize(op.w), clampSize(op.h));
        node.fills = [{ type: "IMAGE", imageHash, scaleMode: op.fit === "CROP" ? "FILL" : op.fit }];
        setRadius(node, op.radius);
        setStroke(node, op.strokes);
        node.opacity = op.opacity;
        place(node, parent, op);
        return node;
      }
      case "svg": {
        let imported: FrameNode | null = null;
        // Markup from a `.frottage` file is untrusted: Figma may reject it, and an oversized one is
        // not worth the parse. Either way the import goes on with a marker where the vector was.
        if (utf8Bytes(op.markup) <= MAX_SVG_BYTES) {
          try {
            imported = api.createNodeFromSvg(op.markup);
          } catch {
            imported = null;
          }
        }
        if (!imported) {
          const node = newFrame(parent, op, `SVG (not imported): ${op.name}`);
          node.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.08 }];
          node.opacity = op.opacity;
          place(node, parent, op);
          return node;
        }
        pending = imported;
        join(parent, imported, op);
        imported.name = op.name;
        // Resizing moves a frame's children only when they scale with it, so a CSS-scaled SVG
        // (rendered size different from its own) needs SCALE constraints first.
        if (Math.abs(imported.width - op.w) > 0.5 || Math.abs(imported.height - op.h) > 0.5) {
          for (const child of imported.children) {
            if ("constraints" in child) {
              child.constraints = { horizontal: "SCALE", vertical: "SCALE" };
            }
          }
        }
        // Browsers clip inline SVG unless its overflow is visible.
        imported.clipsContent = op.clips !== false;
        imported.resize(clampSize(op.w), clampSize(op.h));
        imported.opacity = op.opacity;
        place(imported, parent, op);
        return imported;
      }
      case "placeholder": {
        const node = newFrame(parent, op, op.label);
        node.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.08 }];
        node.opacity = op.opacity;
        place(node, parent, op);
        return node;
      }
    }
  }

  async function applyOp(op: PlanOp): Promise<void> {
    const run = generation;
    pending = null;
    fillFit = null;
    try {
      const node = await build(op);
      nodes.set(op.id, node);
      tracker.track(op, node, fillFit);
    } catch {
      // A cancel landed in the build: what follows belongs to the import after it.
      if (run !== generation) return;
      styleLinks = [];
      failed.add(op.id);
      failedOps++;
      const partial = pending as SceneNode | null;
      if (partial && root === partial) root = null;
      try {
        partial?.remove();
      } catch {
        // best effort
      }
      tracker.failed(op);
    }
    pending = null;
    const links = styleLinks;
    styleLinks = [];
    const set = tokens;
    for (const link of links) {
      try {
        await link();
      } catch {
        set?.failed();
      }
    }
  }

  const overBudget = () => Date.now() - sliceStart > MAX_SLICE_MS;

  /** Yields to Figma. False if the import ended meanwhile. */
  async function breathe(run: number): Promise<boolean> {
    await tick();
    sliceStart = Date.now();
    return run === generation;
  }

  async function applyBatch(ops: PlanOp[]): Promise<void> {
    if (!active) throw new Error("import not started");
    const run = generation;
    sliceStart = Date.now();
    for (const op of ops) {
      if (overBudget() && !(await breathe(run))) return;
      await applyOp(op);
      if (run !== generation) return;
    }
    if (await tracker.drain(overBudget, () => breathe(run))) await tick();
  }

  const tokenCounts = () => tokens?.counts() ?? NO_TOKENS;

  async function end(): Promise<EndResult> {
    if (!active) throw new Error("import not started");
    const run = generation;
    try {
      const done = root;
      if (!done) {
        // The root op failed (already counted) or never arrived (count it now).
        if (!rootAttempted) failedOps++;
        api.commitUndo();
        return { rootId: "", failedOps, missingImages, ...tracker.counts(), ...tokenCounts() };
      }
      tracker.closeOpen();
      sliceStart = Date.now();
      if (!(await tracker.drain(overBudget, () => breathe(run)))) return CANCELLED;
      api.commitUndo();
      try {
        (page ?? api.currentPage).selection = [done];
        api.viewport.scrollAndZoomIntoView([done]);
      } catch {
        // the user may have switched pages; the import itself is done
      }
      const result = {
        rootId: done.id,
        failedOps,
        missingImages,
        ...tracker.counts(),
        ...tokenCounts(),
      };
      root = null; // keep the layers; reset() would remove them
      tokens = null; // and the tokens they use
      return result;
    } finally {
      if (run === generation) reset();
    }
  }

  /** Abandon the import: remove the partial root and restore the undo point. */
  async function cancel(): Promise<void> {
    if (!active) return;
    const hadTokens = tokens !== null;
    reset();
    api.commitUndo();
    if (!hadTokens) return;
    await cleaning;
    api.commitUndo();
  }

  return { begin, importTokens, addImage, applyBatch, end, cancel, isActive: () => active };
}
