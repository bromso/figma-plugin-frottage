import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/menu.png";

const meta = { title: "UI3/Menu", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame
      portaled
      reference={ref}
      caption="Menu: simple rows with shortcuts, submenu chevrons, dividers, checkmark rows"
    >
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">Open menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52" align="start">
          <DropdownMenuItem>
            Copy<DropdownMenuShortcut>⌥⇧⌘O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Copy / Paste as</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Copy as SVG</DropdownMenuItem>
              <DropdownMenuItem>Copy as PNG</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            Bring to front<DropdownMenuShortcut>]</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Send to back<DropdownMenuShortcut>[</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Options</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked>Show rulers</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem>Snap to pixel grid</DropdownMenuCheckboxItem>
          <DropdownMenuLabel inset>Zoom</DropdownMenuLabel>
          <DropdownMenuRadioGroup value="fit">
            <DropdownMenuRadioItem value="fit">Zoom to fit</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="100">Zoom to 100%</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuItem disabled>
            Flatten<DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            Delete<DropdownMenuShortcut>⌫</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ParityFrame>
  ),
};
