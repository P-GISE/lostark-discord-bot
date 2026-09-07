import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  comparePreferredMerchantServers,
  isPreferredMerchantServer,
} from "./merchant-config";
import type {
  MerchantListing,
  MerchantServerEntry,
  MerchantSource,
  MerchantStore,
} from "./merchant.types";

const DATA_PATH = path.join(process.cwd(), "data", "merchant-cards.json");

type LegacyMerchantStore = {
  servers: Record<string, MerchantListing | MerchantServerEntry>;
};

function normalizeServerName(server: string): string {
  return server.trim().toLocaleLowerCase("ko-KR");
}

function sortKorean(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "ko-KR"),
  );
}

function normalizeListing(
  listing: MerchantListing,
  defaultSource: MerchantSource,
): MerchantListing {
  return {
    ...listing,
    server: listing.server.trim(),
    merchantName: listing.merchantName?.trim() || undefined,
    cards: sortKorean(listing.cards.map((card) => card.trim()).filter(Boolean)),
    note: listing.note?.trim() || undefined,
    updatedAt: listing.updatedAt,
    updatedBy: listing.updatedBy.trim(),
    source: listing.source ?? defaultSource,
    rotationKey: listing.rotationKey?.trim() || undefined,
    locations: listing.locations
      ? sortKorean(listing.locations.map((location) => location.trim()).filter(Boolean))
      : undefined,
  };
}

function isSourceEntry(
  value: MerchantListing | MerchantServerEntry,
): value is MerchantServerEntry {
  return "manual" in value || "kloa" in value;
}

function normalizeEntry(
  value: MerchantListing | MerchantServerEntry,
  fallbackServer: string,
): MerchantServerEntry {
  if (!isSourceEntry(value)) {
    const manual = normalizeListing(value, "manual");
    return {
      server: manual.server || fallbackServer,
      manual,
    };
  }

  return {
    server: value.server?.trim() || fallbackServer,
    manual: value.manual ? normalizeListing(value.manual, "manual") : undefined,
    kloa: value.kloa ? normalizeListing(value.kloa, "kloa") : undefined,
  };
}

function hasAnySource(entry: MerchantServerEntry): boolean {
  return Boolean(entry.manual || entry.kloa);
}

function getActiveSources(entry: MerchantServerEntry): MerchantListing[] {
  if (!entry.manual && !entry.kloa) {
    return [];
  }

  if (!entry.manual) {
    return [entry.kloa!];
  }

  if (!entry.kloa) {
    return [entry.manual];
  }

  const manualRotationKey = entry.manual.rotationKey?.trim();
  const kloaRotationKey = entry.kloa.rotationKey?.trim();

  // Manual entries are only trusted for the same active rotation as KLOA.
  if (!manualRotationKey || !kloaRotationKey || manualRotationKey !== kloaRotationKey) {
    return [entry.kloa];
  }

  return [entry.kloa, entry.manual];
}

function mergeListings(entry: MerchantServerEntry): MerchantListing | null {
  const sources = getActiveSources(entry);

  if (sources.length === 0) {
    return null;
  }

  const newestListing = [...sources].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )[0];

  const cards = sortKorean(sources.flatMap((listing) => listing.cards));
  const locations = sortKorean(
    sources.flatMap((listing) => listing.locations ?? []),
  );
  const notes = sources
    .map((listing) =>
      listing.note
        ? `${listing.source === "kloa" ? "KLOA" : "수동"}: ${listing.note}`
        : null,
    )
    .filter((note): note is string => Boolean(note));
  const rotationKey = sources
    .map((listing) => `${listing.source}:${listing.rotationKey ?? listing.updatedAt}`)
    .join("|");

  return {
    server: entry.server,
    merchantName:
      entry.kloa?.merchantName ??
      entry.manual?.merchantName ??
      newestListing.merchantName,
    cards,
    note: notes.length > 0 ? notes.join(" | ") : newestListing.note,
    updatedAt: newestListing.updatedAt,
    updatedBy: sources
      .map((listing) =>
        `${listing.source === "kloa" ? "KLOA" : "수동"}: ${listing.updatedBy}`,
      )
      .join(" / "),
    rotationKey,
    locations: locations.length > 0 ? locations : undefined,
  };
}

async function ensureStoreFile(): Promise<void> {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });

  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    const emptyStore: MerchantStore = { servers: {} };
    await writeFile(DATA_PATH, JSON.stringify(emptyStore, null, 2), "utf-8");
  }
}

async function readStore(): Promise<MerchantStore> {
  await ensureStoreFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  const parsed = JSON.parse(raw) as LegacyMerchantStore;

  return {
    servers: Object.fromEntries(
      Object.entries(parsed.servers).map(([key, value]) => [
        key,
        normalizeEntry(value, key),
      ]),
    ),
  };
}

async function writeStore(store: MerchantStore): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function listMerchantServers(): Promise<MerchantListing[]> {
  const store = await readStore();

  return Object.values(store.servers)
    .map(mergeListings)
    .filter((listing): listing is MerchantListing => Boolean(listing))
    .filter((listing) => isPreferredMerchantServer(listing.server))
    .sort((left, right) =>
      comparePreferredMerchantServers(left.server, right.server),
    );
}

export async function getMerchantServer(
  server: string,
): Promise<MerchantListing | null> {
  const entry = await getMerchantServerEntry(server);
  return entry ? mergeListings(entry) : null;
}

export async function getMerchantServerEntry(
  server: string,
): Promise<MerchantServerEntry | null> {
  const store = await readStore();
  const key = normalizeServerName(server);
  const entry = store.servers[key];

  if (!entry || !hasAnySource(entry)) {
    return null;
  }

  return entry;
}

export async function upsertMerchantServer(input: {
  server: string;
  merchantName?: string;
  cards: string[];
  note?: string;
  updatedBy: string;
  source?: MerchantSource;
  rotationKey?: string;
  locations?: string[];
}): Promise<MerchantListing> {
  const store = await readStore();
  const source = input.source ?? "manual";
  const key = normalizeServerName(input.server);
  const entry = store.servers[key] ?? {
    server: input.server.trim(),
  };

  const listing = normalizeListing(
    {
      server: input.server.trim(),
      merchantName: input.merchantName?.trim() || undefined,
      cards: input.cards,
      note: input.note?.trim() || undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: input.updatedBy,
      source,
      rotationKey: input.rotationKey,
      locations: input.locations,
    },
    source,
  );

  store.servers[key] = {
    ...entry,
    server: input.server.trim(),
    [source]: listing,
  };

  await writeStore(store);

  return mergeListings(store.servers[key]) ?? listing;
}

export async function replaceMerchantSourceBatch(
  source: MerchantSource,
  listings: MerchantListing[],
): Promise<void> {
  const store = await readStore();
  const nextServers = Object.fromEntries(
    Object.entries(store.servers).map(([key, entry]) => [key, { ...entry }]),
  );

  for (const entry of Object.values(nextServers)) {
    delete entry[source];
  }

  for (const listing of listings) {
    const normalizedListing = normalizeListing(listing, source);
    const key = normalizeServerName(normalizedListing.server);
    const entry = nextServers[key] ?? { server: normalizedListing.server };

    nextServers[key] = {
      ...entry,
      server: normalizedListing.server,
      [source]: normalizedListing,
    };
  }

  store.servers = Object.fromEntries(
    Object.entries(nextServers).filter(([, entry]) => hasAnySource(entry)),
  );

  await writeStore(store);
}
