import { describe, expect, test } from "bun:test";
import { flatChildren } from "../flatten";

// The package tests run without a DOM, so these are structural fakes of the few members used.
type Fake = Record<string, unknown>;
const text = (value: string): Fake => ({ nodeType: 3, nodeValue: value });
const el = (localName: string, childNodes: Fake[] = [], extra: Fake = {}): Fake => ({
  nodeType: 1,
  localName,
  namespaceURI: "http://www.w3.org/1999/xhtml",
  childNodes,
  ...extra,
});
const slot = (assigned: Fake[], fallback: Fake[] = []): Fake =>
  el("slot", fallback, { assignedNodes: () => assigned });
const asNode = (n: Fake) => n as unknown as Node;
const asEl = (n: Fake) => n as unknown as Element;
const env = { now: () => "x", toolVersion: "t" };

describe("flatChildren", () => {
  test("returns the child nodes of an element without a shadow root", () => {
    const a = text("a");
    const b = el("b");
    expect(flatChildren(asEl(el("div", [a, b])), env)).toEqual([asNode(a), asNode(b)]);
  });

  test("uses the shadow root's children and ignores the light children", () => {
    const light = text("light");
    const shadowText = text("shadow");
    const host = el("x-a", [light], { shadowRoot: { childNodes: [shadowText] } });
    expect(flatChildren(asEl(host), env)).toEqual([asNode(shadowText)]);
  });

  test("getShadowRoot wins over shadowRoot, so closed roots are reached", () => {
    const closed = text("closed");
    const host = el("x-a", [], { shadowRoot: null });
    const result = flatChildren(asEl(host), {
      ...env,
      getShadowRoot: () => ({ childNodes: [closed] }) as unknown as ShadowRoot,
    });
    expect(result).toEqual([asNode(closed)]);
  });

  test("replaces a slot with its assigned nodes", () => {
    const assigned = [text("one"), el("b")];
    const before = text("before");
    const host = el("x-a", [], { shadowRoot: { childNodes: [before, slot(assigned)] } });
    expect(flatChildren(asEl(host), env)).toEqual([before, ...assigned].map(asNode));
  });

  test("an unassigned slot yields its fallback children", () => {
    const fallback = text("Fallback copy");
    const host = el("x-a", [], { shadowRoot: { childNodes: [slot([], [fallback])] } });
    expect(flatChildren(asEl(host), env)).toEqual([asNode(fallback)]);
  });

  test("a nested unassigned slot inside fallback content is resolved too", () => {
    const deep = text("deep");
    const inner = slot([deep]);
    const host = el("x-a", [], { shadowRoot: { childNodes: [slot([], [inner])] } });
    expect(flatChildren(asEl(host), env)).toEqual([asNode(deep)]);
  });

  test("keepSlot leaves a slot in place", () => {
    const s = slot([text("x")]);
    const host = el("x-a", [], { shadowRoot: { childNodes: [s] } });
    expect(flatChildren(asEl(host), env, () => true)).toEqual([asNode(s)]);
  });

  test("the children of a slot element are its assigned nodes, or its fallback", () => {
    const assigned = text("a");
    expect(flatChildren(asEl(slot([assigned])), env)).toEqual([asNode(assigned)]);
    const fb = text("fb");
    expect(flatChildren(asEl(slot([], [fb])), env)).toEqual([asNode(fb)]);
  });
});
