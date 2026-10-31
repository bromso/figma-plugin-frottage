import { afterEach, describe, expect, it, vi } from "bun:test";
import { render } from "@testing-library/react";
import type { StaticIconName, StaticIconNameMap } from "./icon";
import { ICONS, Icon, registerIcons } from "./icon";

describe("TYPE-02: Icon registration API", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  afterEach(() => {
    warnSpy.mockClear();
  });

  describe("ICONS const", () => {
    it("exposes typed icon name literals", () => {
      expect(ICONS.plus).toBe("lucide:plus");
      expect(ICONS.info).toBe("lucide:info");
      expect(ICONS.star).toBe("lucide:star");
    });

    it("values satisfy StaticIconName", () => {
      const _check: StaticIconName = ICONS.plus;
      expect(_check).toBeTruthy();
    });
  });

  describe("StaticIconNameMap", () => {
    it("StaticIconName is keyof StaticIconNameMap", () => {
      // Compile-time check: if StaticIconName were not keyof StaticIconNameMap,
      // this assignment would fail.
      const _name: keyof StaticIconNameMap = "lucide:plus";
      const _check: StaticIconName = _name;
      expect(_check).toBe("lucide:plus");
    });
  });

  describe("registerIcons()", () => {
    it("registers a collection and makes icons renderable", () => {
      const testCollection = {
        prefix: "test",
        icons: {
          check: {
            body: '<path d="M5 13l4 4L19 7"/>',
          },
        },
        width: 24,
        height: 24,
      };

      const result = registerIcons(testCollection);
      // addCollection from @iconify/react/offline returns void, but our
      // wrapper coerces to boolean for API consistency
      expect(result === undefined || result === true).toBe(true);

      // The icon should now render (it's in the registeredNames set)
      const { container } = render(<Icon name={"test:check" as StaticIconName} />);
      // Iconify offline renders an SVG when the icon is in its registry
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
    });
  });

  describe("unknown-name guard", () => {
    it("warns and returns null for unregistered icon names", () => {
      const { container } = render(<Icon name={"bogus:missing" as StaticIconName} />);

      // Should return null — no SVG rendered
      expect(container.querySelector("svg")).toBeNull();
      expect(container.innerHTML).toBe("");

      // Should have warned
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("bogus:missing"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("registerIcons"));
    });

    it("deduplicates warnings for the same unknown name", () => {
      const name = "dedup:test" as StaticIconName;

      render(<Icon name={name} />);
      render(<Icon name={name} />);
      render(<Icon name={name} />);

      // Should only warn once despite 3 renders
      const calls = warnSpy.mock.calls.filter((args) => String(args[0]).includes("dedup:test"));
      expect(calls).toHaveLength(1);
    });
  });
});
