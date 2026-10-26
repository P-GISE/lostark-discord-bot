const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { Transform } = require('node:stream')
const ts = require('typescript')

function loadTts(options = {}) {
    const stats = { fetches: 0, joins: 0, destroyed: 0, connectionsDestroyed: 0, idle: [], ready: [], transcoders: [], languages: [] }
    const voice = {
        AudioPlayerStatus: { Playing: 'playing', Idle: 'idle' }, StreamType: { Raw: 'raw' },
        VoiceConnectionStatus: { Ready: 'ready', Destroyed: 'destroyed' },
        joinVoiceChannel(input) { stats.joins++; return { joinConfig: input, subscribe() {}, destroy() { stats.connectionsDestroyed++ }, on() {} } },
        createAudioPlayer() { return { play() {}, stop() {}, on() {} } },
        createAudioResource(stream) { return stream },
        entersState(target, state, timeout) {
            if (state === 'ready' && target.joinConfig.guildId === options.holdGuild) return new Promise(resolve => stats.ready.push(resolve))
            if (state !== 'idle') return Promise.resolve()
            return new Promise((resolve, reject) => {
                stats.idle.push(resolve)
                if (typeof timeout === 'object') {
                    if (timeout.aborted) reject(Error('aborted'))
                    else timeout.addEventListener('abort', () => reject(Error('aborted')), { once: true })
                }
            })
        }
    }
    class FFmpeg extends Transform {
        constructor(options) { super(); stats.transcoders.push(options) }
        _transform(chunk, encoding, done) { this.push(chunk); done() }
        _destroy(error, done) { stats.destroyed++; done(error) }
    }
    const compiled = ts.transpileModule(fs.readFileSync('src/features/tts/tts.service.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText
    const module = { exports: {} }
    new vm.Script(compiled).runInNewContext({
        module, exports: module.exports, Buffer, URL, AbortController, AbortSignal, clearTimeout, Date,
        setTimeout: (fn, ms) => setTimeout(fn, options.fastTimeouts && ms === 10000 ? 5 : ms),
        console: { warn() {} },
        fetch: async (url, request) => { stats.fetches++; stats.languages.push(request.headers['Accept-Language']); stats.signal = request.signal; return options.response ? options.response(stats, request) : new Response('synthetic audio', { headers: { 'content-type': 'audio/mpeg' } }) },
        require(name) {
            if (name === '@discordjs/voice') return voice
            if (name === 'google-tts-api') return { getAllAudioUrls: text => [{ url: 'https://translate.google.com/translate_tts?synthetic=1', shortText: text }] }
            if (name === 'prism-media') return { FFmpeg }
            return require(name)
        }
    })
    const service = module.exports
    return { service, stats, async close(guilds = ['1']) { for (const guild of guilds) await service.leaveTtsChannel(guild); for (const resolve of stats.idle) resolve(); await new Promise(resolve => setImmediate(resolve)) } }
}

function input(userId = '1', guild = '1') {
    return { channel: { id: 'voice-' + guild, guild: { id: guild, voiceAdapterCreator() {} } }, userId, text: 'synthetic', lang: 'ko', slow: false }
}
async function settle() { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }

test('one member cannot bypass the TTS cooldown with repeated commands', async () => {
    const tts = loadTts()
    try {
        await tts.service.queueTts(input())
        await assert.rejects(tts.service.queueTts(input()), /잠시|cooldown/i)
    } finally { await tts.close() }
})

test('guild pending work and global playback are bounded', async () => {
    const tts = loadTts()
    try {
        for (let i = 0; i < 20; i++) await tts.service.queueTts(input(String(i)))
        await assert.rejects(tts.service.queueTts(input('99')), /대기열|queue/i)
    } finally { await tts.close() }
    const parallel = loadTts()
    try {
        for (const guild of ['1', '2', '3']) await parallel.service.queueTts(input(guild, guild))
        await settle()
        assert.equal(parallel.stats.fetches, 2)
    } finally { await parallel.close(['1', '2', '3']) }
})

test('leaving playback aborts network state and destroys the FFmpeg stream', async () => {
    const tts = loadTts()
    try {
        await tts.service.queueTts(input())
        await settle()
        assert.equal(tts.stats.transcoders.length, 1)
        await tts.service.leaveTtsChannel('1')
        await settle()
        assert.equal(tts.stats.signal.aborted, true)
        assert.equal(tts.stats.destroyed, 1)
        assert.equal(tts.stats.connectionsDestroyed, 1)
    } finally { await tts.close() }
})

test('oversized audio is cancelled before FFmpeg starts and timeouts are handled', async () => {
    let cancelled = false
    const tts = loadTts({ response: () => {
        let chunks = 0
        return new Response(new ReadableStream({
            pull(controller) { if (++chunks <= 4) controller.enqueue(new Uint8Array(512 * 1024)); else controller.close() },
            cancel() { cancelled = true }
        }), { headers: { 'content-type': 'audio/mpeg' } })
    } })
    try {
        await tts.service.queueTts(input())
        await settle()
        assert.equal(cancelled, true)
        assert.equal(tts.stats.transcoders.length, 0)
        assert.equal(await tts.service.leaveTtsChannel('1'), false)
    } finally { await tts.close() }
    const timeout = loadTts({ fastTimeouts: true, response: (stats, request) => new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })) })
    try {
        await timeout.service.queueTts(input())
        await new Promise(resolve => setTimeout(resolve, 20))
        assert.equal(timeout.stats.signal.aborted, true)
        assert.equal(await timeout.service.leaveTtsChannel('1'), false)
    } finally { await timeout.close() }
})

