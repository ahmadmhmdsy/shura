import * as React from "react"
import { cn } from "@/lib/utils"
import { MessageSquare, Trash2, Edit3 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useUiText } from "@/i18n"

export interface SessionItemProps {
  id: string
  title: string
  messageCount?: number
  lastMessage?: string
  isActive?: boolean
  isEditing?: boolean
  onSelect?: () => void
  onRename?: (title: string) => void
  onDelete?: () => void
  className?: string
}

function SessionItem({
  title,
  messageCount = 0,
  lastMessage,
  isActive = false,
  isEditing = false,
  onSelect,
  onRename,
  onDelete,
  className,
}: SessionItemProps) {
  const { t } = useUiText()
  const [editValue, setEditValue] = React.useState(title)

  const handleRenameSubmit = () => {
    if (editValue.trim() && editValue !== title) {
      onRename?.(editValue.trim())
    }
    setEditValue(title)
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-[var(--sura-radius-md)] px-3 py-2 transition-[var(--sura-transition-all)] cursor-pointer",
        "hover:bg-[var(--sura-sidebar-hover)]",
        isActive && "bg-[var(--sura-sidebar-active)] hover:bg-[var(--sura-sidebar-active)]",
        className
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect?.()
        }
      }}
    >
      <MessageSquare className={cn(
        "size-4 shrink-0",
        isActive ? "text-[var(--sura-accent-primary)]" : "text-[var(--sura-text-tertiary)]"
      )} />

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit()
              if (e.key === "Escape") {
                setEditValue(title)
                onRename?.(title)
              }
            }}
            className="w-full bg-transparent text-[var(--sura-text-body-sm)] font-[var(--sura-font-medium)] outline-none border-b border-[var(--sura-accent-primary)]"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <p className={cn(
              "truncate text-[var(--sura-text-body-sm)] font-[var(--sura-font-medium)]",
              isActive ? "text-[var(--sura-text-primary)]" : "text-[var(--sura-text-secondary)]"
            )}>
              {title}
            </p>
            {lastMessage && (
              <p className="truncate text-[var(--sura-text-caption)] text-[var(--sura-text-tertiary)] mt-0.5">
                {lastMessage}
              </p>
            )}
          </>
        )}
      </div>

      {messageCount > 0 && (
        <span className={cn(
          "shrink-0 rounded-[var(--sura-radius-full)] px-1.5 py-0.5 text-[var(--sura-text-caption)] font-[var(--sura-font-medium)]",
          isActive ? "bg-[var(--sura-accent-primary)] text-[var(--sura-accent-foreground)]" : "bg-[var(--sura-surface-tertiary)] text-[var(--sura-text-tertiary)]"
        )}>
          {messageCount}
        </span>
      )}

      <div className={cn(
        "absolute end-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5",
        "opacity-0 group-hover:opacity-100 transition-opacity"
      )}>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-6"
          onClick={(e) => {
            e.stopPropagation()
            setEditValue(title)
            onRename?.(title)
          }}
          aria-label={t("common.rename")}
        >
          <Edit3 className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-6 text-[var(--sura-error-text)] hover:text-[var(--sura-error-text)]"
          onClick={(e) => {
            e.stopPropagation()
            onDelete?.()
          }}
          aria-label={t("common.delete")}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  )
}

export { SessionItem }
