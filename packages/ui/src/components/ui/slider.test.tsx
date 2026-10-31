import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Slider } from "./slider";

describe("Slider interaction tests", () => {
  it("renders with default value", () => {
    render(<Slider defaultValue={[50]} max={100} aria-label="Volume" />);
    const slider = screen.getByRole("slider");
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute("aria-valuenow", "50");
  });

  it("renders with min and max", () => {
    render(<Slider defaultValue={[25]} min={0} max={100} aria-label="Volume" />);
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "100");
  });

  it("renders as disabled", () => {
    render(<Slider defaultValue={[50]} disabled aria-label="Volume" />);
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("data-disabled", "");
  });
});
