import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { ATTRIBUTE, clearComponents, probeComponents } from "../index";
import { keepProps } from "../props";

function page(html: string) {
  const win = new Window();
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = html;
  return doc;
}

// A component function by name. Bun's transpiler may inline a one-use `const o = () => null`
// into an object literal, which renames the function after the property it lands in.
const named = (name: string) => Object.defineProperty(() => null, "name", { value: name });
const found = (el: Element | null) => JSON.parse(el?.getAttribute(ATTRIBUTE) ?? "null");
// What React leaves on a rendered element: its host fiber, whose `return` chain leads up through
// the components that rendered it.
// A forwardRef with a displayName, as Radix declares its parts.
const forwardRef = (displayName: string) => ({ $$typeof: 1, render: () => null, displayName });
const fiber = (el: Element | null, parent: object) =>
  Object.assign(el as object, {
    __reactFiber$x: { type: el?.tagName.toLowerCase(), return: parent },
  });

describe("probeComponents", () => {
  test("a minified React button takes its name from its data-slot and keeps its variant props", () => {
    const doc = page('<button data-slot="button">Go</button>');
    const o = named("o");
    const props = { variant: "outline", size: "icon", onClick: () => {}, className: "inline-flex" };
    fiber(doc.querySelector("button"), { type: o, memoizedProps: props });
    expect(probeComponents(doc)).toBe(1);
    expect(doc.querySelector("button")?.getAttribute(ATTRIBUTE)).toBe(
      '{"source":"react","name":"Button","props":{"variant":"outline","size":"icon"},"codeName":"o"}'
    );
  });

  test("a readable React name stands without a data-slot", () => {
    const doc = page("<div>Card</div>");
    function Card() {
      return null;
    }
    fiber(doc.querySelector("div"), { type: Card, memoizedProps: { children: "Card" } });
    probeComponents(doc);
    expect(found(doc.querySelector("div"))).toEqual({ source: "react", name: "Card", props: {} });
  });

  test("a Radix Primitive between the element and the component is passed through", () => {
    const doc = page('<button data-slot="button">Go</button>');
    const o = named("o");
    const primitive = {
      type: {
        $$typeof: Symbol.for("react.forward_ref"),
        render: () => null,
        displayName: "Primitive.button",
      },
      memoizedProps: { type: "button" },
      return: { type: o, memoizedProps: { variant: "ghost" } },
    };
    fiber(doc.querySelector("button"), primitive);
    probeComponents(doc);
    expect(found(doc.querySelector("button"))).toEqual({
      source: "react",
      name: "Button",
      props: { variant: "ghost" },
      codeName: "o",
    });
  });

  test("Radix slots, providers, presences and collections are passed through", () => {
    const names = [
      "Slot",
      "SlotClone",
      "Slottable",
      "Presence",
      "Portal",
      "Slot.Slot",
      "Slot.SlotClone",
      "AccordionCollectionSlot.SlotClone",
      "CollapsibleProvider",
      "NavigationMenuItemProvider",
      "CollapsibleContentImpl",
      "MenuContext",
      "ThemeConsumer",
      "MenuCollection",
      "__next_root_layout_boundary__",
      "Primitive.div",
      "Primitive",
      "AccordionImplSingle",
      "motion.div",
      "DefineReusableTemplate",
    ];
    const doc = page(names.map(() => "<div></div>").join(""));
    doc.querySelectorAll("div").forEach((div, i) => {
      fiber(div, { type: forwardRef(names[i] as string), memoizedProps: {} });
    });
    expect(probeComponents(doc)).toBe(0);
  });

  test('<Button asChild><a data-slot="button"> inside a TooltipTrigger stays Button', () => {
    const doc = page('<a data-slot="button" data-state="closed">Docs</a>');
    const a = doc.querySelector("a");
    // From the element up, as React renders shadcn's Button inside a TooltipTrigger `asChild`.
    const trigger = { type: named("TooltipTrigger"), memoizedProps: { asChild: true } };
    const radixTrigger = { type: forwardRef("TooltipTrigger"), memoizedProps: {}, return: trigger };
    const button = { type: named("o"), memoizedProps: { variant: "ghost", asChild: true } };
    Object.assign(button, { return: radixTrigger });
    const slot = { type: forwardRef("Slot.Slot"), memoizedProps: {}, return: button };
    const clone = { type: forwardRef("Slot.SlotClone"), memoizedProps: {}, return: slot };
    fiber(a, clone);
    expect(probeComponents(doc)).toBe(1);
    expect(found(a)).toEqual({
      source: "react",
      name: "Button",
      props: { variant: "ghost", asChild: true, state: "closed" },
      codeName: "o",
    });
  });

  test("a React trigger yields to another named component on its element, and stands alone", () => {
    const doc = page("<button>a</button><div>b</div>");
    const button = { type: named("IconButton"), memoizedProps: { size: "sm" } };
    const trigger = { type: named("PopoverTrigger"), memoizedProps: {}, return: button };
    fiber(doc.querySelector("button"), trigger);
    fiber(doc.querySelector("div"), { type: named("CollapsibleTrigger"), memoizedProps: {} });
    expect(probeComponents(doc)).toBe(2);
    expect(found(doc.querySelector("button")).name).toBe("IconButton");
    expect(found(doc.querySelector("div")).name).toBe("CollapsibleTrigger");
  });

  test("a minified name without a data-slot gives way to the next named component up", () => {
    const doc = page("<div>a</div><span>b</span>");
    function Card() {
      return null;
    }
    fiber(doc.querySelector("div"), {
      type: named("g"),
      memoizedProps: {},
      return: { type: Card, memoizedProps: { size: "sm" } },
    });
    fiber(doc.querySelector("span"), { type: named("g"), memoizedProps: {} });
    expect(probeComponents(doc)).toBe(1);
    expect(found(doc.querySelector("div"))).toEqual({
      source: "react",
      name: "Card",
      props: { size: "sm" },
    });
    expect(found(doc.querySelector("span"))).toBeNull();
  });

  test("a throwing getter or Proxy skips its element only", () => {
    const doc = page("<i>a</i><b>b</b><em>c</em>");
    function Icon() {
      return null;
    }
    function Bold() {
      return null;
    }
    const getter = Object.defineProperty({}, "variant", {
      enumerable: true,
      get() {
        throw new Error("no");
      },
    });
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("no");
        },
      }
    );
    fiber(doc.querySelector("i"), { type: Icon, memoizedProps: getter });
    fiber(doc.querySelector("b"), { type: Bold, memoizedProps: proxy });
    fiber(doc.querySelector("em"), { type: named("Emphasis"), memoizedProps: { tone: "loud" } });
    expect(probeComponents(doc)).toBe(1);
    expect(found(doc.querySelector("em")).name).toBe("Emphasis");
  });

  test("a hoisted fiber without an element is passed over when finding the first element", () => {
    const doc = page("<div>a</div>");
    const div = doc.querySelector("div");
    const card: Record<string, unknown> = { type: named("Card"), memoizedProps: {} };
    const divFiber = { type: "div", stateNode: div, return: card };
    card.child = { type: "title", stateNode: null, return: card, sibling: divFiber };
    Object.assign(div as object, { __reactFiber$z: divFiber });
    expect(probeComponents(doc)).toBe(1);
    expect(found(div).name).toBe("Card");
  });

  test("forwardRef and memo components are named from what they wrap", () => {
    const doc = page("<span>a</span><em>b</em>");
    function Badge() {
      return null;
    }
    function Label() {
      return null;
    }
    fiber(doc.querySelector("span"), { type: { $$typeof: 1, render: Badge }, memoizedProps: {} });
    fiber(doc.querySelector("em"), { type: { $$typeof: 2, type: Label }, memoizedProps: {} });
    probeComponents(doc);
    expect(found(doc.querySelector("span")).name).toBe("Badge");
    expect(found(doc.querySelector("em")).name).toBe("Label");
  });

  test("only a component's first element is tagged, not every element inside it", () => {
    const doc = page("<div><p>a</p><p>b</p></div>");
    function Card() {
      return null;
    }
    const card = { type: Card, memoizedProps: {} };
    const div = doc.querySelector("div");
    fiber(div, card);
    for (const p of doc.querySelectorAll("p"))
      fiber(p, (div as unknown as Record<string, object>).__reactFiber$x);
    expect(probeComponents(doc)).toBe(1);
    expect(found(div).name).toBe("Card");
  });

  test("a real fiber's first host element is the one tagged", () => {
    const doc = page("<i>icon</i><span>label</span>");
    function Chip() {
      return null;
    }
    const chip: Record<string, unknown> = { type: Chip, memoizedProps: { tone: "info" } };
    const [i, span] = [doc.querySelector("i"), doc.querySelector("span")];
    const iFiber = { type: "i", stateNode: i, return: chip };
    const spanFiber = { type: "span", stateNode: span, return: chip };
    Object.assign(iFiber, { sibling: spanFiber });
    chip.child = iFiber;
    // React's other copy of the component, reached from the second element after an update.
    const alternate = { ...chip, alternate: chip };
    chip.alternate = alternate;
    Object.assign(i as object, { __reactFiber$y: iFiber });
    Object.assign(span as object, { __reactFiber$y: { ...spanFiber, return: alternate } });
    expect(probeComponents(doc)).toBe(1);
    expect(found(i)).toEqual({ source: "react", name: "Chip", props: { tone: "info" } });
  });

  test("a Vue app's components are found from its root element", () => {
    const doc = page('<div id="app"><a href="/x">x</a></div>');
    const a = doc.querySelector("a");
    const link = {
      component: {
        type: { __name: "VTLink" },
        props: { href: "/x", noIcon: false },
        subTree: { el: a, children: "x" },
      },
      el: a,
    };
    const app = { _container: { _vnode: { children: [link] } } };
    Object.assign(doc.querySelector("#app") as object, { __vue_app__: app });
    expect(probeComponents(doc)).toBe(1);
    expect(a?.getAttribute(ATTRIBUTE)).toBe(
      '{"source":"vue","name":"VTLink","props":{"noIcon":false}}'
    );
  });

  test("Vue keeps the outermost component on a shared root and survives a cycle", () => {
    const doc = page('<div id="__nuxt"><a data-slot="base">x</a></div>');
    const a = doc.querySelector("a");
    const base = { el: a, component: { type: { name: "ULinkBase" }, props: {} } };
    const link = { el: a, component: { type: { name: "ULink" }, props: {}, subTree: base } };
    const button: Record<string, unknown> = {
      el: a,
      component: { type: { __name: "UButton" }, props: { size: "md" }, subTree: link },
    };
    // A vnode that leads back to itself.
    button.children = [button];
    const app = { _container: { _vnode: { children: [button] } } };
    Object.assign(doc.querySelector("#__nuxt") as object, { __vue_app__: app });
    expect(probeComponents(doc)).toBe(1);
    expect(found(a)).toEqual({ source: "vue", name: "UButton", props: { size: "md" } });
  });

  test("a Vue trigger yields to the component it wraps on the same element", () => {
    const doc = page('<div id="__nuxt"><button>x</button><span>y</span></div>');
    const [button, span] = [doc.querySelector("button"), doc.querySelector("span")];
    const ub = { el: button, component: { type: { name: "UButton" }, props: { size: "sm" } } };
    const tip = {
      el: button,
      component: { type: { name: "TooltipTrigger" }, props: {}, subTree: ub },
    };
    const alone = { el: span, component: { type: { name: "TooltipTrigger" }, props: {} } };
    const app = { _container: { _vnode: { children: [tip, alone] } } };
    Object.assign(doc.querySelector("#__nuxt") as object, { __vue_app__: app });
    expect(probeComponents(doc)).toBe(2);
    expect(found(button)).toEqual({ source: "vue", name: "UButton", props: { size: "sm" } });
    expect(found(span).name).toBe("TooltipTrigger");
  });

  test("a data-slot alone names a component only where the code names none or the same one", () => {
    const doc = page(
      '<button>Go</button><a data-slot="button" data-variant="ghost">x</a><span data-slot="label">y</span>'
    );
    function Button() {
      return null;
    }
    fiber(doc.querySelector("button"), { type: Button, memoizedProps: {} });
    expect(probeComponents(doc)).toBe(2);
    expect(found(doc.querySelector("a"))).toEqual({
      source: "marker",
      name: "Button",
      props: { variant: "ghost" },
    });
    expect(found(doc.querySelector("span"))).toBeNull();
  });

  test("a static shadcn element is named by its markers", () => {
    const doc = page(
      '<a data-slot="button" data-variant="ghost">x</a><div data-slot="card-content"></div>'
    );
    expect(probeComponents(doc)).toBe(2);
    expect(doc.querySelector("a")?.getAttribute(ATTRIBUTE)).toBe(
      '{"source":"marker","name":"Button","props":{"variant":"ghost"}}'
    );
    expect(found(doc.querySelector("div")).name).toBe("Card content");
  });

  test("marker props fill the props the code lacks", () => {
    const doc = page('<button data-slot="button" data-variant="ghost" data-size="sm">Go</button>');
    function Button() {
      return null;
    }
    fiber(doc.querySelector("button"), { type: Button, memoizedProps: { variant: "outline" } });
    probeComponents(doc);
    expect(found(doc.querySelector("button")).props).toEqual({ variant: "outline", size: "sm" });
  });

  test("clearComponents leaves no attribute, and a new probe starts clean", () => {
    const doc = page('<a data-slot="button">x</a><b data-slot="badge">y</b>');
    probeComponents(doc);
    doc.querySelector("b")?.removeAttribute("data-slot");
    expect(probeComponents(doc)).toBe(1);
    expect(doc.querySelectorAll(`[${ATTRIBUTE}]`).length).toBe(1);
    clearComponents(doc);
    expect(doc.querySelectorAll(`[${ATTRIBUTE}]`).length).toBe(0);
  });
});

