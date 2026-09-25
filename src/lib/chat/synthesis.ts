import type { ChatMessage, TargetConfig, TargetSnapshot } from "@/types";

export function buildSummaryPrompt(turnId: string, results: ChatMessage[]): string {
  const blocks = results.map((r) => `### ${r.providerId} — ${r.modelId}\n${r.text || "(بلا نتيجة)"}`).join("\n\n");
  return [
    "الأدوات التالية هي جوابات عدة نماذج ذكاء اصطناعي على نفس السؤال في جلسة دردشة.",
    "المطلوب: اقرأ الجميع، قارن بينهم، أبرز الاتفاقات والتعارضات، واستخرج خلاصة إجمالية واحدة أفضل جواب عملي للمستخدم، مذكورًا إن اختلفت النماذج في نقطة جوهرية.",
    `معرّف التمرّة: ${turnId}`,
    "\n---\n" + blocks,
  ].join("\n");
}

export function buildSummaryTargetSnapshot(target: TargetConfig, promptText: string): TargetSnapshot {
  return {
    ...target,
    sharedPrompt: promptText,
    customPrompt: null,
    promptText,
    hasShared: true,
    hasCustom: false,
  };
}
