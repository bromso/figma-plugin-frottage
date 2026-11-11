import type { CaptureComponent } from "@repo/capture-schema";
import {
  bareTag,
  buildForest,
  type Component,
  definition,
  flatten,
  type HoverNotes,
  hugged,
  INNER,
  ownLook,
  placement,
  rootSize,
  type Tree,
} from "./components";
import type { HoverPatch } from "./hover";
import type { PlanComponentProperty, PlanOp, PlanPropertyValues } from "./plan";

/** A component the page's code or a shadcn marker named, as the capture holds it. */
export type FoundComponent = CaptureComponent;

export type VariantSet = { name: string; variants: number; properties: string[] };

type FrameOp = Extract<PlanOp, { op: "frame" }>;
type SvgOp = Extract<PlanOp, { op: "svg" }>;

/**
 * Fields a variant's look leaves out wherever they sit: token keys follow the value beside them, and
 * a token bound per Breakpoint is the same look on another device.
 */
const TOKENS = new Set([
  ...INNER,
  "spacingKeys",
  "radiusKeys",
  "effectStyleKey",
  "gradientStyleKey",
  "textKey",
]);

/** Looks of nodes below an occurrence's root, for one set: its children's sets are settled. */
type Looks = { intern: (text: string) => number; inner: Map<Tree, number> };

function newLooks(): Looks {
  const interned = new Map<string, number>();
  const intern = (text: string): number => {
    let n = interned.get(text);
    if (n === undefined) {
      n = interned.size + 1;
      interned.set(text, n);
    }
    return n;
  };
  return { intern, inner: new Map() };
}

/** What a child adds to its parent's look: an occurrence of a set reads as that set, any variant. */
function childLook(child: Tree, parent: Tree, looks: Looks): string {
  if (child.component) return `${placement(child, parent)}${bareTag(child.component.tag, child)}`;
  return `${placement(child, parent)}${innerLook(child, looks)}`;
}

/** Sizes an instance lays out again: what the layer hugs, and what fills its parent. */
function follows(op: PlanOp): string[] {
  const { sizingH, sizingV } = op.childLayout ?? {};
  return [
    ...hugged(op),
    ...(sizingH === "FILL" ? ["w"] : []),
    ...(sizingV === "FILL" ? ["h"] : []),
  ];
}

/** As the structural signature, without text, image hashes or token keys; iterative, for depth. */
function innerLook(top: Tree, looks: Looks): number {
  const order: Tree[] = [];
  const stack = [top];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (looks.inner.has(node)) continue;
    order.push(node);
    for (const child of node.children) if (!child.component) stack.push(child);
  }
  // Backwards, every child comes before its parent.
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i] as Tree;
    const below = node.children.map((c) => childLook(c, node, looks)).join(",");
    looks.inner.set(node, looks.intern(`${ownLook(node.op, follows(node.op), TOKENS)}|${below}`));
  }
  return looks.inner.get(top) as number;
}

/** The root's svg child, the button's icon. */
const iconOf = (node: Tree): Tree | undefined => node.children.find((c) => c.op.op === "svg");

/**
 * An occurrence's look. Its icon's markup is a property, so it never counts; `bare` leaves the icon
 * out altogether, for an occurrence that has none. An instance can take any size its main's auto
 * layout allows, so only `sized` compares that.
 */
function rootLook(node: Tree, looks: Looks, bare: boolean, sized = false): string {
  const icon = iconOf(node);
  const below = node.children.flatMap((c) => {
    if (c !== icon) return [childLook(c, node, looks)];
    if (bare) return [];
    return [`${placement(c, node)}${ownLook(c.op, ["markup"], TOKENS)}`];
  });
  // The children say how many there are, the icon or not.
  const skip = [...(sized ? hugged(node.op) : rootSize(node)), "childCount"];
  return `${ownLook(node.op, skip, TOKENS)}|${below.join(",")}`;
}

/** The first text below the root, down its own layers only, with its path. */
function labelOf(root: Tree): { path: number[]; text: string } | undefined {
  const stack = [{ node: root, path: [] as number[] }];
  for (let at = stack.pop(); at; at = stack.pop()) {
    const { node, path } = at;
    if (node.op.op === "text") return { path, text: node.op.text };
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i] as Tree;
      if (!child.component) stack.push({ node: child, path: [...path, i] });
    }
  }
  return undefined;
}

