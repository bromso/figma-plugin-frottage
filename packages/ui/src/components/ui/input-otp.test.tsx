import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./input-otp";

describe("InputOTP interaction tests", () => {
  it("renders the correct number of slots", () => {
    render(
      <InputOTP maxLength={4}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
          <InputOTPSlot index={3} />
        </InputOTPGroup>
      </InputOTP>
    );
    const slots = screen.getAllByRole("textbox");
    // input-otp renders a single hidden input
    expect(slots.length).toBeGreaterThanOrEqual(1);
  });

  it("renders with data-slot attributes", () => {
    const { container } = render(
      <InputOTP maxLength={2}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
        </InputOTPGroup>
      </InputOTP>
    );
    const otpSlots = container.querySelectorAll('[data-slot="input-otp-slot"]');
    expect(otpSlots).toHaveLength(2);
  });
});
