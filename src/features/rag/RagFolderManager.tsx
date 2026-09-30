import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useRagStore } from "@/state/ragStore";
import { updateFolder } from "@/lib/rag/folderManager";
import { toast } from "sonner";
import { ar } from "@/i18n/ar";
import { RagIndexingProgress } from "@/features/rag/RagIndexingProgress";

export function RagFolderManager() {
  const { folders, documents, addFolder, removeFolder, indexingProgress } = useRagStore();
  const [adding, setAdding] = useState(false);

  const handleAddFolder = async () => {
    // In a real implementation, this would use Tauri's dialog plugin
    const path = prompt("أدخل مسار المجلد:");
    if (!path) return;
    const parts = path.split(/[\\/]/);
    const label = prompt("اسم المجلد (اختياري):") ?? parts[parts.length - 1] ?? path;
    setAdding(true);
    try {
      await addFolder(path, label, true);
    } catch {
      toast.error("فشل إضافة المجلد");
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveFolder = async (folderId: string) => {
    if (!confirm("إزالة هذا المجلد؟ سيتم حذف جميع الملفات المفهرسة منه.")) return;
    try {
      await removeFolder(folderId);
    } catch {
      toast.error("فشل إزالة المجلد");
    }
  };

  const fileCountFor = (folderId: string) =>
    documents.filter((d) => d.folderId === folderId).length;

  return (
    <div className="space-y-3 text-sm" dir="rtl">
      {folders.length === 0 ? (
        <p className="text-xs text-sura-muted text-center py-4">
          لا توجد مجلدات خارجية. أضف مجلدًا لفهرسة ملفاته.
        </p>
      ) : (
        <div className="space-y-2">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="flex items-center gap-2 p-2 rounded border border-sura-border text-xs"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{folder.label}</p>
                <p className="text-sura-muted truncate">{folder.path}</p>
                <div className="flex items-center gap-2 text-sura-muted">
                  <span>{folder.status === "error" ? ar.ragFolderError : ar.ragFolderActive}</span>
                  {folder.lastIndexedAt ? (
                    <span>
                      {ar.ragFolderLastIndexed}: {new Date(folder.lastIndexedAt).toLocaleString()}
                    </span>
                  ) : null}
                  {fileCountFor(folder.id) > 0 ? (
                    <span>
                      {fileCountFor(folder.id)} {ar.ragFolderFiles}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-sura-muted">تلقائي</span>
                <Switch
                  checked={folder.autoReindex}
                  onCheckedChange={(v) => {
                    void updateFolder(folder.id, { autoReindex: v });
                  }}
                />
              </div>
              {folder.status === "error" && (
                <button
                  className="text-xs text-sura-muted hover:text-sura-foreground transition-colors flex items-center gap-1"
                  onClick={() => void addFolder(folder.path, folder.label, folder.autoReindex)}
                >
                  <RotateCcw className="size-3" /> {ar.errorRetry}
                </button>
              )}
              <button
                className="text-sura-muted hover:text-sura-warn"
                onClick={() => void handleRemoveFolder(folder.id)}
                aria-label={ar.ragRemoveFolder}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {indexingProgress.status === "indexing" && <RagIndexingProgress />}
      <Button size="sm" variant="outline" disabled={adding} onClick={() => void handleAddFolder()}>
        {ar.ragAddFolder}
      </Button>
    </div>
  );
}
