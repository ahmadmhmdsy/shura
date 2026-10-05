/**
 * أحداث الاستهلاك (usage events).
 * repos/usage — extracted from the former single-file repos module.
 */

import { db } from "../db";
import type { UsageEvent } from "@/types";

export async function recordUsage(ev: UsageEvent): Promise<void> {
  // Deletion is durable: a sidecar that outlives its session is reported, never stored.
  // The tombstone check and the put must be atomic to prevent a TOCTOU race where a
  // concurrent deleteSessionData commits between the check and the put, leaving an orphan
  // usage_events row for a session that no longer exists.
  await db.transaction("rw", [db.usage_events, db.tombstones], async () => {
    if (await db.tombstones.get(ev.sessionId)) throw new Error("تعذر حفظ الاستهلاك: الجلسة محذوفة");
    await db.usage_events.put(ev);
  });
}

export async function getUsageEvents(filter?: { sessionId?: string; providerId?: string; fromTs?: number }): Promise<UsageEvent[]> {
  const narrow = (list: UsageEvent[]): UsageEvent[] => list.filter((e) => (filter?.providerId ? e.providerId === filter.providerId : true));
  if (filter?.sessionId) {
    const list = await db.usage_events.where("sessionId").equals(filter.sessionId).sortBy("ts");
    return narrow(list).filter((e) => (filter.fromTs ? e.ts >= filter.fromTs : true));
  }
  if (filter?.fromTs) {
    const list = await db.usage_events.where("ts").aboveOrEqual(filter.fromTs).toArray();
    return narrow(list);
  }
  return narrow(await db.usage_events.orderBy("ts").toArray());
}
