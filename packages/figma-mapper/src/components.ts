import { type HoverPatch, inheritedRanges } from "./hover";
import type { PlanHoverPatch, PlanLayout, PlanOp, PlanOverride, PlanRun } from "./plan";

type Component = { key: string; name: string; tag: string; occurrences: Tree[] };

type Tree = {
  op: PlanOp;
  parent: Tree | null;
  children: Tree[];
  /** Levels below this node. Every member of a component has the same height. */
  height: number;
  /** Whether this node or anything under it is rotated. */
  rotated: boolean;
  /** Interned signature: what this node contributes to its parent's. */
  signature: number;
  /** Set on every occurrence, so that a node with this set is an instance. */
  component?: Component;
};

/**
 * Top-level op fields a look does not depend on. Anything else compares, including new fields.
 * A child's placement comes back in its parent's signature, by `placement`.
 */
const PLACEMENT = ["id", "parent", "name", "x", "y", "childLayout"];
const CONTENT: Partial<Record<PlanOp["op"], string[]>> = {
  text: ["text", "runs"], // the runs' looks are added back by `runLooks`
  image: ["hash"],
};
/**
 * Fields excluded wherever they sit in an op. Token keys follow the value beside them; a run's
 * range and link are content, which a text override carries.
 */
const INNER = new Set(["colorKey", "styleKey", "start", "end", "href"]);

const withoutInner = (key: string, value: unknown) => (INNER.has(key) ? undefined : value);

/** Runs that differ only by something excluded read as one run. */
function runLooks(runs: PlanRun[]): string[] {
  const looks = runs.map((r) => JSON.stringify(r, withoutInner));
  return looks.filter((look, i) => look !== looks[i - 1]);
}

/** Everything in the op that compares, leaving out `skip` as well. */
function ownLook(op: PlanOp, skip: string[] = []): string {
  const excluded = new Set([...PLACEMENT, ...(CONTENT[op.op] ?? []), ...skip]);
  if (op.op === "text" && !op.wrap) excluded.add("w");
  const kept = Object.entries(op).filter(([key]) => !excluded.has(key));
  const look = op.op === "text" ? [...kept, ["runs", runLooks(op.runs)]] : kept;
  return JSON.stringify(look, withoutInner);
}

type AutoLayout = Extract<PlanLayout, { sizingH: unknown }>;

const isAuto = (layout: PlanLayout): layout is AutoLayout =>
  layout.mode === "HORIZONTAL" || layout.mode === "VERTICAL";

/** Sizes that follow the content, at any depth: the instance hugs again, so they never compare. */
function hugged(op: PlanOp): string[] {
  if (op.op !== "frame" || !isAuto(op.layout)) return [];
  const { sizingH, sizingV } = op.layout;
  return [...(sizingH === "HUG" ? ["w"] : []), ...(sizingV === "HUG" ? ["h"] : [])];
}

/** What a definition's root leaves out. Without auto layout, a resize would not move its children. */
function rootSize({ op, children }: Tree): string[] {
  if (op.op !== "frame" || isAuto(op.layout)) return hugged(op);
  return children.length > 0 ? [] : ["w", "h"];
}

/** Positions come from subtracting page coordinates, so they carry rounding noise. */
const tenth = (n: number) => Math.round(n * 10) / 10;

/** The edge a label stays on as its text changes; other layers are placed by their left edge. */
function anchorX(op: PlanOp): number {
  if (op.op !== "text" || op.wrap) return op.x;
  if (op.align === "CENTER") return op.x + op.w / 2;
  return op.align === "RIGHT" ? op.x + op.w : op.x;
}

/** How a child sits in its parent. `x` and `y` count only where the parent's layout does not set them. */
function placement({ op }: Tree, parent: Tree): string {
  const free =
    (parent.op.op === "frame" && parent.op.layout.mode === "NONE") ||
    op.childLayout?.positioning === "ABSOLUTE";
  const at = free ? [tenth(anchorX(op)), tenth(op.y)] : [];
  return JSON.stringify([op.childLayout ?? null, ...at]);
}

