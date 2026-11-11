// Vue 3 keeps no instance on each element in production. The element holding `__vue_app__` leads
// to the whole tree (`_container._vnode`); each component vnode has its root element (`el`), its
// name (`type.name || type.__name`) and its props. When several components share one root
// element, the outermost (the design-system component, not the router link inside it) is kept.
import { type CodeComponent, usableName } from "./names";

type VNode = {
  el?: unknown;
  children?: unknown;
  component?: {
    type?: { name?: unknown; __name?: unknown };
    props?: unknown;
    subTree?: VNode;
  } | null;
  suspense?: { activeBranch?: VNode | null } | null;
};

// Vue's own wrappers, which render their slot's element rather than one of their own.
const BUILT_IN = new Set(["Transition", "TransitionGroup", "BaseTransition", "KeepAlive"]);
// Bounds the walk on a huge or cyclic tree.
const MAX_NODES = 50_000;

function isElement(node: unknown): node is Element {
  return !!node && typeof node === "object" && (node as Node).nodeType === 1;
}

export function findVue(doc: Document): Map<Element, CodeComponent> {
  const found = new Map<Element, CodeComponent>();
  for (const host of doc.querySelectorAll("*")) {
    const app = (host as unknown as { __vue_app__?: { _container?: { _vnode?: VNode } } })
      .__vue_app__;
    const start = app?._container?._vnode;
    if (!start) continue;
    const seen = new Set<VNode>();
    const stack: VNode[] = [start];
    while (stack.length > 0 && seen.size < MAX_NODES) {
      const vnode = stack.pop() as VNode;
      if (!vnode || typeof vnode !== "object" || seen.has(vnode)) continue;
      seen.add(vnode);
      const component = vnode.component;
      if (component) {
        const type = component.type;
        const name = usableName(type?.name) ?? usableName(type?.__name);
        const el = vnode.el;
        if (name && !BUILT_IN.has(name) && isElement(el) && !found.has(el)) {
          const props = component.props;
          found.set(el, {
            source: "vue",
            name,
            props: props && typeof props === "object" ? (props as Record<string, unknown>) : {},
          });
        }
        if (component.subTree) stack.push(component.subTree);
      }
      if (vnode.suspense?.activeBranch) stack.push(vnode.suspense.activeBranch);
      // Pushed in reverse so the walk goes in document order.
      if (Array.isArray(vnode.children)) {
        for (let i = vnode.children.length - 1; i >= 0; i--) stack.push(vnode.children[i] as VNode);
      }
    }
  }
  return found;
}
