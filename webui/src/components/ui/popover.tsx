import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "./_utils/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className, sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        className={cn("z-50 rounded-lg border border-border-subtle bg-bg-elevated p-3 text-fg-primary shadow-3 outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
