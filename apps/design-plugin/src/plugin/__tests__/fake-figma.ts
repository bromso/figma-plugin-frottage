/**
 * Minimal in-memory stand-in for the Figma plugin API, enforcing the rules the
 * real one does that the applier can trip over (font loading, range bounds,
 * effect fields, minimum size, default frame fill).
 */

export type FakeNode = Record<string, any> & {
  id: string;
  type: string;
  children: FakeNode[];
};

type Options = {
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
};

const fontId = (f: { family: string; style: string }) => `${f.family}|${f.style}`;

export function fakeFigma(opts: Options = {}) {
  const calls: string[] = [];
  const nodes = new Map<string, FakeNode>();
  const hashes = new Map<string, string>();
  const created: FakeNode[] = [];
  const svgSources: string[] = [];
  const loaded = new Set<string>();
  let seq = 0;

  const page: FakeNode = {
    id: "page",
    type: "PAGE",
    children: [],
    appendChild(child: FakeNode) {
      child.parent?.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = page;
      page.children.push(child);
    },
  };
  let selection: FakeNode[] = [];
  Object.defineProperty(page, "selection", {
    get: () => selection,
    set: (v: FakeNode[]) => {
      if (opts.viewportThrows) throw new Error("page switched");
      selection = v;
    },
  });
  for (const b of opts.existingBounds ?? []) {
    page.children.push({ id: `old${seq++}`, type: "FRAME", children: [], ...b });
  }

  function makeNode(type: string): FakeNode {
    const id = `n${++seq}`;
    let name = "";
    let effects: any[] = [];
    const node: FakeNode = {
      id,
      type,
      children: [],
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
          if (typeof e.visible !== "boolean" || typeof e.blendMode !== "string") {
            throw new Error("effect needs visible and blendMode");
          }
        }
        effects = v;
      },
      appendChild(child: FakeNode) {
        child.parent?.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = node;
        node.children.push(child);
      },
      resize(w: number, h: number) {
        if (!(w >= 0.01) || !(h >= 0.01)) throw new Error("resize below 0.01");
        node.width = w;
        node.height = h;
      },
      remove() {
        node.removed = true;
        node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      },
    };
    page.children.push(node);
    nodes.set(id, node);
    created.push(node);
    return node;
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
    createNodeFromSvg(svg: string) {
      calls.push("createNodeFromSvg");
      svgSources.push(svg);
      if (opts.svgThrows) throw new Error("Invalid SVG");
      // Figma returns an unfilled frame that holds the vectors; its clipping is Figma's choice.
      const n = makeNode("FRAME");
      n.fills = [];
      n.clipsContent = false;
      n.width = 24;
      n.height = 24;
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
      const charWidth = opts.charWidth ?? 5;
      let autoResize = "NONE";
      const lineHeightPx = () => {
        // The tallest pixel line height among the runs, else the automatic height.
        const px = (t.ranges ?? [])
          .filter((x: any) => x.m === "setRangeLineHeight" && x.v?.unit === "PIXELS")
          .map((x: any) => x.v.value as number);
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
      };
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
          chars = v;
          layout();
        },
      });
      for (const m of [
        "setRangeFontName",
        "setRangeFontSize",
        "setRangeFills",
        "setRangeLineHeight",
        "setRangeLetterSpacing",
        "setRangeTextDecoration",
        "setRangeTextCase",
      ]) {
        t[m] = (s: number, e: number, v: any) => {
          calls.push(m);
          if (s >= e) throw new Error(`empty range ${s}-${e}`);
          if (s < 0 || e > chars.length) throw new Error(`range ${s}-${e} out of bounds`);
          if (m === "setRangeFontName" && !loaded.has(fontId(v))) {
            throw new Error(`font not loaded: ${fontId(v)}`);
          }
          if (!t.ranges) t.ranges = [];
          t.ranges.push({ m, s, e, v });
          if (m === "setRangeLineHeight") layout();
        };
      }
      return t;
    },
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
    created,
    svgSources,
    page,
    raw_createText: () => figma.createText() as FakeNode,
  };
}
