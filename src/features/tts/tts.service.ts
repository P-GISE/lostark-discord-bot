import { Readable } from "node:stream";
import {
  AudioPlayerStatus, StreamType, VoiceConnectionStatus, createAudioPlayer,
  createAudioResource, entersState, joinVoiceChannel,
  type AudioPlayer, type VoiceConnection,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import { getAllAudioUrls } from "google-tts-api";
import prism from "prism-media";

interface QueueItem { url: string; lang: string }
interface GuildTtsSession {
  connection: VoiceConnection;
  player: AudioPlayer;
  ready: Promise<unknown>;
  connected: boolean;
  queue: QueueItem[];
  processing: boolean;
  closed: boolean;
  controller?: AbortController;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export class TtsRequestError extends Error {}
const sessions = new Map<string, GuildTtsSession>();
const users = new Map<string, number>();
const MAX_GUILDS = 10;
const MAX_GUILD_ITEMS = 20;
const MAX_TOTAL_ITEMS = 100;
const MAX_PLAYING = 2;
let playing = 0;

function disposeSession(guildId: string, session: GuildTtsSession): void {
  if (session.closed) return;
  session.closed = true;
  if (sessions.get(guildId) === session) sessions.delete(guildId);
  session.queue.length = 0;
  clearTimeout(session.idleTimer);
  session.controller?.abort();
  try { session.player.stop(true); } catch { console.warn("TTS player cleanup failed."); }
  try {
    if (session.connection.state?.status !== VoiceConnectionStatus.Destroyed) session.connection.destroy();
  } catch { console.warn("TTS connection cleanup failed."); }
}

function getOrCreateSession(channel: VoiceBasedChannel): GuildTtsSession {
  const existing = sessions.get(channel.guild.id);
  if (existing) {
    if (existing.connection.joinConfig.channelId === channel.id) return existing;
    disposeSession(channel.guild.id, existing);
  }
  if (sessions.size >= MAX_GUILDS) throw new TtsRequestError("사용 중인 음성 채널이 많습니다. 잠시 후 다시 시도해 주세요.");
  const connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false });
  try {
    const player = createAudioPlayer();
    connection.subscribe(player);
    const ready = entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    void ready.catch(() => {});
    const session: GuildTtsSession = { connection, player, ready, connected: false, queue: [], processing: false, closed: false };
    player.on("error", () => session.controller?.abort());
    connection.on("error", () => disposeSession(channel.guild.id, session));
    sessions.set(channel.guild.id, session);
    return session;
  } catch (error) {
    connection.destroy();
    throw error;
  }
}

async function fetchAudio(item: QueueItem, controller: AbortController): Promise<Buffer> {
  const timer = setTimeout(() => controller.abort(), 10_000);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    response = await fetch(item.url, { redirect: "error", signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": item.lang } });
    if (!response.ok || !response.body || !/^audio\/(mpeg|mp3)(?:;|$)/i.test(response.headers.get("content-type") ?? ""))
      throw new Error("Invalid TTS audio response");
    const length = response.headers.get("content-length");
    const limit = 1024 * 1024;
    if (length && /^\d+$/.test(length) && Number(length) > limit) throw new Error("TTS audio too large");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { complete = true; break; }
      size += chunk.value.byteLength;
      if (size > limit) throw new Error("TTS audio too large");
      chunks.push(chunk.value);
    }
    if (!size) throw new Error("Empty TTS audio");
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timer);
    if (!complete) {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
    reader?.releaseLock();
  }
}

async function playQueueItem(session: GuildTtsSession, item: QueueItem): Promise<void> {
  const controller = new AbortController();
  session.controller = controller;
  let input: Readable | undefined;
  let transcoder: InstanceType<typeof prism.FFmpeg> | undefined;
  try {
    const audio = await fetchAudio(item, controller);
    if (controller.signal.aborted || session.closed) throw new Error("TTS cancelled");
    input = Readable.from(audio);
    transcoder = new prism.FFmpeg({ args: [
      "-loglevel", "0", "-nostdin", "-protocol_whitelist", "pipe", "-threads", "1",
      "-i", "pipe:0", "-t", "60", "-f", "s16le", "-ar", "48000", "-ac", "2",
    ] });
    const abort = () => controller.abort();
    input.on("error", abort);
    transcoder.on("error", abort);
    const resource = createAudioResource(input.pipe(transcoder), { inputType: StreamType.Raw });
    session.player.play(resource);
    await entersState(session.player, AudioPlayerStatus.Playing,
      AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
    await entersState(session.player, AudioPlayerStatus.Idle,
      AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]));
  } finally {
    controller.abort();
    if (session.controller === controller) session.controller = undefined;
    try { session.player.stop(true); }
    finally {
      input?.unpipe();
      input?.destroy();
      transcoder?.destroy();
    }
  }
}

