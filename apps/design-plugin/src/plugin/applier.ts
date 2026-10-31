import type {
  FontRef,
  PlanEffect,
  PlanOp,
  PlanPaint,
  PlanRun,
  PlanStroke,
} from "@repo/figma-mapper";

/**
 * Turns plan ops into Figma layers. Runs in the plugin sandbox. Only types come
 * from @repo/figma-mapper, so plugin.js never bundles Zod or fflate.
 */

export type ImportMeta = { name: string; fonts: FontRef[]; totalOps: number };
export type EndResult = { rootId: string; failedOps: number; missingImages: number };

type Corners = [number, number, number, number];

const FALLBACK: FontRef = { family: "Inter", style: "Regular" };
const GAP = 100;
const MIN_SIZE = 0.01;

const fontKey = (f: FontRef) => `${f.family}\u0000${f.style}`;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const clampSize = (n: number) => Math.max(n, MIN_SIZE);
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

  function reset() {
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

  /** Creates a frame under `parent`, or as the import root when `parent` is null. */
  function newFrame(parent: FrameNode | null, name: string, w: number, h: number): FrameNode {
    const node = api.createFrame();
    pending = node;
    if (parent) parent.appendChild(node);
    else if (page && node.parent !== page) page.appendChild(node);
    node.name = name;
    node.resize(clampSize(w), clampSize(h));
    return node;
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

  function buildFrame(op: Extract<PlanOp, { op: "frame" }>, parent: FrameNode | null) {
    const name = parent ? op.name : rootName || op.name;
    const node = newFrame(parent, name, op.w, op.h);
    node.clipsContent = op.clips;
    node.fills = paints(op.fills);
    setRadius(node, op.radius);
    setStroke(node, op.strokes);
    node.effects = effects(op.effects);
    node.opacity = op.opacity;
    // The import root is placed by the applier, not at its captured offset.
    node.x = parent ? op.x : rootX;
    node.y = parent ? op.y : 0;
    return node;
  }

  function build(op: PlanOp): SceneNode {
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
        parent.appendChild(node);
        node.name = op.name;
        node.fontName = font;
        node.characters = op.text;
        for (const run of op.runs) {
          const start = Math.max(run.start, 0);
          const end = Math.min(run.end, op.text.length);
          if (start < end) runProps(node, run, start, end);
        }
        node.textAlignHorizontal = op.align;
        if (op.wrap) {
          node.textAutoResize = "HEIGHT";
          node.resize(clampSize(op.w), clampSize(op.h));
        } else {
          node.textAutoResize = "WIDTH_AND_HEIGHT";
          // Single-line text that is centred or right-aligned inside its captured
          // box needs that box width, or x would be off by the width difference.
          if (op.align !== "LEFT" && Math.abs(node.width - op.w) > 0.5) {
            node.textAutoResize = "HEIGHT";
            node.resize(clampSize(op.w), clampSize(node.height));
          }
        }
        node.x = op.x;
        node.y = op.y;
        return node;
      }
      case "image": {
        const imageHash = images.get(op.hash);
        if (!imageHash) {
          missingImages++;
          const node = newFrame(parent, `Image (missing): ${op.name}`, op.w, op.h);
          node.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.08 }];
          setRadius(node, op.radius);
          node.opacity = op.opacity;
          node.x = op.x;
          node.y = op.y;
          return node;
        }
        const node = api.createRectangle();
        pending = node;
        parent.appendChild(node);
        node.name = op.name;
        node.resize(clampSize(op.w), clampSize(op.h));
        node.fills = [{ type: "IMAGE", imageHash, scaleMode: op.fit === "CROP" ? "FILL" : op.fit }];
        setRadius(node, op.radius);
        setStroke(node, op.strokes);
        node.opacity = op.opacity;
        node.x = op.x;
        node.y = op.y;
        return node;
      }
      case "placeholder": {
        const node = newFrame(parent, op.label, op.w, op.h);
        node.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.08 }];
        node.opacity = op.opacity;
        node.x = op.x;
        node.y = op.y;
        return node;
      }
    }
  }

  function applyOp(op: PlanOp) {
    pending = null;
    try {
      nodes.set(op.id, build(op));
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
    }
    pending = null;
  }

  async function applyBatch(ops: PlanOp[]): Promise<void> {
    if (!active) throw new Error("import not started");
    for (const op of ops) applyOp(op);
    await tick();
  }

  async function end(): Promise<EndResult> {
    if (!active) throw new Error("import not started");
    try {
      const done = root;
      if (!done) {
        // The root op failed (already counted) or never arrived (count it now).
        if (!rootAttempted) failedOps++;
        api.commitUndo();
        return { rootId: "", failedOps, missingImages };
      }
      api.commitUndo();
      try {
        (page ?? api.currentPage).selection = [done];
        api.viewport.scrollAndZoomIntoView([done]);
      } catch {
        // the user may have switched pages; the import itself is done
      }
      const result = { rootId: done.id, failedOps, missingImages };
      root = null; // keep the layers; reset() would remove them
      return result;
    } finally {
      reset();
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
