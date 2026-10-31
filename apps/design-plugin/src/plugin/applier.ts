import type {
  FontRef,
  PlanChildLayout,
  PlanEffect,
  PlanOp,
  PlanPaint,
  PlanRun,
  PlanStroke,
  PlanTrack,
} from "@repo/figma-mapper";
import { type ExpectedChild, type ExpectedLayout, verifyFrame } from "./verify-layout";

/**
 * Turns plan ops into Figma layers. Runs in the plugin sandbox. Only types come
 * from @repo/figma-mapper, so plugin.js never bundles Zod or fflate.
 */

export type ImportMeta = { name: string; fonts: FontRef[]; totalOps: number };
export type EndResult = {
  rootId: string;
  failedOps: number;
  missingImages: number;
  rewrappedTexts: number;
  /** Frames that were proposed auto layout and kept it. */
  autoLayoutFrames: number;
  /** Frames that were proposed auto layout and went back to absolute. */
  fallbackFrames: number;
  fallbackReasons: Record<string, number>;
};

type Corners = [number, number, number, number];
type FrameOp = Extract<PlanOp, { op: "frame" }>;
type Sizing = PlanChildLayout["sizingH"];
/** The kinds of node an op makes. */
type Built = FrameNode | TextNode | RectangleNode;

/** What a fallback needs beyond what verification reads. */
type Child = ExpectedChild & { node: Built; align: string };

/** A frame in auto layout, from its creation until it has been verified. */
type LaidFrame = {
  id: string;
  frame: FrameNode;
  op: FrameOp;
  sizingH: Sizing;
  sizingV: Sizing;
  /** Its entry among its parent's children. */
  child: Child | null;
  /** Null when the parent is not in auto layout: nothing about this frame affects it then. */
  parent: LaidFrame | null;
  children: Child[];
  containsText: boolean;
  /** Direct children still to arrive, or whose own content is still to arrive. */
  waiting: number;
  /** Finished FILL children, whose size this frame's other children still decide. */
  deferred: LaidFrame[];
};

const FALLBACK: FontRef = { family: "Inter", style: "Regular" };
const GAP = 100;
const MIN_SIZE = 0.01;
const MAX_WIDEN_STEPS = 8;
/** The largest SVG source handed to Figma. Capture applies the same limit; a file can still hold more. */
const MAX_SVG_BYTES = 256 * 1024;
/**
 * Verification shares a batch's time. Reads are quick, but a fallback writes, so both limits apply;
 * the time is half of the 2 s a batch may take, as the ops ahead of it have used some already.
 */
const MAX_VERIFIES_PER_SLICE = 200;
const MAX_SLICE_MS = 1000;

/** x for a text box of `actual` width that must stay anchored inside the captured `w`. */
function alignedX(align: string, x: number, w: number, actual: number): number {
  if (align === "CENTER") return x + (w - actual) / 2;
  if (align === "RIGHT") return x + w - actual;
  return x;
}

/** What `end` returns when the import was cancelled under it. */
const CANCELLED: EndResult = {
  rootId: "",
  failedOps: 0,
  missingImages: 0,
  rewrappedTexts: 0,
  autoLayoutFrames: 0,
  fallbackFrames: 0,
  fallbackReasons: {},
};