function pumpQueues(): void {
  for (const [guildId, session] of sessions) {
    if (playing >= MAX_PLAYING) return;
    if (session.processing || session.closed || !session.connected || !session.queue.length) continue;
    session.processing = true;
    playing++;
    clearTimeout(session.idleTimer);
    void processQueue(guildId, session);
  }
}

async function processQueue(guildId: string, session: GuildTtsSession): Promise<void> {
  try {
    if (!session.closed && session.queue.length) {
      const item = session.queue.shift();
      if (item) await playQueueItem(session, item);
    }
  } catch {
    if (!session.closed) console.warn("TTS playback stopped after an audio error.");
    disposeSession(guildId, session);
  } finally {
    session.processing = false;
    playing--;
    if (!session.closed) {
      if (session.queue.length) {
        sessions.delete(guildId);
        sessions.set(guildId, session);
      } else {
        session.idleTimer = setTimeout(() => disposeSession(guildId, session), 120_000);
        session.idleTimer.unref();
      }
    }
    pumpQueues();
  }
}

export async function queueTts(input: {
  channel: VoiceBasedChannel; userId: string; text: string; lang: string; slow: boolean;
}): Promise<number> {
  const text = input.text.trim();
  if (!text || text.length > 500 || !["ko", "en", "ja"].includes(input.lang) || !/^\d{1,20}$/.test(input.userId))
    throw new TtsRequestError("TTS 입력을 확인해 주세요. 한 번에 500자까지 사용할 수 있습니다.");
  const now = Date.now();
  if ((users.get(input.userId) ?? 0) > now) throw new TtsRequestError("잠시 후 다시 말해 주세요. 사용자별 5초 간격이 필요합니다.");
  if (users.size >= 1000) for (const [user, until] of users) if (until <= now) users.delete(user);
  if (users.size >= 1000 && !users.has(input.userId)) throw new TtsRequestError("요청이 많습니다. 잠시 후 다시 시도해 주세요.");
  users.set(input.userId, now + 5000);
  const chunks = getAllAudioUrls(text, { lang: input.lang, slow: input.slow, splitPunct: ",.!?;:\n" });
  if (!chunks.length || chunks.length > 8) throw new TtsRequestError("한 번에 재생할 음성 조각이 너무 많습니다.");
  const items = chunks.map(chunk => {
    const url = new URL(chunk.url);
    if (url.protocol !== "https:" || url.hostname !== "translate.google.com" || url.port || url.username || url.password || url.pathname !== "/translate_tts")
      throw new TtsRequestError("음성 제공 주소를 확인하지 못했습니다.");
    return { url: url.href, lang: input.lang };
  });
  let total = 0;
  for (const session of sessions.values()) total += session.queue.length + (session.processing ? 1 : 0);
  if (total + items.length > MAX_TOTAL_ITEMS) throw new TtsRequestError("전체 음성 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.");
  const session = getOrCreateSession(input.channel);
  if (session.queue.length + (session.processing ? 1 : 0) + items.length > MAX_GUILD_ITEMS)
    throw new TtsRequestError("서버 음성 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.");
  session.queue.push(...items);
  clearTimeout(session.idleTimer);
  try {
    await session.ready;
    if (session.closed) throw new Error("TTS session closed");
    session.connected = true;
  } catch {
    disposeSession(input.channel.guild.id, session);
    throw new TtsRequestError("음성 채널에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  pumpQueues();
  return chunks.length;
}

export async function leaveTtsChannel(guildId: string): Promise<boolean> {
  const session = sessions.get(guildId);
  if (!session) return false;
  disposeSession(guildId, session);
  return true;
}
