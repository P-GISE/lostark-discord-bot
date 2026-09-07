import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import type { SlashCommand } from "../../types/command";
import {
  createHomeworkPreviewMessage,
  getHomeworkReminderConfig,
  sendHomeworkReminderToGuild,
  setHomeworkReminderChannel,
  setHomeworkReminderRole,
  setRosterSyncChannel,
} from "./homework.service";
import type { HomeworkReminderKind } from "./homework.types";

function hasManageGuildPermission(
  interaction: Parameters<SlashCommand["execute"]>[0],
): boolean {
  const member = interaction.member;

  return Boolean(
    member &&
      "permissions" in member &&
      typeof member.permissions !== "string" &&
      member.permissions.has(PermissionFlagsBits.ManageGuild),
  );
}

function formatRosterChannelStatus(config: {
  rosterChannelId?: string;
  channelId?: string;
}): string {
  if (config.rosterChannelId) {
    return `<#${config.rosterChannelId}>`;
  }

  if (config.channelId) {
    return `미설정 (현재 <#${config.channelId}> 사용)`;
  }

  return "미설정";
}

export const homeworkCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("homework")
    .setNameLocalizations({
      ko: "숙제",
    })
    .setDescription("로스트아크 숙제 알림 설정을 관리합니다.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("channel")
        .setNameLocalizations({
          ko: "채널",
        })
        .setDescription("숙제 알림을 보낼 채널을 설정합니다.")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setNameLocalizations({
              ko: "채널",
            })
            .setDescription("숙제 알림을 보낼 텍스트 채널")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("role")
        .setNameLocalizations({
          ko: "역할",
        })
        .setDescription("숙제 알림에서 멘션할 역할을 설정하거나 해제합니다.")
        .addRoleOption((option) =>
          option
            .setName("role")
            .setNameLocalizations({
              ko: "역할",
            })
            .setDescription("멘션할 역할")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("roster-channel")
        .setNameLocalizations({
          ko: "원정대채널",
        })
        .setDescription("원정대 자동 동기화를 보낼 채널을 따로 설정하거나 해제합니다.")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setNameLocalizations({
              ko: "채널",
            })
            .setDescription("원정대 자동 동기화를 보낼 텍스트 채널")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setNameLocalizations({
          ko: "상태",
        })
        .setDescription("현재 숙제 알림 설정을 확인합니다."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preview")
        .setNameLocalizations({
          ko: "미리보기",
        })
        .setDescription("숙제 알림 미리보기를 확인합니다.")
        .addStringOption((option) =>
          option
            .setName("type")
            .setNameLocalizations({
              ko: "종류",
            })
            .setDescription("미리 볼 알림 종류")
            .addChoices(
              { name: "일일 숙제", value: "daily" },
              { name: "주간 초기화", value: "weekly" },
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("send")
        .setNameLocalizations({
          ko: "테스트발송",
        })
        .setDescription("설정된 채널로 숙제 알림을 바로 한 번 보냅니다.")
        .addStringOption((option) =>
          option
            .setName("type")
            .setNameLocalizations({
              ko: "종류",
            })
            .setDescription("보낼 알림 종류")
            .addChoices(
              { name: "일일 숙제", value: "daily" },
              { name: "주간 초기화", value: "weekly" },
            )
            .setRequired(true),
        ),
    ),
  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "status") {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "이 명령어는 서버 안에서만 사용할 수 있어요.",
          ephemeral: true,
        });
        return;
      }

      const config = await getHomeworkReminderConfig(interaction.guildId);

      await interaction.reply({
        content: [
          "현재 숙제 알림 설정입니다.",
          `숙제 알림 채널: ${config.channelId ? `<#${config.channelId}>` : "미설정"}`,
          `멘션 역할: ${config.roleId ? `<@&${config.roleId}>` : "미설정"}`,
          `원정대 자동동기화 채널: ${formatRosterChannelStatus(config)}`,
          "일일 알림: 매일 오전 8시 / 오후 8시",
          "주간 알림: 수요일 오전 8시 / 오후 8시",
          "원정대 자동동기화: 매일 오전 8시 이후 하루 1회",
          "정리 정책: 떠상 / 원정대 / 숙제 알림은 새 전송 전에 이전 봇 메시지를 먼저 지웁니다.",
        ].join("\n"),
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "preview") {
      const kind = interaction.options.getString("type", true) as HomeworkReminderKind;

      await interaction.reply({
        ...(await createHomeworkPreviewMessage(kind)),
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: "이 명령어는 서버 안에서만 사용할 수 있어요.",
        ephemeral: true,
      });
      return;
    }

    if (!hasManageGuildPermission(interaction)) {
      await interaction.reply({
        content: "이 명령어는 서버 관리 권한이 있는 멤버만 사용할 수 있어요.",
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "channel") {
      const channel = interaction.options.getChannel("channel", true);
      await setHomeworkReminderChannel(interaction.guildId, channel.id);

      await interaction.reply({
        content: `${channel} 채널로 숙제 알림을 보내도록 설정했어요.`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "role") {
      const role = interaction.options.getRole("role");
      await setHomeworkReminderRole(interaction.guildId, role?.id);

      await interaction.reply({
        content: role
          ? `${role} 역할을 숙제 알림 멘션으로 설정했어요.`
          : "숙제 알림 멘션 역할을 해제했어요.",
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "roster-channel") {
      const channel = interaction.options.getChannel("channel");
      await setRosterSyncChannel(interaction.guildId, channel?.id);

      await interaction.reply({
        content: channel
          ? `${channel} 채널로 원정대 자동동기화를 보내도록 설정했어요.`
          : "원정대 자동동기화 전용 채널 설정을 해제했어요. 이제 숙제 알림 채널을 같이 사용합니다.",
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "send") {
      const kind = interaction.options.getString("type", true) as HomeworkReminderKind;
      const sent = await sendHomeworkReminderToGuild({
        client,
        guildId: interaction.guildId,
        kind,
      });

      await interaction.reply({
        content: sent
          ? "설정된 채널로 숙제 알림을 보냈어요."
          : "먼저 `/숙제 채널`로 알림 채널을 설정해주세요.",
        ephemeral: true,
      });
    }
  },
};

