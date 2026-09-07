import { REST, Routes } from "discord.js";

import { commandPayload } from "./commands";
import { env } from "./config/env";

async function main(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(env.discordToken);

  if (env.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId),
      { body: commandPayload },
    );

    console.log(`길드 명령어 ${commandPayload.length}개를 배포했습니다.`);
    return;
  }

  await rest.put(Routes.applicationCommands(env.discordClientId), {
    body: commandPayload,
  });

  console.log(`전역 명령어 ${commandPayload.length}개를 배포했습니다.`);
}

void main().catch((error) => {
  console.error("명령어 배포에 실패했습니다.");
  console.error(error);
  process.exit(1);
});
