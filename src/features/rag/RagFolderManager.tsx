import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useRagStore } from "@/state/ragStore";
import { updateFolder } from "@/lib/rag/folderManager";
import { toast } from "sonner";
import { uiText, useUiText } from "@/i18n";
import { RagIndexingProgress } from "@/features/rag/RagIndexingProgress";

export function RagFolderManager() {
  const { t, plural } = useUiText();
  const { folders, documents, addFolder, removeFolder, indexingProgress } = useRagStore();
  const [adding, setAdding] = useState(false);

  const handleAddFolder = async () => {
    // In a real implementation, this would use Tauri's dialog plugin
    const path = prompt(t("rag.enterFolderPath"));
    if (!path) return;
    const parts = path.split(/[\\/]/);
    const label = prompt(t("rag.enterFolderName")) ?? parts[parts.length - 1] ?? path;
    setAdding(true);
    try {
      await addFolder(path, label, true);
    } catch {
      toast.error(t("rag.addFolderFailed"));
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveFolder = async (folderId: string) => {
    if (!confirm(t("rag.confirmRemoveFolder"))) return;
    try {
      await removeFolder(folderId);
    } catch {
      toast.error(t("rag.removeFolderFailed"));
    }
  };

  const fileCountFor = (folderId: string) =>
    documents.filter((d) => d.folderId === folderId).length;

  return (
    <div className="space-y-3 text-sm">
      {folders.length === 0 ? (
        <p className="text-xs text-sura-muted text-center py-4">
          {t("rag.noFolders")}
        </p>
      ) : (
        <ul className="space-y-2 list-none">
          {folders.map((folder) => (
            <li
              key={folder.id}
              className="flex items-center gap-2 p-2 rounded border border-sura-border text-xs"
              aria-label={`${folder.label}, ${folder.path}, ${folder.status === "error" ? t("rag.folderError") : t("rag.folderActive")}`}
            >
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{folder.label}</p>
                <p className="text-sura-muted truncate">{folder.path}</p>
                <div className="flex items-center gap-2 text-sura-muted">
                  <span>{folder.status === "error" ? t("rag.folderError") : t("rag.folderActive")}</span>
                  {folder.lastIndexedAt ? (
                    <span>
                      {t("rag.folderLastIndexed")}: {uiText.formatDate(folder.lastIndexedAt, { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  ) : null}
                  {fileCountFor(folder.id) > 0 ? (
                    <span>
                      {plural("rag.folderFiles", fileCountFor(folder.id))}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-sura-muted">{t("rag.autoShort")}</span>
                <Switch
                  checked={folder.autoReindex}
                  onCheckedChange={(v) => {
                    void updateFolder(folder.id, { autoReindex: v });
                  }}
                  aria-label={t("rag.autoReindex")}
                />
              </div>
              {folder.status === "error" && (
                <button
                  className="text-xs text-sura-muted hover:text-sura-foreground transition-colors flex items-center gap-1"
                  onClick={() => void addFolder(folder.path, folder.label, folder.autoReindex)}
                >
                  <RotateCcw className="size-3" /> {t("common.retry")}
                </button>
              )}
              <button
                className="text-sura-muted hover:text-sura-warn"
                onClick={() => void handleRemoveFolder(folder.id)}
                aria-label={t("rag.removeFolder")}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {indexingProgress.status === "indexing" && <RagIndexingProgress />}
      <Button size="sm" variant="outline" disabled={adding} onClick={() => void handleAddFolder()}>
        {t("rag.addFolder")}
      </Button>
    </div>
  );
}
