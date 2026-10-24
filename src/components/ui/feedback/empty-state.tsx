import * as React from "react"
import { cn } from "@/lib/utils"

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 py-12 text-center", className)}>
      {icon && (
        <div className="flex size-16 items-center justify-center rounded-[var(--sura-radius-2xl)] bg-[var(--sura-accent-muted)]">
          {icon}
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-[length:var(--sura-text-h3)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">
          {title}
        </h3>
        {description && (
          <p className="max-w-sm text-[length:var(--sura-text-body-sm)] text-[var(--sura-text-secondary)]">
            {description}
          </p>
        )}
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}

export { EmptyState }
