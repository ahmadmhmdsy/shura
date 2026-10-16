import type { BuiltPrompt, Turn } from "@/types";
import { KeyedError } from "@/lib/errors/keyedError";

export interface TurnTargetInput { targetId: string; providerId: string; modelId: string; }

const CUSTOM_SEPARATOR = "\n\n[تعليمات خاصة لهذا النموذج]\n";

export function buildTurnTargets(
  turn: Turn,
  targets: readonly TurnTargetInput[],
  syncMode: boolean,
): { prompts: BuiltPrompt[]; dropped: string[] } {
  const shared = turn.sharedPrompt?.trim() || null;

  if (syncMode) {
    if (!shared) throw new KeyedError("errors.syncNeedsSharedPrompt");
    // [دور إصلاح مأذون — بند 4 من المراجعة الختامية] حارس الفرع الموحد: أهداف صفرية كانت تبني
    // تمريرة فارغة (بلا بطاقات) وتكتبها في Dexie والقرص؛ الرمي برسالة موجّهة يغلق ذلك
    // (الفرع غير الموحد يرمي أصلًا حين لا يُبنى أي prompt).
    if (targets.length === 0) throw new KeyedError("chat.noTargets");
    return {
      prompts: targets.map((t) => ({ targetId: t.targetId, providerId: t.providerId as BuiltPrompt["providerId"], modelId: t.modelId, text: shared, hasShared: true, hasCustom: false })),
      dropped: [],
    };
  }

  const prompts: BuiltPrompt[] = [];
  const dropped: string[] = [];
  for (const t of targets) {
    const custom = turn.customs[t.targetId]?.trim() || null;
    if (!shared && !custom) { dropped.push(t.targetId); continue; }
    const text = custom && shared ? shared + CUSTOM_SEPARATOR + custom : (custom ?? shared!);
    prompts.push({ targetId: t.targetId, providerId: t.providerId as BuiltPrompt["providerId"], modelId: t.modelId, text, hasShared: shared !== null, hasCustom: custom !== null });
  }
  if (prompts.length === 0) throw new KeyedError("errors.noPromptForAnyTarget");
  return { prompts, dropped };
}
