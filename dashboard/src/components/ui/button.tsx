import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils.ts";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-glorp-border-active disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-glorp-accent text-white hover:bg-glorp-accent-dim",
        destructive: "bg-glorp-error text-white hover:opacity-90",
        outline: "border border-glorp-border bg-transparent text-glorp-text hover:bg-glorp-surface-2",
        secondary: "bg-glorp-surface-2 text-glorp-text hover:bg-glorp-surface-2/70",
        ghost: "text-glorp-muted hover:bg-glorp-surface-2 hover:text-glorp-text",
        link: "text-glorp-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3",
        lg: "h-10 rounded-lg px-6",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
