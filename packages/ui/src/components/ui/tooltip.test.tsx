import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

describe("Tooltip interaction tests", () => {
  it("renders trigger element", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    expect(screen.getByText("Hover me")).toBeInTheDocument();
  });

  it("shows tooltip content when open is controlled", () => {
    const { container } = render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const tooltipContent = container.ownerDocument.querySelector('[data-slot="tooltip-content"]');
    expect(tooltipContent).toBeInTheDocument();
    expect(tooltipContent?.textContent).toContain("Tooltip text");
  });

  it("hides tooltip content when open is false", () => {
    const { container } = render(
      <TooltipProvider>
        <Tooltip open={false}>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const tooltipContent = container.ownerDocument.querySelector('[data-slot="tooltip-content"]');
    expect(tooltipContent).not.toBeInTheDocument();
  });

  it("renders the dark UI3 surface and the arrow", () => {
    const { container } = render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const content = container.ownerDocument.querySelector('[data-slot="tooltip-content"]');
    expect(content).toBeInTheDocument();
    expect(content?.className).toContain("bg-figma-bg-tooltip");
    const arrow = content?.querySelector("svg");
    expect(arrow).toBeInTheDocument();
    expect(arrow?.getAttribute("width")).toBe("12");
    expect(arrow?.getAttribute("height")).toBe("6");
  });

  it("lets className override the max width", () => {
    const { container } = render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent className="max-w-none">Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const content = container.ownerDocument.querySelector('[data-slot="tooltip-content"]');
    expect(content?.className).toContain("max-w-none");
    expect(content?.className).not.toContain("max-w-[200px]");
  });
});