const fontKey = (f: FontRef) => `${f.family}\u0000${f.style}`;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const clampSize = (n: number) => Math.max(n, MIN_SIZE);
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
  let rewrappedTexts = 0;
  let autoLayoutFrames = 0;
  let fallbackFrames = 0;
  let fallbackReasons: Record<string, number> = {};
  /** Frames with children to come, in creation order, so parents come before their children. */
  let open = new Map<string, LaidFrame>();
  /** Finished frames to verify, children before parents. */
  let ready: LaidFrame[] = [];
  let sliceStart = 0;
  /** Changes when an import ends, so that work suspended in a yield can tell. */
  let generation = 0;

  function reset() {
    generation++;
    if (root) {
      try {
        root.remove();
      } catch {
        // already gone
      }
    }
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
    rewrappedTexts = 0;
    autoLayoutFrames = 0;
    fallbackFrames = 0;
    fallbackReasons = {};
    open = new Map();
    ready = [];
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

  function paints(list: PlanPaint[]): Paint[] {
    const out: Paint[] = [];
    for (const p of list) {
      if (p.type === "SOLID") {
        out.push({ type: "SOLID", color: p.color, opacity: p.opacity });
      } else {
        const imageHash = images.get(p.hash);
        if (!imageHash) {
          missingImages++;
          continue;
        }
        out.push({ type: "IMAGE", imageHash, scaleMode: p.fit === "CROP" ? "FILL" : p.fit });
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
   * after its mode. `resize` makes both axes FIXED, as SPACE_* alignment and FLEX tracks need, so
   * HUG comes last. Refused settings leave the frame absolute: losing it would lose its subtree.
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
      countFallback("apply");
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

  function runProps(node: TextNode, run: PlanRun, start: number, end: number) {
    node.setRangeFontName(start, end, usableFont(run.fontName));
    node.setRangeFontSize(start, end, run.fontSize);
    node.setRangeFills(start, end, [{ type: "SOLID", color: run.color, opacity: run.opacity }]);
    node.setRangeLineHeight(
      start,
      end,
      run.lineHeight === null ? { unit: "AUTO" } : { unit: "PIXELS", value: run.lineHeight }
    );
    node.setRangeLetterSpacing(start, end, { unit: "PIXELS", value: run.letterSpacing });
    node.setRangeTextDecoration(start, end, run.decoration);
    node.setRangeTextCase(start, end, run.textCase);
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
    node.strokes = [{ type: "SOLID", color: s.color, opacity: s.opacity }];
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

  function build(op: PlanOp): Built {
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
      case "text": {
        const font = usableFont(op.runs[0]?.fontName ?? FALLBACK);
        const node = api.createText();
        pending = node;
        join(parent, node, op);
        node.name = op.name;
        node.fontName = font;
        node.characters = op.text;
        for (const run of op.runs) {
          const start = Math.max(run.start, 0);
          const end = Math.min(run.end, op.text.length);
          if (start < end) runProps(node, run, start, end);
        }
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
        const expected = Math.max(op.lineCount, 1) * lineHeight;
        // Half a line of slack, so the check counts lines and ignores rounding.
        const slack = lineHeight / 2;
        node.textAutoResize = "HEIGHT";
        // Filling costs the text its widening, so it only fills if that keeps the lines.
        if (inLayout(parent) && op.childLayout?.sizingH === "FILL") {
          node.layoutSizingHorizontal = "FILL";
          if (node.height <= expected + slack) {
            place(node, parent, op);
            return node;
          }
          node.layoutSizingHorizontal = "FIXED";
        }
        // Keep the current height: a different one switches HEIGHT mode to NONE.
        node.resize(clampSize(op.w), clampSize(node.height));
        let added = 0;
        for (let step = 1; node.height > expected + slack && step <= MAX_WIDEN_STEPS; step++) {
          added = (op.w * step) / 100;
          node.resize(clampSize(op.w + added), clampSize(node.height));
        }
        if (node.height > expected + slack) rewrappedTexts++;
        place(node, parent, op, alignedX(op.align, op.x, op.w, op.w + added));
        return node;
      }
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

  function countFallback(reason: string) {
    fallbackFrames++;
    fallbackReasons[reason] = (fallbackReasons[reason] ?? 0) + 1;
  }

  /**
   * A frame is finished when its children and all that is below them are. Walks up rather than
   * recursing, as one op can finish a deep chain. A FILL frame is verified along with its parent:
   * until the parent has all its children, the frame's size is not its final one.
   */
  function finish(first: LaidFrame) {
    let current: LaidFrame | undefined = first;
    while (current) {
      const { id, parent, deferred, sizingH, sizingV }: LaidFrame = current;
      open.delete(id);
      const waitsForParent =
        parent && open.has(parent.id) && (sizingH === "FILL" || sizingV === "FILL");
      const target = waitsForParent ? parent.deferred : ready;
      for (const frame of deferred) target.push(frame);
      target.push(current);
      passTextUp(current);
      current = parent && arrived(parent) ? parent : undefined;
    }
  }

  function passTextUp({ containsText, child, parent }: LaidFrame) {
    if (child) child.containsText = containsText;
    if (parent && containsText) parent.containsText = true;
  }

  /** Counts one child in. True when that was the last one. */
  function arrived(frame: LaidFrame): boolean {
    frame.waiting--;
    return frame.waiting <= 0 && open.has(frame.id);
  }

  /** Records what the op made, so that its parent and the node itself can be verified. */
  function track(op: PlanOp, node: Built, parent: LaidFrame | undefined) {
    const auto = op.op === "frame" && (node as FrameNode).layoutMode !== "NONE";
    const own = auto && op.layout.mode !== "NONE" && op.layout.mode !== "GRID" ? op.layout : null;
    const sizing = (axis: "sizingH" | "sizingV"): Sizing =>
      op.childLayout?.[axis] === "FILL" ? "FILL" : (own?.[axis] ?? "FIXED");
    const sizingH = sizing("sizingH");
    const sizingV = sizing("sizingV");
    let child: Child | null = null;
    if (parent) {
      child = {
        node,
        x: op.x,
        y: op.y,
        w: op.w,
        h: op.h,
        absolute: op.childLayout?.positioning === "ABSOLUTE",
        text: op.op === "text",
        containsText: false,
        sizingH,
        sizingV,
        align: op.op === "text" ? op.align : "LEFT",
      };
      parent.children.push(child);
      if (op.op === "text") parent.containsText = true;
    }
    if (op.op === "frame" && auto) {
      const frame: LaidFrame = {
        id: op.id,
        frame: node as FrameNode,
        op,
        sizingH,
        sizingV,
        child,
        parent: parent ?? null,
        children: [],
        containsText: false,
        waiting: op.childCount,
        deferred: [],
      };
      open.set(op.id, frame);
      if (op.childCount <= 0) finish(frame);
    } else if (parent && arrived(parent)) {
      finish(parent);
    }
  }

  /**
   * Puts the frame back to absolute, leaving its children's own layout alone. Text keeps its
   * measured size, and a child that hugged goes on hugging; only a FILL axis has lost its source.
   */
  function fallBack({ frame, op, parent, child, sizingH, sizingV, children }: LaidFrame) {
    frame.layoutMode = "NONE";
    frame.resize(clampSize(op.w), clampSize(op.h));
    if (parent && parent.frame.layoutMode !== "NONE") {
      if (sizingH === "FILL") frame.layoutSizingHorizontal = "FILL";
      if (sizingV === "FILL") frame.layoutSizingVertical = "FILL";
    }
    for (const c of children) {
      const { node } = c;
      if (!c.text && (c.sizingH === "FILL" || c.sizingV === "FILL")) {
        const sized = node as FrameNode;
        sized.resize(
          clampSize(c.sizingH === "FILL" ? c.w : node.width),
          clampSize(c.sizingV === "FILL" ? c.h : node.height)
        );
        if (c.sizingH === "HUG") sized.layoutSizingHorizontal = "HUG";
        if (c.sizingV === "HUG") sized.layoutSizingVertical = "HUG";
      }
      node.x = alignedX(c.align, c.x, c.w, node.width);
      node.y = c.y;
    }
    if (child) {
      child.sizingH = sizingH === "FILL" ? "FILL" : "FIXED";
      child.sizingV = sizingV === "FILL" ? "FILL" : "FIXED";
    }
  }

  function expectation({ op, sizingH, sizingV, children }: LaidFrame): ExpectedLayout {
    return {
      layout: op.layout as ExpectedLayout["layout"],
      w: op.w,
      h: op.h,
      sizingH,
      sizingV,
      children,
    };
  }

  function verify(frame: LaidFrame) {
    try {
      const verdict = verifyFrame(frame.frame, expectation(frame));
      if (verdict.ok) {
        autoLayoutFrames++;
        return;
      }
      countFallback(verdict.reason ?? "unknown");
      fallBack(frame);
    } catch {
      // The layer may have gone: the user can edit during an import, which must still finish.
    }
  }

  /** Verifies what is ready, yielding as needed. False if the import ended during a yield. */
  async function drain(run: number): Promise<boolean> {
    let verified = 0;
    for (let i = 0; i < ready.length; i++) {
      if (verified >= MAX_VERIFIES_PER_SLICE || Date.now() - sliceStart > MAX_SLICE_MS) {
        await tick();
        if (run !== generation) return false;
        sliceStart = Date.now();
        verified = 0;
      }
      verify(ready[i] as LaidFrame);
      verified++;
    }
    ready = [];
    return true;
  }

  function applyOp(op: PlanOp) {
    pending = null;
    const parent = op.parent === null ? undefined : open.get(op.parent);
    try {
      const node = build(op);
      nodes.set(op.id, node);
      track(op, node, parent);
    } catch {
      failed.add(op.id);
      failedOps++;
      const partial = pending as SceneNode | null;
      if (partial && root === partial) root = null;
      try {
        partial?.remove();
      } catch {
        // best effort
      }
      // A failed child is one less to wait for; verification judges the frame without it.
      if (parent && arrived(parent)) finish(parent);
    }
    pending = null;
  }

  async function applyBatch(ops: PlanOp[]): Promise<void> {
    if (!active) throw new Error("import not started");
    const run = generation;
    sliceStart = Date.now();
    for (const op of ops) applyOp(op);
    if (await drain(run)) await tick();
  }

  /** Frames still open never got all their ops. Latest first: children come after their parents. */
  function closeOpen() {
    for (const frame of [...open.values()].reverse()) {
      for (const deferred of frame.deferred) ready.push(deferred);
      ready.push(frame);
      passTextUp(frame);
    }
    open = new Map();
  }

  const results = () => ({
    failedOps,
    missingImages,
    rewrappedTexts,
    autoLayoutFrames,
    fallbackFrames,
    fallbackReasons,
  });

  async function end(): Promise<EndResult> {
    if (!active) throw new Error("import not started");
    const run = generation;
    try {
      const done = root;
      if (!done) {
        // The root op failed (already counted) or never arrived (count it now).
        if (!rootAttempted) failedOps++;
        api.commitUndo();
        return { rootId: "", ...results() };
      }
      closeOpen();
      sliceStart = Date.now();
      if (!(await drain(run))) return CANCELLED;
      api.commitUndo();
      try {
        (page ?? api.currentPage).selection = [done];
        api.viewport.scrollAndZoomIntoView([done]);
      } catch {
        // the user may have switched pages; the import itself is done
      }
      const result = { rootId: done.id, ...results() };
      root = null; // keep the layers; reset() would remove them
      return result;
    } finally {
      if (run === generation) reset();
    }
  }

  /** Abandon the import: remove the partial root and restore the undo point. */
  function cancel(): void {
    if (!active) return;
    reset();
    api.commitUndo();
  }

  return { begin, addImage, applyBatch, end, cancel, isActive: () => active };
}
