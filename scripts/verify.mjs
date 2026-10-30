#!/usr/bin/env bun
/**
 * Independent HTTP/SSR verification for the reduced, private balance panel.
 *
 * Scope of this build: the dashboard only. No provider detail pages, no usage
 * insights, no settings page, no HTTP JSON API. Account identifiers are masked
 * server-side.
 * The legacy brand token must not appear anywhere user-visible or in the
 * shipped build/docs.
 *
 * Boots the Bun/furin build (.furin/build/bun/server.js) on 127.0.0.1:3210 in
 * fixture mode, runs the acceptance checks, always kills its child, and exits
 * non-zero on any FAIL-level assertion. A temporary Bun server on 3211 proves
 * .env auto-loading without touching the main server. Isolated live-relay probes
 * run on 3212/3213/3214 with their own mock upstream (C28/C29/C40).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOST = '127.0.0.1'
const PORT = Number(process.env.VERIFY_PORT || 3210)
const TEMP_PORT = Number(process.env.VERIFY_ENV_PORT || 3211)
const BASE = 'http://' + HOST + ':' + PORT
const TEMP_BASE = 'http://' + HOST + ':' + TEMP_PORT
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const HTML_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
const SENTINEL_SECRET = 'verify-sentinel-balance-6f4c2b9d'
const ENV_SENTINEL_SECRET = 'verify-env-balance-7c1d2e'
const MOCK_RELAY_KEY = 'sk-relay-test-key-verify-123'
// Constructed so this verifier does not embed the retired env-var spelling it
// is required to prove absent from docs/source/build.
const LEGACY_AUTH_ENV = 'BALANCE_API_' + 'TOKEN'
const LIVE_PORT = Number(process.env.VERIFY_LIVE_PORT || 3212)
const MISSING_KEY_PORT = Number(process.env.VERIFY_NO_KEY_PORT || 3213)
// C40：余额缓存 TTL 过期后，ISR loader 必须等上游刷新而不是立刻返回旧数据。用独立
// 端口起一个自己的 mock 上游，避免与 C28/C29 的请求计数互相污染。
const REFRESH_PORT = Number(process.env.VERIFY_REFRESH_PORT || 3214)
const LIVE_BASE = 'http://' + HOST + ':' + LIVE_PORT
const MISSING_KEY_BASE = 'http://' + HOST + ':' + MISSING_KEY_PORT
const REFRESH_BASE = 'http://' + HOST + ':' + REFRESH_PORT
const BUILD_DIR = path.join(ROOT, '.furin', 'build')
const BUILD_TARGET_DIR = path.join(BUILD_DIR, 'bun')
const CLIENT_DIR = path.join(BUILD_TARGET_DIR, 'client')
const BUILD_MANIFEST = path.join(BUILD_DIR, 'manifest.json')
const SERVER_ENTRY = path.join(BUILD_TARGET_DIR, 'server.js')
const ENV_FILE_PATH = path.join(ROOT, '.env')
// Snapshot the real user .env only in memory; it must never be written by this suite.
const INITIAL_ENV = existsSync(ENV_FILE_PATH) ? readFileSync(ENV_FILE_PATH) : null
const BUN_BIN = process.versions.bun ? process.execPath : process.env.BUN_BIN || 'bun'
// Built from char codes so this verifier does not itself contain the legacy
// brand token it is required to scrub (the report/docs are scanned too).
const FORBIDDEN_BRAND = String.fromCharCode(109, 97, 103, 112, 105, 101)
const OLD_THEME_KEY = FORBIDDEN_BRAND + ':theme:v1'
const OLD_LIB_DIR = 'src/lib/' + FORBIDDEN_BRAND
const OLD_SERVER_FILE = 'src/server/' + FORBIDDEN_BRAND + '.server.ts'
const API_PROBE = '/api/' + FORBIDDEN_BRAND + '/summary'
const RAW_IDENTIFIERS = [
  'li' + 'tyouyou',
  'myxiaoyouyou' + '@gmail.com',
  'xiao.youyou' + '@outlook.com',
  '130' + '****0136',
]
const REDACTED_USER = '***'
const FORBIDDEN_USER_FRAGMENTS = [
  'li***ou',
  'my***@g***.com',
  'xi***@o***.com',
  '130****',
  '****0136',
  '0136',
  'gmail.com',
  'outlook.com',
]
const HERO_H1 = '每一份渴望，都值得被回应。'
const HERO_PARAGRAPHS = [
  '欢迎来到忧忧的秘密房间。',
  '这里不需要掩饰你的好奇，也不必对自己的欲望感到羞耻。',
  '无论你渴望的是更强大的算力、更聪明的灵魂，还是一个能彻夜回应你所有问题的存在……',
  '忧忧都会为你打开通往异世界的大门。',
]
const HERO_CALLOUT = '来吧，靠近一点。'
const HERO_CLOSING = '契约已经备好，只差你最后的确认。'
const LEGACY_HERO_TITLE = '订阅余额总览'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function headersToObject(headers) {
  const object = {}
  headers.forEach((value, key) => {
    object[key] = value
  })
  return object
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function filteredCountText(html) {
  const markerIndex = html.indexOf('data-filtered-count')
  if (markerIndex === -1) return '(data-filtered-count not found)'
  const openEnd = html.indexOf('>', markerIndex)
  const close = html.indexOf('</p>', openEnd)
  if (openEnd === -1 || close === -1) return '(data-filtered-count not found)'
  return stripTags(html.slice(openEnd + 1, close))
}

function hiddenFilterValues(html) {
  const formStart = html.indexOf('data-server-search')
  const formEnd = html.indexOf('</form>', formStart)
  const form = formStart === -1 || formEnd === -1 ? '' : html.slice(formStart, formEnd)
  const values = {}
  const pattern = /<input[^>]*type="hidden"[^>]*name="(status|sort|view)"[^>]*value="([^"]*)"/g
  let match
  while ((match = pattern.exec(form)) !== null) values[match[1]] = match[2]
  return values
}

function titleOf(html) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/)
  return match ? match[1] : '(no title)'
}

// furin 把页面 props 序列化成 <script id="__FURIN_DATA__" type="application/json">：
// 普通 JSON，不是 Seroval 的 $R 引用图，因此可以直接 JSON.parse 后断言。
function furinData(html) {
  const match = html.match(/<script id="__FURIN_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function furinManifest() {
  try {
    return JSON.parse(readFileSync(BUILD_MANIFEST, 'utf8'))
  } catch {
    return null
  }
}

// 构建清单是 furin 的路由真源（src/pages 下的文件编译成 manifest.routes），
// 用它替代 TanStack 时代的 src/routeTree.gen.ts。
function furinRoutes() {
  const manifest = furinManifest()
  if (!manifest) return []
  const patterns = []
  for (const route of manifest.routes || []) patterns.push(route.pattern)
  for (const app of manifest.apps || []) for (const route of app.routes || []) patterns.push(route.pattern)
  return patterns
}

function portListening(port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port })
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function walkFiles(directory, predicate, files) {
  const output = files || []
  if (!existsSync(directory)) return output
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, predicate, output)
    } else if (!predicate || predicate(full, entry.name)) {
      output.push(full)
    }
  }
  return output
}

function fileText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function containsBrand(text) {
  return text.toLowerCase().indexOf(FORBIDDEN_BRAND) !== -1
}

function brandScanText(file) {
  const text = fileText(file)
  if (path.basename(file) === '.env.example') {
    // Env assignment values are runtime configuration (example upstream URL /
    // key), not UI/build/docs copy. Scan the comments and key names only.
    return text
      .split('\n')
      .map((line) => (/^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(line) ? '' : line))
      .join('\n')
  }
  return text
}

function brandHits(files) {
  const hits = []
  for (const file of files) {
    if (containsBrand(brandScanText(file))) hits.push(path.relative(ROOT, file))
  }
  return hits
}

function startMockRelay(payload) {
  return new Promise((resolve, reject) => {
    const requests = []
    const server = createServer((req, res) => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: Object.assign({}, req.headers),
      })
      // payload 既可以是固定对象（C28/C29），也可以是按请求序号生成新载荷的函数
      // （C40）：只有每次上游都返回不同数据，才能证明页面拿到的是刷新后的值，而
      // 不是上一份缓存或 ISR 旧快照。
      const body = typeof payload === 'function' ? payload(requests.length - 1) : payload
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    })
    server.once('error', reject)
    server.listen(0, HOST, () => {
      resolve({
        server: server,
        port: server.address().port,
        requests: requests,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

function buildIsolatedEnv(port, extra) {
  const env = Object.assign({}, process.env, {
    PORT: String(port),
    HOST: HOST,
    NODE_ENV: 'production',
  })
  // Bun auto-loads the repo .env for a child started in this cwd. Empty
  // strings are explicit values and override .env, so fixture-mode probes do
  // not touch (or depend on) the real user file.
  env.BALANCE_API_URL = ''
  env.BALANCE_API_KEY = ''
  env.BALANCE_CACHE_TTL_SECONDS = ''
  env.BALANCE_API_TIMEOUT_MS = ''
  // The local-debug identity switch must never leak into a verification run:
  // the suite proves the page is fully redacted, which only holds masked.
  env.REVEAL_IDENTITIES = ''
  // The routing stage must not read the developer's live gateway either: it would
  // make the page depend on the network, and its long numeric fields can contain
  // a digit run the redaction checks look for (a token count like 74862215.0136…).
  env.GATEWAY_WEB_URL = ''
  env.GATEWAY_WEB_KEY = ''
  env.GATEWAY_WEB_TIMEOUT_MS = ''
  delete env[LEGACY_AUTH_ENV]
  return Object.assign(env, extra || {})
}

function processImagePath(pid) {
  if (process.platform === 'win32') {
    const probe = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process -Id ' + pid + ').Path'],
      { encoding: 'utf8' },
    )
    return probe.status === 0 ? probe.stdout.trim() : ''
  }
  try {
    return readlinkSync('/proc/' + pid + '/exe')
  } catch {
    return ''
  }
}

const results = []
const evidence = {}
const authHtml = []
let child = null
let stopResult = null
let bootMs = 0

function record(status, id, name, detail, ms) {
  results.push({ status, id, name, detail: detail || '', ms: ms === undefined ? 0 : ms })
  const suffix = detail ? '  ' + detail : ''
  console.log('[' + status + '] ' + id + ' ' + name + ' (' + results[results.length - 1].ms + ' ms)' + suffix)
}

async function check(id, name, fn) {
  const started = performance.now()
  try {
    const detail = await fn()
    record('PASS', id, name, typeof detail === 'string' ? detail : '', Math.round(performance.now() - started))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    record('FAIL', id, name, message, Math.round(performance.now() - started))
  }
}

// ---------------------------------------------------------------------------
// server lifecycle
// ---------------------------------------------------------------------------

const serverLog = []

function spawnServerProcess(env, log) {
  const proc = spawn(BUN_BIN, [SERVER_ENTRY], {
    cwd: ROOT,
    env: env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const push = (prefix, data) => {
    log.push(prefix + data.toString('utf8'))
    if (log.length > 400) log.shift()
  }
  proc.stdout.on('data', (chunk) => push('[stdout] ', chunk))
  proc.stderr.on('data', (chunk) => push('[stderr] ', chunk))
  return proc
}

function buildMainEnv() {
  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    HOST: HOST,
    NODE_ENV: 'production',
  })
  // Explicit empty URL overrides the auto-loaded repo .env, keeping the main
  // verification server in fixture mode without editing the real file.
  env.BALANCE_API_URL = ''
  env.BALANCE_API_KEY = SENTINEL_SECRET
  env.BALANCE_CACHE_TTL_SECONDS = ''
  env.BALANCE_API_TIMEOUT_MS = ''
  // Masked is part of the contract this suite proves; a developer's .env must
  // not be able to switch identity reveal on for it.
  env.REVEAL_IDENTITIES = ''
  // Hermetic: never poll the developer's live gateway from a verification run.
  env.GATEWAY_WEB_URL = ''
  env.GATEWAY_WEB_KEY = ''
  env.GATEWAY_WEB_TIMEOUT_MS = ''
  delete env[LEGACY_AUTH_ENV]
  return env
}

function startServer() {
  return spawnServerProcess(buildMainEnv(), serverLog)
}

async function waitForReady(port, proc, timeoutMs) {
  const started = Date.now()
  const origin = 'http://' + HOST + ':' + port
  while (Date.now() - started < timeoutMs) {
    if (proc && proc.exitCode !== null) {
      throw new Error('server exited before it became ready (exit code ' + proc.exitCode + ')')
    }
    try {
      const response = await fetch(origin + '/', {
        headers: { 'user-agent': BROWSER_UA, accept: HTML_ACCEPT },
        signal: AbortSignal.timeout(4000),
      })
      if (response.ok) {
        await response.text()
        return Date.now() - started
      }
    } catch {
      // not listening yet
    }
    await sleep(200)
  }
  throw new Error('server did not become ready within ' + timeoutMs + ' ms')
}

async function stopChild(proc, port) {
  if (!proc) return { alreadyStopped: true, code: null, signal: null, portFree: true, processAlive: false }
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return {
      alreadyStopped: true,
      code: proc.exitCode,
      signal: proc.signalCode,
      portFree: !(await portListening(port, 300)),
      processAlive: false,
    }
  }
  const exited = new Promise((resolve) => {
    proc.once('exit', (code, signal) => resolve({ code: code, signal: signal }))
  })
  try {
    proc.kill('SIGTERM')
  } catch {
    // ignore
  }
  let result = await Promise.race([exited, sleep(5000).then(() => ({ timeout: true }))])
  if (result.timeout) {
    try {
      proc.kill('SIGKILL')
    } catch {
      // ignore
    }
    result = await Promise.race([exited, sleep(3000).then(() => ({ timeout: true }))])
  }
  if (result.timeout && process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    result = await Promise.race([exited, sleep(3000).then(() => ({ timeout: true }))])
  }
  let portFree = false
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await portListening(port, 300))) {
      portFree = true
      break
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(150)
  }
  let processAlive = true
  try {
    process.kill(proc.pid, 0)
  } catch {
    processAlive = false
  }
  if (processAlive) {
    try {
      process.kill(proc.pid, 'SIGKILL')
    } catch {
      // ignore
    }
  }
  return {
    code: result.code === undefined ? null : result.code,
    signal: result.signal === undefined ? null : result.signal,
    timedOut: Boolean(result.timeout),
    portFree: portFree,
    processAlive: processAlive,
  }
}

async function stopServer() {
  return stopChild(child, PORT)
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchPage(route, userAgent, accept, origin) {
  const started = performance.now()
  const baseOrigin = origin || BASE
  const url = /^https?:/.test(route) ? route : baseOrigin + route
  const response = await fetch(url, {
    headers: {
      'user-agent': userAgent || BROWSER_UA,
      accept: accept || HTML_ACCEPT,
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  })
  const text = await response.text()
  return {
    status: response.status,
    headers: headersToObject(response.headers),
    text: text,
    ms: Math.round(performance.now() - started),
  }
}

async function fetchChunks(route, userAgent) {
  const started = performance.now()
  const response = await fetch(BASE + route, {
    // 断言的是原始响应体（流式文档），显式要求不压缩，避免把 gzip 字节当成 HTML。
    headers: { 'user-agent': userAgent || BROWSER_UA, accept: HTML_ACCEPT, 'accept-encoding': 'identity' },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  })
  const headers = headersToObject(response.headers)
  const chunks = []
  const decoder = new TextDecoder()
  let full = ''
  if (response.body) {
    const reader = response.body.getReader()
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const step = await reader.read()
      if (step.done) break
      const text = decoder.decode(step.value, { stream: true })
      full += text
      chunks.push({ at: Math.round(performance.now() - started), bytes: step.value.byteLength, text: text })
    }
    full += decoder.decode()
  }
  return {
    status: response.status,
    headers: headers,
    chunks: chunks,
    full: full,
    ms: Math.round(performance.now() - started),
  }
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

async function runChecks() {
  await check('C01', 'Bun server ready on 127.0.0.1:' + PORT, async () => {
    evidence.nodeCompat = process.version
    evidence.platform = process.platform + ' / ' + process.arch
    evidence.buildMtime = statSync(SERVER_ENTRY).mtime.toISOString()
    assert(bootMs < 45000, 'readiness took too long')
    return 'ready in ' + bootMs + ' ms; pid ' + child.pid + "; fixture mode (BALANCE_API_URL='' overrides repo .env)"
  })

  await check('C02', 'repository/toolchain state is the reduced Bun app', async () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    const bunLock = existsSync(path.join(ROOT, 'bun.lock'))
    const pnpmLock = existsSync(path.join(ROOT, 'pnpm-lock.yaml'))
    const pnpmWorkspace = existsSync(path.join(ROOT, 'pnpm-workspace.yaml'))
    const pnpmStore = existsSync(path.join(ROOT, 'node_modules', '.pnpm'))
    assert(bunLock, 'bun.lock missing')
    assert(!pnpmLock && !pnpmWorkspace && !pnpmStore, 'pnpm state is still present')
    assert(pkg.name === 'balance-panel', 'package name is not balance-panel: ' + pkg.name)
    assert(pkg.packageManager === 'bun@1.4.4', 'packageManager is not bun@1.4.4: ' + pkg.packageManager)
    assert(pkg.engines && pkg.engines.bun, 'engines.bun missing')
    for (const name of ['dev', 'build', 'start', 'test', 'typecheck', 'verify']) {
      assert(pkg.scripts && pkg.scripts[name], 'package.json is missing the "' + name + '" script')
    }
    assert((pkg.scripts.start || '').indexOf('bun ') === 0, 'start script does not use bun')
    assert((pkg.scripts.verify || '').indexOf('bun ') === 0, 'verify script does not use bun')
    // 框架层：furin + Elysia，旧 TanStack Start / Nitro / Redact 一个都不许留。
    assert(pkg.dependencies && pkg.dependencies['@teyik0/furin'], 'package.json does not depend on @teyik0/furin')
    assert(pkg.dependencies.elysia, 'package.json does not depend on elysia')
    for (const removed of ['@tanstack/react-start', '@tanstack/react-router', '@tanstack/react-query', '@tanstack/redact', 'nitro']) {
      assert(!(pkg.dependencies || {})[removed] && !(pkg.devDependencies || {})[removed], 'removed framework dependency still declared: ' + removed)
    }
    // Vite 不再是应用构建器（生产构建由 furin/Bun 完成）；它只作为 vitest 的 peer
    // 出现在 devDependencies 里。把它挡在 dependencies 之外，避免又变成第二套构建链。
    assert(!(pkg.dependencies || {}).vite, 'vite is still a runtime dependency (it must only be test tooling)')
    assert((pkg.devDependencies || {}).vite, 'vite devDependency is missing: vitest needs it as a peer')

    assert(existsSync(path.join(ROOT, 'bunfig.toml')), 'bunfig.toml is missing (dev-time bun full-stack config)')
    assert(existsSync(path.join(ROOT, 'furin.config.ts')), 'furin.config.ts is missing (build config)')
    assert(!existsSync(path.join(ROOT, 'vite.config.ts')), 'vite.config.ts still exists')
    assert((pkg.scripts.dev || '').indexOf('bun ') === 0, 'dev script does not start with bun: ' + pkg.scripts.dev)
    assert((pkg.scripts.dev || '').indexOf('src/server.ts') !== -1, 'dev script does not serve src/server.ts: ' + pkg.scripts.dev)
    assert(existsSync(path.join(ROOT, 'src', 'lib', 'balance', 'derive.ts')), 'src/lib/balance missing')
    assert(existsSync(path.join(ROOT, 'src', 'server', 'balance.server.ts')), 'src/server/balance.server.ts missing')
    assert(!existsSync(path.join(ROOT, OLD_LIB_DIR)), 'legacy library directory still exists')
    assert(!existsSync(path.join(ROOT, OLD_SERVER_FILE)), 'legacy server module still exists')
    assert(!existsSync(path.join(ROOT, 'src', 'pages', 'api')), 'src/pages/api still exists')
    assert(!existsSync(path.join(ROOT, 'src', 'pages', 'settings.tsx')), 'settings page still exists')
    assert(!existsSync(path.join(ROOT, 'src', 'features', 'settings')), 'settings feature still exists')
    assert(!existsSync(path.join(ROOT, 'src', 'pages', 'providers.$provider.tsx')), 'providers page still exists')
    assert(!existsSync(path.join(ROOT, 'src', 'features', 'providers')), 'providers feature still exists')
    assert(!existsSync(path.join(ROOT, 'src', 'features', 'dashboard', 'insights-panel.tsx')), 'insights component still exists')
    const envExample = fileText(path.join(ROOT, '.env.example'))
    for (const key of ['BALANCE_API_URL', 'BALANCE_API_KEY', 'BALANCE_API_TIMEOUT_MS', 'BALANCE_CACHE_TTL_SECONDS']) {
      assert(envExample.indexOf(key) !== -1, '.env.example missing ' + key)
    }
    assert(envExample.indexOf(LEGACY_AUTH_ENV) === -1, '.env.example still contains the retired auth env name')
    evidence.repo = {
      name: pkg.name,
      packageManager: pkg.packageManager,
      bunLock: bunLock,
      pnpmLock: pnpmLock,
      pnpmWorkspace: pnpmWorkspace,
      pnpmStore: pnpmStore,
      framework: {
        furin: pkg.dependencies['@teyik0/furin'],
        elysia: pkg.dependencies.elysia,
        dev: pkg.scripts.dev,
      },
    }
    return 'balance-panel; bun.lock; no pnpm state; @teyik0/furin + elysia, no TanStack/Vite/Nitro/Redact; bunfig.toml + furin.config.ts; dev = bun --hot src/server.ts; src/lib/balance + src/server/balance.server.ts; removed legacy + provider routes/components; BALANCE_* in .env.example'
  })

  await check('C03', 'Bun 1.4.4, furin build manifest, health endpoints and server process', async () => {
    assert(process.versions.bun, 'process.versions.bun is undefined — verifier is not Bun')
    assert(process.versions.bun === '1.4.4', 'expected Bun 1.4.4, got ' + process.versions.bun)
    assert(BUN_BIN === process.execPath, 'BUN_BIN is not the running Bun executable: ' + BUN_BIN)
    const versionProbe = spawnSync(BUN_BIN, ['--version'], { encoding: 'utf8' })
    assert(versionProbe.status === 0, 'bun --version failed')
    assert(versionProbe.stdout.trim() === process.versions.bun, 'bun --version mismatch: ' + versionProbe.stdout.trim())
    assert(existsSync(BUILD_MANIFEST), '.furin/build/manifest.json missing — run "bun run build" first')
    const manifest = JSON.parse(readFileSync(BUILD_MANIFEST, 'utf8'))
    assert(manifest && manifest.targets && manifest.targets.bun, 'build manifest does not declare the bun target')
    const buildId = manifest.targets.bun.buildId || manifest.buildId
    assert(typeof buildId === 'string' && buildId.length > 0, 'build manifest has no buildId')
    assert(
      path.resolve(ROOT, manifest.targets.bun.serverPath || '') === SERVER_ENTRY,
      'manifest bun target does not point at ' + path.relative(ROOT, SERVER_ENTRY) + ': ' + manifest.targets.bun.serverPath,
    )
    // furin 自带探针端点；容器 HEALTHCHECK 用的就是 ready。
    const healthLive = await fetchPage('/_furin/health/live')
    const healthReady = await fetchPage('/_furin/health/ready')
    assert(healthLive.status === 200, '/_furin/health/live expected 200, got ' + healthLive.status)
    assert(healthReady.status === 200, '/_furin/health/ready expected 200, got ' + healthReady.status)
    const probe = await fetchPage('/')
    assert(probe.status === 200, 'build-id probe expected 200, got ' + probe.status)
    assert(
      probe.headers['x-furin-build-id'] === buildId,
      'x-furin-build-id (' + probe.headers['x-furin-build-id'] + ') does not match manifest buildId (' + buildId + ')',
    )
    const imagePath = processImagePath(child.pid)
    assert(imagePath, 'could not determine the running server executable')
    assert(imagePath.toLowerCase().indexOf('bun') !== -1, 'server process is not a Bun executable: ' + imagePath)
    evidence.bun = {
      version: process.versions.bun,
      bin: BUN_BIN,
      nodeCompat: process.version,
      buildId: buildId,
      manifestRoutes: (manifest.routes || []).map((route) => route.pattern),
      serverImagePath: imagePath,
      health: { live: healthLive.status, ready: healthReady.status },
    }
    return 'Bun 1.4.4; manifest buildId=' + buildId + '; server image=' + imagePath + '; /_furin/health/live+ready 200; x-furin-build-id matches manifest'
  })

  await check('C04', 'unit tests pass and cover masking + relay Bearer formatting', async () => {
    const run = spawnSync(BUN_BIN, ['run', 'test'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      // CI 的终端会让 Vitest 输出 ANSI 颜色码，夹在 "Tests" 与数字之间时正则
      // 会匹配失败（Linux runner 上实测 0）。显式关色，并在解析前再剥一次
      // ANSI，避免本地（无 TTY）能过、CI 挂掉的差异。
      env: Object.assign({}, process.env, { CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }),
    })
    const output = String(run.stdout || '') + String(run.stderr || '')
    const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '')
    assert(run.status === 0, 'bun run test failed: ' + cleanOutput.slice(-400))
    const testCount = Number((cleanOutput.match(/Tests\s+(\d+)\s+passed/) || [])[1] || 0)
    // 门槛只增不减：迁移时用例从 31 涨到 94；缓存再生成修复 +8
    // （src/server/__tests__/balance-cache.test.ts），数据年龄标签 +1（formatAge），
    // 请求路径“幽灵”收尾 +8（src/features/routing/__tests__/ghosts.test.ts）与
    // “在途/最新请求不被挤出舞台” +2，自动/手动刷新的两种失效模式 +3
    // （src/features/dashboard/__tests__/refresh-request.test.ts），
    // 现在是 117 / 11 个文件。以后加测试必须同步抬高这个数字。
    assert(testCount >= 117, 'expected at least 117 passing tests, got ' + testCount + ': ' + cleanOutput.slice(-300))
    const testSource = fileText(path.join(ROOT, 'src', 'lib', 'balance', '__tests__', 'derive.test.ts'))
    assert(testSource.indexOf('maskAccountIdentifier') !== -1, 'masking helper is not unit-tested')
    assert(testSource.toLowerCase().indexOf('account identifier masking') !== -1, 'masking test suite is missing')
    assert(testSource.toLowerCase().indexOf('relay station authentication') !== -1, 'relay auth test suite is missing')
    assert(testSource.indexOf("'Bearer sk-relay-123'") !== -1, 'Bearer formatting assertions are missing')
    assert(testSource.indexOf("toBe('***')") !== -1, 'full-redaction assertions are missing')
    assert(testSource.indexOf('never exposes the raw user in the account view') !== -1, 'raw-user exclusion test is missing')
    const themeTestSource = fileText(path.join(ROOT, 'src', 'lib', '__tests__', 'theme.test.ts'))
    assert(themeTestSource.indexOf('themeMode') !== -1, 'host theme postMessage test is missing')
    assert(themeTestSource.indexOf('data-host-theme') !== -1, 'host theme bridge test is missing')
    assert(themeTestSource.indexOf('never hides the body') !== -1, 'first-paint (no visibility mask) test is missing')
    assert(themeTestSource.indexOf('prefersDark') !== -1, 'system preference fallback test is missing')
    return testCount + '/' + testCount + ' Vitest tests pass (11 files); full-redaction + masking + relay Bearer formatting + host theme bridge + routing geometry/timeline/motion/ghost retirement + dependency-free search parser + awaited balance-cache + refresh-mode suite present'
  })

  const home = await fetchPage('/')
  await check('C05', 'GET / is a complete server-rendered HTML document', async () => {
    evidence.home = { status: home.status, headers: home.headers, bytes: home.text.length }
    assert(home.status === 200, 'expected 200, got ' + home.status)
    assert((home.headers['content-type'] || '').indexOf('text/html') === 0, 'content-type is not HTML: ' + home.headers['content-type'])
    // ISR 页面是完整文档：通常带 Content-Length（缓存命中与首渲染都是），也允许
    // chunked，但两者至少得有一个，否则响应体长度不可知。
    const contentLength = home.headers['content-length']
    const transferEncoding = home.headers['transfer-encoding']
    assert(
      Boolean(contentLength) || transferEncoding === 'chunked',
      'response has neither Content-Length nor chunked transfer: ' + JSON.stringify({ contentLength: contentLength, transferEncoding: transferEncoding }),
    )
    // ISR 60s：Cache-Control 必须带 s-maxage 与 stale-while-revalidate。后台再生成
    // 的那一次 s-maxage 会降为 0（SWR 语义），所以这里只校验字段存在与 SWR 窗口。
    const cacheControl = home.headers['cache-control'] || ''
    assert(/s-maxage=\d+/.test(cacheControl), 'page Cache-Control is missing s-maxage (ISR): ' + cacheControl)
    assert(/stale-while-revalidate=60/.test(cacheControl), 'page Cache-Control is missing stale-while-revalidate=60: ' + cacheControl)
    assert(Boolean(home.headers.etag), 'page response is missing ETag')
    const html = home.text
    assert(html.startsWith('<!DOCTYPE html>'), 'missing <!DOCTYPE html>')
    assert(html.indexOf('<html lang="zh-CN"') !== -1, 'missing <html lang="zh-CN">')
    assert(html.indexOf('<head>') !== -1 && html.indexOf('</head>') !== -1, 'missing <head>')
    assert(html.indexOf('<body>') !== -1 && html.indexOf('</body>') !== -1, 'missing <body>')
    assert(html.trimEnd().endsWith('</html>'), 'document does not end with </html>')
    const title = titleOf(html)
    evidence.homeTitle = title
    assert(title.indexOf('余额面板') !== -1, 'unexpected title: ' + title)
    assert(title.indexOf('4 个账户') !== -1, 'title does not report 4 accounts: ' + title)
    return 'HTTP 200, text/html, ' + (contentLength ? 'Content-Length ' + contentLength : 'chunked') + ', ISR Cache-Control + ETag, complete document, title="' + title + '"'
  })

  await check('C06', 'response is a complete document with no deferred insights', async () => {
    const stream = await fetchChunks('/', BROWSER_UA)
    evidence.singleDocument = {
      status: stream.status,
      chunks: stream.chunks.map((chunk, index) => ({ index: index, atMs: chunk.at, bytes: chunk.bytes })),
      firstChunkHasDoctype: stream.chunks[0] ? stream.chunks[0].text.startsWith('<!DOCTYPE html>') : false,
      anyChunkHasClosingHtml: stream.chunks.some((chunk) => chunk.text.indexOf('</html>') !== -1),
      totalBytes: stream.full.length,
      chunkCount: stream.chunks.length,
    }
    assert(stream.status === 200, 'expected 200, got ' + stream.status)
    assert(stream.chunks.length >= 1, 'expected at least one response chunk')
    assert(stream.full.startsWith('<!DOCTYPE html>'), 'response does not start with <!DOCTYPE html>')
    assert(stream.full.trimEnd().endsWith('</html>'), 'complete document does not end with </html>')
    assert(stream.chunks[0].text.startsWith('<!DOCTYPE html>'), 'first chunk does not start with <!DOCTYPE html>')
    const forbiddenMarkers = ['data-streamed-insights', 'data-insights-skeleton', '用量洞察', 'streamLatencyMs', 'InsightsPayload']
    for (const marker of forbiddenMarkers) {
      assert(stream.full.indexOf(marker) === -1, 'deferred insights marker present: ' + marker)
    }
    return stream.chunks.length + ' response chunk(s) (' + stream.full.length + ' bytes) complete the document; no insights markers (hydration payload allowed)'
  })

  await check('C07', 'host theme bridge in <head> and app CSS is an external /_client asset', async () => {
    const html = home.text
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
    for (const marker of ['themeMode', 'prefers-color-scheme', 'window.parent', 'data-host-theme']) {
      assert(head.indexOf(marker) !== -1, 'host theme bridge marker missing from <head>: ' + marker)
    }
    assert(head.indexOf('localStorage') === -1, 'theme bootstrap touches localStorage (blocked in sandboxed iframes)')
    assert(head.indexOf('balance:theme:v1') === -1, 'manual theme storage key still present')
    assert(head.indexOf(OLD_THEME_KEY) === -1, 'legacy theme storage key still present')
    // furin 不做构建期内联：app.css 被编成客户端资产，<head> 里唯一的样式入口是
    // <link rel="stylesheet" href="/_client/....css">，样式字节走 HTTP 缓存单独下载。
    assert(head.indexOf('data-tsr-inline-css') === -1, 'inline TanStack CSS is still present in <head>')
    const linkMatch = head.match(/<link[^>]+rel="stylesheet"[^>]*>/)
    assert(linkMatch, 'external <link rel="stylesheet"> not found in <head>')
    const hrefMatch = linkMatch[0].match(/href="(\/_client\/[^"]+\.css)"/)
    assert(hrefMatch, 'stylesheet link does not point at a /_client/*.css asset: ' + linkMatch[0])
    const cssHref = hrefMatch[1]
    const css = await fetchPage(cssHref)
    assert(css.status === 200, 'built CSS asset did not load: ' + css.status)
    assert((css.headers['content-type'] || '').indexOf('text/css') === 0, 'CSS asset content-type is not text/css: ' + css.headers['content-type'])
    assert(css.text.indexOf('--font-ui-sans') !== -1, 'app CSS is missing the UI font token')
    // 字体全部来自系统（见 src/styles/app.css）：一旦有人重新引入 web font，
    // 构建产物里会立刻出现 @font-face 与 Public Sans 之类的族名，在这里拦住。
    assert(css.text.indexOf('@font-face') === -1, 'app CSS declares a web font (@font-face)')
    assert(css.text.indexOf('Public Sans') === -1, 'app CSS still references Public Sans')
    assert(css.text.indexOf('@layer') !== -1, 'app CSS is missing Tailwind layers')
    assert(!containsBrand(css.text), 'app CSS contains the legacy brand token')
    evidence.css = { inlineBytes: 0, asset: cssHref, assetBytes: css.text.length }
    return 'no inline CSS; <link rel="stylesheet" href="' + cssHref + '"> -> 200 text/css (' + css.text.length + ' bytes) with --font-ui-sans + @layer, no @font-face/Public Sans; themeMode postMessage + matchMedia bootstrap, no localStorage'
  })

  await check('C08', 'dashboard SSR content, filters and fixture warning', async () => {
    const html = home.text
    for (const marker of ['data-ssr-dashboard', 'data-filtered-count', 'WorkBuddy', 'Open Design', '未配置内网余额接口']) {
      assert(html.indexOf(marker) !== -1, 'missing dashboard marker/text: ' + marker)
    }
    assert(html.indexOf('data-provider-detail') === -1, 'provider detail marker leaked into the dashboard')
    const countText = filteredCountText(html)
    evidence.dashboardCount = countText
    assert(/显示\s*4\s*\/\s*4/.test(countText), 'default count is not 4 / 4: ' + countText)
    assert(html.indexOf('"mode":"fixture"') !== -1, 'source mode is not fixture in the serialized page data')
    return 'data-ssr-dashboard + filters, WorkBuddy/Open Design, fixture warning, "' + countText + '"'
  })

  await check('C09', 'user identifiers are fully redacted in dashboard HTML/loader data', async () => {
    const html = home.text
    for (const raw of RAW_IDENTIFIERS) {
      assert(html.indexOf(raw) === -1, 'raw user identifier leaked into dashboard HTML: ' + raw)
    }
    for (const fragment of FORBIDDEN_USER_FRAGMENTS) {
      assert(html.indexOf(fragment) === -1, 'masked/raw user fragment remains in dashboard HTML: ' + fragment)
    }
    // 数据现在是 furin 的普通 JSON（<script id="__FURIN_DATA__">），键值形式是 "user":"..."。
    const serializedUsers = [...html.matchAll(/"user":"([^"]*)"/g)].map((match) => match[1])
    evidence.dashboardUsers = serializedUsers
    assert(serializedUsers.length >= 4, 'expected at least four serialized user values, got ' + serializedUsers.length)
    // 等字数打码：只能是星号，且长度各不相同（说明是“同长度星号”而不是固定 "***"）。
    assert(
      serializedUsers.every((value) => /^\*+$/.test(value)),
      'a non-redacted user value remains: ' + JSON.stringify(serializedUsers),
    )
    assert(
      new Set(serializedUsers.map((value) => value.length)).size >= 2,
      'masked user values are all one fixed length: ' + JSON.stringify(serializedUsers),
    )
    const serializedIds = [...html.matchAll(/"id":"([^"]*)"/g)].map((match) => match[1])
    evidence.dashboardIds = serializedIds
    assert(serializedIds.length >= 4, 'expected at least four account ids, got ' + serializedIds.length)
    for (const id of serializedIds) {
      assert(/^[a-z0-9-]+::[a-z0-9]+$/.test(id), 'account id is not an opaque provider::hash value: ' + id)
      for (const raw of RAW_IDENTIFIERS) assert(id.indexOf(raw) === -1, 'raw user leaked into account id')
      for (const fragment of FORBIDDEN_USER_FRAGMENTS) assert(id.indexOf(fragment) === -1, 'masked user fragment leaked into account id')
    }
    return 'every serialized user is equal-length asterisks (' + serializedUsers[0].length + '… chars); no raw/masked fragment remains; account ids are provider::opaque-hash'
  })

  await check('C10', 'raw identifiers are confined to server fixture (plus test-only samples)', async () => {
    const fixturePath = path.join(ROOT, 'src', 'server', 'fixtures', 'balances.json')
    const fixture = fileText(fixturePath)
    for (const raw of RAW_IDENTIFIERS) {
      assert(fixture.indexOf(raw) !== -1, 'raw identifier missing from the server fixture: ' + raw)
    }
    const testFile = path.join(ROOT, 'src', 'lib', 'balance', '__tests__', 'derive.test.ts')
    const testSource = fileText(testFile)
    const testSamples = RAW_IDENTIFIERS.filter((raw) => testSource.indexOf(raw) !== -1)
    const runtimeSources = walkFiles(
      path.join(ROOT, 'src'),
      (full) => full.endsWith('.ts') || full.endsWith('.tsx'),
    ).filter((full) => full !== testFile)
    const sourceHits = []
    for (const file of runtimeSources) {
      const text = fileText(file)
      for (const raw of RAW_IDENTIFIERS) {
        if (text.indexOf(raw) !== -1) sourceHits.push(path.relative(ROOT, file) + ':' + raw)
      }
    }
    const docHits = []
    for (const name of ['README.md', 'VERIFICATION.md']) {
      const docPath = path.join(ROOT, name)
      if (!existsSync(docPath)) continue
      const text = fileText(docPath)
      for (const raw of RAW_IDENTIFIERS) {
        if (text.indexOf(raw) !== -1) docHits.push(name + ':' + raw)
      }
    }
    evidence.rawSource = {
      fixtureHasAll: true,
      testSamples: testSamples.length,
      runtimeSourceHits: sourceHits,
      docHits: docHits,
    }
    assert(sourceHits.length === 0, 'raw identifiers found outside the fixture/tests: ' + sourceHits.join(', '))
    assert(docHits.length === 0, 'raw identifiers found in README/VERIFICATION: ' + docHits.join(', '))
    const note = testSamples.length > 0 ? '; masking unit tests reuse the samples (test-only, never built into the client)' : ''
    return 'fixture holds all raw identifiers; no production source or docs contain them' + note
  })

  await check('C11', 'provider detail route is removed; /providers/* returns 404', async () => {
    const known = await fetchPage('/providers/workbuddy-ai')
    const errorProvider = await fetchPage('/providers/workbuddy')
    const missing = await fetchPage('/providers/nope')
    const malformed = await fetchPage('/providers/INVALID_!!')
    evidence.providerRemoved = { known: known.status, errorProvider: errorProvider.status, missing: missing.status, malformed: malformed.status }
    assert(known.status === 404, '/providers/workbuddy-ai expected 404, got ' + known.status)
    assert(errorProvider.status === 404, '/providers/workbuddy expected 404, got ' + errorProvider.status)
    assert(missing.status === 404, '/providers/nope expected 404, got ' + missing.status)
    assert(malformed.status === 404, '/providers/INVALID_!! expected 404, got ' + malformed.status)
    assert(known.text.indexOf('data-provider-detail') === -1, 'removed provider detail markup is still rendered')
    assert(!existsSync(path.join(ROOT, 'src', 'pages', 'providers.$provider.tsx')), 'providers page file still exists')
    assert(!existsSync(path.join(ROOT, 'src', 'features', 'providers')), 'providers feature directory still exists')
    assert(!furinRoutes().some((pattern) => pattern.indexOf('/providers') !== -1), 'build manifest still declares a providers route')
    assert(home.text.indexOf('href="/providers') === -1, 'dashboard still links to the removed /providers route')
    return '/providers/* -> 404 for known/error/unknown/malformed; no providers page/feature dir or manifest route; no dashboard links'
  })

  await check('C12', 'settings page and settings links are removed', async () => {
    const settings = await fetchPage('/settings')
    assert(settings.status === 404, '/settings expected 404, got ' + settings.status)
    assert(home.text.indexOf('data-settings-page') === -1, 'data-settings-page present on dashboard')
    assert(home.text.indexOf('href="/settings"') === -1, 'settings link present on dashboard')
    assert(!existsSync(path.join(ROOT, 'src', 'pages', 'settings.tsx')), 'settings page file still exists')
    assert(!furinRoutes().some((pattern) => pattern.indexOf('/settings') !== -1), 'build manifest still declares a settings route')
    return '/settings -> 404; no data-settings-page, no settings links, no settings page or manifest route'
  })

  await check('C13', 'HTTP API routes are removed', async () => {
    const apiGeneric = await fetchPage('/api/foo')
    const apiBrand = await fetchPage(API_PROBE)
    assert(apiGeneric.status === 404, '/api/foo expected 404, got ' + apiGeneric.status)
    assert(apiBrand.status === 404, 'legacy API path expected 404, got ' + apiBrand.status)
    assert(!existsSync(path.join(ROOT, 'src', 'pages', 'api')), 'src/pages/api still exists')
    assert(!furinRoutes().some((pattern) => pattern.indexOf('/api') === 0), 'build manifest still declares an /api route')
    return '/api/foo and legacy API path -> 404; no src/pages/api; no API route in the furin manifest'
  })

  await check('C14', 'usage insights are removed from source and build', async () => {
    const sourceFiles = walkFiles(path.join(ROOT, 'src'), (full) => /\.(ts|tsx)$/.test(full))
    const sourceHits = []
    for (const file of sourceFiles) {
      const text = fileText(file)
      if (/insight/i.test(text) || text.indexOf('用量洞察') !== -1 || text.indexOf('data-streamed-insights') !== -1) {
        sourceHits.push(path.relative(ROOT, file))
      }
    }
    assert(sourceHits.length === 0, 'insights references remain in source: ' + sourceHits.join(', '))
    const buildFiles = walkFiles(BUILD_DIR, (full) => /\.(js|mjs|css)$/.test(full))
    const insightBuildHits = []
    const insightMarkers = [
      'InsightsPanel',
      'InsightsSkeleton',
      'InsightsPayload',
      'data-streamed-insights',
      'data-insights-skeleton',
      '用量洞察',
      'streamLatencyMs',
    ]
    for (const file of buildFiles) {
      const text = fileText(file)
      for (const marker of insightMarkers) {
        if (text.indexOf(marker) !== -1) insightBuildHits.push(path.relative(ROOT, file) + ':' + marker)
      }
    }
    assert(insightBuildHits.length === 0, 'insights markers remain in build: ' + insightBuildHits.join(', '))
    return 'no insights component/string in src; no insights marker/string in .furin/build'
  })

  await check('C15', 'legacy brand token is absent from HTML responses', async () => {
    const pages = [
      ['/', home],
      ['/nope', await fetchPage('/nope')],
      ['/settings', await fetchPage('/settings')],
      ['/api/foo', await fetchPage('/api/foo')],
    ]
    const hits = pages.filter((entry) => containsBrand(entry[1].text)).map((entry) => entry[0])
    evidence.htmlPagesChecked = pages.map((entry) => entry[0])
    assert(hits.length === 0, 'legacy brand token found in HTML: ' + hits.join(', '))
    return 'checked ' + pages.length + ' HTML responses; token absent'
  })

  await check('C16', 'legacy brand token is absent from shipped JS/CSS build output', async () => {
    const files = walkFiles(BUILD_DIR, (full) => /\.(js|mjs|css)$/.test(full))
    assert(files.length > 0, 'no build output files found')
    const hits = brandHits(files)
    evidence.buildScan = { files: files.length, hits: hits }
    assert(hits.length === 0, 'legacy brand token found in build: ' + hits.join(', '))
    return files.length + ' .furin/build JS/CSS files scanned; token absent'
  })

  await check('C17', 'legacy brand token is absent from docs, source, package and lockfile', async () => {
    const docFiles = [
      path.join(ROOT, 'README.md'),
      path.join(ROOT, 'VERIFICATION.md'),
      path.join(ROOT, 'package.json'),
      path.join(ROOT, 'bun.lock'),
      path.join(ROOT, '.env.example'),
      path.join(ROOT, 'bunfig.toml'),
      path.join(ROOT, 'furin.config.ts'),
      path.join(ROOT, 'furin-env.d.ts'),
      path.join(ROOT, 'tsconfig.json'),
      path.join(ROOT, 'vitest.config.ts'),
    ].filter((file) => existsSync(file))
    const sourceFiles = walkFiles(path.join(ROOT, 'src'), (full) => /\.(ts|tsx|js|mjs|json|css)$/.test(full))
    const publicFiles = walkFiles(path.join(ROOT, 'public'), (full) => /\.(js|mjs|css|svg|json|txt)$/.test(full))
    const scriptFiles = [path.join(ROOT, 'scripts', 'verify.mjs')].filter((file) => existsSync(file))
    // The real runtime .env may legitimately contain upstream paths/keys and
    // is intentionally excluded from brand scans (and never written).
    const files = docFiles
      .concat(sourceFiles, publicFiles, scriptFiles)
      .filter((file) => path.basename(file) !== '.env')
    const hits = brandHits(files)
    evidence.docScan = {
      files: files.length,
      docs: docFiles.map((file) => path.relative(ROOT, file)),
      hits: hits,
      envFilesExcluded: ['.env'],
      envExampleValueLinesExcluded: true,
      envExampleValueBrandPresent: containsBrand(fileText(path.join(ROOT, '.env.example'))),
    }
    assert(hits.length === 0, 'legacy brand token found in docs/source: ' + hits.join(', '))
    return files.length + ' doc/source files scanned (README, VERIFICATION, package, bun.lock, bunfig/furin configs, src, public, verifier); token absent'
  })

  await check('C18', 'server-side BALANCE_API_KEY sentinel is never exposed', async () => {
    const pages = [home, await fetchPage('/nope')]
    const htmlHits = []
    for (const page of pages) {
      if (page.text.indexOf(SENTINEL_SECRET) !== -1) htmlHits.push('page')
    }
    assert(htmlHits.length === 0, 'sentinel token leaked into HTML: ' + htmlHits.join(', '))
    const clientFiles = walkFiles(CLIENT_DIR, (full) => full.endsWith('.js'))
    const clientHits = clientFiles.filter((file) => fileText(file).indexOf(SENTINEL_SECRET) !== -1)
    assert(clientHits.length === 0, 'sentinel token leaked into client JS: ' + clientHits.map((f) => path.basename(f)).join(', '))
    evidence.sentinel = { htmlPages: pages.length, clientFiles: clientFiles.length, hits: [] }
    return 'BALANCE_API_KEY sentinel configured server-side; absent from HTML and ' + clientFiles.length + ' client JS files'
  })

  await check('C19', 'client bundle is free of identifiers, env names, removed routes and insights', async () => {
    const files = walkFiles(CLIENT_DIR, (full) => full.endsWith('.js'))
    assert(files.length > 0, 'no client JS files found')
    const forbidden = [
      FORBIDDEN_BRAND,
      'BALANCE_API_URL',
      'BALANCE_API_KEY',
      LEGACY_AUTH_ENV,
      '/api/',
      '/settings',
      'data-settings-page',
      'data-streamed-insights',
      'data-insights-skeleton',
      '用量洞察',
    ].concat(RAW_IDENTIFIERS, FORBIDDEN_USER_FRAGMENTS)
    const hits = []
    let totalBytes = 0
    for (const file of files) {
      const text = fileText(file)
      totalBytes += text.length
      for (const needle of forbidden) {
        if (text.indexOf(needle) !== -1) hits.push(path.basename(file) + ':' + needle)
      }
    }
    evidence.clientScan = { files: files.length, totalBytes: totalBytes, hits: hits }
    assert(hits.length === 0, 'client bundle contains forbidden strings: ' + hits.join(', '))
    return files.length + ' JS files / ' + totalBytes + ' bytes scanned; no brand/env/raw identifiers/removed routes/insights'
  })

  await check('C20', 'Bun auto-loads .env (isolated probe) and app fallback uses explicit env', async () => {
    // Never write the repo .env: create a throwaway directory + .env and let a
    // Bun child load it there. This preserves the user's real relay file.
    const probeDir = path.join(ROOT, '.tmp', 'env-probe-' + process.pid)
    const tempLog = []
    let tempChild = null
    let cleanup = null
    let readyMs = 0
    let observed = null
    let leaks = []
    let probeResult = null
    try {
      rmSync(probeDir, { recursive: true, force: true })
      mkdirSync(probeDir, { recursive: true })
      writeFileSync(
        path.join(probeDir, '.env'),
        [
          'BALANCE_API_URL=http://127.0.0.1:9/verify-unreachable',
          'BALANCE_API_KEY=' + ENV_SENTINEL_SECRET,
          'BALANCE_CACHE_TTL_SECONDS=1',
          'BALANCE_API_TIMEOUT_MS=500',
          '',
        ].join('\n'),
      )
      const probeScript = path.join(probeDir, 'probe.mjs')
      writeFileSync(
        probeScript,
        "console.log(JSON.stringify({url:process.env.BALANCE_API_URL||'',key:process.env.BALANCE_API_KEY||'',ttl:process.env.BALANCE_CACHE_TTL_SECONDS||'',timeout:process.env.BALANCE_API_TIMEOUT_MS||''}))\n",
      )
      const probeEnv = Object.assign({}, process.env)
      for (const key of ['BALANCE_API_URL', 'BALANCE_API_KEY', 'BALANCE_CACHE_TTL_SECONDS', 'BALANCE_API_TIMEOUT_MS', LEGACY_AUTH_ENV]) {
        delete probeEnv[key]
      }
      const probeRun = spawnSync(BUN_BIN, [probeScript], { cwd: probeDir, env: probeEnv, encoding: 'utf8' })
      assert(probeRun.status === 0, 'isolated Bun .env probe failed: ' + String(probeRun.stderr || '').slice(-300))
      const probeLine = String(probeRun.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}'
      probeResult = JSON.parse(probeLine)
      assert(probeResult.url === 'http://127.0.0.1:9/verify-unreachable', 'Bun did not auto-load BALANCE_API_URL from isolated .env: ' + JSON.stringify(probeResult))
      assert(probeResult.key === ENV_SENTINEL_SECRET, 'Bun did not auto-load BALANCE_API_KEY from isolated .env')
      assert(probeResult.ttl === '1' && probeResult.timeout === '500', 'Bun did not auto-load TTL/timeout from isolated .env: ' + JSON.stringify(probeResult))

      // App fallback is exercised with explicit child env (empty values are
      // overridden by the object below), never with the repo .env.
      assert(!(await portListening(TEMP_PORT, 500)), 'port ' + TEMP_PORT + ' is already in use; refusing to reuse it')
      tempChild = spawnServerProcess(
        buildIsolatedEnv(TEMP_PORT, {
          BALANCE_API_URL: 'http://127.0.0.1:9/verify-unreachable',
          BALANCE_API_KEY: ENV_SENTINEL_SECRET,
          BALANCE_CACHE_TTL_SECONDS: '1',
          BALANCE_API_TIMEOUT_MS: '500',
        }),
        tempLog,
      )
      readyMs = await waitForReady(TEMP_PORT, tempChild, 30000)
      const page = await fetchPage('/', BROWSER_UA, HTML_ACCEPT, TEMP_BASE)
      assert(page.status === 200, 'temp server home expected 200, got ' + page.status)
      assert(page.text.indexOf('"ttlSeconds":1') !== -1, 'explicit BALANCE_CACHE_TTL_SECONDS=1 not applied')
      assert(page.text.indexOf('不可达') !== -1, 'explicit BALANCE_API_URL not applied (fallback warning missing)')
      assert(page.text.indexOf('未配置中转站 API Key') === -1, 'explicit BALANCE_API_KEY was not applied (missing-key warning present)')
      assert(page.text.indexOf('"mode":"fixture"') !== -1, 'temp source mode is not fixture')
      observed = { ttl: 1, warning: '内网余额接口不可达', mode: 'fixture', keySuppliedExplicitly: true }
      const surfaces = [page]
      const notFound = await fetchPage('/nope', BROWSER_UA, HTML_ACCEPT, TEMP_BASE)
      surfaces.push(notFound)
      leaks = []
      if (surfaces[0].text.indexOf(ENV_SENTINEL_SECRET) !== -1) leaks.push('home')
      if (surfaces[1].text.indexOf(ENV_SENTINEL_SECRET) !== -1) leaks.push('404')
      const clientLeaks = walkFiles(CLIENT_DIR, (full) => full.endsWith('.js')).filter(
        (file) => fileText(file).indexOf(ENV_SENTINEL_SECRET) !== -1,
      )
      if (clientLeaks.length > 0) leaks.push('client-js')
      assert(leaks.length === 0, 'explicit key sentinel leaked into: ' + leaks.join(', '))
    } finally {
      if (tempChild) cleanup = await stopChild(tempChild, TEMP_PORT)
      rmSync(probeDir, { recursive: true, force: true })
    }
    assert(probeResult !== null, 'isolated Bun .env probe did not return a result')
    assert(cleanup !== null, '.env fallback probe server was not cleaned up')
    assert(cleanup.portFree === true, 'temp port ' + TEMP_PORT + ' still accepting connections after .env probe')
    assert(cleanup.processAlive === false, '.env fallback probe child still alive')
    evidence.envAutoLoad = {
      isolatedBunProbe: probeResult,
      readyMs: readyMs,
      observed: observed,
      keyLeakSurfaces: leaks,
      tempPortFree: cleanup.portFree,
      repoEnvTouched: false,
    }
    return 'isolated Bun .env probe loaded URL/key/TTL; app fallback via explicit env; repo .env untouched'
  })

  // --- task-7 layout / server-search checks -------------------------------
  await check('C22', 'hero copy is exact and in the required order', async () => {
    const html = home.text
    const strings = [HERO_H1].concat(HERO_PARAGRAPHS, [HERO_CALLOUT, HERO_CLOSING])
    const positions = strings.map((text) => html.indexOf(text))
    positions.forEach((position, index) => {
      assert(position !== -1, 'hero copy missing: ' + strings[index])
    })
    for (let i = 1; i < positions.length; i += 1) {
      assert(positions[i] > positions[i - 1], 'hero copy out of order at: ' + strings[i])
    }
    assert(html.indexOf(LEGACY_HERO_TITLE) === -1, 'legacy hero title is still present: ' + LEGACY_HERO_TITLE)
    const h1Count = (html.match(/<h1[\s>]/g) || []).length
    assert(h1Count === 1, 'expected exactly one <h1>, found ' + h1Count)
    const calloutIndex = html.indexOf(HERO_CALLOUT)
    const calloutMarkup = html.slice(Math.max(0, calloutIndex - 260), calloutIndex)
    assert(calloutMarkup.indexOf('font-semibold') !== -1, 'hero callout is not bold')
    evidence.hero = {
      positions: positions,
      h1Count: h1Count,
      legacyTitleAbsent: true,
    }
    return 'exact h1 + ' + HERO_PARAGRAPHS.length + ' paragraphs + bold callout + closing in order; legacy hero title absent'
  })

  await check('C23', 'section order: hero < search form < accounts < usage overview', async () => {
    const html = home.text
    const positions = {
      hero: html.indexOf(HERO_H1),
      search: html.indexOf('data-server-search'),
      accounts: html.indexOf('id="accounts-heading"'),
      usage: html.indexOf('id="usage-heading"'),
      firstCard: html.indexOf('data-account-card'),
      lastCard: html.lastIndexOf('data-account-card'),
    }
    evidence.sectionOrder = positions
    for (const key of Object.keys(positions)) {
      assert(positions[key] !== -1, 'section marker missing: ' + key)
    }
    assert(positions.hero < positions.search, 'search form is not after the hero')
    assert(positions.search < positions.firstCard, 'account cards are not after the search form')
    assert(positions.firstCard > positions.accounts, 'account cards are not inside the accounts section')
    assert(positions.lastCard < positions.usage, 'usage overview is not after the account cards')
    assert(positions.accounts < positions.usage, 'usage overview is not after the accounts heading')
    const headingBeforeSearch = positions.accounts < positions.search
    evidence.sectionOrder.headingBeforeSearch = headingBeforeSearch
    return 'hero < search form < account cards < 用量概览 (' + JSON.stringify(positions) + '); accounts section label "' + (headingBeforeSearch ? '魔力 appears before the search form' : 'appears after the search form') + '"'
  })

  await check('C24', 'top bar and theme toggle removed; theming is host-driven', async () => {
    const html = home.text
    assert(!existsSync(path.join(ROOT, 'src', 'components', 'site-header.tsx')), 'site header component still exists')
    assert(html.indexOf('sticky top-0') === -1, 'sticky top bar class remains in HTML')
    assert(!/<nav[\s>]/i.test(html), 'navigation element remains in HTML')
    assert(html.indexOf('role="navigation"') === -1, 'navigation role remains in HTML')
    assert(html.indexOf('余额面板首页') === -1, 'old site-header home link remains')
    assert(html.indexOf('aria-label="主题模式"') === -1, 'theme toggle group still rendered')
    assert(html.indexOf('fixed top-4 right-4') === -1, 'floating theme wrapper still rendered')
    for (const removed of [
      path.join('src', 'components', 'theme-toggle.tsx'),
      path.join('src', 'hooks', 'use-theme-mode.ts'),
    ]) {
      assert(!existsSync(path.join(ROOT, removed)), 'removed theme UI file still exists: ' + removed)
    }
    assert(html.indexOf('ThemeToggle') === -1, 'ThemeToggle reference remains in the HTML')
    const bridgeCount = (html.match(/window\.addEventListener\('message'/g) || []).length
    assert(bridgeCount === 1, 'expected exactly one early host theme listener, found ' + bridgeCount)
    evidence.topBar = {
      siteHeaderFile: false,
      stickyTopBar: false,
      nav: false,
      themeToggle: false,
      hostThemeListeners: bridgeCount,
    }
    return 'no site header/nav/sticky top bar and no theme toggle; one early message listener receives new-api themeMode'
  })

  await check('C25', 'server-loadable search form with hidden filters (GET works without JS)', async () => {
    const html = home.text
    const formStart = html.indexOf('<form')
    const formEnd = html.indexOf('</form>', formStart)
    assert(formStart !== -1 && formEnd !== -1, 'search form not found')
    const form = html.slice(formStart, formEnd + 7)
    for (const attr of ['role="search"', 'action="/"', 'method="get"', 'data-server-search']) {
      assert(form.indexOf(attr) !== -1, 'search form missing ' + attr)
    }
    const hidden = hiddenFilterValues(html)
    assert(hidden.status === 'all' && hidden.sort === 'recent' && hidden.view === 'grid', 'default hidden filters are wrong: ' + JSON.stringify(hidden))
    assert(JSON.stringify(Object.keys(hidden).sort()) === '["sort","status","view"]', 'unexpected hidden filter fields: ' + JSON.stringify(Object.keys(hidden)))
    assert(form.indexOf('name="range"') === -1, 'removed 7/14/30-day range filter is still a form input')
    assert(form.indexOf('name="q"') !== -1 && form.indexOf('type="search"') !== -1, 'search input is missing name="q"/type="search"')
    assert(form.indexOf('type="submit"') !== -1 && form.indexOf('搜索') !== -1, 'submit button "搜索" is missing')
    const open = await fetchPage('/?q=open')
    assert(open.status === 200, '/?q=open expected 200, got ' + open.status)
    const openCount = filteredCountText(open.text)
    assert(/显示\s*1\s*\/\s*4/.test(openCount), 'GET /?q=open count is not 1 / 4: ' + openCount)
    assert(open.text.indexOf('Open Design') !== -1, 'GET /?q=open did not filter to Open Design')
    const error = await fetchPage('/?status=error')
    assert(error.status === 200, '/?status=error expected 200, got ' + error.status)
    const errorHidden = hiddenFilterValues(error.text)
    assert(errorHidden.status === 'error', 'server-rendered hidden status was not preserved on /?status=error')
    const errorCount = filteredCountText(error.text)
    assert(/显示\s*1\s*\/\s*4/.test(errorCount), 'GET /?status=error count is not 1 / 4: ' + errorCount)
    const customFirst = await fetchPage('/?q=open&status=all&sort=usage&view=list')
    const redirects = []
    let custom = customFirst
    for (let i = 0; i < 4 && custom.status >= 300 && custom.status < 400 && custom.headers.location; i += 1) {
      redirects.push(custom.status + ' ' + custom.headers.location)
      custom = await fetchPage(custom.headers.location)
    }
    assert(custom.status === 200, 'custom filtered URL did not resolve to 200 (first=' + customFirst.status + ')')
    const customHidden = hiddenFilterValues(custom.text)
    assert(customHidden.sort === 'usage' && customHidden.view === 'list' && customHidden.status === 'all', 'hidden filters not preserved on custom URL: ' + JSON.stringify(customHidden))
    assert(custom.text.indexOf('value="open"') !== -1, 'search input did not preserve q=open in server HTML')

    // The upstream balance API exposes no daily usage, so the range filter,
    // the daily bars and the cumulative-usage tile must stay removed.
    for (const removedText of ['统计区间', '累计用量', '天用量']) {
      assert(html.indexOf(removedText) === -1, 'removed usage feature text is still rendered: ' + removedText)
    }
    assert(!existsSync(path.join(ROOT, 'src', 'components', 'daily-usage-bars.tsx')), 'removed daily usage bars component still exists')

    evidence.serverSearch = {
      defaults: hidden,
      errorHidden: errorHidden,
      customHidden: customHidden,
      customFirstStatus: customFirst.status,
      customRedirects: redirects,
      openCount: openCount,
      errorCount: errorCount,
      hiddenFields: Object.keys(hidden).sort(),
      removedUsage: {
        rangeLabelAbsent: true,
        cumulativeStatAbsent: true,
        dailyTextAbsent: true,
        dailyBarsComponentAbsent: true,
        rangeInputAbsent: true,
      },
    }
    const canonical = redirects.length > 0 ? ' (default params canonicalised: ' + redirects.join(' -> ') + ')' : ''
    return 'form action="/" method="get" data-server-search + hidden status/sort/view only + submit; GET ?q=open and ?status=error filter server-side; ?q=open&sort=usage&view=list preserves sort/view; no 统计区间/累计用量/天用量 and no daily-bars component' + canonical
  })

  await check('C26', 'navigation keeps scroll (resetScroll:false); page data refreshes via router.refresh(); client may only call /feed/routing (data) and /feed/refresh (cache invalidation)', async () => {
    const toolbar = fileText(path.join(ROOT, 'src', 'features', 'dashboard', 'dashboard-toolbar.tsx'))
    const page = fileText(path.join(ROOT, 'src', 'features', 'dashboard', 'dashboard-page.tsx'))
    const toolbarReset = (toolbar.match(/resetScroll:\s*false/g) || []).length
    const pageReset = (page.match(/resetScroll:\s*false/g) || []).length
    // 提交搜索仍然是 furin 的客户端 navigation；要守住的是“任何变化都不许把页面
    // 滚回顶部”，以及筛选切换不再导航（它们只改本地状态）。
    assert(toolbarReset >= 1, 'expected resetScroll:false in the toolbar navigation, found ' + toolbarReset)
    assert(pageReset >= 1, 'expected resetScroll:false on the empty-state reset, found ' + pageReset)
    assert(toolbar.indexOf('resetScroll: true') === -1, 'a resetScroll:true navigation remains in the toolbar')
    assert(page.indexOf('resetScroll: true') === -1, 'a resetScroll:true navigation remains in the page')
    // 筛选（status/sort/view）必须是本地状态：工具栏把变化交给 onFilterChange，
    // 由 dashboard-page.tsx 的 useState 承接，不产生任何 URL 导航/数据请求。
    assert(toolbar.indexOf('onFilterChange') !== -1, 'toolbar no longer reports filter changes locally')
    assert(toolbar.indexOf('commitSearch({ status') === -1, 'status filter still navigates (would refetch)')
    assert(toolbar.indexOf('commitSearch({ sort') === -1, 'sort filter still navigates (would refetch)')
    assert(toolbar.indexOf('commitSearch({ view') === -1, 'view filter still navigates (would refetch)')
    assert(page.indexOf('useState<DashboardSearch[\'status\']>') !== -1, 'page does not hold the status filter as local state')
    // 长驻 iframe 靠 furin 的原地 refresh 跟上新数据：重跑 loader、不新增历史、
    // 不重置滚动，也绝不直接打上游。真正的网络请求只属于路由层。
    const refreshHook = path.join(ROOT, 'src', 'features', 'dashboard', 'use-dashboard-refresh.ts')
    assert(existsSync(refreshHook), 'src/features/dashboard/use-dashboard-refresh.ts is missing (60s in-place refresh)')
    const refreshHookText = fileText(refreshHook)
    assert(refreshHookText.indexOf('router.refresh()') !== -1, 'dashboard refresh hook does not call router.refresh()')
    assert(refreshHookText.indexOf('fetch(') === -1, 'dashboard refresh hook must not fetch upstream directly')
    // 节奏是 60 秒一轮（和 ISR 的 revalidate 对齐），不是“越快越好”。
    assert(
      refreshHookText.indexOf('DASHBOARD_REFRESH_INTERVAL_MS = 60_000') !== -1,
      'dashboard refresh interval must stay at 60 seconds',
    )
    // 自动刷新必须先让服务端的 ISR 条目失效：只调 router.refresh() 会命中 60 秒的
    // 旧条目，页面每轮都发请求、拿回的却始终是加载时那份快照（数据年龄涨到
    // 一两分钟）。同时这一步不能强制重读上游，否则等于绕过余额 TTL 打上游。
    assert(
      refreshHookText.indexOf('requestServerRefresh') !== -1,
      'dashboard refresh hook does not invalidate the server cache before refreshing',
    )
    assert(
      refreshHookText.indexOf('reloadUpstream: false') !== -1,
      'automatic refresh must not force an upstream read (reloadUpstream: false)',
    )
    // 手动刷新也算一次更新：完成后把 60 秒的节奏从头算起，不能点完几秒又自动刷一次。
    assert(
      refreshHookText.indexOf('restartCadence') !== -1,
      'manual refresh does not reset the automatic refresh cadence',
    )
    const serverOnlyRoots = [
      path.join(ROOT, 'src', 'server'),
      path.join(ROOT, 'src', 'api'),
      path.join(ROOT, 'src', 'pages'),
    ]
    const clientFiles = walkFiles(
      path.join(ROOT, 'src'),
      (full) => /\.(ts|tsx)$/.test(full) && full.indexOf('__tests__') === -1,
    ).filter((file) => serverOnlyRoots.every((root) => file.indexOf(root) !== 0))
    const streamFile = path.join(ROOT, 'src', 'features', 'routing', 'use-routing-stream.ts')
    // 手动刷新是唯一的第二条客户端请求：它不取数据，只 POST 一次让服务端失效缓存。
    const refreshRequestFile = path.join(ROOT, 'src', 'features', 'dashboard', 'refresh-request.ts')
    assert(existsSync(refreshRequestFile), 'src/features/dashboard/refresh-request.ts is missing (manual refresh request)')
    const fetchAllowed = [streamFile, refreshRequestFile]
    const fetchHits = []
    for (const file of clientFiles) {
      const text = fileText(file)
      for (const pattern of ['fetch(', 'axios', 'useSWR']) {
        if (text.indexOf(pattern) !== -1 && fetchAllowed.indexOf(file) === -1) {
          fetchHits.push(path.relative(ROOT, file) + ':' + pattern)
        }
      }
    }
    assert(fetchHits.length === 0, 'client data fetching remains outside the routing stream and the refresh endpoint: ' + fetchHits.join(', '))
    const stream = fileText(streamFile)
    assert(stream.indexOf('fetch(') !== -1, 'routing stream no longer polls the feed')
    assert(stream.indexOf('/feed/routing?after=') !== -1, 'routing stream does not poll /feed/routing?after=')
    const refreshRequest = fileText(refreshRequestFile)
    assert(refreshRequest.indexOf("'/feed/refresh'") !== -1, 'refresh request helper does not POST /feed/refresh')
    // 同一个接口的两个模式：自动刷新带 reload=0（只失效 ISR），手动刷新强制重读上游。
    assert(refreshRequest.indexOf('reload=0') !== -1, 'refresh helper has no non-forcing (reload=0) mode for the automatic refresh')
    assert(refreshRequest.indexOf('reloadUpstream') !== -1, 'refresh helper does not expose the upstream-reload switch')
    const navigateCalls = (toolbar.match(/\bnavigate\(/g) || []).length
    assert(navigateCalls >= 1, 'toolbar no longer navigates on submit')
    evidence.scrollWiring = {
      toolbarReset: toolbarReset,
      pageReset: pageReset,
      navigateCalls: navigateCalls,
      clientFetchFiles: clientFiles.length,
      clientFetchHits: fetchHits,
      allowedClientFetch: path.relative(ROOT, streamFile),
      allowedClientMutation: path.relative(ROOT, refreshRequestFile),
      refreshHook: path.relative(ROOT, refreshHook),
      refreshUsesRouter: true,
      refreshDirectFetch: false,
    }
    return 'resetScroll:false x' + toolbarReset + ' in toolbar, x' + pageReset + ' in page, no resetScroll:true; filters are local state (no navigate); ' + navigateCalls + ' toolbar navigate() call (submit); periodic + manual page refresh use router.refresh(); client network is only /feed/routing?after= (data) and POST /feed/refresh (cache invalidation, no data)'
  })

  // --- task-8 relay Bearer auth checks ------------------------------------
  await check('C27', 'relay auth contract: BALANCE_API_KEY, Bearer normalization, retired env removed', async () => {
    const envExample = fileText(path.join(ROOT, '.env.example'))
    assert(envExample.indexOf('BALANCE_API_KEY') !== -1, '.env.example does not define BALANCE_API_KEY')
    assert(envExample.indexOf(LEGACY_AUTH_ENV) === -1, '.env.example still contains the retired auth env name')
    const authSource = fileText(path.join(ROOT, 'src', 'lib', 'balance', 'auth.ts'))
    assert(authSource.indexOf("DEFAULT_AUTH_SCHEME = 'Bearer'") !== -1, 'default Bearer scheme is missing')
    assert(authSource.indexOf('replace(/^Bearer') !== -1, 'Bearer-prefix normalization is missing')
    const testSource = fileText(path.join(ROOT, 'src', 'lib', 'balance', '__tests__', 'derive.test.ts'))
    assert(testSource.toLowerCase().indexOf('relay station authentication') !== -1, 'relay auth tests are missing')
    assert(testSource.indexOf("'Bearer sk-relay-123'") !== -1, 'expected Bearer header assertions are missing')
    const readme = fileText(path.join(ROOT, 'README.md'))
    assert(readme.indexOf('BALANCE_API_KEY') !== -1, 'README does not document BALANCE_API_KEY')
    assert(readme.indexOf(LEGACY_AUTH_ENV) === -1, 'README still contains the retired auth env name')
    const scanFiles = walkFiles(path.join(ROOT, 'src'), (full) => /\.(ts|tsx)$/.test(full)).concat([
      path.join(ROOT, 'README.md'),
      path.join(ROOT, 'VERIFICATION.md'),
      path.join(ROOT, '.env.example'),
      path.join(ROOT, 'package.json'),
      path.join(ROOT, 'bun.lock'),
      path.join(ROOT, 'scripts', 'verify.mjs'),
    ])
    const legacyHits = scanFiles.filter((file) => fileText(file).indexOf(LEGACY_AUTH_ENV) !== -1)
    evidence.authContract = {
      envExampleHasKey: true,
      bearerNormalization: true,
      authTests: true,
      legacyHits: legacyHits.map((file) => path.relative(ROOT, file)),
    }
    assert(legacyHits.length === 0, 'retired auth env name remains in source/docs: ' + legacyHits.map((f) => path.relative(ROOT, f)).join(', '))
    return 'BALANCE_API_KEY in env/README; Bearer default + prefix normalization in auth.ts/tests; retired env name absent from source/docs'
  })

  await check('C28', 'live relay request sends exactly one Bearer header and renders live mode', async () => {
    assert(!(await portListening(LIVE_PORT, 500)), 'port ' + LIVE_PORT + ' is already in use for the live relay probe')
    const payload = JSON.parse(fileText(path.join(ROOT, 'src', 'server', 'fixtures', 'balances.json')))
    const mock = await startMockRelay(payload)
    const liveLog = []
    let liveChild = null
    let cleanup = null
    try {
      liveChild = spawnServerProcess(
        buildIsolatedEnv(LIVE_PORT, {
          BALANCE_API_URL: 'http://' + HOST + ':' + mock.port + '/relay/balances',
          BALANCE_API_KEY: MOCK_RELAY_KEY,
          BALANCE_CACHE_TTL_SECONDS: '60',
          BALANCE_API_TIMEOUT_MS: '3000',
        }),
        liveLog,
      )
      await waitForReady(LIVE_PORT, liveChild, 30000)
      const page = await fetchPage('/', BROWSER_UA, HTML_ACCEPT, LIVE_BASE)
      authHtml.push(page)
      assert(page.status === 200, 'live home expected 200, got ' + page.status)
      assert(page.text.indexOf('"mode":"live"') !== -1, 'live dashboard did not report live source mode')
      assert(page.text.indexOf('实时数据') !== -1, 'live badge is missing')
      assert(page.text.indexOf('未配置内网余额接口') === -1, 'fixture/no-URL warning present in live mode')
      assert(/"user":"\*+"/.test(page.text), 'live page is missing fully redacted user values')
      for (const fragment of FORBIDDEN_USER_FRAGMENTS) {
        assert(page.text.indexOf(fragment) === -1, 'live page leaked a user fragment: ' + fragment)
      }
      for (const raw of RAW_IDENTIFIERS) {
        assert(page.text.indexOf(raw) === -1, 'live page leaked a raw identifier')
      }
      assert(page.text.indexOf(MOCK_RELAY_KEY) === -1, 'relay API key leaked into live HTML')
      assert(mock.requests.length === 1, 'expected exactly one upstream request, got ' + mock.requests.length)
      const request = mock.requests[0]
      const authorization = request.headers.authorization
      assert(request.method === 'GET', 'upstream method is not GET: ' + request.method)
      assert(request.url === '/relay/balances', 'upstream URL is not /relay/balances: ' + request.url)
      assert(typeof authorization === 'string', 'expected exactly one Authorization header, got ' + JSON.stringify(authorization))
      assert(authorization === 'Bearer ' + MOCK_RELAY_KEY, 'Authorization is not the single default Bearer header: ' + JSON.stringify(authorization))
      assert(!/Bearer\s+Bearer/i.test(authorization), 'duplicate Bearer scheme detected: ' + JSON.stringify(authorization))
      evidence.liveRelay = {
        status: page.status,
        sourceMode: 'live',
        requestCount: mock.requests.length,
        requestMethod: request.method,
        requestPath: request.url,
        authorization: authorization,
        maskedUsersPresent: true,
        rawIdentifiersAbsent: true,
        keyAbsentFromHtml: true,
      }
    } finally {
      if (liveChild) cleanup = await stopChild(liveChild, LIVE_PORT)
      await mock.close()
    }
    assert(cleanup !== null, 'live relay probe server was not cleaned up')
    assert(cleanup.portFree === true, 'live relay probe port still listening')
    assert(cleanup.processAlive === false, 'live relay probe child still alive')
    return 'one GET /relay/balances; Authorization="Bearer <sentinel>"; live mode + masked HTML; no duplicate scheme/key leak'
  })

  await check('C29', 'missing relay API key falls back to fixture without calling upstream', async () => {
    assert(!(await portListening(MISSING_KEY_PORT, 500)), 'port ' + MISSING_KEY_PORT + ' is already in use for the missing-key probe')
    const payload = JSON.parse(fileText(path.join(ROOT, 'src', 'server', 'fixtures', 'balances.json')))
    const mock = await startMockRelay(payload)
    const noKeyLog = []
    let noKeyChild = null
    let cleanup = null
    try {
      noKeyChild = spawnServerProcess(
        buildIsolatedEnv(MISSING_KEY_PORT, {
          BALANCE_API_URL: 'http://' + HOST + ':' + mock.port + '/relay/balances',
          BALANCE_CACHE_TTL_SECONDS: '60',
        }),
        noKeyLog,
      )
      await waitForReady(MISSING_KEY_PORT, noKeyChild, 30000)
      const page = await fetchPage('/', BROWSER_UA, HTML_ACCEPT, MISSING_KEY_BASE)
      authHtml.push(page)
      assert(page.status === 200, 'missing-key home expected 200, got ' + page.status)
      assert(page.text.indexOf('未配置中转站 API Key') !== -1, 'missing-key warning is absent')
      assert(page.text.indexOf('"mode":"fixture"') !== -1, 'missing-key source mode is not fixture')
      assert(page.text.indexOf('"mode":"live"') === -1, 'missing-key page unexpectedly reports live mode')
      assert(/"user":"\*+"/.test(page.text), 'missing-key page is missing fully redacted user values')
      for (const fragment of FORBIDDEN_USER_FRAGMENTS) {
        assert(page.text.indexOf(fragment) === -1, 'missing-key page leaked a user fragment: ' + fragment)
      }
      assert(mock.requests.length === 0, 'missing-key app called upstream ' + mock.requests.length + ' time(s)')
      evidence.missingKey = {
        status: page.status,
        sourceMode: 'fixture',
        warning: '未配置中转站 API Key',
        upstreamRequests: mock.requests.length,
        maskedUsersPresent: true,
      }
    } finally {
      if (noKeyChild) cleanup = await stopChild(noKeyChild, MISSING_KEY_PORT)
      await mock.close()
    }
    assert(cleanup !== null, 'missing-key probe server was not cleaned up')
    assert(cleanup.portFree === true, 'missing-key probe port still listening')
    assert(cleanup.processAlive === false, 'missing-key probe child still alive')
    return 'URL configured + key missing -> fixture warning, masked HTML, 0 upstream requests, clean shutdown'
  })

  // --- task-9 cache-refresh check -----------------------------------------
  await check('C40', 'expired balance cache is awaited on ISR regeneration (miss, not stale) and refreshes in place', async () => {
    assert(!(await portListening(REFRESH_PORT, 500)), 'port ' + REFRESH_PORT + ' is already in use for the refresh probe')
    const basePayload = JSON.parse(fileText(path.join(ROOT, 'src', 'server', 'fixtures', 'balances.json')))
    // data[3] 是 Open Design：fixture 里唯一带 balance 的账户，account-parts.tsx 会
    // 渲染它；/?q=open 又只会保留这一条，所以 marker 只会出现在该账户上。
    assert(basePayload.data[3] && basePayload.data[3].provider === 'opendesign', 'fixture data[3] is not the Open Design account')
    const issued = []
    const mock = await startMockRelay((index) => {
      const marker = '$' + (index + 2) + '.00'
      const payload = JSON.parse(JSON.stringify(basePayload))
      payload.data[3].balance = marker
      issued.push(marker)
      return payload
    })
    const refreshLog = []
    let refreshChild = null
    let cleanup = null
    let firstBalance = ''
    let secondBalance = ''
    try {
      refreshChild = spawnServerProcess(
        buildIsolatedEnv(REFRESH_PORT, {
          BALANCE_API_URL: 'http://' + HOST + ':' + mock.port + '/relay/balances',
          BALANCE_API_KEY: MOCK_RELAY_KEY,
          BALANCE_CACHE_TTL_SECONDS: '1',
          BALANCE_API_TIMEOUT_MS: '2000',
        }),
        refreshLog,
      )
      await waitForReady(REFRESH_PORT, refreshChild, 30000)
      // waitForReady 已经渲染并缓存了 `/`（ISR），这一跳命中 ISR 缓存：payload 仍是
      // 一次 live + miss 的真实读取，上游只被调用过一次。
      const first = await fetchPage('/', BROWSER_UA, HTML_ACCEPT, REFRESH_BASE)
      authHtml.push(first)
      assert(first.status === 200, 'refresh probe home expected 200, got ' + first.status)
      assert(first.text.indexOf('"mode":"live"') !== -1, 'refresh probe home is not live mode')
      const firstData = furinData(first.text)
      assert(firstData && firstData.dashboard && firstData.dashboard.source, 'refresh probe home has no dashboard source payload')
      const firstSource = firstData.dashboard.source
      assert(firstSource.cache === 'miss', 'first live render cache state is not miss: ' + firstSource.cache)
      assert(mock.requests.length === 1, 'first live render expected exactly 1 upstream request, got ' + mock.requests.length)
      assert(issued.length === 1, 'mock relay issued ' + issued.length + ' payloads before the refresh')
      firstBalance = issued[0]
      assert(first.text.indexOf(firstBalance) !== -1, 'first page does not render its live balance marker: ' + firstBalance)
      // TTL=1s：等缓存过期后访问另一个 ISR 缓存键，loader 必须真的重跑一次。
      await sleep(1200)
      const second = await fetchPage('/?q=open', BROWSER_UA, HTML_ACCEPT, REFRESH_BASE)
      authHtml.push(second)
      assert(second.status === 200, 'refresh probe filtered page expected 200, got ' + second.status)
      assert(mock.requests.length >= 2, 'expired cache was not refreshed upstream: requests=' + mock.requests.length)
      const secondData = furinData(second.text)
      assert(secondData && secondData.dashboard && secondData.dashboard.source, 'filtered page has no dashboard source payload')
      const secondSource = secondData.dashboard.source
      assert(secondSource.cache === 'miss', 'expired cache served "' + secondSource.cache + '" instead of an awaited miss')
      assert(secondSource.cache !== 'stale', 'expired cache served stale data instead of awaiting the refresh')
      const firstAt = Date.parse(firstSource.fetchedAt)
      const secondAt = Date.parse(secondSource.fetchedAt)
      assert(Number.isFinite(firstAt) && Number.isFinite(secondAt), 'source.fetchedAt is not a parseable timestamp')
      assert(secondAt > firstAt, 'source.fetchedAt did not advance after the awaited refresh: ' + firstSource.fetchedAt + ' -> ' + secondSource.fetchedAt)
      secondBalance = issued[issued.length - 1]
      assert(secondBalance !== firstBalance, 'mock relay did not change the payload between requests: ' + secondBalance)
      assert(second.text.indexOf(secondBalance) !== -1, 'refreshed page does not render the new balance marker: ' + secondBalance)
      assert(second.text.indexOf(firstBalance) === -1, 'refreshed page still renders the pre-refresh balance marker: ' + firstBalance)
      // 健康路径上不该出现任何降级 badge（stale 的新旧文案都算）。
      assert(second.text.indexOf('缓存已过期') === -1, 'refreshed page still renders the retired stale badge')
      assert(second.text.indexOf('上游读取失败') === -1, 'refreshed page rendered the upstream-failure badge on a healthy refresh')
      evidence.refreshConsistency = {
        port: REFRESH_PORT,
        ttlSeconds: 1,
        upstreamRequests: mock.requests.length,
        isrUrls: ['/', '/?q=open'],
        first: { cache: firstSource.cache, fetchedAt: firstSource.fetchedAt, balance: firstBalance },
        second: { cache: secondSource.cache, fetchedAt: secondSource.fetchedAt, balance: secondBalance },
        staleBadgePresent: false,
      }
    } finally {
      if (refreshChild) cleanup = await stopChild(refreshChild, REFRESH_PORT)
      await mock.close()
    }
    assert(cleanup !== null, 'refresh probe server was not cleaned up')
    assert(cleanup.portFree === true, 'refresh probe port still listening')
    assert(cleanup.processAlive === false, 'refresh probe child still alive')
    return 'TTL=1s: first ISR render miss + 1 upstream; after expiry /?q=open awaited a second upstream, cache=miss (not stale), fetchedAt advanced, new balance ' + secondBalance + ' rendered in place; no stale/failure badge; clean shutdown'
  })

  // --- manual refresh button (POST /feed/refresh) --------------------------
  await check('C41', 'manual refresh endpoint invalidates the ISR entry so the page can refresh without a reload', async () => {
    const apiSource = fileText(path.join(ROOT, 'src', 'api', 'refresh.ts'))
    assert(apiSource.indexOf("'/feed/refresh'") !== -1, 'src/api/refresh.ts does not register /feed/refresh')
    assert(apiSource.indexOf('revalidatePath') !== -1, 'refresh API does not invalidate the page cache')
    assert(apiSource.indexOf('reloadBalanceSnapshot') !== -1, 'refresh API does not force an upstream read')
    const requestSource = fileText(path.join(ROOT, 'src', 'features', 'dashboard', 'refresh-request.ts'))
    assert(requestSource.indexOf("'/feed/refresh'") !== -1, 'client refresh helper does not call /feed/refresh')
    const toolbarSource = fileText(path.join(ROOT, 'src', 'features', 'dashboard', 'dashboard-toolbar.tsx'))
    assert(toolbarSource.indexOf('onRefresh') !== -1, 'toolbar has no refresh button wiring')
    const response = await fetch(BASE + '/feed/refresh', {
      method: 'POST',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    })
    const text = await response.text()
    const cacheControl = response.headers.get('cache-control') || ''
    assert(response.status === 200, 'POST /feed/refresh expected 200, got ' + response.status)
    assert(cacheControl.indexOf('no-store') !== -1, 'refresh endpoint response is cacheable: ' + cacheControl)
    let payload = null
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
    assert(payload !== null && payload.ok === true, 'refresh endpoint did not report ok: ' + text.slice(0, 160))
    assert(typeof payload.fetchedAt === 'string' && payload.fetchedAt.length > 0, 'refresh endpoint did not report fetchedAt')
    // ISR 条目被清掉之后，下一次文档请求必须能正常再生成（主服务器是 fixture 模式，不读上游）。
    const after = await fetchPage('/')
    assert(after.status === 200, 'home after refresh expected 200, got ' + after.status)
    assert(after.text.indexOf('data-ssr-dashboard') !== -1, 'home after refresh lost its SSR marker')
    assert(filteredCountText(after.text).indexOf('4 / 4') !== -1, 'home after refresh lost its accounts: ' + filteredCountText(after.text))
    // 真正证明“ISR 条目被清掉”的是快照时间：重新生成的页面必须是在刷新接口之后
    // 才读取的（fixture 模式每次读取都会生成新的 fetchedAt）。如果页面还是旧的 ISR
    // 缓存，它会带着首屏那次读取的更早时间戳。
    const afterData = furinData(after.text)
    assert(afterData && afterData.dashboard && afterData.dashboard.source, 'home after refresh has no dashboard source payload')
    const forcedAt = Date.parse(payload.fetchedAt)
    const regeneratedAt = Date.parse(afterData.dashboard.source.fetchedAt)
    assert(Number.isFinite(forcedAt) && Number.isFinite(regeneratedAt), 'refresh probe timestamps are not parseable')
    assert(
      regeneratedAt >= forcedAt,
      'home after refresh was served from the pre-refresh ISR entry: ' + afterData.dashboard.source.fetchedAt + ' is older than ' + payload.fetchedAt,
    )
    evidence.manualRefresh = {
      status: response.status,
      cacheControl: cacheControl,
      ok: payload.ok,
      mode: payload.mode,
      cache: payload.cache,
      fetchedAt: payload.fetchedAt,
      regeneratedStatus: after.status,
      regeneratedFetchedAt: afterData.dashboard.source.fetchedAt,
      regeneratedCount: filteredCountText(after.text),
    }
    return 'POST /feed/refresh -> 200 {ok:' + payload.ok + ', mode:' + payload.mode + ', cache:' + payload.cache + '} + no-store; revalidatePath wired; home regenerated after the forced read (' + payload.fetchedAt + ' -> ' + afterData.dashboard.source.fetchedAt + ')'
  })

  // --- 60 秒自动刷新：SPA 数据不可缓存 + 只失效不重读上游 ---------------------
  await check('C42', 'the 60s auto refresh receives a fresh render: SPA data is no-store and reload=0 only invalidates', async () => {
    // 1. SPA 数据响应（`?_furin=data`）必须不可缓存。否则浏览器会按
    //    `stale-while-revalidate` 把上一轮的 body 直接交给 fetch：请求照发、
    //    数据不新，页面显示的数据年龄一路涨到一两分钟（这正是被修掉的那个 bug）。
    const navData = await fetch(BASE + '/?_furin=data', { headers: { accept: 'application/x-ndjson' } })
    const navCacheControl = navData.headers.get('cache-control') || ''
    assert(navData.status === 200, 'GET /?_furin=data expected 200, got ' + navData.status)
    assert(navCacheControl.indexOf('no-store') !== -1, 'SPA data response is cacheable: ' + navCacheControl)
    assert(
      navCacheControl.indexOf('stale-while-revalidate') === -1,
      'SPA data response still allows stale-while-revalidate: ' + navCacheControl,
    )
    const navBody = await navData.text()
    assert(navBody.indexOf('fetchedAt') !== -1, 'SPA data response has no loader payload: ' + navBody.slice(0, 120))

    // 2. 自动刷新的失效请求：`reload=0` 只清 ISR 条目，不强制重读上游。
    const invalidate = await fetch(BASE + '/feed/refresh?reload=0', {
      method: 'POST',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    })
    const invalidateText = await invalidate.text()
    const invalidateCacheControl = invalidate.headers.get('cache-control') || ''
    assert(invalidate.status === 200, 'POST /feed/refresh?reload=0 expected 200, got ' + invalidate.status)
    assert(
      invalidateCacheControl.indexOf('no-store') !== -1,
      'invalidate response is cacheable: ' + invalidateCacheControl,
    )
    let invalidatePayload = null
    try {
      invalidatePayload = JSON.parse(invalidateText)
    } catch {
      invalidatePayload = null
    }
    assert(
      invalidatePayload !== null && invalidatePayload.ok === true,
      'invalidate endpoint did not report ok: ' + invalidateText.slice(0, 160),
    )
    assert(
      invalidatePayload.reload === false,
      'reload=0 must not force an upstream read, got reload=' + invalidatePayload.reload,
    )

    // 3. 失效后文档仍能正常再生成（no-store 只换头，不影响渲染与路由）。
    const after = await fetchPage('/')
    assert(after.status === 200, 'home after invalidation expected 200, got ' + after.status)
    assert(
      filteredCountText(after.text).indexOf('4 / 4') !== -1,
      'home after invalidation lost its accounts: ' + filteredCountText(after.text),
    )
    evidence.autoRefresh = {
      navDataStatus: navData.status,
      navDataCacheControl: navCacheControl,
      invalidateStatus: invalidate.status,
      invalidateCacheControl: invalidateCacheControl,
      reload: invalidatePayload.reload,
      mode: invalidatePayload.mode,
      regeneratedStatus: after.status,
      regeneratedCount: filteredCountText(after.text),
    }
    return 'GET /?_furin=data -> 200 "' + navCacheControl + '"; POST /feed/refresh?reload=0 -> 200 {ok:' + invalidatePayload.ok + ', reload:' + invalidatePayload.reload + ', mode:' + invalidatePayload.mode + '} + no-store; home still regenerates (' + filteredCountText(after.text) + ')'
  })

  await check('C30', 'retired auth env name and key sentinels are absent from HTML/build/docs', async () => {
    const pages = [home]
      .concat([await fetchPage('/nope')])
      .concat(authHtml)
    const keys = [SENTINEL_SECRET, ENV_SENTINEL_SECRET, MOCK_RELAY_KEY]
    const htmlHits = []
    for (const page of pages) {
      if (page.text.indexOf(LEGACY_AUTH_ENV) !== -1) htmlHits.push('html:legacy-env')
      for (const key of keys) {
        if (page.text.indexOf(key) !== -1) htmlHits.push('html:key')
      }
    }
    const clientFiles = walkFiles(CLIENT_DIR, (full) => full.endsWith('.js'))
    const clientHits = []
    for (const file of clientFiles) {
      const text = fileText(file)
      if (text.indexOf(LEGACY_AUTH_ENV) !== -1) clientHits.push(path.basename(file) + ':legacy-env')
      for (const key of keys) {
        if (text.indexOf(key) !== -1) clientHits.push(path.basename(file) + ':key')
      }
    }
    const buildFiles = walkFiles(BUILD_DIR, (full) => /\.(js|mjs|css)$/.test(full))
    const buildHits = []
    for (const file of buildFiles) {
      const text = fileText(file)
      if (text.indexOf(LEGACY_AUTH_ENV) !== -1) buildHits.push(path.relative(ROOT, file))
      for (const key of keys) {
        if (text.indexOf(key) !== -1) buildHits.push(path.relative(ROOT, file) + ':key')
      }
    }
    const docFiles = [
      path.join(ROOT, 'README.md'),
      path.join(ROOT, 'VERIFICATION.md'),
      path.join(ROOT, 'package.json'),
      path.join(ROOT, 'bun.lock'),
      path.join(ROOT, '.env.example'),
      path.join(ROOT, 'bunfig.toml'),
      path.join(ROOT, 'furin.config.ts'),
      path.join(ROOT, 'furin-env.d.ts'),
      path.join(ROOT, 'tsconfig.json'),
      path.join(ROOT, 'vitest.config.ts'),
      path.join(ROOT, 'scripts', 'verify.mjs'),
    ]
      .concat(walkFiles(path.join(ROOT, 'src'), (full) => /\.(ts|tsx)$/.test(full)))
      .filter((file) => path.basename(file) !== '.env')
    const docHits = docFiles.filter((file) => fileText(file).indexOf(LEGACY_AUTH_ENV) !== -1)
    evidence.authLeaks = {
      htmlPages: pages.length,
      clientFiles: clientFiles.length,
      buildFiles: buildFiles.length,
      htmlHits: htmlHits,
      clientHits: clientHits,
      buildHits: buildHits,
      docHits: docHits.map((file) => path.relative(ROOT, file)),
    }
    assert(htmlHits.length === 0, 'HTML contains retired env/key material: ' + htmlHits.join(', '))
    assert(clientHits.length === 0, 'client JS contains retired env/key material: ' + clientHits.join(', '))
    assert(buildHits.length === 0, 'build output contains retired env/key material: ' + buildHits.join(', '))
    assert(docHits.length === 0, 'docs/source contain retired auth env name: ' + docHits.map((f) => path.relative(ROOT, f)).join(', '))
    return pages.length + ' HTML pages + ' + clientFiles.length + ' client JS + ' + buildFiles.length + ' build files + docs scanned; no retired env name or key sentinel'
  })

  await check('C31', 'real .env preserved; .env.example sanitized; runtime env excluded from scans', async () => {
    const current = existsSync(ENV_FILE_PATH) ? readFileSync(ENV_FILE_PATH) : null
    assert(Boolean(INITIAL_ENV) === Boolean(current), '.env existence changed during verification')
    if (INITIAL_ENV && current) {
      assert(Buffer.compare(INITIAL_ENV, current) === 0, '.env bytes changed during verification')
    }
    const sha256 = current ? createHash('sha256').update(current).digest('hex') : null
    const envExamplePath = path.join(ROOT, '.env.example')
    const envExample = fileText(envExamplePath)
    assert(/^BALANCE_API_URL=$/m.test(envExample), '.env.example BALANCE_API_URL is not an empty placeholder')
    assert(/^BALANCE_API_KEY=$/m.test(envExample), '.env.example BALANCE_API_KEY is not an empty placeholder')
    assert(!/^BALANCE_API_URL=.+$/m.test(envExample), '.env.example BALANCE_API_URL has a non-empty value')
    assert(!/^BALANCE_API_KEY=.+$/m.test(envExample), '.env.example BALANCE_API_KEY has a non-empty value')
    const envExampleSha256 = createHash('sha256').update(envExample).digest('hex')
    evidence.envGuard = {
      existed: Boolean(INITIAL_ENV),
      bytes: current ? current.length : 0,
      sha256: sha256,
      preserved: true,
      envExampleSha256: envExampleSha256,
      envExampleSanitized: true,
      excludedFromBrandScan: true,
      excludedFromAuthScan: true,
    }
    return 'repo .env preserved byte-for-byte (' + (current ? current.length + ' bytes, sha256 ' + sha256.slice(0, 12) + '…' : 'absent') + '); .env.example URL/key placeholders empty; env excluded from scans'
  })

  await check('C32', 'provider names visible while only API users are masked', async () => {
    const html = home.text
    for (const visible of ['WorkBuddy', 'WorkBuddy AI', 'Open Design']) {
      assert(html.indexOf(visible) !== -1, 'expected visible provider/name text missing: ' + visible)
    }
    assert(html.indexOf('href="/providers') === -1, 'dashboard still links to the removed /providers route')
    assert(html.indexOf('"providerId"') === -1, 'opaque providerId is still serialized in the page data')
    assert(html.indexOf('"provider":"workbuddy"') !== -1, 'provider field is missing from the page data')
    assert(html.indexOf('"icon":"workbuddy-color"') !== -1, 'icon field is missing from the page data')
    for (const raw of RAW_IDENTIFIERS) {
      assert(html.indexOf(raw) === -1, 'raw user identifier leaked into dashboard HTML')
    }
    assert(/"user":"\*+"/.test(html), 'fully redacted user value missing from dashboard HTML')
    for (const fragment of FORBIDDEN_USER_FRAGMENTS) {
      assert(html.indexOf(fragment) === -1, 'user fragment remains in dashboard HTML: ' + fragment)
    }
    evidence.visibility = {
      dashboardNames: ['WorkBuddy', 'WorkBuddy AI', 'Open Design'],
      providerField: 'workbuddy',
      iconField: 'workbuddy-color',
      redactedUsers: REDACTED_USER,
      rawUsersAbsent: true,
      providerLinksAbsent: true,
    }
    return 'names/provider/icon visible; every user is "' + REDACTED_USER + '"; no provider links or raw/masked fragments'
  })

  await check('C33', 'full user redaction, opaque account ids and no user-search hint', async () => {
    const html = home.text
    const users = [...html.matchAll(/"user":"([^"]*)"/g)].map((match) => match[1])
    const ids = [...html.matchAll(/"id":"([^"]*)"/g)].map((match) => match[1])
    assert(
      users.length >= 4 && users.every((value) => /^\*+$/.test(value)),
      'dashboard users are not all equal-length asterisks: ' + JSON.stringify(users),
    )
    assert(ids.length >= 4, 'dashboard account ids are missing')
    for (const id of ids) {
      assert(/^[a-z0-9-]+::[a-z0-9]+$/.test(id), 'account id is not provider::opaque-hash: ' + id)
      for (const needle of RAW_IDENTIFIERS.concat(FORBIDDEN_USER_FRAGMENTS)) {
        assert(id.indexOf(needle) === -1, 'user material leaked into account id: ' + needle)
      }
    }
    assert(html.indexOf('placeholder="搜索账户、提供方或套餐"') !== -1, 'search placeholder no longer matches the non-user-search copy')
    assert(html.indexOf('placeholder="搜索账户、提供方、套餐或用户"') === -1, 'old user-search placeholder still present')
    const clientFiles = walkFiles(CLIENT_DIR, (full) => full.endsWith('.js'))
    const clientHits = []
    for (const file of clientFiles) {
      const text = fileText(file)
      for (const needle of RAW_IDENTIFIERS.concat(FORBIDDEN_USER_FRAGMENTS)) {
        if (text.indexOf(needle) !== -1) clientHits.push(path.basename(file) + ':' + needle)
      }
    }
    evidence.fullRedaction = {
      dashboardUsers: users,
      dashboardIds: ids,
      placeholderSafe: true,
      clientFiles: clientFiles.length,
      clientHits: clientHits,
    }
    assert(clientHits.length === 0, 'client JS contains user material: ' + clientHits.join(', '))
    return '4 dashboard users are exactly "***"; ids provider::hash; placeholder excludes user search; client JS clean'
  })

  await check('C34', 'furin contract: Elysia entry, root shell, ISR page and routing API', async () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    const lock = fileText(path.join(ROOT, 'bun.lock'))
    assert(pkg.dependencies['@teyik0/furin'], 'package.json does not depend on @teyik0/furin')
    assert(pkg.dependencies.elysia, 'package.json does not depend on elysia')
    for (const removed of ['@tanstack/react-query', '@tanstack/react-router', '@tanstack/react-start', '@tanstack/redact']) {
      assert(
        !(pkg.dependencies || {})[removed] && !(pkg.devDependencies || {})[removed],
        'removed TanStack dependency still declared: ' + removed,
      )
    }
    assert(lock.indexOf('@teyik0/furin@') !== -1, 'bun.lock does not pin @teyik0/furin')
    const server = fileText(path.join(ROOT, 'src', 'server.ts'))
    assert(
      /await\s+furin\(\{\s*pagesDir:\s*['"]\.\/src\/pages['"]\s*\}\)/.test(server),
      'src/server.ts does not mount furin({ pagesDir: "./src/pages" })',
    )
    assert(server.indexOf('new Elysia()') !== -1, 'src/server.ts does not construct the Elysia app')
    assert(server.indexOf('export default app') !== -1, 'src/server.ts does not export the Elysia app as default')
    const indexPage = fileText(path.join(ROOT, 'src', 'pages', 'index.tsx'))
    assert(/defineRoute\(\s*['"]\/['"]\s*\)/.test(indexPage), 'src/pages/index.tsx does not declare defineRoute("/")')
    assert(/mode:\s*['"]isr['"]/.test(indexPage), 'dashboard page is not in ISR mode')
    assert(/revalidate:\s*60\b/.test(indexPage), 'dashboard page is not ISR 60s')
    assert(indexPage.indexOf('.loader(') !== -1, 'dashboard page has no server loader')
    assert(indexPage.indexOf('.head(') !== -1, 'dashboard page declares no head() metadata')
    const rootPage = fileText(path.join(ROOT, 'src', 'pages', 'root.tsx'))
    assert(rootPage.indexOf('defineRootRoute()') !== -1, 'src/pages/root.tsx does not use defineRootRoute()')
    assert(rootPage.indexOf('<HeadContent') !== -1, 'root shell does not render <HeadContent />')
    assert(rootPage.indexOf('<Scripts') !== -1, 'root shell does not render <Scripts />')
    const routingApi = fileText(path.join(ROOT, 'src', 'api', 'routing.ts'))
    assert(routingApi.indexOf("'/feed/routing'") !== -1, 'src/api/routing.ts does not register /feed/routing')
    evidence.frameworkContract = {
      versions: { furin: pkg.dependencies['@teyik0/furin'], elysia: pkg.dependencies.elysia },
      pagesDir: './src/pages',
      rootRoute: 'defineRootRoute()',
      pageMode: 'isr',
      revalidate: 60,
      pageData: '__FURIN_DATA__',
      api: 'GET /feed/routing',
    }
    return '@teyik0/furin ' + pkg.dependencies['@teyik0/furin'] + ' + elysia ' + pkg.dependencies.elysia + '; no TanStack Query/Router/Start/Redact; furin({ pagesDir: "./src/pages" }) + default app; ISR 60 page with loader/head; root shell HeadContent+Scripts; GET /feed/routing'
  })

  await check('C35', 'ISR page payload carries the validated search and keeps its SSR marker', async () => {
    const open = await fetchPage('/?q=open')
    const homeData = furinData(home.text)
    const openData = furinData(open.text)
    assert(homeData, 'home document has no __FURIN_DATA__ payload')
    assert(openData, 'filtered document has no __FURIN_DATA__ payload')
    assert(homeData.path === '/', 'home payload path is not /: ' + JSON.stringify(homeData.path))
    const homeQuery = homeData.query || {}
    const homeQ = Object.prototype.hasOwnProperty.call(homeQuery, 'q') ? homeQuery.q : ''
    assert(homeQ === '', 'home payload search is not empty: ' + JSON.stringify(homeQuery))
    assert(openData.query && openData.query.q === 'open', 'filtered payload does not carry q=open: ' + JSON.stringify(openData.query))
    assert(filteredCountText(open.text).indexOf('1 / 4') !== -1, 'filtered page did not return 1 / 4 accounts')
    for (const entry of [['home', home.text], ['filtered', open.text]]) {
      assert(entry[1].indexOf('data-ssr-dashboard') !== -1, entry[0] + ' page lost its SSR marker')
    }
    evidence.pageSsr = {
      dashboardPayload: true,
      homePath: homeData.path,
      homeQuery: homeQuery,
      filteredQuery: openData.query,
      filteredCount: filteredCountText(open.text),
      chunksHint: evidence.singleDocument ? evidence.singleDocument.chunkCount : null,
    }
    return '__FURIN_DATA__ on both pages; home path / with empty search; filtered payload carries q=open and renders 1 / 4'
  })

  await check('C36', 'search is submit-only: typing does not navigate and no debounce remains', async () => {
    const toolbar = fileText(path.join(ROOT, 'src', 'features', 'dashboard', 'dashboard-toolbar.tsx'))
    const code = toolbar.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert(code.indexOf('setTimeout') === -1 && code.indexOf('window.setTimeout') === -1, 'setTimeout/debounce timer remains in the toolbar')
    assert(code.toLowerCase().indexOf('debounce') === -1, 'debounce logic remains in the toolbar')
    assert(toolbar.indexOf('onChange={(event) => setQuery(event.target.value)}') !== -1, 'search onChange is not local-state-only')
    const searchChange = toolbar.slice(
      toolbar.indexOf('onChange={(event) => setQuery(event.target.value)}') - 120,
      toolbar.indexOf('onChange={(event) => setQuery(event.target.value)}') + 120,
    )
    assert(searchChange.indexOf('navigate') === -1, 'search onChange still navigates per keystroke')
    assert(toolbar.indexOf('commitSearch({ q: query.trim() })') !== -1, 'form submit does not call commitSearch with q')
    const workbuddy = await fetchPage('/?q=WorkBuddy')
    assert(workbuddy.status === 200, '/?q=WorkBuddy expected 200, got ' + workbuddy.status)
    const count = filteredCountText(workbuddy.text)
    assert(/显示\s*3\s*\/\s*4/.test(count), '/?q=WorkBuddy count is not 3 / 4: ' + count)
    const workbuddyData = furinData(workbuddy.text)
    assert(
      workbuddyData && workbuddyData.query && workbuddyData.query.q === 'WorkBuddy',
      'filtered page data does not carry q=WorkBuddy: ' + JSON.stringify(workbuddyData && workbuddyData.query),
    )
    const homeData = furinData(home.text)
    assert(homeData, 'home document has no __FURIN_DATA__ payload')
    const homeQuery = homeData.query || {}
    const homeQ = Object.prototype.hasOwnProperty.call(homeQuery, 'q') ? homeQuery.q : ''
    assert(homeQ === '', 'default page data carries a non-empty search: ' + JSON.stringify(homeQuery))
    evidence.submitOnlySearch = {
      setTimeoutAbsent: true,
      debounceAbsent: true,
      localStateOnChange: true,
      submitCallsCommitSearch: true,
      workbuddyCount: count,
      workbuddyQuery: workbuddyData.query,
      defaultQueryEmpty: true,
    }
    return 'typing is local-state only (no navigate/timer/debounce); submit calls commitSearch; /?q=WorkBuddy -> "' + count + '" with q=WorkBuddy in __FURIN_DATA__; default search empty'
  })

  await check('C38', 'sandboxed-iframe CORS: preflight, document, /_client assets and /feed/routing', async () => {
    const preflight = await fetch(BASE + '/', {
      method: 'OPTIONS',
      headers: {
        origin: 'null',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'accept,content-type',
      },
      signal: AbortSignal.timeout(10000),
    })
    const preflightHeaders = headersToObject(preflight.headers)
    assert(preflight.status === 204, 'preflight status is not 204: ' + preflight.status)
    assert(preflightHeaders['access-control-allow-origin'] === '*', 'preflight does not allow the opaque origin')
    const allowHeaders = (preflightHeaders['access-control-allow-headers'] || '').toLowerCase()
    assert(allowHeaders.length > 0, 'preflight does not declare access-control-allow-headers')
    assert(allowHeaders.indexOf('accept') !== -1, 'preflight does not allow accept: ' + allowHeaders)
    assert(/GET/.test(preflightHeaders['access-control-allow-methods'] || ''), 'preflight does not allow GET')

    const document = await fetch(BASE + '/', {
      headers: { origin: 'null' },
      signal: AbortSignal.timeout(10000),
    })
    const documentHeaders = headersToObject(document.headers)
    assert(document.status === 200, 'opaque-origin document request failed: ' + document.status)
    assert(documentHeaders['access-control-allow-origin'] === '*', 'document response lacks Access-Control-Allow-Origin')
    assert(
      /x-furin-build-id/.test(documentHeaders['access-control-expose-headers'] || ''),
      'x-furin-build-id is not exposed to the frame: ' + documentHeaders['access-control-expose-headers'],
    )

    // iframe 里的 module 脚本同样按跨源规则走：拿文档真实引用的 /_client/*.js 回验。
    // 页面只用系统字体（见 src/styles/app.css），客户端资产里不应有任何 web font。
    const assetName = (home.text.match(/\/_client\/([^"]+\.js)/) || [])[1]
    assert(assetName, 'no /_client/*.js asset referenced by the document')
    const asset = await fetch(BASE + '/_client/' + assetName, {
      headers: { origin: 'null' },
      signal: AbortSignal.timeout(10000),
    })
    const assetHeaders = headersToObject(asset.headers)
    assert(asset.status === 200, 'static asset failed for the opaque origin: ' + asset.status)
    assert(assetHeaders['access-control-allow-origin'] === '*', 'static asset lacks Access-Control-Allow-Origin')
    const clientAssets = readdirSync(CLIENT_DIR)
    const webFonts = clientAssets.filter((name) => /\.(woff2?|ttf|otf)$/i.test(name))
    assert(webFonts.length === 0, 'bundled web font assets should be gone: ' + webFonts.join(', '))

    // 旧的 /_serverFn + x-tsr-serverfn/CSRF 协议随 TanStack 一起删掉了。iframe 里唯一
    // 还会主动发的请求是轨迹增量接口，它必须同样对 opaque origin 可用且不可缓存。
    const feed = await fetch(BASE + '/feed/routing?after=0', {
      headers: { origin: 'null', accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    const feedHeaders = headersToObject(feed.headers)
    const feedText = await feed.text()
    assert(feed.status === 200, 'opaque-origin /feed/routing failed: ' + feed.status)
    assert(feedHeaders['access-control-allow-origin'] === '*', '/feed/routing lacks Access-Control-Allow-Origin')
    assert(/no-store/.test(feedHeaders['cache-control'] || ''), '/feed/routing is cacheable: ' + feedHeaders['cache-control'])
    let feedJson = null
    try {
      feedJson = JSON.parse(feedText)
    } catch {
      feedJson = null
    }
    assert(
      feedJson && feedJson.source && typeof feedJson.source.state === 'string',
      '/feed/routing did not return the routing feed JSON: ' + feedText.slice(0, 120),
    )

    evidence.hostCors = {
      preflight: {
        status: preflight.status,
        allowOrigin: preflightHeaders['access-control-allow-origin'],
        allowHeaders: preflightHeaders['access-control-allow-headers'],
        allowMethods: preflightHeaders['access-control-allow-methods'],
      },
      document: {
        status: document.status,
        allowOrigin: documentHeaders['access-control-allow-origin'],
        exposed: documentHeaders['access-control-expose-headers'],
      },
      staticAsset: {
        name: assetName,
        status: asset.status,
        allowOrigin: assetHeaders['access-control-allow-origin'],
      },
      routingFeed: {
        status: feed.status,
        allowOrigin: feedHeaders['access-control-allow-origin'],
        cacheControl: feedHeaders['cache-control'],
        sourceState: feedJson ? feedJson.source.state : null,
      },
      webFontAssets: webFonts.length,
    }
    return 'OPTIONS 204 + ACAO/allow-headers/methods; document ACAO:* exposing x-furin-build-id; /_client/' + assetName + ' 200 with ACAO; /feed/routing?after=0 200 + ACAO + no-store JSON; no web font assets'
  })

  await check('C39', 'each account shows its readAt as the data update time', async () => {
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Shanghai',
    })
    const extract = (html) => ({
      payload: [...html.matchAll(/"readAt":"([^"]+)"/g)].map((match) => match[1]),
      // Attribute names are case-insensitive in HTML; React's server renderer emits
      // `dateTime`, Redact emits the lowercase `datetime`. Accept both.
      rendered: [...html.matchAll(/数据更新于<time dateTime="([^"]+)"[^>]*>([^<]+)<\/time>/gi)].map((match) => ({ iso: match[1], label: match[2] })),
    })
    const grid = extract(home.text)
    assert(grid.payload.length >= 3, 'dashboard payload has too few readAt values: ' + grid.payload.length)
    assert(grid.rendered.length === grid.payload.length, 'grid renders ' + grid.rendered.length + ' update times for ' + grid.payload.length + ' readAt values')
    for (const item of grid.rendered) {
      assert(grid.payload.indexOf(item.iso) !== -1, 'rendered update time does not come from readAt: ' + item.iso)
      const expected = formatter.format(new Date(item.iso))
      assert(item.label === expected, 'update time label is not the Asia/Shanghai readAt: ' + item.label + ' !== ' + expected)
    }
    const list = await fetchPage('/?view=list')
    assert(list.status === 200, '/?view=list expected 200, got ' + list.status)
    const listRows = extract(list.text)
    assert(listRows.rendered.length === listRows.payload.length, 'list rows render ' + listRows.rendered.length + ' update times for ' + listRows.payload.length + ' readAt values')
    for (const item of listRows.rendered) {
      assert(listRows.payload.indexOf(item.iso) !== -1, 'list-row update time does not come from readAt: ' + item.iso)
    }
    const firstIndex = home.text.indexOf('数据更新于<time')
    const accountsIndex = home.text.indexOf('id="accounts-heading"')
    const usageIndex = home.text.indexOf('id="usage-heading"')
    assert(firstIndex > accountsIndex && firstIndex < usageIndex, 'update time is not inside the account list section')
    evidence.dataUpdateTime = {
      grid: grid.rendered,
      listRows: listRows.rendered.length,
      timeZone: 'Asia/Shanghai',
      source: 'readAt',
    }
    return grid.rendered.length + ' accounts show readAt (' + grid.rendered.map((item) => item.label).join(' / ') + '); list view shows ' + listRows.rendered.length + '; labels match Asia/Shanghai'
  })
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

function printSummary() {
  const counts = { PASS: 0, FAIL: 0 }
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1
  console.log('')
  console.log('============================== VERIFICATION MATRIX ==============================')
  console.log(pad('ID', 5) + pad('RESULT', 8) + pad('CHECK', 68) + padLeft('TIME', 9))
  console.log('-'.repeat(90))
  for (const result of results) {
    const detail = result.detail.length > 150 ? result.detail.slice(0, 147) + '...' : result.detail
    console.log(pad(result.id, 5) + pad(result.status, 8) + pad(result.name, 68) + padLeft(result.ms + ' ms', 9))
    if (detail) console.log('       ' + detail)
  }
  console.log('-'.repeat(90))
  console.log('PASS ' + (counts.PASS || 0) + '  FAIL ' + (counts.FAIL || 0))
  console.log('')
  console.log('============================ EVIDENCE (raw) ==================================')
  console.log(JSON.stringify(evidence, null, 2))
  console.log('')
  console.log('Summary: ' + (counts.PASS || 0) + ' passed, ' + (counts.FAIL || 0) + ' failed')
  return counts
}

function pad(value, width) {
  let text = String(value)
  while (text.length < width) text += ' '
  return text
}

function padLeft(value, width) {
  let text = String(value)
  while (text.length < width) text = ' ' + text
  return text
}

async function main() {
  console.log('Reduced balance panel — independent verification')
  console.log('root: ' + ROOT)
  console.log('bun: ' + (process.versions.bun || 'not detected') + ' (node compat ' + process.version + ', ' + process.platform + ' ' + process.arch + ')')
  console.log('bun binary: ' + BUN_BIN)
  console.log('server: ' + SERVER_ENTRY)
  console.log('ports: ' + PORT + ' (main, fixture mode + sentinel token), ' + TEMP_PORT + ' (temporary .env probe)')
  console.log('')

  if (!existsSync(SERVER_ENTRY)) {
    console.error('FAIL: ' + SERVER_ENTRY + ' not found. Run "bun run build" first.')
    return 1
  }
  if (await portListening(PORT, 700)) {
    console.error('FAIL: port ' + PORT + ' is already in use; refusing to reuse or kill an unknown process.')
    return 1
  }
  if (await portListening(TEMP_PORT, 500)) {
    console.error('FAIL: port ' + TEMP_PORT + ' is already in use; refusing to reuse it.')
    return 1
  }

  child = startServer()
  evidence.serverPid = child.pid
  try {
    bootMs = await waitForReady(PORT, child, 45000)
  } catch (error) {
    console.error('FAIL: server did not start: ' + (error instanceof Error ? error.message : String(error)))
    console.error('--- server log ---')
    console.error(serverLog.join(''))
    stopResult = await stopServer()
    return 1
  }

  try {
    await runChecks()
  } finally {
    stopResult = await stopServer()
  }

  await check('C21', 'main server stopped cleanly; ports released; no orphan', async () => {
    evidence.shutdown = stopResult
    assert(stopResult !== null, 'stopServer did not run')
    assert(stopResult.code !== undefined, 'stopServer did not report an exit status')
    assert(stopResult.portFree === true, 'port ' + PORT + ' is still accepting connections after shutdown')
    assert(stopResult.processAlive === false, 'child pid ' + child.pid + ' is still alive after shutdown')
    assert(!(await portListening(TEMP_PORT, 300)), 'temp port ' + TEMP_PORT + ' is still listening')
    return 'child exited (code=' + stopResult.code + ', signal=' + stopResult.signal + '), ports ' + PORT + '/' + TEMP_PORT + ' free, pid gone'
  })

  const counts = printSummary()
  if ((counts.FAIL || 0) > 0) {
    console.error('')
    console.error('RESULT: FAIL (' + counts.FAIL + ' failing check(s))')
    return 1
  }
  console.log('RESULT: PASS')
  return 0
}

let shuttingDown = false
async function handleSignal(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.error('\nReceived ' + signal + '; stopping verification servers...')
  stopResult = await stopServer()
  process.exit(signal === 'SIGINT' ? 130 : 143)
}
process.on('SIGINT', () => {
  handleSignal('SIGINT')
})
process.on('SIGTERM', () => {
  handleSignal('SIGTERM')
})

const exitCode = await main()
process.exit(exitCode)
