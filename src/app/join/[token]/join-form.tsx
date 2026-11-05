"use client";

import { useActionState } from "react";
import { joinFamilyAction } from "../../actions";
import { ColorPicker, FormMessage, SubmitButton } from "@/components/form-bits";

export function JoinForm({ token, defaultName, taken }: { token: string; defaultName: string; taken: string[] }) {
  const [state, action] = useActionState(joinFamilyAction, undefined);
  return (
    <form action={action} className="card space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="displayName">Your name, as it appears on events</label>
        <input id="displayName" name="displayName" className="input" defaultValue={defaultName} required />
      </div>
      <ColorPicker taken={taken} />
      <FormMessage state={state} />
      <SubmitButton>Join</SubmitButton>
    </form>
  );
}
