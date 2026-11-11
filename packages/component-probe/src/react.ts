// React leaves its fiber on every rendered element under a `__reactFiber$<random>` key. Walking
// `return` from an element's host fiber reaches the components that rendered it; the nearest one
// that isn't a pass-through wrapper is the element's component, tagged on its first element.
import { type CodeComponent, isPassThrough, usableName } from "./names";

type Fiber = {
  type?: unknown;
  memoizedProps?: unknown;
  return?: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
  alternate?: Fiber | null;
  stateNode?: unknown;
};

const FIBER_KEY = "__reactFiber$";
// Bounds the walks on a deep or malformed tree.
const MAX_DEPTH = 200;

function fiberOf(el: Element): Fiber | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith(FIBER_KEY)) return (el as unknown as Record<string, Fiber>)[key] ?? null;
  }
  return null;
}

// A function component or class, a forwardRef (`{ render }`) or a memo (`{ type }`), by its
// `displayName || name`, unwrapping forwardRef and memo; null for anything else.
function componentName(type: unknown, depth = 0): string | null {
  if (typeof type === "function") {
    const fn = type as { displayName?: unknown; name?: unknown };
    return usableName(fn.displayName) ?? usableName(fn.name);
  }
  if (!type || typeof type !== "object" || depth > 4) return null;
  const wrapper = type as { displayName?: unknown; render?: unknown; type?: unknown };
  const inner = wrapper.render ?? wrapper.type;
  if (inner === undefined) return null;
  return usableName(wrapper.displayName) ?? componentName(inner, depth + 1);
}

// The element a component renders first: its first host fiber, depth first.
function firstHost(fiber: Fiber): unknown {
  const stack: Fiber[] = fiber.child ? [fiber.child] : [];
  for (let steps = 0; stack.length > 0 && steps < MAX_DEPTH * 10; steps++) {
    const next = stack.pop() as Fiber;
    if (typeof next.type === "string") return next.stateNode;
    if (next.sibling) stack.push(next.sibling);
    if (next.child) stack.push(next.child);
  }
  return undefined;
}

export function findReact(doc: Document): Map<Element, CodeComponent> {
  const found = new Map<Element, CodeComponent>();
  // A component and its alternate (React's other copy of the same fiber) are one component.
  const claimed = new Set<Fiber>();
  for (const el of doc.querySelectorAll("*")) {
    let fiber = fiberOf(el)?.return;
    for (let depth = 0; fiber && depth < MAX_DEPTH; depth++, fiber = fiber.return) {
      const name = componentName(fiber.type);
      if (name === null || isPassThrough(name)) continue;
      if (claimed.has(fiber)) break;
      // Real fibers know their first element; without a `child` the element is taken to be it,
      // and document order makes it the first one to reach the component.
      const root = fiber.child ? firstHost(fiber) : el;
      if (root !== el) break;
      claimed.add(fiber);
      if (fiber.alternate) claimed.add(fiber.alternate);
      const props = fiber.memoizedProps;
      found.set(el, {
        source: "react",
        name,
        props: props && typeof props === "object" ? (props as Record<string, unknown>) : {},
      });
      break;
    }
  }
  return found;
}
