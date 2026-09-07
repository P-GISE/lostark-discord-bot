import { EmbedBuilder, type APIEmbed } from "discord.js";

const KLOA_CHARACTER_URL = "https://api.korlark.com/lostark/characters";
const KLOA_USER_AGENT = "custom-discord-bot/0.1";
const MAX_LOOKUP_COUNT = 5;
const EMBED_FIELD_CHAR_LIMIT = 900;

const JOB_NAMES: Record<number, string> = {
  0: "알 수 없음",
  10: "전사 (남)",
  11: "디스트로이어",
  12: "워로드",
  13: "버서커",
  14: "홀리나이트",
  20: "무도가 (남)",
  21: "스트라이커",
  22: "브레이커",
  30: "무도가 (여)",
  31: "배틀마스터",
  32: "인파이터",
  33: "기공사",
  34: "창술사",
  40: "헌터 (남)",
  41: "데빌헌터",
  42: "블래스터",
  43: "호크아이",
  44: "스카우터",
  50: "헌터 (여)",
  51: "건슬링어",
  60: "마법사",
  61: "바드",
  62: "서머너",
  63: "아르카나",
  64: "소서리스",
  70: "암살자",
  71: "블레이드",
  72: "데모닉",
  73: "리퍼",
  74: "소울이터",
  80: "스페셜리스트",
  81: "도화가",
  82: "기상술사",
  83: "환수사",
  90: "전사 (여)",
  91: "슬레이어",
  92: "발키리",
  101: "가디언나이트",
};

const SERVER_NAMES: Record<number, string> = {
  "-1": "알 수 없음",
  1: "루페온",
  2: "실리안",
  3: "아만",
  4: "아브렐슈드",
  5: "카단",
  6: "카마인",
  7: "카제로스",
  8: "니나브",
};

export interface KloaRosterMember {
  name: string;
  server: number;
  job: number;
  role: number;
  level: number;
  itemLevel: number;
  maxItemLevel: number;
  combatPower: number;
  symbol: string | null;
  image: string | null;
  guild: {
    name: string;
    isOwner: boolean;
  } | null;
}

export interface KloaCharacterResponse {
  status: number;
  name: string;
  job: number;
  role: number;
  server: number;
  level: number;
  members: KloaRosterMember[];
}

export interface NamedRosterTarget {
  ownerName: string;
  representativeCharacter: string;
}

type RosterLookupSuccess = {
  type: "success";
  name: string;
  embeds: APIEmbed[];
};

type RosterLookupNotFound = {
  type: "not_found";
  name: string;
};

type RosterLookupResult = RosterLookupSuccess | RosterLookupNotFound;

type NamedRosterLookupSuccess = {
  type: "success";
  target: NamedRosterTarget;
  embeds: APIEmbed[];
};

type NamedRosterLookupNotFound = {
  type: "not_found";
  target: NamedRosterTarget;
};

type NamedRosterLookupError = {
  type: "error";
  target: NamedRosterTarget;
  reason: string;
};

type NamedRosterLookupResult =
  | NamedRosterLookupSuccess
  | NamedRosterLookupNotFound
  | NamedRosterLookupError;

