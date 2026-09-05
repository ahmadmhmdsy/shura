import { Composer } from "./Composer";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore } from "@/state/composerStore";
import { estimateSessionTokens } from "@/lib/tokens/estimate";
import { getProvider } from "@/lib/providers/registry";
import { ar } from "@/i18n/ar";

export function ChatScreen() {
  const { currentId, messages } = useSessionsStore();
  const targets = useComposerStore((s) => s.targets);
  const primary = getProvider("openrouter").staticModels[0];
  const limit = targets.length === 0 ? primary.contextLength ?? 128000 : getProvider(targets[0].providerId).staticModels.find((m) => m.id === targets[0].modelId)?.contextLength ?? 128000;

  if (!currentId) return <div className="flex-1 grid place-items-center text-sura-muted">{ar.newSession + " ← من السايدبار"}</div>;

  return (
    <main className="flex-1 flex flex-col h-full min-w-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-3" dir="rtl">
        {messages.length === 0 && <p className="text-sura-muted text-sm">لا رسائل بعد — أضف نماذج من (+) ثم اكتب سؤالك.</p>}
      </div>
      <Composer onSend={() => {}} onStop={() => {}} onExtractSummary={() => {}} sending={false}
        sessionTokens={estimateSessionTokens(messages)} contextLimit={limit} />
    </main>
  );
}
