import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  ariaDisabled?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', ariaDisabled = false, disabled, onClick, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      className={cx('ui-button', `ui-button--${variant}`, className)}
      disabled={disabled}
      aria-disabled={ariaDisabled || undefined}
      onClick={(event) => {
        if (ariaDisabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    />
  );
});

interface IconButtonProps extends ButtonProps {
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, children, ...props },
  ref,
) {
  return (
    <Button {...props} ref={ref} className={cx('ui-icon-button', className)} aria-label={label}>
      {children}
    </Button>
  );
});

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={cx('ui-card', className)} />;
}

export function PageHeader({ eyebrow, title, description, actions, className }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cx('ui-page-header', className)}>
      <div className="ui-page-header__copy">
        {eyebrow ? <div className="ui-page-header__eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function ActionTile({ icon, title, description, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; title: ReactNode; description?: ReactNode }) {
  return (
    <button {...props} className={cx('ui-action-tile', className)}>
      {icon ? <span className="ui-action-tile__icon" aria-hidden="true">{icon}</span> : null}
      <span className="ui-action-tile__copy">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </button>
  );
}


export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span {...props} className={cx('ui-badge', `ui-tone--${tone}`, className)} />;
}

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Exclude<Tone, 'neutral' | 'primary'>;
  title?: string;
  announce?: 'polite' | 'assertive' | 'off';
}

export function Alert({ tone = 'info', title, announce = 'polite', className, children, ...props }: AlertProps) {
  const role = tone === 'danger' || announce === 'assertive' ? 'alert' : 'status';
  return (
    <div
      {...props}
      className={cx('ui-alert', `ui-tone--${tone}`, className)}
      role={announce === 'off' ? undefined : role}
      aria-live={announce === 'off' ? undefined : announce}
    >
      {title ? <strong className="ui-alert__title">{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

export const StatusMessage = Alert;

interface FormFieldProps {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, htmlFor, hint, error, required, children, className }: FormFieldProps) {
  const messageId = `${htmlFor}-message`;
  return (
    <div className={cx('ui-form-field', className)}>
      <label className="ui-form-field__label" htmlFor={htmlFor}>
        {label}{required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? (
        <div id={messageId} className="ui-form-field__error" role="alert">{error}</div>
      ) : hint ? (
        <div id={messageId} className="ui-form-field__hint">{hint}</div>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props }, ref,
) {
  return <input {...props} ref={ref} className={cx('ui-input', className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props }, ref,
) {
  return <select {...props} ref={ref} className={cx('ui-select', className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props }, ref,
) {
  return <textarea {...props} ref={ref} className={cx('ui-textarea', className)} />;
});

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, id, ...props }, ref,
) {
  return (
    <label className={cx('ui-checkbox', className)}>
      <input {...props} id={id} ref={ref} type="checkbox" />
      <span>{label}</span>
    </label>
  );
});

interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  onClear?: () => void;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { label = 'Tìm kiếm', onClear, value, className, ...props }, ref,
) {
  const hasValue = typeof value === 'string' && value.length > 0;
  return (
    <div className={cx('ui-search-field', className)}>
      <span aria-hidden="true">⌕</span>
      <Input {...props} ref={ref} value={value} type="search" aria-label={label} />
      {onClear && hasValue ? (
        <IconButton type="button" variant="ghost" label="Xóa nội dung tìm kiếm" onClick={onClear}>×</IconButton>
      ) : null}
    </div>
  );
});

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-state ui-empty-state">
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
      {action ? <div className="ui-state__action">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="ui-state ui-loading-state" role="status" aria-live="polite" aria-busy="true">
      <span className="ui-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