test('one ready guild cannot start another guild before its connection is ready', async () => {
    const tts = loadTts({ holdGuild: '2' })
    try {
        const waiting = tts.service.queueTts(input('2', '2'))
        await tts.service.queueTts(input('1', '1'))
        await settle()
        assert.equal(tts.stats.fetches, 1)
        tts.stats.ready[0]()
        await waiting
        await settle()
        assert.equal(tts.stats.fetches, 2)
    } finally { await tts.close(['1', '2']) }
})

test('global queue and guild connection counts cannot grow without a bound', async () => {
    const tts = loadTts()
    try {
        for (let guild = 1; guild <= 5; guild++)
            for (let i = 0; i < 20; i++) await tts.service.queueTts(input(String(guild * 100 + i), String(guild)))
        await assert.rejects(tts.service.queueTts(input('9999', '6')), /전체.*대기열/)
        assert.equal(tts.stats.joins, 5)
    } finally { await tts.close(['1', '2', '3', '4', '5', '6']) }
    const guilds = loadTts()
    try {
        for (let i = 1; i <= 10; i++) await guilds.service.queueTts(input(String(i), String(i)))
        await assert.rejects(guilds.service.queueTts(input('99', '11')), /채널.*많/)
        assert.equal(guilds.stats.joins, 10)
    } finally { await guilds.close(Array.from({ length: 11 }, (_, i) => String(i + 1))) }
})

test('ready guilds get a playback turn before one guild drains its complete queue', async () => {
    const tts = loadTts()
    try {
        await tts.service.queueTts(input('1', '1'))
        await tts.service.queueTts(input('11', '1'))
        await tts.service.queueTts({ ...input('2', '2'), lang: 'en' })
        await tts.service.queueTts({ ...input('3', '3'), lang: 'ja' })
        await settle()
        assert.equal(tts.stats.fetches, 2)
        tts.stats.idle[0]()
        await settle()
        assert.equal(tts.stats.languages[2], 'ja')
    } finally { await tts.close(['1', '2', '3']) }
})

test('new work cancels the old idle deadline while all playback slots are busy', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    const tts = loadTts()
    try {
        await tts.service.queueTts(input('1', '1'))
        await settle()
        tts.stats.idle[0]()
        await settle()
        t.mock.timers.tick(119_000)
        for (const guild of ['2', '3']) await tts.service.queueTts({ ...input(guild, guild), lang: 'en' })
        await settle()
        await tts.service.queueTts({ ...input('4', '1'), lang: 'ja' })
        assert.equal(tts.stats.fetches, 3)
        t.mock.timers.tick(1_001)
        await settle()
        assert.equal(tts.stats.connectionsDestroyed, 0)
        tts.stats.idle[1]()
        await settle()
        assert.equal(tts.stats.fetches, 4)
        assert.equal(tts.stats.languages[3], 'ja')
        tts.stats.idle[2]()
        tts.stats.idle[3]()
        await settle()
        t.mock.timers.tick(119_999)
        assert.equal(tts.stats.connectionsDestroyed, 0)
        t.mock.timers.tick(1)
        assert.equal(tts.stats.connectionsDestroyed, 3)
        assert.equal(await tts.service.leaveTtsChannel('1'), false)
    } finally { await tts.close(['1', '2', '3']) }
})
