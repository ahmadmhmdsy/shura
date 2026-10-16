import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--sura-radius-badge)] border border-transparent px-2 py-0.5 text-[var(--sura-text-caption)] font-[var(--sura-font-medium)] whitespace-nowrap transition-[var(--sura-transition-colors)] aria-invalid:border-[var(--sura-error)] [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-[var(--sura-accent-primary)] text-[var(--sura-accent-foreground)] [a&]:hover:bg-[var(--sura-accent-secondary)]",
        secondary: "bg-[var(--sura-surface-secondary)] text-[var(--sura-text-secondary)] [a&]:hover:bg-[var(--sura-surface-tertiary)]",
        destructive: "bg-[var(--sura-error)] text-[var(--sura-error-foreground)] [a&]:hover:bg-[var(--sura-error-secondary)]",
        outline: "border-[var(--sura-border-primary)] text-[var(--sura-text-secondary)] [a&]:hover:bg-[var(--sura-hover)] [a&]:hover:text-[var(--sura-text-primary)]",
        ghost: "[a&]:hover:bg-[var(--sura-hover)] [a&]:hover:text-[var(--sura-text-primary)]",
        link: "text-[var(--sura-accent-primary)] underline-offset-4 [a&]:hover:underline",
        success: "bg-[var(--sura-success-muted)] text-[var(--sura-success)]",
        warning: "bg-[var(--sura-warning-muted)] text-[var(--sura-warning)]",
        info: "bg-[var(--sura-info-muted)] text-[var(--sura-info)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
