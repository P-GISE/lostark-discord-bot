import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  Client,
  MessageCreateOptions,
  Role,
} from "discord.js";

import { logError, logInfo } from "../../utils/logger";
import {
  type LegacyTrackedMessageMatcher,
  type ManagedNotificationChannel,
  replaceTrackedChannelMessages,
} from "../../utils/tracked-channel-messages";
import { findMerchantAlertMatch } from "./merchant-card-sets";
import { listMerchantServers } from "./merchant.service";
import type {
  GuildMerchantAlertConfig,
  MerchantAlertStore,
  MerchantListing,
} from "./merchant.types";

const DATA_PATH = path.join(process.cwd(), "data", "merchant-alerts.json");
const POLL_INTERVAL_MS = 60_000;
const DEFAULT_MENTION_ROLE_NAME = "로아 중독자들";
const WEEKLY_RESET_REMINDER_MESSAGE =
  "로할일 다하셨나요 로아 초기화(수) 하루전날입니다";
const KOREA_TIME_ZONE = "Asia/Seoul";
const MERCHANT_BROADCAST_LEGACY_MATCHER: LegacyTrackedMessageMatcher = (message) =>
  message.content.includes("떠돌이상인 동기화 완료") ||
  message.content.includes("제보가 모두 완료") ||
  message.embeds?.some((embed) => embed.footer?.text?.includes("KLOA") === true) === true;

let pollerStarted = false;
let weeklyReminderPollerStarted = false;

function normalizeGuildConfig(
  config?: Partial<GuildMerchantAlertConfig>,
): GuildMerchantAlertConfig {
  return {
    channelId: config?.channelId,
    roleId: config?.roleId,
    extraTrackedCards: config?.extraTrackedCards ?? [],
    lastNotifiedFingerprints: config?.lastNotifiedFingerprints ?? {},
    lastWeeklyReminderKey: config?.lastWeeklyReminderKey,
    lastBroadcastRotationKey: config?.lastBroadcastRotationKey,
    lastCompleteAnnouncementRotationKey: config?.lastCompleteAnnouncementRotationKey,
  };
}

function summarizeLocations(listing: MerchantListing): string | undefined {
  if (listing.locations?.length) {
    if (listing.locations.length <= 2) {
      return listing.locations.join(" / ");
    }

    return `${listing.locations.slice(0, 2).join(" / ")} 외 ${
      listing.locations.length - 2
    }곳`;
  }

  return listing.merchantName;
}

function getKoreaReminderState(date = new Date()): {
  dateKey: string;
  dayOfWeek: string;
  hour: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const dayOfWeek = parts.find((part) => part.type === "weekday")?.value ?? "";

  return {
    dateKey: `${year}-${month}-${day}`,
    dayOfWeek,
    hour,
  };
}

async function ensureAlertStoreFile(): Promise<void> {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });

  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    const emptyStore: MerchantAlertStore = { guilds: {} };
    await writeFile(DATA_PATH, JSON.stringify(emptyStore, null, 2), "utf-8");
  }
}

async function readAlertStore(): Promise<MerchantAlertStore> {
  await ensureAlertStoreFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  return JSON.parse(raw) as MerchantAlertStore;
}

async function writeAlertStore(store: MerchantAlertStore): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function formatAlertMessage(input: {
  mentionText?: string;
  server: string;
  locationSummary?: string;
  matchedCards: string[];
  matchedSetNames: string[];
}) {
  const mentionPrefix = input.mentionText ? `${input.mentionText} ` : "";
  const locationLine = input.locationSummary
    ? `위치: ${input.locationSummary}\n`
    : "";
  const setLine =
    input.matchedSetNames.length > 0
      ? `관련 카드셋: ${input.matchedSetNames.join(", ")}\n`
      : "";

  return (
    `${mentionPrefix}${input.server} 서버 떠돌이상인에 추적 카드가 떴어요.\n` +
    locationLine +
    setLine +
    `등장 카드: ${input.matchedCards.join(", ")}`
  );
}

async function getTextChannel(
  client: Client,
  channelId: string,
): Promise<ManagedNotificationChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (
    !channel ||
    !channel.isTextBased() ||
    !channel.isSendable() ||
    !("messages" in channel) ||
    !channel.messages ||
    typeof channel.messages.fetch !== "function"
  ) {
    return null;
  }

  return channel as ManagedNotificationChannel;
}

