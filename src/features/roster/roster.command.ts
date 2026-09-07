import { SlashCommandBuilder } from "discord.js";

import type { SlashCommand } from "../../types/command";
import { logError } from "../../utils/logger";
import { lookupRosterEmbeds } from "./roster.service";

export const rosterCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("roster")
    .setNameLocalizations({
      ko: "원정대",
    })
    .setDescription("캐릭터명으로 원정대 정보를 카드 형태로 조회합니다.")
    .addStringOption((option) =>
      option
        .setName("characters")
        .setNameLocalizations({
          ko: "캐릭터명",
        })
        .setDescription("조회할 캐릭터명, 여러 명이면 쉼표로 구분")
        .setRequired(true),
    ),
  async execute(interaction) {
    const input = interaction.options.getString("characters", true);

    await interaction.deferReply();

    try {
      const result = await lookupRosterEmbeds(input);

      if (result.embeds.length === 0) {
        await interaction.editReply(
          "조회할 캐릭터명을 찾지 못했어요. 캐릭터명 옵션에 이름을 다시 넣어서 시도해주세요.",
        );
        return;
      }

      const lines: string[] = [];

      if (result.notFoundNames.length > 0) {
        lines.push(`찾지 못한 캐릭터: ${result.notFoundNames.join(", ")}`);
      }

      await interaction.editReply({
        content: lines.length > 0 ? lines.join("\n") : undefined,
        embeds: result.embeds,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("TOO_MANY_LOOKUPS:")) {
        const limit = error.message.split(":")[1] ?? "5";

        await interaction.editReply(
          `한 번에 너무 많이 조회하면 카드가 길어져서, 캐릭터는 최대 ${limit}명까지만 같이 볼 수 있어요.`,
        );
        return;
      }

      logError("원정대 정보 조회 중 오류가 발생했습니다.", error);

      await interaction.editReply(
        "원정대 정보를 가져오는 중 오류가 났어요. 잠시 뒤 다시 시도해주세요.",
      );
    }
  },
};
