import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: NavigationMenu,
  title: "Navigation/NavigationMenu",
  tags: ["autodocs"],
} satisfies Meta<typeof NavigationMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Getting Started</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid gap-3 p-4 w-[400px]">
              <NavigationMenuLink
                href="#"
                className="block select-none rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-muted"
              >
                <div className="text-sm font-medium">Introduction</div>
                <p className="text-sm text-muted-foreground">Learn the basics of the framework.</p>
              </NavigationMenuLink>
              <NavigationMenuLink
                href="#"
                className="block select-none rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-muted"
              >
                <div className="text-sm font-medium">Installation</div>
                <p className="text-sm text-muted-foreground">
                  How to install and set up the project.
                </p>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Components</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid gap-3 p-4 w-[400px]">
              <NavigationMenuLink
                href="#"
                className="block select-none rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-muted"
              >
                <div className="text-sm font-medium">Button</div>
                <p className="text-sm text-muted-foreground">A clickable button component.</p>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};
