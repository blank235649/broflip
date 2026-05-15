import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, users } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = (q ?? "").trim().toLowerCase();

  // Latest 100 users, optionally filtered by email substring. Joined to the
  // user wallet account so balance is visible alongside the row.
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
      walletBalance: accounts.balance,
    })
    .from(users)
    .leftJoin(
      accounts,
      sql`${accounts.userId} = ${users.id} AND ${accounts.type} = 'user' AND ${accounts.currency} = 'USD'`,
    )
    .where(search ? sql`lower(${users.email}) like ${"%" + search + "%"}` : undefined)
    .orderBy(desc(users.createdAt))
    .limit(100);
  void eq;

  return (
    <section>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users</h1>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="search by email"
            className="rounded-md border border-border bg-panel-2 px-3 py-1.5 text-sm"
          />
          <button className="rounded-md border border-border px-3 py-1.5 text-sm">
            Search
          </button>
        </form>
      </div>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted">
            <th className="py-2">Email</th>
            <th>Display name</th>
            <th>Balance</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-b border-border/40">
              <td className="py-2 font-mono">
                {u.email}
                {u.isAdmin && (
                  <span className="ml-2 rounded bg-gold/20 px-1.5 py-0.5 text-[10px] uppercase text-gold">
                    admin
                  </span>
                )}
              </td>
              <td>{u.displayName ?? "—"}</td>
              <td className="font-mono tabular-nums">
                ${Number(u.walletBalance ?? 0).toFixed(2)}
              </td>
              <td className="text-xs text-muted">
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
              <td className="text-right">
                <Link
                  href={`/admin/users/${u.id}`}
                  className="text-xs text-accent hover:underline"
                >
                  open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
