"use client";

import { useActionState } from "react";
import { createFamilyAction } from "../actions";
import { ColorPicker, FormMessage, SubmitButton } from "@/components/form-bits";

export function SetupForm({ defaultName, timeZones }: { defaultName: string; timeZones: string[] }) {
  const [state, action] = useActionState(createFamilyAction, undefined);
  const guess = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/New_York";
  return (
    <form action={action} className="card space-y-4">
      <div>
        <label className="label" htmlFor="familyName">Family name</label>
        <input id="familyName" name="familyName" className="input" placeholder="e.g. Ibragimov kids" required />
      </div>
      <div>
        <label className="label" htmlFor="displayName">Your name, as it appears on events</label>
        <input id="displayName" name="displayName" className="input" defaultValue={defaultName} required />
      </div>
      <div>
        <label className="label" htmlFor="timeZone">Time zone</label>
        <select id="timeZone" name="timeZone" className="input" defaultValue={timeZones.includes(guess) ? guess : "America/New_York"}>
          {timeZones.map((tz) => (
            <option key={tz} value={tz}>{tz.replaceAll("_", " ")}</option>
          ))}
        </select>
      </div>
      <ColorPicker value="7" />
      <FormMessage state={state} />
      <SubmitButton>Create family</SubmitButton>
    </form>
  );
}
