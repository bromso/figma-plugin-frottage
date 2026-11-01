import { type LayoutOptions, layoutModel } from "./fake-auto-layout";
import { type TokenOptions, tokenModel } from "./fake-tokens";

/**
 * Minimal in-memory stand-in for the Figma plugin API, enforcing the rules the
 * real one does that the applier can trip over (font loading, range bounds,
 * effect fields, minimum size, default frame fill, auto layout).
 */

export type FakeNode = Record<string, any> & {
  id: string;
  type: string;
  children: FakeNode[];
};

type Options = LayoutOptions &
  TokenOptions & {
    createImageThrows?: boolean;
    /** Setting a node's name to this value throws, which fails the op. */
    failOn?: string;
    /** "family|style" keys whose loadFontAsync rejects. */
    failFonts?: string[];
    existingBounds?: { x: number; width: number }[];
    /** createNodeFromSvg throws, as Figma does for markup it rejects. */
    svgThrows?: boolean;
    /** selection assignment or scrollAndZoomIntoView throws. */
    viewportThrows?: boolean;
    /** Text measure rule: every character is this wide (default 5). */
    charWidth?: number;
    /** Auto line height when no pixel line height is set (default 12). */
    lineHeight?: number;
    /** Extra px per line, simulating the rounding real Figma applies to line heights. */
    lineHeightDrift?: number;
    /** Text measures this much wider than the charWidth rule, as Figma's does than Chrome's. */
    textWiderBy?: number;
    /** `resize` throws on an instance that has been swapped. */
    swappedResizeThrows?: boolean;
    /** Setting this layout property throws, as for a value Figma refuses. */
    failLayout?: string;
  };

const AUTO_LAYOUT_FIELDS = [
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "itemSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
];

const fontId = (f: { family: string; style: string }) => `${f.family}|${f.style}`;

