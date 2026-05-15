"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useAuthModal } from "../components/AuthModalContext";
import { useBalance } from "../components/BalanceContext";

interface Profile {
  id: string;
  email: string;
  displayName: string;
  totalWagered: string;
  betCount: number;
  createdAt: string;
}

export default function ProfilePage() {
  const { status } = useSession();
  const { setDisplayName } = useBalance();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/profile", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Profile | null) => {
        if (!cancelled && data) setProfile(data);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === "loading") return <main className="p-10 text-muted">Loading…</main>;
  if (status !== "authenticated") return <LoggedOutCta />;

  if (!profile) {
    return <main className="p-10 text-muted">Loading profile…</main>;
  }

  const wagered = Number(profile.totalWagered);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/" className="text-xs text-muted hover:text-foreground">
        ← back
      </Link>

      <section className="mt-4 rounded-2xl border border-border bg-[#1a1b24] p-6">
        <ProfileHeader
          displayName={profile.displayName}
          email={profile.email}
          onRenamed={(name) => {
            setProfile((p) => (p ? { ...p, displayName: name } : p));
            setDisplayName(name);
          }}
        />
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-[#1a1b24]">
        <h2 className="border-b border-border px-6 py-4 text-lg font-semibold">
          Statistics
        </h2>
        <Row label="Total Wagered" value={`$${wagered.toFixed(2)}`} />
        <Row label="Total Bets" value={profile.betCount.toLocaleString()} />
        <Row
          label="Member Since"
          value={new Date(profile.createdAt).toLocaleDateString()}
        />
      </section>
    </main>
  );
}

function ProfileHeader({
  displayName,
  email,
  onRenamed,
}: {
  displayName: string;
  email: string;
  onRenamed: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setDraft(displayName);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/profile/name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: draft }),
    });
    const data = (await res.json().catch(() => null)) as
      | { displayName?: string; error?: string }
      | null;
    setSaving(false);
    if (!res.ok || !data?.displayName) {
      setError(data?.error ?? "rename failed");
      return;
    }
    onRenamed(data.displayName);
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar seed={email} initials={initialsFor(displayName)} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={24}
              className="min-w-0 flex-1 rounded-md border border-border bg-panel-2 px-3 py-1.5 text-lg font-semibold"
            />
            <button
              onClick={save}
              disabled={saving || draft.trim() === displayName}
              className="rounded-md bg-gold px-3 py-1.5 text-sm font-bold text-black disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <h1 className="truncate text-2xl font-semibold">{displayName}</h1>
        )}
        {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
      </div>
      {!editing && (
        <button
          onClick={open}
          className="rounded-md border border-border bg-panel-2 px-4 py-1.5 text-sm hover:bg-panel"
        >
          Edit
        </button>
      )}
    </div>
  );
}

function Avatar({ seed, initials }: { seed: string; initials: string }) {
  const hue = hashHue(seed);
  return (
    <div
      className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-base font-bold uppercase"
      style={{
        background: `hsl(${hue} 70% 50%)`,
        boxShadow: `inset 0 0 0 2px hsl(${hue} 70% 65%)`,
      }}
    >
      {initials}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 px-6 py-3 text-sm last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1 font-mono tabular-nums">
        <span aria-hidden>🪙</span>
        {value}
      </span>
    </div>
  );
}

function LoggedOutCta() {
  const { show } = useAuthModal();
  return (
    <main className="grid place-items-center gap-3 p-10">
      <p className="text-muted">Log in to view your profile.</p>
      <button
        onClick={() => show("login")}
        className="rounded-lg border border-border px-4 py-2"
      >
        Log in
      </button>
    </main>
  );
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
