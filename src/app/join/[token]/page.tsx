import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { signInAction } from "../../actions";
import { db } from "@/db";
import { families, familyMembers, invites } from "@/db/schema";
import { getContext } from "@/lib/context";
import { JoinForm } from "./join-form";

export default async function JoinPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const [invite] = await db
    .select({ familyId: invites.familyId, familyName: families.name })
    .from(invites)
    .innerJoin(families, eq(families.id, invites.familyId))
    .where(and(eq(invites.token, token), isNull(invites.usedAt), gt(invites.expiresAt, new Date())));
  if (!invite) {
    return <p className="card mx-auto max-w-md">This invite link has expired or was already used. Ask for a new one.</p>;
  }
  const members = await db.select().from(familyMembers).where(eq(familyMembers.familyId, invite.familyId));
  const inviter = members[0]?.displayName ?? "Your co-parent";

  const ctx = await getContext();
  if (ctx?.family) redirect("/calendar");
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Join {invite.familyName}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {inviter} invited you to agree on the kids&apos; schedule together.
        </p>
      </div>
      {ctx ? (
        <JoinForm
          token={token}
          defaultName={ctx.session?.user?.name?.split(" ")[0] ?? ""}
          taken={members.map((m) => m.colorId)}
        />
      ) : (
        <form action={signInAction} className="card">
          <input type="hidden" name="redirectTo" value={`/join/${token}`} />
          <button className="btn-primary">Sign in with Google to join</button>
        </form>
      )}
    </div>
  );
}
