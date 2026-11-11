// Finds a page's components and their props, in the page's own JavaScript world, and tags each
// one's root element with them for the capture to read.
import { ATTRIBUTE, clearComponents, type FoundComponent } from "./attribute";
import { markerName, markerProps } from "./markers";
import { type CodeComponent, isMinified } from "./names";
import { keepProps } from "./props";
import { findReact } from "./react";
import { findVue } from "./vue";

export { ATTRIBUTE, clearComponents, type FoundComponent } from "./attribute";
export { keepProps } from "./props";

// One adapter failing on an odd page leaves the others' finds.
function safely(find: (doc: Document) => Map<Element, CodeComponent>, doc: Document) {
  try {
    return find(doc);
  } catch {
    return new Map<Element, CodeComponent>();
  }
}

// A readable code name wins over a `data-slot`, a minified one loses to it; marker props fill the
// props the code lacks.
function merge(code: CodeComponent | undefined, el: Element): FoundComponent | null {
  const slot = markerName(el);
  const marked = markerProps(el);
  if (!code) return slot ? { source: "marker", name: slot, props: keepProps(marked) } : null;
  const name = slot && isMinified(code.name) ? slot : code.name;
  return { source: code.source, name, props: keepProps({ ...marked, ...code.props }) };
}

export function probeComponents(doc: Document): number {
  clearComponents(doc);
  const react = safely(findReact, doc);
  const vue = safely(findVue, doc);
  let count = 0;
  for (const el of doc.querySelectorAll("*")) {
    const found = merge(react.get(el) ?? vue.get(el), el);
    if (!found) continue;
    el.setAttribute(ATTRIBUTE, JSON.stringify(found));
    count++;
  }
  return count;
}
