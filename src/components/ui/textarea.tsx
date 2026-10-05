import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[var(--sura-radius-input)] border border-[var(--sura-input-border)] bg-[var(--sura-input-bg)] px-3 py-2 text-[var(--sura-text-body)] shadow-[var(--sura-shadow-button)] transition-[var(--sura-transition-all)] outline-none",
        "placeholder:text-[var(--sura-input-placeholder)]",
        "hover:border-[var(--sura-border-secondary)]",
        "focus-visible:border-[var(--sura-input-border-focus)] focus-visible:ring-[var(--sura-border-width-focus)] focus-visible:ring-[var(--sura-accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sura-surface-primary)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-[var(--sura-error)] aria-invalid:ring-[var(--sura-error)]/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
