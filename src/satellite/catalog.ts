import type { GpRecord } from "./types";

interface CatalogFile {
  fetchedAt?: string;
  count?: number;
  records: GpRecord[];
}

async function loadJson(url: string, signal?: AbortSignal): Promise<CatalogFile> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return (await response.json()) as CatalogFile;
}

/** Imaging / weather / crew catalog for pass search. */
export async function loadSearchCatalog(signal?: AbortSignal): Promise<{
  fetchedAt: string | null;
  records: GpRecord[];
}> {
  const data = await loadJson("/data/celestrak-search.json", signal);
  return {
    fetchedAt: data.fetchedAt ?? null,
    records: data.records ?? [],
  };
}

/** Broader set for globe dots. */
export async function loadGlobeCatalog(signal?: AbortSignal): Promise<GpRecord[]> {
  try {
    const data = await loadJson("/data/celestrak-globe.json", signal);
    return data.records ?? [];
  } catch {
    const search = await loadSearchCatalog(signal);
    return search.records;
  }
}
