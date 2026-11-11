import type {
  PlanComponentProperty,
  PlanEffect,
  PlanHoverPatch,
  PlanOp,
  PlanPaint,
  PlanPropertyValues,
  PlanRgb,
} from "@repo/figma-mapper";
import { NAMESPACE } from "./tokens";

/**
 * The mains of one import, which live in a section beside the page: a component cannot go inside a
 * component or an instance. Keeps them by key, as `mainComponent` cannot be read under `dynamic-page`.
 */

const SECTION_GAP = 200;
const PADDING = 40;
const GAP = 40;
const WRAP_AT = 1600;
/** Between the variants of a set. */
const VARIANT_GAP = 24;
/** The shared plugin data key that marks a set as Frottage's: `<host>#component:<Name>`. */
export const COMPONENT_KEY = "component";

/** What a definition's root says about the component it makes. */
export type Definition = NonNullable<Extract<PlanOp, { op: "frame" }>["component"]>;
type Values = [string, string][];
type Owner = ComponentNode | ComponentSetNode;
/** A layer of a main that takes a property, by the field Figma references it with. */
const FIELDS = { TEXT: "characters", BOOLEAN: "visible", INSTANCE_SWAP: "mainComponent" } as const;

/** How the applier turns plan paint into Figma's, with its tokens bound. */
export type HoverPaint = {
  paints(list: PlanPaint[]): Paint[];
  effects(list: PlanEffect[]): Effect[];
  solid(color: PlanRgb, opacity: number): SolidPaint;
  /** Puts a variant on the version's mode, as its main is. */
  mode(node: ComponentNode): void;
};

export type ComponentSetOptions = {
  /** Readies the section when it is made, such as a device set's Color Mode. */
  prepare?: (section: SectionNode) => void;
  /** A main that lost layers, so patches and references by path would land on the wrong ones. */
  isBroken: (key: string) => boolean;
  /** Any main of the import by key, such as the icon a property swaps to. */
  lookup: (key: string) => ComponentNode | undefined;
  /** The page's host, which a set's tag names. */
  host: () => string;
  /** Sets this import made already, as a theme's earlier version: never added to. */
  made: Set<string>;
};

/** A variant set, or a plain component with properties: what is made once its mains are in. */
type Group = {
  name: string;
  /** A set of variants, which is tagged and which a re-import adds to. */
  variants: boolean;
  keys: string[];
  done: boolean;
  /** The set the variants became, or the one already in the file that they joined. */
  set: ComponentSetNode | null;
  /** The set was in the file before this import. */
  existing: boolean;
  /** The variants stayed separate components: Figma wouldn't combine them. */
  separate: boolean;
  /** Some property couldn't be added or set. */
  propertyFailed: boolean;
  /** Each owner's swap property and the icons it prefers, by key. */
  swaps: { owner: Owner; full: string; icons: string[] }[];
};

/** A variant as it goes into a set: its main or Hover copy, its values and its definition. */
type Member = { node: ComponentNode; values: Values; def: Definition; key?: string };

const variantName = (values: Values) => values.map(([k, v]) => `${k}=${v}`).join(", ");
const baseName = (full: string) => full.split("#")[0] as string;

/**
 * Sets an instance's properties by their names in the plan, `Label` for `Label#1:2`, and its
 * variant's values. `lookup` gives an icon's main for a swap. Something Figma refuses is left off;
 * gives false if anything was.
 */
export function setInstanceProperties(
  node: InstanceNode,
  values: PlanPropertyValues,
  variant: Values,
  lookup: (key: string) => ComponentNode | undefined,
  onIcon?: (name: string, key: string) => void
): boolean {
  const known = node.componentProperties;
  const byName = new Map(Object.keys(known).map((full) => [baseName(full), full]));
  const out: Record<string, string | boolean> = {};
  let ok = true;
  for (const [name, value] of variant) {
    if (known[name]?.type === "VARIANT") out[name] = value;
  }
  for (const [name, value] of Object.entries(values)) {
    const full = byName.get(name);
    const type = full ? known[full]?.type : undefined;
    if (!full || !type || type === "VARIANT") {
      ok = false;
      continue;
    }
    if (type !== "INSTANCE_SWAP") {
      out[full] = value;
      continue;
    }
    const icon = typeof value === "string" ? lookup(value) : undefined;
    if (!icon) {
      ok = false;
      continue;
    }
    out[full] = icon.id;
    onIcon?.(name, value as string);
  }
  try {
    node.setProperties(out);
  } catch {
    // One at a time, so a refused one costs itself alone.
    ok = false;
    for (const [name, value] of Object.entries(out)) {
      try {
        node.setProperties({ [name]: value });
      } catch {
        // left as the main has it
      }
    }
  }
  return ok;
}