/** What a repeated child adds: its tag, so it can be swapped, and any size an instance won't take on its own. */
function bareTag(tag: string, { op }: Tree): string {
  return op.op === "frame" && isAuto(op.layout) ? `tag:${tag}` : `tag:${tag}:${op.w}x${op.h}`;
}

function buildForest(ops: PlanOp[]): Tree[] {
  const byId = new Map<string, Tree>();
  const nodes: Tree[] = [];
  for (const op of ops) {
    const parent = op.parent === null ? null : (byId.get(op.parent) ?? null);
    const node: Tree = { op, parent, children: [], height: 0, rotated: false, signature: 0 };
    byId.set(op.id, node);
    parent?.children.push(node);
    nodes.push(node);
  }
  // Parents come before their children in `ops`, so backwards sees each child first.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i] as Tree;
    node.rotated ||= "rotation" in node.op && node.op.rotation !== undefined;
    if (!node.parent) continue;
    node.parent.height = Math.max(node.parent.height, node.height + 1);
    node.parent.rotated ||= node.rotated;
  }
  return nodes;
}

/** Marks every occurrence and returns the components, inner-first. */
function findComponents(nodes: Tree[], tags: Map<string, string>): Component[] {
  const interned = new Map<string, number>();
  const intern = (text: string): number => {
    let n = interned.get(text);
    if (n === undefined) {
      n = interned.size + 1;
      interned.set(text, n);
    }
    return n;
  };

  const levels: Tree[][] = [];
  for (const node of nodes) {
    const level = levels[node.height];
    if (level) level.push(node);
    else levels[node.height] = [node];
  }

  const found: Component[] = [];
  const perTag = new Map<string, number>();
  // One height at a time, inner first: everything below a node is settled when it is reached, and
  // no component can hold itself, however a child that reads as a bare tag hides what is under it.
  for (const level of levels) {
    const groups = new Map<string, Tree[]>();
    for (const node of level) {
      const below = node.children
        .map((c) => {
          const look = c.component ? bareTag(c.component.tag, c) : c.signature;
          return `${placement(c, node)}${look}`;
        })
        .join(",");
      node.signature = intern(`${ownLook(node.op, hugged(node.op))}|${below}`);
      const tag = tags.get(node.op.id);
      if (!tag?.includes("-") || node.op.op !== "frame" || !node.parent || node.rotated) continue;
      const group = `${tag}\0${ownLook(node.op, rootSize(node))}|${below}`;
      const members = groups.get(group);
      if (members) members.push(node);
      else groups.set(group, [node]);
    }
    for (const [group, occurrences] of groups) {
      if (occurrences.length < 2) continue;
      const tag = group.slice(0, group.indexOf("\0"));
      const n = (perTag.get(tag) ?? 0) + 1;
      perTag.set(tag, n);
      const component = { key: `${tag}#${n}`, name: `${tag} / ${n}`, tag, occurrences };
      for (const node of occurrences) node.component = component;
      found.push(component);
    }
  }
  for (const component of found) {
    if (perTag.get(component.tag) === 1) component.name = component.tag;
  }
  return found;
}

const childAt = (children: Tree[], i: number) => children[i] as Tree;

