import { cn } from "@/lib/utils"
import { Bot, User, AlertCircle } from "lucide-react"

import { Markdown } from "@/features/chat/Markdown"

export type MessageRole = "user" | "assistant" | "system"

export interface MessageBubbleProps {
  role: MessageRole
  content: string
  isStreaming?: boolean
  error?: string
  modelLabel?: string
  className?: string
}

function MessageBubble({
  role,
  content,
  isStreaming = false,
  error,
  modelLabel,
  className,
}: MessageBubbleProps) {
  const isUser = role === "user"
  const isSystem = role === "system"

  if (isSystem) {
    return (
      <div className={cn("flex justify-center", className)}>
        <div className="flex items-center gap-2 rounded-[var(--sura-radius-full)] bg-[var(--sura-chat-system-bg)] px-4 py-2 text-[var(--sura-text-body-sm)] text-[var(--sura-chat-system-text)]">
          <AlertCircle className="size-4 shrink-0" />
          <span>{content}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row", className)}>
      {/* Avatar */}
      <div className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[var(--sura-radius-full)]",
        isUser ? "bg-[var(--sura-chat-user-bg)]" : "bg-[var(--sura-surface-tertiary)]"
      )}>
        {isUser ? (
          <User className="size-4 text-[var(--sura-chat-user-text)]" />
        ) : (
          <Bot className="size-4 text-[var(--sura-text-secondary)]" />
        )}
      </div>

      {/* Content */}
      <div className={cn(
        "flex max-w-[85%] flex-col gap-1",
        isUser ? "items-end" : "items-start"
      )}>
        {modelLabel && (
          <span className="text-[var(--sura-text-caption)] text-[var(--sura-text-tertiary)]">
            {modelLabel}
          </span>
        )}

        <div className={cn(
          "rounded-[var(--sura-radius-lg)] px-4 py-3",
          isUser
            ? "bg-[var(--sura-chat-user-bg)] text-[var(--sura-chat-user-text)] rounded-tr-[var(--sura-radius-sm)]"
            : "bg-[var(--sura-chat-assistant-bg)] text-[var(--sura-chat-assistant-text)] rounded-tl-[var(--sura-radius-sm)]"
        )}>
          {error ? (
            <div className="flex items-center gap-2 text-[var(--sura-error-text)]">
              <AlertCircle className="size-4 shrink-0" />
              <span className="text-[var(--sura-text-body-sm)]">{error}</span>
            </div>
          ) : isUser ? (
            <p className="text-[var(--sura-text-body)] whitespace-pre-wrap">{content}</p>
          ) : (
            <div className="prose prose-sm max-w-none">
              <Markdown text={content} />
              {isStreaming && (
                <span className="inline-block w-2 h-4 bg-[var(--sura-accent-primary)] animate-pulse ms-0.5" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { MessageBubble }
