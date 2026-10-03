import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import type { Product, StockOut, StockOutReason } from '../../types/models';
import { subscribeProducts } from '../products/productService';
import '../inventory/inventory.css';
import '../inventory/inventoryBrand.css';
import './stockOutDesktopMobilePolish.css';
import StockOutProductSearch from './StockOutProductSearch';
import { cancelStockOut, createStockOut, subscribeStockOuts, type StockOutLineInput } from './stockOutService';

const emptyLine = (): StockOutLineInput => ({ productId: '', quantity: 1 });
const reasonLabels: Record<StockOutReason, string> = { internal_use: 'Sử dụng nội bộ', damage: 'Hỏng / vỡ', gift: 'Biếu tặng', other: 'Khác' };
function dateTime(value: number) { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value); }

export default function StockOutPage() {
  const { appUser } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [records, setRecords] = useState<StockOut[]>([]);
  const [reason, setReason] = useState<StockOutReason>('internal_use');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<StockOutLineInput[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const onError = (cause: Error) => setError(cause.message);
    try {
      const unsubProducts = subscribeProducts(setProducts, onError);
      const unsubRecords = subscribeStockOuts(setRecords, onError);
      return () => { unsubProducts(); unsubRecords(); };
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error('Không thể kết nối dữ liệu xuất hàng.'));
      return undefined;
    }
  }, []);

  const activeProducts = useMemo(() => products.filter((product) => product.active), [products]);
  function patchLine(index: number, patch: Partial<StockOutLineInput>) { setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line)); }

  async function submit() {
    if (!appUser) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      const record = await createStockOut({ reason, items: lines, ...(note.trim() ? { note } : {}) }, appUser.uid);
      setSuccess(`Đã tạo ${record.code}, giảm tồn và ghi STOCK_OUT.`);
      setLines([emptyLine()]); setNote('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tạo phiếu xuất.'); }
    finally { setBusy(false); }
  }

  async function handleCancel(record: StockOut) {
    if (!appUser || !window.confirm(`Hủy ${record.code}? Hệ thống sẽ hoàn lại tồn và tạo STOCK_OUT_REVERSAL.`)) return;
    setBusy(true); setError(null); setSuccess(null);
    try { await cancelStockOut(record.id, appUser.uid); setSuccess(`Đã hủy ${record.code} và hoàn tồn.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể hủy phiếu xuất.'); }
    finally { setBusy(false); }
  }

  return <div className="inv-shell stockout-page">
    <header className="inv-page-header"><div><p className="eyebrow">OUT-001 / OUT-002</p><h1>Xuất hàng</h1><p className="muted">Dùng cho xuất nội bộ, hỏng/vỡ, biếu tặng hoặc trường hợp không phát sinh doanh thu.</p></div></header>
    {error && <p className="form-error">{error}</p>}{success && <p className="inv-success">{success}</p>}
    <div className="stockout-workspace"><section className="inv-card stockout-create-card"><h2>Tạo phiếu xuất</h2>
      <div className="inv-form-grid"><label className="inv-field">Lý do<select value={reason} onChange={(e) => setReason(e.target.value as StockOutReason)}>{Object.entries(reasonLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="inv-field">Ghi chú<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tùy chọn" /></label></div>
      <div className="inv-line-editor">{lines.map((line,index) => <div className="inv-line" key={index}>
        <label className="inv-field">Sản phẩm<StockOutProductSearch products={activeProducts} productId={line.productId} disabled={busy} onSelect={(productId) => patchLine(index,{ productId })} /></label>
        <label className="inv-field">Số lượng<input type="number" inputMode="numeric" min="1" step="1" value={line.quantity} onChange={(e) => patchLine(index,{ quantity:Number(e.target.value) })} /></label><span></span>
        <button className="button button--secondary" type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_,i)=>i!==index))}>Xóa dòng</button>
      </div>)}</div>
      <div className="inv-actions"><button className="button button--secondary" type="button" onClick={() => setLines((current)=>[...current,emptyLine()])}>+ Thêm dòng</button><button className="button button--primary" type="button" disabled={busy || !appUser} onClick={submit}>{busy ? 'Đang xử lý...' : 'Hoàn tất xuất hàng'}</button></div>
    </section>
    <section className="inv-card stockout-records-card"><div><h2>Phiếu xuất gần đây</h2><p className="muted">Hủy phiếu xuất tạo movement hoàn tồn, không xóa lịch sử.</p></div>{records.length===0 ? <p className="muted">Chưa có phiếu xuất.</p> : <div className="inv-list">{records.slice(0,100).map((record)=><article className="inv-record" key={record.id}><div className="inv-record__meta"><strong>{record.code} · {reasonLabels[record.reason]}</strong><span>{dateTime(record.createdAt)} · {record.items.length} mặt hàng</span><span className={`inv-badge ${record.status==='completed'?'inv-badge--ok':'inv-badge--cancelled'}`}>{record.status==='completed'?'Hoàn tất':'Đã hủy'}</span></div><div className="inv-record__actions">{record.status==='completed' && <button className="button button--secondary" type="button" disabled={busy} onClick={()=>handleCancel(record)}>Hủy / hoàn tồn</button>}</div></article>)}</div>}</section></div>
  </div>;
}
