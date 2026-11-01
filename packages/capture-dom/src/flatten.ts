import type { CaptureEnv } from "./walk";

const isSlot = (n: Node): n is HTMLSlotElement =>
  n.nodeType === 1 && (n as Element).localName === "slot";

/**
 * Elements whose shadow root, if any, belongs to the browser (the inner editor of an input, the
 * controls of a video). Their roots are never read, whatever the environment's getShadowRoot
 * returns, so privacy does not depend on how the browser treats user-agent roots.
 */
const NON_AUTHOR_HOSTS = new Set([
  "input",
  "textarea",
  "select",
  "option",
  "video",
  "audio",
  "img",
  "canvas",
  "iframe",
  "meter",
  "progress",
  "details",
  "summary",
]);

/** The shadow root of an element, open or closed when the environment can reach closed ones. */
export function shadowRootOf(el: Element, env: CaptureEnv): ShadowRoot | null {
  if (NON_AUTHOR_HOSTS.has(el.localName)) return null;
  return env.getShadowRoot?.(el) ?? el.shadowRoot ?? null;
}

/** What a slot shows: the nodes assigned to it (a nested slot is resolved by `expand`), else its own fallback. */
function slotContents(
  slot: HTMLSlotElement,
  keepSlot: ((slot: Element) => boolean) | undefined
): Node[] {
  // Not `flatten: true`: that would look through a nested slot whatever its own display is.
  const assigned = slot.assignedNodes();
  return expand(assigned.length > 0 ? assigned : Array.from(slot.childNodes), keepSlot);
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

/**
 * Whether a person can type into `el`. Tests the attribute, not `isContentEditable`, so a page
 * with `designMode` on keeps its text. The value is matched as HTML does: any case.
 */
export function isEditable(el: Element): boolean {
  const value = el.getAttribute("contenteditable");
  return value !== null && value.toLowerCase() !== "false";
}

/** The parent in the flattened tree, as far as it can be reached: closed roots hide their slots. */
function flatParent(node: Node): Node | null {
  const slot = (node as Partial<Slottable>).assignedSlot;
  if (slot) return slot;
  const parent = node.parentNode;
  return parent?.nodeType === 11 && "host" in parent ? (parent as ShadowRoot).host : parent;
}

/** Whether `node` is editable, or shows inside something editable in the flattened tree. */
export function insideEditable(node: Node): boolean {
  for (let at: Node | null = node; at; at = flatParent(at)) {
    if (at.nodeType === 1 && isEditable(at as Element)) return true;
  }
  return false;
}
