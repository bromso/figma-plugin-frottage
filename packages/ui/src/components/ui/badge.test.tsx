import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders a span with data-slot and the default variant", () => {
    render(<Badge>New</Badge>);
    const el = screen.getByText("New");
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveAttribute("data-slot", "badge");
    expect(el).toHaveAttribute("data-variant", "default");
  });

  it("reflects the variant prop in data-variant", () => {
    render(<Badge variant="destructive">Err</Badge>);
    expect(screen.getByText("Err")).toHaveAttribute("data-variant", "destructive");
  });

  it("renders the child element with asChild", () => {
    render(
      <Badge asChild>
        <a href="#x">Badge link</a>
      </Badge>
    );
    expect(screen.getByRole("link", { name: "Badge link" })).toHaveAttribute("data-slot", "badge");
  });
});
