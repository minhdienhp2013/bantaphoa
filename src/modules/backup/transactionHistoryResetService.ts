import {
  get,
  onDisconnect,
  push,
  ref,
  set,
  update,
  type OnDisconnect,
} from 'firebase/database';
import { db } from '../../firebase/client';
import type { AuditLog, BackupEnvelope } from '../../types/models';
import { createBackupEnvelope, downloadBackupJson } from './backupService';
import { BUSINESS_DATA_RESET_LOCK_PATH } from './businessDataResetContract';
import { buildTransactionHistoryResetDeleteNodes } from './transactionHistoryResetContract';

export interface TransactionHistoryResetOptions {
  includeFinance: boolean;
}

export interface TransactionHistoryResetResult {
  backup: BackupEnvelope;
  deletedNodes: readonly string[];
  includeFinance: boolean;
}

type BackupWriter = (backup: BackupEnvelope) => void | Promise<void>;

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

async function assertOwnerActor(actorUid: string) {
  if (!actorUid) throw new Error('Không thể xác định OWNER thực hiện reset giao dịch.');
  const snapshot = await get(ref(requireDatabase(), `users/${actorUid}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy hồ sơ người dùng thực hiện reset.');
  const actor = snapshot.val() as { role?: unknown; active?: unknown };
  if (actor.role !== 'owner' || actor.active !== true) {
    throw new Error('Chỉ OWNER đang hoạt động mới được reset lịch sử giao dịch.');
  }
}

async function registerDisconnectCleanup(): Promise<OnDisconnect> {
  const handler = onDisconnect(ref(requireDatabase(), BUSINESS_DATA_RESET_LOCK_PATH));
  try {
    await handler.remove();
    return handler;
  } catch {
    await handler.cancel().catch(() => undefined);
    throw new Error('Không thể chuẩn bị cơ chế giải phóng khóa reset an toàn. Không có dữ liệu nào bị xóa.');
  }
}

async function releaseResetLock(handler: OnDisconnect) {
  await set(ref(requireDatabase(), BUSINESS_DATA_RESET_LOCK_PATH), null);
  await handler.cancel().catch(() => undefined);
}

async function assertLockOwnedBy(actorUid: string) {
  const snapshot = await get(ref(requireDatabase(), BUSINESS_DATA_RESET_LOCK_PATH));
  if (!snapshot.exists() || snapshot.child('actorUid').val() !== actorUid) {
    throw new Error('Khóa reset không còn hợp lệ. Không có dữ liệu nào bị xóa.');
  }
}

export async function resetTransactionHistory(
  actorUid: string,
  options: TransactionHistoryResetOptions,
  backupWriter: BackupWriter = downloadBackupJson,
): Promise<TransactionHistoryResetResult> {
  await assertOwnerActor(actorUid);

  const disconnectCleanup = await registerDisconnectCleanup();
  let lockAcquired = false;
  let committed = false;

  try {
    await set(ref(requireDatabase(), BUSINESS_DATA_RESET_LOCK_PATH), {
      actorUid,
      createdAt: Date.now(),
    });
    lockAcquired = true;

    // Snapshot trong lúc khóa để không có giao dịch/tồn kho mới chen vào giữa backup và reset.
    const backup = await createBackupEnvelope();
    await backupWriter(backup);
    await assertLockOwnedBy(actorUid);

    const database = requireDatabase();
    const auditId = push(ref(database, 'auditLogs')).key;
    if (!auditId) throw new Error('Không thể tạo audit cho thao tác reset giao dịch.');

    const deletedNodes = buildTransactionHistoryResetDeleteNodes(options.includeFinance);
    const createdAt = Date.now();
    const audit: AuditLog = {
      id: auditId,
      actorUid,
      action: 'TRANSACTION_HISTORY_RESET',
      entityType: 'system',
      summary: options.includeFinance
        ? 'Reset lịch sử bán/nhập/xuất/kho và công nợ/khoản vay; giữ nguyên sản phẩm, ảnh và tồn hiện tại.'
        : 'Reset lịch sử bán/nhập/xuất/kho; giữ nguyên sản phẩm, ảnh, tồn hiện tại, công nợ và khoản vay.',
      createdAt,
    };

    const updates: Record<string, unknown> = Object.fromEntries(
      deletedNodes.map((node) => [node, null]),
    );
    updates[`auditLogs/${auditId}`] = audit;
    updates[BUSINESS_DATA_RESET_LOCK_PATH] = null;

    await update(ref(database), updates);
    committed = true;
    lockAcquired = false;
    await disconnectCleanup.cancel().catch(() => undefined);

    return {
      backup,
      deletedNodes,
      includeFinance: options.includeFinance,
    };
  } catch (cause) {
    if (cause instanceof Error) throw cause;
    throw new Error('Không thể reset lịch sử giao dịch an toàn. Không có dữ liệu nào được báo là đã xóa.');
  } finally {
    if (lockAcquired && !committed) {
      try {
        await releaseResetLock(disconnectCleanup);
      } catch {
        // onDisconnect vẫn giữ fail-safe nếu explicit cleanup thất bại.
      }
    }
  }
}
