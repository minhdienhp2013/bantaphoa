const QUICK_CHECKOUT_SCROLL_DURATION_MS = 900;
const QUICK_CHECKOUT_INTERCEPT_WINDOW_MS = 1200;

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export function installSalesQuickCheckoutScrollSpeed() {
  const nativeScrollTo = window.scrollTo.bind(window);
  let interceptUntil = 0;
  let animationFrame = 0;

  function animateWindowTo(targetTop: number) {
    if (animationFrame) window.cancelAnimationFrame(animationFrame);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nativeScrollTo({ top: targetTop, behavior: 'auto' });
      return;
    }

    const startTop = window.scrollY;
    const distance = targetTop - startTop;
    const startedAt = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / QUICK_CHECKOUT_SCROLL_DURATION_MS);
      const eased = easeInOutCubic(progress);
      nativeScrollTo({ top: startTop + distance * eased, behavior: 'auto' });

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(step);
      } else {
        animationFrame = 0;
      }
    };

    animationFrame = window.requestAnimationFrame(step);
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('.sales-service-tile')) return;
    interceptUntil = performance.now() + QUICK_CHECKOUT_INTERCEPT_WINDOW_MS;
  }, true);

  window.scrollTo = ((first: number | ScrollToOptions, second?: number) => {
    if (typeof first === 'object') {
      if (
        performance.now() <= interceptUntil
        && first.behavior === 'smooth'
        && typeof first.top === 'number'
      ) {
        interceptUntil = 0;
        animateWindowTo(Math.max(0, first.top));
        return;
      }

      nativeScrollTo(first);
      return;
    }

    nativeScrollTo({ left: first, top: second ?? 0, behavior: 'auto' });
  }) as typeof window.scrollTo;
}
