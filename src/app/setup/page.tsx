import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  const ctx = await getContext();
  if (!ctx) redirect("/");
  if (ctx.family) redirect("/calendar");
  const first = ctx.session?.user?.name?.split(" ")[0] ?? "";
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Set up your family</h1>
        <p className="mt-1 text-sm text-gray-600">
          You&apos;ll get an invite link for your co-parent next. If they already sent you one, open that link instead.
        </p>
      </div>
      <SetupForm defaultName={first} timeZones={Intl.supportedValuesOf("timeZone")} />
    </div>
  );
}
