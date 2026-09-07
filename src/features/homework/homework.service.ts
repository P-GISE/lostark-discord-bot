import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type APIEmbed,
  type Client,
  EmbedBuilder,
  type MessageCreateOptions,
  type Role,
} from "discord.js";

import { logError, logInfo } from "../../utils/logger";
import {
  clearTrackedChannelMessages,
  type LegacyTrackedMessageMatcher,
  type ManagedNotificationChannel,
  replaceTrackedChannelMessages,
} from "../../utils/tracked-channel-messages";
import type {
  GuildHomeworkReminderConfig,
  HomeworkReminderKind,
  HomeworkReminderStore,
} from "./homework.types";

const DATA_PATH = path.join(process.cwd(), "data", "homework-reminders.json");
const POLL_INTERVAL_MS = 60_000;
const KOREA_TIME_ZONE = "Asia/Seoul";
const DEFAULT_MENTION_ROLE_NAME = "로아 중독자들";
const REMINDER_HOURS = [8, 20] as const;
const KLOA_ADVENTURE_ISLANDS_URL =
  "https://api.korlark.com/lostark/calendar/adventure-islands";
const KLOA_USER_AGENT = "custom-discord-bot/0.1";
const KLOA_CALENDAR_CACHE_MS = 5 * 60_000;

const DAILY_HOMEWORK_LINES = [
  "1. 길드 출석, 기부, 연구",
  "2. 영지 연구 / 아비도스 제작 / 파견 / 농장 / 펫목장",
  "3. 생활 태우기",
  "4. 카오스 던전",
  "5. 가디언 토벌",
  "6. 에포나 의뢰",
];

const WEEKLY_HOMEWORK_LINES = [
  "1. 싱글 또는 파티 레이드",
  "2. 낙원 (천상 주에 5판)",
];

const WEEKLY_SHOP_LINES = [
  "1. 호감도 상자",
  "2. 운명의 파편 상자",
  "3. 아비도스 융화 재료",
  "4. 재련 재료들",
];

const BONUS_REWARD_LABELS: Record<number, string> = {
  0: "실링",
  1: "카드",
  2: "주화",
  3: "골드",
};

const FIELD_BOSS_DAYS = new Set([0, 2, 5]);
const CHAOS_GATE_DAYS = new Set([0, 1, 4, 6]);
const DAY_INDEX_BY_SHORT_NAME: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function createEmptyHomeworkStore(): HomeworkReminderStore {
  return { guilds: {} };
}

async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8");
  await rename(tempPath, filePath);
}

