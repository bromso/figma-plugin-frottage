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
  resizes,
  rootSize,
  type Tree,
} from "./components";
import type { HoverPatch } from "./hover";
import type { PlanComponentProperty, PlanOp, PlanPaint, PlanPropertyValues } from "./plan";

/** A component the page's code or a shadcn marker named, as the capture holds it. */
export type FoundComponent = CaptureComponent;

export type VariantSet = {
  name: string;
  variants: number;
  properties: string[];
  /** Only shadcn markers named it, with no code behind them. */
  markers?: true;
};

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

/**
 * Looks of nodes below an occurrence's root, for one set: its children's sets are settled. `norm`
 * is what each op compares as.
 */
type Looks = {
  intern: (text: string) => number;
  inner: Map<Tree, number>;
  norm: (op: PlanOp) => PlanOp;
};

function newLooks(norm: (op: PlanOp) => PlanOp = (op) => op): Looks {
  const interned = new Map<string, number>();
  const intern = (text: string): number => {
    let n = interned.get(text);
    if (n === undefined) {
      n = interned.size + 1;
      interned.set(text, n);
    }
    return n;
  };
  return { intern, inner: new Map(), norm };
}

const BOUND = (key: string) => `bound:${key}`;

/**
 * An op with each value a token that switches by Breakpoint binds replaced by the token's key, for
 * comparing occurrences on two devices: such a token holds each device's value, so the same key is
 * the same look, and a plain value or another token's is not. Any other value compares as it is.
 * Keys are a merge's, so a text style joined across devices is one key.
 */
function bound(op: PlanOp, switches: (key: string) => boolean): PlanOp {
  const out: Record<string, unknown> = { ...op };
  const by = (key: string | undefined): key is string => key !== undefined && switches(key);
  const paint = (p: PlanPaint): unknown => {
    if (p.type === "SOLID" && by(p.colorKey)) return { ...p, color: BOUND(p.colorKey) };
    return p;
  };
  if ("fills" in op) out.fills = op.fills.map(paint);
  if ("strokes" in op && op.strokes && by(op.strokes.colorKey)) {
    out.strokes = { ...op.strokes, color: BOUND(op.strokes.colorKey) };
  }
  if ("radiusKeys" in op && op.radiusKeys) {
    const keys = op.radiusKeys;
    out.radius = op.radius.map((r, i) => (by(keys[i]) ? BOUND(keys[i]) : r));
  }
  if (op.op === "frame") {
    const { layout } = op;
    if (layout.mode !== "NONE" && layout.spacingKeys) {
      const keys = layout.spacingKeys;
      const next: Record<string, unknown> = {
        ...layout,
        padding: layout.padding.map((n, i) => {
          const key = keys.padding?.[i];
          return by(key) ? BOUND(key) : n;
        }),
      };
      for (const field of ["itemSpacing", "counterSpacing", "rowGap", "columnGap"] as const) {
        const key = keys[field];
        if (by(key) && field in layout) next[field] = BOUND(key);
      }
      out.layout = next;
    }
  }
  if (op.op === "text") {
    out.runs = op.runs.map((r) => ({
      ...r,
      ...(by(r.colorKey) ? { color: BOUND(r.colorKey) } : {}),
      ...(by(r.styleKey)
        ? {
            fontSize: BOUND(r.styleKey),
            lineHeight: BOUND(r.styleKey),
            letterSpacing: BOUND(r.styleKey),
          }
        : {}),
    }));
  }
  return out as PlanOp;
}

/** What a child adds to its parent's look: an occurrence of a set reads as that set, any variant. */
function childLook(child: Tree, parent: Tree, looks: Looks): string {
  if (child.component) return `${placement(child, parent)}${bareTag(child.component.tag, child)}`;
  return `${placement(child, parent)}${innerLook(child, looks)}`;
}

/**
 * Sizes an instance lays out again: what the layer hugs, what fills its parent, the height of a
 * text that hugs its lines, and the width of one that wraps in auto layout.
 */
