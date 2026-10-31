import { describe, expect, it, vi } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./checkbox";

describe("Checkbox interaction tests", () => {
  it("toggles checked state when clicked", async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox onCheckedChange={onCheckedChange} />);
    const checkbox = screen.getByRole("checkbox");
    await userEvent.click(checkbox);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("does not toggle when disabled", async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox onCheckedChange={onCheckedChange} disabled />);
    const checkbox = screen.getByRole("checkbox");
    await userEvent.click(checkbox);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("renders as checked when defaultChecked is true", () => {
    render(<Checkbox defaultChecked />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("data-state", "checked");
  });

  it("renders the minus icon for an uncontrolled indeterminate state", () => {
    render(<Checkbox defaultChecked="indeterminate" aria-label="Mixed" />);
    const box = screen.getByRole("checkbox", { name: "Mixed" });
    expect(box).toHaveAttribute("aria-checked", "mixed");
    expect(box).toHaveAttribute("data-state", "indeterminate");
    expect(box.querySelector("svg.lucide-minus")).not.toBeNull();
    expect(box.querySelector("svg.lucide-check")).not.toBeNull();
  });
});
