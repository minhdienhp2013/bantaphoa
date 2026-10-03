import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import type { Supplier } from '../../types/models';
import {
  createSupplier,
  normalizeSupplierPhone,
  setSupplierActive,
  subscribeSuppliers,
  updateSupplier,
  type SupplierInput,
} from './supplierService';
import '../customers/crm.css';
import './suppliersDesktopMobilePolish.css';

type SupplierForm = {
  code: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  taxCode: string;
  note: string;
};

const emptyForm: SupplierForm = { code: '', name: '', phone: '', email: '', address: '', taxCode: '', note: '' };

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('vi');
}

function toForm(supplier: Supplier): SupplierForm {
  return {
    code: supplier.code,
    name: supplier.name,
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    address: supplier.address ?? '',
    taxCode: supplier.taxCode ?? '',
    note: supplier.note ?? '',
  };
}

function validate(form: SupplierForm, suppliers: Supplier[], editingId?: string) {
  if (!form.name.trim()) return 'Tên nhà cung cấp là bắt buộc.';
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Email chưa đúng định dạng.';
  const code = form.code.trim();
  if (code && suppliers.some((supplier) => supplier.id !== editingId && normalize(supplier.code) === normalize(code))) {
    return `Mã nhà cung cấp “${code}” đã được sử dụng.`;
  }
  return null;
}

function toInput(form: SupplierForm): SupplierInput {
  return {
    code: form.code.trim() || undefined,
    name: form.name.trim(),
    phone: form.phone.trim() || undefined,
    email: form.email.trim() || undefined,
    address: form.address.trim() || undefined,
    taxCode: form.taxCode.trim() || undefined,
    note: form.note.trim() || undefined,
  };
}