async function backupInvalidHomeworkStore(raw: string): Promise<void> {
  if (!raw.trim()) {
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${DATA_PATH}.invalid-${timestamp}.bak`;
  await writeFile(backupPath, raw, "utf-8");
}

type ReminderState = {
  dateKey: string;
  dayOfWeek: string;
  dayIndex: number;
  hour: number;
  minute: number;
  second: number;
};

type KloaAdventureIsland = {
  name: string;
  date: string;
  time: number;
  bonusRewardType: number;
  rewardItems: Array<{
    name: string;
  }>;
};

type PhilkamoSnapshot = {
  adventureIslandsLine: string;
  fieldBossLine: string;
  chaosGateLine: string;
  sourceLine: string;
};

let homeworkReminderPollerStarted = false;
let cachedAdventureIslands:
  | {
      dateKey: string;
      loadedAt: number;
      value: KloaAdventureIsland[];
    }
  | null = null;

const HOMEWORK_DAILY_LEGACY_MATCHER: LegacyTrackedMessageMatcher = (message) =>
  message.content.includes("오늘의 숙제") ||
  message.embeds?.some((embed) => embed.title === "로스트아크 일일 숙제") === true;

const HOMEWORK_WEEKLY_LEGACY_MATCHER: LegacyTrackedMessageMatcher = (message) =>
  message.content.includes("주간 초기화 알림") ||
  message.embeds?.some(
    (embed) =>
      embed.title === "로스트아크 주간 초기화 알림" ||
      embed.title === "로스트아크 주간 체크리스트",
  ) === true;

function normalizeGuildConfig(
  config?: Partial<GuildHomeworkReminderConfig>,
): GuildHomeworkReminderConfig {
  return {
    channelId: config?.channelId,
    roleId: config?.roleId,
    rosterChannelId: config?.rosterChannelId,
    lastDailyReminderKey: config?.lastDailyReminderKey,
    lastWeeklyReminderKey: config?.lastWeeklyReminderKey,
  };
}

function getKoreaReminderState(date = new Date()): ReminderState {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  const dayOfWeek = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const second = Number(parts.find((part) => part.type === "second")?.value ?? "0");

  return {
    dateKey: `${year}-${month}-${day}`,
    dayOfWeek,
    dayIndex: DAY_INDEX_BY_SHORT_NAME[dayOfWeek] ?? -1,
    hour,
    minute,
    second,
  };
}

function isReminderHour(hour: number): boolean {
  return REMINDER_HOURS.includes(hour as (typeof REMINDER_HOURS)[number]);
}

function getReminderOccurrenceKey(state: ReminderState): string {
  return `${state.dateKey}-${String(state.hour).padStart(2, "0")}`;
}

function formatCountdown(state: ReminderState): string {
  const remainingSeconds =
    ((59 - state.minute) * 60 + (60 - state.second)) % 3600;
  const hours = Math.floor(remainingSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((remainingSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (remainingSeconds % 60).toString().padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

function formatHourlyContentStatus(
  state: ReminderState,
  availableDays: Set<number>,
): string {
  if (!availableDays.has(state.dayIndex)) {
    return "오늘 휴식일";
  }

  if (state.minute < 3) {
    return "지금 출현 중";
  }

  return `다음 출현까지 ${formatCountdown(state)}`;
}

function formatAdventureIslandLine(islands: KloaAdventureIsland[]): string {
  if (islands.length === 0) {
    return "오늘 정보가 없어요.";
  }

  return islands
    .map((island) => {
      const rewardLabel = BONUS_REWARD_LABELS[island.bonusRewardType] ?? "보상";
      return `${rewardLabel} · ${island.name}`;
    })
    .join("\n");
}

async function fetchKloaAdventureIslands(
  dateKey: string,
): Promise<KloaAdventureIsland[]> {
  const now = Date.now();

  if (
    cachedAdventureIslands &&
    cachedAdventureIslands.dateKey === dateKey &&
    now - cachedAdventureIslands.loadedAt < KLOA_CALENDAR_CACHE_MS
  ) {
    return cachedAdventureIslands.value;
  }

  const response = await fetch(`${KLOA_ADVENTURE_ISLANDS_URL}?date=${dateKey}`, {
    headers: {
      accept: "application/json",
      "user-agent": KLOA_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`KLOA 캘린더 요청 실패 (${response.status} ${response.statusText})`);
  }

  const value = (await response.json()) as KloaAdventureIsland[];
  cachedAdventureIslands = {
    dateKey,
    loadedAt: now,
    value,
  };

  return value;
}

async function buildPhilkamoSnapshot(
  state: ReminderState,
): Promise<PhilkamoSnapshot> {
  try {
    const islands = await fetchKloaAdventureIslands(state.dateKey);

    return {
      adventureIslandsLine: formatAdventureIslandLine(islands),
      fieldBossLine: formatHourlyContentStatus(state, FIELD_BOSS_DAYS),
      chaosGateLine: formatHourlyContentStatus(state, CHAOS_GATE_DAYS),
      sourceLine: "모험섬은 KLOA 공개 캘린더 기준입니다.",
    };
  } catch (error) {
    logError("필카모 정보를 불러오는 중 오류가 발생했습니다.", error);

    return {
      adventureIslandsLine: "KLOA에서 모험섬 정보를 가져오지 못했어요.",
      fieldBossLine: formatHourlyContentStatus(state, FIELD_BOSS_DAYS),
      chaosGateLine: formatHourlyContentStatus(state, CHAOS_GATE_DAYS),
      sourceLine: "필드보스 / 카오스게이트 상태는 KLOA 일정 규칙 기준입니다.",
    };
  }
}

function buildDailyChecklistEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle("로스트아크 일일 숙제")
    .setDescription("오늘 챙길 일일 숙제를 빠르게 확인해보세요.")
    .addFields(
      {
        name: "오늘의 일일 숙제",
        value: DAILY_HOMEWORK_LINES.join("\n"),
        inline: false,
      },
      {
        name: "메모",
        value:
          "길드 혈석은 꾸준히 모아두면 재련 재료 구매에 도움이 됩니다.\n숙제가 모두 끝났다면 내실도 함께 챙겨보세요.",
        inline: false,
      },
    )
    .setFooter({
      text: "매일 오전 8시 / 오후 8시 멘션 알림",
    });
}

function buildWeeklyChecklistEmbed(footerText: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("로스트아크 주간 체크리스트")
    .setDescription("주간 숙제와 초기화 후 구매 항목을 함께 확인해보세요.")
    .addFields(
      {
        name: "주간에 끝내야 할 것들 (ALT+Q)",
        value: WEEKLY_HOMEWORK_LINES.join("\n"),
        inline: false,
      },
      {
        name: "주간 초기화 후 구매 추천",
        value: WEEKLY_SHOP_LINES.join("\n"),
        inline: false,
      },
    )
    .setFooter({
      text: footerText,
    });
}

async function buildPhilkamoEmbed(state: ReminderState): Promise<EmbedBuilder> {
  const snapshot = await buildPhilkamoSnapshot(state);

  return new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle("필카모")
    .setDescription("모험섬 / 필드보스 / 카오스게이트 확인용 요약입니다.")
    .addFields(
      {
        name: "모험섬",
        value: snapshot.adventureIslandsLine,
        inline: false,
      },
      {
        name: "필드보스",
        value: snapshot.fieldBossLine,
        inline: true,
      },
      {
        name: "카오스게이트",
        value: snapshot.chaosGateLine,
        inline: true,
      },
      {
        name: "기준",
        value: snapshot.sourceLine,
        inline: false,
      },
    )
    .setFooter({
      text: "매일 오전 8시 / 오후 8시 갱신",
    });
}

async function buildReminderEmbeds(
  kind: HomeworkReminderKind,
  state = getKoreaReminderState(),
): Promise<APIEmbed[]> {
  if (kind === "daily") {
    const philkamoEmbed = await buildPhilkamoEmbed(state);

    return [
      buildDailyChecklistEmbed().toJSON(),
      buildWeeklyChecklistEmbed("매일 함께 보는 주간 체크리스트").toJSON(),
      philkamoEmbed.toJSON(),
    ];
  }

  return [
    new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle("로스트아크 주간 초기화 알림")
      .setDescription(
        "로스트아크는 매주 수요일 오전 6시에 초기화됩니다. 이번 주 숙제와 구매 항목을 다시 확인해보세요.",
      )
      .addFields(
        {
          name: "주간에 끝내야 할 것들 (ALT+Q)",
          value: WEEKLY_HOMEWORK_LINES.join("\n"),
          inline: false,
        },
        {
          name: "주간 초기화 후 구매 추천",
          value: WEEKLY_SHOP_LINES.join("\n"),
          inline: false,
        },
      )
      .setFooter({
        text: "수요일 오전 8시 / 오후 8시 멘션 알림",
      })
      .toJSON(),
  ];
}

function getReminderNotificationText(kind: HomeworkReminderKind): string {
  return kind === "daily"
    ? "오늘의 숙제와 필카모 자동 동기화 알림입니다."
    : "주간 초기화 자동 동기화 알림입니다.";
}

function buildReminderMessage(kind: HomeworkReminderKind, input: {
  mentionText?: string;
  mentionRoleId?: string;
  embeds: APIEmbed[];
}): MessageCreateOptions {
  const prefix = input.mentionText ? `${input.mentionText} ` : "";
  const content =
    kind === "daily"
      ? `${prefix}오늘의 숙제와 필카모 알림입니다.`
      : `${prefix}주간 초기화 알림입니다.`;

  return {
    content: `${prefix}${getReminderNotificationText(kind)}`,
    embeds: input.embeds,
    allowedMentions: input.mentionRoleId
      ? {
          roles: [input.mentionRoleId],
        }
      : undefined,
  };
}

async function ensureHomeworkStoreFile(): Promise<void> {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });

  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await writeJsonFileAtomically(DATA_PATH, createEmptyHomeworkStore());
  }
}

async function readHomeworkStore(): Promise<HomeworkReminderStore> {
  await ensureHomeworkStoreFile();
  const raw = await readFile(DATA_PATH, "utf-8");

  try {
    if (!raw.trim()) {
      throw new SyntaxError("Homework reminder store is empty.");
    }

    return JSON.parse(raw) as HomeworkReminderStore;
  } catch (error) {
    logError("숙제 알림 저장 파일을 읽을 수 없어 기본값으로 복구합니다.", error);
    await backupInvalidHomeworkStore(raw);

    const emptyStore = createEmptyHomeworkStore();
    await writeJsonFileAtomically(DATA_PATH, emptyStore);
    return emptyStore;
  }
}

async function writeHomeworkStore(store: HomeworkReminderStore): Promise<void> {
  await writeJsonFileAtomically(DATA_PATH, store);
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
  config: GuildHomeworkReminderConfig,
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

export async function createHomeworkPreviewMessage(
  kind: HomeworkReminderKind,
): Promise<Pick<MessageCreateOptions, "content" | "embeds">> {
  const embeds = await buildReminderEmbeds(kind);
  const message = buildReminderMessage(kind, { embeds });

  return {
    content: message.content,
    embeds: message.embeds,
  };
}

export async function getHomeworkReminderConfig(
  guildId: string,
): Promise<GuildHomeworkReminderConfig> {
  const store = await readHomeworkStore();
  return normalizeGuildConfig(store.guilds[guildId]);
}

export async function listHomeworkReminderGuildIds(): Promise<string[]> {
  const store = await readHomeworkStore();
  return Object.keys(store.guilds);
}

export async function setHomeworkReminderChannel(
  guildId: string,
  channelId: string,
): Promise<void> {
  const store = await readHomeworkStore();
  const config = normalizeGuildConfig(store.guilds[guildId]);
  config.channelId = channelId;
  store.guilds[guildId] = config;
  await writeHomeworkStore(store);
}

export async function setRosterSyncChannel(
  guildId: string,
  channelId?: string,
): Promise<void> {
  const store = await readHomeworkStore();
  const config = normalizeGuildConfig(store.guilds[guildId]);
  config.rosterChannelId = channelId;
  store.guilds[guildId] = config;
  await writeHomeworkStore(store);
}

export async function setHomeworkReminderRole(
  guildId: string,
  roleId?: string,
): Promise<void> {
  const store = await readHomeworkStore();
  const config = normalizeGuildConfig(store.guilds[guildId]);
  config.roleId = roleId;
  store.guilds[guildId] = config;
  await writeHomeworkStore(store);
}

export async function sendHomeworkReminderToGuild(input: {
  client: Client;
  guildId: string;
  kind: HomeworkReminderKind;
}): Promise<boolean> {
  const store = await readHomeworkStore();
  const config = normalizeGuildConfig(store.guilds[input.guildId]);

  if (!config.channelId) {
    return false;
  }

  const channel = await getTextChannel(input.client, config.channelId);

  if (!channel) {
    return false;
  }

  const embeds = await buildReminderEmbeds(input.kind);
  const role = await resolveAlertRole(channel, config);
  const message = buildReminderMessage(input.kind, {
    mentionText: role?.toString(),
    mentionRoleId: role?.id,
    embeds,
  });

  await replaceTrackedChannelMessages({
    client: input.client,
    guildId: input.guildId,
    kind: input.kind === "daily" ? "homework-daily" : "homework-weekly",
    channel,
    messages: [message],
    legacyMatcher:
      input.kind === "daily"
        ? HOMEWORK_DAILY_LEGACY_MATCHER
        : HOMEWORK_WEEKLY_LEGACY_MATCHER,
  });

  store.guilds[input.guildId] = config;
  await writeHomeworkStore(store);
  return true;
}

export async function runDailyHomeworkReminderScan(client: Client): Promise<number> {
  const reminderState = getKoreaReminderState();

  if (!isReminderHour(reminderState.hour)) {
    return 0;
  }

  const reminderKey = getReminderOccurrenceKey(reminderState);
  const embeds = await buildReminderEmbeds("daily", reminderState);
  const store = await readHomeworkStore();
  let sentCount = 0;

  for (const guildId of Object.keys(store.guilds)) {
    const config = normalizeGuildConfig(store.guilds[guildId]);

    if (!config.channelId || config.lastDailyReminderKey === reminderKey) {
      store.guilds[guildId] = config;
      continue;
    }

    const channel = await getTextChannel(client, config.channelId);

    if (!channel) {
      store.guilds[guildId] = config;
      continue;
    }

    const role = await resolveAlertRole(channel, config);
    await replaceTrackedChannelMessages({
      client,
      guildId,
      kind: "homework-daily",
      channel,
      messages: [
        buildReminderMessage("daily", {
          mentionText: role?.toString(),
          mentionRoleId: role?.id,
          embeds,
        }),
      ],
      legacyMatcher: HOMEWORK_DAILY_LEGACY_MATCHER,
    });

    config.lastDailyReminderKey = reminderKey;
    store.guilds[guildId] = config;
    sentCount += 1;
  }

  await writeHomeworkStore(store);
  return sentCount;
}

export async function runWeeklyHomeworkReminderScan(client: Client): Promise<number> {
  const reminderState = getKoreaReminderState();

  if (reminderState.dayOfWeek !== "Wed" || !isReminderHour(reminderState.hour)) {
    return 0;
  }

  const reminderKey = getReminderOccurrenceKey(reminderState);
  const embeds = await buildReminderEmbeds("weekly", reminderState);
  const store = await readHomeworkStore();
  let sentCount = 0;

  for (const guildId of Object.keys(store.guilds)) {
    const config = normalizeGuildConfig(store.guilds[guildId]);

    if (!config.channelId || config.lastWeeklyReminderKey === reminderKey) {
      store.guilds[guildId] = config;
      continue;
    }

    const channel = await getTextChannel(client, config.channelId);

    if (!channel) {
      store.guilds[guildId] = config;
      continue;
    }

    const role = await resolveAlertRole(channel, config);
    await replaceTrackedChannelMessages({
      client,
      guildId,
      kind: "homework-weekly",
      channel,
      messages: [
        buildReminderMessage("weekly", {
          mentionText: role?.toString(),
          mentionRoleId: role?.id,
          embeds,
        }),
      ],
      legacyMatcher: HOMEWORK_WEEKLY_LEGACY_MATCHER,
    });

    config.lastWeeklyReminderKey = reminderKey;
    store.guilds[guildId] = config;
    sentCount += 1;
  }

  await writeHomeworkStore(store);
  return sentCount;
}

async function refreshCurrentHomeworkBoards(client: Client): Promise<{
  dailySentCount: number;
  weeklySentCount: number;
}> {
  const reminderState = getKoreaReminderState();
  const reminderKey = getReminderOccurrenceKey(reminderState);
  const shouldSendWeekly =
    reminderState.dayOfWeek === "Wed" && isReminderHour(reminderState.hour);
  const dailyEmbeds = await buildReminderEmbeds("daily", reminderState);
  const weeklyEmbeds = shouldSendWeekly
    ? await buildReminderEmbeds("weekly", reminderState)
    : null;
  const store = await readHomeworkStore();
  let dailySentCount = 0;
  let weeklySentCount = 0;

  for (const guildId of Object.keys(store.guilds)) {
    const config = normalizeGuildConfig(store.guilds[guildId]);

    if (!config.channelId) {
      await clearTrackedChannelMessages({
        client,
        guildId,
        kind: "homework-daily",
      });
      await clearTrackedChannelMessages({
        client,
        guildId,
        kind: "homework-weekly",
      });
      store.guilds[guildId] = config;
      continue;
    }

    const channel = await getTextChannel(client, config.channelId);

    if (!channel) {
      await clearTrackedChannelMessages({
        client,
        guildId,
        kind: "homework-daily",
      });
      await clearTrackedChannelMessages({
        client,
        guildId,
        kind: "homework-weekly",
      });
      store.guilds[guildId] = config;
      continue;
    }

    const role = await resolveAlertRole(channel, config);

    await replaceTrackedChannelMessages({
      client,
      guildId,
      kind: "homework-daily",
      channel,
      messages: [
        buildReminderMessage("daily", {
          mentionText: role?.toString(),
          mentionRoleId: role?.id,
          embeds: dailyEmbeds,
        }),
      ],
      legacyMatcher: HOMEWORK_DAILY_LEGACY_MATCHER,
    });
    dailySentCount += 1;

    if (weeklyEmbeds) {
      await replaceTrackedChannelMessages({
        client,
        guildId,
        kind: "homework-weekly",
        channel,
        messages: [
          buildReminderMessage("weekly", {
            mentionText: role?.toString(),
            mentionRoleId: role?.id,
            embeds: weeklyEmbeds,
          }),
        ],
        legacyMatcher: HOMEWORK_WEEKLY_LEGACY_MATCHER,
      });
      config.lastWeeklyReminderKey = reminderKey;
      weeklySentCount += 1;
    } else {
      await clearTrackedChannelMessages({
        client,
        guildId,
        kind: "homework-weekly",
      });
    }

    if (isReminderHour(reminderState.hour)) {
      config.lastDailyReminderKey = reminderKey;
    }

    store.guilds[guildId] = config;
  }

  await writeHomeworkStore(store);

  return {
    dailySentCount,
    weeklySentCount,
  };
}

export function startHomeworkReminderPolling(client: Client): void {
  if (homeworkReminderPollerStarted) {
    return;
  }

  homeworkReminderPollerStarted = true;

  const runScans = async () => {
    try {
      const dailySentCount = await runDailyHomeworkReminderScan(client);

      if (dailySentCount > 0) {
        logInfo(`일일 숙제 알림 ${dailySentCount}건을 보냈습니다.`);
      }
    } catch (error) {
      logError("일일 숙제 알림 검사 중 오류가 발생했습니다.", error);
    }

    try {
      const weeklySentCount = await runWeeklyHomeworkReminderScan(client);

      if (weeklySentCount > 0) {
        logInfo(`주간 숙제 알림 ${weeklySentCount}건을 보냈습니다.`);
      }
    } catch (error) {
      logError("주간 숙제 알림 검사 중 오류가 발생했습니다.", error);
    }
  };

  const runBootstrap = async () => {
    try {
      const { dailySentCount, weeklySentCount } =
        await refreshCurrentHomeworkBoards(client);

      if (dailySentCount > 0) {
        logInfo(`?쇱씪 ?숈젣 蹂대뱶 ${dailySentCount}嫄댁쓣 珥덇린 媛깆떊?덉뒿?덈떎.`);
      }

      if (weeklySentCount > 0) {
        logInfo(`二쇨컙 ?숈젣 蹂대뱶 ${weeklySentCount}嫄댁쓣 珥덇린 媛깆떊?덉뒿?덈떎.`);
      }
    } catch (error) {
      logError("?쇱씪 ?숈젣 蹂대뱶 珥덇린 媛깆떊 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.", error);
    }
  };

  void runBootstrap();
  setInterval(() => void runScans(), POLL_INTERVAL_MS);
}
