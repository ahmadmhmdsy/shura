import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRagStore } from "@/state/ragStore";
import { useSettingsStore } from "@/state/settingsStore";
import { indexDocument, deleteDocument, cleanupTempDocuments } from "@/lib/rag/documentManager";
import { formatFileSize, getFileTypeLabel, isSupportedFileType } from "@/lib/rag/fileProcessor";
import { useUiText } from "@/i18n";
import type { RagDocument } from "@/types";

export function RagFileManager() {
  const { t, plural } = useUiText();
  const { documents, refreshDocuments } = useRagStore();
  const { ragSettings } = useSettingsStore();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const supported = fileArray.filter((f) => isSupportedFileType(f.name));
    
    if (supported.length === 0) {
      alert(t("rag.unsupportedFiles"));
      return;
    }

    setUploading(true);
    try {
      for (const file of supported) {
        const persistence = ragSettings.defaultPersistence === "ask" 
          ? "persistent" 
          : ragSettings.defaultPersistence;
        
        await indexDocument(file, {
          persistence,
          settings: ragSettings,
        });
      }
      await refreshDocuments();
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (doc: RagDocument) => {
    if (!confirm(t("rag.confirmDeleteFile", { name: doc.fileName }))) return;
    await deleteDocument(doc.id);
    await refreshDocuments();
  };

  const handleClearTemp = async () => {
    const count = await cleanupTempDocuments();
    alert(plural("rag.tempDeleted", count));
    await refreshDocuments();
  };

  const statusLabel = (status: RagDocument["status"]) => {
    switch (status) {
      case "indexed": return t("rag.statusIndexed");
      case "indexing": return t("rag.indexing");
      case "error": return t("rag.statusError");
      default: return t("rag.statusPending");
    }
  };

  return (
    <div className="space-y-3 text-sm">
      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
          dragOver ? "border-sura-accent bg-sura-accent/10" : "border-sura-border"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <p className="text-xs text-sura-muted mb-2">
          {t("rag.dropHint")}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.md,.txt,.json,.csv,.log"
          className="hidden"
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? t("rag.uploading") : t("rag.uploadFile")}
        </Button>
      </div>

      {/* File List */}
      {documents.length === 0 ? (
        <p className="text-xs text-sura-muted text-center py-4">{t("rag.noFiles")}</p>
      ) : (
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-2 p-2 rounded border border-sura-border text-xs"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{doc.fileName}</p>
                <p className="text-sura-muted">
                  {getFileTypeLabel(doc.fileType)} · {formatFileSize(doc.fileSize)} · {plural("rag.chunkCount", doc.chunkCount)}
                </p>
              </div>
              <Badge variant={doc.status === "indexed" ? "default" : doc.status === "error" ? "destructive" : "secondary"}>
                {statusLabel(doc.status)}
              </Badge>
              {doc.persistence === "temp" && (
                <Badge variant="outline">{t("rag.tempBadge")}</Badge>
              )}
              <button
                className="text-sura-muted hover:text-sura-warn"
                onClick={() => void handleDelete(doc)}
                aria-label={t("rag.deleteFile")}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Clear Temp Button */}
      {documents.some((d) => d.persistence === "temp") && (
        <Button size="sm" variant="ghost" onClick={() => void handleClearTemp()}>
          {t("rag.clearTemp")}
        </Button>
      )}
    </div>
  );
}
