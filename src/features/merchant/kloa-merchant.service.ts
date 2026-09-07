import { EmbedBuilder, type APIEmbed, type Client } from "discord.js";

import { formatDateTime, parseCommaList } from "../../utils/format";
import { logError, logInfo } from "../../utils/logger";
import { clearTrackedChannelMessages } from "../../utils/tracked-channel-messages";
import { findMerchantAlertMatch } from "./merchant-card-sets";
import {
  getMerchantAlertConfig,
  listMerchantAlertGuildIds,
  primeMerchantAlertState,
  runMerchantAlertScan,
  sendMerchantBroadcastMessage,
  setMerchantBroadcastRotationKey,
  setMerchantCompleteAnnouncementRotationKey,
} from "./merchant-alert.service";
import { PREFERRED_MERCHANT_SERVERS } from "./merchant-config";
import { getMerchantServerEntry, replaceMerchantSourceBatch } from "./merchant.service";
import type { MerchantListing } from "./merchant.types";

const KLOA_SCHEME_URL = "https://api.korlark.com/lostark/merchant/scheme";
const KLOA_REPORTS_URL = "https://api.korlark.com/lostark/merchant/reports";
const KLOA_SERVER_NAMES = [
  "루페온",
  "실리안",
  "아만",
  "아브렐슈드",
  "카단",
  "카마인",
  "카제로스",
  "니나브",
] as const;
const KLOA_USER_AGENT = "custom-discord-bot/0.1";
const KLOA_SCHEME_CACHE_MS = 6 * 60 * 60 * 1000;
const KLOA_POLL_INTERVAL_MS = 5 * 60_000;
const KLOA_SYNC_SERVER_NAMES = new Set<string>(PREFERRED_MERCHANT_SERVERS);
const AUTO_SYNC_BROADCAST_CONTENT = "떠돌이상인 자동 동기화 완료";
const COMPLETE_BROADCAST_CONTENT =
  "아브렐슈드, 니나브, 아만 제보가 모두 완료됐어요.";

let pollerStarted = false;
let syncInFlight = false;
let cachedScheme:
  | {
      loadedAt: number;
      value: KloaScheme;
    }
  | null = null;

interface KloaItem {
  id: string;
  type: number;
  name: string;
}

interface KloaRegion {
  id: string;
  name: string;
  npcName: string;
  items: KloaItem[];
}

interface KloaScheme {
  regions: KloaRegion[];
}

interface KloaReport {
  regionId: string;
  itemIds: string[];
}

interface KloaReportPeriod {
  startTime: string;
  endTime: string;
  reports: KloaReport[];
}

interface KloaServerSyncStatus {
  server: string;
  rotationKey?: string;
  reportCount: number;
  totalRegionCount: number;
  hasListing: boolean;
  isComplete: boolean;
}

export interface KloaSyncResult {
  syncedServers: string[];
  activeRotationStart?: string;
  activeRotationEnd?: string;
  serverStatuses: KloaServerSyncStatus[];
}

interface BuiltKloaServerData {
  listing: MerchantListing | null;
  status: KloaServerSyncStatus;
}

export interface KloaBroadcastPayload {
  content?: string;
  embeds: APIEmbed[];
}

async function fetchKloaJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": KLOA_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`KLOA 요청 실패 (${response.status} ${response.statusText})`);
  }

  return (await response.json()) as T;
}

async function getKloaScheme(): Promise<KloaScheme> {
  const now = Date.now();

  if (cachedScheme && now - cachedScheme.loadedAt < KLOA_SCHEME_CACHE_MS) {
    return cachedScheme.value;
  }

  const value = await fetchKloaJson<KloaScheme>(KLOA_SCHEME_URL);
  cachedScheme = {
    loadedAt: now,
    value,
  };

  return value;
}

function getCurrentPeriod(periods: KloaReportPeriod[]): KloaReportPeriod | null {
  const now = Date.now();

  return (
    periods.find((period) => {
      const start = new Date(period.startTime).getTime();
      const end = new Date(period.endTime).getTime();

      return start <= now && now < end;
    }) ?? null
  );
}

function summarizeLocations(locations: string[]): string | undefined {
  if (locations.length === 0) {
    return undefined;
  }

  if (locations.length <= 2) {
    return locations.join(" / ");
  }

  return `${locations.slice(0, 2).join(" / ")} 외 ${locations.length - 2}곳`;
}

