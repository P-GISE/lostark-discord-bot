import { Readable } from "node:stream";

import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import { getAllAudioUrls } from "google-tts-api";
import prism from "prism-media";

interface QueueItem {
  url: string;
  text: string;
  lang: string;
}

interface GuildTtsSession {
  connection: VoiceConnection;
  player: AudioPlayer;
  queue: QueueItem[];
  processing: boolean;
}

const sessions = new Map<string, GuildTtsSession>();

function getOrCreateSession(channel: VoiceBasedChannel): GuildTtsSession {
  const existing = sessions.get(channel.guild.id);

  if (existing) {
    const currentChannelId = existing.connection.joinConfig.channelId;

    if (currentChannelId !== channel.id) {
      existing.connection.destroy();
      sessions.delete(channel.guild.id);
    } else {
      return existing;
    }
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  const player = createAudioPlayer();
  connection.subscribe(player);

  const session: GuildTtsSession = {
    connection,
    player,
    queue: [],
    processing: false,
  };

  sessions.set(channel.guild.id, session);
  return session;
}

async function waitForConnectionReady(connection: VoiceConnection): Promise<void> {
  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
}

async function playQueueItem(
  session: GuildTtsSession,
  item: QueueItem,
): Promise<void> {
  const response = await fetch(item.url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": item.lang,
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`TTS 오디오를 가져오지 못했습니다. (${response.status})`);
  }

  const inputStream = Readable.fromWeb(response.body as any);
  const transcoder = new prism.FFmpeg({
    args: [
      "-loglevel",
      "0",
      "-i",
      "pipe:0",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
    ],
  });

  const audioStream = inputStream.pipe(transcoder);
  const resource = createAudioResource(audioStream, {
    inputType: StreamType.Raw,
    metadata: {
      text: item.text,
    },
  });

  session.player.play(resource);
  await entersState(session.player, AudioPlayerStatus.Playing, 10_000);
  await entersState(session.player, AudioPlayerStatus.Idle, 60_000);
}

async function processQueue(guildId: string): Promise<void> {
  const session = sessions.get(guildId);

  if (!session || session.processing) {
    return;
  }

  session.processing = true;

  try {
    while (session.queue.length > 0) {
      const item = session.queue.shift();

      if (!item) {
        continue;
      }

      await playQueueItem(session, item);
    }
  } finally {
    session.processing = false;
  }
}

export async function queueTts(input: {
  channel: VoiceBasedChannel;
  text: string;
  lang: string;
  slow: boolean;
}): Promise<number> {
  const session = getOrCreateSession(input.channel);
  await waitForConnectionReady(session.connection);

  const chunks = getAllAudioUrls(input.text, {
    lang: input.lang,
    slow: input.slow,
    splitPunct: ",.!?;:\n",
  });

  for (const chunk of chunks) {
    session.queue.push({
      url: chunk.url,
      text: chunk.shortText,
      lang: input.lang,
    });
  }

  void processQueue(input.channel.guild.id);
  return chunks.length;
}

export async function leaveTtsChannel(guildId: string): Promise<boolean> {
  const session = sessions.get(guildId);

  if (!session) {
    return false;
  }

  session.queue.length = 0;
  session.player.stop(true);
  session.connection.destroy();
  sessions.delete(guildId);
  return true;
}
