// Side-effect module: load .env.local before anything reads process.env.
// Imported as the first line of server/index.ts. Next.js's own runtime
// loads .env.local automatically, so this only matters for the standalone
// socket server.
import { config } from "dotenv";

config({ path: ".env.local" });