/** Applies one patch to the layer it names, which throws when that layer cannot take it. */
function patchLayer(node: SceneNode, patch: PlanHoverPatch, paint: HoverPaint) {
  const { fills, strokeColor, opacity, effects, textColor, decoration } = patch;
  if (fills) {
    if (!("fills" in node)) throw new Error("layer takes no fills");
    node.fills = paint.paints(fills);
  }
  if (strokeColor) {
    if (node.type === "GROUP" || node.type === "SLICE") throw new Error("layer takes no strokes");
    const { a, ...color } = strokeColor;
    (node as GeometryMixin).strokes = [paint.solid(color, a)];
  }
  if (opacity !== undefined) {
    (node as BlendMixin).opacity = opacity;
  }
  if (effects) {
    if (!("effects" in node)) throw new Error("layer takes no effects");
    node.effects = paint.effects(effects);
  }
  if (textColor || decoration) {
    if (node.type !== "TEXT") throw new Error("layer is not text");
    const end = node.characters.length;
    if (end === 0) return;
    if (textColor) {
      const { a, ...color } = textColor;
      for (const [from, to] of patch.ranges ?? [[0, end]]) {
        const start = Math.max(0, from);
        const stop = Math.min(end, to);
        if (start < stop) node.setRangeFills(start, stop, [paint.solid(color, a)]);
      }
    }
    if (decoration) node.setRangeTextDecoration(0, end, decoration);
  }
}

