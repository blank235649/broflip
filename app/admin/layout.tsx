import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/adminAuth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between border-b border-border pb-4">
        <div>
          <Link
            href="/admin"
            className="text-lg font-semibold tracking-tight"
          >
            Admin
          </Link>
          <span className="ml-2 text-xs text-muted">{admin.email}</span>
        </div>
        <Link href="/" className="text-xs text-muted hover:text-foreground">
          ← back to game
        </Link>
      </header>
      {children}
    </div>
  );
}
