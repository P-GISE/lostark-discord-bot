import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ActionRowBuilder,
  type APIEmbedField,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  type InteractionReplyOptions,
} from "discord.js";

const DATA_PATH = path.join(process.cwd(), "data", "party-recruitments.json");
const PARTY_CUSTOM_ID_PREFIX = "party";
const PARTY_RECRUITMENT_MENTION_ROLE_NAME = "로아 중독자들";
const KOREA_TIME_ZONE = "Asia/Seoul";
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const DAY_INDEX_BY_SHORT_NAME: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const CALENDAR_LENGTH = 7;
const CALENDAR_ROW_SPLIT_INDEX = 5;
const WEDNESDAY_INDEX = 3;
const PARTY_BUILDER_TTL_MS = 30 * 60 * 1000;

export const PARTY_RAID_CHOICES = [
  { value: "prologue", label: "서막" },
  { value: "act1", label: "1막" },
  { value: "act2", label: "2막" },
  { value: "act3", label: "3막" },
  { value: "act4", label: "4막" },
  { value: "finale", label: "종막" },
  { value: "serka", label: "세르카" },
  { value: "horizon", label: "지평" },
  { value: "kayangel", label: "카양겔" },
  { value: "ivorytower", label: "상아탑" },
] as const;

export const PARTY_DIFFICULTY_CHOICES = [
  { value: "normal", label: "노말" },
  { value: "hard", label: "하드" },
] as const;

export const PARTY_PROFICIENCY_CHOICES = [
  { value: "try", label: "트라이" },
  { value: "clear", label: "클경" },
  { value: "semi", label: "반숙" },
  { value: "expert", label: "숙련" },
] as const;

export type PartyRaidType = (typeof PARTY_RAID_CHOICES)[number]["value"];
export type PartyDifficulty = (typeof PARTY_DIFFICULTY_CHOICES)[number]["value"];
export type PartyProficiency = (typeof PARTY_PROFICIENCY_CHOICES)[number]["value"];

type PartyRaidGuide = {
  preparation: string[];
  sidereal?: string[];
  attributeCard: string[];
};

const PARTY_RAID_GUIDES: Record<PartyRaidType, PartyRaidGuide> = {
  prologue: {
    preparation: [
      "1관: 물약 / 아드 or 각물 / 암수 / 성부",
      "2관: 물약 / 아드 or 각물 / 암수 / 수면폭탄",
    ],
    sidereal: [
      "1관: 아제나(딜), 아델(딜)",
      "2관: 에페르니아, 라하르트(둘 다 히든)",
    ],
    attributeCard: ["딜러: 세구빛", "서폿: 남바절"],
  },
  act1: {
    preparation: [
      "1관: 물약 / 아드 or 각물 / 암수 / 성부",
      "2관: 물약 / 아드 or 각물 / 암수 / 성부",
    ],
    sidereal: [
      "1관: 웨이(무력), 라하르트(무력)",
      "2관: 에아달린(심장 부수기, 히든) / 아델(벽 부수기, 딜) / 하드 발악 시 웨이",
    ],
    attributeCard: ["딜러: 세구빛", "서폿: 남바절"],
  },
  act2: {
    preparation: [
      "1관: 물약 / 아드 or 각물 / 암수 (서폿 부식) / 불꽃 스크롤",
      "2관: 물약 / 아드 or 각물 / 암수 / 성부 (2관만 빛성부)",
    ],
    sidereal: [
      "1관: 페데리코, 온도 관리가 안 되면 에페르니아 가능하지만 딜 부족 주의",
      "2관: 니나브(MZ 택틱) / 하드 2-3 아제나(히든)",
    ],
    attributeCard: [
      "추천 속성: 뇌구빛",
      "딜러: 알고보면 / 뇌구빛(숨결)",
      "서폿: 너는 계획이 다 있구나 / 뇌구빛(가호)",
    ],
  },
  act3: {
    preparation: [
      "1관: 물약 / 아드 or 각물 / 암수 / 성부",
      "2관: 물약 / 아드 or 각물 / 암수 / 성부",
      "3관: 물약 / 아드 or 각물 / 암수 (서폿 1명 부식) / 성부",
    ],
    sidereal: [
      "1관: 실리안(딜), 아자키엘(피면), 카마인(히든)",
      "2관: 니나브(딜), 미스틱(히든)",
      "3관: 바훈투르(파괴), 샨디(빠른 밀기), 바스티안(게이지 관리)",
    ],
    attributeCard: [
      "기본: 딜러 세구빛 / 서폿 남바절",
      "3관만 토구빛",
      "딜러: 알고보면 / 토구빛(숨결)",
      "서폿: 너는 계획이 다 있구나 / 토바절(가호) / 대사부(하위)",
    ],
  },
  act4: {
    preparation: [
      "1관: 물약 / 아드 or 각물 / 암수 / 성부",
      "2관: 물약 / 아드 or 각물 / 암수 (무력 부족 시 회수) / 성부",
    ],
    sidereal: [
      "1관: 니나브 / 실리안 / 웨이 (150줄 니나브 제외 자유)",
      "2관: 바훈투르(무력, 히든) / 실리안(파괴) / 아제나(딜)",
    ],
    attributeCard: [
      "기본: 딜러 세구빛 / 서폿 남바절",
      "2관만 화구빛",
      "딜러: 알고보면 / 화구빛(숨결)",
      "서폿: 너는 계획이 다 있구나 / 화구빛(가호)",
    ],
  },
  finale: {
    preparation: [
      "1관: 물약 / 아드 or 각물 / 암수 / 성부",
      "2관: 물약 / 아드 or 각물 / 암수 / 빛나는 성스러운 폭탄",
      "2-2관: 물약 / 아드 or 각물 or 시정 / 암수 (상황 따라 회수) / 빛나는 성스러운 폭탄",
    ],
    sidereal: [
      "1관: 니나브(쉴드 추가 피해), 웨이(히든)",
      "2관: 카단(히든), 샨디(딜+2타 시 쿨감), 이난나(피면)",
      "2-2관: 공아만 / 방아만 (히든 있음)",
    ],
    attributeCard: ["딜러: 세구빛", "서폿: 남바절"],
  },
  serka: {
    preparation: [
      "1관: 물약 / 아드 or 각물 / 암수 / 성부",
      "2관: 물약 / 아드 or 각물 / 암수 or 파폭 (서폿 부식) / 성부",
    ],
    attributeCard: ["딜러: 세구빛", "서폿: 남바절"],
  },
  horizon: {
    preparation: [
      "1관: 물약 / 아드 or 각물 / 암수 / 성부",
      "2관: 물약 / 아드 or 각물 / 파폭 (서폿 부식) / 성부",
    ],
    attributeCard: [
      "추천 속성: 암구빛",
      "딜러: 알고보면 / 암구빛(숨결)",
      "서폿: 너는 계획이 다 있구나 / 암구빛(가호)",
    ],
  },
  kayangel: {
    preparation: [],
    attributeCard: [
      "기본: 딜러 세구빛 / 서폿 남바절",
      "3관만 암구빛",
      "딜러: 알고보면 / 암구빛(숨결)",
      "서폿: 너는 계획이 다 있구나 / 암구빛(가호)",
    ],
  },
  ivorytower: {
    preparation: [],
    attributeCard: ["딜러: 세구빛", "서폿: 남바절"],
  },
};