describe("keepProps", () => {
  test("keeps booleans, finite numbers and short plain strings", () => {
    expect(keepProps({ variant: "outline", disabled: true, level: 2, size: "icon-sm" })).toEqual({
      variant: "outline",
      disabled: true,
      level: 2,
      size: "icon-sm",
    });
  });

  test("drops strings that can hold user data", () => {
    expect(
      keepProps({
        label: "Jonas Broms",
        defaultValue: "a@b.se",
        token: "abcdefghijklmnopqrstuvwxyz1234",
        empty: "",
      })
    ).toEqual({});
  });

  test("drops other values and the keys it never keeps", () => {
    const raw: Record<string, unknown> = {
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      obj: { a: 1 },
      nil: null,
      onClick: "x",
      "aria-label": "x",
      "data-state": "open",
    };
    for (const key of ["children", "className", "class", "style", "key", "ref", "id", "href"])
      raw[key] = "x";
    for (const key of ["src", "alt", "title", "value", "placeholder", "name"]) raw[key] = "x";
    expect(keepProps(raw)).toEqual({});
  });

  test("drops ids and the attributes a form or link carries", () => {
    const raw: Record<string, unknown> = {
      contentId: "radix-_R_mddbrlb_",
      triggerID: "a",
      id: "b",
    };
    for (const key of ["for", "htmlFor", "form", "target", "rel", "type"]) raw[key] = "x";
    expect(keepProps(raw)).toEqual({});
  });

  test("keeps keys that merely end in a lowercase id", () => {
    expect(keepProps({ valid: true, grid: "cols-2" })).toEqual({ valid: true, grid: "cols-2" });
  });

  test("the markers fill only the keys the code's kept props lack", () => {
    expect(
      keepProps({ variant: "outline", size: "a b" }, { variant: "ghost", size: "sm" })
    ).toEqual({ variant: "outline", size: "sm" });
  });

  test("keeps at most 16 props", () => {
    const raw = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, i]));
    expect(Object.keys(keepProps(raw))).toHaveLength(16);
  });
});
