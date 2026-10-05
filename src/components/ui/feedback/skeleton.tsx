import { cn } from "@/lib/utils"

export interface SkeletonProps {
  className?: string
  variant?: "text" | "circular" | "rectangular"
  width?: string | number
  height?: string | number
}

function Skeleton({
  className,
  variant = "text",
  width,
  height,
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--sura-radius-md)] bg-[var(--sura-surface-tertiary)]",
        variant === "circular" && "rounded-[var(--sura-radius-full)]",
        variant === "text" && "h-4",
        className
      )}
      style={{
        width: width,
        height: height,
      }}
    />
  )
}

export interface SkeletonGroupProps {
  count?: number
  className?: string
}

function SkeletonGroup({ count = 3, className }: SkeletonGroupProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="w-full" />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonGroup }
