# TTS resource boundaries

This is the standalone P-GISE/lostark-discord-bot repository. It is separate from the bot source bundled in FocusAI and does not migrate or redeploy that copy.

The authenticated interaction user ID now enters the shared TTS service, where input is revalidated (1–500 characters, supported ko/en/ja language). One user has a5-second cooldown across guilds, with at most1000 expiring user counters. A request yields at most8 audio chunks; a guild holds at most20 chunks including current work, the process100 in total, and at most10 guild voice sessions. At most2 guild chunks are fetched/transcoded/played concurrently. Ready guilds take turns between chunks. A new request is rejected promptly rather than added to an unbounded queue. Idle voice sessions close after2minutes. These are process-local limits; multiple replicas require shared admission control and must not each be treated as one global budget.

TTS uses only the library-generated HTTPS translate.google.com/translate_tts address, rejects redirects and caps each response at1MiB while reading, with a10-second timeout. The reader is cancelled on failure or leave. Only expected MPEG audio is accepted. FFmpeg has one decode thread, pipe-only protocols and at most60seconds output; playing/idle transitions have10/60second deadlines tied to the leave/cancellation signal. Every exit stops the player and destroys input/transcoder streams. Installed prism-media's FFmpeg.destroy cleanup kills its child process. Audio/connection errors are handled without logging speech text, generated URLs, credentials or raw provider exceptions. A failure closes that session and releases queued work.

The command sends fixed user-facing limit/connection messages. Existing500-character command checking remains, and service validation also protects future internal callers. User data/configuration files and registration/deployment settings are unchanged.

## Verification

VM tests transpile the actual service and replace only Discord/voice/Google URL generation/FFmpeg/fetch boundaries with synthetic adapters. They first reproduce missing cooldown, unbounded guild queue, and missing abort/stream cleanup (RED3), then check7 scenarios: cooldown; guild/global playback bounds; leave cleanup; oversized body/timeout; readiness isolation; total queue/guild bounds; inter-guild fairness. TypeScript production build passes.

No Discord connection, command registration, real TTS request, live FFmpeg process or deployment is executed. The destroy-to-child-kill contract was read in the installed prism-media source; native binary CVEs and production audio/device behavior are not certified by the mocked tests. Existing missing @emnapi lock entries that prevented npm ci were synchronized through compatible lock resolution. npm audit and cached Trivy --include-dev-deps for the final lock are0; this does not prove the whole application or native FFmpeg is vulnerability-free.

## Release and rollback

Release only after independent code review and configured CI. npm test and npm run build need no bot token. This source PR does not add paid resources, change .github automation or start/stop the live bot. A bot restart for deployment would discard process-local queued speech; no persisted guild/configuration data format changes. If needed restore the previous verified code/image and lock; that reintroduces the old unbounded-resource behavior. No Discord permissions or existing guild data must be deleted for rollback.
