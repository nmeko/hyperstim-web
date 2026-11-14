"use client";

import { useCallback, useEffect, useState } from "react";

export type ApiState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "success"; data: T };

/**
 * Runs `load` on mount and whenever it changes; `retry` runs it again. `load` must be stable
 * (module-level or memoized). While a new `load` runs, the last result stays, with `stale` set;
 * a result from an older `load` never replaces a newer one.
 */
export function useApi<T>(
  load: () => Promise<T>,
): ApiState<T> & { stale: boolean; retry: () => void } {
  const [result, setResult] = useState<{ state: ApiState<T>; load?: () => Promise<T> }>({
    state: { status: "loading" },
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    load().then(
      (data) => current && setResult({ state: { status: "success", data }, load }),
      (error: unknown) => current && setResult({ state: { status: "error", error }, load }),
    );
    return () => {
      current = false;
    };
  }, [load, attempt]);

  const retry = useCallback(() => {
    setResult({ state: { status: "loading" } });
    setAttempt((n) => n + 1);
  }, []);

  return { ...result.state, stale: result.state.status !== "loading" && result.load !== load, retry };
}
