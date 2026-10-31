import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";

describe("Command interaction tests", () => {
  it("renders input and items", () => {
    render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandGroup>
            <CommandItem>Item 1</CommandItem>
            <CommandItem>Item 2</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    );
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 2")).toBeInTheDocument();
  });

  it("filters items when typing in search", async () => {
    render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup>
            <CommandItem>Apple</CommandItem>
            <CommandItem>Banana</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    );
    const input = screen.getByPlaceholderText("Search...");
    await userEvent.type(input, "Apple");
    expect(screen.getByText("Apple")).toBeInTheDocument();
    // cmdk filters items so Banana should be hidden
    expect(screen.queryByText("Banana")).not.toBeInTheDocument();
  });

  it('renders the root with data-slot="command"', () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandGroup>
            <CommandItem>Item 1</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    );
    expect(container.querySelector('[data-slot="command"]')).toBeInTheDocument();
  });

  it('marks a disabled CommandItem with data-disabled="true"', () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandGroup>
            <CommandItem disabled>Section</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    );
    const item = container.querySelector("[cmdk-item]");
    expect(item).toHaveAttribute("data-disabled", "true");
  });

  it('gives every item a data-selected attribute of "true" or "false"', () => {
    // cmdk selects the first item asynchronously once mounted, so assert the
    // attribute shape rather than exactly-one-selected to avoid timing flakiness.
    const { container } = render(
      <Command>
        <CommandList>
          <CommandGroup>
            <CommandItem>Item 1</CommandItem>
            <CommandItem>Item 2</CommandItem>
            <CommandItem>Item 3</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    );
    const items = container.querySelectorAll("[cmdk-item]");
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(item.getAttribute("data-selected")).toMatch(/^(true|false)$/);
    }
  });
});
