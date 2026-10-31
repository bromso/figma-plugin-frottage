import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { Icon } from "./icon";

describe("BUG-04: Icon component (iconify offline)", () => {
  it("renders a preloaded lucide:plus icon as an inline svg", () => {
    const { container } = render(<Icon name="lucide:plus" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // Iconify adds the `iconify` class on the root svg; the offline
    // bundle also merges caller className, so our `size-4` must land.
    expect(svg?.getAttribute("class") ?? "").toMatch(/size-4/);
  });

  it("renders lucide:info and lucide:star without throwing", () => {
    const infoResult = render(<Icon name="lucide:info" />);
    expect(infoResult.container.querySelector("svg")).not.toBeNull();
    const starResult = render(<Icon name="lucide:star" />);
    expect(starResult.container.querySelector("svg")).not.toBeNull();
  });

  it("applies animate-spin when spin is true", () => {
    const { container } = render(<Icon name="lucide:plus" spin />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class") ?? "").toMatch(/animate-spin/);
  });

  it("rejects unknown names at compile time (type narrowing)", () => {
    // @ts-expect-error — 'lucide:unknown' is not in StaticIconName
    const el = <Icon name="lucide:unknown" />;
    expect(el).toBeTruthy();
  });
});
