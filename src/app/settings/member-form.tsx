"use client";

import { useActionState } from "react";
import { updateMemberAction } from "../actions";
import { ColorPicker, FormMessage, SubmitButton } from "@/components/form-bits";

export function MemberForm({ name, colorId, taken }: { name: string; colorId: string; taken: string[] }) {
  const [state, action] = useActionState(updateMemberAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="displayName">Your name, as it appears on events</label>
        <input id="displayName" name="displayName" className="input" defaultValue={name} required />
      </div>
      <ColorPicker value={colorId} taken={taken} />
      <FormMessage state={state} />
      <SubmitButton>Save</SubmitButton>
    </form>
  );
}
