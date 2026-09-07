import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import type { SlashCommand } from "../../types/command";
import { formatDateTime, parseCommaList } from "../../utils/format";
import { logError } from "../../utils/logger";
import { DEFAULT_TRACKED_CARD_SETS, findMerchantAlertMatch } from "./merchant-card-sets";
import { PREFERRED_MERCHANT_SERVERS } from "./merchant-config";
import {
  getMerchantAlertConfig,
  runMerchantAlertScan,
  sendMerchantBroadcastMessage,
  setMerchantBroadcastRotationKey,
  setMerchantCompleteAnnouncementRotationKey,
  setMerchantAlertChannel,
  setMerchantAlertRole,
} from "./merchant-alert.service";
import {
  arePreferredServerReportsComplete,
  buildKloaSyncBroadcastPayload,
  syncKloaMerchantData,
} from "./kloa-merchant.service";
import {
  getMerchantServer,
  getMerchantServerEntry,
  listMerchantServers,
  upsertMerchantServer,
} from "./merchant.service";
import type { MerchantListing } from "./merchant.types";

function formatSourceSection(input: {
  title: string;
  merchantName?: string;
  cards: string[];
  updatedAt: string;
  updatedBy: string;
  note?: string;
}) {
  const lines = [
    `[${input.title}]`,
    input.merchantName ? `위치: ${input.merchantName}` : null,
    `카드: ${input.cards.join(", ")}`,
    input.note ? `메모: ${input.note}` : null,
    `갱신: ${formatDateTime(input.updatedAt)} / ${input.updatedBy}`,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function formatRemainingDuration(targetIso: string): string {
  const diffMinutes = Math.max(
    0,
    Math.ceil((new Date(targetIso).getTime() - Date.now()) / 60_000),
  );

  if (diffMinutes === 0) {
    return "곧 종료";
  }

  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}시간 ${minutes}분`;
  }

  if (hours > 0) {
    return `${hours}시간`;
  }

  return `${minutes}분`;
}

function buildSyncSummaryLine(server: string, listing?: MerchantListing): string {
  if (!listing) {
    return `- ${server}: 동기화 데이터 없음`;
  }

  const match = findMerchantAlertMatch(listing);

  if (!match) {
    return `- ${server}: 감시 카드 없음`;
  }

  const setSummary =
    match.matchedSetNames.length > 0 ? ` / ${match.matchedSetNames.join(", ")}` : "";

  return `- ${server}: ${match.matchedCards.join(", ")}${setSummary}`;
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

function buildSyncDetailLines(server: string, listing?: MerchantListing): string[] {
  if (!listing) {
    return [`- ${server}: 동기화 데이터 없음`];
  }

  const locationListings = buildLocationListings(listing);

  if (locationListings.length === 0) {
    return [buildSyncSummaryLine(server, listing)];
  }

  const detailLines = locationListings
    .map((locationListing) => {
      const match = findMerchantAlertMatch(locationListing);

      if (!match) {
        return null;
      }

      const setSummary =
        match.matchedSetNames.length > 0
          ? ` / ${match.matchedSetNames.join(", ")}`
          : "";

      return `  ${locationListing.merchantName}: ${match.matchedCards.join(", ")}${setSummary}`;
    })
    .filter((line): line is string => Boolean(line));

  if (detailLines.length === 0) {
    return [`- ${server}: 감시 카드 없음`];
  }

  return [`- ${server}`, ...detailLines];
}

function buildMatchedSyncLines(server: string, listing?: MerchantListing): string[] {
  if (!listing) {
    return [];
  }

  const locationListings = buildLocationListings(listing);

  if (locationListings.length === 0) {
    const match = findMerchantAlertMatch(listing);

    if (!match) {
      return [];
    }

    const setSummary =
      match.matchedSetNames.length > 0 ? ` / ${match.matchedSetNames.join(", ")}` : "";

    return [`- ${server}: ${match.matchedCards.join(", ")}${setSummary}`];
  }

  const detailLines = locationListings
    .map((locationListing) => {
      const match = findMerchantAlertMatch(locationListing);

      if (!match) {
        return null;
      }

      const setSummary =
        match.matchedSetNames.length > 0
          ? ` / ${match.matchedSetNames.join(", ")}`
          : "";

      return `  ${locationListing.merchantName}: ${match.matchedCards.join(", ")}${setSummary}`;
    })
    .filter((line): line is string => Boolean(line));

  if (detailLines.length === 0) {
    return [];
  }

  return [`- ${server}`, ...detailLines];
}

export const merchantCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("merchant")
    .setNameLocalizations({
      ko: "떠상",
    })
    .setDescription("로스트아크 떠돌이상인 카드 목록과 알림을 관리합니다.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("sets")
        .setNameLocalizations({
          ko: "세트",
        })
        .setDescription("추적 중인 카드셋과 카드 목록을 확인합니다."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("servers")
        .setNameLocalizations({
          ko: "서버목록",
        })
        .setDescription("현재 등록된 서버 목록을 보여줍니다."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setNameLocalizations({
          ko: "조회",
        })
        .setDescription("특정 서버의 현재 카드 목록을 보여줍니다.")
        .addStringOption((option) =>
          option
            .setName("server")
            .setNameLocalizations({
              ko: "서버",
            })
            .setDescription("예: 루페온, 아브렐슈드")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setNameLocalizations({
          ko: "수동입력",
        })
        .setDescription("특정 서버의 수동 카드 목록을 추가하거나 수정합니다.")
        .addStringOption((option) =>
          option
            .setName("server")
            .setNameLocalizations({
              ko: "서버",
            })
            .setDescription("예: 루페온, 아브렐슈드")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("cards")
            .setNameLocalizations({
              ko: "카드",
            })
            .setDescription("쉼표로 구분한 카드 목록")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("merchant_name")
            .setNameLocalizations({
              ko: "위치",
            })
            .setDescription("수동 제보 위치나 상인 이름")
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName("note")
            .setNameLocalizations({
              ko: "메모",
            })
            .setDescription("추가 메모")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("watch-channel")
        .setNameLocalizations({
          ko: "알림채널",
        })
        .setDescription("떠돌이상인 알림을 보낼 채널을 설정합니다.")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setNameLocalizations({
              ko: "채널",
            })
            .setDescription("알림을 받을 텍스트 채널")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("watch-role")
        .setNameLocalizations({
          ko: "알림역할",
        })
        .setDescription("알림에 멘션할 역할을 설정하거나 해제합니다.")
        .addRoleOption((option) =>
          option
            .setName("role")
            .setNameLocalizations({
              ko: "역할",
            })
            .setDescription("예: @로아 중독자들")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("check")
        .setNameLocalizations({
          ko: "점검",
        })
        .setDescription("현재 저장된 목록으로 알림 대상 카드를 즉시 검사합니다."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("sync")
        .setNameLocalizations({
          ko: "동기화",
        })
        .setDescription("KLOA 떠돌이상인 데이터를 즉시 동기화합니다."),
    ),
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "sets") {
      const lines = DEFAULT_TRACKED_CARD_SETS.map(
        (cardSet) => `- ${cardSet.name}: ${cardSet.cards.join(", ")}`,
      );

      await interaction.reply({
        content:
          "현재 기본 추적 카드셋 목록입니다.\n" +
          lines.join("\n") +
          "\n\n세트 카드 중 하나라도 떠돌이상인 목록에 있으면 알림 대상으로 잡습니다.",
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "servers") {
      const listings = await listMerchantServers();

      if (listings.length === 0) {
        await interaction.reply({
          content:
            "아직 등록된 서버 데이터가 없어요. `/merchant sync`나 `/merchant set`으로 먼저 채워주세요.",
          ephemeral: true,
        });
        return;
      }

      const lines = listings.map(
        (listing) =>
          `- ${listing.server} (${listing.cards.length}장, ${formatDateTime(listing.updatedAt)})`,
      );

      await interaction.reply({
        content:
          `현재 표시 중인 서버는 ${PREFERRED_MERCHANT_SERVERS.join(", ")} 입니다.\n` +
          lines.join("\n"),
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "view") {
      const server = interaction.options.getString("server", true);
      const listing = await getMerchantServer(server);
      const entry = await getMerchantServerEntry(server);

      if (!listing || !entry) {
        await interaction.reply({
          content: `${server} 서버 데이터가 아직 없어요. 먼저 \`/merchant sync\`나 \`/merchant set\`을 사용해 주세요.`,
          ephemeral: true,
        });
        return;
      }

      const alertMatch = findMerchantAlertMatch(listing);
      const topLines = [
        `${listing.server} 서버 현재 떠돌이상인 카드`,
        listing.locations?.length
          ? `위치: ${listing.locations.join(" / ")}`
          : listing.merchantName
            ? `위치: ${listing.merchantName}`
            : null,
        alertMatch
          ? `감지 카드셋: ${alertMatch.matchedSetNames.join(", ") || "개별 추적 카드"} / ${alertMatch.matchedCards.join(", ")}`
          : null,
        `전체 카드: ${listing.cards.join(", ")}`,
      ].filter((line): line is string => Boolean(line));

      const sections = [
        entry.kloa
          ? formatSourceSection({
              title: "KLOA 자동 수집",
              merchantName: entry.kloa.merchantName,
              cards: entry.kloa.cards,
              updatedAt: entry.kloa.updatedAt,
              updatedBy: entry.kloa.updatedBy,
              note: entry.kloa.note,
            })
          : null,
        entry.manual
          ? formatSourceSection({
              title: "수동 입력",
              merchantName: entry.manual.merchantName,
              cards: entry.manual.cards,
              updatedAt: entry.manual.updatedAt,
              updatedBy: entry.manual.updatedBy,
              note: entry.manual.note,
            })
          : null,
      ].filter((section): section is string => Boolean(section));

      await interaction.reply({
        content: `${topLines.join("\n")}\n\n${sections.join("\n\n")}`,
        ephemeral: true,
      });
      return;
    }

    const member = interaction.member;
    const hasPermission =
      member &&
      "permissions" in member &&
      typeof member.permissions !== "string" &&
      member.permissions.has(PermissionFlagsBits.ManageGuild);

    if (!hasPermission) {
      await interaction.reply({
        content: "이 명령은 서버 관리 권한이 있는 사람만 사용할 수 있어요.",
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "watch-channel") {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "이 명령은 서버 안에서만 사용할 수 있어요.",
          ephemeral: true,
        });
        return;
      }

      const channel = interaction.options.getChannel("channel", true);
      await setMerchantAlertChannel(interaction.guildId, channel.id);

      await interaction.reply({
        content: `${channel} 채널로 떠돌이상인 카드 알림을 보내도록 설정했어요.`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "watch-role") {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "이 명령은 서버 안에서만 사용할 수 있어요.",
          ephemeral: true,
        });
        return;
      }

      const role = interaction.options.getRole("role");
      await setMerchantAlertRole(interaction.guildId, role?.id);

      await interaction.reply({
        content: role
          ? `${role} 역할을 떠돌이상인 알림 멘션으로 설정했어요.`
          : "떠돌이상인 알림 역할 멘션을 해제했어요.",
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "check") {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "이 명령은 서버 안에서만 사용할 수 있어요.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const config = await getMerchantAlertConfig(interaction.guildId);

      if (!config.channelId) {
        await interaction.editReply(
          "먼저 `/merchant watch-channel`로 알림 채널을 설정해 주세요.",
        );
        return;
      }

      const result = await runMerchantAlertScan(interaction.client, interaction.guildId);

      if (!result.configured) {
        await interaction.editReply(
          "설정된 채널을 찾지 못했어요. `/merchant watch-channel`로 다시 설정해 주세요.",
        );
        return;
      }

      await interaction.editReply(
        result.sentCount > 0
          ? `알림 ${result.sentCount}건을 보냈어요. 매칭 서버: ${result.matchedServers.join(", ")}`
          : "현재 저장된 떠돌이상인 목록에는 감시 카드가 없어요.",
      );
      return;
    }

    if (subcommand === "sync") {
      await interaction.reply({
        content:
          `KLOA 동기화를 시작할게요. 대상 서버: ${PREFERRED_MERCHANT_SERVERS.join(", ")}`,
        ephemeral: true,
      });

      try {
        const result = await syncKloaMerchantData({
          client: interaction.client,
          notifyAlerts: true,
        });
        const rotationWindow =
          result.activeRotationStart && result.activeRotationEnd
            ? `${formatDateTime(result.activeRotationStart)} ~ ${formatDateTime(result.activeRotationEnd)}`
            : result.activeRotationStart
              ? `${formatDateTime(result.activeRotationStart)} 시작`
              : "확인 불가";
        const remainingText = result.activeRotationEnd
          ? formatRemainingDuration(result.activeRotationEnd)
          : null;
        const summaryLineGroups = await Promise.all(
          PREFERRED_MERCHANT_SERVERS.map(async (server) => {
            const entry = await getMerchantServerEntry(server);
            return buildSyncDetailLines(server, entry?.kloa);
          }),
        );
        const summaryLines = summaryLineGroups.flat();
        const broadcastPayload = await buildKloaSyncBroadcastPayload(
          result,
          "떠돌이상인 동기화 완료",
        );

        await interaction.editReply(
          result.syncedServers.length > 0
            ? `KLOA 동기화를 마쳤어요. ${result.syncedServers.join(", ")} 서버를 갱신했고, 현재 회차는 ${rotationWindow} 입니다.\n` +
              `${remainingText ? `남은 시간: ${remainingText}\n` : ""}` +
              `서버별 감지 요약\n${summaryLines.join("\n")}`
            : "지금은 활성 떠돌이상인 회차가 없어서 KLOA 데이터가 비어 있어요.",
        );

        if (interaction.guildId && result.syncedServers.length > 0 && broadcastPayload) {
          const sent = await sendMerchantBroadcastMessage({
            client: interaction.client,
            guildId: interaction.guildId,
            content: broadcastPayload.content,
            embeds: broadcastPayload.embeds,
          });

          if (sent && result.activeRotationStart) {
            await setMerchantBroadcastRotationKey(
              interaction.guildId,
              result.activeRotationStart,
            );
          }

          if (sent && arePreferredServerReportsComplete(result) && result.activeRotationStart) {
            await setMerchantCompleteAnnouncementRotationKey(
              interaction.guildId,
              result.activeRotationStart,
            );
          }
        }
      } catch (error) {
        logError("/merchant sync 실행 중 오류가 발생했습니다.", error);
        await interaction.editReply(
          "KLOA 동기화 중 오류가 났어요. 봇 콘솔 로그를 확인한 뒤 다시 시도해 주세요.",
        );
      }

      return;
    }

    const server = interaction.options.getString("server", true);
    const cardsText = interaction.options.getString("cards", true);
    const merchantName = interaction.options.getString("merchant_name") ?? undefined;
    const note = interaction.options.getString("note") ?? undefined;
    const cards = parseCommaList(cardsText);
    const existingEntry = await getMerchantServerEntry(server);

    if (cards.length === 0) {
      await interaction.reply({
        content: "카드 목록이 비어 있어요. 쉼표로 구분해서 1개 이상 입력해 주세요.",
        ephemeral: true,
      });
      return;
    }

    const listing = await upsertMerchantServer({
      server,
      cards,
      merchantName,
      note,
      updatedBy: interaction.user.tag,
      source: "manual",
      rotationKey: existingEntry?.kloa?.rotationKey,
    });

    if (interaction.guildId) {
      void runMerchantAlertScan(interaction.client, interaction.guildId);
    }

    await interaction.reply({
      content:
        `${listing.server} 서버 수동 카드 목록을 저장했어요.\n` +
        `카드: ${cards.join(", ")}`,
      ephemeral: true,
    });
  },
};
