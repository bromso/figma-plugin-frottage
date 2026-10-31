import type { FontRef, PlanEffect, PlanOp, PlanPaint, PlanRun } from "@repo/figma-mapper";

/**
 * Turns plan ops into Figma layers. Runs in the plugin sandbox. Only types come
 * from @repo/figma-mapper, so plugin.js never bundles Zod or fflate.
 */

export type ImportMeta = { name: string; fonts: FontRef[]; totalOps: number };
export type EndResult = { rootId: string; failedOps: number; missingImages: number };

const FALLBACK: FontRef = { family: "Inter", style: "Regular" };
const GAP = 100;
const MIN_SIZE = 0.01;

const fontKey = (f: FontRef) => `${f.family}\u0000${f.style}`;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const clampSize = (n: number) => Math.max(n, MIN_SIZE);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createApplier(api: PluginAPI) {
  let root: FrameNode | null = null;
  let nodes = new Map<string, SceneNode>();
  let failed = new Set<string>();
  let images = new Map<string, string>();
  let failedFonts = new Set<string>();
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
    nodes = new Map();
    failed = new Set();
    images = new Map();
    failedFonts = new Set();
    fallbackOk = true;
    failedOps = 0;
    missingImages = 0;
  }

  async function loadFont(f: FontRef): Promise<boolean> {
    try {
      await api.loadFontAsync(f);
      return true;
    } catch {
      return false;
    }
  }

  async function begin(meta: ImportMeta): Promise<void> {
    reset();
    api.commitUndo();
    const [fallback] = await Promise.all([
      loadFont(FALLBACK),
      ...meta.fonts.map(async (f) => {
        if (!(await loadFont(f))) failedFonts.add(fontKey(f));
      }),
    ]);
    fallbackOk = fallback;

    let right = 0;
    let any = false;
    for (const child of api.currentPage.children) {
      const edge = child.x + child.width;
      if (!any || edge > right) right = edge;
      any = true;
    }
    root = api.createFrame();
    root.name = meta.name;
    root.fills = [];
    root.clipsContent = false;
    root.x = any ? right + GAP : 0;
    root.y = 0;
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

  function parentOf(op: PlanOp): FrameNode {
    if (op.parent === null) {
      if (!root) throw new Error("import not started");
      return root;
    }
    const p = nodes.get(op.parent);
    if (!p || failed.has(op.parent) || !("appendChild" in p)) throw new Error("parent unavailable");
    return p as FrameNode;
  }

  function frameLike(op: PlanOp & { w: number; h: number }, parent: FrameNode, name: string) {
    const node = api.createFrame();
    parent.appendChild(node);
    node.name = name;
    node.resize(clampSize(op.w), clampSize(op.h));
    return node;
  }

  function usableFont(f: FontRef): FontRef {
    if (!failedFonts.has(fontKey(f))) return f;
    if (!fallbackOk) throw new Error(`font ${f.family} ${f.style} unavailable`);
    return FALLBACK;
  }

  function runProps(node: TextNode, run: PlanRun) {
    const { start, end } = run;
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

  function build(op: PlanOp): SceneNode {
    const parent = parentOf(op);
    switch (op.op) {
      case "frame": {
        const node = frameLike(op, parent, op.name);
        node.clipsContent = op.clips;
        node.fills = paints(op.fills);
        node.topLeftRadius = op.radius[0];
        node.topRightRadius = op.radius[1];
        node.bottomRightRadius = op.radius[2];
        node.bottomLeftRadius = op.radius[3];
        if (op.strokes) {
          const s = op.strokes;
          node.strokes = [{ type: "SOLID", color: s.color, opacity: s.opacity }];
          node.strokeAlign = "INSIDE";
          node.strokeTopWeight = s.weights.top;
          node.strokeRightWeight = s.weights.right;
          node.strokeBottomWeight = s.weights.bottom;
          node.strokeLeftWeight = s.weights.left;
        }
        node.effects = effects(op.effects);
        node.opacity = op.opacity;
        node.x = op.x;
        node.y = op.y;
        return node;
      }
      case "text": {
        const first = op.runs[0]?.fontName ?? FALLBACK;
        const font = usableFont(first);
        if (font === FALLBACK && !fallbackOk) throw new Error("fallback font unavailable");
        const node = api.createText();
        parent.appendChild(node);
        node.name = op.name;
        node.fontName = font;
        node.characters = op.text;
        for (const run of op.runs) {
          if (run.end > run.start) runProps(node, run);
        }
        node.textAlignHorizontal = op.align;
        if (op.wrap) {
          node.textAutoResize = "HEIGHT";
          node.resize(clampSize(op.w), clampSize(op.h));
        } else {
          node.textAutoResize = "WIDTH_AND_HEIGHT";
        }
        node.x = op.x;
        node.y = op.y;
        return node;
      }
      case "image": {
        const imageHash = images.get(op.hash);
        if (!imageHash) {
          missingImages++;
          const node = frameLike(op, parent, `Image (missing): ${op.name}`);
          node.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.08 }];
          node.x = op.x;
          node.y = op.y;
          return node;
        }
        const node = api.createRectangle();
        parent.appendChild(node);
        node.name = op.name;
        node.resize(clampSize(op.w), clampSize(op.h));
        node.fills = [{ type: "IMAGE", imageHash, scaleMode: op.fit === "CROP" ? "FILL" : op.fit }];
        node.x = op.x;
        node.y = op.y;
        return node;
      }
      case "placeholder": {
        const node = frameLike(op, parent, op.label);
        node.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.08 }];
        node.x = op.x;
        node.y = op.y;
        return node;
      }
    }
  }

  function applyOp(op: PlanOp) {
    try {
      nodes.set(op.id, build(op));
    } catch {
      failed.add(op.id);
      failedOps++;
      // build() may have left a half-made node as the parent's last child.
      cleanupPartial(op);
    }
  }

  function cleanupPartial(op: PlanOp) {
    try {
      const parent = op.parent === null ? root : (nodes.get(op.parent) as FrameNode | undefined);
      const last = parent?.children[parent.children.length - 1];
      if (last && ![...nodes.values()].includes(last)) last.remove();
    } catch {
      // best effort
    }
  }

  async function applyBatch(ops: PlanOp[]): Promise<void> {
    for (const op of ops) applyOp(op);
    await tick();
  }

  async function end(): Promise<EndResult> {
    if (!root) throw new Error("import not started");
    let w = 0;
    let h = 0;
    for (const child of root.children) {
      w = Math.max(w, child.x + child.width);
      h = Math.max(h, child.y + child.height);
    }
    root.resize(clampSize(w), clampSize(h));
    const done = root;
    api.commitUndo();
    api.currentPage.selection = [done];
    api.viewport.scrollAndZoomIntoView([done]);
    const result = { rootId: done.id, failedOps, missingImages };
    root = null;
    reset();
    return result;
  }

  return { begin, addImage, applyBatch, end };
}
