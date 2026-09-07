import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  Client,
  GuildBasedChannel,
  MessageCreateOptions,
  SendableChannels,
} from "discord.js";

const DATA_PATH = path.join(process.cwd(), "data", "tracked-channel-messages.json");

export type TrackedChannelMessageKind =
  | "homework-daily"
  | "homework-weekly"
  | "merchant-broadcast"
  | "roster-sync";

export type ManagedNotificationChannel = GuildBasedChannel &
  SendableChannels & {
    messages: {
      fetch(
        input?: string | { limit: number },
      ): Promise<{
        delete(): Promise<unknown>;
      } | Iterable<TrackedMessageLike> | null>;
    };
  };

export type TrackedMessageLike = {
  id: string;
  content: string;
  author?: {
    bot?: boolean;
  };
  embeds?: Array<{
    title?: string | null;
    description?: string | null;
    footer?: {
      text?: string | null;
    } | null;
  }>;
  delete(): Promise<unknown>;
};

export type LegacyTrackedMessageMatcher = (message: TrackedMessageLike) => boolean;

type RecentMessageFetchItem = TrackedMessageLike | [string, TrackedMessageLike];

type TrackedChannelMessageEntry = {
  channelId: string;
  messageIds: string[];
};

type TrackedChannelMessageStore = {
  guilds: Record<
    string,
    Partial<Record<TrackedChannelMessageKind, TrackedChannelMessageEntry>>
  >;
};

let trackedMessageStoreQueue: Promise<void> = Promise.resolve();

function isManagedNotificationChannel(
  channel: GuildBasedChannel | null,
): channel is ManagedNotificationChannel {
  return Boolean(
    channel &&
      channel.isTextBased() &&
      channel.isSendable() &&
      "messages" in channel &&
      channel.messages &&
      typeof channel.messages.fetch === "function",
  );
}

async function ensureStoreFile(): Promise<void> {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });

  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    const emptyStore: TrackedChannelMessageStore = { guilds: {} };
    await writeFile(DATA_PATH, JSON.stringify(emptyStore, null, 2), "utf-8");
  }
}

async function readStore(): Promise<TrackedChannelMessageStore> {
  await ensureStoreFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  return JSON.parse(raw) as TrackedChannelMessageStore;
}

async function writeStore(store: TrackedChannelMessageStore): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
}

async function withStoreQueue<T>(operation: () => Promise<T>): Promise<T> {
  const previous = trackedMessageStoreQueue;
  let releaseQueue: (() => void) | undefined;

  trackedMessageStoreQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous;

  try {
    return await operation();
  } finally {
    releaseQueue?.();
  }
}

async function deleteTrackedMessages(
  client: Client,
  entry?: TrackedChannelMessageEntry,
): Promise<void> {
  if (!entry || entry.messageIds.length === 0) {
    return;
  }

  const channel = (await client.channels.fetch(entry.channelId).catch(() => null)) as
    | GuildBasedChannel
    | null;

  if (!isManagedNotificationChannel(channel)) {
    return;
  }

  for (const messageId of entry.messageIds) {
    const message = await channel.messages.fetch(messageId).catch(() => null);

    if (!message) {
      continue;
    }

    await message.delete().catch(() => null);
  }
}

export async function clearTrackedChannelMessages(input: {
  client: Client;
  guildId: string;
  kind: TrackedChannelMessageKind;
}): Promise<void> {
  await withStoreQueue(async () => {
    const store = await readStore();
    const guildEntries = store.guilds[input.guildId] ?? {};
    const previousEntry = guildEntries[input.kind];

    if (!previousEntry) {
      return;
    }

    await deleteTrackedMessages(input.client, previousEntry);
    delete guildEntries[input.kind];

    store.guilds[input.guildId] = guildEntries;
    await writeStore(store);
  });
}

async function deleteLegacyTrackedMessages(
  channel: ManagedNotificationChannel,
  matcher: LegacyTrackedMessageMatcher,
  keepMessageIds: string[] = [],
): Promise<void> {
  const recentMessages = await channel.messages.fetch({ limit: 20 }).catch(() => null);

  if (!recentMessages || typeof recentMessages[Symbol.iterator] !== "function") {
    return;
  }

  for (const item of recentMessages as Iterable<RecentMessageFetchItem>) {
    const message = Array.isArray(item) ? item[1] : item;

    if (
      !message.author?.bot ||
      keepMessageIds.includes(message.id) ||
      !matcher(message)
    ) {
      continue;
    }

    await message.delete().catch(() => null);
  }
}

export async function replaceTrackedChannelMessages(input: {
  client: Client;
  guildId: string;
  kind: TrackedChannelMessageKind;
  channel: ManagedNotificationChannel;
  messages: MessageCreateOptions[];
  legacyMatcher?: LegacyTrackedMessageMatcher;
}): Promise<string[]> {
  return withStoreQueue(async () => {
    const currentStore = await readStore();
    const previousEntry = currentStore.guilds[input.guildId]?.[input.kind];

    if (previousEntry) {
      await deleteTrackedMessages(input.client, previousEntry);
    }

    if (input.legacyMatcher) {
      await deleteLegacyTrackedMessages(input.channel, input.legacyMatcher);
    }

    const sentMessageIds: string[] = [];

    for (const messageInput of input.messages) {
      const sentMessage = await input.channel.send(messageInput);
      sentMessageIds.push(sentMessage.id);
    }

    if (input.legacyMatcher) {
      await deleteLegacyTrackedMessages(
        input.channel,
        input.legacyMatcher,
        sentMessageIds,
      );
    }

    const latestStore = await readStore();
    const guildEntries = latestStore.guilds[input.guildId] ?? {};

    guildEntries[input.kind] = {
      channelId: input.channel.id,
      messageIds: sentMessageIds,
    };

    latestStore.guilds[input.guildId] = guildEntries;
    await writeStore(latestStore);

    return sentMessageIds;
  });
}
