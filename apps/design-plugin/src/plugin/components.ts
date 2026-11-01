import type { PlanEffect, PlanHoverPatch, PlanPaint, PlanRgb } from "@repo/figma-mapper";

/**
 * The mains of one import, which live in a section beside the page: a component cannot go inside a
 * component or an instance. Keeps them by key, as `mainComponent` cannot be read under `dynamic-page`.
 */

const SECTION_GAP = 200;
const PADDING = 40;
const GAP = 40;
const WRAP_AT = 1600;
/** Between a set's Default variant and its Hover variant. */
const VARIANT_GAP = 24;

/** How the applier turns plan paint into Figma's, with its tokens bound. */
export type HoverPaint = {
  paints(list: PlanPaint[]): Paint[];
  effects(list: PlanEffect[]): Effect[];
  solid(color: PlanRgb, opacity: number): SolidPaint;
};

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
      node.setRangeFills(0, end, [paint.solid(color, a)]);
    }
    if (decoration) node.setRangeTextDecoration(0, end, decoration);
  }
}

export function createComponentSet(api: PluginAPI, rootName: string, paint: HoverPaint) {
  // The user can change pages during an import, and the section stays with the root.
  const page = api.currentPage;
  const mains = new Map<string, ComponentNode>();
  const hovers = new Map<string, PlanHoverPatch[]>();
  let section: SectionNode | null = null;
  let hoverVariants = 0;
  let hoverFailures = 0;

  /**
   * Turns a main into a State set with Default and Hover, and gives the set. Any failure leaves the
   * main as it was. `combineAsVariants` lays nothing out, so the caller places the variants.
   */
  function addHover(main: ComponentNode, patches: PlanHoverPatch[]): ComponentSetNode | null {
    const name = main.name;
    let hover: ComponentNode | undefined;
    try {
      hover = main.clone();
      for (const patch of patches) patchLayer(childAt(hover, patch.path), patch, paint);
      main.name = "State=Default";
      hover.name = "State=Hover";
      let set: ComponentSetNode;
      try {
        set = api.combineAsVariants([main, hover], section as SectionNode);
      } catch (error) {
        main.name = name;
        throw error;
      }
      hoverVariants++;
      try {
        set.name = name;
      } catch {
        // the set keeps a default name
      }
      return set;
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

  return {
    main: (key: string) => mains.get(key),

    /** Takes in a finished main. The first one brings the section. */
    adopt(key: string, node: ComponentNode, hover?: PlanHoverPatch[]) {
      if (!section) {
        section = api.createSection();
        section.name = `${rootName} components`;
        if (section.parent !== page) page.appendChild(section);
      }
      section.appendChild(node);
      mains.set(key, node);
      if (hover && hover.length > 0) hovers.set(key, hover);
    },

    hoverCounts: () => ({ hoverVariants, hoverFailures }),

    /**
     * Makes the hover variants, then places the mains, or the sets they became, in rows, then the
     * section around them, to the right of `root`.
     */
    layOut(root: { x: number; y: number; width: number }) {
      if (!section) return;
      const placed: (ComponentNode | ComponentSetNode)[] = [];
      for (const [key, node] of mains) {
        const patches = hovers.get(key);
        const set = patches ? addHover(node, patches) : null;
        if (set) {
          const hover = set.children[1] as ComponentNode;
          node.x = 0;
          node.y = 0;
          hover.x = node.width + VARIANT_GAP;
          hover.y = 0;
          set.resize(hover.x + hover.width, Math.max(node.height, hover.height));
        }
        placed.push(set ?? node);
      }
      let x = PADDING;
      let y = PADDING;
      let right = PADDING;
      let rowHeight = 0;
      for (const node of placed) {
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
      }
      section.resizeWithoutConstraints(right + PADDING, y + rowHeight + PADDING);
      section.x = root.x + root.width + SECTION_GAP;
      section.y = root.y;
    },

    /** Takes the section and all in it back. Instances of the mains go with their own trees. */
    discard() {
      try {
        section?.remove();
      } catch {
        // already gone
      }
      section = null;
      mains.clear();
      hovers.clear();
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
