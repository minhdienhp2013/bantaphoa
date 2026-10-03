const MOBILE_SALES_MEDIA = '(max-width: 760px)';

function isMobileSalesViewport() {
  return window.matchMedia(MOBILE_SALES_MEDIA).matches;
}

function createShortcutButton(
  className: string,
  label: string,
  icon: string,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `sales-topbar-shortcut ${className}`;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<span aria-hidden="true">${icon}</span>`;
  return button;
}

function ensureShortcutHost(topbar: HTMLElement) {
  const existing = topbar.querySelector<HTMLElement>('.sales-topbar-shortcuts');
  if (existing) return existing;

  const host = document.createElement('div');
  host.className = 'sales-topbar-shortcuts';
  host.hidden = true;
  host.setAttribute('aria-label', 'Truy cập nhanh bán hàng');

  host.append(
    createShortcutButton('sales-topbar-shortcut--search', 'Tìm sản phẩm nhanh', '⌕'),
    createShortcutButton('sales-topbar-shortcut--qr', 'Quét QR hoặc barcode nhanh', '▦'),
  );

  topbar.append(host);
  return host;
}

function focusSalesSearch() {
  const shell = document.querySelector<HTMLElement>('.sales-pos-shell');
  const searchArea = shell?.querySelector<HTMLElement>('.sales-search-area');
  const input = shell?.querySelector<HTMLInputElement>('.sales-search-box input');
  const topbar = document.querySelector<HTMLElement>('.topbar');
  if (!searchArea || !input || !topbar) return;

  // Keep the focus inside the original React-controlled input so Search Core/AI state stays unchanged.
  input.focus({ preventScroll: true });

  const topbarHeight = topbar.getBoundingClientRect().height;
  const targetTop = Math.max(
    0,
    window.scrollY + searchArea.getBoundingClientRect().top - topbarHeight - 6,
  );
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
  window.scrollTo({ top: targetTop, behavior });
}

function openSalesScanner() {
  const scanButton = document.querySelector<HTMLButtonElement>('.sales-pos-shell .sales-scan-button');
  if (!scanButton) return;
  scanButton.click();
}

export function installSalesMobileTopbarShortcuts() {
  let animationFrame = 0;

  const update = () => {
    animationFrame = 0;

    const topbar = document.querySelector<HTMLElement>('.topbar');
    if (!topbar) return;

    const host = ensureShortcutHost(topbar);
    const shell = document.querySelector<HTMLElement>('.sales-pos-shell');
    const searchArea = shell?.querySelector<HTMLElement>('.sales-search-area') ?? null;

    if (!isMobileSalesViewport() || !shell || !searchArea) {
      host.hidden = true;
      host.classList.remove('is-visible');
      return;
    }

    const topbarBottom = topbar.getBoundingClientRect().bottom;
    const searchBottom = searchArea.getBoundingClientRect().bottom;
    const shouldShow = searchBottom <= topbarBottom + 8;

    host.hidden = !shouldShow;
    host.classList.toggle('is-visible', shouldShow);
  };

  const scheduleUpdate = () => {
    if (animationFrame) return;
    animationFrame = window.requestAnimationFrame(update);
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest('.sales-topbar-shortcut--search')) {
      focusSalesSearch();
      return;
    }

    if (target.closest('.sales-topbar-shortcut--qr')) {
      openSalesScanner();
    }
  });

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleUpdate, { passive: true });

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, { childList: true, subtree: true });

  scheduleUpdate();
}