type PartyRecruitmentEntry = {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  ownerId: string;
  raidType: PartyRaidType;
  difficulty: PartyDifficulty;
  proficiency: PartyProficiency;
  maxMembers: number;
  memberIds: string[];
  checkedDayIndexes?: number[];
  availabilityByMemberId: Record<string, number[]>;
  weekStartDate: string;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
};

type PartyRecruitmentStore = {
  recruitments: Record<string, PartyRecruitmentEntry>;
};

type PartyBuilderSession = {
  ownerId: string;
  guildId: string;
  channelId: string;
  raidType: PartyRaidType;
  difficulty: PartyDifficulty;
  proficiency: PartyProficiency;
  maxMembers: 4 | 8;
  updatedAt: number;
};

type CalendarEntry = {
  isoDate: string;
  weekdayIndex: number;
};

type PartyBuilderMessage = Pick<InteractionReplyOptions, "embeds" | "components">;
type PartyRecruitmentMessage = Pick<
  InteractionReplyOptions,
  "embeds" | "components" | "allowedMentions"
>;

type PartyMutationResult =
  | { status: "updated"; recruitment: PartyRecruitmentEntry }
  | { status: "not_found" }
  | { status: "error"; message: string };

type PartyButtonAction =
  | { action: "join" | "leave" | "close" | "end"; recruitmentId: string }
  | { action: "day"; recruitmentId: string; dayIndex: number };

type PartyBuilderAction =
  | { action: "panel_create" }
  | { action: "builder_create" | "builder_reset" | "builder_cancel" }
  | { action: "builder_raid"; raidType: PartyRaidType }
  | { action: "builder_difficulty"; difficulty: PartyDifficulty }
  | { action: "builder_proficiency"; proficiency: PartyProficiency }
  | { action: "builder_size"; maxMembers: 4 | 8 };

const DEFAULT_PARTY_BUILDER_RAID: PartyRaidType = "prologue";
const DEFAULT_PARTY_BUILDER_DIFFICULTY: PartyDifficulty = "normal";
const DEFAULT_PARTY_BUILDER_PROFICIENCY: PartyProficiency = "try";
const DEFAULT_PARTY_BUILDER_SIZE: 4 | 8 = 4;

let partyStoreQueue: Promise<void> = Promise.resolve();
const partyBuilderSessions = new Map<string, PartyBuilderSession>();

function getRaidLabel(raidType: PartyRaidType): string {
  return PARTY_RAID_CHOICES.find((choice) => choice.value === raidType)?.label ?? raidType;
}

function getDifficultyLabel(difficulty: PartyDifficulty): string {
  return PARTY_DIFFICULTY_CHOICES.find((choice) => choice.value === difficulty)?.label ?? difficulty;
}