/** How `occurrence` differs from its component's first occurrence, parents before children. */
function overridesOf(occurrence: Tree): PlanOverride[] {
  const first = occurrence.component?.occurrences[0] as Tree;
  if (occurrence === first) return [];
  const overrides: PlanOverride[] = [];
  const stack = [{ base: first, node: occurrence, path: [] as number[], swapped: false }];
  for (let at = stack.pop(); at; at = stack.pop()) {
    const { node, path } = at;
    let { base, swapped } = at;
    if (node.component && base.component !== node.component) {
      overrides.push({ path, kind: "swap", key: node.component.key });
      base = node.component.occurrences[0] as Tree;
      // A swap may keep or drop what was set below it, so nothing there can be taken as read.
      swapped = true;
    }
    if (base.op.op === "text" && node.op.op === "text") {
      const { text, runs } = node.op;
      const same = text === base.op.text && JSON.stringify(runs) === JSON.stringify(base.op.runs);
      if (swapped || !same) overrides.push({ path, kind: "text", text, runs });
    } else if (base.op.op === "image" && node.op.op === "image") {
      const { hash } = node.op;
      if (swapped || hash !== base.op.hash) overrides.push({ path, kind: "image", hash });
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({
        base: childAt(base.children, i),
        node: childAt(node.children, i),
        path: [...path, i],
        swapped,
      });
    }
  }
  return overrides;
}

const isFixed = (layout: PlanLayout, axis: "sizingH" | "sizingV"): boolean =>
  isAuto(layout) ? layout[axis] === "FIXED" : true;

function instanceOp(node: Tree, id: string, parent: string): PlanOp {
  const component = node.component as Component;
  const first = (component.occurrences[0] as Tree).op;
  const { name, x, y, w, h, childLayout } = node.op;
  const layout = first.op === "frame" ? first.layout : { mode: "NONE" as const };
  return {
    op: "instance",
    id,
    parent,
    name,
    x,
    y,
    w,
    h,
    key: component.key,
    resize:
      (isFixed(layout, "sizingH") && w !== first.w) ||
      (isFixed(layout, "sizingV") && h !== first.h),
    overrides: overridesOf(node),
    ...(childLayout ? { childLayout } : {}),
  };
}

/** The ops of a subtree, in order, with a repeated element below `top` as one instance op. */
function flatten(top: Tree, rename: (id: string) => string): PlanOp[] {
  const out: PlanOp[] = [];
  const stack = [top];
  for (let node = stack.pop(); node; node = stack.pop()) {
    const { op } = node;
    const id = rename(op.id);
    const parent = op.parent === null ? null : rename(op.parent);
    if (node !== top && node.component) {
      out.push(instanceOp(node, id, parent as string));
      continue;
    }
    out.push({ ...op, id, parent } as PlanOp);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(childAt(node.children, i));
  }
  return out;
}

/** The most patches one component carries; a page with more is cut off there. */
export const MAX_HOVER_PATCHES = 200;

/**
 * A patch as the main takes it. Text can differ between occurrences, so its ranges are found again
 * in the main's. Null when that leaves nothing to change.
 */
function forMain(patch: HoverPatch, path: number[], base: Tree): PlanHoverPatch | null {
  const { resting, ...rest } = patch;
  if (!rest.textColor || base.op.op !== "text") return { path, ...rest };
  const { textColor, ranges: _theirs, ...others } = rest;
  const ranges = inheritedRanges(base.op.runs, textColor, resting);
  if (ranges.length > 0) return { path, ...others, textColor, ranges };
  return Object.keys(others).length > 0 ? { path, ...others } : null;
}

type OccurrenceHover = { patches: PlanHoverPatch[]; capped: boolean; swapped: number };

/**
 * The hover patches of one occurrence, by index down the expanded tree, parents first, walked
 * beside the main. At a nested swap the main holds another component, so nothing there carries over.
 */
function hoverOf(top: Tree, hovers: Map<string, HoverPatch>): OccurrenceHover {
  const first = top.component?.occurrences[0] as Tree;
  const out: OccurrenceHover = { patches: [], capped: false, swapped: 0 };
  const stack = [{ node: top, base: first, path: [] as number[] }];
  for (let at = stack.pop(); at; at = stack.pop()) {
    const { node, base, path } = at;
    if (node.component && base.component !== node.component) {
      out.swapped += hoversBelow(node, hovers);
      continue;
    }
    const hover = hovers.get(node.op.id);
    const patch = hover && forMain(hover, path, base);
    if (patch) {
      if (out.patches.length >= MAX_HOVER_PATCHES) return { ...out, capped: true };
      out.patches.push(patch);
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({
        node: childAt(node.children, i),
        base: childAt(base.children, i),
        path: [...path, i],
      });
    }
  }
  return out;
}

