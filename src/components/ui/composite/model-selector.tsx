import * as React from "react"
import { cn } from "@/lib/utils"
import { Check, ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useUiText } from "@/i18n"

export interface ModelOption {
  id: string
  label: string
  provider: string
  contextLength?: number
  pricing?: { input: number; output: number }
  isFree?: boolean
}

interface ModelSelectorProps {
  models: ModelOption[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

function ModelSelector({
  models,
  value,
  onValueChange,
  placeholder,
  disabled = false,
  className,
}: ModelSelectorProps) {
  const { t, plural } = useUiText()
  const [open, setOpen] = React.useState(false)
  const selectedModel = models.find((m) => m.id === value)

  return (
    <div className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate">
          {selectedModel ? selectedModel.label : (placeholder ?? t("models.placeholder"))}
        </span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          <div
            className="absolute z-50 mt-1 w-full rounded-[var(--sura-radius-lg)] border border-[var(--sura-border-primary)] bg-[var(--sura-surface-elevated)] shadow-[var(--sura-shadow-dropdown)]"
            role="listbox"
          >
            <div className="max-h-60 overflow-y-auto p-1">
              {models.length === 0 ? (
                <div className="px-3 py-2 text-[length:var(--sura-text-body-sm)] text-[var(--sura-text-tertiary)]">
                  {t("models.empty")}
                </div>
              ) : (
                models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={value === model.id}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-[var(--sura-radius-md)] px-3 py-2 text-start transition-[var(--sura-transition-colors)]",
                      "hover:bg-[var(--sura-hover)]",
                      "focus:bg-[var(--sura-hover)] focus:outline-none",
                      value === model.id && "bg-[var(--sura-accent-muted)]"
                    )}
                    onClick={() => {
                      onValueChange?.(model.id)
                      setOpen(false)
                    }}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="truncate text-[length:var(--sura-text-body-sm)] font-[var(--sura-font-medium)] text-[var(--sura-text-primary)]">
                        {model.label}
                      </span>
                      <span className="text-[length:var(--sura-text-caption)] text-[var(--sura-text-tertiary)]">
                        {model.provider}
                        {model.contextLength && ` • ${plural("models.tokens", model.contextLength)}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {model.isFree && (
                        <Badge variant="secondary" className="text-[length:var(--sura-text-caption)]">
                          {t("models.free")}
                        </Badge>
                      )}
                      {value === model.id && (
                        <Check className="size-4 text-[var(--sura-accent-primary)]" />
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export { ModelSelector }
