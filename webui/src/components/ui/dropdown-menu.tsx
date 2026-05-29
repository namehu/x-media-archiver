import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "./_utils/cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn("z-50 min-w-40 rounded-lg border border-border-subtle bg-bg-elevated p-1 text-fg-primary shadow-3 outline-none", className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn("flex cursor-pointer select-none items-center rounded-md px-2 py-1.5 text-sm outline-none transition hover:bg-bg-muted focus:bg-bg-muted", className)}
      {...props}
    />
  );
}
