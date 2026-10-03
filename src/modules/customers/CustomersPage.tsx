import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import type { Customer } from '../../types/models';
import {
  createCustomer,
  normalizePhone,
  setCustomerActive,
  subscribeCustomers,
  updateCustomer,
  type CustomerInput,
} from './customerService';
import './crm.css';
import './customersDesktopMobilePolish.css';

type CustomerForm = {
  code: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  note: string;
};

const emptyForm: CustomerForm = { code: '', name: '', phone: '', email: '', address: '', note: '' };

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('vi');
}

function toForm(customer: Customer): CustomerForm {
  return {
    code: customer.code,
    name: customer.name,
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    address: customer.address ?? '',
    note: customer.note ?? '',
  };
}

function validate(form: CustomerForm, customers: Customer[], editingId?: string) {
  if (!form.name.trim()) return 'Tên khách hàng là bắt buộc.';
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return 'Email chưa đúng định dạng.';
  }
  const code = form.code.trim();
  if (code && customers.some((customer) => customer.id !== editingId && normalize(customer.code) === normalize(code))) {
    return `Mã khách hàng “${code}” đã được sử dụng.`;
  }
  return null;
}

function toInput(form: CustomerForm): CustomerInput {
  return {
    code: form.code.trim() || undefined,
    name: form.name.trim(),
    phone: form.phone.trim() || undefined,
    email: form.email.trim() || undefined,
    address: form.address.trim() || undefined,
    note: form.note.trim() || undefined,
  };
}

