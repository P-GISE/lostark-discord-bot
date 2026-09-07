import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type APIEmbed,
  type Client,
} from "discord.js";

import {
  getHomeworkReminderConfig,
  listHomeworkReminderGuildIds,
} from "../homework/homework.service";
import { logError, logInfo } from "../../utils/logger";
import {
  type LegacyTrackedMessageMatcher,
  type ManagedNotificationChannel,
  replaceTrackedChannelMessages,
} from "../../utils/tracked-channel-messages";
import {
  lookupNamedRosterEmbeds,
  type NamedRosterTarget,
} from "./roster.service";

const STATE_PATH = path.join(process.cwd(), "data", "roster-sync-state.json");
const POLL_INTERVAL_MS = 60_000;
const KOREA_TIME_ZONE = "Asia/Seoul";
const DAILY_SYNC_HOUR = 8;
const EMBEDS_PER_MESSAGE = 10;
const ROSTER_SYNC_LEGACY_MATCHER: LegacyTrackedMessageMatcher = (message) =>
  message.content.includes("원정대 자동 동기화 완료") ||
  message.embeds?.some((embed) => embed.title?.endsWith("원정대") === true) === true;

const DEFAULT_ROSTER_TARGETS: NamedRosterTarget[] = [
  {
    representativeCharacter: "\uAC11\uC637\uC5C6\uB294\uD0F1\uCEE4",
    ownerName: "\uBC15\uAE30\uC131",
  },
  {
    representativeCharacter: "\uB3C8\uC5C6\uB294\uC885\uAC74",
    ownerName: "\uC190\uB178\uC6D0",
  },
  {
    representativeCharacter: "MP\uC5C6\uB294\uD790\uB7EC",
    ownerName: "\uC774\uB098\uB77C",
  },
  {
    representativeCharacter: "\uC9C0\uC0C1\uC9C4",
    ownerName: "\uC9C0\uC0C1\uC9C4",
  },
  {
    representativeCharacter: "\uBD80\uB045\uAC78",
    ownerName: "\uBC15\uAC74\uBBFC",
  },
  {
    representativeCharacter: "\uC2E0\uC559\uC2EC\uC5C6\uB294\uAE30\uC0AC",
    ownerName: "\uC774\uC9C4\uC6B1",
  },
  {
    representativeCharacter: "\uC544\uCE74\uB124\uD604\uC815",
    ownerName: "\uC720\uD604\uC885",
  },
  {
    representativeCharacter: "\uD0C4\uC54C\uC5C6\uB294\uCD1D\uC7A1\uC774",
    ownerName: "\uBC15\uC0C1\uCCA0",
  },
  {
    representativeCharacter: "\uC9C0\uB2A5\uC5C6\uB294\uBC95\uC0AC",
    ownerName: "\uCD5C\uBC14\uB2E4",
  },
];

type ReminderState = {
  dateKey: string;
  hour: number;
};

type RosterSyncStateStore = {
  guilds: Record<
    string,
    {
      lastDailySyncKey?: string;
    }
  >;
};

let rosterSyncPollerStarted = false;

function getKoreaReminderState(date = new Date()): ReminderState {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");

  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
  };
}

async function ensureStateFile(): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });

  try {
    await readFile(STATE_PATH, "utf-8");
  } catch {
    const emptyStore: RosterSyncStateStore = { guilds: {} };
    await writeFile(STATE_PATH, JSON.stringify(emptyStore, null, 2), "utf-8");
  }
}

async function readStateStore(): Promise<RosterSyncStateStore> {
  await ensureStateFile();
  const raw = await readFile(STATE_PATH, "utf-8");
  return JSON.parse(raw) as RosterSyncStateStore;
}

async function writeStateStore(store: RosterSyncStateStore): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(store, null, 2), "utf-8");
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

function chunkEmbeds(embeds: APIEmbed[]): APIEmbed[][] {
  const chunks: APIEmbed[][] = [];

  for (let index = 0; index < embeds.length; index += EMBEDS_PER_MESSAGE) {
    chunks.push(embeds.slice(index, index + EMBEDS_PER_MESSAGE));
  }

  return chunks;
}

