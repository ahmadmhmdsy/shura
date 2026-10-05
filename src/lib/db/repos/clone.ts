/**
 * استنساخ عميق لصفوف المحاولات والتمرّرات (يحمي الحالة المخزنة من التحوّر).
 * repos/clone — extracted from the former single-file repos module.
 */

import type { TargetSnapshot, TurnAttempt, TurnRecord } from "@/types";

export function cloneTarget(target: TargetSnapshot): TargetSnapshot {
  return {
    ...target,
    modelInfo: {
      ...target.modelInfo,
      pricing: target.modelInfo.pricing ? { ...target.modelInfo.pricing } : target.modelInfo.pricing,
    },
  };
}

export function cloneAttempt(attempt: TurnAttempt): TurnAttempt {
  return { ...attempt, targets: attempt.targets.map(cloneTarget) };
}

export function cloneTurn(turn: TurnRecord): TurnRecord {
  return { ...turn, attempts: turn.attempts.map(cloneAttempt) };
}
