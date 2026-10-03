import { useMemo, useState, type FormEvent } from 'react';
import type { Category } from '../../types/models';
import { createCategory, updateCategory } from './categoryService';

interface CategoryManagerProps {
  categories: readonly Category[];
  actorUid: string;
  onClose: () => void;
}

export default function CategoryManager({ categories, actorUid, onClose }: CategoryManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = useMemo(
    () => categories.find((category) => category.id === editingId) ?? null,
    [categories, editingId],
  );

  function resetForm() {
    setEditingId(null);
    setName('');
    setActive(true);
    setError(null);
  }

  function edit(category: Category) {
    setEditingId(category.id);
    setName(category.name);
    setActive(category.active);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) await updateCategory(editing, { name, active }, actorUid);
      else await createCategory({ name, active }, actorUid);
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu danh mục.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="product-editor" aria-label="Quản lý danh mục hàng hóa">
      <div className="section-heading">
        <div>
          <h2>Danh mục hàng hóa</h2>
          <p>Danh mục một cấp, dùng chung cho Hàng hóa, tìm kiếm, Excel và POS.</p>
        </div>
        <button className="button button--secondary goods-touch" type="button" onClick={onClose} disabled={saving}>Đóng</button>
      </div>

      <form className="product-form" onSubmit={submit}>
        <label className="form-field--wide">Tên danh mục *<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label className="checkbox-field"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Đang sử dụng</label>
        {error ? <p className="form-error form-field--full" role="alert">{error}</p> : null}
        <div className="form-actions form-field--full">
          {editing ? <button className="button button--secondary goods-touch" type="button" onClick={resetForm} disabled={saving}>Hủy sửa</button> : null}
          <button className="button button--primary goods-touch" type="submit" disabled={saving}>{saving ? 'Đang lưu...' : editing ? 'Lưu danh mục' : '+ Thêm danh mục'}</button>
        </div>
      </form>

      <div className="goods-table-wrap goods-desktop-table">
        <table className="goods-table">
          <thead><tr><th>Tên danh mục</th><th>Trạng thái</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <td><strong>{category.name}</strong></td>
                <td>{category.active ? 'Đang sử dụng' : 'Ngừng sử dụng'}</td>
                <td><button className="goods-text-button" type="button" onClick={() => edit(category)}>Sửa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="goods-responsive-list">
        {categories.map((category) => (
          <article className="goods-product-card" key={category.id}>
            <div className="goods-product-card__identity"><strong>{category.name}</strong><span>{category.active ? 'Đang sử dụng' : 'Ngừng sử dụng'}</span></div>
            <div className="goods-product-card__actions"><button className="button button--secondary goods-touch" type="button" onClick={() => edit(category)}>Sửa</button></div>
          </article>
        ))}
      </div>
    </section>
  );
}
