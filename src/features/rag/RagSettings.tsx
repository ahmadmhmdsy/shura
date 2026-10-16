import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiText } from "@/i18n";
// الكتالوج بيانات بحتة: استيراده من المحرّك كان يسحب onnxruntime-web إلى الوحدة
// الأساسية فيُلزم كل إقلاع بتحميلها (LV-09)، مع أن اللائحة لا تحتاج المحرّك أبدًا.
import { EMBEDDING_MODELS } from "@/lib/rag/modelCatalog";
import { CHUNKING_PRESETS } from "@/lib/rag/chunker";
import { downloadModel } from "@/lib/rag/modelDownloader";
import { downloadRagData } from "@/lib/export/ragExporter";
import { importRagData, validateRagImportData } from "@/lib/export/ragImporter";
import { toast } from "sonner";
import type { RagSettings as RagSettingsType } from "@/types";

export function RagSettings() {
  const { t } = useUiText();
  const { ragSettings, setRagSettings } = useSettingsStore();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ percent: number; loaded: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<RagSettingsType>) => {
    void setRagSettings(patch);
  };

  const handleDownload = async () => {
    const modelId = ragSettings.embeddingModelId;
    setDownloading(modelId);
    setProgress(null);
    try {
      await downloadModel(modelId, (p) => setProgress(p));
    } catch (e) {
      console.error("Model download failed:", e);
    } finally {
      setDownloading(null);
      setProgress(null);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!validateRagImportData(data)) {
        toast.error(t("rag.importError"));
        return;
      }
      await importRagData(data);
      toast.success(t("rag.importSuccess"));
    } catch (err) {
      console.error("Import failed:", err);
      toast.error(t("rag.importError"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4 text-sm">
      {/* Embedding Model */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("rag.embeddingModel")}</h3>
        <p className="text-xs text-sura-muted">{t("rag.embeddingModelDesc")}</p>
        <select
          className="w-full bg-sura-bg border border-sura-border rounded p-2 text-sm"
          aria-label={t("rag.embeddingModel")}
          value={ragSettings.embeddingModelId}
          onChange={(e) => update({ embeddingModelId: e.target.value })}
        >
          {EMBEDDING_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={downloading !== null}
          onClick={() => void handleDownload()}
        >
          {downloading ? t("rag.downloading") : t("rag.downloadModel")}
        </Button>
        {progress && (
          <div className="space-y-1">
            <div className="h-2 bg-sura-border rounded-full overflow-hidden">
              <div
                className="h-full bg-sura-accent transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-[11px] text-sura-muted">
              {progress.percent}% ({Math.round(progress.loaded / 1024 / 1024)}MB / {Math.round(progress.total / 1024 / 1024)}MB)
            </p>
          </div>
        )}
      </section>

      {/* Chunking */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{t("rag.preset")}</h3>
        <div className="flex gap-2">
          {(["balanced", "precise", "contextual"] as const).map((preset) => (
            <Button
              key={preset}
              size="sm"
              variant={ragSettings.chunkSize === CHUNKING_PRESETS[preset].chunkSize ? "default" : "outline"}
              onClick={() =>
                update({
                  chunkSize: CHUNKING_PRESETS[preset].chunkSize,
                  chunkOverlap: CHUNKING_PRESETS[preset].overlap,
                })
              }
            >
              {preset === "balanced" ? t("rag.presetBalanced") : preset === "precise" ? t("rag.presetPrecise") : t("rag.presetContextual")}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-sura-muted" htmlFor="rag-chunk-size">
            {t("rag.chunkSize")}: {ragSettings.chunkSize}
          </label>
          <Input
            type="range"
            id="rag-chunk-size"
            min={100}
            max={2000}
            step={50}
            value={ragSettings.chunkSize}
            onChange={(e) => update({ chunkSize: Number(e.target.value) })}
            className="w-full"
          />
          <p className="text-[11px] text-sura-muted">{t("rag.chunkSizeDesc")}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-sura-muted" htmlFor="rag-chunk-overlap">
            {t("rag.chunkOverlap")}: {ragSettings.chunkOverlap}
          </label>
          <Input
            type="range"
            id="rag-chunk-overlap"
            min={0}
            max={300}
            step={25}
            value={ragSettings.chunkOverlap}
            onChange={(e) => update({ chunkOverlap: Number(e.target.value) })}
            className="w-full"
          />
          <p className="text-[11px] text-sura-muted">{t("rag.chunkOverlapDesc")}</p>
        </div>
      </section>

      {/* File Persistence */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{t("rag.persistence")}</h3>
        <p className="text-xs text-sura-muted">{t("rag.persistenceDesc")}</p>
        <select
          className="w-full bg-sura-bg border border-sura-border rounded p-2 text-sm"
          aria-label={t("rag.persistence")}
          value={ragSettings.defaultPersistence}
          onChange={(e) => update({ defaultPersistence: e.target.value as RagSettingsType["defaultPersistence"] })}
        >
          <option value="persistent">{t("rag.persistent")}</option>
          <option value="temp">{t("rag.temp")}</option>
          <option value="ask">{t("rag.ask")}</option>
        </select>
      </section>

      {/* Temp Cleanup */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{t("rag.tempCleanup")}</h3>
        <p className="text-xs text-sura-muted">{t("rag.tempCleanupDesc")}</p>
        <select
          className="w-full bg-sura-bg border border-sura-border rounded p-2 text-sm"
          aria-label={t("rag.tempCleanup")}
          value={ragSettings.tempCleanup}
          onChange={(e) => update({ tempCleanup: e.target.value as RagSettingsType["tempCleanup"] })}
        >
          <option value="after_turn">{t("rag.afterTurn")}</option>
          <option value="after_session">{t("rag.afterSession")}</option>
          <option value="manual">{t("rag.manual")}</option>
        </select>
      </section>

      {/* Search Mode */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{t("rag.searchMode")}</h3>
        <p className="text-xs text-sura-muted">{t("rag.searchModeDesc")}</p>
        <select
          className="w-full bg-sura-bg border border-sura-border rounded p-2 text-sm"
          aria-label={t("rag.searchMode")}
          value={ragSettings.defaultSearchMode}
          onChange={(e) => update({ defaultSearchMode: e.target.value as RagSettingsType["defaultSearchMode"] })}
        >
          <option value="hybrid">{t("rag.hybrid")}</option>
          <option value="semantic">{t("rag.semantic")}</option>
          <option value="keyword">{t("rag.keyword")}</option>
        </select>
        <div className="space-y-1">
          <label className="text-xs text-sura-muted" htmlFor="rag-results-count">
            {t("rag.resultsCount")}: {ragSettings.searchResultCount}
          </label>
          <Input
            type="range"
            id="rag-results-count"
            min={1}
            max={20}
            value={ragSettings.searchResultCount}
            onChange={(e) => update({ searchResultCount: Number(e.target.value) })}
            className="w-full"
          />
          <p className="text-[11px] text-sura-muted">{t("rag.resultsCountDesc")}</p>
        </div>
      </section>

      {/* Agent Mode */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{t("rag.agentMode")}</h3>
        <p className="text-xs text-sura-muted">{t("rag.agentModeDesc")}</p>
        <select
          className="w-full bg-sura-bg border border-sura-border rounded p-2 text-sm"
          aria-label={t("rag.agentMode")}
          value={ragSettings.agentMode}
          onChange={(e) => update({ agentMode: e.target.value as RagSettingsType["agentMode"] })}
        >
          <option value="always">{t("rag.agentAlways")}</option>
          <option value="toggle">{t("rag.agentToggle")}</option>
        </select>
      </section>

      {/* External Folders Auto Reindex */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">{t("rag.autoReindex")}</h3>
            <p className="text-xs text-sura-muted">{t("rag.autoReindexDesc")}</p>
          </div>
          <Switch
            aria-label={t("rag.autoReindex")}
            checked={ragSettings.autoReindexFolders}
            onCheckedChange={(v) => update({ autoReindexFolders: v })}
          />
        </div>
      </section>

      {/* Export RAG Data */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{t("rag.exportData")}</h3>
        <p className="text-xs text-sura-muted">{t("rag.exportDataDesc")}</p>
        <Button size="sm" variant="outline" onClick={() => void downloadRagData()}>
          {t("rag.exportDataButton")}
        </Button>
      </section>

      {/* Import RAG Data */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{t("rag.importData")}</h3>
        <p className="text-xs text-sura-muted">{t("rag.importDataDesc")}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void handleImportFile(e)}
        />
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
          {t("rag.importDataButton")}
        </Button>
      </section>
    </div>
  );
}
