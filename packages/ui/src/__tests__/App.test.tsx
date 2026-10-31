import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../app";

describe("App (component sampler)", () => {
  it("renders the panel sections", () => {
    render(<App />);
    expect(screen.getByText("Layer")).toBeInTheDocument();
    expect(screen.getByText("Options")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
  });

  it("renders the primary action", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("renders the tab bar", () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: "Design" })).toBeInTheDocument();
  });

  it("switches to the Prototype tab", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Prototype" }));
    expect(screen.getByText("Prototype settings go here.")).toBeInTheDocument();
  });

  it("opens the info tooltip on hover", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.hover(screen.getByRole("button", { name: "More info" }));
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
  });
});