function calculateRotationEnd(rotationStart?: string): string | undefined {
  if (!rotationStart) {
    return undefined;
  }

  return new Date(
    new Date(rotationStart).getTime() + 5.5 * 60 * 60 * 1000,
  ).toISOString();
}

async function buildKloaServerData(input: {
  serverId: number;
  serverName: string;
  regionMap: Map<string, KloaRegion>;
}): Promise<BuiltKloaServerData> {
  const periods = await fetchKloaJson<KloaReportPeriod[]>(
    `${KLOA_REPORTS_URL}?server=${input.serverId}`,
  );
  const currentPeriod = getCurrentPeriod(periods);
  const totalRegionCount = input.regionMap.size;

  if (!currentPeriod) {
    return {
      listing: null,
      status: {
        server: input.serverName,
        reportCount: 0,
        totalRegionCount,
        hasListing: false,
        isComplete: false,
      },
    };
  }

  const cards = new Set<string>();
  const locations: string[] = [];
  const locationNotes: string[] = [];
  const reportedRegionIds = new Set<string>();

  for (const report of currentPeriod.reports) {
    reportedRegionIds.add(report.regionId);

    const region = input.regionMap.get(report.regionId);

    if (!region) {
      continue;
    }

    const reportCards = report.itemIds
      .map((itemId) => region.items.find((item) => item.id === itemId))
      .filter((item): item is KloaItem => Boolean(item))
      .filter((item) => item.type === 1)
      .map((item) => item.name.trim())
      .filter(Boolean);

    if (reportCards.length === 0) {
      continue;
    }

    const location = `${region.name} ${region.npcName}`;
    locations.push(location);
    locationNotes.push(`${location}: ${reportCards.join(", ")}`);

    for (const card of reportCards) {
      cards.add(card);
    }
  }

  let listing: MerchantListing | null = null;

  if (cards.size > 0) {
    const sortedCards = [...cards].sort((left, right) =>
      left.localeCompare(right, "ko-KR"),
    );
    const sortedLocations = [...new Set(locations)].sort((left, right) =>
      left.localeCompare(right, "ko-KR"),
    );

    listing = {
      server: input.serverName,
      merchantName: summarizeLocations(sortedLocations),
      cards: sortedCards,
      note: locationNotes.join(" | "),
      updatedAt: new Date().toISOString(),
      updatedBy: "kloa.gg 자동 수집",
      source: "kloa",
      rotationKey: currentPeriod.startTime,
      locations: sortedLocations,
    };
  }

  return {
    listing,
    status: {
      server: input.serverName,
      rotationKey: currentPeriod.startTime,
      reportCount: reportedRegionIds.size,
      totalRegionCount,
      hasListing: Boolean(listing),
      isComplete: totalRegionCount > 0 && reportedRegionIds.size >= totalRegionCount,
    },
  };
}

function buildLocationListings(listing: MerchantListing): MerchantListing[] {
  if (!listing.note) {
    return [];
  }

  return listing.note
    .split(" | ")
    .map((section) => section.trim())
    .filter(Boolean)
    .reduce<MerchantListing[]>((result, section) => {
      const separatorIndex = section.indexOf(": ");

      if (separatorIndex < 0) {
        return result;
      }

      const merchantName = section.slice(0, separatorIndex).trim();
      const cardsText = section.slice(separatorIndex + 2).trim();
      const cards = parseCommaList(cardsText);

      if (!merchantName || cards.length === 0) {
        return result;
      }

      result.push({
        ...listing,
        merchantName,
        cards,
        note: undefined,
        locations: [merchantName],
      });

      return result;
    }, []);
}

function buildServerEmbedFields(
  listing: MerchantListing,
): Array<{ name: string; value: string; inline: false }> {
  const locationListings = buildLocationListings(listing);

  if (locationListings.length === 0) {
    const match = findMerchantAlertMatch(listing);

    if (!match) {
      return [];
    }

    const lines = [`카드: ${match.matchedCards.join(", ")}`];

    if (match.matchedSetNames.length > 0) {
      lines.push(`세트: ${match.matchedSetNames.join(", ")}`);
    }

    return [
      {
        name: listing.merchantName ?? listing.server,
        value: lines.join("\n"),
        inline: false,
      },
    ];
  }

  return locationListings
    .map((locationListing) => {
      const match = findMerchantAlertMatch(locationListing);

      if (!match || !locationListing.merchantName) {
        return null;
      }

      const lines = [`카드: ${match.matchedCards.join(", ")}`];

      if (match.matchedSetNames.length > 0) {
        lines.push(`세트: ${match.matchedSetNames.join(", ")}`);
      }

      return {
        name: locationListing.merchantName,
        value: lines.join("\n"),
        inline: false as const,
      };
    })
    .filter((field): field is { name: string; value: string; inline: false } => Boolean(field));
}