function getProficiencyLabel(proficiency: PartyProficiency): string {
  return PARTY_PROFICIENCY_CHOICES.find((choice) => choice.value === proficiency)?.label ?? proficiency;
}

function buildRaidGuideFields(raidType: PartyRaidType): APIEmbedField[] {
  const guide = PARTY_RAID_GUIDES[raidType];

  if (!guide) {
    return [];
  }

  const fields: APIEmbedField[] = [];

  if (guide.preparation.length > 0) {
    fields.push({
      name: "준비물 메모",
      value: guide.preparation.join("\n"),
      inline: false,
    });
  }

  if (guide.sidereal && guide.sidereal.length > 0) {
    fields.push({
      name: "공대장 스킬 메모",
      value: guide.sidereal.join("\n"),
      inline: false,
    });
  }

  fields.push({
    name: "속성 / 카드 메모",
    value: guide.attributeCard.join("\n"),
    inline: false,
  });

  return fields;
}

function formatMemberMentions(memberIds: string[]): string {
  if (memberIds.length === 0) {
    return "아직 참가자가 없어요.";
  }

  return memberIds.map((memberId, index) => `${index + 1}. <@${memberId}>`).join("\n");
}

function normalizeDayIndexes(dayIndexes?: number[]): number[] {
  return [
    ...new Set(
      (dayIndexes ?? [])
        .filter((value) => Number.isInteger(value) && value >= 0 && value < CALENDAR_LENGTH)
        .map((value) => Math.floor(value)),
    ),
  ].sort((left, right) => left - right);
}

function normalizeAvailabilityByMemberId(input: {
  ownerId: string;
  memberIds: string[];
  availabilityByMemberId?: Record<string, number[]>;
  legacyCheckedDayIndexes?: number[];
}): Record<string, number[]> {
  const normalized: Record<string, number[]> = {};

  for (const memberId of input.memberIds) {
    normalized[memberId] = normalizeDayIndexes(input.availabilityByMemberId?.[memberId]);
  }

  if (
    input.memberIds.includes(input.ownerId) &&
    input.legacyCheckedDayIndexes &&
    input.legacyCheckedDayIndexes.length > 0 &&
    Object.values(normalized).every((dayIndexes) => dayIndexes.length === 0)
  ) {
    normalized[input.ownerId] = normalizeDayIndexes(input.legacyCheckedDayIndexes);
  }

  return normalized;
}

function normalizeRecruitmentEntry(entry: PartyRecruitmentEntry): PartyRecruitmentEntry {
  const memberIds = [...new Set(entry.memberIds)];
  const proficiency = PARTY_PROFICIENCY_CHOICES.find(
    (choice) => choice.value === entry.proficiency,
  )?.value ?? DEFAULT_PARTY_BUILDER_PROFICIENCY;

  return {
    ...entry,
    maxMembers: entry.maxMembers === 8 ? 8 : 4,
    proficiency,
    memberIds,
    availabilityByMemberId: normalizeAvailabilityByMemberId({
      ownerId: entry.ownerId,
      memberIds,
      availabilityByMemberId: entry.availabilityByMemberId,
      legacyCheckedDayIndexes: entry.checkedDayIndexes,
    }),
  };
}

function getAvailableMemberIdsForDay(
  recruitment: PartyRecruitmentEntry,
  dayIndex: number,
): string[] {
  return recruitment.memberIds.filter((memberId) =>
    recruitment.availabilityByMemberId[memberId]?.includes(dayIndex),
  );
}

function getKoreaDateState(date = new Date()): {
  year: number;
  month: number;
  day: number;
  dayIndex: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Wed";

  return {
    year,
    month,
    day,
    dayIndex: DAY_INDEX_BY_SHORT_NAME[weekday] ?? WEDNESDAY_INDEX,
  };
}

function createUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return createUtcDate(year, month, day);
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = parseIsoDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

function getCurrentPartyWeekStartDate(date = new Date()): string {
  const state = getKoreaDateState(date);
  const weekStart = createUtcDate(state.year, state.month, state.day);
  const offset = (state.dayIndex - WEDNESDAY_INDEX + 7) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - offset);
  return formatIsoDate(weekStart);
}

function buildCalendarEntries(weekStartDate: string): CalendarEntry[] {
  return Array.from({ length: CALENDAR_LENGTH }, (_, index) => {
    const isoDate = addDaysToIsoDate(weekStartDate, index);
    const date = parseIsoDate(isoDate);

    return {
      isoDate,
      weekdayIndex: date.getUTCDay(),
    };
  });
}

function formatCalendarDateLabel(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekday = WEEKDAY_LABELS[date.getUTCDay()];

  return `${month}/${day} (${weekday})`;
}

function formatCalendarButtonLabel(entry: CalendarEntry): string {
  const date = parseIsoDate(entry.isoDate);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekday = WEEKDAY_LABELS[entry.weekdayIndex];

  return `${month}/${day} ${weekday}`;
}

function formatWeekRange(weekStartDate: string): string {
  const weekEndDate = addDaysToIsoDate(weekStartDate, CALENDAR_LENGTH - 1);
  return `${formatCalendarDateLabel(weekStartDate)} ~ ${formatCalendarDateLabel(weekEndDate)}`;
}

