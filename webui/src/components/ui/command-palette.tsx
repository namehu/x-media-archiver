import { useEffect } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "./dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";

export type CommandPaletteItem = {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  onSelect: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  placeholder,
  emptyLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: CommandPaletteItem[];
  placeholder: string;
  emptyLabel: string;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
      if (event.key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <Command>
          <div className="flex items-center border-b border-border-subtle px-3">
            <Search className="mr-2 h-4 w-4 text-fg-tertiary" />
            <CommandInput placeholder={placeholder} />
          </div>
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup heading="Navigation">
              {commands.map((command) => (
                <CommandItem
                  key={command.id}
                  value={[command.label, command.description, ...(command.keywords || [])].filter(Boolean).join(" ")}
                  onSelect={() => {
                    command.onSelect();
                    onOpenChange(false);
                  }}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{command.label}</div>
                    {command.description ? <div className="truncate text-xs text-fg-secondary">{command.description}</div> : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}
