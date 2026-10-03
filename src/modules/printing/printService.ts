export interface PrintPageSize {
  widthMm: number;
  heightMm: number;
}

const PAGE_SIZE_STYLE_ID = 'label-print-page-size';

function clearInjectedPageSize(): void {
  document.getElementById(PAGE_SIZE_STYLE_ID)?.remove();
}

function injectPageSize(pageSize: PrintPageSize): HTMLStyleElement {
  clearInjectedPageSize();
  const style = document.createElement('style');
  style.id = PAGE_SIZE_STYLE_ID;
  style.textContent = `@page { size: ${pageSize.widthMm}mm ${pageSize.heightMm}mm; margin: 0; }`;
  document.head.append(style);
  return style;
}

export function printLabels(pageSize?: PrintPageSize): void {
  if (typeof window.print !== 'function') {
    throw new Error('Trình duyệt này không hỗ trợ hộp thoại in tiêu chuẩn.');
  }

  clearInjectedPageSize();
  const style = pageSize ? injectPageSize(pageSize) : null;
  const cleanup = () => style?.remove();

  if (style) {
    window.addEventListener('afterprint', cleanup, { once: true });
  }

  try {
    window.print();
  } catch {
    cleanup();
    throw new Error('Không thể mở hộp thoại in. Hãy kiểm tra quyền của trình duyệt và thử lại.');
  }
}