const capital = (key: string) => `${key.charAt(0).toUpperCase()}${key.slice(1)}`;

/** An icon's name from its markup: `data-icon`, `aria-label`, then a class that reads as a name. */
function iconName(markup: string, n: number): string {
  const open = markup.match(/^\s*<svg\b[^>]*>/i)?.[0] ?? "";
  const attribute = (name: string) =>
    open.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1]?.trim();
  const classes = attribute("class")?.split(/\s+/) ?? [];
  const named = classes.find((c) => /^[a-z]+(-[a-z]+)+$/i.test(c));
  return (attribute("data-icon") || attribute("aria-label") || named || `Icon ${n}`).slice(0, 40);
}

/** One icon component per distinct markup, numbered in the order they are met. */
class Icons {
  readonly components: Component[] = [];
  readonly ops: PlanOp[] = [];
  private byMarkup = new Map<string, Component>();

  of(svg: SvgOp): Component {
    const known = this.byMarkup.get(svg.markup);
    if (known) return known;
    const n = this.components.length + 1;
    const key = `icon:${n}`;
    const name = iconName(svg.markup, n);
    const root: FrameOp = {
      op: "frame",
      id: key,
      parent: null,
      name,
      x: 0,
      y: 0,
      w: svg.w,
      h: svg.h,
      fills: [],
      strokes: null,
      radius: [0, 0, 0, 0],
      opacity: 1,
      effects: [],
      clips: false,
      layout: { mode: "NONE" },
      childCount: 1,
      component: { key, name },
    };
    const { childLayout: _placedByInstances, ...own } = svg;
    this.ops.push(root, { ...own, id: `${key}/${svg.id}`, parent: key, x: 0, y: 0 });
    const tree: Tree = {
      op: root,
      parent: null,
      children: [],
      height: 1,
      rotated: false,
      signature: 0,
    };
    const component: Component = { key, name, tag: "icon", occurrences: [tree] };
    tree.component = component;
    this.byMarkup.set(svg.markup, component);
    this.components.push(component);
    return component;
  }
}

type Built = { variants: Component[]; properties: string[]; notJoined: number };

/**
 * One name's set: a variant per combination of the props that change the look, each built from its
 * first occurrence, or from its first with an icon when only some have one. Occurrences that look
 * different from their variant stay as they are and are counted.
 */
