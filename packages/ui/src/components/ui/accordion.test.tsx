import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion";

function TestAccordion() {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="item-1">
        <AccordionTrigger>Section One</AccordionTrigger>
        <AccordionContent>Content of section one</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Section Two</AccordionTrigger>
        <AccordionContent>Content of section two</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

describe("Accordion interaction tests", () => {
  it("expands content when trigger is clicked", async () => {
    render(<TestAccordion />);
    const trigger = screen.getByRole("button", { name: "Section One" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses when clicking the same trigger again", async () => {
    render(<TestAccordion />);
    const trigger = screen.getByRole("button", { name: "Section One" });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("only one item is expanded at a time in single mode", async () => {
    render(<TestAccordion />);
    const t1 = screen.getByRole("button", { name: "Section One" });
    const t2 = screen.getByRole("button", { name: "Section Two" });
    await userEvent.click(t1);
    expect(t1).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(t2);
    expect(t2).toHaveAttribute("aria-expanded", "true");
    expect(t1).toHaveAttribute("aria-expanded", "false");
  });
});
