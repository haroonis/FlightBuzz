import { GroupRegistry, defaultRegistry, knownCurrencies, type MetaResponse } from "@flightbuzz/core";
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppCtx, type AppState } from "./appContext.ts";
import { api, ServerDownError } from "./api.ts";

export function AppProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [serverDown, setServerDown] = useState(false);

  const refreshMeta = useCallback(async () => {
    try {
      const m = await api.meta();
      setMeta(m);
      setServerDown(false);
    } catch (e) {
      if (e instanceof ServerDownError) setServerDown(true);
    }
  }, []);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  const reportError = useCallback((e: unknown) => {
    if (e instanceof ServerDownError) {
      setServerDown(true);
      return "Server not reachable";
    }
    setServerDown(false);
    return e instanceof Error ? e.message : String(e);
  }, []);

  const registry = useMemo(
    () => (meta ? new GroupRegistry(meta.groups.filter((g) => !g.builtin)) : defaultRegistry),
    [meta],
  );

  const currencies = useMemo(() => {
    const list = meta?.currencies?.length ? meta.currencies : knownCurrencies();
    return [...list].sort();
  }, [meta]);

  const value = useMemo(
    () => ({ meta, registry, serverDown, currencies, refreshMeta, reportError }),
    [meta, registry, serverDown, currencies, refreshMeta, reportError],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
