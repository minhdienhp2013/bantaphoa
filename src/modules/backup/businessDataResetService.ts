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
import {
  BUSINESS_DATA_RESET_DELETE_NODES,
  BUSINESS_DATA_RESET_LOCK_PATH,
} from './businessDataResetContract';

export interface BusinessDataResetResult {
  backup: BackupEnvelope;
  deletedNodes: readonly string[];
}

type BackupWriter = (backup: BackupEnvelope) => void | Promise<void>;

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

async function assertOwnerActor(actorUid: string) {
  if (!actorUid) throw new Error('Không thể xác định OWNER thực hiện reset.');
  const snapshot = await get(ref(requireDatabase(), `users/${actorUid}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy hồ sơ người dùng thực hiện reset.');
  const actor = snapshot.val() as { role?: unknown; active?: unknown };
  if (actor.role !== 'owner' || actor.active !== true) {
    throw new Error('Chỉ OWNER đang hoạt động mới được xóa toàn bộ dữ liệu kinh doanh.');
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

export async function resetBusinessData(
  actorUid: string,
  backupWriter: BackupWriter = downloadBackupJson,
): Promise<BusinessDataResetResult> {
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

    // Chụp backup sau khi lock đã được Rules áp dụng để snapshot không bị thay đổi
    // bởi Product/transaction writes từ tab hoặc thiết bị khác.
    const backup = await createBackupEnvelope();
    await backupWriter(backup);
    await assertLockOwnedBy(actorUid);

    const database = requireDatabase();
    const auditId = push(ref(database, 'auditLogs')).key;
    if (!auditId) throw new Error('Không thể tạo audit cho thao tác reset.');

    const createdAt = Date.now();
    const audit: AuditLog = {
      id: auditId,
      actorUid,
      action: 'BUSINESS_DATA_RESET',
      entityType: 'system',
      summary: 'Hard reset toàn bộ dữ liệu hàng hóa và giao dịch sau khi tạo backup bắt buộc.',
      createdAt,
    };

    const updates: Record<string, unknown> = Object.fromEntries(
      BUSINESS_DATA_RESET_DELETE_NODES.map((node) => [node, null]),
    );
    updates[`auditLogs/${auditId}`] = audit;
    updates[BUSINESS_DATA_RESET_LOCK_PATH] = null;

    await update(ref(database), updates);
    committed = true;
    lockAcquired = false;
    await disconnectCleanup.cancel().catch(() => undefined);

    return {
      backup,
      deletedNodes: BUSINESS_DATA_RESET_DELETE_NODES,
    };
  } catch (cause) {
    if (cause instanceof Error) throw cause;
    throw new Error('Không thể xóa toàn bộ dữ liệu kinh doanh an toàn. Không có dữ liệu nào được báo là đã xóa.');
  } finally {
    if (lockAcquired && !committed) {
      try {
        await releaseResetLock(disconnectCleanup);
      } catch {
        // onDisconnect vẫn được giữ lại làm fail-safe khi explicit cleanup không thành công.
      }
    }
  }
}
