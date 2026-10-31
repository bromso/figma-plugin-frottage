import { describe, expect, it, vi } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadioGroup, RadioGroupItem } from "./radio-group";

describe("RadioGroup interaction tests", () => {
  it("selects an option when clicked", async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup onValueChange={onValueChange}>
        <RadioGroupItem value="a" aria-label="Option A" />
        <RadioGroupItem value="b" aria-label="Option B" />
      </RadioGroup>
    );
    await userEvent.click(screen.getByRole("radio", { name: "Option A" }));
    expect(onValueChange).toHaveBeenCalledWith("a");
  });

  it("switches selection between options", async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup onValueChange={onValueChange}>
        <RadioGroupItem value="a" aria-label="Option A" />
        <RadioGroupItem value="b" aria-label="Option B" />
      </RadioGroup>
    );
    await userEvent.click(screen.getByRole("radio", { name: "Option A" }));
    await userEvent.click(screen.getByRole("radio", { name: "Option B" }));
    expect(onValueChange).toHaveBeenLastCalledWith("b");
  });

  it("does not select a disabled item", async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup defaultValue="a" onValueChange={onValueChange}>
        <RadioGroupItem value="a" aria-label="A" />
        <RadioGroupItem value="b" aria-label="B" disabled />
      </RadioGroup>
    );
    const b = screen.getByRole("radio", { name: "B" });
    expect(b).toBeDisabled();
    await userEvent.click(b);
    expect(onValueChange).not.toHaveBeenCalledWith("b");
  });

  it("moves selection with the arrow keys", async () => {
    render(
      <RadioGroup defaultValue="a">
        <RadioGroupItem value="a" aria-label="A" />
        <RadioGroupItem value="b" aria-label="B" />
      </RadioGroup>
    );
    screen.getByRole("radio", { name: "A" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "B" }));
  });

  it("renders an indicator only inside the selected item", () => {
    const { container } = render(
      <RadioGroup defaultValue="a">
        <RadioGroupItem value="a" aria-label="A" />
        <RadioGroupItem value="b" aria-label="B" />
      </RadioGroup>
    );
    const indicators = container.querySelectorAll('[data-slot="radio-group-indicator"]');
    expect(indicators.length).toBe(1);
    expect(screen.getByRole("radio", { name: "A" }).contains(indicators[0])).toBe(true);
  });
});
