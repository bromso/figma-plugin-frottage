import type {
  FontRef,
  ImportOptions,
  PlanEffect,
  PlanLayout,
  PlanOp,
  PlanOverride,
  PlanPaint,
  PlanRgb,
  PlanRun,
  PlanStroke,
  PlanTokens,
  PlanTrack,
  PlanVersionTokens,
} from "@repo/figma-mapper";
import { type ComponentSet, childAt, createComponentSet } from "./components";
import {
  alignedX,
  type Built,
  clampSize,
  createLayoutTracker,
  type TextFit,
  turnAbout,
  widenToLines,
} from "./layout-tracker";
import {
  createTokenSet,
  NO_TOKENS,
  type TokenCounts,
  type TokenRuntime,
  type TokenSet,
} from "./tokens";

/**
 * Turns plan ops into Figma layers. Runs in the plugin sandbox. Only types come
 * from @repo/figma-mapper, so plugin.js never bundles Zod or fflate.
 */

export type ImportMeta = {
  name: string;
  fonts: FontRef[];
  totalOps: number;
  /** One version of a set, which gets the name and mode that go with its place in it. */
  version?: { index: number; label: string };
};
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
  componentsCreated: number;
  instancesCreated: number;
  /** Overrides that did not apply, so those layers show the component's own content. */
  overrideFailures: number;
  /** Of those, the ones in a definition, which show in every copy, so the count is a lower bound. */
  overrideFailuresInMains: number;
  /** The section could not be arranged, so its mains may sit on top of each other. */
  layoutFailures: number;
  /** Components given a Hover variant. */
  hoverVariants: number;
  /** Components whose Hover variant could not be made, which stay as they were. */
  hoverFailures: number;
  /** Frames that lost their fills or effects to a paint Figma refused; the layers stay. */
  paintFailures: number;
  /** Instances resized from a main that lost its auto layout, whose content did not move with them. */
  resizedFallbacks: number;
};

/** What a set of versions leaves. Each version's own counts come from its `end`. */
export type SetResult = TokenCounts & {
  /** The frames that stayed, in order. Empty when every version failed. */
  rootIds: string[];
  /** The sections could not be placed, so some may overlap. */
  layoutFailures: number;
};

/** A set of versions under way. Its finished frames and sections are held until `endSet`. */
type HeldSet = {
  page: PageNode;
  /** Where the next frame goes. */
  x: number;
  finished: { root: FrameNode; components: ComponentSet }[];
};

type Corners = [number, number, number, number];
type FrameOp = Extract<PlanOp, { op: "frame" }>;
type TextOp = Extract<PlanOp, { op: "text" }>;
type InstanceOp = Extract<PlanOp, { op: "instance" }>;

const FALLBACK: FontRef = { family: "Inter", style: "Regular" };
const GAP = 100;
/** Between the versions of a set, and between its row of frames and its row of sections. */
const VERSION_GAP = 200;
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
  componentsCreated: 0,
  instancesCreated: 0,
  overrideFailures: 0,
  overrideFailuresInMains: 0,
  layoutFailures: 0,
  hoverVariants: 0,
  hoverFailures: 0,
  paintFailures: 0,
  resizedFallbacks: 0,
  ...NO_TOKENS,
};

