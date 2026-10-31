import { describe, expect, it, vi } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./switch";

describe("Switch interaction tests", () => {
  it("toggles on when clicked", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange} aria-label="Toggle" />);
    await userEvent.click(screen.getByRole("switch", { name: "Toggle" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("toggles off when clicked twice", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange} aria-label="Toggle" />);
    const toggle = screen.getByRole("switch", { name: "Toggle" });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it("does not toggle when disabled", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange} disabled aria-label="Toggle" />);
    await userEvent.click(screen.getByRole("switch", { name: "Toggle" }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("renders data-size=default by default and data-size=sm when size is sm", () => {
    const { rerender } = render(<Switch aria-label="Toggle" />);
    expect(screen.getByRole("switch", { name: "Toggle" })).toHaveAttribute("data-size", "default");

    rerender(<Switch size="sm" aria-label="Toggle" />);
    expect(screen.getByRole("switch", { name: "Toggle" })).toHaveAttribute("data-size", "sm");
  });

  it("renders as checked on the root and thumb when defaultChecked is true", () => {
    render(<Switch defaultChecked aria-label="Toggle" />);
    const root = screen.getByRole("switch", { name: "Toggle" });
    expect(root).toHaveAttribute("data-state", "checked");
    expect(root.querySelector('[data-slot="switch-thumb"]')).toHaveAttribute(
      "data-state",
      "checked"
    );
  });

  it("sets data-disabled on the root when disabled", () => {
    render(<Switch disabled aria-label="Toggle" />);
    expect(screen.getByRole("switch", { name: "Toggle" })).toHaveAttribute("data-disabled");
  });

  it("toggles aria-checked when Space is pressed on the focused switch", async () => {
    render(<Switch aria-label="Toggle" />);
    const root = screen.getByRole("switch", { name: "Toggle" });
    expect(root).toHaveAttribute("aria-checked", "false");
    root.focus();
    await userEvent.keyboard(" ");
    expect(root).toHaveAttribute("aria-checked", "true");
  });
});