function parseCharacterNames(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function getJobName(jobId: number): string {
  return JOB_NAMES[jobId] ?? `직업 코드 ${jobId}`;
}

function getServerName(serverId: number): string {
  return SERVER_NAMES[serverId] ?? `서버 코드 ${serverId}`;
}

function formatItemLevel(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCombatPower(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function getOwnerDisplayName(ownerName: string): string {
  if (ownerName.length <= 1) {
    return ownerName;
  }

  return ownerName.slice(1);
}

function filterRosterToMainServer(
  data: KloaCharacterResponse,
): KloaCharacterResponse {
  const filteredMembers = data.members.filter((member) => member.server === data.server);

  if (filteredMembers.length === 0) {
    return data;
  }

  return {
    ...data,
    members: filteredMembers,
  };
}

function sortRosterMembers(
  members: KloaRosterMember[],
  representativeName: string,
): KloaRosterMember[] {
  return [...members].sort((left, right) => {
    const leftIsRepresentative = left.name === representativeName;
    const rightIsRepresentative = right.name === representativeName;

    if (leftIsRepresentative !== rightIsRepresentative) {
      return leftIsRepresentative ? -1 : 1;
    }

    if (right.itemLevel !== left.itemLevel) {
      return right.itemLevel - left.itemLevel;
    }

    if (right.combatPower !== left.combatPower) {
      return right.combatPower - left.combatPower;
    }

    return left.name.localeCompare(right.name, "ko-KR");
  });
}

function buildRosterLine(input: {
  member: KloaRosterMember;
  representativeName: string;
}): string {
  const marker = input.member.name === input.representativeName ? "★ " : "";

  return (
    `${marker}**${input.member.name}** | ` +
    `${getJobName(input.member.job)} | ` +
    `${formatItemLevel(input.member.itemLevel)} | ` +
    `${formatCombatPower(input.member.combatPower)}`
  );
}

function chunkLines(lines: string[]): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;

    if (next.length > EMBED_FIELD_CHAR_LIMIT) {
      if (current) {
        chunks.push(current);
        current = line;
        continue;
      }

      chunks.push(line);
      current = "";
      continue;
    }

    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export async function fetchRoster(
  characterName: string,
): Promise<KloaCharacterResponse> {
  const response = await fetch(
    `${KLOA_CHARACTER_URL}/${encodeURIComponent(characterName)}`,
    {
      headers: {
        accept: "application/json",
        "user-agent": KLOA_USER_AGENT,
      },
    },
  );

  if (response.status === 404) {
    throw new Error("CHARACTER_NOT_FOUND");
  }

  if (!response.ok) {
    throw new Error(`KLOA_CHARACTER_REQUEST_FAILED:${response.status}`);
  }

  return (await response.json()) as KloaCharacterResponse;
}

function buildRosterEmbeds(data: KloaCharacterResponse, options?: {
  title?: string;
  representativeName?: string;
  footerText?: string;
  descriptionLines?: string[];
}): APIEmbed[] {
  const filteredData = filterRosterToMainServer(data);
  const representativeName = options?.representativeName ?? data.name;
  const members = sortRosterMembers(filteredData.members, representativeName);
  const representativeMember =
    members.find((member) => member.name === representativeName) ?? members[0] ?? null;
  const descriptionLines = options?.descriptionLines ?? [
    `서버: ${getServerName(data.server)}`,
    `인원: ${members.length}명`,
    "표기: 이름 | 직업 | 아이템레벨 | 전투력",
  ];
  const chunks = chunkLines(
    members.map((member) =>
      buildRosterLine({
        member,
        representativeName,
      }),
    ),
  );

  if (chunks.length === 0) {
    chunks.push("표시할 원정대 캐릭터가 없어요.");
  }

  return chunks.map((chunk, index) => {
    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(options?.title ?? `${data.name} 원정대`)
      .setDescription(descriptionLines.join("\n"))
      .addFields({
        name: chunks.length > 1 ? `캐릭터 목록 ${index + 1}` : "캐릭터 목록",
        value: chunk,
        inline: false,
      })
      .setFooter({
        text: options?.footerText ?? "KLOA 캐릭터 정보",
      });

    if (representativeMember?.image) {
      embed.setThumbnail(representativeMember.image);
    }

    return embed.toJSON();
  });
}

function buildNamedRosterEmbeds(
  target: NamedRosterTarget,
  data: KloaCharacterResponse,
): APIEmbed[] {
  const filteredData = filterRosterToMainServer(data);

  return buildRosterEmbeds(filteredData, {
    title: `${getOwnerDisplayName(target.ownerName)} 원정대`,
    representativeName: target.representativeCharacter,
    footerText: "KLOA 자동 동기화",
    descriptionLines: [
      `대표 캐릭터: ${target.representativeCharacter}`,
      `서버: ${getServerName(data.server)}`,
      `원정대 인원: ${data.members.length}명`,
      "표기: 이름 | 직업 | 아이템레벨 | 전투력",
    ],
  });
}

function buildMainServerNamedRosterEmbeds(
  target: NamedRosterTarget,
  data: KloaCharacterResponse,
): APIEmbed[] {
  const filteredData = filterRosterToMainServer(data);

  return buildRosterEmbeds(filteredData, {
    title: `${getOwnerDisplayName(target.ownerName)} 원정대`,
    representativeName: target.representativeCharacter,
    footerText: "KLOA 자동 동기화",
    descriptionLines: [
      `대표 캐릭터: ${target.representativeCharacter}`,
      `서버: ${getServerName(filteredData.server)}`,
      `원정대 인원: ${filteredData.members.length}명`,
      "표기: 이름 | 직업 | 아이템레벨 | 전투력",
    ],
  });
}

export async function lookupRosterEmbeds(input: string): Promise<{
  embeds: APIEmbed[];
  notFoundNames: string[];
}> {
  const names = parseCharacterNames(input);

  if (names.length === 0) {
    return {
      embeds: [],
      notFoundNames: [],
    };
  }

  if (names.length > MAX_LOOKUP_COUNT) {
    throw new Error(`TOO_MANY_LOOKUPS:${MAX_LOOKUP_COUNT}`);
  }

  const results = await Promise.all(
    names.map(async (name): Promise<RosterLookupResult> => {
      try {
        const data = await fetchRoster(name);

        return {
          type: "success",
          name,
          embeds: buildRosterEmbeds(data),
        };
      } catch (error) {
        if (error instanceof Error && error.message === "CHARACTER_NOT_FOUND") {
          return {
            type: "not_found",
            name,
          };
        }

        throw error;
      }
    }),
  );

  return {
    embeds: results.flatMap((result) =>
      result.type === "success" ? result.embeds : [],
    ),
    notFoundNames: results.flatMap((result) =>
      result.type === "not_found" ? [result.name] : [],
    ),
  };
}

export async function lookupNamedRosterEmbeds(
  targets: NamedRosterTarget[],
): Promise<{
  embeds: APIEmbed[];
  notFoundTargets: NamedRosterTarget[];
  failedTargets: Array<{
    target: NamedRosterTarget;
    reason: string;
  }>;
}> {
  const results = await Promise.all(
    targets.map(async (target): Promise<NamedRosterLookupResult> => {
      try {
        const data = await fetchRoster(target.representativeCharacter);

        return {
          type: "success",
          target,
          embeds: buildMainServerNamedRosterEmbeds(target, data),
        };
      } catch (error) {
        if (error instanceof Error && error.message === "CHARACTER_NOT_FOUND") {
          return {
            type: "not_found",
            target,
          };
        }

        return {
          type: "error",
          target,
          reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        };
      }
    }),
  );

  return {
    embeds: results.flatMap((result) =>
      result.type === "success" ? result.embeds : [],
    ),
    notFoundTargets: results.flatMap((result) =>
      result.type === "not_found" ? [result.target] : [],
    ),
    failedTargets: results.flatMap((result) =>
      result.type === "error"
        ? [{ target: result.target, reason: result.reason }]
        : [],
    ),
  };
}
