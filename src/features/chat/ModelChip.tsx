import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PROVIDERS } from "@/lib/providers/registry";
import type { ProviderId } from "@/types";

export interface ModelChipProps {
  providerId: ProviderId;
  modelId: string;
  focused?: boolean;
  onRemove(): void;
  onClick?(): void;
}

export function ModelChip({ providerId, modelId, focused = false, onRemove, onClick }: ModelChipProps) {
  return (
    <Badge variant={focused ? "default" : "secondary"} className="gap-1 cursor-pointer" onClick={onClick}>
      {PROVIDERS[providerId].label} · {modelId}
      <button aria-label="إزالة" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
        <X className="size-3" />
      </button>
    </Badge>
  );
}
