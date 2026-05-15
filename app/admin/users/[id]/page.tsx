import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  entries,
  transactions,
  users,
} from "@/lib/db/schema";
import AdjustForm from "./AdjustForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminUserDetail({ params }: Props) {
  const { id } = await params;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!user) notFound();

  const userAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, id));

  // Recent transactions touching this user — pull entries on user-owned
  // accounts and join back to the parent transaction for context.
  const recent = await db
    .select({
      entryId: entries.id,
      direction: entries.direction,
      amount: entries.amount,
      accountType: accounts.type,
      kind: transactions.kind,
      txId: transactions.id,
      idempotencyKey: transactions.idempotencyKey,
      createdAt: entries.createdAt,
      metadata: transactions.metadata,
    })
    .from(entries)
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(eq(accounts.userId, id))
    .orderBy(desc(entries.createdAt))
    .limit(50);

  return (
    <section className="grid gap-6">
      <Link href="/admin" className="text-xs text-muted hover:text-foreground">
        ← all users
      </Link>

      <div>
        <h1 className="text-xl font-semibold">{user.email}</h1>
        <p className="text-sm text-muted">
          {user.displayName ?? "—"} · joined{" "}
          {new Date(user.createdAt).toLocaleString()}
        </p>
        <p className="mt-1 text-xs text-muted">
          ID <span className="font-mono">{user.id}</span>
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted">
          Accounts
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2">Type</th>
              <th>Currency</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {userAccounts.map((a) => (
              <tr key={a.id} className="border-b border-border/40">
                <td className="py-2 capitalize">{a.type}</td>
                <td>{a.currency}</td>
                <td className="font-mono tabular-nums">
                  ${Number(a.balance).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted">
          Manual adjustment
        </h2>
        <AdjustForm userId={user.id} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted">
          Recent ledger entries (50)
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2">When</th>
              <th>Kind</th>
              <th>Account</th>
              <th>Direction</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.entryId} className="border-b border-border/40">
                <td className="py-2 text-xs text-muted">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td>{r.kind}</td>
                <td className="capitalize">{r.accountType}</td>
                <td className={r.direction === "credit" ? "text-emerald-400" : "text-rose-400"}>
                  {r.direction}
                </td>
                <td className="font-mono tabular-nums">
                  ${Number(r.amount).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