function follows(op: PlanOp): string[] {
  const { sizingH, sizingV } = op.childLayout ?? {};
  return [
    ...hugged(op),
    ...(sizingH === "FILL" ? ["w"] : []),
    ...(sizingV === "FILL" ? ["h"] : []),
    ...(op.op === "text" && sizingV === "HUG" ? ["h", "lineCount"] : []),
    // Text that wraps in auto layout is as wide as its words; the instance wraps it again.
    ...(op.op === "text" && op.wrap && op.childLayout?.positioning === "AUTO" ? ["w"] : []),
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
    const skip = [...follows(node.op), ...(resizes(node) ? ["w", "h"] : [])];
    const own = ownLook(looks.norm(node.op), skip, TOKENS);
    looks.inner.set(node, looks.intern(`${own}|${below}`));
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
    // Nor does its size: an instance resizes it.
    return [`${placement(c, node)}${ownLook(looks.norm(c.op), ["markup", "w", "h"], TOKENS)}`];
  });
  // The children say how many there are, the icon or not.
  const skip = [...(sized ? hugged(node.op) : rootSize(node)), "childCount"];
  const op = sized ? node.op : resizable(node.op);
  return `${ownLook(looks.norm(op), skip, TOKENS)}|${below.join(",")}`;
}

/**
 * A root's size is an instance's to take: an axis it hugs, or one its parent fills, compares as the
 * same sizing, so a card its grid row stretches is its hugging variant. Its children follow by
 * their own FILL and HUG sizing. An axis fixed at the root's own size still compares.
 */
function resizable(op: PlanOp): PlanOp {
  if (op.op !== "frame" || (op.layout.mode !== "HORIZONTAL" && op.layout.mode !== "VERTICAL"))
    return op;
  const { layout, childLayout } = op;
  const follows = (sizing: string, parent: string | undefined) =>
    sizing === "HUG" || parent === "FILL" ? "FOLLOWS" : sizing;
  return {
    ...op,
    layout: {
      ...layout,
      sizingH: follows(layout.sizingH, childLayout?.sizingH),
      sizingV: follows(layout.sizingV, childLayout?.sizingV),
    },
  } as PlanOp;
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

/** Another key already reads as this one's property name (`size` and `Size`): the first stays. */
const collides = (keys: string[], key: string) =>
  keys.some((k) => k !== key && capital(k) === capital(key));

/** An icon's name from its markup: `data-icon`, `aria-label`, then a class that reads as a name. */
function iconName(markup: string, n: number): string {
  const open = markup.match(/^\s*<svg\b[^>]*>/i)?.[0] ?? "";
  const attribute = (name: string) =>
    open.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1]?.trim();
  const classes = attribute("class")?.split(/\s+/) ?? [];
  const named = classes.find((c) => /^[a-z]+(-[a-z]+)+$/i.test(c));
  return (attribute("data-icon") || attribute("aria-label") || named || `Icon ${n}`).slice(0, 40);
}

/**
 * An icon's markup without the svg root's own `width` and `height`: the same icon at another size
 * is the same icon, which an instance resizes.
 */
function iconMarkup(markup: string): string {
  return markup.replace(/^(\s*<svg\b)([^>]*)>/i, (_, open: string, attributes: string) => {
    const kept = attributes.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return `${open}${kept}>`;
  });
}

