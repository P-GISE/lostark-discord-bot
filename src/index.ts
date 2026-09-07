import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type RepliableInteraction,
} from "discord.js";

import { commandMap } from "./commands";
import { env } from "./config/env";
import { handleAbidosInteraction } from "./features/abidos/abidos.command";
import { startHomeworkReminderPolling } from "./features/homework/homework.service";
import { startKloaMerchantPolling } from "./features/merchant/kloa-merchant.service";
import {
  startWeeklyResetReminderPolling,
} from "./features/merchant/merchant-alert.service";
import { handlePartyRecruitmentInteraction } from "./features/party/party.service";
import { startRosterSyncPolling } from "./features/roster/roster-sync.service";
import { logError, logInfo } from "./utils/logger";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

function isExpectedInteractionReplyError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  const { code } = error as { code?: unknown };
  return code === 10062 || code === 10015 || code === 40060;
}

async function sendSafeErrorReply(
  interaction: RepliableInteraction,
  content: string,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    if (!isExpectedInteractionReplyError(error)) {
      throw error;
    }
  }
}

client.on(Events.Error, (error) => {
  logError("디스코드 클라이언트 오류가 발생했습니다.", error);
});

process.on("unhandledRejection", (reason) => {
  logError("처리되지 않은 비동기 오류가 발생했습니다.", reason);
});

client.once(Events.ClientReady, (readyClient) => {
  logInfo(`${readyClient.user.tag} 봇이 로그인되었습니다.`);
  startKloaMerchantPolling(readyClient);
  startHomeworkReminderPolling(readyClient);
  startWeeklyResetReminderPolling(readyClient);
  startRosterSyncPolling(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (
    (interaction.isButton() || interaction.isModalSubmit()) &&
    interaction.customId.startsWith("abidos:")
  ) {
    try {
      await handleAbidosInteraction(interaction, client);
    } catch (error) {
      logError("아비도스 인터랙션 처리 중 오류가 발생했습니다.", error);
      await sendSafeErrorReply(
        interaction,
        "아비도스 계산 패널 처리 중 오류가 발생했어요.",
      );
    }

    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("party:")) {
    try {
      await handlePartyRecruitmentInteraction(interaction);
    } catch (error) {
      logError("파티모집 인터랙션 처리 중 오류가 발생했습니다.", error);
      await sendSafeErrorReply(
        interaction,
        "파티모집 버튼을 처리하는 중 오류가 발생했어요.",
      );
    }

    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = commandMap.get(interaction.commandName);

  if (!command) {
    await interaction.reply({
      content: "알 수 없는 명령어예요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await command.execute(interaction, client);
  } catch (error) {
    logError(`${interaction.commandName} 명령 실행 중 오류가 발생했습니다.`, error);
    await sendSafeErrorReply(interaction, "명령어 실행 중 오류가 발생했어요.");
  }
});

void client.login(env.discordToken).catch((error) => {
  logError("디스코드 로그인에 실패했습니다.", error);
  process.exit(1);
});
