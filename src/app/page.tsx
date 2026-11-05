import { redirect } from "next/navigation";
import { signInAction } from "./actions";
import { getContext } from "@/lib/context";

export default async function Home() {
  const ctx = await getContext();
  if (ctx?.family) redirect("/calendar");
  if (ctx) redirect("/setup");
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <h1 className="text-2xl font-semibold">Who has the kids today?</h1>
      <p className="mt-3 text-gray-600">
        Agree on the schedule with your co-parent, including school drop-offs and pick-ups, and see it on your
        shared Google Calendar.
      </p>
      <form action={signInAction} className="mt-8">
        <input type="hidden" name="redirectTo" value="/setup" />
        <button className="btn-primary px-6 py-3">Sign in with Google</button>
      </form>
    </div>
  );
}