function buildSet(
  name: string,
  occurrences: Tree[],
  named: Map<string, FoundComponent>,
  icons: Icons
): Built {
  const looks = newLooks();
  const bare = new Map<Tree, string>();
  const bareOf = (node: Tree): string => {
    let look = bare.get(node);
    if (look === undefined) {
      look = rootLook(node, looks, true);
      bare.set(node, look);
    }
    return look;
  };
  const found = (node: Tree) => named.get(node.op.id) as FoundComponent;
  // Static markup with only a data-slot says nothing of its props: it joins by its look alone.
  const propless = (node: Tree) =>
    found(node).source === "marker" && Object.keys(found(node).props).length === 0;
  const someCoded = occurrences.some((n) => !propless(n));
  const coded = someCoded ? occurrences.filter((n) => !propless(n)) : occurrences;
  const late = someCoded ? occurrences.filter(propless) : [];

  const keys: string[] = [];
  const booleans = new Set<string>();
  for (const node of coded) {
    for (const [key, value] of Object.entries(found(node).props)) {
      if (!keys.includes(key)) keys.push(key);
      if (typeof value === "boolean") booleans.add(key);
    }
  }
  // A prop the code leaves out takes its default: `false` for a flag.
  const propValue = (node: Tree, key: string): string => {
    const value = found(node).props[key];
    if (value !== undefined) return String(value);
    return booleans.has(key) ? "false" : "default";
  };
  const combination = (node: Tree, of: string[]) =>
    JSON.stringify(of.map((k) => propValue(node, k)));

  // A prop that is the same everywhere, or that changes nothing in the look, is no property. A
  // fixed size is part of the look here: an icon button is a smaller one.
  const sized = new Map<Tree, string>();
  const sizedOf = (node: Tree): string => {
    let look = sized.get(node);
    if (look === undefined) {
      look = rootLook(node, looks, true, true);
      sized.set(node, look);
    }
    return look;
  };
  let kept = keys;
  for (const key of keys) {
    const rest = kept.filter((k) => k !== key);
    const firsts = new Map<string, Tree>();
    for (const node of coded) {
      const c = combination(node, kept);
      if (!firsts.has(c)) firsts.set(c, node);
    }
    const seen = new Map<string, string>();
    let matters = false;
    for (const first of firsts.values()) {
      const reduced = combination(first, rest);
      const before = seen.get(reduced);
      if (before === undefined) seen.set(reduced, sizedOf(first));
      else if (before !== sizedOf(first)) matters = true;
    }
    if (!matters) kept = rest;
  }

  let notJoined = 0;
  const groups = new Map<string, Tree[]>();
  for (const node of coded) {
    const c = combination(node, kept);
    const members = groups.get(c);
    if (!members) groups.set(c, [node]);
    else if (bareOf(members[0] as Tree) === bareOf(node)) members.push(node);
    else notJoined++;
  }
  for (const node of late) {
    const members = [...groups.values()].find((m) => bareOf(m[0] as Tree) === bareOf(node));
    if (members) members.push(node);
    else notJoined++;
  }

  // Each variant's main, and who joins it: with an icon, the same icon place as the main's.
  const variants: { members: Tree[]; values: [string, string][] }[] = [];
  for (const members of groups.values()) {
    const main = members.find((m) => iconOf(m)) ?? (members[0] as Tree);
    const full = rootLook(main, looks, false);
    const joined = [main];
    for (const node of members) {
      if (node === main) continue;
      if (!iconOf(node) || rootLook(node, looks, false) === full) joined.push(node);
      else notJoined++;
    }
    const values = kept.map((k): [string, string] => [capital(k), propValue(main, k)]);
    variants.push({ members: joined, values });
  }

  const all = variants.flatMap((v) => v.members);
  const labels = new Set(all.flatMap((n) => labelOf(n)?.text ?? []));
  const markups = new Set(all.flatMap((n) => (iconOf(n)?.op as SvgOp | undefined)?.markup ?? []));
  const swaps = markups.size > 1;

  const built: Component[] = [];
  for (const { members, values } of variants) {
    const main = members[0] as Tree;
    const variantName = values.map(([k, v]) => `${k}=${v}`).join(", ") || "Default";
    const icon = iconOf(main);
    const iconAt = icon ? main.children.indexOf(icon) : -1;
    const showIcon = icon !== undefined && members.some((m) => !iconOf(m));
    const label = labels.size > 1 ? labelOf(main) : undefined;
    const iconComponent = swaps && icon ? icons.of(icon.op as SvgOp) : undefined;
    const properties: PlanComponentProperty[] = [];
    if (label)
      properties.push({ type: "TEXT", name: "Label", path: label.path, default: label.text });
    if (showIcon)
      properties.push({ type: "BOOLEAN", name: "Show icon", path: [iconAt], default: true });
    if (iconComponent) {
      const key = iconComponent.key;
      properties.push({ type: "INSTANCE_SWAP", name: "Icon", path: [iconAt], default: key });
    }
    const component: Component = {
      key: `set:${name}|${variantName}`,
      name: variantName,
      tag: `set:${name}`,
      occurrences: members,
      set: { key: `set:${name}`, name, values },
      properties,
      ...(label ? { label: label.path } : {}),
      ...(icon ? { iconAt } : {}),
    };
    for (const node of members) {
      node.component = component;
      const own = iconOf(node);
      if (icon && !own) node.iconless = true;
      const values: PlanPropertyValues = {};
      if (label) values.Label = labelOf(node)?.text ?? "";
      if (showIcon) values["Show icon"] = own !== undefined;
      if (iconComponent && own) values.Icon = icons.of(own.op as SvgOp).key;
      if (Object.keys(values).length > 0) node.properties = values;
    }
    // The main shows its icon as an instance, which an instance's Icon swaps.
    if (icon && iconComponent) icon.component = iconComponent;
    built.push(component);
  }
  return { variants: built, properties: kept.map(capital), notJoined };
}

