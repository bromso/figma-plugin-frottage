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

// A readable code name wins over a `data-slot`, a minified one loses to it (the adapters keep a
// minified one only on an element with a `data-slot`). The code's props are filtered first; the
// markers' fill only the keys they lack.
function fromCode(code: CodeComponent, el: Element): FoundComponent {
  const slot = markerName(el);
  const props = keepProps(code.props, markerProps(el));
  if (slot && isMinified(code.name)) {
    return { source: code.source, name: slot, props, codeName: code.name };
  }
  return { source: code.source, name: code.name, props };
}

function inside(el: Element, roots: Set<Element>): boolean {
  for (let up = el.parentElement; up; up = up.parentElement) if (roots.has(up)) return true;
  return false;
}

export function probeComponents(doc: Document): number {
  clearComponents(doc);
  const react = safely(findReact, doc);
  const vue = safely(findVue, doc);
  const found = new Map<Element, FoundComponent>();
  const codeNames = new Set<string>();
  const marked: Element[] = [];
  for (const el of doc.querySelectorAll("*")) {
    const code = react.get(el) ?? vue.get(el);
    if (!code) {
      if (el.hasAttribute("data-slot")) marked.push(el);
      continue;
    }
    // Reading the props can throw (a getter, a Proxy); that skips this element only.
    try {
      const component = fromCode(code, el);
      found.set(el, component);
      codeNames.add(component.name);
    } catch {}
  }
  // A `data-slot` alone names a component only on a page whose code names none, or where the code
  // names one the same: Astro's static Button joins the islands' Button, while Nuxt UI's parts
  // (`Wrapper`, `Label`, `Title`) stay layers. Inside a code-found component's root element a
  // `data-slot` marks a part of it (UButton's label span), never a component of its own.
  const codeRoots = new Set(found.keys());
  for (const el of marked) {
    const name = markerName(el);
    if (name && (codeNames.size === 0 || codeNames.has(name)) && !inside(el, codeRoots)) {
      found.set(el, { source: "marker", name, props: keepProps({}, markerProps(el)) });
    }
  }
  for (const [el, component] of found) el.setAttribute(ATTRIBUTE, JSON.stringify(component));
  return found.size;
}
