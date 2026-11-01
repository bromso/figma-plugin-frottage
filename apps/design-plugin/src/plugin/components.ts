/**
 * The mains of one import, which live in a section beside the page: a component cannot go inside a
 * component or an instance. Keeps them by key, as `mainComponent` cannot be read under `dynamic-page`.
 */

const SECTION_GAP = 200;
const PADDING = 40;
const GAP = 40;
const WRAP_AT = 1600;

export function createComponentSet(api: PluginAPI, rootName: string) {
  // The user can change pages during an import, and the section stays with the root.
  const page = api.currentPage;
  const mains = new Map<string, ComponentNode>();
  let section: SectionNode | null = null;

  return {
    main: (key: string) => mains.get(key),

    /** Takes in a finished main. The first one brings the section. */
    adopt(key: string, node: ComponentNode) {
      if (!section) {
        section = api.createSection();
        section.name = `${rootName} components`;
        if (section.parent !== page) page.appendChild(section);
      }
      section.appendChild(node);
      mains.set(key, node);
    },

    /** Places the mains in rows, then the section around them, to the right of `root`. */
    layOut(root: { x: number; y: number; width: number }) {
      if (!section) return;
      let x = PADDING;
      let y = PADDING;
      let right = PADDING;
      let rowHeight = 0;
      for (const node of mains.values()) {
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
    },
  };
}

export type ComponentSet = ReturnType<typeof createComponentSet>;

/** The node at `path` under an instance, walking `children` by index. */
export function childAt(instance: InstanceNode, path: number[]): SceneNode {
  let node: SceneNode = instance;
  for (const i of path) {
    const next: SceneNode | undefined = "children" in node ? node.children[i] : undefined;
    if (!next) throw new Error(`no layer at ${path.join(".")}`);
    node = next;
  }
  return node;
}
