import type { Ref } from 'react';

interface GoodsBulkActionBarProps {
  count: number;
  showDeactivate: boolean;
  showPermanentDelete: boolean;
  deactivating?: boolean;
  deleting?: boolean;
  permanentDeleteButtonRef?: Ref<HTMLButtonElement>;
  onPrint: () => void;
  onDeactivate: () => void;
  onPermanentDelete: () => void;
  onClear: () => void;
}

export default function GoodsBulkActionBar({
  count,
  showDeactivate,
  showPermanentDelete,
  deactivating = false,
  deleting = false,
  permanentDeleteButtonRef,
  onPrint,
  onDeactivate,
  onPermanentDelete,
  onClear,
}: GoodsBulkActionBarProps) {
  if (count <= 0) return null;
  const busy = deactivating || deleting;
  return (
    <div className="goods-bulk-bar" role="status">
      <strong>Đã chọn {count} sản phẩm</strong>
      <div className="goods-bulk-actions">
        <button className="button button--primary goods-touch" type="button" onClick={onPrint} disabled={busy}>
          In tem đã chọn
        </button>
        {showDeactivate ? (
          <button className="button button--secondary goods-touch" type="button" onClick={onDeactivate} disabled={busy}>
            {deactivating ? 'Đang xử lý...' : 'Ngừng kinh doanh đã chọn'}
          </button>
        ) : null}
        <button className="button button--secondary goods-touch" type="button" onClick={onClear} disabled={busy}>
          Bỏ chọn
        </button>
        {showPermanentDelete ? (
          <span
            className="goods-bulk-danger-slot"
            style={{ marginLeft: 12, paddingLeft: 12, borderLeft: '1px solid #efb4b4' }}
          >
            {/* aria-disabled={busy}: keep the destructive control focusable while async work is running. */}
            <button
              ref={permanentDeleteButtonRef}
              className="button goods-touch"
              style={{ color: '#b42318', borderColor: '#e6a2a2', background: '#fff1f1', opacity: busy ? 0.65 : 1 }}
              type="button"
              onClick={onPermanentDelete}
              aria-disabled={busy ? 'true' : 'false'}
              aria-busy={deleting}
            >
              {deleting ? 'Đang kiểm tra/xóa...' : 'Xóa vĩnh viễn đã chọn'}
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