function buildBroadcastContent(input: {
  notFoundTargets: NamedRosterTarget[];
  failedTargets: Array<{
    target: NamedRosterTarget;
    reason: string;
  }>;
}): string {
  const lines = ["원정대 자동 동기화 완료"];

  if (input.notFoundTargets.length > 0) {
    lines.push(
      `찾지 못한 대표 캐릭터: ${input.notFoundTargets
        .map((target) => `${target.ownerName}(${target.representativeCharacter})`)
        .join(", ")}`,
    );
  }

  if (input.failedTargets.length > 0) {
    lines.push(
      `조회 실패: ${input.failedTargets
        .map((value) => `${value.target.ownerName}(${value.target.representativeCharacter})`)
        .join(", ")}`,
    );
  }

  return lines.join("\n");
}

async function sendRosterSyncToGuild(input: {
  client: Client;
  guildId: string;
  embeds: APIEmbed[];
  content: string;
}): Promise<boolean> {
  const config = await getHomeworkReminderConfig(input.guildId);
  const channelId = config.rosterChannelId ?? config.channelId;

  if (!channelId) {
    return false;
  }

  const channel = await getTextChannel(input.client, channelId);

  if (!channel) {
    return false;
  }

  const embedChunks = chunkEmbeds(input.embeds);
  const messages = embedChunks.map((embeds, index) => ({
    content: index === 0 ? input.content : undefined,
    embeds,
  }));

  await replaceTrackedChannelMessages({
    client: input.client,
    guildId: input.guildId,
    kind: "roster-sync",
    channel,
    messages,
    legacyMatcher: ROSTER_SYNC_LEGACY_MATCHER,
  });

  return true;
}

export async function runRosterDailySync(
  client: Client,
  options?: {
    force?: boolean;
  },
): Promise<number> {
  const reminderState = getKoreaReminderState();

  if (!options?.force && reminderState.hour < DAILY_SYNC_HOUR) {
    return 0;
  }

  const guildIds = await listHomeworkReminderGuildIds();

  if (guildIds.length === 0) {
    return 0;
  }

  const stateStore = await readStateStore();
  const syncResult = await lookupNamedRosterEmbeds(DEFAULT_ROSTER_TARGETS);

  if (syncResult.embeds.length === 0) {
    if (syncResult.failedTargets.length > 0) {
      logError(
        "원정대 자동 동기화가 모두 실패했습니다.",
        syncResult.failedTargets.map((value) => ({
          ownerName: value.target.ownerName,
          representativeCharacter: value.target.representativeCharacter,
          reason: value.reason,
        })),
      );
    }

    return 0;
  }

  const content = buildBroadcastContent({
    notFoundTargets: syncResult.notFoundTargets,
    failedTargets: syncResult.failedTargets,
  });

  let sentCount = 0;

  for (const guildId of guildIds) {
    const guildState = stateStore.guilds[guildId] ?? {};

    if (!options?.force && guildState.lastDailySyncKey === reminderState.dateKey) {
      stateStore.guilds[guildId] = guildState;
      continue;
    }

    try {
      const sent = await sendRosterSyncToGuild({
        client,
        guildId,
        embeds: syncResult.embeds,
        content,
      });

      if (!sent) {
        stateStore.guilds[guildId] = guildState;
        continue;
      }

      if (!options?.force || reminderState.hour >= DAILY_SYNC_HOUR) {
        guildState.lastDailySyncKey = reminderState.dateKey;
      }
      stateStore.guilds[guildId] = guildState;
      sentCount += 1;
    } catch (error) {
      logError(`${guildId} 길드 원정대 자동 동기화 전송에 실패했습니다.`, error);
      stateStore.guilds[guildId] = guildState;
    }
  }

  await writeStateStore(stateStore);

  if (syncResult.notFoundTargets.length > 0 || syncResult.failedTargets.length > 0) {
    logInfo(
      `원정대 자동 동기화 주의사항: 찾지 못한 대상 ${syncResult.notFoundTargets.length}명, 조회 실패 ${syncResult.failedTargets.length}명`,
    );
  }

  return sentCount;
}

export function startRosterSyncPolling(client: Client): void {
  if (rosterSyncPollerStarted) {
    return;
  }

  rosterSyncPollerStarted = true;

  const runScan = async (force = false) => {
    try {
      const sentCount = await runRosterDailySync(client, { force });

      if (sentCount > 0) {
        logInfo(`원정대 자동 동기화 ${sentCount}개 길드에 전송을 마쳤습니다.`);
      }
    } catch (error) {
      logError("원정대 자동 동기화 검사 중 오류가 발생했습니다.", error);
    }
  };

  void runScan(true);
  setInterval(() => void runScan(), POLL_INTERVAL_MS);
}
