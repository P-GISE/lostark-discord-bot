import { SlashCommandBuilder } from "discord.js";

import type { SlashCommand } from "../types/command";

export const pingCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setNameLocalizations({
      ko: "핑",
    })
    .setDescription("봇이 정상적으로 응답하는지 확인합니다."),
  async execute(interaction) {
    await interaction.reply({
      content: `Pong! 현재 지연 시간: ${interaction.client.ws.ping}ms`,
      ephemeral: true,
    });
  },
};
