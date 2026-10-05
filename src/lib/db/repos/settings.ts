/**
 * مخزن المفاتيح/القيم العام.
 * repos/settings — extracted from the former single-file repos module.
 */

import { db } from "../db";

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = await db.settings.get(key);
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> { await db.settings.put({ key, value }); }
