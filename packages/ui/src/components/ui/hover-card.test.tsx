import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";

describe("HoverCard interaction tests", () => {
  // HoverCard uses pointer events for hover which are difficult to simulate
  // reliably in happy-dom. We test that the controlled open state works.
  it("shows content when open is true", () => {
    render(
      <HoverCard open>
        <HoverCardTrigger>Hover me</HoverCardTrigger>
        <HoverCardContent>Card content</HoverCardContent>
      </HoverCard>
    );
    expect(screen.getByText("Card content")).toBeInTheDocument();
  });

  it("hides content when open is false", () => {
    render(
      <HoverCard open={false}>
        <HoverCardTrigger>Hover me</HoverCardTrigger>
        <HoverCardContent>Card content</HoverCardContent>
      </HoverCard>
    );
    expect(screen.queryByText("Card content")).not.toBeInTheDocument();
  });
});
