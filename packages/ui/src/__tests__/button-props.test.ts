import { describe, expectTypeOf, it } from "bun:test";
import type { ButtonProps } from "../index";

describe("@repo/ui ButtonProps type export", () => {
  it("exports ButtonProps as a real named type from the barrel", () => {
    // If ButtonProps is a phantom re-export, this import is silently erased
    // and the type parameter below resolves to `any`. The assertions below
    // verify that ButtonProps is a real, structural type with the expected
    // shape: ComponentProps<"button"> & VariantProps<typeof buttonVariants>
    // & { asChild?: boolean }.

    expectTypeOf<ButtonProps>().not.toBeAny();
    expectTypeOf<ButtonProps>().toHaveProperty("asChild");
    expectTypeOf<ButtonProps>().toHaveProperty("className");
    expectTypeOf<ButtonProps>().toHaveProperty("onClick");
    expectTypeOf<ButtonProps>().toHaveProperty("variant");
    expectTypeOf<ButtonProps>().toHaveProperty("size");
  });

  it("accepts valid Button props structurally", () => {
    const props: ButtonProps = {
      variant: "default",
      size: "default",
      asChild: false,
      className: "test",
      onClick: () => {},
    };
    // Reference the value so the compiler keeps the assignment.
    void props;
  });
});
