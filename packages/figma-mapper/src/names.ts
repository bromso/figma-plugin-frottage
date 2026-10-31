import type { CaptureNode, ElementNode } from "@repo/capture-schema";

const MAX = 40;
/** How many nodes are looked at below an element when reading its text. */
const SCAN = 40;

const LANDMARKS: Record<string, string> = {
  banner: "Header",
  navigation: "Navigation",
  main: "Main",
  contentinfo: "Footer",
  complementary: "Aside",
  form: "Form",
  search: "Search",
  region: "Region",
};

const ROLES: Record<string, string> = {
  ...LANDMARKS,
  dialog: "Dialog",
  alertdialog: "Dialog",
  alert: "Alert",
  button: "Button",
  link: "Link",
  list: "List",
  listitem: "Item",
  tab: "Tab",
  tablist: "Tabs",
  tabpanel: "Tab panel",
  menu: "Menu",
  menuitem: "Menu item",
  menubar: "Menu",
  tooltip: "Tooltip",
  table: "Table",
  row: "Row",
  cell: "Cell",
  img: "Image",
  figure: "Figure",
  heading: "Heading",
  checkbox: "Checkbox",
  switch: "Switch",
  radio: "Radio",
  textbox: "Input",
  combobox: "Select",
  listbox: "List",
  option: "Option",
  progressbar: "Progress",
};

const TAGS: Record<string, string> = {
  ul: "List",
  ol: "List",
  li: "Item",
  p: "Paragraph",
  section: "Section",
  article: "Article",
  aside: "Aside",
  header: "Header",
  footer: "Footer",
  nav: "Navigation",
  main: "Main",
  a: "Link",
  button: "Button",
  form: "Form",
  table: "Table",
  thead: "Table head",
  tbody: "Table body",
  tr: "Row",
  td: "Cell",
  th: "Cell",
  label: "Label",
  input: "Input",
  textarea: "Input",
  select: "Select",
  figure: "Figure",
  figcaption: "Caption",
  blockquote: "Quote",
  pre: "Code",
  code: "Code",
  fieldset: "Group",
  legend: "Legend",
  dialog: "Dialog",
  details: "Details",
  summary: "Summary",
  picture: "Image",
  video: "Video",
  canvas: "Canvas",
  iframe: "Embed",
  hr: "Divider",
  svg: "Icon",
  img: "Image",
  dl: "Definitions",
  dt: "Term",
  dd: "Definition",
  body: "Page",
  html: "Page",
};

const PLACEHOLDERS: Record<string, string> = {
  canvas: "Canvas",
  video: "Video",
  "cross-origin-iframe": "Embed",
  "blocked-image": "Image",
};

const INTERACTIVE = new Set(["a", "button", "summary"]);
const CLASS_STOP = new Set([
  "flex",
  "grid",
  "row",
  "col",
  "cols",
  "column",
  "container",
  "wrapper",
  "wrap",
  "inner",
  "outer",
  "block",
  "inline",
  "hidden",
  "show",
  "hide",
  "relative",
  "absolute",
  "fixed",
  "sticky",
  "clearfix",
  "active",
  "open",
  "closed",
  "disabled",
  "selected",
  "visible",
  "left",
  "right",
  "center",
  "centered",
  "first",
  "last",
  "item",
  "items",
  "box",
  "group",
  "stack",
  "full",
  "auto",
  "static",
  "bold",
]);
const UTILITY =
  /^-?(?:m|p|w|h|gap|text|bg|border|rounded|flex|grid|col|row|items|justify|self|space|font|leading|tracking|min|max|top|left|right|bottom|z|order|opacity|shadow|overflow|ring|inset|basis|grow|shrink|display|d|align|float|object|cursor|transition|duration|translate|rotate|scale|sm|md|lg|xl|container|is|has|u|js)[xytrbl]?[-_]/i;
const HASH_PREFIX = /^(?:css|sc|jsx|svelte|astro|emotion|styled|chakra|mui)[-_]/i;

/** A class token that looks generated: it mixes digits and letters, or carries a CSS-in-JS prefix. */
function looksHashed(token: string): boolean {
  return (/\d/.test(token) && /[a-z]/i.test(token)) || HASH_PREFIX.test(token) || /^_/.test(token);
}

/** The words of a readable class, or null for hashed, utility or layout-only classes. */
function classWords(raw: string | undefined): string | null {
  if (!raw || raw.length > MAX || !/^[A-Za-z][\w-]*$/.test(raw)) return null;
  if (looksHashed(raw) || CLASS_STOP.has(raw.toLowerCase()) || UTILITY.test(raw)) return null;
  const words = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[-_]+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.length >= 3 ? sentence(words) : null;
}

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function strip(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}"'“$€£(]+/u, "")
    .replace(/[\s\-–—.,:;!?|/\\…]+$/, "");
}

/** Whitespace collapsed, trailing punctuation gone, cut on a word at 40 characters, no ellipsis. */
function clip(raw: string): string {
  const s = strip(raw);
  if (s.length <= MAX) return s;
  const head = s.slice(0, MAX);
  let cut = head;
  if (!/\s/.test(s.charAt(MAX))) {
    const space = head.lastIndexOf(" ");
    if (space > 0) cut = head.slice(0, space);
  }
  return strip(cut);
}

type Found = { texts: string[]; heading: string | undefined; complete: boolean };

