import type { ComponentProps } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";

function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn("flex h-full w-full flex-col overflow-hidden rounded-xl text-glorp-text", className)}
      {...props}
    />
  );
}

function CommandDialog({ children, className, ...props }: ComponentProps<typeof Dialog> & { className?: string }) {
  return (
    <Dialog {...props}>
      <DialogContent showClose={false} className={cn("overflow-hidden p-0", className)}>
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-glorp-border px-3">
      <Search className="size-4 shrink-0 text-glorp-muted" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-11 w-full bg-transparent py-3 text-[14px] text-glorp-text outline-none placeholder:text-glorp-muted disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-[60vh] overflow-y-auto overflow-x-hidden p-1", className)}
      {...props}
    />
  );
}

function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-[13px] text-glorp-muted"
      {...props}
    />
  );
}

function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-glorp-text [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-glorp-muted",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none data-[selected=true]:bg-glorp-surface-2 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
