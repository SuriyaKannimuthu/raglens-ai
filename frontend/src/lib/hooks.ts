"use client";

import { useEffect, useState } from "react";
import useSWR, { type SWRConfiguration } from "swr";
import { fetcher } from "./api";

/** SWR wrapper bound to the backend. Pass `null` to skip fetching. */
export function useApi<T>(path: string | null, options?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher<T>, { revalidateOnFocus: false, keepPreviousData: true, ...options });
}

/** Current time, updated every `intervalMs`; null until mounted (avoids hydration mismatch). */
export function useNow(intervalMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
