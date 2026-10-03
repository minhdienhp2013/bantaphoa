function closestElement(target: EventTarget | null, selector: string) {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

function getSearchAreaFromShell(shell: HTMLElement | null) {
  return shell?.querySelector<HTMLElement>('.sales-search-area') ?? null;
}

function isMobileSalesViewport() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function dismissActiveMobileKeyboard() {
  if (!isMobileSalesViewport()) return;

  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) {
    return;
  }

  const belongsToSalesInput = Boolean(
    active.closest('.sales-search-area, .sales-chat-card'),
  );
  if (belongsToSalesInput) active.blur();
}

function setElementDismissed(element: HTMLElement | null, dismissed: boolean) {
  if (!element) return;

  // Older UI-01 builds used the native `hidden` attribute, which cannot animate.
  // Always clear it, then let CSS transition the compact mobile result panel.
  element.hidden = false;
  element.classList.toggle('is-search-cluster-dismissed', dismissed);

  if (dismissed) {
    element.setAttribute('aria-hidden', 'true');
    element.inert = true;
  } else {
    element.removeAttribute('aria-hidden');
    element.inert = false;
  }
}

function setSearchClusterHidden(area: HTMLElement, hidden: boolean) {
  setElementDismissed(area.querySelector<HTMLElement>('.sales-search-results'), hidden);

  const shell = area.closest<HTMLElement>('.sales-pos-shell');
  setElementDismissed(shell?.querySelector<HTMLElement>('.sales-chat-card') ?? null, hidden);
}

function isSearchClusterInteractiveTarget(target: EventTarget | null) {
  return Boolean(closestElement(
    target,
    [
      '.sales-search-row',
      '.sales-search-results',
      '.sales-manual-correction-status',
      '.sales-scanner-panel',
      '.sales-error',
    ].join(', '),
  ));
}

export function installSalesSearchDismiss() {
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    const searchArea = closestElement(target, '.sales-search-area');
    const chatCard = closestElement(target, '.sales-chat-card');

    if (searchArea) {
      const isMobile = isMobileSalesViewport();

      if (isMobile && !isSearchClusterInteractiveTarget(target)) {
        // The compact result window intentionally leaves side gutters. Tapping those gutters
        // is treated as an outside tap so both normal and AI/alias results close together.
        dismissActiveMobileKeyboard();
        setSearchClusterHidden(searchArea, true);
        return;
      }

      // Search input, Ask, Mic, QR and the normal result list belong to one result cluster.
      setSearchClusterHidden(searchArea, false);
      return;
    }

    if (chatCard) {
      // Keep AI candidates/buttons usable and allow touch scrolling inside the result card.
      return;
    }

    dismissActiveMobileKeyboard();
    document.querySelectorAll<HTMLElement>('.sales-search-area').forEach((area) => {
      setSearchClusterHidden(area, true);
    });
  }, { passive: true });

  document.addEventListener('submit', (event) => {
    if (!isMobileSalesViewport()) return;
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches('.sales-unified-search-row, .sales-chat-form')) return;

    // On iPhone/Android, pressing Search/Go/Enter or tapping the Ask button should
    // finish text entry and give the result panel the full viewport height.
    dismissActiveMobileKeyboard();
  }, true);

  document.addEventListener('focusin', (event) => {
    const searchArea = closestElement(event.target, '.sales-search-area');
    if (searchArea) {
      setSearchClusterHidden(searchArea, false);
      return;
    }

    const chatCard = closestElement(event.target, '.sales-chat-card');
    if (!chatCard) return;
    const shell = chatCard.closest<HTMLElement>('.sales-pos-shell');
    const area = getSearchAreaFromShell(shell);
    if (area) setSearchClusterHidden(area, false);
  });

  document.addEventListener('input', (event) => {
    const searchArea = closestElement(event.target, '.sales-search-area');
    if (searchArea) setSearchClusterHidden(searchArea, false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    const active = document.activeElement;
    const directArea = closestElement(active, '.sales-search-area');
    if (directArea) {
      dismissActiveMobileKeyboard();
      setSearchClusterHidden(directArea, true);
      return;
    }

    const chatCard = closestElement(active, '.sales-chat-card');
    const shell = chatCard?.closest<HTMLElement>('.sales-pos-shell') ?? null;
    const area = getSearchAreaFromShell(shell);
    if (area) {
      dismissActiveMobileKeyboard();
      setSearchClusterHidden(area, true);
    }
  });
}
