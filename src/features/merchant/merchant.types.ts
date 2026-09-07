export type MerchantSource = "manual" | "kloa";

export interface MerchantListing {
  server: string;
  merchantName?: string;
  cards: string[];
  note?: string;
  updatedAt: string;
  updatedBy: string;
  source?: MerchantSource;
  rotationKey?: string;
  locations?: string[];
}

export interface MerchantServerEntry {
  server: string;
  manual?: MerchantListing;
  kloa?: MerchantListing;
}

export interface MerchantStore {
  servers: Record<string, MerchantServerEntry>;
}

export interface TrackedCardSet {
  name: string;
  cards: string[];
}

export interface GuildMerchantAlertConfig {
  channelId?: string;
  roleId?: string;
  extraTrackedCards: string[];
  lastNotifiedFingerprints: Record<string, string>;
  lastWeeklyReminderKey?: string;
  lastBroadcastRotationKey?: string;
  lastCompleteAnnouncementRotationKey?: string;
}

export interface MerchantAlertStore {
  guilds: Record<string, GuildMerchantAlertConfig>;
}

export interface MerchantAlertMatch {
  fingerprint: string;
  matchedCards: string[];
  matchedSetNames: string[];
}
