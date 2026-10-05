/**
 * عقود إيجار العملية (operation lease): منع عمليتين متزامنتين على الجلسة نفسها.
 * repos/operations — extracted from the former single-file repos module.
 */

import { db } from "../db";
import type { OperationLease } from "@/types";

export async function claimOperationLease(
  sessionId: string,
  operationId: string,
  turnId: string,
  canCreate: () => boolean,
): Promise<number> {
  return db.transaction("rw", db.operation_leases, async () => {
    if (!canCreate()) throw new Error("claimOperationLease: operation is no longer current");
    const current = await db.operation_leases.get(sessionId);
    if (current?.operationId === operationId && current.status === "active") {
      if (current.turnId !== turnId) throw new Error("claimOperationLease: operation is bound to another turn");
      return current.generation;
    }
    if (current?.operationId === operationId && (current.status === "cancelled" || current.status === "finished")) {
      throw new Error("claimOperationLease: operation lease is terminal");
    }
    const generation = (current?.generation ?? 0) + 1;
    if (!canCreate()) throw new Error("claimOperationLease: operation is no longer current");
    const lease: OperationLease = { sessionId, operationId, turnId, generation, status: "active", updatedAt: Date.now() };
    await db.operation_leases.put(lease);
    return generation;
  });
}

export async function getOperationLease(sessionId: string): Promise<OperationLease | undefined> {
  return db.operation_leases.get(sessionId);
}

export async function releaseOperationLease(
  sessionId: string,
  operationId: string,
  status: Extract<OperationLease["status"], "finished" | "cancelled">,
): Promise<boolean> {
  return db.transaction("rw", db.operation_leases, async () => {
    const current = await db.operation_leases.get(sessionId);
    if (!current || current.operationId !== operationId || current.status !== "active") return false;
    await db.operation_leases.put({ ...current, status, updatedAt: Date.now() });
    return true;
  });
}
