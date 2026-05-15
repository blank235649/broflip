"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { BalanceProvider } from "./BalanceContext";
import { AuthModalProvider } from "./AuthModalContext";
import AuthModal from "./AuthModal";

// Wallet-adapter UI styles. Imported here (in a "use client" boundary)
// so the modal popup it renders gets its CSS variables.
import "@solana/wallet-adapter-react-ui/styles.css";

export default function Providers({
  children,
  session,
}: {
  children: ReactNode;
  session: Session | null;
}) {
  // Endpoint mirrors the server-side SOLANA_RPC_URL. Memoized — changing it
  // would force-reconnect every wallet, which we never need at runtime.
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    [],
  );

  // Empty wallets array → rely entirely on the Wallet Standard's auto
  // discovery. Modern Phantom / Solflare / Backpack / Glow / Magic Eden
  // self-register through the standard. Adding explicit adapters here
  // would only matter for legacy wallets that haven't migrated.
  const wallets = useMemo(() => [], []);

  return (
    <SessionProvider session={session}>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <BalanceProvider>
              <AuthModalProvider>
                {children}
                <AuthModal />
              </AuthModalProvider>
            </BalanceProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </SessionProvider>
  );
}