async function resolveAlertRole(
  channel: ManagedNotificationChannel,
  config: GuildMerchantAlertConfig,
): Promise<Role | null> {
  if (config.roleId) {
    const configuredRole =
      channel.guild.roles.cache.get(config.roleId) ??
      (await channel.guild.roles.fetch(config.roleId).catch(() => null));

    if (configuredRole) {
      return configuredRole;
    }

    config.roleId = undefined;
  }

  const roleByName =
    channel.guild.roles.cache.find((role) => role.name === DEFAULT_MENTION_ROLE_NAME) ??
    (await channel.guild.roles.fetch().then((roles) =>
      roles.find((role) => role?.name === DEFAULT_MENTION_ROLE_NAME) ?? null,
    ));

  if (roleByName) {
    config.roleId = roleByName.id;
    return roleByName;
  }

  return null;
}

export async function getMerchantAlertConfig(
  guildId: string,
): Promise<GuildMerchantAlertConfig> {
  const store = await readAlertStore();
  return normalizeGuildConfig(store.guilds[guildId]);
}

export async function listMerchantAlertGuildIds(): Promise<string[]> {
  const store = await readAlertStore();
  return Object.keys(store.guilds);
}

export async function primeMerchantAlertState(guildId?: string): Promise<number> {
  const store = await readAlertStore();
  const guildIds = guildId ? [guildId] : Object.keys(store.guilds);

  if (guildIds.length === 0) {
    return 0;
  }

  const listings = await listMerchantServers();

  for (const currentGuildId of guildIds) {
    const config = normalizeGuildConfig(store.guilds[currentGuildId]);

    for (const listing of listings) {
      const serverKey = listing.server.toLocaleLowerCase("ko-KR");
      const match = findMerchantAlertMatch(listing, config.extraTrackedCards);

      if (match) {
        config.lastNotifiedFingerprints[serverKey] = match.fingerprint;
      } else {
        delete config.lastNotifiedFingerprints[serverKey];
      }
    }

    store.guilds[currentGuildId] = config;
  }

  await writeAlertStore(store);
  return guildIds.length;
}

export async function setMerchantAlertChannel(
  guildId: string,
  channelId: string,
): Promise<void> {
  const store = await readAlertStore();
  const config = normalizeGuildConfig(store.guilds[guildId]);
  config.channelId = channelId;
  store.guilds[guildId] = config;
  await writeAlertStore(store);
}

export async function setMerchantAlertRole(
  guildId: string,
  roleId?: string,
): Promise<void> {
  const store = await readAlertStore();
  const config = normalizeGuildConfig(store.guilds[guildId]);
  config.roleId = roleId;
  store.guilds[guildId] = config;
  await writeAlertStore(store);
}

export async function setMerchantCompleteAnnouncementRotationKey(
  guildId: string,
  rotationKey?: string,
): Promise<void> {
  const store = await readAlertStore();
  const config = normalizeGuildConfig(store.guilds[guildId]);
  config.lastCompleteAnnouncementRotationKey = rotationKey;
  store.guilds[guildId] = config;
  await writeAlertStore(store);
}

export async function setMerchantBroadcastRotationKey(
  guildId: string,
  rotationKey?: string,
): Promise<void> {
  const store = await readAlertStore();
  const config = normalizeGuildConfig(store.guilds[guildId]);
  config.lastBroadcastRotationKey = rotationKey;
  store.guilds[guildId] = config;
  await writeAlertStore(store);
}

export async function sendMerchantBroadcastMessage(input: {
  client: Client;
  guildId: string;
  content?: string;
  embeds?: MessageCreateOptions["embeds"];
  mentionRole?: boolean;
  includeRoleTag?: boolean;
}): Promise<boolean> {
  const store = await readAlertStore();
  const config = normalizeGuildConfig(store.guilds[input.guildId]);

  if (!config.channelId) {
    return false;
  }

  const channel = await getTextChannel(input.client, config.channelId);

  if (!channel) {
    return false;
  }

  const shouldResolveRole = input.mentionRole !== false || input.includeRoleTag === true;
  const role = shouldResolveRole ? await resolveAlertRole(channel, config) : null;
  const trimmedContent = input.content?.trim();
  const message: MessageCreateOptions = {};

  if (role && input.mentionRole !== false) {
    message.content = trimmedContent ? `${role} ${trimmedContent}` : `${role}`;
    message.allowedMentions = {
      roles: [role.id],
    };
  } else if (role && input.includeRoleTag) {
    message.content = trimmedContent ? `${role} ${trimmedContent}` : `${role}`;
    message.allowedMentions = {
      parse: [],
    };
  } else if (trimmedContent) {
    message.content = trimmedContent;
  }

  if (input.embeds && input.embeds.length > 0) {
    message.embeds = input.embeds;
  }

  if (!message.content && !message.embeds?.length) {
    return false;
  }

  await replaceTrackedChannelMessages({
    client: input.client,
    guildId: input.guildId,
    kind: "merchant-broadcast",
    channel,
    messages: [message],
    legacyMatcher: MERCHANT_BROADCAST_LEGACY_MATCHER,
  });

  store.guilds[input.guildId] = config;
  await writeAlertStore(store);
  return true;
}

