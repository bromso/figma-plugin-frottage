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
      '{"source":"react","name":"Button","props":{"variant":"outline","size":"icon"}}'
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
    });
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

  test("keeps at most 16 props", () => {
    const raw = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, i]));
    expect(Object.keys(keepProps(raw))).toHaveLength(16);
  });
});