export function fakeFigma(opts: Options = {}) {
  const calls: string[] = [];
  const nodes = new Map<string, FakeNode>();
  const hashes = new Map<string, string>();
  const created: FakeNode[] = [];
  const svgSources: string[] = [];
  const loaded = new Set<string>();
  const model = layoutModel(opts);
  let seq = 0;
  const tokens = tokenModel(opts, loaded, (test) => findAll(test));

  /** Takes a child off its parent's own list; `children` is a copy, as in Figma. */
  const detach = (child: FakeNode) => {
    const list: FakeNode[] | undefined = child.parent?.kids;
    list?.splice(list.indexOf(child), 1);
  };

  const pageKids: FakeNode[] = [];
  const page: FakeNode = {
    id: "page",
    type: "PAGE",
    children: pageKids,
    kids: pageKids,
    appendChild(child: FakeNode) {
      detach(child);
      child.parent = page;
      page.kids.push(child);
    },
  };
  /** Every node on the page, as Figma's findAll. */
  function findAll(test: (n: FakeNode) => boolean): FakeNode[] {
    const out: FakeNode[] = [];
    const stack = [...page.kids];
    while (stack.length > 0) {
      const n = stack.pop() as FakeNode;
      if (test(n)) out.push(n);
      stack.push(...(n.kids ?? []));
    }
    return out;
  }
  page.findAll = findAll;
  let selection: FakeNode[] = [];
  Object.defineProperty(page, "selection", {
    get: () => selection,
    set: (v: FakeNode[]) => {
      if (opts.viewportThrows) throw new Error("page switched");
      selection = v;
    },
  });
  for (const b of opts.existingBounds ?? []) {
    page.kids.push({ id: `old${seq++}`, type: "FRAME", children: [], ...b });
  }

  /** Whether `node` is a component or an instance, or sits inside one. */
  const insideComponent = (node: FakeNode | undefined): boolean => {
    for (let n = node; n; n = n.parent) {
      if (n.type === "COMPONENT" || n.type === "INSTANCE") return true;
    }
    return false;
  };

  function makeNode(type: string): FakeNode {
    const id = `n${++seq}`;
    let name = "";
    let effects: any[] = [];
    const kids: FakeNode[] = [];
    const node: FakeNode = {
      id,
      type,
      kids,
      get children() {
        return [...kids];
      },
      parent: page,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      removed: false,
      get name() {
        return name;
      },
      set name(v: string) {
        if (opts.failOn !== undefined && v === opts.failOn) throw new Error(`boom ${v}`);
        name = v;
      },
      get effects() {
        return effects;
      },
      set effects(v: any[]) {
        for (const e of v) {
          const blur = e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR";
          if (typeof e.visible !== "boolean" || (!blur && typeof e.blendMode !== "string")) {
            throw new Error("effect needs visible and blendMode");
          }
          if (blur && e.blurType !== "NORMAL") throw new Error("a blur needs blurType NORMAL");
          if (!Number.isFinite(e.radius)) throw new Error("an effect needs a finite radius");
        }
        effects = v;
      },
      appendChild(child: FakeNode) {
        calls.push("appendChild");
        const cell = model.isGrid(node) ? model.freeCell(node) : null;
        join(child, cell);
      },
      appendChildAt(child: FakeNode, row: number, column: number) {
        if (!model.isGrid(node)) throw new Error("appendChildAt needs a grid");
        calls.push("appendChild");
        model.checkCell(node, row, column);
        if (model.occupied(node, row, column)) throw new Error(`cell ${row},${column} is taken`);
        join(child, [row, column]);
      },
      resize(w: number, h: number) {
        if (!(w >= 0.01) || !(h >= 0.01)) throw new Error("resize below 0.01");
        node.width = w;
        node.height = h;
        node.layoutState.fix();
        model.reflow(node);
        if (model.isLaidOut(node.parent)) model.reflow(node.parent);
      },
      remove() {
        const parent = node.parent;
        calls.push(`remove:${type}`);
        node.removed = true;
        detach(node);
        if (model.isLaidOut(parent)) model.reflow(parent);
      },
    };
    const join = (child: FakeNode, cell: [number, number] | null) => {
      if (child.type === "COMPONENT" && insideComponent(node)) {
        throw new Error("a component cannot go inside a component or an instance");
      }
      const old = child.parent;
      detach(child);
      if (model.isLaidOut(old)) model.reflow(old);
      child.parent = node;
      kids.push(child);
      if (cell) [child.gridRowAnchorIndex, child.gridColumnAnchorIndex] = cell;
      model.reflow(node);
    };
    model.installChild(node);
    // A node's x and y are the translation of its transform, as in Figma, so a turned node's
    // x and y are where its unturned top-left corner went. `rotation` reads back as -θ.
    let turn = 0;
    Object.defineProperties(node, {
      relativeTransform: {
        configurable: true,
        get: () => [
          [Math.cos(turn), -Math.sin(turn), node.x],
          [Math.sin(turn), Math.cos(turn), node.y],
        ],
        set: (m: number[][]) => {
          calls.push("relativeTransform");
          turn = Math.atan2(m[1]?.[0] as number, m[0]?.[0] as number);
          node.x = m[0]?.[2] as number;
          node.y = m[1]?.[2] as number;
        },
      },
      rotation: {
        configurable: true,
        get: () => (-turn * 180) / Math.PI,
      },
    });
    tokens.installNode(node);
    if (type === "FRAME" || type === "COMPONENT" || type === "INSTANCE") {
      model.installFrame(node, () => calls.push("layoutMode"));
      if (opts.failLayout) {
        const { get } = Object.getOwnPropertyDescriptor(
          node,
          opts.failLayout
        ) as PropertyDescriptor;
        Object.defineProperty(node, opts.failLayout, {
          get,
          set: () => {
            throw new Error(`Figma refused ${opts.failLayout}`);
          },
        });
      }
    }
    page.kids.push(node);
    nodes.set(id, node);
    created.push(node);
    return node;
  }

  /** An instance's frame part takes its source's layout, sizing and size. */
  function copyLayout(from: FakeNode, to: FakeNode) {
    if (from.layoutMode !== "NONE") {
      to.layoutMode = from.layoutMode;
      to.layoutSizingHorizontal = "FIXED";
      to.layoutSizingVertical = "FIXED";
      for (const key of AUTO_LAYOUT_FIELDS) to[key] = from[key];
    }
    to.width = from.width;
    to.height = from.height;
    if (from.layoutMode !== "NONE") {
      to.layoutSizingHorizontal = from.layoutSizingHorizontal;
      to.layoutSizingVertical = from.layoutSizingVertical;
    }
  }

  function copyText(from: FakeNode): FakeNode {
    const t = figma.createText() as FakeNode;
    t.fontName = from.fontName;
    t.textAlignHorizontal = from.textAlignHorizontal;
    t.characters = from.characters;
    t.ranges = [...(from.ranges ?? [])];
    t.decorations = [...from.decorations];
    t.width = from.width;
    t.height = from.height;
    t.textAutoResize = from.textAutoResize;
    return t;
  }

  /** What a copy keeps of the paint that is not in the layout. */
  function copyLook(from: FakeNode, to: FakeNode): FakeNode {
    for (const key of ["opacity", "strokes"]) if (from[key] !== undefined) to[key] = from[key];
    if (from.effects?.length > 0) to.effects = from.effects;
    return to;
  }

  /** A copy of a main's or an instance's child, as an instance holds it. */
  function copyChild(from: FakeNode): FakeNode {
    if (from.type === "TEXT") return copyLook(from, copyText(from));
    if (from.type === "INSTANCE") return copyLook(from, copyBody(from, instanceShell(from.main)));
    const n = makeNode(from.type);
    n.fills = from.fills;
    copyLook(from, n);
    return from.type === "FRAME" ? copyBody(from, n) : Object.assign(n, sizeOf(from));
  }

  /** As in Figma, a clone of a main is a new main beside it. */
  function cloneMain(from: FakeNode): FakeNode {
    calls.push("clone");
    const n = figma.createComponent() as FakeNode;
    copyBody(from, n);
    copyLook(from, n);
    n.name = from.name;
    n.moveTo("x", from.x);
    n.moveTo("y", from.y);
    from.parent.appendChild(n);
    return n;
  }

  const sizeOf = ({ width, height }: FakeNode) => ({ width, height });

  function copyBody(from: FakeNode, to: FakeNode): FakeNode {
    for (const kid of to.children) kid.remove();
    to.fills = from.fills;
    to.clipsContent = from.clipsContent;
    copyLayout(from, to);
    for (const kid of from.kids as FakeNode[]) {
      const copy = copyChild(kid);
      to.kids.push(copy);
      detachFromPage(copy);
      copy.parent = to;
      copy.moveTo("x", kid.x);
      copy.moveTo("y", kid.y);
      if (kid.layoutPositioning === "ABSOLUTE") copy.layoutPositioning = "ABSOLUTE";
      if (kid.layoutSizingHorizontal === "FILL") copy.layoutSizingHorizontal = "FILL";
      if (kid.layoutSizingVertical === "FILL") copy.layoutSizingVertical = "FILL";
    }
    model.reflow(to);
    return to;
  }

  const detachFromPage = (n: FakeNode) => {
    page.kids.splice(page.kids.indexOf(n), 1);
  };

  function instanceShell(main: FakeNode): FakeNode {
    const n = makeNode("INSTANCE");
    n.main = main;
    let swapped = false;
    // Reading this under `dynamic-page` throws in Figma.
    Object.defineProperty(n, "mainComponent", {
      get() {
        throw new Error("mainComponent needs getMainComponentAsync");
      },
    });
    const resize = n.resize;
    n.resize = (w: number, h: number) => {
      calls.push("instance.resize");
      if (swapped && opts.swappedResizeThrows) throw new Error("resize refused");
      resize(w, h);
    };
    n.swapComponent = (next: FakeNode) => {
      calls.push("swapComponent");
      if (next?.type !== "COMPONENT") throw new Error("swapComponent needs a component");
      // As in Figma, the instance keeps its old size, even when it hugs or its parent does.
      const { width, height } = n;
      swapped = true;
      n.main = next;
      copyBody(next, n);
      n.width = width;
      n.height = height;
      if (model.isLaidOut(n.parent)) model.reflow(n.parent);
    };
    return n;
  }

  const figma = {
    get currentPage() {
      return page;
    },
    viewport: {
      scrollAndZoomIntoView(n: FakeNode[]) {
        calls.push("scrollAndZoomIntoView");
        if (opts.viewportThrows) throw new Error("page switched");
        (figma as any).zoomed = n;
      },
    },
    commitUndo() {
      calls.push("commitUndo");
    },
    async loadFontAsync(f: { family: string; style: string }) {
      calls.push("loadFontAsync");
      if (opts.failFonts?.includes(fontId(f))) throw new Error("no font");
      loaded.add(fontId(f));
    },
    createFrame() {
      calls.push("createFrame");
      const n = makeNode("FRAME");
      n.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
      n.clipsContent = true;
      return n;
    },
    createComponent() {
      calls.push("createComponent");
      // Unlike a frame: no fill, and it does not clip.
      const n = makeNode("COMPONENT");
      n.fills = [];
      n.clipsContent = false;
      n.createInstance = () => {
        calls.push("createInstance");
        return copyBody(n, instanceShell(n));
      };
      n.clone = () => cloneMain(n);
      return n;
    },
    combineAsVariants(variants: FakeNode[], parent: FakeNode) {
      calls.push("combineAsVariants");
      if (variants.length < 1 || variants.some((v) => v.type !== "COMPONENT")) {
        throw new Error("combineAsVariants needs components");
      }
      // Lays nothing out: the variants stay where they are, and the set wraps them.
      const set = makeNode("COMPONENT_SET");
      model.installFrame(set, () => calls.push("layoutMode"));
      parent.appendChild(set);
      for (const v of variants) set.appendChild(v);
      set.width = Math.max(...variants.map((v) => v.x + v.width));
      set.height = Math.max(...variants.map((v) => v.y + v.height));
      return set;
    },
    createSection() {
      calls.push("createSection");
      const n = makeNode("SECTION");
      delete n.resize;
      n.resizeWithoutConstraints = (w: number, h: number) => {
        calls.push("resizeWithoutConstraints");
        n.width = w;
        n.height = h;
      };
      return n;
    },
    createNodeFromSvg(svg: string) {
      calls.push("createNodeFromSvg");
      svgSources.push(svg);
      if (opts.svgThrows) throw new Error("Invalid SVG");
      // Figma returns an unfilled frame that holds the vectors.
      const n = makeNode("FRAME");
      n.fills = [];
      n.clipsContent = true;
      n.width = 24;
      n.height = 24;
      const vector: FakeNode = {
        id: `n${++seq}`,
        type: "VECTOR",
        children: [],
        parent: n,
        x: 0,
        y: 0,
        width: 24,
        height: 24,
        constraints: { horizontal: "MIN", vertical: "MIN" },
      };
      n.kids.push(vector);
      // As in Figma, resizing a frame scales a child only when its constraints are SCALE.
      const base = n.resize;
      n.resize = (w: number, h: number) => {
        const sx = w / n.width;
        const sy = h / n.height;
        base(w, h);
        for (const c of n.children) {
          if (c.constraints?.horizontal === "SCALE") {
            c.x *= sx;
            c.width *= sx;
          }
          if (c.constraints?.vertical === "SCALE") {
            c.y *= sy;
            c.height *= sy;
          }
        }
      };
      return n;
    },
    createRectangle() {
      calls.push("createRectangle");
      return makeNode("RECTANGLE");
    },
    createText() {
      calls.push("createText");
      const t = makeNode("TEXT");
      let chars = "";
      let font = { family: "Inter", style: "Regular" };
      Object.defineProperty(t, "fontName", {
        get: () => font,
        set: (v) => {
          if (!loaded.has(fontId(v))) throw new Error(`font not loaded: ${fontId(v)}`);
          font = v;
        },
      });
      // Text measure: fixed width per character, greedy word wrapping at node.width.
      const charWidth = (opts.charWidth ?? 5) * (1 + (opts.textWiderBy ?? 0));
      let autoResize = "NONE";
      const lineHeightPx = () => {
        // The tallest pixel line height among the runs, else the automatic height.
        const px = (t.ranges ?? [])
          .map((x: any) =>
            x.m === "setRangeTextStyleIdAsync" ? tokens.textStyleById(x.v)?.lineHeight : x
          )
          .map((x: any) => (x?.m === "setRangeLineHeight" ? x.v : x))
          .filter((x: any) => x?.unit === "PIXELS")
          .map((x: any) => x.value as number);
        const base = px.length > 0 ? Math.max(...px) : (opts.lineHeight ?? 12);
        return base + (opts.lineHeightDrift ?? 0);
      };
      const countLines = (width: number) => {
        let lines = 1;
        let cur = 0;
        for (const word of chars.split(" ")) {
          const w = word.length * charWidth;
          if (cur === 0) cur = w;
          else if (cur + charWidth + w <= width + 1e-9) cur += charWidth + w;
          else {
            lines++;
            cur = w;
          }
        }
        return lines;
      };
      const layout = () => {
        if (autoResize === "WIDTH_AND_HEIGHT") {
          t.width = Math.max(chars.length * charWidth, 0.01);
          t.height = lineHeightPx();
        } else if (autoResize === "HEIGHT") {
          t.height = countLines(t.width) * lineHeightPx();
        }
        if (model.isLaidOut(t.parent)) model.reflow(t.parent);
      };
      t.remeasure = layout;
      Object.defineProperty(t, "textAutoResize", {
        get: () => autoResize,
        set: (v: string) => {
          autoResize = v;
          layout();
        },
      });
      const baseResize = t.resize;
      t.resize = (w: number, h: number) => {
        // As in real Figma, a height that differs from the current one drops HEIGHT mode.
        if (autoResize === "HEIGHT" && Math.abs(h - t.height) > 1e-9) autoResize = "NONE";
        baseResize(w, h);
        layout();
      };
      Object.defineProperty(t, "characters", {
        get: () => chars,
        set: (v: string) => {
          calls.push("characters");
          if (!loaded.has(fontId(font))) throw new Error(`font not loaded: ${fontId(font)}`);
          const { width } = t;
          chars = v;
          layout();
          // As in Figma, an auto-width label stays on its aligned edge or its centre.
          if (autoResize !== "WIDTH_AND_HEIGHT") return;
          const grew = t.width - width;
          if (t.textAlignHorizontal === "CENTER") t.x -= grew / 2;
          if (t.textAlignHorizontal === "RIGHT") t.x -= grew;
        },
      });
      tokens.installText(t, () => chars, layout);
      for (const m of [
        "setRangeFontName",
        "setRangeFontSize",
        "setRangeFills",
        "setRangeLineHeight",
        "setRangeLetterSpacing",
        "setRangeTextDecoration",
        "setRangeTextCase",
        "setRangeHyperlink",
      ]) {
        t[m] = (s: number, e: number, v: any) => {
          calls.push(m);
          if (s >= e) throw new Error(`empty range ${s}-${e}`);
          if (s < 0 || e > chars.length) throw new Error(`range ${s}-${e} out of bounds`);
          if (m === "setRangeFontName" && !loaded.has(fontId(v))) {
            throw new Error(`font not loaded: ${fontId(v)}`);
          }
          // Like Figma, only a URL or node target is accepted, and a URL must parse.
          if (m === "setRangeHyperlink" && v !== null) {
            if (v?.type !== "URL" || typeof v.value !== "string") throw new Error("bad hyperlink");
            new URL(v.value);
          }
          if (!t.ranges) t.ranges = [];
          t.ranges.push({ m, s, e, v });
          // Like Figma, a link underlines its text.
          if (m === "setRangeHyperlink" && v !== null) t.decorations.push({ s, e, v: "UNDERLINE" });
          if (m === "setRangeTextDecoration") t.decorations.push({ s, e, v });
          if (m === "setRangeLineHeight") layout();
        };
      }
      Object.defineProperty(t, "hyperlink", {
        get: () =>
          [...(t.ranges ?? [])].reverse().find((x: any) => x.m === "setRangeHyperlink")?.v ?? null,
      });
      return t;
    },
    ...tokens.api,
    createImage(bytes: Uint8Array) {
      calls.push("createImage");
      if (opts.createImageThrows) throw new Error("bad image");
      const key = Array.from(bytes).join(",");
      if (!hashes.has(key)) hashes.set(key, `h${hashes.size}`);
      return { hash: hashes.get(key) as string };
    },
  };

  return {
    figma: figma as unknown as PluginAPI,
    calls,
    count: (c: string) => calls.filter((x) => x === c).length,
    node: (id: string) => nodes.get(id) as FakeNode,
    hashOf: (bytes: Uint8Array) => hashes.get(Array.from(bytes).join(",")),
    lastRectangle: () => [...created].reverse().find((n) => n.type === "RECTANGLE") as FakeNode,
    lastFrame: () => [...created].reverse().find((n) => n.type === "FRAME") as FakeNode,
    /** Whether the first call of `a` came before the first call of `b`. */
    order: (a: string, b: string) => (calls.indexOf(a) < calls.indexOf(b) ? "before" : "after"),
    frame: (name: string) => created.find((n) => n.name === name) as FakeNode,
    created,
    svgSources,
    page,
    tokens,
    raw_createText: () => figma.createText() as FakeNode,
  };
}