export async function runMerchantAlertScan(
  client: Client,
  guildId: string,
): Promise<{
  configured: boolean;
  sentCount: number;
  matchedServers: string[];
}> {
  const store = await readAlertStore();
  const config = normalizeGuildConfig(store.guilds[guildId]);

  if (!config.channelId) {
    return {
      configured: false,
      sentCount: 0,
      matchedServers: [],
    };
  }

  const channel = await getTextChannel(client, config.channelId);

  if (!channel) {
    return {
      configured: false,
      sentCount: 0,
      matchedServers: [],
    };
  }

  const role = await resolveAlertRole(channel, config);
  const mentionText = role?.toString();
  const listings = await listMerchantServers();
  const matchedServers: string[] = [];
  let sentCount = 0;

  for (const listing of listings) {
    const match = findMerchantAlertMatch(listing, config.extraTrackedCards);
    const serverKey = listing.server.toLocaleLowerCase("ko-KR");

    if (!match) {
      delete config.lastNotifiedFingerprints[serverKey];
      continue;
    }

    matchedServers.push(listing.server);

    if (config.lastNotifiedFingerprints[serverKey] === match.fingerprint) {
      continue;
    }

    await channel.send(
      formatAlertMessage({
        mentionText,
        server: listing.server,
        locationSummary: summarizeLocations(listing),
        matchedCards: match.matchedCards,
        matchedSetNames: match.matchedSetNames,
      }),
    );

    config.lastNotifiedFingerprints[serverKey] = match.fingerprint;
    sentCount += 1;
  }

  store.guilds[guildId] = config;
  await writeAlertStore(store);

  return {
    configured: true,
    sentCount,
    matchedServers,
  };
}

export async function runWeeklyResetReminderScan(client: Client): Promise<number> {
  const reminderState = getKoreaReminderState();

  if (reminderState.dayOfWeek !== "Tue" || reminderState.hour !== 21) {
    return 0;
  }

  const store = await readAlertStore();
  let sentCount = 0;

  for (const guildId of Object.keys(store.guilds)) {
    const config = normalizeGuildConfig(store.guilds[guildId]);

    if (!config.channelId || config.lastWeeklyReminderKey === reminderState.dateKey) {
      store.guilds[guildId] = config;
      continue;
    }

    const channel = await getTextChannel(client, config.channelId);

    if (!channel) {
      store.guilds[guildId] = config;
      continue;
    }

    const role = await resolveAlertRole(channel, config);
    const mentionPrefix = role ? `${role} ` : "";

    await channel.send(`${mentionPrefix}${WEEKLY_RESET_REMINDER_MESSAGE}`);
    config.lastWeeklyReminderKey = reminderState.dateKey;
    store.guilds[guildId] = config;
    sentCount += 1;
  }

  await writeAlertStore(store);
  return sentCount;
}

async function pollMerchantAlerts(client: Client): Promise<void> {
  const guildIds = await listMerchantAlertGuildIds();

  for (const guildId of guildIds) {
    try {
      const result = await runMerchantAlertScan(client, guildId);

      if (result.sentCount > 0) {
        logInfo(`${guildId} 길드에 떠돌이상인 알림 ${result.sentCount}건을 보냈습니다.`);
      }
    } catch (error) {
      logError(`${guildId} 길드 떠돌이상인 알림 검사 중 오류가 발생했습니다.`, error);
    }
  }
}

export function startMerchantAlertPolling(
  client: Client,
  options?: {
    skipInitialScan?: boolean;
  },
): void {
  if (pollerStarted) {
    return;
  }

  pollerStarted = true;

  if (!options?.skipInitialScan) {
    void pollMerchantAlerts(client);
  }

  setInterval(() => {
    void pollMerchantAlerts(client);
  }, POLL_INTERVAL_MS);
}

export function startWeeklyResetReminderPolling(client: Client): void {
  if (weeklyReminderPollerStarted) {
    return;
  }

  weeklyReminderPollerStarted = true;

  void runWeeklyResetReminderScan(client)
    .then((sentCount) => {
      if (sentCount > 0) {
        logInfo(`주간 로아 초기화 리마인더 ${sentCount}건을 보냈습니다.`);
      }
    })
    .catch((error) => {
      logError("주간 로아 초기화 리마인더 검사 중 오류가 발생했습니다.", error);
    });

  setInterval(() => {
    void runWeeklyResetReminderScan(client)
      .then((sentCount) => {
        if (sentCount > 0) {
          logInfo(`주간 로아 초기화 리마인더 ${sentCount}건을 보냈습니다.`);
        }
      })
      .catch((error) => {
        logError("주간 로아 초기화 리마인더 검사 중 오류가 발생했습니다.", error);
      });
  }, POLL_INTERVAL_MS);
}