/** Reads the first pieces of text below an element, bounded so a huge subtree stays cheap. */
function scan(node: CaptureNode): Found {
  const found: Found = { texts: [], heading: undefined, complete: true };
  let seen = 0;
  const stack: CaptureNode[] = node.kind === "element" ? [...node.children].reverse() : [];
  while (stack.length > 0) {
    const n = stack.pop() as CaptureNode;
    if (++seen > SCAN) {
      found.complete = false;
      break;
    }
    if (n.kind === "text") {
      const t = strip(n.text);
      if (t) {
        found.texts.push(t);
        if (found.heading === undefined && /^h[1-6]$/.test(n.semantic.tag)) found.heading = t;
      }
    } else if (n.kind === "element") {
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as CaptureNode);
    }
  }
  return found;
}

const signature = (n: CaptureNode): string =>
  `${n.kind}:${n.semantic.tag}:${n.semantic.className ?? ""}`;

function repeatIndex(node: CaptureNode, siblings: CaptureNode[]): number | null {
  const sig = signature(node);
  const group = siblings.filter((s) => signature(s) === sig);
  if (group.length < 2) return null;
  const at = group.findIndex((s) => s.id === node.id);
  return at < 0 ? null : at + 1;
}

function customName(tag: string): string | null {
  if (!tag.includes("-") || tag.startsWith("::")) return null;
  const parts = tag.split("-").filter(Boolean);
  const rest = parts.length > 1 && (parts[0] as string).length <= 5 ? parts.slice(1) : parts;
  return sentence(rest.join(" ").toLowerCase());
}

const join = (prefix: string, text: string | undefined): string =>
  text ? clip(`${prefix} - ${text}`) : prefix;

function tagWord(tag: string): string {
  const known = TAGS[tag];
  if (known) return known;
  if (/^h[1-6]$/.test(tag)) return tag.toUpperCase();
  const bare = tag.replace(/^[^a-zA-Z0-9]+/, "");
  return bare ? sentence(bare) : "Frame";
}

function elementName(node: ElementNode, siblings: CaptureNode[]): string {
  const s = node.semantic;
  const tag = s.tag;
  const label = s.ariaLabel ? clip(s.ariaLabel) : "";
  const landmark = s.landmark ? LANDMARKS[s.landmark] : undefined;
  const role = s.role ? ROLES[s.role.toLowerCase()] : undefined;

  if (landmark) return join(landmark, label);
  if (/^h[1-6]$/.test(tag)) return join(tag.toUpperCase(), label || scan(node).texts[0]);
  if (INTERACTIVE.has(tag)) {
    const found = scan(node);
    return join(TAGS[tag] as string, label || found.heading || found.texts[0]);
  }
  if (label) return role && role !== "Heading" ? join(role, label) : label;
  if (role) return role;
  const custom = customName(tag);
  if (custom) {
    const found = scan(node);
    return join(custom, found.texts.length === 1 ? found.texts[0] : undefined);
  }
  const cls = classWords(s.className);
  if (cls) return cls;
  if (tag === "li") {
    const n = repeatIndex(node, siblings);
    return n === null ? "Item" : `Item ${n}`;
  }
  const found = scan(node);
  if (found.heading) {
    const kind =
      tag === "section"
        ? "Section"
        : tag === "article"
          ? "Article"
          : node.box.w < 480
            ? "Card"
            : "Section";
    return join(kind, found.heading);
  }
  if (found.texts.length === 1 && found.complete && !TAGS[tag])
    return clip(found.texts[0] as string);
  const n = TAGS[tag] ? null : repeatIndex(node, siblings);
  if (n !== null) return `Item ${n}`;
  return tagWord(tag);
}

/**
 * The layer name for a captured node. `siblings` are the nodes it sits among (as the mapper walks
 * them), so repeated items can be numbered. With `htmlNames` an element is `tag.class`, or `tag`.
 */
export function layerName(
  node: CaptureNode,
  siblings: CaptureNode[],
  options: { htmlNames: boolean }
): string {
  const s = node.semantic;
  switch (node.kind) {
    case "text":
      if (/^h[1-6]$/.test(s.tag)) return "Heading";
      return clip(node.text) || "Text";
    case "image":
      return join("Image", s.alt ? clip(s.alt) : undefined);
    case "svg":
      return join(node.box.w <= 64 && node.box.h <= 64 ? "Icon" : "Graphic", s.ariaLabel);
    case "placeholder":
      return join(
        PLACEHOLDERS[node.placeholderKind] ?? "Placeholder",
        s.alt ? clip(s.alt) : undefined
      );
    case "element": {
      if (options.htmlNames) {
        const tag = s.tag.replace(/^[^a-zA-Z0-9]+/, "") || s.tag;
        const cls =
          s.className && /^[A-Za-z][\w-]*$/.test(s.className) && !looksHashed(s.className);
        return cls ? `${tag}.${s.className}` : tag;
      }
      return elementName(node, siblings) || "Frame";
    }
  }
}

const BARE = new Set([
  "div",
  "span",
  "frame",
  "group",
  "text",
  "svg",
  "rectangle",
  "placeholder",
  "before",
  "after",
  "graphic",
]);

/** Readable means a person could tell the layer apart: not a bare tag, a tag.class or `Component 5`. */
export function isReadableName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n === "" || BARE.has(n)) return false;
  if (/^component \d+$/.test(n)) return false;
  if (/^[a-z][a-z0-9-]*\.[\w-]+$/.test(n)) return false;
  return true;
}
