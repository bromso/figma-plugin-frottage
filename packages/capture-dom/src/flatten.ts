import type { CaptureEnv } from "./walk";

const isSlot = (n: Node): n is HTMLSlotElement =>
  n.nodeType === 1 && (n as Element).localName === "slot";

/** The shadow root of an element, open or closed when the environment can reach closed ones. */
export function shadowRootOf(el: Element, env: CaptureEnv): ShadowRoot | null {
  return env.getShadowRoot?.(el) ?? el.shadowRoot ?? null;
}

/** What a slot shows: the nodes assigned to it (through nested slots too), else its own fallback. */
function slotContents(
  slot: HTMLSlotElement,
  keepSlot: ((slot: Element) => boolean) | undefined
): Node[] {
  const assigned = slot.assignedNodes({ flatten: true });
  return assigned.length > 0 ? assigned : expand(Array.from(slot.childNodes), keepSlot);
}

function expand(nodes: Iterable<Node>, keepSlot: ((slot: Element) => boolean) | undefined): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (isSlot(n) && !keepSlot?.(n)) out.push(...slotContents(n, keepSlot));
    else out.push(n);
  }
  return out;
}

/**
 * The children of an element in composed (rendered) order. A shadow host yields its shadow root's
 * children and ignores its light children, which show only where a slot assigns them. A slot
 * yields the nodes assigned to it, or its fallback children when none are. Inside a shadow root a
 * slot is replaced by that same content, unless `keepSlot` says the slot has a box of its own
 * and must stay as a node.
 */
export function flatChildren(
  el: Element,
  env: CaptureEnv,
  keepSlot?: (slot: Element) => boolean
): Node[] {
  if (isSlot(el)) return slotContents(el, keepSlot);
  const root = shadowRootOf(el, env);
  return expand(root ? root.childNodes : el.childNodes, keepSlot);
}
