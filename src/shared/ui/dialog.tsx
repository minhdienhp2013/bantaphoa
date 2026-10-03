import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { IconButton } from './primitives';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) =>
    !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0,
  );
}

interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  savingLock?: boolean;
  fullscreenMobile?: boolean;
  closeLabel?: string;
}

export function Dialog({
  open,
  title,
  children,
  footer,
  onClose,
  initialFocusRef,
  savingLock = false,
  fullscreenMobile = true,
  closeLabel = 'Đóng hộp thoại',
}: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(savingLock);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { savingRef.current = savingLock; }, [savingLock]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const initialTarget = initialFocusRef?.current ?? getFocusable(dialog)[0] ?? dialog;
    initialTarget.focus();

    function handleKeyDown(event: KeyboardEvent) {
      const currentDialog = dialogRef.current;
      if (!currentDialog) return;

      if (event.key === 'Escape') {
        if (savingRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable(currentDialog);
      if (focusable.length === 0) {
        event.preventDefault();
        currentDialog.focus();
        return;
      }

      const active = document.activeElement;
      const activeIndex = focusable.findIndex((element) => element === active);
      if (!currentDialog.contains(active) || activeIndex < 0) {
        event.preventDefault();
        (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
        return;
      }
      if (event.shiftKey && activeIndex === 0) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0].focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const opener = openerRef.current;
      if (opener && document.contains(opener) && !opener.hasAttribute('disabled')) opener.focus();
    };
  }, [initialFocusRef, open]);

  if (!open) return null;

  return (
    <div
      className="ui-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !savingLock) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`ui-dialog${fullscreenMobile ? ' ui-dialog--fullscreen-mobile' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={savingLock || undefined}
        tabIndex={-1}
      >
        <header className="ui-dialog__header">
          <h2 id={titleId} className="ui-dialog__title">{title}</h2>
          <IconButton type="button" variant="ghost" label={closeLabel} disabled={savingLock} onClick={onClose}>×</IconButton>
        </header>
        <div className="ui-dialog__body">{children}</div>
        {footer ? <footer className="ui-dialog__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
