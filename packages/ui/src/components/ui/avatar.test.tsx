import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

describe("Avatar interaction tests", () => {
  it("renders fallback when no image is provided", () => {
    render(
      <Avatar>
        <AvatarFallback>JB</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByText("JB")).toBeInTheDocument();
  });

  it("renders fallback when image fails to load", () => {
    render(
      <Avatar>
        <AvatarImage src="/nonexistent.png" alt="User" />
        <AvatarFallback>FB</AvatarFallback>
      </Avatar>
    );
    // Fallback should be rendered since the image won't load in tests
    expect(screen.getByText("FB")).toBeInTheDocument();
  });

  it("renders with size variant", () => {
    const { container } = render(
      <Avatar size="lg">
        <AvatarFallback>LG</AvatarFallback>
      </Avatar>
    );
    const avatar = container.querySelector('[data-slot="avatar"]');
    expect(avatar).toHaveAttribute("data-size", "lg");
  });
});