/** The sets each definition's main holds instances of, so it can come after them. */
function usedBy(component: Component): Component[] {
  const used: Component[] = [];
  const main = component.occurrences[0] as Tree;
  const stack = [...main.children];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.component) used.push(node.component);
    else stack.push(...node.children);
  }
  return used;
}

/**
 * Makes a component set of every component the page's code or markers name at least twice in
 * `ops`: one variant per combination of props seen, its definition at the front, inner-first, and
 * each occurrence that looks like its variant an instance of it with its `Label`, `Show icon` and
 * `Icon` values. `named` maps a node id to the component it is the root of. What is left goes on to
 * `extractComponents`.
 */
export function extractVariantSets(
  ops: PlanOp[],
  named: Map<string, FoundComponent>,
  hovers: Map<string, HoverPatch> = new Map(),
  /** Name each instance text's captured id, for a capture with a language. */
  sources = false
): {
  ops: PlanOp[];
  sets: VariantSet[];
  fromMarkers: number;
  renamed: { from: string; to: string }[];
  notJoined: Map<string, number>;
  hoverCapped?: number;
  hoverSwapped?: number;
} {
  const none = { ops, sets: [], fromMarkers: 0, renamed: [], notJoined: new Map() };
  if (named.size === 0) return none;
  const nodes = buildForest(ops);
  const byName = new Map<string, Tree[]>();
  for (const node of nodes) {
    const found = named.get(node.op.id);
    if (!found || node.op.op !== "frame" || !node.parent || node.rotated) continue;
    const occurrences = byName.get(found.name);
    if (occurrences) occurrences.push(node);
    else byName.set(found.name, [node]);
  }
  // Inner names first, so an outer one's look reads them as their sets.
  const qualifying = [...byName]
    .filter(([, occurrences]) => occurrences.length >= 2)
    .map(([name, occurrences]) => ({
      name,
      occurrences,
      height: Math.max(...occurrences.map((n) => n.height)),
    }))
    .sort((a, b) => a.height - b.height);
  if (qualifying.length === 0) return none;

  const icons = new Icons();
  const variants: Component[] = [];
  const sets: (VariantSet & { first: Tree })[] = [];
  const notJoined = new Map<string, number>();
  const renamed = new Map<string, { from: string; to: string }>();
  let fromMarkers = 0;
  for (const { name, occurrences } of qualifying) {
    const built = buildSet(name, occurrences, named, icons);
    variants.push(...built.variants);
    const first = occurrences[0] as Tree;
    sets.push({ name, variants: built.variants.length, properties: built.properties, first });
    if (built.notJoined > 0) notJoined.set(name, built.notJoined);
    const found = occurrences.map((n) => named.get(n.op.id) as FoundComponent);
    if (found.every((f) => f.source === "marker" || f.codeName)) fromMarkers++;
    for (const { codeName } of found) {
      if (codeName) renamed.set(`${codeName}\0${name}`, { from: codeName, to: name });
    }
  }

  // Every main after the mains it holds instances of.
  const ordered: Component[] = [];
  const visited = new Set<Component>();
  const visit = (component: Component) => {
    if (visited.has(component)) return;
    visited.add(component);
    for (const used of usedBy(component)) if (used.set) visit(used);
    ordered.push(component);
  };
  for (const component of variants) visit(component);

  const notes: HoverNotes = { capped: 0, swapped: 0 };
  const definitions = ordered.flatMap((c) => definition(c, hovers, notes, sources));
  const page = nodes
    .filter((n) => n.parent === null)
    .flatMap((r) => flatten(r, (id) => id, sources));
  const order = new Map(nodes.map((n, i) => [n, i]));
  sets.sort((a, b) => (order.get(a.first) ?? 0) - (order.get(b.first) ?? 0));
  return {
    ops: [...icons.ops, ...definitions, ...page],
    sets: sets.map(({ first: _, ...set }) => set),
    fromMarkers,
    renamed: [...renamed.values()],
    notJoined,
    ...(notes.capped > 0 ? { hoverCapped: notes.capped } : {}),
    ...(notes.swapped > 0 ? { hoverSwapped: notes.swapped } : {}),
  };
}
