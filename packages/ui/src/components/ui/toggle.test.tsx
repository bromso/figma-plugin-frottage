import { describe, expect, it, vi } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toggle } from "./toggle";

describe("Toggle interaction tests", () => {
  it("toggles pressed state when clicked", async () => {
    const onPressedChange = vi.fn();
    render(
      <Toggle onPressedChange={onPressedChange} aria-label="Bold">
        B
      </Toggle>
    );
    const toggle = screen.getByRole("button", { name: "Bold" });
    await userEvent.click(toggle);
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it("toggles off when clicked again", async () => {
    const onPressedChange = vi.fn();
    render(
      <Toggle onPressedChange={onPressedChange} aria-label="Bold">
        B
      </Toggle>
    );
    const toggle = screen.getByRole("button", { name: "Bold" });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(onPressedChange).toHaveBeenLastCalledWith(false);
  });

  it("does not toggle when disabled", async () => {
    const onPressedChange = vi.fn();
    render(
      <Toggle onPressedChange={onPressedChange} disabled aria-label="Bold">
        B
      </Toggle>
    );
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onPressedChange).not.toHaveBeenCalled();
  });
});
