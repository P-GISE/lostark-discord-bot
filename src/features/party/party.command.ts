import { SlashCommandBuilder } from "discord.js";

import type { SlashCommand } from "../../types/command";
import { createPartyPanelMessage } from "./party.service";

export const partyRecruitmentCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("party")
    .setNameLocalizations({
      ko: "파티모집",
    })
    .setDescription("파티모집 버튼 패널을 생성합니다.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("panel")
        .setNameLocalizations({
          ko: "패널",
        })
        .setDescription("파티모집 버튼 패널을 생성합니다."),
    ),
  async execute(interaction) {
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({
        content: "이 명령어는 서버 텍스트 채널에서만 사용할 수 있어요.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply(createPartyPanelMessage());
  },
};

