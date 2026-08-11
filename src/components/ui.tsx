"use client";

/** Small form/display primitives shared across the app. */
import { useState } from "react";

export function Card({
  title,
  children,
  className = "",
  actions,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          {title && <h3 className="text-sm font-semibold text-slate-700">{title}</h3>}
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 " +
  "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function DateInput({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="date"
      className={inputClass}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    />
  );
}

/** Numeric input that tolerates in-progress typing; commits parsed numbers. */
export function NumberInput({
  value,
  onChange,
  step,
  min,
  disabled,
  suffix,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number | string;
  min?: number;
  disabled?: boolean;
  suffix?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [lastValue, setLastValue] = useState(value);
  // Sync from the prop when it changes externally (React's recommended
  // "adjust state during render" pattern), preserving in-progress typing.
  if (value !== lastValue) {
    setLastValue(value);
    const parsed = text === "" ? null : Number(text);
    const same =
      (parsed === null && value === null) ||
      (parsed !== null && value !== null && Math.abs(parsed - value) < 1e-9);
    if (!same) setText(value === null ? "" : String(value));
  }
  return (
    <div className="relative">
      <input
        type="number"
        className={inputClass + (suffix ? " pr-9" : "")}
        value={text}
        step={step}
        min={min}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.value === "" ? null : Number(e.target.value);
          if (n === null || !Number.isNaN(n)) onChange(n);
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Percent input displayed in % units, stored as a fraction (0.15 <-> 15). */
export function PercentInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <NumberInput
      value={Math.round(value * 1e6) / 1e4}
      onChange={(v) => onChange((v ?? 0) / 100)}
      step="0.01"
      min={0}
      suffix="%"
      disabled={disabled}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      className={inputClass}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const styles = {
    primary:
      "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300",
    secondary:
      "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-300",
    danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
    ghost: "text-slate-500 hover:bg-slate-100 disabled:text-slate-300",
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "red" | "amber" | "blue";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600 align-middle" />
  );
}
