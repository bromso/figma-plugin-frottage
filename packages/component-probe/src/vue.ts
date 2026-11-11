// Vue 3 keeps no instance on each element in production. The element holding `__vue_app__` leads
// to the whole tree (`_container._vnode`); each component vnode has its root element (`el`), its
// name (`type.name || type.__name`) and its props. When several components share one root
// element, the outermost is kept (Nuxt's `UButton`, not the `ULink` and `ULinkBase` inside it),
// the opposite of React, where the walk goes up from the element and the nearest is kept.
import { type CodeComponent, isTrigger, namesElement, usableName } from "./names";

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

function appRoot(host: Element): VNode | undefined {
  const app = (host as unknown as { __vue_app__?: { _container?: { _vnode?: VNode } } })
    .__vue_app__;
  return app?._container?._vnode;
}

// The outermost component keeps a shared element, but a trigger there yields to the component it
// wraps (`TooltipTrigger` around `UButton`).
function takes(current: CodeComponent | undefined, name: string): boolean {
  return !current || (isTrigger(current.name) && !isTrigger(name));
}

// Records one vnode's component, if it names its root element, and gives the vnodes below it.
function visit(vnode: VNode, found: Map<Element, CodeComponent>): unknown[] {
  const next: unknown[] = [];
  const component = vnode.component;
  if (component) {
    const type = component.type;
    const name = usableName(type?.name) ?? usableName(type?.__name);
    const el = vnode.el;
    if (
      name &&
      !BUILT_IN.has(name) &&
      isElement(el) &&
      namesElement(name, el) &&
      takes(found.get(el), name)
    ) {
      const props = component.props;
      found.set(el, {
        source: "vue",
        name,
        props: props && typeof props === "object" ? (props as Record<string, unknown>) : {},
      });
    }
    next.push(component.subTree);
  }
  next.push(vnode.suspense?.activeBranch);
  if (Array.isArray(vnode.children)) next.push(...vnode.children);
  return next;
}

export function findVue(doc: Document): Map<Element, CodeComponent> {
  const found = new Map<Element, CodeComponent>();
  for (const host of doc.querySelectorAll("*")) {
    let start: VNode | undefined;
    try {
      start = appRoot(host);
    } catch {}
    if (!start) continue;
    const seen = new Set<unknown>();
    const stack: unknown[] = [start];
    while (stack.length > 0 && seen.size < MAX_NODES) {
      const vnode = stack.pop();
      if (!vnode || typeof vnode !== "object" || seen.has(vnode)) continue;
      seen.add(vnode);
      // A vnode that throws on reading is skipped with what's below it; the rest of the tree
      // still counts.
      try {
        // Pushed in reverse so the walk goes in document order.
        stack.push(...visit(vnode as VNode, found).reverse());
      } catch {}
    }
  }
  return found;
}
