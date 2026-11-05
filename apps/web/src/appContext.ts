import type { GroupRegistry, MetaResponse } from "@flightbuzz/core";
import { createContext } from "react";

// Kept apart from context.tsx (type-only core imports) so hot reloads of core don't recreate the context.
export interface AppState {
  meta: MetaResponse | null;
  registry: GroupRegistry;
  serverDown: boolean;
  currencies: string[];
  refreshMeta: () => Promise<void>;
  reportError: (e: unknown) => string;
}

export const AppCtx = createContext<AppState | null>(null);
