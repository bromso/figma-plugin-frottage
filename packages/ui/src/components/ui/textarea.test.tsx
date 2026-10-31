import { describe, expect, it, vi } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "./textarea";

describe("Textarea interaction tests", () => {
  it("accepts typed text", async () => {
    render(<Textarea placeholder="Enter text" />);
    const textarea = screen.getByPlaceholderText("Enter text");
    await userEvent.type(textarea, "hello world");
    expect(textarea).toHaveValue("hello world");
  });

  it("fires onChange when typing", async () => {
    const onChange = vi.fn();
    render(<Textarea onChange={onChange} placeholder="Type here" />);
    await userEvent.type(screen.getByPlaceholderText("Type here"), "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("does not accept input when disabled", async () => {
    render(<Textarea disabled placeholder="Disabled" />);
    const textarea = screen.getByPlaceholderText("Disabled");
    await userEvent.type(textarea, "hello");
    expect(textarea).toHaveValue("");
  });
});
