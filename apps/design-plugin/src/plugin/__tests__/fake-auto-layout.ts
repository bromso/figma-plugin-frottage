import type { FakeNode } from "./fake-figma";

/**
 * The auto layout part of the fake: a small model of how Figma places children, and the rules it
 * throws on. It is honest enough for verification to mean something: padding, spacing, HUG, FILL,
 * alignment, wrapping and grid tracks all change what a frame's children read back as.
 */

export type LayoutOptions = {
  /** Every child after the first lands this many px further along the axis than it should. */
  shiftChild?: number;
  /** `resize` leaves sizing alone, so nothing can lean on that side effect. */
  resizeKeepsSizing?: boolean;
};

type Axis = "H" | "V";

const isAuto = (n: FakeNode | undefined) =>
  n?.layoutMode === "HORIZONTAL" || n?.layoutMode === "VERTICAL";
const isGrid = (n: FakeNode | undefined) => n?.layoutMode === "GRID";
const isLaidOut = (n: FakeNode | undefined) => isAuto(n) || isGrid(n);
const inFlow = (n: FakeNode) => n.layoutPositioning !== "ABSOLUTE";

/** Text sits on its baseline; anything else, having none, on its bottom edge. */
const baselineOf = (c: FakeNode): number => (c.type === "TEXT" ? c.height * 0.8 : c.height);

