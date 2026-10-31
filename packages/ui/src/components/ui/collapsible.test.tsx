import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

describe("Collapsible interaction tests", () => {
  it("shows content when trigger is clicked", async () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Hidden content</CollapsibleContent>
      </Collapsible>
    );
    expect(screen.queryByText("Hidden content")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Toggle"));
    expect(screen.getByText("Hidden content")).toBeInTheDocument();
  });

  it("hides content when trigger is clicked again", async () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Hidden content</CollapsibleContent>
      </Collapsible>
    );
    await userEvent.click(screen.getByText("Toggle"));
    expect(screen.getByText("Hidden content")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Toggle"));
    expect(screen.queryByText("Hidden content")).not.toBeInTheDocument();
  });
});
