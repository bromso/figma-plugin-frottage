import { describe, expect, it, vi } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./context-menu";

describe("ContextMenu interaction tests", () => {
  it("opens on right-click", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Item 1</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
    fireEvent.contextMenu(screen.getByText("Right click me"));
    expect(document.querySelector('[data-slot="context-menu-content"]')).toBeInTheDocument();
  });

  it("renders trigger content", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Item 1</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
    expect(screen.getByText("Right click me")).toBeInTheDocument();
  });

  it("renders menu items when menu is open", async () => {
    const onSelect = vi.fn();
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onSelect}>Copy</ContextMenuItem>
          <ContextMenuItem>Paste</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
    fireEvent.contextMenu(screen.getByText("Right click me"));
    const copyItem = screen.getByText("Copy");
    await userEvent.click(copyItem);
    expect(onSelect).toHaveBeenCalled();
  });

  it("renders a checked checkbox item with data-state=checked", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem checked>Show rulers</ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
    );
    fireEvent.contextMenu(screen.getByText("Right click me"));
    expect(screen.getByText("Show rulers")).toHaveAttribute("data-state", "checked");
  });

  it("marks a disabled item and blocks onSelect", async () => {
    const onSelect = vi.fn();
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled onSelect={onSelect}>
            Flatten
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
    fireEvent.contextMenu(screen.getByText("Right click me"));
    expect(screen.getByText("Flatten")).toHaveAttribute("data-disabled");
    await userEvent.click(screen.getByText("Flatten"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders the destructive variant with data-variant", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
    fireEvent.contextMenu(screen.getByText("Right click me"));
    expect(screen.getByText("Delete")).toHaveAttribute("data-variant", "destructive");
  });
});
