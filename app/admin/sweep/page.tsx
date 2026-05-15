import SweepClient from "./SweepClient";
import { houseAddress } from "@/lib/solanaCustody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AdminSweepPage() {
  // Layout already enforces requireAdmin(). Just render the client UI with
  // the static house address pre-resolved on the server.
  return <SweepClient house={houseAddress()} />;
}
