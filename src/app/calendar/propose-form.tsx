"use client";

import { useActionState } from "react";
import { proposeAction } from "../actions";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { HANDOFF_KINDS, HANDOFF_LABELS } from "@/lib/domain/types";

export interface ProposeDefaults {
  parentId?: string;
  fromDate?: string;
  fromTime?: string;
  untilDate?: string;
  untilTime?: string;
  startKind?: string;
  startLocation?: string;
  endKind?: string;
  endLocation?: string;
  counterOf?: string;
}

function HandoffFields({ prefix, kind, location }: { prefix: "start" | "end"; kind?: string; location?: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <select name={`${prefix}Kind`} defaultValue={kind ?? ""} className="input" aria-label="Handoff type">
        <option value="">No handoff details</option>
        {HANDOFF_KINDS.map((k) => (
          <option key={k} value={k}>{HANDOFF_LABELS[k][0].toUpperCase() + HANDOFF_LABELS[k].slice(1)}</option>
        ))}
      </select>
      <input name={`${prefix}Location`} defaultValue={location} placeholder="Where (optional)" className="input" />
    </div>
  );
}

export function ProposeForm({
  members,
  defaults,
  title,
}: {
  members: { userId: string; displayName: string }[];
  defaults: ProposeDefaults;
  title: string;
}) {
  const [state, action] = useActionState(proposeAction, undefined);
  return (
    <form action={action} className="card space-y-4" key={defaults.counterOf ?? "new"}>
      <h2 className="font-semibold">{title}</h2>
      {defaults.counterOf && <input type="hidden" name="counterOf" value={defaults.counterOf} />}
      <div>
        <label className="label" htmlFor="parentId">Who has the kids</label>
        <select id="parentId" name="parentId" className="input" defaultValue={defaults.parentId} required>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.displayName}</option>
          ))}
        </select>
      </div>
      <div>
        <span className="label">From</span>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" name="fromDate" defaultValue={defaults.fromDate} className="input" required aria-label="From date" />
          <input type="time" name="fromTime" defaultValue={defaults.fromTime} className="input" aria-label="From time" />
        </div>
        <p className="mt-1 text-xs text-gray-500">Leave the time empty to start at the beginning of the day.</p>
        <div className="mt-2">
          <HandoffFields prefix="start" kind={defaults.startKind} location={defaults.startLocation} />
        </div>
      </div>
      <div>
        <span className="label">Until</span>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" name="untilDate" defaultValue={defaults.untilDate} className="input" required aria-label="Until date" />
          <input type="time" name="untilTime" defaultValue={defaults.untilTime} className="input" aria-label="Until time" />
        </div>
        <p className="mt-1 text-xs text-gray-500">Leave the time empty to include that whole day.</p>
        <div className="mt-2">
          <HandoffFields prefix="end" kind={defaults.endKind} location={defaults.endLocation} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="message">Note to your co-parent (optional)</label>
        <textarea id="message" name="message" rows={2} className="input" />
      </div>
      <FormMessage state={state} />
      <SubmitButton>{defaults.counterOf ? "Send counter-proposal" : "Send for approval"}</SubmitButton>
    </form>
  );
}
