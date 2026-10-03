import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Product } from '../../types/models';
import ProductThumbnail from './ProductThumbnail';
import { removeProductImage, replaceProductImage } from './productImageService';

interface ProductImagePanelProps {
  product: Product;
  actorUid: string;
}

export default function ProductImagePanel({ product, actorUid }: ProductImagePanelProps) {
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setError(null);
    setNotice(null);
    event.target.value = '';
  }

  async function saveImage() {
    if (!selectedFile || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await replaceProductImage(product, selectedFile, actorUid);
      setSelectedFile(null);
      setNotice(product.imageKey ? 'Đã thay ảnh sản phẩm.' : 'Đã thêm ảnh sản phẩm.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không thể lưu ảnh sản phẩm.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteImage() {
    if (!product.imageKey || busy) return;
    if (!window.confirm('Xóa ảnh hiện tại của sản phẩm? Dữ liệu hàng hóa và tồn kho không thay đổi.')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await removeProductImage(product, actorUid);
      setSelectedFile(null);
      setNotice('Đã xóa ảnh sản phẩm.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Không thể xóa ảnh sản phẩm.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="goods-detail-card product-image-panel">
      <h3>Ảnh sản phẩm</h3>
      <div className="product-image-preview">
        {previewUrl ? <img src={previewUrl} alt="Xem trước ảnh đã chọn" /> : <ProductThumbnail product={product} eager />}
      </div>

      {selectedFile ? (
        <div className="product-image-selection">
          <span>{selectedFile.name}</span>
          <small>Ảnh sẽ được xoay đúng chiều, thu nhỏ tối đa 1600px và xóa metadata EXIF/GPS trước khi tải lên.</small>
        </div>
      ) : (
        <p className="product-image-help">JPEG, PNG hoặc WebP. Ảnh gốc tối đa 15 MB; ảnh sau tối ưu tối đa 2 MB.</p>
      )}

      <input ref={cameraInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={selectFile} />
      <input ref={libraryInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} />

      <div className="product-image-actions">
        <button className="button button--secondary goods-touch" type="button" disabled={busy} onClick={() => cameraInputRef.current?.click()}>Chụp ảnh</button>
        <button className="button button--secondary goods-touch" type="button" disabled={busy} onClick={() => libraryInputRef.current?.click()}>Chọn từ máy</button>
        {selectedFile ? (
          <>
            <button className="button button--primary goods-touch" type="button" disabled={busy} onClick={() => void saveImage()}>{busy ? 'Đang lưu...' : product.imageKey ? 'Thay ảnh' : 'Lưu ảnh'}</button>
            <button className="button button--secondary goods-touch" type="button" disabled={busy} onClick={() => setSelectedFile(null)}>Hủy</button>
          </>
        ) : product.imageKey ? (
          <button className="button button--danger goods-touch" type="button" disabled={busy} onClick={() => void deleteImage()}>{busy ? 'Đang xóa...' : 'Xóa ảnh'}</button>
        ) : null}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="form-success" role="status">{notice}</p> : null}
    </section>
  );
}