function buildServerEmbed(input: {
  server: string;
  listing: MerchantListing;
  rotationWindow: string;
}): APIEmbed | null {
  const fields = buildServerEmbedFields(input.listing);

  if (fields.length === 0) {
    return null;
  }

  const descriptionLines = [`회차: ${input.rotationWindow}`];

  return new EmbedBuilder()
    .setTitle(input.server)
    .setDescription(descriptionLines.join("\n"))
    .addFields(fields)
    .setFooter({ text: "KLOA 자동 수집" })
    .setTimestamp(new Date(input.listing.updatedAt))
    .toJSON();
}

export function arePreferredServerReportsComplete(result: KloaSyncResult): boolean {
  if (!result.activeRotationStart) {
    return false;
  }

  return PREFERRED_MERCHANT_SERVERS.every((server) => {
    const status = result.serverStatuses.find((value) => value.server === server);

    return Boolean(
      status &&
        status.hasListing &&
        status.isComplete &&
        status.rotationKey === result.activeRotationStart,
    );
  });
}

export async function buildKloaSyncBroadcastPayload(
  result: KloaSyncResult,
  content?: string,
): Promise<KloaBroadcastPayload | null> {
  if (result.syncedServers.length === 0) {
    return null;
  }

  const rotationWindow =
    result.activeRotationStart && result.activeRotationEnd
      ? `${formatDateTime(result.activeRotationStart)} - ${formatDateTime(result.activeRotationEnd)}`
      : result.activeRotationStart
        ? `${formatDateTime(result.activeRotationStart)} 시작`
        : "확인 불가";
  const embeds = (
    await Promise.all(
      PREFERRED_MERCHANT_SERVERS.map(async (server) => {
        const entry = await getMerchantServerEntry(server);
        const listing = entry?.kloa;

        if (!listing) {
          return null;
        }

        return buildServerEmbed({
          server,
          listing,
          rotationWindow,
        });
      }),
    )
  ).filter((embed): embed is APIEmbed => Boolean(embed));

  if (embeds.length === 0) {
    return null;
  }

  return {
    content,
    embeds,
  };
}

async function broadcastCompletedKloaSummary(
  client: Client,
  result: KloaSyncResult,
): Promise<number> {
  if (!arePreferredServerReportsComplete(result) || !result.activeRotationStart) {
    return 0;
  }

  const payload = await buildKloaSyncBroadcastPayload(
    result,
    COMPLETE_BROADCAST_CONTENT,
  );

  if (!payload) {
    return 0;
  }

  const guildIds = await listMerchantAlertGuildIds();
  let sentCount = 0;

  for (const guildId of guildIds) {
    try {
      const config = await getMerchantAlertConfig(guildId);

      if (config.lastCompleteAnnouncementRotationKey === result.activeRotationStart) {
        continue;
      }

      const sent = await sendMerchantBroadcastMessage({
        client,
        guildId,
        content: payload.content,
        embeds: payload.embeds,
      });

      if (!sent) {
        continue;
      }

      await setMerchantCompleteAnnouncementRotationKey(
        guildId,
        result.activeRotationStart,
      );
      sentCount += 1;
    } catch (error) {
      logError(`${guildId} 길드 KLOA 완료 카드 전송에 실패했습니다.`, error);
    }
  }

  return sentCount;
}

