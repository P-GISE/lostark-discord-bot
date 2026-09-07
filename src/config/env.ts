import { config } from "dotenv";

config();

const PLACEHOLDER_PREFIXES = [
  "replace_with_",
  "your_",
];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} 환경 변수가 필요합니다.`);
  }

  if (isPlaceholder(value)) {
    throw new Error(`${name}에 예시값이 들어 있습니다. .env 파일에 실제 값을 넣어주세요.`);
  }

  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  if (!value || isPlaceholder(value)) {
    return undefined;
  }

  return value;
}

export const env = {
  discordToken: requireEnv("DISCORD_TOKEN"),
  discordClientId: requireEnv("DISCORD_CLIENT_ID"),
  discordGuildId: optionalEnv("DISCORD_GUILD_ID"),
};
