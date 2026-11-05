"use client";

import { useFormStatus } from "react-dom";
import { EVENT_COLORS } from "@/lib/colors";

export function SubmitButton({ children, className = "btn-primary" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function FormMessage({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) return <p className="text-sm text-red-700" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-green-700">{state.ok}</p>;
  return null;
}

export function ColorPicker({ name = "colorId", value, taken = [] }: { name?: string; value?: string; taken?: string[] }) {
  return (
    <fieldset>
      <legend className="label">Your color on the calendar</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {EVENT_COLORS.map((c) => {
          const disabled = taken.includes(c.id);
          return (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm has-[:checked]:border-gray-900 has-[:checked]:ring-1 has-[:checked]:ring-gray-900 ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
            >
              <input type="radio" name={name} value={c.id} defaultChecked={value === c.id} disabled={disabled} className="sr-only" required />
              <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: c.hex }} />
              <span>
                {c.name}
                {"note" in c && <span className="block text-xs text-gray-500">{c.note}</span>}
                {disabled && <span className="block text-xs text-gray-500">taken by co-parent</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