function buildCalendarLines(recruitment: PartyRecruitmentEntry): string[] {
  const calendarEntries = buildCalendarEntries(recruitment.weekStartDate);

  return calendarEntries.map((entry, index) => {
    const availableMemberIds = getAvailableMemberIdsForDay(recruitment, index);
    const marker = availableMemberIds.length > 0 ? "✅" : "⬜";
    const memberSummary =
      availableMemberIds.length > 0
        ? availableMemberIds.map((memberId) => `<@${memberId}>`).join(", ")
        : "없음";

    return `${marker} ${formatCalendarDateLabel(entry.isoDate)}: ${memberSummary}`;
  });
}

function createRecruitmentEntry(input: {
  guildId: string;
  channelId: string;
  ownerId: string;
  raidType: PartyRaidType;
  difficulty: PartyDifficulty;
  proficiency: PartyProficiency;
  maxMembers: number;
}): PartyRecruitmentEntry {
  const timestamp = new Date().toISOString();

  return {
    id: randomUUID(),
    guildId: input.guildId,
    channelId: input.channelId,
    messageId: "",
    ownerId: input.ownerId,
    raidType: input.raidType,
    difficulty: input.difficulty,
    proficiency: input.proficiency,
    maxMembers: input.maxMembers === 8 ? 8 : 4,
    memberIds: [input.ownerId],
    checkedDayIndexes: [],
    availabilityByMemberId: {
      [input.ownerId]: [],
    },
    weekStartDate: getCurrentPartyWeekStartDate(),
    closed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function cleanupBuilderSessions(): void {
  const now = Date.now();

  for (const [ownerId, session] of partyBuilderSessions.entries()) {
    if (now - session.updatedAt > PARTY_BUILDER_TTL_MS) {
      partyBuilderSessions.delete(ownerId);
    }
  }
}

function getBuilderSession(ownerId: string): PartyBuilderSession | undefined {
  cleanupBuilderSessions();
  return partyBuilderSessions.get(ownerId);
}

function saveBuilderSession(session: PartyBuilderSession): void {
  session.updatedAt = Date.now();
  partyBuilderSessions.set(session.ownerId, session);
}

function deleteBuilderSession(ownerId: string): void {
  partyBuilderSessions.delete(ownerId);
}

function createBuilderSession(input: {
  ownerId: string;
  guildId: string;
  channelId: string;
}): PartyBuilderSession {
  return {
    ownerId: input.ownerId,
    guildId: input.guildId,
    channelId: input.channelId,
    raidType: DEFAULT_PARTY_BUILDER_RAID,
    difficulty: DEFAULT_PARTY_BUILDER_DIFFICULTY,
    proficiency: DEFAULT_PARTY_BUILDER_PROFICIENCY,
    maxMembers: DEFAULT_PARTY_BUILDER_SIZE,
    updatedAt: Date.now(),
  };
}

function buildRecruitmentEmbed(recruitment: PartyRecruitmentEntry): EmbedBuilder {
  const raidLabel = getRaidLabel(recruitment.raidType);
  const difficultyLabel = getDifficultyLabel(recruitment.difficulty);
  const proficiencyLabel = getProficiencyLabel(recruitment.proficiency);
  const statusText = recruitment.closed ? "마감" : "모집 중";
  const guideFields = buildRaidGuideFields(recruitment.raidType);

  return new EmbedBuilder()
    .setColor(recruitment.closed ? 0x6b7280 : 0x22c55e)
    .setTitle(`${raidLabel} ${difficultyLabel} ${recruitment.maxMembers}인 파티 모집`)
    .setDescription(
      [
        `모집장: <@${recruitment.ownerId}>`,
        `기간: ${formatWeekRange(recruitment.weekStartDate)}`,
        "참가자는 날짜 버튼으로 가능한 일정을 직접 체크할 수 있어요.",
        "레이드별 준비물 메모와 공대장 스킬 메모도 함께 확인해 주세요.",
      ].join("\n"),
    )
    .addFields(
      {
        name: "파티 정보",
        value: [
          `종류: ${raidLabel}`,
          `난이도: ${difficultyLabel}`,
          `숙련도: ${proficiencyLabel}`,
          `정원: ${recruitment.maxMembers}인`,
          `상태: ${statusText}`,
        ].join("\n"),
        inline: false,
      },
      ...guideFields,
      {
        name: `참가자 (${recruitment.memberIds.length}/${recruitment.maxMembers})`,
        value: formatMemberMentions(recruitment.memberIds),
        inline: false,
      },
      {
        name: "일정 체크",
        value: buildCalendarLines(recruitment).join("\n"),
        inline: false,
      },
    )
    .setFooter({
      text: "참가자는 일정 체크, 모집장은 마감과 종료를 관리할 수 있어요.",
    })
    .setTimestamp(new Date(recruitment.updatedAt));
}

function buildControlRow(recruitment: PartyRecruitmentEntry): ActionRowBuilder<ButtonBuilder> {
  const isFull = recruitment.memberIds.length >= recruitment.maxMembers;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:join:${recruitment.id}`)
      .setLabel("참가")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(recruitment.closed || isFull),
    new ButtonBuilder()
      .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:leave:${recruitment.id}`)
      .setLabel("취소")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(recruitment.memberIds.length === 0),
    new ButtonBuilder()
      .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:close:${recruitment.id}`)
      .setLabel(recruitment.closed ? "재개" : "마감")
      .setStyle(recruitment.closed ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:end:${recruitment.id}`)
      .setLabel("종료")
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildCalendarRows(
  recruitment: PartyRecruitmentEntry,
): Array<ActionRowBuilder<ButtonBuilder>> {
  const entries = buildCalendarEntries(recruitment.weekStartDate);
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];

  for (let startIndex = 0; startIndex < entries.length; startIndex += CALENDAR_ROW_SPLIT_INDEX) {
    const slice = entries.slice(startIndex, startIndex + CALENDAR_ROW_SPLIT_INDEX);

    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...slice.map((entry, index) => {
          const dayIndex = startIndex + index;

          return new ButtonBuilder()
            .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:day:${recruitment.id}:${dayIndex}`)
            .setLabel(formatCalendarButtonLabel(entry))
            .setStyle(
              getAvailableMemberIdsForDay(recruitment, dayIndex).length > 0
                ? ButtonStyle.Success
                : ButtonStyle.Secondary,
            );
        }),
      ),
    );
  }

  return rows;
}

function buildRecruitmentMessage(recruitment: PartyRecruitmentEntry): PartyRecruitmentMessage {
  return {
    embeds: [buildRecruitmentEmbed(recruitment).toJSON()],
    components: [buildControlRow(recruitment), ...buildCalendarRows(recruitment)],
    allowedMentions: {
      users: [],
    },
  };
}

async function buildRecruitmentCreateMessage(
  interaction: ButtonInteraction,
  recruitment: PartyRecruitmentEntry,
): Promise<PartyRecruitmentMessage & { content?: string }> {
  const message = buildRecruitmentMessage(recruitment);
  const role = interaction.guild?.roles.cache.find(
    (guildRole) => guildRole.name === PARTY_RECRUITMENT_MENTION_ROLE_NAME,
  );

  if (!role) {
    return message;
  }

  return {
    ...message,
    content: `<@&${role.id}> 파티모집이 생성됐어요.`,
    allowedMentions: {
      roles: [role.id],
      users: [],
    },
  };
}

export function createPartyPanelMessage(): Pick<
  InteractionReplyOptions,
  "embeds" | "components" | "allowedMentions"
> {
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("파티모집 패널")
    .setDescription(
      [
        "버튼으로 바로 레이드 파티 모집 카드를 만들 수 있어요.",
        "모집 생성 버튼을 누르면 개인 설정 패널이 열리고, 종류 / 난이도 / 인원을 버튼만으로 골라서 바로 생성할 수 있어요.",
        "생성된 모집 카드에는 레이드별 준비물 메모가 자동으로 같이 붙어요.",
        `캘린더는 ${CALENDAR_LENGTH}일 기준으로 수요일부터 화요일까지 체크됩니다.`,
      ].join("\n"),
    )
    .addFields({
      name: "지원 범위",
      value: [
        "종류: 서막, 1막, 2막, 3막, 4막, 종막, 세르카, 지평, 카양겔, 상아탑",
        "난이도: 노말, 하드",
        "숙련도: 트라이, 클경, 반숙, 숙련",
        "인원: 4인, 8인",
      ].join("\n"),
      inline: false,
    })
    .setFooter({
      text: "모집 카드는 생성 후 참가 / 취소 / 마감 / 종료 / 일정 체크 버튼을 사용할 수 있어요.",
    });

  return {
    embeds: [embed.toJSON()],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:panel:create`)
          .setLabel("모집 생성")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
    allowedMentions: {
      users: [],
    },
  };
}

function buildBuilderEmbed(session: PartyBuilderSession): EmbedBuilder {
  const proficiencyLabel = getProficiencyLabel(session.proficiency);

  return new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("파티모집 생성기")
    .setDescription(
      [
        "버튼만 눌러서 모집 카드를 바로 만들 수 있어요.",
        "종류, 난이도, 인원을 고른 뒤 생성 버튼을 누르면 현재 채널에 모집 카드가 올라갑니다.",
      ].join("\n"),
    )
    .addFields(
      {
        name: "현재 선택",
        value: [
          `종류: ${getRaidLabel(session.raidType)}`,
          `난이도: ${getDifficultyLabel(session.difficulty)}`,
          `숙련도: ${proficiencyLabel}`,
          `인원: ${session.maxMembers}인`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "캘린더 범위",
        value: formatWeekRange(getCurrentPartyWeekStartDate()),
        inline: false,
      },
    )
    .setFooter({
      text: "이 설정 패널은 본인에게만 보여요.",
    });
}

function buildRaidSelectionRows(
  session: PartyBuilderSession,
): Array<ActionRowBuilder<ButtonBuilder>> {
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];

  for (let startIndex = 0; startIndex < PARTY_RAID_CHOICES.length; startIndex += 5) {
    const slice = PARTY_RAID_CHOICES.slice(startIndex, startIndex + 5);

    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...slice.map((choice) =>
          new ButtonBuilder()
            .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:builder:raid:${choice.value}`)
            .setLabel(choice.label)
            .setStyle(
              session.raidType === choice.value ? ButtonStyle.Primary : ButtonStyle.Secondary,
            ),
        ),
      ),
    );
  }

  return rows;
}

function buildBuilderMessage(session: PartyBuilderSession): PartyBuilderMessage {
  return {
    embeds: [buildBuilderEmbed(session).toJSON()],
    components: [
      ...buildRaidSelectionRows(session),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...PARTY_DIFFICULTY_CHOICES.map((choice) =>
          new ButtonBuilder()
            .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:builder:difficulty:${choice.value}`)
            .setLabel(choice.label)
            .setStyle(
              session.difficulty === choice.value ? ButtonStyle.Primary : ButtonStyle.Secondary,
            ),
        ),
        ...([4, 8] as const).map((size) =>
          new ButtonBuilder()
            .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:builder:size:${size}`)
            .setLabel(`${size}인`)
            .setStyle(
              session.maxMembers === size ? ButtonStyle.Primary : ButtonStyle.Secondary,
            ),
        ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...PARTY_PROFICIENCY_CHOICES.map((choice) =>
          new ButtonBuilder()
            .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:builder:proficiency:${choice.value}`)
            .setLabel(choice.label)
            .setStyle(
              session.proficiency === choice.value ? ButtonStyle.Primary : ButtonStyle.Secondary,
            ),
        ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:builder:create`)
          .setLabel("모집 카드 생성")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:builder:reset`)
          .setLabel("초기화")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${PARTY_CUSTOM_ID_PREFIX}:builder:cancel`)
          .setLabel("닫기")
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

async function ensureStoreFile(): Promise<void> {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });

  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    const emptyStore: PartyRecruitmentStore = {
      recruitments: {},
    };
    await writeFile(DATA_PATH, JSON.stringify(emptyStore, null, 2), "utf-8");
  }
}

async function readStore(): Promise<PartyRecruitmentStore> {
  await ensureStoreFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  const parsed = JSON.parse(raw) as PartyRecruitmentStore;

  return {
    recruitments: Object.fromEntries(
      Object.entries(parsed.recruitments ?? {}).map(([recruitmentId, entry]) => [
        recruitmentId,
        normalizeRecruitmentEntry(entry),
      ]),
    ),
  };
}

async function writeStore(store: PartyRecruitmentStore): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
}

async function withStoreQueue<T>(operation: () => Promise<T>): Promise<T> {
  const previous = partyStoreQueue;
  let releaseQueue: (() => void) | undefined;

  partyStoreQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous;

  try {
    return await operation();
  } finally {
    releaseQueue?.();
  }
}

async function saveRecruitment(recruitment: PartyRecruitmentEntry): Promise<void> {
  await withStoreQueue(async () => {
    const store = await readStore();
    store.recruitments[recruitment.id] = recruitment;
    await writeStore(store);
  });
}

async function mutateRecruitment(
  recruitmentId: string,
  mutation: (
    recruitment: PartyRecruitmentEntry,
  ) => PartyRecruitmentEntry | { error: string } | null,
): Promise<PartyMutationResult> {
  return withStoreQueue(async () => {
    const store = await readStore();
    const existing = store.recruitments[recruitmentId];

    if (!existing) {
      return { status: "not_found" } as const;
    }

    const draft: PartyRecruitmentEntry = {
      ...existing,
      memberIds: [...existing.memberIds],
      checkedDayIndexes: [...(existing.checkedDayIndexes ?? [])],
      availabilityByMemberId: Object.fromEntries(
        Object.entries(existing.availabilityByMemberId ?? {}).map(([memberId, dayIndexes]) => [
          memberId,
          [...dayIndexes],
        ]),
      ),
    };

    const result = mutation(draft);

    if (result === null) {
      return { status: "not_found" } as const;
    }

    if ("error" in result) {
      return {
        status: "error",
        message: result.error,
      } as const;
    }

    result.updatedAt = new Date().toISOString();
    store.recruitments[recruitmentId] = normalizeRecruitmentEntry(result);
    await writeStore(store);

    return {
      status: "updated",
      recruitment: store.recruitments[recruitmentId],
    } as const;
  });
}

export async function createPartyRecruitmentMessage(input: {
  guildId: string;
  channelId: string;
  ownerId: string;
  raidType: PartyRaidType;
  difficulty: PartyDifficulty;
  proficiency: PartyProficiency;
  maxMembers: number;
}): Promise<{
  recruitment: PartyRecruitmentEntry;
  message: PartyRecruitmentMessage;
}> {
  const recruitment = createRecruitmentEntry(input);

  return {
    recruitment,
    message: buildRecruitmentMessage(recruitment),
  };
}

export async function attachPartyRecruitmentMessageId(input: {
  recruitmentId: string;
  messageId: string;
}): Promise<void> {
  await withStoreQueue(async () => {
    const store = await readStore();
    const recruitment = store.recruitments[input.recruitmentId];

    if (!recruitment) {
      return;
    }

    recruitment.messageId = input.messageId;
    recruitment.updatedAt = new Date().toISOString();
    store.recruitments[input.recruitmentId] = recruitment;
    await writeStore(store);
  });
}

export async function registerPartyRecruitment(
  recruitment: PartyRecruitmentEntry,
): Promise<void> {
  await saveRecruitment(recruitment);
}

async function deleteRecruitment(recruitmentId: string): Promise<PartyRecruitmentEntry | null> {
  return withStoreQueue(async () => {
    const store = await readStore();
    const recruitment = store.recruitments[recruitmentId];

    if (!recruitment) {
      return null;
    }

    delete store.recruitments[recruitmentId];
    await writeStore(store);
    return recruitment;
  });
}

function parseCustomId(customId: string): PartyButtonAction | null {
  const parts = customId.split(":");

  if (parts[0] !== PARTY_CUSTOM_ID_PREFIX || parts.length < 3) {
    return null;
  }

  if (parts[1] === "day" && parts.length === 4) {
    const dayIndex = Number(parts[3]);

    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= CALENDAR_LENGTH) {
      return null;
    }

    return {
      action: "day",
      recruitmentId: parts[2],
      dayIndex,
    };
  }

  if (
    parts[1] === "join" ||
    parts[1] === "leave" ||
    parts[1] === "close" ||
    parts[1] === "end"
  ) {
    return {
      action: parts[1],
      recruitmentId: parts[2],
    };
  }

  return null;
}

function parseBuilderCustomId(customId: string): PartyBuilderAction | null {
  const parts = customId.split(":");

  if (parts[0] !== PARTY_CUSTOM_ID_PREFIX || parts.length < 3) {
    return null;
  }

  if (parts[1] === "panel" && parts[2] === "create") {
    return { action: "panel_create" };
  }

  if (parts[1] !== "builder") {
    return null;
  }

  if (parts[2] === "create") {
    return { action: "builder_create" };
  }

  if (parts[2] === "reset") {
    return { action: "builder_reset" };
  }

  if (parts[2] === "cancel") {
    return { action: "builder_cancel" };
  }

  if (parts[2] === "raid" && parts[3]) {
    const raidType = PARTY_RAID_CHOICES.find((choice) => choice.value === parts[3])?.value;

    if (!raidType) {
      return null;
    }

    return {
      action: "builder_raid",
      raidType,
    };
  }

  if (parts[2] === "difficulty" && parts[3]) {
    const difficulty = PARTY_DIFFICULTY_CHOICES.find(
      (choice) => choice.value === parts[3],
    )?.value;

    if (!difficulty) {
      return null;
    }

    return {
      action: "builder_difficulty",
      difficulty,
    };
  }

  if (parts[2] === "proficiency" && parts[3]) {
    const proficiency = PARTY_PROFICIENCY_CHOICES.find(
      (choice) => choice.value === parts[3],
    )?.value;

    if (!proficiency) {
      return null;
    }

    return {
      action: "builder_proficiency",
      proficiency,
    };
  }

  if (parts[2] === "size" && parts[3]) {
    const maxMembers = Number(parts[3]);

    if (!Number.isInteger(maxMembers) || (maxMembers !== 4 && maxMembers !== 8)) {
      return null;
    }

    return {
      action: "builder_size",
      maxMembers,
    };
  }

  return null;
}

export async function handlePartyRecruitmentInteraction(
  interaction: ButtonInteraction,
): Promise<void> {
  const builderAction = parseBuilderCustomId(interaction.customId);

  if (builderAction) {
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({
        content: "이 버튼은 서버 채널에서만 사용할 수 있어요.",
        ephemeral: true,
      });
      return;
    }

    if (builderAction.action === "panel_create") {
      const session = createBuilderSession({
        ownerId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      saveBuilderSession(session);

      await interaction.reply({
        ...buildBuilderMessage(session),
        ephemeral: true,
      });
      return;
    }

    const existingSession = getBuilderSession(interaction.user.id);

    if (!existingSession) {
      await interaction.reply({
        content: "설정 세션이 만료됐어요. 파티모집 패널에서 다시 시작해 주세요.",
        ephemeral: true,
      });
      return;
    }

    if (builderAction.action === "builder_reset") {
      const resetSession = createBuilderSession({
        ownerId: existingSession.ownerId,
        guildId: existingSession.guildId,
        channelId: existingSession.channelId,
      });
      saveBuilderSession(resetSession);
      await interaction.update(buildBuilderMessage(resetSession));
      return;
    }

    if (builderAction.action === "builder_cancel") {
      deleteBuilderSession(interaction.user.id);
      await interaction.update({
        content: "파티모집 생성기를 닫았어요.",
        embeds: [],
        components: [],
      });
      return;
    }

    if (builderAction.action === "builder_raid") {
      existingSession.raidType = builderAction.raidType;
      saveBuilderSession(existingSession);
      await interaction.update(buildBuilderMessage(existingSession));
      return;
    }

    if (builderAction.action === "builder_difficulty") {
      existingSession.difficulty = builderAction.difficulty;
      saveBuilderSession(existingSession);
      await interaction.update(buildBuilderMessage(existingSession));
      return;
    }

    if (builderAction.action === "builder_proficiency") {
      existingSession.proficiency = builderAction.proficiency;
      saveBuilderSession(existingSession);
      await interaction.update(buildBuilderMessage(existingSession));
      return;
    }

    if (builderAction.action === "builder_size") {
      existingSession.maxMembers = builderAction.maxMembers;
      saveBuilderSession(existingSession);
      await interaction.update(buildBuilderMessage(existingSession));
      return;
    }

    if (builderAction.action === "builder_create") {
      const { recruitment, message } = await createPartyRecruitmentMessage({
        guildId: existingSession.guildId,
        channelId: existingSession.channelId,
        ownerId: existingSession.ownerId,
        raidType: existingSession.raidType,
        difficulty: existingSession.difficulty,
        proficiency: existingSession.proficiency,
        maxMembers: existingSession.maxMembers,
      });

      await registerPartyRecruitment(recruitment);
      const createMessage = await buildRecruitmentCreateMessage(interaction, recruitment);

      const channel = interaction.channel;

      if (!channel || !channel.isSendable()) {
        await interaction.reply({
          content: "현재 채널에는 모집 카드를 보낼 수 없어요.",
          ephemeral: true,
        });
        return;
      }

      const sentMessage = await channel.send(createMessage);
      await attachPartyRecruitmentMessageId({
        recruitmentId: recruitment.id,
        messageId: sentMessage.id,
      });
      deleteBuilderSession(interaction.user.id);

      await interaction.update({
        content: "파티모집 카드를 생성했어요.",
        embeds: [],
        components: [],
      });
      return;
    }
  }

  const parsed = parseCustomId(interaction.customId);

  if (!parsed) {
    return;
  }

  const actorId = interaction.user.id;

  if (parsed.action === "end") {
    const store = await readStore();
    const existingRecruitment = store.recruitments[parsed.recruitmentId];

    if (!existingRecruitment) {
      await interaction.reply({
        content: "이미 종료됐거나 찾을 수 없는 파티모집 카드예요.",
        ephemeral: true,
      });
      return;
    }

    if (existingRecruitment.ownerId !== actorId) {
      await interaction.reply({
        content: "모집장만 종료할 수 있어요.",
        ephemeral: true,
      });
      return;
    }

    await deleteRecruitment(parsed.recruitmentId);
    await interaction.reply({
      content: "파티모집 카드를 종료했어요.",
      ephemeral: true,
    });
    await interaction.message.delete().catch(() => null);
    return;
  }

  const mutationResult = await mutateRecruitment(parsed.recruitmentId, (recruitment) => {
    if (parsed.action === "join") {
      if (recruitment.closed) {
        return { error: "이미 마감된 파티 모집이에요." };
      }

      if (recruitment.memberIds.includes(actorId)) {
        return { error: "이미 참가한 파티 모집이에요." };
      }

      if (recruitment.memberIds.length >= recruitment.maxMembers) {
        return { error: "이미 정원이 다 찼어요." };
      }

      recruitment.memberIds.push(actorId);
      recruitment.availabilityByMemberId[actorId] = [];
      return recruitment;
    }

    if (parsed.action === "leave") {
      if (!recruitment.memberIds.includes(actorId)) {
        return { error: "아직 참가하지 않은 상태예요." };
      }

      recruitment.memberIds = recruitment.memberIds.filter((memberId) => memberId !== actorId);
      delete recruitment.availabilityByMemberId[actorId];
      return recruitment;
    }

    if (parsed.action === "close") {
      if (recruitment.ownerId !== actorId) {
        return { error: "모집장만 마감 상태를 바꿀 수 있어요." };
      }

      recruitment.closed = !recruitment.closed;
      return recruitment;
    }

    if (parsed.action === "day") {
      if (!recruitment.memberIds.includes(actorId)) {
        return { error: "파티에 참가한 뒤에 일정 체크를 할 수 있어요." };
      }

      const currentDayIndexes = recruitment.availabilityByMemberId[actorId] ?? [];
      const isChecked = currentDayIndexes.includes(parsed.dayIndex);

      recruitment.availabilityByMemberId[actorId] = isChecked
        ? currentDayIndexes.filter((value) => value !== parsed.dayIndex)
        : [...currentDayIndexes, parsed.dayIndex].sort((left, right) => left - right);

      return recruitment;
    }

    return { error: "처리할 수 없는 요청이에요." };
  });

  if (mutationResult.status === "not_found") {
    await interaction.reply({
      content: "이 파티 모집 카드를 찾지 못했어요. 새로 만들어서 써 주세요.",
      ephemeral: true,
    });
    return;
  }

  if (mutationResult.status === "error") {
    await interaction.reply({
      content: mutationResult.message,
      ephemeral: true,
    });
    return;
  }

  await interaction.update(buildRecruitmentMessage(mutationResult.recruitment));
}
