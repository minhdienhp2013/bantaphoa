import { useId, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  formatVndInteger,
  getSteppedVndValue,
  parseVndInteger,
  sanitizeVndInput,
  type VndStepDirection,
} from './vndMoneyStep';
import './vndMoneyInput.css';

interface VndMoneyInputProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  min?: number;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  labelClassName?: string;
  ariaLabel?: string;
}

export default function VndMoneyInput({
  label,
  value,
  onChange,
  min = 0,
  required = false,
  disabled = false,
  readOnly = false,
  className,
  labelClassName,
  ariaLabel,
}: VndMoneyInputProps) {
  const generatedId = useId();
  const inputId = `vnd-money-${generatedId}`;
  const accessibleName = ariaLabel ?? label;
  const parsedValue = parseVndInteger(value);
  const displayValue = formatVndInteger(value);
  const canStepDown = !disabled && getSteppedVndValue(value, -1, min) !== null;
  const canStepUp = !disabled && getSteppedVndValue(value, 1, min) !== null;

  function applyStep(direction: VndStepDirection) {
    const next = getSteppedVndValue(value, direction, min);
    if (next === null) return;
    onChange(String(next));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    applyStep(event.key === 'ArrowUp' ? 1 : -1);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = sanitizeVndInput(event.currentTarget.value);
    onChange(next);
  }

  return (
    <div className={`vnd-money-input${className ? ` ${className}` : ''}`}>
      <label className={`vnd-money-input__label${labelClassName ? ` ${labelClassName}` : ''}`} htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className="vnd-money-input__field"
        aria-label={accessibleName}
        type="text"
        inputMode={readOnly ? 'none' : 'numeric'}
        pattern="[0-9,]*"
        role="spinbutton"
        aria-valuemin={min}
        aria-valuenow={parsedValue ?? undefined}
        value={displayValue}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        onFocus={(event) => {
          if (readOnly) event.currentTarget.blur();
        }}
        onKeyDown={(event) => {
          if (readOnly) {
            event.preventDefault();
            return;
          }
          handleKeyDown(event);
        }}
        onChange={(event) => {
          if (readOnly) return;
          handleChange(event);
        }}
      />
      <div className="vnd-money-input__steps" aria-label={`Điều chỉnh ${accessibleName}`}>
        <button
          className="vnd-money-input__step"
          type="button"
          aria-label={`Giảm ${accessibleName} 10.000 VND`}
          disabled={!canStepDown}
          onClick={() => applyStep(-1)}
        >
          ▼ 10k
        </button>
        <button
          className="vnd-money-input__step"
          type="button"
          aria-label={`Tăng ${accessibleName} 10.000 VND`}
          disabled={!canStepUp}
          onClick={() => applyStep(1)}
        >
          ▲ 10k
        </button>
      </div>
    </div>
  );
}
