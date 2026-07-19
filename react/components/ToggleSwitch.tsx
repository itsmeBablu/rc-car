"use client";

type Props = {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  id?: string;
  disabled?: boolean;
};

/** Glossy iOS-style toggle used in Link settings. */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  hint,
  id,
  disabled = false,
}: Props) {
  const inputId = id ?? `toggle-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <label
      htmlFor={inputId}
      className={`flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-xs text-white/90">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-[10px] leading-snug text-white/40">
            {hint}
          </span>
        ) : null}
      </span>
      <span className="relative shrink-0">
        <input
          id={inputId}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          aria-disabled={disabled}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={`toggle-track peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--paint)] ${
            checked ? "is-on" : ""
          }`}
          aria-hidden
        >
          <span className="toggle-knob" />
        </span>
      </span>
    </label>
  );
}
