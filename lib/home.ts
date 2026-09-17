import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";

/** Read only current navigation access; neither console trusts this as a grant. */
export interface HomeAccess {
  configured: boolean;
  signedIn: boolean;
  displayName?: string | null;
  admin: boolean;
  chapter: { name: string | null; status: "active" | "lapsed" } | null;
}

export async function readHomeAccess(signal?: AbortSignal): Promise<HomeAccess> {
  const response = await fetch(apiUrl("/api/home"), {
    credentials: API_CREDENTIALS, cache: "no-store", signal,
  });
  if (!response.ok) throw new Error("Could not load your workspaces. Try again.");
  return response.json() as Promise<HomeAccess>;
}
