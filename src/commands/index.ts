import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";

import { abidosCommand } from "../features/abidos/abidos.command";
import { homeworkCommand } from "../features/homework/homework.command";
import { merchantCommand } from "../features/merchant/merchant.command";
import { partyRecruitmentCommand } from "../features/party/party.command";
import { rosterCommand } from "../features/roster/roster.command";
import { ttsCommand } from "../features/tts/tts.command";
import type { SlashCommand } from "../types/command";
import { pingCommand } from "./ping";

export const commands: SlashCommand[] = [
  pingCommand,
  abidosCommand,
  homeworkCommand,
  merchantCommand,
  partyRecruitmentCommand,
  rosterCommand,
  ttsCommand,
];

export const commandMap = new Map(
  commands.map((command) => [command.data.name, command]),
);

export const commandPayload = commands.map(
  (command) => command.data.toJSON() as RESTPostAPIApplicationCommandsJSONBody,
);
