import type { ReactNode } from "react";
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
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? "is-active" : ""}
            onClick={() => onChange(option.value)}
            role="radio"
            aria-checked={value === option.value}
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
