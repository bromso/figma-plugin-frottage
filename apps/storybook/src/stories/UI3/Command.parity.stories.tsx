import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/menu-multiselect.png";

const meta = { title: "UI3/Command", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame
      reference={ref}
      caption="Menu multi-select: search input, headings, rows, dividers, footer action"
    >
      <Command className="w-52 shadow-menu">
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Recent">
            <CommandItem>
              Rectangle<CommandShortcut>R</CommandShortcut>
            </CommandItem>
            <CommandItem>
              Ellipse<CommandShortcut>O</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="All">
            <CommandItem>
              Frame<CommandShortcut>F</CommandShortcut>
            </CommandItem>
            <CommandItem disabled>Section</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </ParityFrame>
  ),
};
