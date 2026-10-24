import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// [Q9] حلقة التركيز الميتة (ring/ring-offset مع var() غير مصنّف) حُذفت هنا وفي badge/input/textarea/switch/Composer:
// Tailwind يفسّر var() غير المصنّف لونًا لا عرضًا فلا تُرسم أبدًا، ومؤشر التركيز الوحيد هو outline العام في globals.css.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--sura-radius-button)] text-[length:var(--sura-text-body-sm)] font-[var(--sura-font-medium)] whitespace-nowrap transition-[var(--sura-transition-all)] outline-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-[var(--sura-error)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-[var(--sura-accent-primary)] text-[var(--sura-accent-foreground)] shadow-[var(--sura-shadow-button)] hover:bg-[var(--sura-accent-secondary)] hover:shadow-[var(--sura-shadow-button-hover)] active:scale-[0.98]",
        destructive:
          "bg-[var(--sura-error)] text-[var(--sura-error-foreground)] shadow-[var(--sura-shadow-button)] hover:bg-[var(--sura-error-secondary)] hover:shadow-[var(--sura-shadow-button-hover)] active:scale-[0.98]",
        outline:
          "border border-[var(--sura-border-primary)] bg-[var(--sura-surface-primary)] shadow-[var(--sura-shadow-button)] hover:bg-[var(--sura-hover)] hover:border-[var(--sura-border-secondary)] hover:shadow-[var(--sura-shadow-button-hover)] active:scale-[0.98]",
        "outline-accent":
          "border border-[var(--sura-border-accent)] bg-[var(--sura-surface-primary)] text-[var(--sura-accent-primary)] shadow-[var(--sura-shadow-button)] hover:bg-[var(--sura-accent-muted)] hover:shadow-[var(--sura-shadow-button-hover)] active:scale-[0.98]",
        secondary:
          "bg-[var(--sura-surface-secondary)] text-[var(--sura-text-primary)] shadow-[var(--sura-shadow-button)] hover:bg-[var(--sura-surface-tertiary)] hover:shadow-[var(--sura-shadow-button-hover)] active:scale-[0.98]",
        ghost:
          "hover:bg-[var(--sura-hover)] hover:text-[var(--sura-text-primary)] active:scale-[0.98]",
        link: "text-[var(--sura-accent-primary)] underline-offset-4 hover:underline hover:text-[var(--sura-accent-secondary)]",
        subtle:
          "bg-[var(--sura-accent-muted)] text-[var(--sura-accent-primary)] hover:bg-[var(--sura-accent-muted)]/80 active:scale-[0.98]",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-[var(--sura-radius-sm)] px-2 text-[length:var(--sura-text-caption)] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-[var(--sura-radius-sm)] px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-[var(--sura-radius-lg)] px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-[var(--sura-radius-sm)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
