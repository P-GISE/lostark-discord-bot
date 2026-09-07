export interface GuildHomeworkReminderConfig {
  channelId?: string;
  roleId?: string;
  rosterChannelId?: string;
  lastDailyReminderKey?: string;
  lastWeeklyReminderKey?: string;
}

export interface HomeworkReminderStore {
  guilds: Record<string, GuildHomeworkReminderConfig>;
}

export type HomeworkReminderKind = "daily" | "weekly";