/** FNV-1a over the markup: the same icon has the same key on every device. */
function markupHash(markup: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < markup.length; i++) {
    h ^= markup.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** One icon component per distinct markup, keyed by its hash, named in the order they are met. */
class Icons {
  readonly components: Component[] = [];
  readonly ops: PlanOp[] = [];
  /** The entry each icon was first met in. */
  readonly owners: number[] = [];
  private byMarkup = new Map<string, Component>();

  of(svg: SvgOp, entry = 0): Component {
    const markup = iconMarkup(svg.markup);
    const known = this.byMarkup.get(markup);
    if (known) return known;
    const n = this.components.length + 1;
    const hash = markupHash(markup);
    // Two markups with one hash keep apart; on another device the pair may count the other way.
    const taken = this.components.some((c) => c.key === `icon:${hash}`);
    const key = taken ? `icon:${hash}-${n}` : `icon:${hash}`;
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
    this.byMarkup.set(markup, component);
    this.components.push(component);
    this.owners.push(entry);
    return component;
  }
}

/** One entry's occurrences of one name, with the looks they compare by in that entry. */
type Side = {
  entry: number;
  occurrences: Tree[];
  found: (node: Tree) => FoundComponent;
  looks: Looks;
  bareOf: (node: Tree) => string;
  /** With a fixed root size: an icon button is a smaller one. */
  sizedOf: (node: Tree) => string;
  /** Occurrences whose props the code gave, or all when none did. */
  coded: Tree[];
  /** Static markup with only a data-slot, which joins by its look alone. */
  late: Tree[];
};

function sideOf(entry: number, occurrences: Tree[], named: Map<string, FoundComponent>): Side {
  const looks = newLooks();
  const cache = (sized: boolean) => {
    const seen = new Map<Tree, string>();
    return (node: Tree): string => {
      let look = seen.get(node);
      if (look === undefined) {
        look = rootLook(node, looks, true, sized);
        seen.set(node, look);
      }
      return look;
    };
  };
  const found = (node: Tree) => named.get(node.op.id) as FoundComponent;
  // Static markup with only a data-slot says nothing of its props: it joins by its look alone.
  const propless = (node: Tree) =>
    found(node).source === "marker" && Object.keys(found(node).props).length === 0;
  const someCoded = occurrences.some((n) => !propless(n));
  return {
    entry,
    occurrences,
    found,
    looks,
    bareOf: cache(false),
    sizedOf: cache(true),
    coded: someCoded ? occurrences.filter((n) => !propless(n)) : occurrences,
    late: someCoded ? occurrences.filter(propless) : [],
  };
}

/** The props the coded occurrences set, in first-seen order, and which of them are flags. */
function propsOf(side: Side): { keys: string[]; booleans: Set<string> } {
  const keys: string[] = [];
  const booleans = new Set<string>();
  for (const node of side.coded) {
    for (const [key, value] of Object.entries(side.found(node).props)) {
      if (collides(keys, key)) continue;
      if (!keys.includes(key)) keys.push(key);
      if (typeof value === "boolean") booleans.add(key);
    }
  }
  return { keys, booleans };
}

/** A prop the code leaves out takes its default: `false` for a flag. */
const propValueIn =
  (side: Side, booleans: Set<string>) =>
  (node: Tree, key: string): string => {
    const value = side.found(node).props[key];
    if (value !== undefined) return String(value);
    return booleans.has(key) ? "false" : "default";
  };

/**
 * The props that are variant properties in one entry: a prop is one when its values differ and the
 * occurrences of one value look otherwise than those of another; one that every value shares a
 * look across (an index) is none. A fixed size is part of the look here.
 */
function keptIn(side: Side): string[] {
  const { keys, booleans } = propsOf(side);
  const propValue = propValueIn(side, booleans);
  const combination = (node: Tree, of: string[]) =>
    JSON.stringify(of.map((k) => propValue(node, k)));
  /** The looks of the occurrences, by their values of `of`. */
  const looksBy = (of: string[]): string[] => {
    const byValue = new Map<string, Set<string>>();
    for (const node of side.coded) {
      const value = combination(node, of);
      const seen = byValue.get(value) ?? new Set<string>();
      seen.add(side.sizedOf(node));
      byValue.set(value, seen);
    }
    return [...byValue.values()].map((seen) => JSON.stringify([...seen].sort()));
  };
  let kept = keys.filter((key) => new Set(looksBy([key])).size > 1);
  // A prop the others already decide the look by, and two of whose values look alike, only
  // numbers what the others tell apart (an index beside a variant): it goes. Props that change
  // the look together each tell their looks apart, so both stay.
  for (const key of [...kept]) {
    const others = kept.filter((k) => k !== key);
    const decided = looksBy(others).every((seen) => JSON.parse(seen).length === 1);
    const own = looksBy([key]);
    if (decided && new Set(own).size < own.length) kept = others;
  }
  return kept;
}

/** A name's variant properties and flags, decided once for every entry. */
type Axes = { kept: string[]; booleans: Set<string> };

/**
 * The axes over the entries that decide: a prop is kept when any of them keeps it, so every entry's
 * variant names and keys agree.
 */
function axesOf(sides: Side[], decides: (side: Side) => boolean): Axes {
  const keys: string[] = [];
  const kept = new Set<string>();
  const booleans = new Set<string>();
  for (const side of sides) {
    const own = propsOf(side);
    for (const key of own.booleans) booleans.add(key);
    if (!decides(side)) continue;
    for (const key of own.keys) if (!keys.includes(key) && !collides(keys, key)) keys.push(key);
    for (const key of keptIn(side)) kept.add(key);
  }
  return { kept: keys.filter((key) => kept.has(key)), booleans };
}

/** One entry's occurrences of one variant: its main, the ones that join it, and its values. */
type Part = { side: Side; main: Tree; members: Tree[]; values: [string, string][] };

/** An entry's variants against fixed axes; occurrences that look different are counted. */
function partsOf(side: Side, { kept, booleans }: Axes): { parts: Part[]; notJoined: number } {
  const propValue = propValueIn(side, booleans);
  const combination = (node: Tree) => JSON.stringify(kept.map((k) => propValue(node, k)));
  let notJoined = 0;
  const groups = new Map<string, Tree[]>();
  for (const node of side.coded) {
    const c = combination(node);
    const members = groups.get(c);
    if (!members) groups.set(c, [node]);
    else if (side.bareOf(members[0] as Tree) === side.bareOf(node)) members.push(node);
    else notJoined++;
  }
  for (const node of side.late) {
    // Nothing but the look ties it to a variant, so its size must match too.
    const members = [...groups.values()].find(
      (m) => side.sizedOf(m[0] as Tree) === side.sizedOf(node)
    );
    if (members) members.push(node);
    else notJoined++;
  }
  // Each variant's main, and who joins it: with an icon, the same icon place as the main's.
  const parts: Part[] = [];
  for (const members of groups.values()) {
    const main = members.find((m) => iconOf(m)) ?? (members[0] as Tree);
    const full = rootLook(main, side.looks, false);
    const joined = [main];
    for (const node of members) {
      if (node === main) continue;
      if (!iconOf(node) || rootLook(node, side.looks, false) === full) joined.push(node);
      else notJoined++;
    }
    const values = kept.map((k): [string, string] => [capital(k), propValue(main, k)]);
    parts.push({ side, main, members: joined, values });
  }
  return { parts, notJoined };
}

type Built = {
  variants: Component[];
  /** The entry each variant's main comes from. */
  owners: number[];
  properties: string[];
  notJoined: number;
};

/**
 * One name's set across entries, the first the widest: a variant per combination of the props that
 * change the look, its main from the first entry that has it, from its first occurrence there, or
 * from the first with an icon when only some have one. Another entry's occurrences of a variant are
 * instances of that main when they look like it, a token's Breakpoint value aside; occurrences
 * that look different from their variant stay as they are and are counted, in entries that decide.
 */
function buildSet(
  name: string,
  sides: Side[],
  decides: (side: Side) => boolean,
  icons: Icons,
  switches: (key: string) => boolean
): Built {
  const axes = axesOf(sides, decides);
  const { kept } = axes;
  let notJoined = 0;
  const byVariant = new Map<string, Part[]>();
  for (const side of sides) {
    const made = partsOf(side, axes);
    if (decides(side)) notJoined += made.notJoined;
    for (const part of made.parts) {
      const variantName = part.values.map(([k, v]) => `${k}=${v}`).join(", ");
      const parts = byVariant.get(variantName);
      if (parts) parts.push(part);
      else byVariant.set(variantName, [part]);
    }
  }

  // Each variant's main entry, and the others that look like it.
  const cross = newLooks((op) => bound(op, switches));
  const crossLook = (part: Part, bare: boolean) => rootLook(part.main, cross, bare);
  const variants: { name: string; parts: Part[] }[] = [];
  for (const [variantName, parts] of byVariant) {
    // The page's own language decides: a variant only another language shows is none, and the
    // main is a deciding entry's, with an icon when one has it.
    const deciding = parts.filter((p) => decides(p.side));
    const winner = deciding.find((p) => iconOf(p.main)) ?? deciding[0];
    if (!winner) continue;
    const joined = [winner];
    for (const part of parts) {
      if (part === winner) continue;
      // A main without the icon has no place for it.
      if (iconOf(part.main) && !iconOf(winner.main)) {
        if (decides(part.side)) notJoined += part.members.length;
        continue;
      }
      const bare = !iconOf(part.main) || !iconOf(winner.main);
      if (crossLook(part, bare) === crossLook(winner, bare)) joined.push(part);
      else if (decides(part.side)) notJoined += part.members.length;
    }
    variants.push({ name: variantName, parts: joined });
  }

  const membersOf = (parts: Part[]) => parts.flatMap((p) => p.members);
  const all = variants.flatMap((v) => membersOf(v.parts));
  const labels = new Set(
    variants.flatMap((v) =>
      membersOf(v.parts.filter((p) => decides(p.side))).flatMap((n) => labelOf(n)?.text ?? [])
    )
  );
  const markups = new Set(
    all.flatMap((n) => {
      const svg = iconOf(n)?.op as SvgOp | undefined;
      return svg ? [iconMarkup(svg.markup)] : [];
    })
  );
  const swaps = markups.size > 1;

  const built: Component[] = [];
  const owners: number[] = [];
  for (const { name: variantName, parts } of variants) {
    const winner = parts[0] as Part;
    const main = winner.main;
    const members = membersOf(parts);
    const values = winner.values;
    const icon = iconOf(main);
    const iconAt = icon ? main.children.indexOf(icon) : -1;
    const showIcon = icon !== undefined && members.some((m) => !iconOf(m));
    const label = labels.size > 1 ? labelOf(main) : undefined;
    const entry = winner.side.entry;
    const iconComponent = swaps && icon ? icons.of(icon.op as SvgOp, entry) : undefined;
    const properties: PlanComponentProperty[] = [];
    // A text property has one default for the whole set, which every variant then shows; the
    // component's name reads right on each, where the first label found would not.
    if (label) properties.push({ type: "TEXT", name: "Label", path: label.path, default: name });
    if (showIcon)
      properties.push({ type: "BOOLEAN", name: "Show icon", path: [iconAt], default: true });
    if (iconComponent) {
      const key = iconComponent.key;
      properties.push({ type: "INSTANCE_SWAP", name: "Icon", path: [iconAt], default: key });
    }
    // Without variant properties there is nothing to choose between: a plain component.
    const plain = kept.length === 0;
    const component: Component = {
      key: plain ? `component:${name}` : `set:${name}|${variantName}`,
      name: plain ? name : variantName,
      tag: plain ? `component:${name}` : `set:${name}`,
      // The main's own entry's occurrences: the definition reads its hovers there.
      occurrences: winner.members,
      named: true,
      ...(plain ? {} : { set: { key: `set:${name}`, name, values } }),
      properties,
      ...(label ? { label: label.path } : {}),
      ...(icon ? { iconAt } : {}),
    };
    for (const part of parts) {
      for (const node of part.members) {
        node.component = component;
        const own = iconOf(node);
        if (icon && !own) node.iconless = true;
        const values: PlanPropertyValues = {};
        if (label) values.Label = labelOf(node)?.text ?? "";
        if (showIcon) values["Show icon"] = own !== undefined;
        if (iconComponent && own) values.Icon = icons.of(own.op as SvgOp, part.side.entry).key;
        if (Object.keys(values).length > 0) node.properties = values;
      }
    }
    // The main shows its icon as an instance, which an instance's Icon swaps.
    if (icon && iconComponent) icon.component = iconComponent;
    built.push(component);
    owners.push(entry);
  }
  return { variants: built, owners, properties: kept.map(capital), notJoined };
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

/** One capture's ops before components, and what names them, as `shareVariantSets` takes it. */
export type VariantInput = {
  ops: PlanOp[];
  /** A node id to the component it is the root of. */
  named: Map<string, FoundComponent>;
  hovers?: Map<string, HoverPatch>;
  /** Name each instance text's captured id, for a capture with a language. */
  sources?: boolean;
  /**
   * Whether its occurrences decide the sets, their properties and the report: the page's own
   * language does, another language's capture takes the same keys. Default true.
   */
  decides?: boolean;
};

/** What the sets of several captures of one page came to, the first capture the widest. */
export type SharedSets = {
  /** Icon definitions, then every variant main after the mains it holds instances of. */
  definitions: { owner: number; ops: PlanOp[] }[];
  /** Per input, its page with each occurrence that joined an instance. */
  pages: PlanOp[][];
  sets: VariantSet[];
  /** Named components made without variant properties, in page order. */
  plain: string[];
  fromMarkers: number;
  renamed: { from: string; to: string }[];
  notJoined: Map<string, number>;
  hoverCapped?: number;
  hoverSwapped?: number;
};

/**
 * Makes one component set of every component the code or markers name at least twice in one of
 * the inputs that decide, for all of them: the props a set's variants differ by are those any of
 * them keeps, each variant's main comes from the first input that has it, and each input's
 * occurrences that look like their variant are instances of it. Null when no name qualifies.
 */
export function shareVariantSets(
  inputs: VariantInput[],
  /** Whether a token or text style key switches by Breakpoint, its value then each device's. */
  switches: (key: string) => boolean = () => false
): SharedSets | null {
  const decidesAt = inputs.map((input) => input.decides !== false);
  const forests = inputs.map((input) => buildForest(input.ops));
  /** Per name, its occurrences in each input. */
  const byName = new Map<string, Tree[][]>();
  for (const [entry, nodes] of forests.entries()) {
    const { named } = inputs[entry] as VariantInput;
    for (const node of nodes) {
      const found = named.get(node.op.id);
      if (!found || node.op.op !== "frame" || !node.parent || node.rotated) continue;
      let perEntry = byName.get(found.name);
      if (!perEntry) {
        perEntry = inputs.map(() => []);
        byName.set(found.name, perEntry);
      }
      perEntry[entry]?.push(node);
    }
  }
  // Inner names first, so an outer one's look reads them as their sets.
  const qualifying = [...byName]
    .filter(([, perEntry]) => perEntry.some((o, entry) => decidesAt[entry] && o.length >= 2))
    .map(([name, perEntry]) => ({
      name,
      perEntry,
      height: Math.max(...perEntry.flat().map((n) => n.height)),
    }))
    .sort((a, b) => a.height - b.height);
  if (qualifying.length === 0) return null;

  const icons = new Icons();
  const variants: Component[] = [];
  const owners = new Map<Component, number>();
  const sets: (VariantSet & { first: { entry: number; node: Tree } })[] = [];
  const notJoined = new Map<string, number>();
  const renamed = new Map<string, { from: string; to: string }>();
  let fromMarkers = 0;
  for (const { name, perEntry } of qualifying) {
    const sides = perEntry.flatMap((occurrences, entry) =>
      occurrences.length > 0
        ? [sideOf(entry, occurrences, (inputs[entry] as VariantInput).named)]
        : []
    );
    const decides = (side: Side) => decidesAt[side.entry] === true;
    const built = buildSet(name, sides, decides, icons, switches);
    variants.push(...built.variants);
    for (const [i, c] of built.variants.entries()) owners.set(c, built.owners[i] as number);
    const firstSide = sides.find(decides) as Side;
    const first = { entry: firstSide.entry, node: firstSide.occurrences[0] as Tree };
    const found = sides.filter(decides).flatMap((s) => s.occurrences.map(s.found));
    const markers = found.every((f) => f.source === "marker");
    sets.push({
      name,
      variants: built.variants.length,
      properties: built.properties,
      ...(markers ? { markers: true as const } : {}),
      first,
    });

    if (built.notJoined > 0) notJoined.set(name, built.notJoined);
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
    for (const used of usedBy(component)) if (used.named) visit(used);
    ordered.push(component);
  };
  for (const component of variants) visit(component);

  const notes: HoverNotes = { capped: 0, swapped: 0 };
  const definitions = [
    ...icons.owners.map((owner, i) => ({ owner, ops: icons.ops.slice(2 * i, 2 * i + 2) })),
    ...ordered.map((c) => {
      const owner = owners.get(c) ?? 0;
      const { hovers = new Map(), sources = false } = inputs[owner] as VariantInput;
      return { owner, ops: definition(c, hovers, notes, sources) };
    }),
  ];
  const pages = forests.map((nodes, entry) =>
    nodes
      .filter((n) => n.parent === null)
      .flatMap((r) => flatten(r, (id) => id, (inputs[entry] as VariantInput).sources ?? false))
  );
  const orders = forests.map((nodes) => new Map(nodes.map((n, i) => [n, i])));
  const rank = ({ first }: (typeof sets)[number]) => [
    first.entry,
    orders[first.entry]?.get(first.node) ?? 0,
  ];
  sets.sort((a, b) => {
    const [ea, na] = rank(a) as [number, number];
    const [eb, nb] = rank(b) as [number, number];
    return ea - eb || na - nb;
  });
  return {
    definitions,
    pages,
    sets: sets.filter((set) => set.properties.length > 0).map(({ first: _, ...set }) => set),
    plain: sets.filter((set) => set.properties.length === 0).map((set) => set.name),
    fromMarkers,
    renamed: [...renamed.values()],
    notJoined,
    ...(notes.capped > 0 ? { hoverCapped: notes.capped } : {}),
    ...(notes.swapped > 0 ? { hoverSwapped: notes.swapped } : {}),
  };
}

/**
 * Makes a component set of every component the page's code or markers name at least twice in
 * `ops`: one variant per combination of props seen, its definition at the front, inner-first, and
 * each occurrence that looks like its variant an instance of it with its `Label`, `Show icon` and
 * `Icon` values. One without variant properties is a plain component, listed in `plain`. `named`
 * maps a node id to the component it is the root of. What is left goes on to `extractComponents`.
 */
export function extractVariantSets(
  ops: PlanOp[],
  named: Map<string, FoundComponent>,
  hovers: Map<string, HoverPatch> = new Map(),
  /** Name each instance text's captured id, for a capture with a language. */
  sources = false
): Omit<SharedSets, "definitions" | "pages"> & { ops: PlanOp[] } {
  const none = { ops, sets: [], plain: [], fromMarkers: 0, renamed: [], notJoined: new Map() };
  if (named.size === 0) return none;
  const shared = shareVariantSets([{ ops, named, hovers, sources }]);
  if (!shared) return none;
  const { definitions, pages, ...rest } = shared;
  return { ...rest, ops: [...definitions.flatMap((d) => d.ops), ...(pages[0] ?? [])] };
}

/** The report's lines for a page's sets: each set, markers, names replaced, looks that differ. */
export function componentLines(
  found: Pick<SharedSets, "sets" | "fromMarkers" | "renamed" | "notJoined">
): string[] {
  const lines: string[] = [];
  for (const set of found.sets) {
    const n = set.variants;
    const listed = set.properties.length > 0 ? ` (${set.properties.join(", ")})` : "";
    const from = set.markers ? "markers" : "code";
    lines.push(`${set.name}: ${n} variant${n === 1 ? "" : "s"} from the page's ${from}${listed}.`);
  }
  if (found.fromMarkers > 0) {
    const n = found.fromMarkers;
    lines.push(`${n} component${n === 1 ? "" : "s"} named by shadcn markers.`);
  }
  for (const { from, to } of found.renamed) {
    lines.push(`A component named "${from}" in the code was named ${to} from its data-slot.`);
  }
  for (const [name, n] of found.notJoined) {
    // `CarouselItem` reads as `carousel item`.
    const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    const what = `${words}${n === 1 ? "" : "s"}`;
    // A plain component has no variants: its occurrences differ from the component itself.
    const of = found.sets.some((set) => set.name === name) ? "variant" : "component";
    lines.push(
      n === 1
        ? `1 ${what} looks different from its ${name} ${of} and stays as it is.`
        : `${n} ${what} look different from their ${name} ${of} and stay as they are.`
    );
  }
  return lines;
}

/**
 * What `mapCaptureParts` made a plan's named components from: the capture's ops before any
 * component, with its tags, and the report lines it wrote for them, so a device merge can make the
 * sets again across its frames.
 */
export type ComponentInput = VariantInput & {
  tags: Map<string, string>;
  lines: string[];
  /** The sets and plain components it made, for a review of the capture alone. */
  sets: VariantSet[];
  plain: string[];
};
