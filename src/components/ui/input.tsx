import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-[var(--sura-radius-input)] border border-[var(--sura-input-border)] bg-[var(--sura-input-bg)] px-3 py-1 text-[var(--sura-text-body)] shadow-[var(--sura-shadow-button)] transition-[var(--sura-transition-all)] outline-none",
        "selection:bg-[var(--sura-accent-primary)] selection:text-[var(--sura-accent-foreground)]",
        "placeholder:text-[var(--sura-input-placeholder)]",
        "hover:border-[var(--sura-border-secondary)]",
        "focus-visible:border-[var(--sura-input-border-focus)]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-[var(--sura-error)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
