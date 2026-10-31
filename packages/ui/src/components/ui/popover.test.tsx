import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

describe("Popover interaction tests", () => {
  it("opens when trigger is clicked", async () => {
    render(
      <Popover>
        <PopoverTrigger>Open Popover</PopoverTrigger>
        <PopoverContent>Popover content here</PopoverContent>
      </Popover>
    );
    expect(screen.queryByText("Popover content here")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Open Popover"));
    expect(screen.getByText("Popover content here")).toBeInTheDocument();
  });

  it("closes when trigger is clicked again", async () => {
    render(
      <Popover>
        <PopoverTrigger>Open Popover</PopoverTrigger>
        <PopoverContent>Popover content here</PopoverContent>
      </Popover>
    );
    await userEvent.click(screen.getByText("Open Popover"));
    expect(screen.getByText("Popover content here")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Open Popover"));
    expect(screen.queryByText("Popover content here")).not.toBeInTheDocument();
  });
});
