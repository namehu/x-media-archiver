import { Command as CommandPrimitive } from "cmdk";
import { cn } from "./_utils/cn";

export function Command({ className, ...props }: React.ComponentPropsWithoutRef<typeof CommandPrimitive>) {
  return <CommandPrimitive className={cn("flex h-full w-full flex-col overflow-hidden rounded-xl bg-bg-elevated text-fg-primary", className)} {...props} />;
}

export function CommandInput({ className, ...props }: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>) {
  return <CommandPrimitive.Input className={cn("h-11 w-full border-b border-border-subtle bg-transparent px-3 text-sm outline-none placeholder:text-fg-tertiary", className)} {...props} />;
}

export function CommandList({ className, ...props }: React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn("max-h-80 overflow-y-auto overflow-x-hidden p-1", className)} {...props} />;
}

export function CommandEmpty({ className, ...props }: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className={cn("py-6 text-center text-sm text-fg-secondary", className)} {...props} />;
}

export function CommandGroup({ className, ...props }: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group className={cn("p-1 text-fg-secondary [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold", className)} {...props} />;
}

export function CommandItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>) {
  return <CommandPrimitive.Item className={cn("flex cursor-pointer select-none items-center rounded-md px-2 py-2 text-sm text-fg-primary outline-none data-[selected=true]:bg-bg-muted", className)} {...props} />;
}
