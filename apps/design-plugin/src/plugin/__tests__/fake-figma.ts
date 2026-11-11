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
    /** `setExplicitVariableModeForCollection` throws, or does from this call on, counting from 1. */
    failExplicitMode?: boolean | number;
    /** `combineAsVariants` throws, as Figma does for nodes it can't combine. */
    combineThrows?: boolean;
    /** `addComponentProperty` throws for a property of this name. */
    failProperty?: string;
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

/** A component property, as `componentPropertyDefinitions` gives it. */
type PropertyDef = {
  type: string;
  defaultValue: string | boolean;
  preferredValues?: { type: string; key: string }[];
  variantOptions?: string[];
};
type PropertyValue = string | boolean;

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
  page.findAllWithCriteria = ({ types }: { types: string[] }) =>
    findAll((n) => types.includes(n.type));
  page.name = "Page 1";
  /** Every page in the file, the first the one open; `createPage` adds one, unloaded. */
  const pages: FakeNode[] = [page];
  function newPage(): FakeNode {
    const kids: FakeNode[] = [];
    let loaded = false;
    const p: FakeNode = {
      id: `page${pages.length + 1}`,
      type: "PAGE",
      name: "",
      kids,
      get children() {
        return [...kids];
      },
      selection: [],
      removed: false,
      findAllWithCriteria({ types }: { types: string[] }) {
        if (!loaded) throw new Error("page not loaded");
        const out: FakeNode[] = [];
        const stack = [...kids];
        while (stack.length > 0) {
          const n = stack.pop() as FakeNode;
          if (types.includes(n.type)) out.push(n);
          stack.push(...(n.kids ?? []));
        }
        return out;
      },
      async loadAsync() {
        calls.push("page.loadAsync");
        await held("page.loadAsync");
        loaded = true;
      },
      appendChild(child: FakeNode) {
        // Measured under `dynamic-page`: a new page must be loaded before it is used.
        if (!loaded) throw new Error("page not loaded");
        detach(child);
        child.parent = p;
        kids.push(child);
      },
      remove() {
        calls.push("remove:PAGE");
        // As in Figma: the open page can't be removed.
        if (current === p) throw new Error("cannot remove the current page");
        p.removed = true;
        pages.splice(pages.indexOf(p), 1);
      },
    };
    pages.push(p);
    return p;
  }
  const storage = new Map<string, unknown>();
  let current: FakeNode = page;
  /** Calls a test holds open, to act while they are pending: each gets the callback that ends it. */
  const holds = new Map<string, (done: () => void) => void>();
  const held = async (name: string) => {
    const hold = holds.get(name);
    if (hold) await new Promise<void>((resolve) => hold(resolve));
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
    page.kids.push({ id: `old${seq++}`, type: "FRAME", children: [], ...b });
  }

  /** Whether `node` is a component or an instance, or sits inside one. */
  const insideComponent = (node: FakeNode | undefined): boolean => {
    for (let n = node; n; n = n.parent) {
      if (n.type === "COMPONENT" || n.type === "INSTANCE") return true;
    }
    return false;
  };

  /** A variant name's values, `Size=sm, State=Hover` as `{ Size: "sm", State: "Hover" }`. */
  const variantValues = (name: string): Record<string, string> =>
    Object.fromEntries(
      name.split(",").flatMap((part) => {
        const [key, value] = part.split("=").map((x) => x.trim());
        return key && value !== undefined ? [[key, value]] : [];
      })
    );

  /** As in Figma, a variant name can't give one property two values. */
  const checkVariantName = (name: string) => {
    const keys = name.split(",").map((part) => part.split("=")[0]?.trim());
    if (new Set(keys).size !== keys.length) throw new Error(`ambiguous variant name: ${name}`);
  };

  /** The node whose properties a main's layers and instances use: its set, or itself. */
  const ownerOf = (main: FakeNode): FakeNode =>
    main.parent?.type === "COMPONENT_SET" ? main.parent : main;

  /** The component or set whose properties `node`, a layer of a main, may reference. */
  function referenceOwner(node: FakeNode): FakeNode {
    for (let n = node.parent; n; n = n.parent) {
      if (n.type === "INSTANCE") throw new Error("a layer inside an instance can't reference");
      if (n.type === "COMPONENT") return ownerOf(n);
    }
    throw new Error("componentPropertyReferences needs a component sublayer");
  }

  const REFERENCE_TYPES: Record<string, string> = {
    characters: "TEXT",
    visible: "BOOLEAN",
    mainComponent: "INSTANCE_SWAP",
  };

  /** Component properties on a component or a set, as Figma's `ComponentPropertiesMixin`. */
  function installProperties(node: FakeNode) {
    const defs = new Map<string, PropertyDef>();
    node.propDefs = defs;
    const isVariant = () => node.type === "COMPONENT" && node.parent?.type === "COMPONENT_SET";
    Object.defineProperty(node, "componentPropertyDefinitions", {
      get() {
        if (isVariant()) throw new Error("a variant has no definitions of its own; read its set's");
        const out: Record<string, PropertyDef & { variantOptions?: string[] }> = {};
        if (node.type === "COMPONENT_SET") {
          for (const kid of node.kids as FakeNode[]) {
            for (const [key, value] of Object.entries(variantValues(kid.name))) {
              out[key] ??= { type: "VARIANT", defaultValue: value, variantOptions: [] };
              const options = out[key].variantOptions as string[];
              if (!options.includes(value)) options.push(value);
            }
          }
        }
        for (const [name, def] of defs) out[name] = { ...def };
        return out;
      },
    });
    node.addComponentProperty = (
      name: string,
      type: string,
      value: PropertyValue,
      options?: { preferredValues?: PropertyDef["preferredValues"] }
    ) => {
      calls.push("addComponentProperty");
      if (isVariant()) throw new Error("add the property to the variant's set");
      if (opts.failProperty === name) throw new Error(`property ${name} refused`);
      if (node.type === "COMPONENT_SET") {
        const taken = (node.kids as FakeNode[]).some((kid) => name in variantValues(kid.name));
        if (taken) throw new Error(`a variant property is named ${name}`);
      }
      if (type === "TEXT" && typeof value !== "string") throw new Error("TEXT needs a string");
      if (type === "BOOLEAN" && typeof value !== "boolean")
        throw new Error("BOOLEAN needs a boolean");
      if (type === "INSTANCE_SWAP" && nodes.get(value as string)?.type !== "COMPONENT") {
        throw new Error("INSTANCE_SWAP needs a component id");
      }
      if (!["TEXT", "BOOLEAN", "INSTANCE_SWAP"].includes(type)) throw new Error(`no ${type}`);
      const full = `${name}#${++seq}:0`;
      defs.set(full, {
        type,
        defaultValue: value,
        ...(options?.preferredValues ? { preferredValues: options.preferredValues } : {}),
      });
      return full;
    };
    node.deleteComponentProperty = (full: string) => {
      calls.push("deleteComponentProperty");
      if (!defs.delete(full)) throw new Error(`no property ${full}`);
    };
    node.editComponentProperty = (full: string, next: Partial<PropertyDef>) => {
      calls.push("editComponentProperty");
      const def = defs.get(full);
      if (!def) throw new Error(`no property ${full}`);
      if (next.preferredValues) def.preferredValues = next.preferredValues;
      if (next.defaultValue !== undefined) def.defaultValue = next.defaultValue;
      return full;
    };
  }

  function makeNode(type: string): FakeNode {
    const id = `n${++seq}`;
    let name = "";
    let effects: any[] = [];
    const kids: FakeNode[] = [];
    const pluginData = new Map<string, string>();
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
      /** Collection id to mode id. A clone doesn't copy this, the worst case. */
      explicitModes: {},
      setExplicitVariableModeForCollection(collection: FakeNode | string, modeId: string) {
        calls.push("setExplicitMode");
        // Measured: an id throws under `dynamic-page`.
        if (typeof collection === "string") throw new Error("needs the collection node");
        const limit = opts.failExplicitMode;
        const calledSoFar = calls.filter((c: string) => c === "setExplicitMode").length;
        if (limit === true || (typeof limit === "number" && calledSoFar >= limit)) {
          throw new Error("mode refused");
        }
        node.explicitModes[collection.id] = modeId;
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
      getSharedPluginData: (ns: string, key: string) => pluginData.get(`${ns}/${key}`) ?? "",
      setSharedPluginData(ns: string, key: string, value: string) {
        calls.push("node.setSharedPluginData");
        pluginData.set(`${ns}/${key}`, value);
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
      if (type === "COMPONENT_SET") checkVariantName(child.name);
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
    // A layer's references to its component's properties, checked as Figma checks them.
    Object.defineProperty(node, "componentPropertyReferences", {
      configurable: true,
      get: () => node.propRefs ?? null,
      set(refs: Record<string, string> | null) {
        calls.push("componentPropertyReferences");
        const owner = referenceOwner(node);
        const defs = owner.componentPropertyDefinitions;
        for (const [field, name] of Object.entries(refs ?? {})) {
          if (defs[name]?.type !== REFERENCE_TYPES[field])
            throw new Error(`no ${field} property ${name}`);
          if (field === "characters" && node.type !== "TEXT") throw new Error("not text");
          if (field === "mainComponent" && node.type !== "INSTANCE")
            throw new Error("not an instance");
        }
        node.propRefs = refs ? { ...refs } : undefined;
      },
    });
    if (type === "COMPONENT" || type === "COMPONENT_SET") {
      installProperties(node);
      node.key = `key-${id}`;
    }
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
    // As in Figma, an instance's text follows its main's variables until it is unbound.
    if (from.boundVariables) t.boundVariables = { ...from.boundVariables };
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
    const copy = copyNode(from);
    // As in Figma, a copy keeps the layer's references and whether it shows.
    if (from.propRefs) copy.propRefs = { ...from.propRefs };
    if (from.visible !== undefined) copy.visible = from.visible;
    return copy;
  }

  function copyNode(from: FakeNode): FakeNode {
    if (from.type === "TEXT") return copyLook(from, copyText(from));
    if (from.type === "INSTANCE") {
      const shell = instanceShell(from.main);
      shell.propValues = { ...from.propValues };
      return copyLook(from, copyBody(from, shell));
    }
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
    n.propValues = {};
    /** The layers under the instance that reference `name`, nested instances' included. */
    const referencing = (field: string, name: string): FakeNode[] => {
      const out: FakeNode[] = [];
      const stack = [...(n.kids as FakeNode[])];
      while (stack.length > 0) {
        const kid = stack.pop() as FakeNode;
        if (kid.propRefs?.[field] === name) out.push(kid);
        stack.push(...(kid.kids ?? []));
      }
      return out;
    };
    const show = (name: string, type: string, value: PropertyValue) => {
      if (type === "TEXT") for (const t of referencing("characters", name)) t.characters = value;
      if (type === "BOOLEAN") for (const l of referencing("visible", name)) l.visible = value;
      if (type === "INSTANCE_SWAP") {
        const next = nodes.get(value as string);
        if (next?.type !== "COMPONENT") throw new Error("INSTANCE_SWAP needs a component id");
        for (const l of referencing("mainComponent", name)) l.swapComponent(next);
      }
    };
    Object.defineProperty(n, "componentProperties", {
      get() {
        const owner = ownerOf(n.main);
        const out: Record<string, { type: string; value: PropertyValue }> = {};
        if (owner.type === "COMPONENT_SET") {
          for (const [key, value] of Object.entries(variantValues(n.main.name))) {
            out[key] = { type: "VARIANT", value };
          }
        }
        for (const [name, def] of owner.propDefs as Map<string, PropertyDef>) {
          out[name] = { type: def.type, value: n.propValues[name] ?? def.defaultValue };
        }
        return out;
      },
    });
    n.setProperties = (values: Record<string, string | boolean>) => {
      calls.push("setProperties");
      const owner = ownerOf(n.main);
      const defs = owner.propDefs as Map<string, PropertyDef>;
      const variant = { ...(owner.type === "COMPONENT_SET" ? variantValues(n.main.name) : {}) };
      for (const [name, value] of Object.entries(values)) {
        const def = defs.get(name);
        if (name in variant) variant[name] = value as string;
        else if (!def) throw new Error(`Could not find a component property with name: '${name}'`);
        else if (def.type === "BOOLEAN" ? typeof value !== "boolean" : typeof value !== "string") {
          throw new Error(`${name} takes a ${def.type} value`);
        }
      }
      if (owner.type === "COMPONENT_SET") {
        const same = (kid: FakeNode) =>
          JSON.stringify(variantValues(kid.name)) === JSON.stringify(variant);
        const next = (owner.kids as FakeNode[]).find(same);
        if (!next) throw new Error("no variant with those values");
        if (next !== n.main) {
          n.main = next;
          copyBody(next, n);
          for (const [name, value] of Object.entries(n.propValues)) {
            show(name, (defs.get(name) as PropertyDef).type, value as PropertyValue);
          }
        }
      }
      for (const [name, value] of Object.entries(values)) {
        const def = defs.get(name);
        if (!def) continue;
        show(name, def.type, value);
        n.propValues[name] = value;
      }
    };
    return n;
  }

  const figma = {
    get currentPage() {
      return current;
    },
    async setCurrentPageAsync(next: FakeNode) {
      calls.push(`setCurrentPage:${next.name}`);
      await held("setCurrentPageAsync");
      current = next;
    },
    viewport: {
      scrollAndZoomIntoView(n: FakeNode[]) {
        calls.push("scrollAndZoomIntoView");
        if (opts.viewportThrows) throw new Error("page switched");
        (figma as any).zoomed = n;
      },
    },
    root: {
      get children() {
        return [...pages];
      },
    },
    createPage() {
      calls.push("createPage");
      return newPage();
    },
    clientStorage: {
      async getAsync(key: string) {
        return storage.get(key);
      },
      async setAsync(key: string, value: unknown) {
        calls.push(`clientStorage.set:${key}`);
        storage.set(key, value);
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
      if (opts.combineThrows) throw new Error("combineAsVariants refused");
      for (const v of variants) checkVariantName(v.name);
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

  /**
   * The mode a node reads for a collection, as Figma resolves it: its own explicit mode; for an
   * instance with none, the explicit mode its main has (Figma help, "Modes for variables"); else
   * its parent's.
   */
  function modeOf(node: FakeNode | null | undefined, collectionId: string): string | undefined {
    for (let n = node; n; n = n.parent) {
      const own = n.explicitModes?.[collectionId];
      if (own !== undefined) return own;
      const main = n.type === "INSTANCE" ? n.main?.explicitModes?.[collectionId] : undefined;
      if (main !== undefined) return main;
    }
    return undefined;
  }

  return {
    figma: figma as unknown as PluginAPI,
    calls,
    modeOf,
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
    pages,
    /** Holds every call of `name` (`page.loadAsync`, `setCurrentPageAsync`) until `hold` ends it. */
    hold(name: string, hold: ((done: () => void) => void) | null) {
      if (hold) holds.set(name, hold);
      else holds.delete(name);
    },
    storage,
    tokens,
    raw_createText: () => figma.createText() as FakeNode,
  };
}
