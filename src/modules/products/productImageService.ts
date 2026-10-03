import { auth } from '../../firebase/client';
import type { Product } from '../../types/models';
import { patchProductImageMetadata } from './productService';

export const PRODUCT_IMAGE_MAX_RAW_BYTES = 15 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_OPTIMIZED_BYTES = 2 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_EDGE = 1600;

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ProductImageMetadata {
  imageKey: string;
  imageUpdatedAt: number;
}

function apiBaseUrl() {
  return String(
    import.meta.env.VITE_PRODUCT_IMAGE_API_URL
      || import.meta.env.VITE_SALES_AI_PROXY_URL
      || '',
  ).trim().replace(/\/+$/u, '');
}

function requireApiBaseUrl() {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('Dịch vụ ảnh sản phẩm chưa được cấu hình.');
  return baseUrl;
}

export function getProductImageUrl(imageKey?: string) {
  if (!imageKey) return '';
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return '';
  const encodedKey = imageKey.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl}/product-images/content/${encodedKey}`;
}

function assertSupportedFile(file: File) {
  const extension = file.name.toLowerCase().split('.').pop() || '';
  if (extension === 'heic' || extension === 'heif' || /heic|heif/iu.test(file.type)) {
    throw new Error('Thiết bị chưa hỗ trợ HEIC/HEIF. Hãy chọn JPEG, PNG hoặc WebP.');
  }
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error('Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.');
  }
  if (file.size <= 0 || file.size > PRODUCT_IMAGE_MAX_RAW_BYTES) {
    throw new Error('Ảnh gốc phải nhỏ hơn hoặc bằng 15 MB.');
  }
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Safari and older Chromium builds can reject the options object; use the
      // HTML image decoder, which still applies camera orientation for display.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function optimizeProductImage(file: File): Promise<Blob> {
  assertSupportedFile(file);
  const source = await decodeImage(file);
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  if (!sourceWidth || !sourceHeight) throw new Error('Không thể đọc kích thước ảnh.');

  const scale = Math.min(1, PRODUCT_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Trình duyệt không thể tối ưu ảnh.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  if ('close' in source && typeof source.close === 'function') source.close();

  const formats = [
    { type: 'image/webp', qualities: [0.84, 0.74, 0.64, 0.55] },
    { type: 'image/jpeg', qualities: [0.86, 0.76, 0.66, 0.56] },
  ];
  for (const format of formats) {
    for (const quality of format.qualities) {
      const blob = await canvasBlob(canvas, format.type, quality);
      if (blob && blob.type === format.type && blob.size <= PRODUCT_IMAGE_MAX_OPTIMIZED_BYTES) {
        return blob;
      }
    }
  }
  throw new Error('Ảnh sau tối ưu vẫn lớn hơn 2 MB. Hãy chọn ảnh nhỏ hơn.');
}

async function authorizedFetch(path: string, init: RequestInit) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
  const idToken = await currentUser.getIdToken();
  const response = await fetch(`${requireApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (response.ok) return response;

  let code = '';
  try {
    const payload = await response.json() as { error?: string };
    code = payload.error || '';
  } catch {
    // Keep the status-based fallback below.
  }
  const messages: Record<string, string> = {
    unauthorized: 'Phiên đăng nhập không hợp lệ.',
    forbidden: 'Bạn không có quyền Hàng hóa để quản lý ảnh.',
    'product-not-found': 'Sản phẩm không còn tồn tại.',
    'invalid-image': 'File ảnh không hợp lệ.',
    'image-too-large': 'Ảnh sau tối ưu vượt quá 2 MB.',
    'storage-unavailable': 'Kho ảnh chưa được cấu hình.',
    'rate-limited': 'Bạn thao tác quá nhanh. Hãy thử lại sau.',
  };
  throw new Error(messages[code] || `Không thể cập nhật ảnh (HTTP ${response.status}).`);
}

async function uploadProductImage(productId: string, blob: Blob): Promise<ProductImageMetadata> {
  const response = await authorizedFetch(`/product-images/${encodeURIComponent(productId)}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });
  const payload = await response.json() as Partial<ProductImageMetadata>;
  if (typeof payload.imageKey !== 'string' || !Number.isFinite(payload.imageUpdatedAt)) {
    throw new Error('Dịch vụ ảnh trả về dữ liệu không hợp lệ.');
  }
  return { imageKey: payload.imageKey, imageUpdatedAt: Number(payload.imageUpdatedAt) };
}

async function deleteProductImageObject(productId: string, imageKey: string) {
  await authorizedFetch(
    `/product-images/${encodeURIComponent(productId)}?key=${encodeURIComponent(imageKey)}`,
    { method: 'DELETE' },
  );
}

export async function replaceProductImage(product: Product, file: File, actorUid: string) {
  const optimized = await optimizeProductImage(file);
  const uploaded = await uploadProductImage(product.id, optimized);
  try {
    await patchProductImageMetadata(product.id, uploaded, actorUid, 'PRODUCT_IMAGE_UPDATED');
  } catch (error) {
    await deleteProductImageObject(product.id, uploaded.imageKey).catch(() => undefined);
    throw error;
  }

  if (product.imageKey && product.imageKey !== uploaded.imageKey) {
    await deleteProductImageObject(product.id, product.imageKey).catch(() => undefined);
  }
  return uploaded;
}

export async function removeProductImage(product: Product, actorUid: string) {
  if (!product.imageKey) return;
  const previousKey = product.imageKey;
  await patchProductImageMetadata(product.id, null, actorUid, 'PRODUCT_IMAGE_REMOVED');
  await deleteProductImageObject(product.id, previousKey).catch(() => undefined);
}
