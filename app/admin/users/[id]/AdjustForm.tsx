"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdjustForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const res = await fetch(`/api/admin/users/${userId}/adjust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount, reason, direction }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; balance?: string; error?: string }
      | null;
    setSubmitting(false);

    if (!res.ok) {
      setMessage(data?.error ?? "adjustment failed");
      return;
    }
    setMessage(`OK — new balance $${Number(data?.balance ?? 0).toFixed(2)}`);
    setAmount("");
    setReason("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2 rounded-md border border-border bg-panel/40 p-3 text-sm">
      <div className="flex gap-2">
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as "credit" | "debit")}
          className="rounded-md border border-border bg-panel-2 px-2 py-1.5"
        >
          <option value="credit">Credit (add)</option>
          <option value="debit">Debit (remove)</option>
        </select>
        <input
          type="number"
          step="0.01"
          min="0"
          required
          placeholder="amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="flex-1 rounded-md border border-border bg-panel-2 px-2 py-1.5"
        />
      </div>
      <input
        type="text"
        required
        maxLength={200}
        placeholder="reason (audit log)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="rounded-md border border-border bg-panel-2 px-2 py-1.5"
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-gold py-1.5 text-xs font-bold text-black disabled:opacity-60"
      >
        {submitting ? "Applying…" : "Apply adjustment"}
      </button>
      {message && <p className="text-xs text-muted">{message}</p>}
    </form>
  );
}