export default function SuppliersPage() {
  const { appUser } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [queryText, setQueryText] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    try {
      return subscribeSuppliers(
        (next) => {
          setSuppliers(next);
          setLoading(false);
        },
        (nextError) => {
          setError(nextError.message);
          setLoading(false);
        },
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể kết nối cơ sở dữ liệu.');
      setLoading(false);
      return undefined;
    }
  }, []);

  const filtered = useMemo(() => {
    const needle = normalize(queryText);
    return suppliers.filter((supplier) => {
      if (!showInactive && !supplier.active) return false;
      if (!needle) return true;
      return [supplier.code, supplier.name, supplier.phone ?? '', supplier.email ?? '', supplier.taxCode ?? '']
        .some((value) => normalize(value).includes(needle));
    });
  }, [suppliers, queryText, showInactive]);

  const stats = useMemo(() => {
    const active = suppliers.filter((supplier) => supplier.active).length;
    return { total: suppliers.length, active, inactive: suppliers.length - active };
  }, [suppliers]);

  const phoneWarning = useMemo(() => {
    const phone = normalizeSupplierPhone(form.phone);
    if (!phone) return null;
    const duplicate = suppliers.find((supplier) => supplier.id !== editing?.id && normalizeSupplierPhone(supplier.phone) === phone);
    return duplicate ? `Cảnh báo: số điện thoại này đang trùng với ${duplicate.code} - ${duplicate.name}.` : null;
  }, [editing?.id, form.phone, suppliers]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setSuccess(null);
    setEditorOpen(true);
  }

  function openEdit(supplier: Supplier) {
    setEditing(supplier);
    setForm(toForm(supplier));
    setFormError(null);
    setSuccess(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    if (saving) return;
    setEditorOpen(false);
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appUser || saving) return;
    const validationError = validate(form, suppliers, editing?.id);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      if (editing) {
        await updateSupplier(editing, toInput(form), appUser.uid);
        setSuccess('Đã cập nhật nhà cung cấp thành công.');
      } else {
        await createSupplier(toInput(form), appUser.uid);
        setSuccess('Đã thêm nhà cung cấp thành công.');
      }
      setEditorOpen(false);
      setEditing(null);
      setForm(emptyForm);
    } catch (nextError) {
      setFormError(nextError instanceof Error ? nextError.message : 'Không thể lưu nhà cung cấp.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(supplier: Supplier) {
    if (!appUser || changingStatusId) return;
    const nextActive = !supplier.active;
    const confirmed = window.confirm(
      nextActive
        ? `Kích hoạt lại nhà cung cấp “${supplier.name}”?`
        : `Ngừng sử dụng nhà cung cấp “${supplier.name}”? Dữ liệu phiếu nhập lịch sử sẽ được giữ nguyên.`,
    );
    if (!confirmed) return;

    setChangingStatusId(supplier.id);
    setError(null);
    setSuccess(null);
    try {
      await setSupplierActive(supplier, nextActive, appUser.uid);
      setSuccess(nextActive ? 'Đã kích hoạt lại nhà cung cấp.' : 'Đã ngừng sử dụng nhà cung cấp.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể đổi trạng thái nhà cung cấp.');
    } finally {
      setChangingStatusId(null);
    }
  }

  return (
    <div className="crm-page suppliers-page">
      <div className="page-heading crm-heading">
        <div><p className="eyebrow">Đối tác nhập hàng</p><h1>Nhà cung cấp</h1><p className="muted">Dữ liệu sẵn sàng để module Nhập hàng tìm và chọn nhà cung cấp.</p></div>
        <button className="button button--primary crm-touch" type="button" onClick={openCreate}>+ Thêm nhà cung cấp</button>
      </div>

      <section className="crm-stats" aria-label="Thống kê nhà cung cấp">
        <div className="crm-stat"><span>Tổng nhà cung cấp</span><strong>{stats.total}</strong></div>
        <div className="crm-stat"><span>Đang sử dụng</span><strong>{stats.active}</strong></div>
        <div className="crm-stat"><span>Ngừng sử dụng</span><strong>{stats.inactive}</strong></div>
      </section>

      {success && <p className="crm-success" role="status">{success}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {editorOpen && (
        <section className="crm-editor" aria-label={editing ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}>
          <div className="crm-section-heading">
            <div><h2>{editing ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}</h2><p>Mã để trống sẽ được hệ thống tự sinh.</p></div>
            <button className="button button--secondary crm-touch" type="button" onClick={closeEditor} disabled={saving}>Đóng</button>
          </div>
          <form className="crm-form" onSubmit={handleSubmit}>
            <label>Mã nhà cung cấp<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Tự sinh nếu để trống" /></label>
            <label className="crm-field-wide">Tên nhà cung cấp *<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ví dụ: Nhà cung cấp A" /></label>
            <label>Số điện thoại<input type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
            <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>Mã số thuế<input value={form.taxCode} onChange={(event) => setForm({ ...form, taxCode: event.target.value })} /></label>
            <label className="crm-field-wide">Địa chỉ<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
            <label className="crm-field-full">Ghi chú<textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
            {phoneWarning && <p className="crm-warning crm-field-full">{phoneWarning}</p>}
            {formError && <p className="form-error crm-field-full" role="alert">{formError}</p>}
            <div className="crm-actions crm-field-full">
              <button className="button button--secondary crm-touch" type="button" onClick={closeEditor} disabled={saving}>Hủy</button>
              <button className="button button--primary crm-touch" type="submit" disabled={saving}>{saving ? 'Đang lưu...' : editing ? 'Lưu thay đổi' : 'Tạo nhà cung cấp'}</button>
            </div>
          </form>
        </section>
      )}

      <section className="crm-panel">
        <div className="crm-toolbar">
          <label className="crm-search">Tìm nhà cung cấp<input type="search" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Tên, mã, điện thoại, email, mã số thuế..." /></label>
          <label className="crm-check"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />Hiện nhà cung cấp ngừng sử dụng</label>
        </div>

        {loading ? (
          <div className="crm-empty">Đang tải nhà cung cấp...</div>
        ) : filtered.length === 0 ? (
          <div className="crm-empty"><strong>{suppliers.length === 0 ? 'Chưa có nhà cung cấp nào.' : 'Không tìm thấy nhà cung cấp phù hợp.'}</strong><span>{suppliers.length === 0 ? 'Bấm “Thêm nhà cung cấp” để bắt đầu.' : 'Thử từ khóa khác hoặc bật hiển thị đối tác ngừng sử dụng.'}</span></div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th>Nhà cung cấp</th><th>Liên hệ</th><th>Mã số thuế</th><th>Trạng thái</th><th aria-label="Thao tác" /></tr></thead>
              <tbody>
                {filtered.map((supplier) => (
                  <tr key={supplier.id} className={!supplier.active ? 'crm-row-inactive' : undefined}>
                    <td data-label="Nhà cung cấp"><strong>{supplier.name}</strong><span className="crm-sub">{supplier.code}</span></td>
                    <td data-label="Liên hệ"><span>{supplier.phone || '—'}</span><span className="crm-sub">{supplier.email || supplier.address || 'Chưa có thông tin thêm'}</span></td>
                    <td data-label="Mã số thuế">{supplier.taxCode || '—'}</td>
                    <td data-label="Trạng thái"><span className={supplier.active ? 'crm-status crm-status-active' : 'crm-status crm-status-inactive'}>{supplier.active ? 'Đang dùng' : 'Ngừng dùng'}</span></td>
                    <td className="crm-row-actions" data-label="Thao tác">
                      <button className="crm-text-button" type="button" onClick={() => openEdit(supplier)}>Sửa</button>
                      <button className="crm-text-button" type="button" onClick={() => void toggleActive(supplier)} disabled={changingStatusId === supplier.id}>{changingStatusId === supplier.id ? 'Đang lưu...' : supplier.active ? 'Ngừng dùng' : 'Kích hoạt'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