export function layoutModel(opts: LayoutOptions = {}) {
  const busy = new Set<FakeNode>();
  const dirty = new Set<FakeNode>();

  /** Lays a frame out again, and its parent if that changed the frame's size. */
  function reflow(frame: FakeNode) {
    if (!isLaidOut(frame)) return;
    if (busy.has(frame)) {
      dirty.add(frame);
      return;
    }
    const { width, height } = frame;
    busy.add(frame);
    for (let pass = 0; pass < 8; pass++) {
      dirty.delete(frame);
      if (isGrid(frame)) placeGrid(frame);
      else placeFlow(frame);
      if (!dirty.has(frame)) break;
    }
    busy.delete(frame);
    if ((frame.width !== width || frame.height !== height) && isLaidOut(frame.parent)) {
      reflow(frame.parent);
    }
  }

  function setSize(n: FakeNode, width: number, height: number) {
    if (n.width === width && n.height === height) return;
    n.width = width;
    n.height = height;
    n.remeasure?.();
    reflow(n);
  }

  function placeFlow(f: FakeNode) {
    const horizontal = f.layoutMode === "HORIZONTAL";
    const [pos, crossPos] = horizontal ? (["x", "y"] as const) : (["y", "x"] as const);
    const [size, crossSize] = horizontal
      ? (["width", "height"] as const)
      : (["height", "width"] as const);
    const mainHug = (horizontal ? f.layoutSizingHorizontal : f.layoutSizingVertical) === "HUG";
    const crossHug = (horizontal ? f.layoutSizingVertical : f.layoutSizingHorizontal) === "HUG";
    const fillsMain = (c: FakeNode) =>
      (horizontal ? c.layoutSizingHorizontal : c.layoutSizingVertical) === "FILL";
    const fillsCross = (c: FakeNode) =>
      (horizontal ? c.layoutSizingVertical : c.layoutSizingHorizontal) === "FILL";
    const [padStart, padEnd] = horizontal
      ? [f.paddingLeft, f.paddingRight]
      : [f.paddingTop, f.paddingBottom];
    const [crossPadStart, crossPadEnd] = horizontal
      ? [f.paddingTop, f.paddingBottom]
      : [f.paddingLeft, f.paddingRight];
    const resizeChild = (c: FakeNode, main: number, cross: number) =>
      horizontal ? setSize(c, main, cross) : setSize(c, cross, main);

    const flow = f.children.filter(inFlow);
    const gap: number = f.itemSpacing;

    // FILL across first: wrapping text gets its height from the width it is given.
    if (!crossHug) {
      const room = f[crossSize] - crossPadStart - crossPadEnd;
      for (const c of flow) if (fillsCross(c)) resizeChild(c, c[size], room);
    }

    // Along the axis, FILL shares what is left.
    const room = f[size] - padStart - padEnd;
    const filling = mainHug ? [] : flow.filter(fillsMain);
    if (filling.length > 0) {
      const taken = flow.filter((c) => !filling.includes(c)).reduce((s, c) => s + c[size], 0);
      const share = Math.max(room - taken - gap * (flow.length - 1), 0) / filling.length;
      for (const c of filling) resizeChild(c, share, c[crossSize]);
    }

    const lines: FakeNode[][] = [];
    if (f.layoutWrap === "WRAP") {
      let line: FakeNode[] = [];
      let used = 0;
      for (const c of flow) {
        if (line.length > 0 && used + gap + c[size] > room) {
          lines.push(line);
          line = [];
          used = 0;
        }
        used += (line.length > 0 ? gap : 0) + c[size];
        line.push(c);
      }
      lines.push(line);
    } else {
      lines.push(flow);
    }

    const lineLength = (line: FakeNode[]) =>
      line.reduce((s, c) => s + c[size], 0) + gap * Math.max(line.length - 1, 0);
    const thickness = (line: FakeNode[]) =>
      Math.max(0, ...line.filter((c) => !crossHug || !fillsCross(c)).map((c) => c[crossSize]));
    const lineGap: number = f.layoutWrap === "WRAP" ? f.counterAxisSpacing : gap;
    const thick = lines.map(thickness);
    const content = thick.reduce((s, t) => s + t, 0) + lineGap * (lines.length - 1);

    const longest = Math.max(...lines.map(lineLength));
    const main = mainHug ? padStart + longest + padEnd : f[size];
    const cross = crossHug ? crossPadStart + content + crossPadEnd : f[crossSize];
    f[size] = Math.max(main, 0.01);
    f[crossSize] = Math.max(cross, 0.01);
    const free = main - padStart - padEnd;
    const crossFree = cross - crossPadStart - crossPadEnd;

    // With `counterAxisAlignContent` at AUTO, wrapped tracks are as thick as their largest child and
    // sit together, aligned by `counterAxisAlignItems`.
    const wraps = f.layoutWrap === "WRAP";
    const align = f.counterAxisAlignItems;
    let crossAt: number =
      crossPadStart +
      (wraps ? (crossFree - content) * (align === "CENTER" ? 0.5 : align === "MAX" ? 1 : 0) : 0);
    for (const [i, line] of lines.entries()) {
      const left = free - lineLength(line);
      const n = line.length;
      let at = padStart;
      let extra = 0;
      if (f.primaryAxisAlignItems === "CENTER") at += left / 2;
      if (f.primaryAxisAlignItems === "MAX") at += left;
      if (f.primaryAxisAlignItems === "SPACE_BETWEEN" && n > 1) extra = left / (n - 1);
      if (f.primaryAxisAlignItems === "SPACE_AROUND") {
        extra = left / n;
        at += extra / 2;
      }
      if (f.primaryAxisAlignItems === "SPACE_EVENLY") {
        extra = left / (n + 1);
        at += extra;
      }
      const band = wraps ? (thick[i] as number) : crossFree;
      const deepest = Math.max(...line.map(baselineOf));
      for (const [j, c] of line.entries()) {
        const spare = band - c[crossSize];
        const offset =
          align === "CENTER"
            ? spare / 2
            : align === "MAX"
              ? spare
              : align === "BASELINE"
                ? deepest - baselineOf(c)
                : 0;
        c.moveTo(pos, at + (j > 0 ? (opts.shiftChild ?? 0) : 0));
        c.moveTo(crossPos, crossAt + offset);
        at += c[size] + gap + extra;
      }
      crossAt += (thick[i] as number) + lineGap;
    }
  }

  function trackSizes(f: FakeNode, axis: Axis): number[] {
    const horizontal = axis === "H";
    const tracks: FakeNode[] = horizontal ? f.gridColumnSizes : f.gridRowSizes;
    const size = horizontal ? "width" : "height";
    const anchor = horizontal ? "gridColumnAnchorIndex" : "gridRowAnchorIndex";
    const hug = (i: number) =>
      Math.max(0, ...f.children.filter((c) => inFlow(c) && c[anchor] === i).map((c) => c[size]));
    const sizes = tracks.map((t, i) =>
      t.type === "FLEX" ? 0 : t.type === "HUG" ? hug(i) : t.value
    );
    const gap: number = horizontal ? f.gridColumnGap : f.gridRowGap;
    const room =
      (horizontal ? f.width - f.paddingLeft - f.paddingRight : f.height - f.paddingTop) -
      (horizontal ? 0 : f.paddingBottom) -
      gap * (tracks.length - 1) -
      sizes.reduce((s, n) => s + n, 0);
    const shares = tracks.reduce((s, t) => s + (t.type === "FLEX" ? t.value : 0), 0);
    return tracks.map((t, i) =>
      t.type === "FLEX" ? (Math.max(room, 0) * t.value) / shares : (sizes[i] as number)
    );
  }

  function placeGrid(f: FakeNode) {
    const columns = trackSizes(f, "H");
    const rows = trackSizes(f, "V");
    const starts = (tracks: number[], from: number, gap: number) => {
      let at = from;
      return tracks.map((size) => {
        const start = at;
        at += size + gap;
        return start;
      });
    };
    const xs = starts(columns, f.paddingLeft, f.gridColumnGap);
    const ys = starts(rows, f.paddingTop, f.gridRowGap);
    for (const c of f.children.filter(inFlow)) {
      const col = c.gridColumnAnchorIndex as number;
      const row = c.gridRowAnchorIndex as number;
      setSize(
        c,
        c.layoutSizingHorizontal === "FILL" ? (columns[col] as number) : c.width,
        c.layoutSizingVertical === "FILL" ? (rows[row] as number) : c.height
      );
      c.moveTo("x", xs[col] as number);
      c.moveTo("y", ys[row] as number);
    }
  }

  function makeTrack(frame: FakeNode, axis: Axis) {
    let type = "FLEX";
    let value = 1;
    const hugging = () =>
      (axis === "H" ? frame.layoutSizingHorizontal : frame.layoutSizingVertical) === "HUG";
    return {
      get type() {
        return type;
      },
      set type(v: string) {
        if (v === "FLEX" && hugging()) throw new Error("FLEX track in a HUG container");
        type = v;
        reflow(frame);
      },
      get value() {
        return value;
      },
      set value(v: number) {
        if (type === "HUG") throw new Error("a HUG track has no value");
        value = v;
        reflow(frame);
      },
    };
  }

  /** The node's first free cell in a grid, as `appendChild` picks it. */
  function freeCell(frame: FakeNode): [number, number] {
    for (let row = 0; row < frame.gridRowCount; row++) {
      for (let column = 0; column < frame.gridColumnCount; column++) {
        if (!occupied(frame, row, column)) return [row, column];
      }
    }
    throw new Error("no free cell in the grid");
  }

  const occupied = (frame: FakeNode, row: number, column: number) =>
    frame.children.some(
      (c) => inFlow(c) && c.gridRowAnchorIndex === row && c.gridColumnAnchorIndex === column
    );

  function checkCell(frame: FakeNode, row: number, column: number) {
    if (row < 0 || row >= frame.gridRowCount || column < 0 || column >= frame.gridColumnCount) {
      throw new Error(`cell ${row},${column} is out of the grid`);
    }
  }

  /** What every node has: its place in a parent. */
  function installChild(node: FakeNode) {
    const at = { x: 0, y: 0 };
    let positioning = "AUTO";
    let fillH = false;
    let fillV = false;
    let sizingH = "FIXED";
    let sizingV = "FIXED";

    const managed = () => isLaidOut(node.parent) && positioning === "AUTO";
    for (const key of ["x", "y"] as const) {
      Object.defineProperty(node, key, {
        configurable: true,
        get: () => at[key],
        // As in Figma, an auto layout parent keeps the child where it put it.
        set: (v: number) => {
          if (!managed()) at[key] = v;
        },
      });
    }
    node.moveTo = (key: "x" | "y", v: number) => {
      at[key] = v;
    };

    Object.defineProperty(node, "layoutPositioning", {
      configurable: true,
      get: () => positioning,
      set: (v: string) => {
        if (!isLaidOut(node.parent)) {
          throw new Error("layoutPositioning needs an auto layout parent");
        }
        positioning = v;
        reflow(node.parent);
      },
    });

    const applicable = () => isLaidOut(node) || isLaidOut(node.parent) || node.type === "TEXT";
    const sizingKey = (axis: Axis) => `layoutSizing${axis === "H" ? "Horizontal" : "Vertical"}`;
    const read = (axis: Axis) => {
      if (axis === "H" ? fillH : fillV) return "FILL";
      if (node.type !== "TEXT") return axis === "H" ? sizingH : sizingV;
      if (axis === "H") return node.textAutoResize === "WIDTH_AND_HEIGHT" ? "HUG" : "FIXED";
      return node.textAutoResize === "NONE" ? "FIXED" : "HUG";
    };
    const write = (axis: Axis, v: string) => {
      if (!applicable()) throw new Error(`${sizingKey(axis)} needs auto layout`);
      if (v === "FILL" && !isLaidOut(node.parent)) {
        throw new Error("FILL needs an auto layout parent");
      }
      if (v === "HUG" && !isAuto(node) && !isGrid(node) && node.type !== "TEXT") {
        throw new Error("HUG needs an auto layout frame or text");
      }
      if (v === "HUG" && isGrid(node)) {
        const tracks = axis === "H" ? node.gridColumnSizes : node.gridRowSizes;
        if (tracks.some((t: FakeNode) => t.type === "FLEX")) {
          throw new Error("FLEX track in a HUG container");
        }
      }
      if (v === "HUG" && isAuto(node) && String(node.primaryAxisAlignItems).startsWith("SPACE_")) {
        if ((node.layoutMode === "HORIZONTAL") === (axis === "H")) {
          throw new Error("SPACE_* needs a FIXED primary axis");
        }
      }
      if (axis === "H") fillH = v === "FILL";
      else fillV = v === "FILL";
      if (node.type !== "TEXT") {
        if (axis === "H") sizingH = v;
        else sizingV = v;
      } else if (axis === "H") {
        if (v === "HUG") node.textAutoResize = "WIDTH_AND_HEIGHT";
        else if (node.textAutoResize === "WIDTH_AND_HEIGHT") node.textAutoResize = "HEIGHT";
      } else if (v === "HUG" && node.textAutoResize === "NONE") {
        node.textAutoResize = "HEIGHT";
      } else if (v === "FIXED") {
        node.textAutoResize = "NONE";
      }
      reflow(node);
      if (isLaidOut(node.parent)) reflow(node.parent);
    };
    for (const axis of ["H", "V"] as const) {
      Object.defineProperty(node, sizingKey(axis), {
        configurable: true,
        get: () => read(axis),
        set: (v: string) => write(axis, v),
      });
    }

    node.layoutState = {
      /** What `resize` does to a node's sizing. */
      fix() {
        if (opts.resizeKeepsSizing) return;
        fillH = false;
        fillV = false;
        sizingH = "FIXED";
        sizingV = "FIXED";
      },
      /** A frame given auto layout hugs along its axis until told otherwise. */
      adopt(mode: string) {
        sizingH = mode === "HORIZONTAL" ? "HUG" : "FIXED";
        sizingV = mode === "VERTICAL" ? "HUG" : "FIXED";
      },
      /** A frame that lost its layout has nothing to hug. FILL is its parent's matter. */
      dropHug() {
        if (sizingH === "HUG") sizingH = "FIXED";
        if (sizingV === "HUG") sizingV = "FIXED";
      },
      /** The child of a frame that lost its layout: it stays where it was, at the size it had. */
      release() {
        if (fillH) sizingH = "FIXED";
        if (fillV) sizingV = "FIXED";
        fillH = false;
        fillV = false;
        positioning = "AUTO";
      },
    };

    node.setGridChildPosition = (row: number, column: number) => {
      if (!isGrid(node.parent)) throw new Error("setGridChildPosition needs a grid parent");
      checkCell(node.parent, row, column);
      node.gridRowAnchorIndex = row;
      node.gridColumnAnchorIndex = column;
      reflow(node.parent);
    };
  }

  /** What only frames have: the layout of their children. */
  function installFrame(node: FakeNode, onLayoutMode: () => void) {
    let mode = "NONE";
    const values: Record<string, unknown> = {
      layoutWrap: "NO_WRAP",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
      itemSpacing: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      gridRowGap: 0,
      gridColumnGap: 0,
    };
    node.strokesIncludedInLayout = false;
    node.gridRowSizes = [];
    node.gridColumnSizes = [];

    const primaryHugs = () =>
      (mode === "HORIZONTAL" ? node.layoutSizingHorizontal : node.layoutSizingVertical) === "HUG";

    const check: Record<string, (v: any) => void> = {
      layoutWrap(v) {
        if (v === "WRAP" && mode !== "HORIZONTAL") throw new Error("only HORIZONTAL frames wrap");
      },
      primaryAxisAlignItems(v) {
        if (String(v).startsWith("SPACE_") && primaryHugs()) {
          throw new Error("SPACE_* needs a FIXED primary axis");
        }
      },
      counterAxisAlignItems(v) {
        if (v === "BASELINE" && mode !== "HORIZONTAL") {
          throw new Error("BASELINE needs a HORIZONTAL frame");
        }
      },
    };
    // Set to null it syncs with itemSpacing, and it never reads null.
    let lineSpacing: number | null = null;
    Object.defineProperty(node, "counterAxisSpacing", {
      configurable: true,
      get: () => lineSpacing ?? values.itemSpacing,
      set: (v: number | null) => {
        if (values.layoutWrap !== "WRAP") throw new Error("counterAxisSpacing needs WRAP");
        if (v !== null && !(v > 0)) throw new Error("counterAxisSpacing must be positive or null");
        lineSpacing = v;
        reflow(node);
      },
    });
    // The older pair of properties, each naming an axis relative to the frame's direction.
    const axisMode = (primary: boolean) => ({
      configurable: true,
      get: () => (node[axisSizing(primary)] === "HUG" ? "AUTO" : "FIXED"),
      set: (v: string) => {
        if (!isAuto(node)) throw new Error("axis sizing modes need HORIZONTAL or VERTICAL");
        node[axisSizing(primary)] = v === "AUTO" ? "HUG" : "FIXED";
      },
    });
    const axisSizing = (primary: boolean) =>
      primary === (mode === "HORIZONTAL") ? "layoutSizingHorizontal" : "layoutSizingVertical";
    Object.defineProperty(node, "primaryAxisSizingMode", axisMode(true));
    Object.defineProperty(node, "counterAxisSizingMode", axisMode(false));
    for (const key of Object.keys(values)) {
      Object.defineProperty(node, key, {
        configurable: true,
        get: () => values[key],
        set: (v: unknown) => {
          check[key]?.(v);
          values[key] = v;
          reflow(node);
        },
      });
    }

    Object.defineProperty(node, "layoutMode", {
      configurable: true,
      get: () => mode,
      set: (v: string) => {
        onLayoutMode();
        const was = mode;
        mode = v;
        if (v === "NONE") {
          node.layoutState.dropHug();
          for (const c of node.children) c.layoutState?.release();
          return;
        }
        if (was === "NONE") node.layoutState.adopt(v);
        if (v === "GRID") {
          node.gridRowCount = 1;
          node.gridColumnCount = 1;
        }
        reflow(node);
      },
    });

    const trackCount = (key: "gridRowSizes" | "gridColumnSizes", axis: Axis) => ({
      configurable: true,
      get: () => node[key].length,
      set: (n: number) => {
        if (mode !== "GRID") throw new Error("track counts need a GRID frame");
        const tracks: unknown[] = node[key];
        while (tracks.length < n) tracks.push(makeTrack(node, axis));
        tracks.length = n;
        reflow(node);
      },
    });
    Object.defineProperty(node, "gridRowCount", trackCount("gridRowSizes", "V"));
    Object.defineProperty(node, "gridColumnCount", trackCount("gridColumnSizes", "H"));
  }

  return { reflow, installChild, installFrame, freeCell, occupied, checkCell, isLaidOut, isGrid };
}