/** How many layers of a subtree change on hover. */
function hoversBelow(top: Tree, hovers: Map<string, HoverPatch>): number {
  let count = 0;
  const stack = [top];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (hovers.has(node.op.id)) count++;
    stack.push(...node.children);
  }
  return count;
}

type HoverNotes = { capped: number; swapped: number };

function definition(
  component: Component,
  hovers: Map<string, HoverPatch>,
  notes: HoverNotes
): PlanOp[] {
  const { key, name } = component;
  const first = component.occurrences[0] as Tree;
  const [root, ...rest] = flatten(first, (id) => `${key}/${id}`);
  const { childLayout: _placedByInstances, ...own } = root as Extract<PlanOp, { op: "frame" }>;
  let hover: PlanHoverPatch[] = [];
  if (hovers.size > 0) {
    // The first occurrence that changes on hover; the others share its structure.
    for (const occurrence of component.occurrences) {
      const found = hoverOf(occurrence, hovers);
      if (found.capped) notes.capped++;
      notes.swapped += found.swapped;
      if (found.patches.length > 0) {
        hover = found.patches;
        break;
      }
    }
  }
  const info = { key, name, ...(hover.length > 0 ? { hover } : {}) };
  return [{ ...own, parent: null, name, x: 0, y: 0, component: info }, ...rest];
}

/**
 * Every instance on the canvas. An instance inside a definition exists once in the main and once
 * in each copy of it, and `found` is inner-first, so going backwards each copy count is final.
 */
function canvasInstances(found: Component[], definitions: PlanOp[][], page: PlanOp[]): number {
  const copies = new Map(found.map((c) => [c.key, 1]));
  const count = (ops: PlanOp[], times: number): number => {
    let total = 0;
    for (const op of ops) {
      if (op.op !== "instance") continue;
      copies.set(op.key, (copies.get(op.key) ?? 1) + times);
      total += times;
    }
    return total;
  };
  let total = count(page, 1);
  for (let i = found.length - 1; i >= 0; i--) {
    const { key } = found[i] as Component;
    total += count(definitions[i] as PlanOp[], copies.get(key) ?? 1);
  }
  return total;
}

/**
 * Hoists repeated custom elements to definitions at the front of `ops`, inner-first, and turns each
 * occurrence, the first too, into an `instance` op. A component is one tag and one signature used
 * at least twice. `tags` maps a node id to its tag. `instances` counts them on the canvas, so it
 * can exceed the `instance` ops. `hovers` maps a node id to what `:hover` changes there; a
 * definition carries those of the first occurrence that has any.
 */
export function extractComponents(
  ops: PlanOp[],
  tags: Map<string, string>,
  hovers: Map<string, HoverPatch> = new Map()
): {
  ops: PlanOp[];
  components: number;
  instances: number;
  hoverCapped?: number;
  hoverSwapped?: number;
} {
  const nodes = buildForest(ops);
  const found = findComponents(nodes, tags);
  if (found.length === 0) return { ops, components: 0, instances: 0 };
  const roots = nodes.filter((n) => n.parent === null);
  const notes: HoverNotes = { capped: 0, swapped: 0 };
  const definitions = found.map((c) => definition(c, hovers, notes));
  const page = roots.flatMap((r) => flatten(r, (id) => id));
  return {
    ops: [...definitions.flat(), ...page],
    components: found.length,
    instances: canvasInstances(found, definitions, page),
    ...(notes.capped > 0 ? { hoverCapped: notes.capped } : {}),
    ...(notes.swapped > 0 ? { hoverSwapped: notes.swapped } : {}),
  };
}
