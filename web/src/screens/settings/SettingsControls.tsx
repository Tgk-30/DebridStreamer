import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { InfoTip } from "../../components/InfoTip";

export function SegmentedControl({
  label,
  value,
  options,
  onChange,
  infoTip,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  infoTip?: ReactNode;
}) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const moveSelection = (
    event: KeyboardEvent<HTMLDivElement>,
  ): void => {
    const current = buttonsRef.current.findIndex(
      (button) => button === event.target,
    );
    if (current < 0 || options.length === 0) return;
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (current + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (current - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = options.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const option = options[next];
    if (option == null) return;
    onChange(option.value);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div className="settings-segment-block">
      <span className="settings-label-line">
        <span className="settings-label">{label}</span>
        {infoTip && <InfoTip label={`About ${label}`}>{infoTip}</InfoTip>}
      </span>
      <div
        className="settings-segmented"
        role="radiogroup"
        aria-label={label}
        data-option-count={options.length}
        onKeyDown={moveSelection}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(element) => {
              buttonsRef.current[index] = element;
            }}
            type="button"
            className={value === option.value ? "is-active" : ""}
            onClick={() => onChange(option.value)}
            role="radio"
            aria-checked={value === option.value}
            tabIndex={value === option.value ? 0 : -1}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  helpUrl,
  helpLabel,
  children,
}: {
  label: string;
  hint?: string;
  /** Optional "where do I get this?" external link, rendered under the field. */
  helpUrl?: string;
  helpLabel?: string;
  children: ReactNode;
}) {
  return (
    <label className="settings-field">
      <span className="settings-label-line">
        <span className="settings-label">{label}</span>
        {hint && <InfoTip label={`About ${label}`}>{hint}</InfoTip>}
      </span>
      {children}
      {helpUrl && (
        <a
          className="settings-field-help"
          href={helpUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {helpLabel ?? "Get a key"} ↗
        </a>
      )}
    </label>
  );
}