async function refreshCurrentKloaSummaryBoard(
  client: Client,
  result: KloaSyncResult,
): Promise<number> {
  const guildIds = await listMerchantAlertGuildIds();
  const payload = await buildKloaSyncBroadcastPayload(
    result,
    AUTO_SYNC_BROADCAST_CONTENT,
  );
  let sentCount = 0;

  for (const guildId of guildIds) {
    try {
      if (!payload) {
        await clearTrackedChannelMessages({
          client,
          guildId,
          kind: "merchant-broadcast",
        });
        continue;
      }

      const config = await getMerchantAlertConfig(guildId);
      const shouldMentionRole = Boolean(
        result.activeRotationStart &&
          config.lastBroadcastRotationKey !== result.activeRotationStart,
      );

      const sent = await sendMerchantBroadcastMessage({
        client,
        guildId,
        content: payload.content,
        embeds: payload.embeds,
        mentionRole: shouldMentionRole,
      });

      if (sent) {
        if (result.activeRotationStart) {
          await setMerchantBroadcastRotationKey(
            guildId,
            result.activeRotationStart,
          );
        }
        sentCount += 1;
      }
    } catch (error) {
      logError(`${guildId} guild KLOA board refresh failed.`, error);
    }
  }

  return sentCount;
}

export async function syncKloaMerchantData(input?: {
  client?: Client;
  notifyAlerts?: boolean;
}): Promise<KloaSyncResult> {
  const scheme = await getKloaScheme();
  const regionMap = new Map(scheme.regions.map((region) => [region.id, region]));

  const serverData = await Promise.all(
    KLOA_SERVER_NAMES.map((serverName, index) =>
      buildKloaServerData({
        serverId: index + 1,
        serverName,
        regionMap,
      }),
    ),
  );

  const targetServerData = serverData.filter((value) =>
    KLOA_SYNC_SERVER_NAMES.has(value.status.server),
  );
  const listings = targetServerData
    .map((value) => value.listing)
    .filter((listing): listing is MerchantListing => Boolean(listing));

  await replaceMerchantSourceBatch("kloa", listings);

  if (input?.client && input.notifyAlerts !== false) {
    const guildIds = await listMerchantAlertGuildIds();

    for (const guildId of guildIds) {
      try {
        await runMerchantAlertScan(input.client, guildId);
      } catch (error) {
        logError(`${guildId} 길드 KLOA 알림 검사에 실패했습니다.`, error);
      }
    }
  }

  return {
    syncedServers: listings.map((listing) => listing.server),
    activeRotationStart: listings[0]?.rotationKey,
    activeRotationEnd: calculateRotationEnd(listings[0]?.rotationKey),
    serverStatuses: targetServerData.map((value) => value.status),
  };
}

function buildProgressLog(result: KloaSyncResult): string {
  return result.serverStatuses
    .map((status) => `${status.server} ${status.reportCount}/${status.totalRegionCount}`)
    .join(", ");
}

async function pollKloaMerchantData(
  client: Client,
  trigger: "interval" | "startup" = "interval",
): Promise<void> {
  if (syncInFlight) {
    return;
  }

  syncInFlight = true;

  try {
    const result = await syncKloaMerchantData({
      client,
      notifyAlerts: false,
    });
    const boardRefreshCount = await refreshCurrentKloaSummaryBoard(client, result);
    void boardRefreshCount;
    const broadcastCount = 0;

    logInfo(
      `KLOA 자동 동기화를 완료했습니다. 동기화 서버 수: ${result.syncedServers.length}, 진행도: ${buildProgressLog(result)}, 완료 카드 길드 수: ${broadcastCount}, trigger=${trigger}`,
    );
  } catch (error) {
    logError("KLOA 자동 동기화에 실패했습니다.", error);
  } finally {
    syncInFlight = false;
  }
}

async function bootstrapKloaMerchantData(client: Client): Promise<void> {
  try {
    const result = await syncKloaMerchantData({
      notifyAlerts: false,
    });
    const primedGuilds = await primeMerchantAlertState();
    const boardRefreshCount = await refreshCurrentKloaSummaryBoard(client, result);
    void boardRefreshCount;
    const broadcastCount = 0;

    logInfo(
      `KLOA 시작 동기화를 완료했습니다. 동기화 서버 수: ${result.syncedServers.length}, 진행도: ${buildProgressLog(result)}, 초기화 길드 수: ${primedGuilds}, 완료 카드 길드 수: ${broadcastCount}`,
    );
  } catch (error) {
    logError("KLOA 시작 동기화에 실패했습니다.", error);
  }
}

export function startKloaMerchantPolling(client: Client): void {
  if (pollerStarted) {
    return;
  }

  pollerStarted = true;
  void bootstrapKloaMerchantData(client);

  setInterval(() => {
    void pollKloaMerchantData(client, "interval");
  }, KLOA_POLL_INTERVAL_MS);
}
