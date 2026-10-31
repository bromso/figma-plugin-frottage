import { describe, expect, it, vi } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./input";

describe("Input interaction tests", () => {
  it("accepts typed text", async () => {
    render(<Input placeholder="Enter text" />);
    const input = screen.getByPlaceholderText("Enter text");
    await userEvent.type(input, "hello");
    expect(input).toHaveValue("hello");
  });

  it("fires onChange when typing", async () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} placeholder="Type here" />);
    const input = screen.getByPlaceholderText("Type here");
    await userEvent.type(input, "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("does not accept input when disabled", async () => {
    render(<Input disabled placeholder="Disabled" />);
    const input = screen.getByPlaceholderText("Disabled");
    await userEvent.type(input, "hello");
    expect(input).toHaveValue("");
  });

  it("reflects size on data-size and lets className override the height", () => {
    render(<Input size="lg" placeholder="L" />);
    expect(screen.getByPlaceholderText("L")).toHaveAttribute("data-size", "lg");
    render(<Input className="h-8" placeholder="H" />);
    const h = screen.getByPlaceholderText("H");
    expect(h.className).toContain("h-8");
    expect(h.className).not.toContain("h-6");
  });
});
