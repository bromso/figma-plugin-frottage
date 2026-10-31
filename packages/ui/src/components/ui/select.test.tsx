import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

function TestSelect() {
  return (
    <Select>
      <SelectTrigger aria-label="Fruit">
        <SelectValue placeholder="Pick a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
        <SelectItem value="cherry">Cherry</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("Select interaction tests", () => {
  it("renders a trigger with the placeholder text", () => {
    render(<TestSelect />);
    expect(screen.getByLabelText("Fruit")).toBeInTheDocument();
  });

  it("opens the dropdown when clicked and shows options", async () => {
    render(<TestSelect />);
    const trigger = screen.getByLabelText("Fruit");
    await userEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Apple" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Banana" })).toBeInTheDocument();
  });

  it("renders data-size default, lg and sm on the trigger", () => {
    const { rerender } = render(
      <Select>
        <SelectTrigger aria-label="S">
          <SelectValue />
        </SelectTrigger>
      </Select>
    );
    expect(screen.getByLabelText("S")).toHaveAttribute("data-size", "default");

    rerender(
      <Select>
        <SelectTrigger aria-label="S" size="lg">
          <SelectValue />
        </SelectTrigger>
      </Select>
    );
    expect(screen.getByLabelText("S")).toHaveAttribute("data-size", "lg");

    rerender(
      <Select>
        <SelectTrigger aria-label="S" size="sm">
          <SelectValue />
        </SelectTrigger>
      </Select>
    );
    expect(screen.getByLabelText("S")).toHaveAttribute("data-size", "sm");
  });

  it("sets data-placeholder on the trigger when no value is selected", () => {
    render(<TestSelect />);
    expect(screen.getByLabelText("Fruit")).toHaveAttribute("data-placeholder");
  });

  it("disables the trigger when Select is disabled", () => {
    render(
      <Select disabled>
        <SelectTrigger aria-label="S">
          <SelectValue />
        </SelectTrigger>
      </Select>
    );
    expect(screen.getByLabelText("S")).toBeDisabled();
  });
});
