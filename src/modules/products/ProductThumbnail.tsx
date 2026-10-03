import { useEffect, useState } from 'react';
import type { Product } from '../../types/models';
import { getProductImageUrl } from './productImageService';

interface ProductThumbnailProps {
  product: Product;
  className?: string;
  eager?: boolean;
}

export default function ProductThumbnail({ product, className = '', eager = false }: ProductThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const src = getProductImageUrl(product.imageKey);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return <span className={`product-image-placeholder ${className}`.trim()} aria-hidden="true">Ảnh</span>;
  }

  return (
    <img
      className={`product-image-thumbnail ${className}`.trim()}
      src={src}
      alt={`Ảnh ${product.name}`}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
