import { SlashCommandBuilder } from "discord.js";

import type { SlashCommand } from "../../types/command";
import { leaveTtsChannel, queueTts } from "./tts.service";

const MAX_TTS_LENGTH = 500;

export const ttsCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("tts")
    .setNameLocalizations({
      ko: "음성",
    })
    .setDescription("음성 채널에서 TTS를 재생합니다.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("speak")
        .setNameLocalizations({
          ko: "말하기",
        })
        .setDescription("현재 참가 중인 음성 채널에서 TTS를 재생합니다.")
        .addStringOption((option) =>
          option
            .setName("text")
            .setNameLocalizations({
              ko: "내용",
            })
            .setDescription("읽어줄 문장")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("lang")
            .setNameLocalizations({
              ko: "언어",
            })
            .setDescription("TTS 언어")
            .addChoices(
              { name: "한국어", value: "ko" },
              { name: "English", value: "en" },
              { name: "日本語", value: "ja" },
            )
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName("slow")
            .setNameLocalizations({
              ko: "천천히",
            })
            .setDescription("천천히 읽기")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("leave")
        .setNameLocalizations({
          ko: "나가기",
        })
        .setDescription("봇을 음성 채널에서 내보냅니다."),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "TTS 기능은 서버 안에서만 사용할 수 있어요.",
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "leave") {
      const left = await leaveTtsChannel(interaction.guild.id);

      await interaction.reply({
        content: left ? "음성 채널에서 나왔어요." : "현재 들어가 있는 음성 채널이 없어요.",
        ephemeral: true,
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: "먼저 일반 음성 채널에 들어가 주세요.",
        ephemeral: true,
      });
      return;
    }

    const text = interaction.options.getString("text", true).trim();
    const lang = interaction.options.getString("lang") ?? "ko";
    const slow = interaction.options.getBoolean("slow") ?? false;

    if (text.length === 0) {
      await interaction.reply({
        content: "읽어줄 문장을 입력해 주세요.",
        ephemeral: true,
      });
      return;
    }

    if (text.length > MAX_TTS_LENGTH) {
      await interaction.reply({
        content: `한 번에 ${MAX_TTS_LENGTH}자 이하만 읽을 수 있어요.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const chunks = await queueTts({
      channel: voiceChannel,
      text,
      lang,
      slow,
    });

    await interaction.editReply(
      `TTS를 대기열에 넣었어요. ${chunks}개 조각으로 재생합니다.`,
    );
  },
};