/** `page` is the root's: the user can change pages during an import, and the section stays with it. */
export function createComponentSet(
  api: PluginAPI,
  rootName: string,
  paint: HoverPaint,
  page: PageNode,
  options: ComponentSetOptions
) {
  const { prepare, isBroken, lookup, host, made } = options;
  const mains = new Map<string, ComponentNode>();
  const defs = new Map<string, Definition>();
  /** Keys in the order their mains came, which the section keeps. */
  const order: string[] = [];
  const groups = new Map<string, Group>();
  const groupOf = new Map<string, Group>();
  /** Keys whose main went into, or is, a variant of a set already in the file. */
  const elsewhere = new Set<string>();
  /** What this import put into sets already in the file, which a discard takes back. */
  const addedVariants: ComponentNode[] = [];
  const addedProperties: { owner: Owner; full: string }[] = [];
  /** Plain mains' State sets with Default and Hover. */
  const hoverSets = new Map<string, ComponentSetNode>();
  let section: SectionNode | null = null;
  let hoverVariants = 0;
  let hoverFailures = 0;
  let finished = false;
  let layoutFailed = false;
  /** The file's sets, read once, when the first set looks for its own. */
  let fileSets: ComponentSetNode[] | null = null;

  const tagOf = (name: string) => `${host()}#component:${name}`;

  /** Frottage's set of `name` for this host on the page, from an earlier import. */
  function taggedSet(name: string): ComponentSetNode | null {
    if (!fileSets) {
      try {
        fileSets = page.findAllWithCriteria({ types: ["COMPONENT_SET"] });
      } catch {
        fileSets = [];
      }
    }
    const tag = tagOf(name);
    return (
      fileSets.find((s) => {
        try {
          return (
            !s.removed && !made.has(s.id) && s.getSharedPluginData(NAMESPACE, COMPONENT_KEY) === tag
          );
        } catch {
          return false;
        }
      }) ?? null
    );
  }

  /** A copy of `main` with its hover patches, or null when one fails. Leaves the main as it was. */
  function hoverCopy(main: ComponentNode, patches: PlanHoverPatch[]): ComponentNode | null {
    let hover: ComponentNode | undefined;
    try {
      hover = main.clone();
      paint.mode(hover);
      for (const patch of patches) patchLayer(childAt(hover, patch.path), patch, paint);
      return hover;
    } catch {
      hoverFailures++;
      try {
        hover?.remove();
      } catch {
        // already gone
      }
      return null;
    }
  }

  /**
   * Turns a main into a State set with Default and Hover, and gives the set. Any failure leaves the
   * main as it was. `combineAsVariants` lays nothing out, so the caller places the variants.
   */
  function addHover(
    main: ComponentNode,
    patches: PlanHoverPatch[]
  ): { set: ComponentSetNode; hover: ComponentNode } | null {
    const name = main.name;
    const hover = hoverCopy(main, patches);
    if (!hover) return null;
    try {
      main.name = "State=Default";
      hover.name = "State=Hover";
      const set = api.combineAsVariants([main, hover], section as SectionNode);
      hoverVariants++;
      try {
        set.name = name;
      } catch {
        // the set keeps a default name
      }
      return { set, hover };
    } catch {
      hoverFailures++;
      try {
        main.name = name;
      } catch {
        // the main keeps its variant name
      }
      try {
        hover.remove();
      } catch {
        // already gone
      }
      return null;
    }
  }

  /**
   * Places a set's variants in a grid, a column per value of their first property and a row per
   * combination of the rest, and fits the set to them.
   */
  function grid(set: ComponentSetNode, members: Member[]) {
    const columns: string[] = [];
    const rows: string[] = [];
    const cells = members.map(({ values }) => {
      const [first, ...rest] = values;
      const column = first?.[1] ?? "";
      const row = variantName(rest);
      if (!columns.includes(column)) columns.push(column);
      if (!rows.includes(row)) rows.push(row);
      return [columns.indexOf(column), rows.indexOf(row)] as const;
    });
    const widths = columns.map(() => 0);
    const heights = rows.map(() => 0);
    for (const [i, [c, r]] of cells.entries()) {
      const { node } = members[i] as Member;
      widths[c] = Math.max(widths[c] as number, node.width);
      heights[r] = Math.max(heights[r] as number, node.height);
    }
    const offsets = (sizes: number[]) =>
      sizes.map((_, i) => sizes.slice(0, i).reduce((sum, n) => sum + n + VARIANT_GAP, 0));
    const xs = offsets(widths);
    const ys = offsets(heights);
    for (const [i, [c, r]] of cells.entries()) {
      const { node } = members[i] as Member;
      node.x = xs[c] as number;
      node.y = ys[r] as number;
    }
    const sum = (sizes: number[]) =>
      sizes.reduce((a, n) => a + n, 0) + VARIANT_GAP * (sizes.length - 1);
    set.resize(sum(widths), sum(heights));
  }

  /** Puts variants that join a set already laid out in a row below what it holds. */
  function addBelow(set: ComponentSetNode, nodes: ComponentNode[]) {
    const kids = set.children.filter((c) => !nodes.includes(c as ComponentNode));
    const bottom = Math.max(0, ...kids.map((c) => c.y + c.height));
    const y = kids.length > 0 ? bottom + VARIANT_GAP : 0;
    let x = 0;
    for (const node of nodes) {
      node.x = x;
      node.y = y;
      x += node.width + VARIANT_GAP;
    }
    const right = Math.max(...set.children.map((c) => c.x + c.width));
    const lowest = Math.max(...set.children.map((c) => c.y + c.height));
    set.resize(right, lowest);
  }

  /** The property's default as Figma takes it: an icon's by its main's id. */
  function defaultOf(prop: PlanComponentProperty): string | boolean | undefined {
    if (prop.type !== "INSTANCE_SWAP") return prop.default;
    return lookup(prop.default)?.id;
  }

  /** A property `owner` has of this name and type, or a new one. Null when Figma refused it. */
  function propertyOn(owner: Owner, prop: PlanComponentProperty, icons: string[]): string | null {
    try {
      const have = Object.entries(owner.componentPropertyDefinitions).find(
        ([full, def]) => baseName(full) === prop.name && def.type === prop.type
      );
      if (have) return have[0];
      const value = defaultOf(prop);
      if (value === undefined) return null;
      const preferredValues = icons.flatMap((key) => {
        const icon = lookup(key);
        return icon ? [{ type: "COMPONENT" as const, key: icon.key }] : [];
      });
      const full = owner.addComponentProperty(
        prop.name,
        prop.type,
        value,
        prop.type === "INSTANCE_SWAP" ? { preferredValues } : undefined
      );
      // A set made by an earlier import keeps what this one gave it only if this one stays.
      if (owner.type === "COMPONENT_SET" && !made.has(owner.id)) {
        addedProperties.push({ owner, full });
      }
      return full;
    } catch {
      return null;
    }
  }

  /** Gives `owner` its members' properties and has each member's layers reference them. */
  function addProperties(group: Group, owner: Owner, members: Member[]) {
    const props = new Map<string, PlanComponentProperty>();
    for (const { def } of members) {
      for (const prop of def.properties ?? [])
        if (!props.has(prop.name)) props.set(prop.name, prop);
    }
    for (const prop of props.values()) {
      const icons =
        prop.type === "INSTANCE_SWAP"
          ? [
              ...new Set(
                members.flatMap(({ def }) =>
                  (def.properties ?? []).flatMap((p) =>
                    p.name === prop.name && p.type === "INSTANCE_SWAP" ? [p.default] : []
                  )
                )
              ),
            ]
          : [];
      const full = propertyOn(owner, prop, icons);
      if (!full) {
        group.propertyFailed = true;
        continue;
      }
      if (prop.type === "INSTANCE_SWAP") group.swaps.push({ owner, full, icons });
      const field = FIELDS[prop.type];
      for (const { node, def, key } of members) {
        const own = def.properties?.find((p) => p.name === prop.name && p.type === prop.type);
        if (!own || (key !== undefined && isBroken(key))) continue;
        try {
          const layer = childAt(node, own.path);
          layer.componentPropertyReferences = {
            ...layer.componentPropertyReferences,
            [field]: full,
          };
        } catch {
          group.propertyFailed = true;
        }
      }
    }
  }

  /** The variants of a group, renamed, with Hover copies where a variant has hover patches. */
  function membersOf(group: Group, keys: string[]): Member[] {
    const entries = keys.flatMap((key) => {
      const node = mains.get(key);
      const def = defs.get(key);
      return node && def && !elsewhere.has(key) ? [{ key, node, def }] : [];
    });
    const hovers = (key: string) => {
      const patches = defs.get(key)?.hover ?? [];
      return patches.length > 0 && !isBroken(key) ? patches : null;
    };
    const hovered = group.keys.some((key) => hovers(key));
    const members: Member[] = [];
    for (const { key, node, def } of entries) {
      const own = def.set?.values ?? [];
      if (def.hover && def.hover.length > 0 && isBroken(key)) hoverFailures++;
      const values: Values = hovered ? [...own, ["State", "Default"]] : own;
      if (values.length > 0) node.name = variantName(values);
      members.push({ node, values, def, key });
      const patches = hovers(key);
      const copy = patches ? hoverCopy(node, patches) : null;
      if (!copy) continue;
      const hover: Values = [...own, ["State", "Hover"]];
      copy.name = variantName(hover);
      hoverVariants++;
      members.push({ node: copy, values: hover, def });
    }
    return members;
  }

  /** Adds members to a set that is already made: an earlier import's, or this one's. */
  function join(group: Group, set: ComponentSetNode, members: Member[]) {
    const have = new Map(set.children.map((c) => [c.name, c as ComponentNode]));
    const fresh: Member[] = [];
    for (const member of members) {
      const there = have.get(member.node.name);
      if (!there) {
        fresh.push(member);
        continue;
      }
      // That variant is there already: its instances use it, and this copy goes.
      if (member.key !== undefined) mains.set(member.key, there);
      try {
        member.node.remove();
      } catch {
        // stays in the section
      }
    }
    const moved: ComponentNode[] = [];
    for (const member of fresh) {
      try {
        set.appendChild(member.node);
        moved.push(member.node);
        if (group.existing) addedVariants.push(member.node);
      } catch {
        group.propertyFailed = true;
      }
    }
    try {
      if (moved.length > 0) addBelow(set, moved);
    } catch {
      layoutFailed = true;
    }
    for (const member of members) if (member.key !== undefined) elsewhere.add(member.key);
    addProperties(
      group,
      set,
      fresh.filter((m) => moved.includes(m.node))
    );
  }

  /** Makes a group's set, or its plain component's properties, once all its mains are in. */
  function finish(group: Group) {
    if (group.done) return;
    group.done = true;
    const members = membersOf(group, group.keys);
    if (!group.variants && members.length === 1) {
      addProperties(group, (members[0] as Member).node, members);
      return;
    }
    const existing = group.variants ? taggedSet(group.name) : null;
    if (existing) {
      group.set = existing;
      group.existing = true;
      join(group, existing, members);
      return;
    }
    combine(group, members);
  }

  function combine(group: Group, members: Member[]) {
    let set: ComponentSetNode;
    try {
      set = api.combineAsVariants(
        members.map((m) => m.node),
        section as SectionNode
      );
    } catch {
      // Each main stays a component of its own, with its own properties.
      group.separate = true;
      for (const member of members) {
        if (member.key === undefined) {
          // A Hover copy has no set to be a variant of.
          hoverVariants--;
          hoverFailures++;
          try {
            member.node.remove();
          } catch {
            // already gone
          }
          continue;
        }
        try {
          member.node.name = group.variants
            ? `${group.name} / ${variantName(member.def.set?.values ?? [])}`
            : group.name;
        } catch {
          // keeps its variant name
        }
        addProperties(group, member.node, [member]);
      }
      return;
    }
    group.set = set;
    made.add(set.id);
    try {
      set.name = group.name;
    } catch {
      // the set keeps a default name
    }
    if (group.variants) {
      try {
        set.setSharedPluginData(NAMESPACE, COMPONENT_KEY, tagOf(group.name));
      } catch {
        // untagged, so a re-import makes another
      }
    }
    try {
      grid(set, members);
    } catch {
      layoutFailed = true;
    }
    addProperties(group, set, members);
  }

  /** Makes every group not made yet, and the plain mains' Hover variants. */
  function finishAll() {
    if (finished) return;
    finished = true;
    for (const group of groups.values()) finish(group);
    for (const key of order) {
      if (groupOf.has(key)) continue;
      const node = mains.get(key) as ComponentNode;
      const patches = defs.get(key)?.hover ?? [];
      if (patches.length === 0) continue;
      if (isBroken(key)) {
        hoverFailures++;
        continue;
      }
      const made = addHover(node, patches);
      if (!made) continue;
      hoverSets.set(key, made.set);
      // One component that cannot be sized does not stop the rest.
      try {
        const { set, hover } = made;
        node.x = 0;
        node.y = 0;
        hover.x = node.width + VARIANT_GAP;
        hover.y = 0;
        set.resize(hover.x + hover.width, Math.max(node.height, hover.height));
      } catch {
        layoutFailed = true;
      }
    }
  }

  /** What the section holds, in the order the mains came. */
  function placed(): (ComponentNode | ComponentSetNode)[] {
    const out: (ComponentNode | ComponentSetNode)[] = [];
    for (const key of order) {
      if (elsewhere.has(key)) continue;
      const group = groupOf.get(key);
      const node = group?.set ?? hoverSets.get(key) ?? (mains.get(key) as ComponentNode);
      if (!out.includes(node)) out.push(node);
    }
    return out;
  }

  /** Adds `icon` to a set's preferred swaps, once an instance swaps to it. */
  function preferIcon(group: Group, name: string, icon: string) {
    const main = lookup(icon);
    for (const swap of group.swaps) {
      if (!main || baseName(swap.full) !== name || swap.icons.includes(icon)) continue;
      swap.icons.push(icon);
      try {
        // Those a set already in the file prefers stay.
        const current = swap.owner.componentPropertyDefinitions[swap.full]?.preferredValues ?? [];
        if (current.some((v) => v.key === main.key)) continue;
        const preferredValues = [...current, { type: "COMPONENT" as const, key: main.key }];
        swap.owner.editComponentProperty(swap.full, { preferredValues });
      } catch {
        // the swap still takes it; it's just not offered first
      }
    }
  }

  return {
    /** A main by key. A set is made the first time one of its variants is asked for. */
    main(key: string): ComponentNode | undefined {
      const group = groupOf.get(key);
      if (group) finish(group);
      return mains.get(key);
    },

    /** Takes in a finished main. The first one brings the section. */
    adopt(key: string, node: ComponentNode, def: Definition) {
      if (!section) {
        section = api.createSection();
        section.name = `${rootName} components`;
        // A section takes the viewer's theme, and page components are mostly dark text on light.
        section.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }];
        if (section.parent !== page) page.appendChild(section);
        prepare?.(section);
      }
      section.appendChild(node);
      mains.set(key, node);
      defs.set(key, def);
      order.push(key);
      const id = def.set?.key ?? (def.properties?.length ? key : null);
      if (id === null) return;
      let group = groups.get(id);
      if (!group) {
        group = {
          name: def.set?.name ?? def.name,
          variants: def.set !== undefined,
          keys: [],
          done: false,
          set: null,
          existing: false,
          separate: false,
          propertyFailed: false,
          swaps: [],
        };
        groups.set(id, group);
      }
      group.keys.push(key);
      groupOf.set(key, group);
      // A variant after its set was made joins it.
      if (group.done && group.set) join(group, group.set, membersOf(group, [key]));
      else if (group.done) addProperties(group, node, membersOf(group, [key]));
    },

    /**
     * Sets an instance of `key`'s properties and variant values. A refused one is left off and
     * said once for its set.
     */
    setProperties(key: string, node: InstanceNode, values: PlanPropertyValues) {
      const group = groupOf.get(key);
      const variant = defs.get(key)?.set?.values ?? [];
      const ok = setInstanceProperties(node, values, variant, lookup, (name, icon) => {
        if (group) preferIcon(group, name, icon);
      });
      if (!ok && group) group.propertyFailed = true;
    },

    hoverCounts: () => ({ hoverVariants, hoverFailures }),

    /** The report's lines: sets Figma wouldn't combine, and properties it wouldn't take. */
    notes(): string[] {
      const lines: string[] = [];
      for (const group of groups.values()) {
        if (group.separate && group.variants) {
          lines.push(
            `${group.name}'s variants couldn't be combined, so they stay separate components.`
          );
        }
        if (group.propertyFailed) {
          lines.push(
            `Some of ${group.name}'s properties couldn't be added, so its instances show the component's own content there.`
          );
        }
      }
      return lines;
    },

    /** Makes the sets and Hover variants not made yet. `layOut` does too. */
    finish: finishAll,

    /**
     * Makes what is not made yet, then places the mains, or the sets they became, in rows, then the
     * section around them, to the right of `root`.
     */
    layOut(
      root: { x: number; y: number; width: number },
      /** Where the section goes, if not to the right of `root`. */
      at?: { x: number; y: number }
    ) {
      if (!section) return;
      finishAll();
      let failed = layoutFailed;
      let x = PADDING;
      let y = PADDING;
      let right = PADDING;
      let rowHeight = 0;
      for (const node of placed()) {
        try {
          if (x > PADDING && x + node.width > WRAP_AT) {
            x = PADDING;
            y += rowHeight + GAP;
            rowHeight = 0;
          }
          node.x = x;
          node.y = y;
          right = Math.max(right, x + node.width);
          rowHeight = Math.max(rowHeight, node.height);
          x += node.width + GAP;
        } catch {
          failed = true;
        }
      }
      section.resizeWithoutConstraints(right + PADDING, y + rowHeight + PADDING);
      section.x = at ? at.x : root.x + root.width + SECTION_GAP;
      section.y = at ? at.y : root.y;
      // The caller counts it once; what could be placed has been.
      if (failed) throw new Error("some components could not be placed");
    },

    /** Moves the laid out section, for a set of versions. Gives its right edge, if it has one. */
    moveTo(x: number, y: number): number | null {
      if (!section) return null;
      section.x = x;
      section.y = y;
      return x + section.width;
    },

    /**
     * Takes the section and all in it back, and what went into sets already in the file. Instances
     * of the mains go with their own trees.
     */
    discard() {
      for (const node of addedVariants) {
        try {
          node.remove();
        } catch {
          // already gone
        }
      }
      for (const { owner, full } of addedProperties) {
        try {
          if (!owner.removed) owner.deleteComponentProperty(full);
        } catch {
          // already gone
        }
      }
      try {
        section?.remove();
      } catch {
        // already gone
      }
      section = null;
      mains.clear();
      defs.clear();
      groups.clear();
      groupOf.clear();
      hoverSets.clear();
      order.length = 0;
    },
  };
}

export type ComponentSet = ReturnType<typeof createComponentSet>;

/** The node at `path` under an instance, walking `children` by index. */
export function childAt(top: InstanceNode | ComponentNode, path: number[]): SceneNode {
  let node: SceneNode = top;
  for (const i of path) {
    const next: SceneNode | undefined = "children" in node ? node.children[i] : undefined;
    if (!next) throw new Error(`no layer at ${path.join(".")}`);
    node = next;
  }
  return node;
}
