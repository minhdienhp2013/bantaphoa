import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { APP_MODULES } from '../../auth/permissions';
import { Dialog } from '../../shared/ui/dialog';
import { ActionTile, Button, PageHeader, StatusMessage } from '../../shared/ui/primitives';
import type { AppModulePermission, AppModulePermissions, AppUser } from '../../types/models';
import {
  createStaffAccount,
  subscribeUsers,
  updateStaffAccount,
} from './userService';
import './users.css';
import './usersBrand.css';
import './usersDesktopMobilePolish.css';

const EMPTY_PERMISSIONS: AppModulePermissions = {};

function togglePermission(
  current: AppModulePermissions,
  permission: AppModulePermission,
  enabled: boolean,
): AppModulePermissions {
  const next = { ...current };
  if (enabled) next[permission] = true;
  else delete next[permission];
  return next;
}

function permissionCount(user: AppUser) {
  if (user.role === 'owner') return APP_MODULES.length;
  return APP_MODULES.filter((module) => user.permissions?.[module.key] === true).length;
}

export default function UsersPage() {
  const { appUser } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'create' | 'list' | 'edit' | null>(null);

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPermissions, setNewPermissions] = useState<AppModulePermissions>(EMPTY_PERMISSIONS);

  const selectedUser = useMemo(
    () => users.find((user) => user.uid === selectedUid) ?? null,
    [users, selectedUid],
  );
  const [editName, setEditName] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editPermissions, setEditPermissions] = useState<AppModulePermissions>(EMPTY_PERMISSIONS);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    return subscribeUsers(
      (next) => {
        setUsers(next);
        setLoading(false);
      },
      (error) => {
        setLoadError(error.message);
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    if (!selectedUser || selectedUser.role !== 'staff') {
      setEditName('');
      setEditActive(true);
      setEditPermissions(EMPTY_PERMISSIONS);
      return;
    }
    setEditName(selectedUser.displayName);
    setEditActive(selectedUser.active);
    setEditPermissions(selectedUser.permissions ?? EMPTY_PERMISSIONS);
  }, [selectedUser]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appUser || busy) return;
    setBusy(true);
    setFormError(null);
    setMessage(null);
    try {
      const created = await createStaffAccount({
        displayName: newName,
        email: newEmail,
        password: newPassword,
        permissions: newPermissions,
      }, appUser.uid);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewPermissions(EMPTY_PERMISSIONS);
      setSelectedUid(created.uid);
      setMessage(`Đã tạo tài khoản cho ${created.displayName}.`);
      setDialog(null);
    } catch (error) {
      const fallback = 'Không thể tạo tài khoản nhân viên.';
      const nextMessage = error instanceof Error ? error.message : fallback;
      setFormError(nextMessage.includes('email-already-in-use') ? 'Email này đã có tài khoản Firebase.' : nextMessage);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appUser || !selectedUser || selectedUser.role !== 'staff' || busy) return;
    setBusy(true);
    setFormError(null);
    setMessage(null);
    try {
      await updateStaffAccount(selectedUser.uid, {
        displayName: editName,
        active: editActive,
        permissions: editPermissions,
      }, appUser.uid);
      setMessage(`Đã cập nhật quyền cho ${editName.trim()}.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể cập nhật nhân viên.');
    } finally {
      setBusy(false);
    }
  }

  function closeListDialog() {
    if (busy) return;
    setDialog(null);
    setSelectedUid(null);
  }

  function openEditDialog(uid: string) {
    setSelectedUid(uid);
    setDialog('edit');
  }

  function closeEditDialog() {
    if (busy) return;
    setDialog(null);
    setSelectedUid(null);
  }

  return (
    <div className="users-page">
      <PageHeader
        eyebrow="Quản trị"
        title="Người dùng & phân quyền"
        description="Tạo tài khoản nhân viên và chọn chính xác phần nào của ứng dụng họ được nhìn thấy."
      />

      {message ? <StatusMessage tone="success">{message}</StatusMessage> : null}
      {formError ? <StatusMessage tone="danger" announce="assertive">{formError}</StatusMessage> : null}
      {loadError ? <StatusMessage tone="danger" announce="assertive">{loadError}</StatusMessage> : null}

      <section className="users-launchers" aria-label="Quản lý người dùng">
        <ActionTile
          type="button"
          icon="＋"
          title="Thêm người dùng"
          description="Tạo tài khoản và cấp quyền cho nhân viên"
          onClick={() => setDialog('create')}
        />
        <ActionTile
          type="button"
          icon="👥"
          title="Danh sách người dùng"
          description={`${users.length} tài khoản trong hệ thống`}
          onClick={() => setDialog('list')}
        />
      </section>

      <Dialog
        open={dialog === 'create'}
        title="Thêm người dùng"
        onClose={() => setDialog(null)}
        savingLock={busy}
      >
        <form className="users-dialog-form" onSubmit={handleCreate}>
          <p className="users-dialog-copy">Chủ cửa hàng tự tạo tài khoản đăng nhập cho nhân viên.</p>
          <label className="users-field">
            <span>Tên nhân viên</span>
            <input type="text" autoComplete="off" maxLength={80} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Ví dụ: Nguyễn Văn A" required />
          </label>
          <label className="users-field">
            <span>Email đăng nhập</span>
            <input type="email" autoComplete="off" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="nhanvien@example.com" required />
          </label>
          <label className="users-field">
            <span>Mật khẩu ban đầu</span>
            <input type="password" autoComplete="new-password" minLength={6} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Tối thiểu 6 ký tự" required />
          </label>
          <fieldset className="users-permissions">
            <legend>Phần được phép nhìn thấy</legend>
            <div className="users-permissions__grid">
              {APP_MODULES.map((module) => (
                <label className="users-permission" key={module.key}>
                  <input type="checkbox" checked={newPermissions[module.key] === true} onChange={(event) => setNewPermissions((current) => togglePermission(current, module.key, event.target.checked))} />
                  <span>{module.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" disabled={busy}>{busy ? 'Đang tạo...' : 'Tạo tài khoản nhân viên'}</Button>
        </form>
      </Dialog>

      <Dialog
        open={dialog === 'list'}
        title="Danh sách người dùng"
        onClose={closeListDialog}
        savingLock={busy}
      >
        <div className="users-list-dialog">
          <p className="users-dialog-copy">{users.length} tài khoản trong hệ thống.</p>
          {loading ? <p>Đang tải người dùng...</p> : null}
          {!loading && users.length === 0 ? <p>Chưa có hồ sơ người dùng.</p> : null}
          <div className="users-list">
            {users.map((user) => (
              <button key={user.uid} type="button" className={`users-list__item${selectedUid === user.uid ? ' is-selected' : ''}`} onClick={() => openEditDialog(user.uid)}>
                <span>
                  <strong>{user.displayName}</strong>
                  <small>{user.email || user.uid}</small>
                </span>
                <span className="users-list__meta">
                  <b>{user.role === 'owner' ? 'Chủ cửa hàng' : 'Nhân viên'}</b>
                  <small>{user.active ? 'Đang hoạt động' : 'Đã khóa'} · {permissionCount(user)} phần</small>
                </span>
              </button>
            ))}
          </div>

        </div>
      </Dialog>

      <Dialog
        open={dialog === 'edit' && selectedUser !== null}
        title={selectedUser ? `Chỉnh sửa người dùng · ${selectedUser.displayName}` : 'Chỉnh sửa người dùng'}
        onClose={closeEditDialog}
        savingLock={busy}
      >
        {selectedUser ? selectedUser.role === 'owner' ? (
          <section className="users-editor users-modal__editor users-editor--standalone">
            <h2>{selectedUser.displayName}</h2>
            <p>Tài khoản Chủ cửa hàng luôn có toàn quyền. Không thể hạ quyền Owner từ màn hình này.</p>
          </section>
        ) : (
          <form className="users-editor users-modal__editor users-editor--standalone" onSubmit={handleUpdate}>
            <div className="users-card__title">
              <div>
                <h2>Quyền của {selectedUser.displayName}</h2>
                <p>Mỗi thay đổi áp dụng riêng cho đúng tài khoản này.</p>
              </div>
              <label className="users-active-toggle">
                <input type="checkbox" checked={editActive} onChange={(event) => setEditActive(event.target.checked)} />
                <span>{editActive ? 'Tài khoản đang hoạt động' : 'Tài khoản bị khóa'}</span>
              </label>
            </div>
            <label className="users-field">
              <span>Tên hiển thị</span>
              <input type="text" maxLength={80} value={editName} onChange={(event) => setEditName(event.target.value)} required />
            </label>
            <fieldset className="users-permissions">
              <legend>Phần được phép nhìn thấy khi đăng nhập</legend>
              <div className="users-permissions__grid">
                {APP_MODULES.map((module) => (
                  <label className="users-permission" key={module.key}>
                    <input type="checkbox" checked={editPermissions[module.key] === true} onChange={(event) => setEditPermissions((current) => togglePermission(current, module.key, event.target.checked))} />
                    <span>{module.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu quyền người dùng'}</Button>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}