const NO_SET: SetResult = { rootIds: [], layoutFailures: 0, ...NO_TOKENS };

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
const shortestFirst = (a: PlanOverride, b: PlanOverride) => a.path.length - b.path.length;
const startsWith = (path: number[], prefix: number[]) => prefix.every((n, i) => path[i] === n);

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
  /** This import's mains, from `begin` until they are kept or taken back. */
  let components: ComponentSet | null = null;
  /** The definition whose ops are arriving, until the page root's do. */
  let definition: string | null = null;
  /** Definitions short of a child. Overrides go by index, so they would land on the wrong layer. */
  let broken = new Set<string>();
  let componentsCreated = 0;
  let instancesCreated = 0;
  let overrideFailures = 0;
  let overrideFailuresInMains = 0;
  let layoutFailures = 0;
  let paintFailures = 0;
  let resizedFallbacks = 0;
  /** The set this import is part of, from `beginSet` until it's kept or taken back. */
  let held: HeldSet | null = null;
  /** This version's place in its set. */
  let versionIndex: number | null = null;

  /** Clears the version in hand and removes what it left. The set around it, if any, stays. */
  function clearVersion() {
    generation++;
    if (root) {
      try {
        root.remove();
      } catch {
        // already gone
      }
    }
    components?.discard();
    components = null;
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
    definition = null;
    broken = new Set();
    componentsCreated = 0;
    instancesCreated = 0;
    overrideFailures = 0;
    overrideFailuresInMains = 0;
    layoutFailures = 0;
    paintFailures = 0;
    resizedFallbacks = 0;
    versionIndex = null;
  }

  function reset() {
    clearVersion();
    for (const { root: frame, components: section } of held?.finished ?? []) {
      try {
        frame.remove();
      } catch {
        // already gone
      }
      section.discard();
    }
    held = null;
    // After the mains: one would keep what it uses in use.
    if (tokens) cleaning = Promise.all([cleaning, tokens.discard()]);
    tokens = null;
  }

  async function loadFont(f: FontRef): Promise<void> {
    try {
      await api.loadFontAsync(f);
      loadedFonts.add(fontKey(f));
    } catch {
      // stays out of loadedFonts; text using it falls back
    }
  }

  /** Where a new root goes on `target`: past all that is there. */
  function clearOf(target: PageNode): number {
    let right = 0;
    let any = false;
    for (const child of target.children) {
      const edge = child.x + child.width;
      if (!any || edge > right) right = edge;
      any = true;
    }
    return any ? right + GAP : 0;
  }

  /**
   * Opens a set of versions. Its tokens come next, then `begin` to `end` per version, then
   * `endSet`. Only `endSet` commits, unless there's an unfinished import to close off here.
   */
  async function beginSet(): Promise<void> {
    const stale = active || held !== null;
    reset();
    await cleaning;
    if (stale) api.commitUndo();
    const target = api.currentPage;
    held = { page: target, x: clearOf(target), finished: [] };
  }

  async function begin(meta: ImportMeta): Promise<void> {
    const set = meta.version ? held : null;
    if (set) {
      // Takes what a failed version left, and only that.
      clearVersion();
    } else {
      reset();
      await cleaning;
      api.commitUndo();
    }
    active = true;
    versionIndex = set ? (meta.version?.index ?? null) : null;
    rootName = meta.version ? `${meta.name} — ${meta.version.label}` : meta.name;
    page = set?.page ?? api.currentPage;
    components = createComponentSet(
      api,
      rootName,
      {
        paints: (list) => paints(list, false),
        effects,
        solid: (color, opacity) => solidPaint(color, opacity),
        mode: setMode,
      },
      page
    );
    await Promise.all([loadFont(FALLBACK), ...meta.fonts.map(loadFont)]);
    fallbackOk = loadedFonts.has(fontKey(FALLBACK));
    rootX = set ? set.x : clearOf(page);
  }

  /** Puts a root or a main on its version's mode. A refused mode leaves it on the first. */
  function setMode(node: FrameNode | ComponentNode) {
    if (versionIndex === null) return;
    const mode = tokens?.modeOf(versionIndex);
    if (!mode) return;
    try {
      node.setExplicitVariableModeForCollection(mode.collection, mode.modeId);
    } catch {
      tokens?.failed();
    }
  }

  /** Settles the plan's tokens against the file. Comes before any batch that uses them. */
  async function importTokens(plan: PlanTokens, options: ImportOptions): Promise<void> {
    if (!active) throw new Error("import not started");
    tokens ??= createTokenSet(api);
    await tokens.resolve(plan, options, tokenRuntime());
  }

  /**
   * As `importTokens`, for a set of two or more versions, before its first `begin`. The versions
   * it gives must lose their tokens before their batches.
   */
  async function importModes(
    plan: PlanVersionTokens,
    options: ImportOptions
  ): Promise<{ droppedVersions: number[] }> {
    if (!active && !held) throw new Error("import not started");
    tokens ??= createTokenSet(api);
    const set = tokens;
    await set.resolveModes(plan, options, tokenRuntime());
    return { droppedVersions: set.counts().droppedVersions };
  }

  function tokenRuntime(): TokenRuntime {
    const run = generation;
    sliceStart = Date.now();
    return {
      overBudget,
      breathe: () => breathe(run),
      ensureFont: async (font) => {
        if (!loadedFonts.has(fontKey(font))) await loadFont(font);
        return loadedFonts.has(fontKey(font));
      },
    };
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

  /** `count` is false for a copy of paint already counted, such as a hover variant's. */
  function paints(list: PlanPaint[], count = true): Paint[] {
    const out: Paint[] = [];
    for (const p of list) {
      if (p.type === "SOLID") {
        out.push(solidPaint(p.color, p.opacity, p.colorKey));
      } else if (p.type === "IMAGE") {
        const imageHash = images.get(p.hash);
        if (!imageHash) {
          if (count) missingImages++;
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
    return list.map((e): Effect => {
      if (!("color" in e)) {
        return { type: e.type, blurType: "NORMAL", radius: e.radius, visible: true };
      }
      return {
        type: e.type,
        color: e.color,
        offset: e.offset,
        radius: e.radius,
        spread: e.spread,
        visible: true,
        blendMode: "NORMAL",
      };
    });
  }

  /** Adds a node to its parent, into its cell if it has one. A grid has no other way to place it. */
  function join(parent: FrameNode, node: Built | FrameNode, op: PlanOp) {
    const cell = op.childLayout?.cell;
    if (cell && parent.layoutMode === "GRID") parent.appendChildAt(node, cell.row, cell.column);
    else parent.appendChild(node);
  }

  /** Creates a frame under `parent`, or at the top of the page when `parent` is null. */
  function createFrame(parent: FrameNode | null, op: PlanOp, name: string): FrameNode {
    // Takes a frame's properties, which `buildFrame` sets whatever a main's defaults are.
    const isMain = op.op === "frame" && op.component;
    const node = isMain ? (api.createComponent() as unknown as FrameNode) : api.createFrame();
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

  /**
   * Where the parent does not place the child, puts it at `x`, `y`. Needs the child in the parent.
   * Returns whether it did: a child that auto layout places is never rotated.
   */
  function place(node: Built, parent: FrameNode | null, op: PlanOp, x = op.x, y = op.y): boolean {
    const child = inLayout(parent) ? op.childLayout : undefined;
    if (child?.positioning === "AUTO") return false;
    if (child) node.layoutPositioning = "ABSOLUTE";
    node.x = x;
    node.y = y;
    return true;
  }

  /**
   * Turns a placed node about its centre, which stays where the capture had it. The mapper keeps a
   * rotated child out of auto layout, so only absolute and unlaid children get here.
   */
  function rotate(node: SceneNode, op: PlanOp, placed: boolean) {
    const degrees = "rotation" in op ? op.rotation : undefined;
    if (!placed || !degrees) return;
    turnAbout(node, op, degrees);
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
    applyLayout(node, op);
    if (node.layoutMode !== "NONE") bindLengths(node, op.layout);
  }

  /**
   * Binds the gaps and padding that became spacing variables, once the plain values are set. A
   * refused binding counts and leaves the plain value, and the layout as it is.
   */
  function bindLengths(node: FrameNode, layout: PlanLayout) {
    if (layout.mode === "NONE") return;
    const keys = layout.spacingKeys;
    const set = tokens;
    if (!keys || !set) return;
    const bind = (field: VariableBindableNodeField, key: string | null | undefined) => {
      const variable = set.spacing(key);
      if (!variable) return;
      try {
        node.setBoundVariable(field, variable);
      } catch {
        set.failed();
      }
    };
    const sides = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const;
    for (const [i, field] of sides.entries()) bind(field, keys.padding?.[i]);
    if (layout.mode === "GRID") {
      bind("gridRowGap", keys.rowGap);
      bind("gridColumnGap", keys.columnGap);
      return;
    }
    bind("itemSpacing", keys.itemSpacing);
    if (layout.wrap) bind("counterAxisSpacing", keys.counterSpacing);
  }

  function applyLayout(node: FrameNode, op: FrameOp) {
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

  function fillParent(node: FrameNode | InstanceNode, parent: FrameNode | null, op: PlanOp) {
    if (!inLayout(parent)) return;
    if (op.childLayout?.sizingH === "FILL") node.layoutSizingHorizontal = "FILL";
    if (op.childLayout?.sizingV === "FILL") node.layoutSizingVertical = "FILL";
  }

  function buildFrame(op: FrameOp, parent: FrameNode | null) {
    const name = parent || op.component ? op.name : rootName || op.name;
    const node = createFrame(parent, op, name);
    if (!parent) setMode(node);
    setLayout(node, op);
    node.clipsContent = op.clips;
    // A refused paint costs that paint, not the frame and all that is under it.
    try {
      node.fills = paints(op.fills);
      // A fill style replaces the whole list, so it needs the solid to be the only fill.
      const [only] = op.fills;
      const fillStyle =
        op.fills.length === 1 && only?.type === "SOLID" ? paintStyleId(only.colorKey) : undefined;
      if (fillStyle) styleLinks.push(() => node.setFillStyleIdAsync(fillStyle));
    } catch {
      paintFailures++;
      node.fills = [];
    }
    setRadius(node, op.radius);
    setStroke(node, op.strokes);
    try {
      node.effects = effects(op.effects);
    } catch {
      paintFailures++;
    }
    node.opacity = op.opacity;
    // The import root is placed by the applier, not at its captured offset, and a main by `layOut`.
    // A frame in auto layout is turned by the tracker once its size is final.
    if (parent) {
      const placed = place(node, parent, op);
      if (node.layoutMode === "NONE") rotate(node, op, placed);
    } else if (!op.component) place(node, null, op, rootX, 0);
    if (op.layout.mode === "NONE" && op.layout.reason) tracker.countFallback(op.layout.reason);
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

  /**
   * Sets the characters and every run, which can take several trips to Figma. Style links are made
   * here, so the node must be in the tree by now.
   */
  async function setText(node: TextNode, op: Pick<TextOp, "text" | "runs">, font: FontRef) {
    const run = generation;
    node.fontName = font;
    node.characters = op.text;
    // New text in an instance keeps its main's link. A run puts back any link of its own below.
    if (node.hyperlink !== null && op.text.length > 0) {
      node.setRangeHyperlink(0, op.text.length, null);
    }
    for (const planned of op.runs) {
      const start = Math.max(planned.start, 0);
      const end = Math.min(planned.end, op.text.length);
      if (start >= end) continue;
      await runProps(node, planned, start, end);
      if (run !== generation) throw new Error("import ended");
    }
  }

  /**
   * Counts wrapped text that came out at least a line taller than its main's, without resizing it.
   * An override has no captured line count, so the main's is what it is held to.
   */
  function noteGainedLine(node: TextNode, before: number, runs: PlanRun[]) {
    if (node.textAutoResize !== "HEIGHT") return;
    const line = Math.max(...runs.map((r) => r.lineHeight ?? r.fontSize));
    if (node.height > before + line / 2) tracker.noteRewrapped();
  }

  /** Changes the image alone: its fit and the rest are the main's, and a look never differs there. */
  function setImage(node: SceneNode, hash: string) {
    if (node.type !== "RECTANGLE" && node.type !== "FRAME") throw new Error("not an image");
    const imageHash = images.get(hash);
    if (!imageHash) {
      missingImages++;
      throw new Error("image unavailable");
    }
    const current = (node.fills as readonly Paint[]).find((p) => p.type === "IMAGE");
    node.fills = [
      { ...(current ?? { type: "IMAGE", scaleMode: "FILL" }), imageHash } as ImagePaint,
    ];
  }

  function noteOverrideFailures(count: number) {
    overrideFailures += count;
    if (definition) overrideFailuresInMains += count;
  }

  /** `resize` fixes both axes, so an axis the main hugs goes back to hugging. */
  function sizeLike(node: InstanceNode, main: ComponentNode, w: number, h: number) {
    node.resize(clampSize(w), clampSize(h));
    if (main.layoutSizingHorizontal === "HUG") node.layoutSizingHorizontal = "HUG";
    if (main.layoutSizingVertical === "HUG") node.layoutSizingVertical = "HUG";
  }

  async function applyOverride(instance: InstanceNode, override: PlanOverride) {
    const node = childAt(instance, override.path);
    if (override.kind === "image") {
      setImage(node, override.hash);
    } else if (override.kind === "swap") {
      const main = components?.main(override.key);
      if (!main || node.type !== "INSTANCE") throw new Error("nothing to swap");
      const { layoutSizingHorizontal: sizingH, layoutSizingVertical: sizingV } = node;
      node.swapComponent(main);
      // The swap itself held, so what is below it goes on: only the size is lost if this fails.
      try {
        // A swap keeps the instance's old size. `resize` then drops a FILL, which is its parent's.
        sizeLike(node, main, main.width, main.height);
        if (sizingH === "FILL") node.layoutSizingHorizontal = "FILL";
        if (sizingV === "FILL") node.layoutSizingVertical = "FILL";
      } catch {
        noteOverrideFailures(1);
      }
    } else {
      if (node.type !== "TEXT") throw new Error("not text");
      const before = node.height;
      await setText(node, override, usableFont(override.runs[0]?.fontName ?? FALLBACK));
      noteGainedLine(node, before, override.runs);
    }
  }

  /**
   * Shortest path first: after a swap, a longer path goes on into the swapped component, so what
   * is below a swap that failed has nowhere to go. A failure leaves that layer as the main has it.
   */
  async function applyOverrides(instance: InstanceNode, overrides: PlanOverride[]) {
    const run = generation;
    const lost: number[][] = [];
    for (const override of [...overrides].sort(shortestFirst)) {
      if (overBudget() && !(await breathe(run))) throw new Error("import ended");
      try {
        if (lost.some((path) => startsWith(override.path, path))) throw new Error("swap failed");
        await applyOverride(instance, override);
        if (run !== generation) throw new Error("import ended");
      } catch (e) {
        if (run !== generation) throw e;
        noteOverrideFailures(1);
        if (override.kind !== "swap") continue;
        lost.push(override.path);
        // Paths from outside walk through this instance into a component it never became.
        if (definition) broken.add(definition);
      }
    }
  }

  /**
   * An instance hugs by itself, and `resize` would fix it. It needs resizing only if the plan says
   * so or if its main lost the auto layout the plan counted on.
   */
  function sizeInstance(node: InstanceNode, main: ComponentNode, op: InstanceOp) {
    const lostHug = main.layoutMode === "NONE" && (main.width !== op.w || main.height !== op.h);
    if (lostHug && main.children.length > 0) resizedFallbacks++;
    if (op.resize || lostHug) sizeLike(node, main, op.w, op.h);
  }

  async function buildInstance(op: InstanceOp, parent: FrameNode): Promise<InstanceNode> {
    const main = components?.main(op.key);
    if (!main) throw new Error(`no component ${op.key}`);
    const node = main.createInstance();
    pending = node;
    join(parent, node, op);
    node.name = op.name;
    const swapsBroken = op.overrides.some((o) => o.kind === "swap" && broken.has(o.key));
    if (broken.has(op.key) || swapsBroken) {
      noteOverrideFailures(op.overrides.length);
      if (definition) broken.add(definition);
    } else {
      await applyOverrides(node, op.overrides);
    }
    sizeInstance(node, main, op);
    place(node, parent, op);
    fillParent(node, parent, op);
    instancesCreated++;
    return node;
  }

  function buildMain(op: FrameOp, key: string): Built {
    definition = key;
    const node = buildFrame(op, null);
    (components as ComponentSet).adopt(key, node as unknown as ComponentNode, op.component?.hover);
    componentsCreated++;
    return node;
  }

  function build(op: PlanOp): Built | Promise<Built> {
    if (op.op === "frame" && op.component) return buildMain(op, op.component.key);
    if (op.op === "frame" && op.parent === null) {
      if (rootAttempted) throw new Error("more than one root op");
      rootAttempted = true;
      definition = null;
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
          rotate(node, op, place(node, parent, op));
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
        rotate(node, op, place(node, parent, op));
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
          rotate(node, op, place(node, parent, op));
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
        rotate(imported, op, place(imported, parent, op));
        return imported;
      }
      case "placeholder": {
        const node = newFrame(parent, op, op.label);
        node.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.08 }];
        node.opacity = op.opacity;
        place(node, parent, op);
        return node;
      }
      case "instance":
        return buildInstance(op, parent);
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
      if (definition) broken.add(definition);
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
      // Verification can still change a main, and an instance reads what it ends up as.
      if (op.op === "instance" && !(await tracker.drain(overBudget, () => breathe(run)))) return;
      await applyOp(op);
      if (run !== generation) return;
    }
    if (await tracker.drain(overBudget, () => breathe(run))) await tick();
  }

  /** A set's tokens are the whole set's, so `endSet` gives them and no version does. */
  const tokenCounts = () => (held ? NO_TOKENS : (tokens?.counts() ?? NO_TOKENS));
  const componentCounts = () => ({
    componentsCreated,
    instancesCreated,
    overrideFailures,
    overrideFailuresInMains,
    layoutFailures,
    paintFailures,
    resizedFallbacks,
    ...(components?.hoverCounts() ?? { hoverVariants: 0, hoverFailures: 0 }),
  });

  async function end(): Promise<EndResult> {
    if (!active) throw new Error("import not started");
    const run = generation;
    try {
      const done = root;
      if (!done) {
        // The root op failed (already counted) or never arrived (count it now).
        if (!rootAttempted) failedOps++;
        // Before the commit: otherwise one undo brings back a section with no page beside it.
        components?.discard();
        components = null;
        if (!held) api.commitUndo();
        return {
          rootId: "",
          failedOps,
          missingImages,
          ...tracker.counts(),
          ...componentCounts(),
          ...tokenCounts(),
        };
      }
      tracker.closeOpen();
      sliceStart = Date.now();
      if (!(await tracker.drain(overBudget, () => breathe(run)))) return CANCELLED;
      try {
        components?.layOut(done, broken);
      } catch {
        layoutFailures++;
      }
      if (!held) {
        api.commitUndo();
        select(page ?? api.currentPage, [done]);
      }
      const result = {
        rootId: done.id,
        failedOps,
        missingImages,
        ...tracker.counts(),
        ...componentCounts(),
        ...tokenCounts(),
      };
      if (held) {
        // Kept, but only until the set is: `reset` still removes these.
        held.finished.push({ root: done, components: components as ComponentSet });
        held.x = done.x + done.width + VERSION_GAP;
      } else {
        tokens = null; // keep the tokens the layers use
      }
      root = null; // keep the layers; reset() would remove them
      components = null; // and the mains
      return result;
    } finally {
      if (run === generation) {
        if (held) clearVersion();
        else reset();
      }
    }
  }

  function select(target: PageNode, frames: FrameNode[]) {
    try {
      target.selection = frames;
      api.viewport.scrollAndZoomIntoView(frames);
    } catch {
      // the user may have switched pages; the import itself is done
    }
  }

  /**
   * One row of sections under the tallest frame, each at its frame's x, or further right when the
   * section before it runs on past there: a section can be wider than its frame.
   */
  function placeSections(finished: HeldSet["finished"]): number {
    try {
      const bottom = Math.max(...finished.map(({ root: r }) => r.y + r.height));
      let left = Number.NEGATIVE_INFINITY;
      for (const { root: frame, components: section } of finished) {
        const right = section.moveTo(Math.max(frame.x, left), bottom + VERSION_GAP);
        if (right !== null) left = right + VERSION_GAP;
      }
      return 0;
    } catch {
      return 1;
    }
  }

  /** Keeps the versions that finished, as one undo step. With none, nothing stays, tokens neither. */
  async function endSet(): Promise<SetResult> {
    if (!held) throw new Error("set not started");
    clearVersion();
    const { page: target, finished } = held;
    if (finished.length === 0) {
      await cancel();
      return NO_SET;
    }
    const layoutFailures = placeSections(finished);
    api.commitUndo();
    const frames = finished.map((f) => f.root);
    select(target, frames);
    const result = {
      ...(tokens?.counts() ?? NO_TOKENS),
      rootIds: frames.map((f) => f.id),
      layoutFailures,
    };
    held = null; // keep the frames and the sections
    tokens = null; // and the tokens they use
    reset();
    return result;
  }

  /** Abandon the import: remove the partial root and mains, and restore the undo point. */
  async function cancel(): Promise<void> {
    if (!active && !held) return;
    const hadTokens = tokens !== null;
    reset();
    api.commitUndo();
    if (!hadTokens) return;
    await cleaning;
    api.commitUndo();
  }

  return {
    beginSet,
    begin,
    importTokens,
    importModes,
    addImage,
    applyBatch,
    end,
    endSet,
    cancel,
    isActive: () => active || held !== null,
  };
}