export default function CustomersPage() {
  const { appUser } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [queryText, setQueryText] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    try {
      return subscribeCustomers(
        (next) => {
          setCustomers(next);
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
    return customers.filter((customer) => {
      if (!showInactive && !customer.active) return false;
      if (!needle) return true;
      return [customer.code, customer.name, customer.phone ?? '', customer.email ?? '']
        .some((value) => normalize(value).includes(needle));
    });
  }, [customers, queryText, showInactive]);

  const stats = useMemo(() => {
    const active = customers.filter((customer) => customer.active).length;
    return { total: customers.length, active, inactive: customers.length - active };
  }, [customers]);

  const phoneWarning = useMemo(() => {
    const phone = normalizePhone(form.phone);
    if (!phone) return null;
    const duplicate = customers.find((customer) => customer.id !== editing?.id && normalizePhone(customer.phone) === phone);
    return duplicate ? `Cảnh báo: số điện thoại này đang trùng với ${duplicate.code} - ${duplicate.name}.` : null;
  }, [customers, editing?.id, form.phone]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setSuccess(null);
    setEditorOpen(true);
  }

  function openEdit(customer: Customer) {
    setEditing(customer);
    setForm(toForm(customer));
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
    const validationError = validate(form, customers, editing?.id);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      if (editing) {
        await updateCustomer(editing, toInput(form), appUser.uid);
        setSuccess('Đã cập nhật khách hàng thành công.');
      } else {
        await createCustomer(toInput(form), appUser.uid);
        setSuccess('Đã thêm khách hàng thành công.');
      }
      setEditorOpen(false);
      setEditing(null);
      setForm(emptyForm);
    } catch (nextError) {
      setFormError(nextError instanceof Error ? nextError.message : 'Không thể lưu khách hàng.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(customer: Customer) {
    if (!appUser || changingStatusId) return;
    const nextActive = !customer.active;
    const confirmed = window.confirm(
      nextActive
        ? `Kích hoạt lại khách hàng “${customer.name}”?`
        : `Ngừng sử dụng khách hàng “${customer.name}”? Dữ liệu lịch sử sẽ được giữ nguyên.`,
    );
    if (!confirmed) return;

    setChangingStatusId(customer.id);
    setError(null);
    setSuccess(null);
    try {
      await setCustomerActive(customer, nextActive, appUser.uid);
      setSuccess(nextActive ? 'Đã kích hoạt lại khách hàng.' : 'Đã ngừng sử dụng khách hàng.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể đổi trạng thái khách hàng.');
    } finally {
      setChangingStatusId(null);
    }
  }

  return (
    <div className="crm-page customers-page">
      <div className="page-heading crm-heading">
        <div>
          <p className="eyebrow">CRM</p>
          <h1>Khách hàng</h1>
          <p className="muted">Danh sách dùng chung để POS có thể tìm và chọn khách nhanh.</p>
        </div>
        <button className="button button--primary crm-touch" type="button" onClick={openCreate}>+ Thêm khách hàng</button>
      </div>

      <section className="crm-stats" aria-label="Thống kê khách hàng">
        <div className="crm-stat"><span>Tổng khách hàng</span><strong>{stats.total}</strong></div>
        <div className="crm-stat"><span>Đang sử dụng</span><strong>{stats.active}</strong></div>
        <div className="crm-stat"><span>Ngừng sử dụng</span><strong>{stats.inactive}</strong></div>
      </section>

      {success && <p className="crm-success" role="status">{success}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {editorOpen && (
        <section className="crm-editor" aria-label={editing ? 'Sửa khách hàng' : 'Thêm khách hàng'}>
          <div className="crm-section-heading">
            <div><h2>{editing ? 'Sửa khách hàng' : 'Thêm khách hàng'}</h2><p>Mã để trống sẽ được hệ thống tự sinh.</p></div>
            <button className="button button--secondary crm-touch" type="button" onClick={closeEditor} disabled={saving}>Đóng</button>
          </div>
          <form className="crm-form" onSubmit={handleSubmit}>
            <label>Mã khách hàng<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Tự sinh nếu để trống" /></label>
            <label className="crm-field-wide">Tên khách hàng *<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ví dụ: Khách hàng A" /></label>
            <label>Số điện thoại<input type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
            <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label className="crm-field-wide">Địa chỉ<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
            <label className="crm-field-full">Ghi chú<textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
            {phoneWarning && <p className="crm-warning crm-field-full">{phoneWarning}</p>}
            {formError && <p className="form-error crm-field-full" role="alert">{formError}</p>}
            <div className="crm-actions crm-field-full">
              <button className="button button--secondary crm-touch" type="button" onClick={closeEditor} disabled={saving}>Hủy</button>
              <button className="button button--primary crm-touch" type="submit" disabled={saving}>{saving ? 'Đang lưu...' : editing ? 'Lưu thay đổi' : 'Tạo khách hàng'}</button>
            </div>
          </form>
        </section>
      )}

      <section className="crm-panel">
        <div className="crm-toolbar">
          <label className="crm-search">Tìm khách hàng<input type="search" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Tên, mã, điện thoại hoặc email..." /></label>
          <label className="crm-check"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />Hiện khách ngừng sử dụng</label>
        </div>

        {loading ? (
          <div className="crm-empty">Đang tải khách hàng...</div>
        ) : filtered.length === 0 ? (
          <div className="crm-empty"><strong>{customers.length === 0 ? 'Chưa có khách hàng nào.' : 'Không tìm thấy khách hàng phù hợp.'}</strong><span>{customers.length === 0 ? 'Bấm “Thêm khách hàng” để bắt đầu.' : 'Thử từ khóa khác hoặc bật hiển thị khách ngừng sử dụng.'}</span></div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th>Khách hàng</th><th>Liên hệ</th><th>Địa chỉ</th><th>Trạng thái</th><th aria-label="Thao tác" /></tr></thead>
              <tbody>
                {filtered.map((customer) => (
                  <tr key={customer.id} className={!customer.active ? 'crm-row-inactive' : undefined}>
                    <td data-label="Khách hàng"><strong>{customer.name}</strong><span className="crm-sub">{customer.code}</span></td>
                    <td data-label="Liên hệ"><span>{customer.phone || '—'}</span><span className="crm-sub">{customer.email || 'Chưa có email'}</span></td>
                    <td data-label="Địa chỉ">{customer.address || '—'}</td>
                    <td data-label="Trạng thái"><span className={customer.active ? 'crm-status crm-status-active' : 'crm-status crm-status-inactive'}>{customer.active ? 'Đang dùng' : 'Ngừng dùng'}</span></td>
                    <td className="crm-row-actions" data-label="Thao tác">
                      <button className="crm-text-button" type="button" onClick={() => openEdit(customer)}>Sửa</button>
                      <button className="crm-text-button" type="button" onClick={() => void toggleActive(customer)} disabled={changingStatusId === customer.id}>{changingStatusId === customer.id ? 'Đang lưu...' : customer.active ? 'Ngừng dùng' : 'Kích hoạt'}</button>
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
