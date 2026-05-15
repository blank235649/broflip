'use client';

import { TbCoins } from "react-icons/tb";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useBalance } from "./BalanceContext";
import { useAuthModal } from "./AuthModalContext";

export default function Header() {
  const { balance, lastDelta: delta, identity } = useBalance();
  const { data: session, status } = useSession();
  const { show } = useAuthModal();
  const isAuthed = !!session?.user;
  const username = isAuthed ? identity.username : null;

  return (
    <header className="mb-6 flex items-center justify-between bg-[#15161D] p-3 shadow-xl">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-accent to-gold text-sm font-bold text-black">
          BF
        </div>
        <div>
          <div className="text-base font-semibold tracking-tight">Broflip</div>
          <div className="text-xs text-muted">Two-Up · provably fair</div>
        </div>
      </div>

      <div className="flex flex-row gap-4 items-center">
        {isAuthed && (
          <div className="flex mr-10 items-center gap-2">
            {delta && (
              <span
                key={delta.key}
                className={`bet-in font-mono text-xs tabular-nums ${
                  delta.amount >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {delta.amount >= 0 ? "+" : ""}
                {delta.amount.toFixed(2)}
              </span>
            )}
            <div className="flex flex-row gap-1 items-center">
              <TbCoins className="text-[#E9B10E] text-xl self-center" />
              <span className="font-mono text-sm font-semibold tabular-nums text-[#E9B10E]">
                {balance.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {status === "loading" ? null : isAuthed ? (
          <>
            <Link href="/affiliate" className="text-sm hover:text-foreground">
              Affiliate
            </Link>
            <Link href="/withdraw" className="text-sm hover:text-foreground">
              Withdraw
            </Link>
            <Link
              href="/deposit"
              className="bg-gold p-2 rounded-lg text-sm font-semibold text-black"
            >
              Deposit
            </Link>
            <Link href="/profile" className="text-sm hover:text-foreground">
              {username}
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="text-sm text-muted hover:text-foreground"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <button onClick={() => show("login")} className="text-sm">
              Log in
            </button>
            <button
              onClick={() => show("register")}
              className="rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-black"
            >
              Sign up
            </button>
          </>
        )}
      </div>
    </header>
  );
}
