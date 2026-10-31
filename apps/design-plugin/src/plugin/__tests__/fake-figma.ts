/** Minimal in-memory stand-in for the Figma plugin API, enough for the applier. */

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
};

export function fakeFigma(opts: Options = {}) {
  const calls: string[] = [];
  const nodes = new Map<string, FakeNode>();
  const hashes = new Map<string, string>();
  const created: FakeNode[] = [];
  let seq = 0;

  const page: FakeNode = { id: "page", type: "PAGE", children: [], selection: [] };
  for (const b of opts.existingBounds ?? []) {
    page.children.push({ id: `old${seq++}`, type: "FRAME", children: [], ...b });
  }

  function makeNode(type: string): FakeNode {
    const id = `n${++seq}`;
    let name = "";
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
      appendChild(child: FakeNode) {
        child.parent?.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = node;
        node.children.push(child);
      },
      resize(w: number, h: number) {
        if (w < 0.01 || h < 0.01) throw new Error("resize below 0.01");
        node.width = w;
        node.height = h;
      },
      remove() {
        node.removed = true;
        node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      },
    };
    for (const m of [
      "setRangeFontName",
      "setRangeFontSize",
      "setRangeFills",
      "setRangeLineHeight",
      "setRangeLetterSpacing",
      "setRangeTextDecoration",
      "setRangeTextCase",
    ]) {
      node[m] = (s: number, e: number, v: unknown) => {
        calls.push(m);
        if (!node.ranges) node.ranges = [];
        node.ranges.push({ m, s, e, v });
      };
    }
    page.children.push(node);
    nodes.set(id, node);
    created.push(node);
    return node;
  }

  const figma = {
    currentPage: page,
    viewport: {
      scrollAndZoomIntoView(n: FakeNode[]) {
        calls.push("scrollAndZoomIntoView");
        (figma as any).zoomed = n;
      },
    },
    commitUndo() {
      calls.push("commitUndo");
    },
    async loadFontAsync(f: { family: string; style: string }) {
      calls.push("loadFontAsync");
      if (opts.failFonts?.includes(`${f.family}|${f.style}`)) throw new Error("no font");
    },
    createFrame() {
      calls.push("createFrame");
      return makeNode("FRAME");
    },
    createRectangle() {
      calls.push("createRectangle");
      return makeNode("RECTANGLE");
    },
    createText() {
      calls.push("createText");
      const t = makeNode("TEXT");
      let chars = "";
      Object.defineProperty(t, "characters", {
        get: () => chars,
        set: (v: string) => {
          calls.push("characters");
          chars = v;
        },
      });
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
    page,
    raw: figma as any,
  };
}
