# magpie web API contract — live request-path data

Everything here was verified against a **running** magpie web on 2026-10-28:
`http://127.0.0.1:3430/` (web), gateway on `http://127.0.0.1:3425/`,
server build **`0.1.1755`** (reported by `GET /api/update` → `.current`).

Legend: **✅ live** = reproduced with curl/node against that server; **📖 src** = read from the magpie source
(`internal/gui/trace.go`, `internal/gateway/trace.go`, `internal/gui/web.go`) — used only where the live
server could not be made to produce the state (e.g. another magpie serving the gateway).

> The API is not versioned and has no schema. Treat this document as a snapshot of `0.1.1755`; the deployed
> web server may be older or newer. §11 lists what to re-check when it changes.

---

## 0. TL;DR — the minimum viable source

| Need | Endpoint | Verdict |
| --- | --- | --- |
| Live in-flight paths, finished paths, candidate order, per-attempt timing, providers, models, prompt sizes | `GET /api/gateway/trace` | **Essential — this one endpoint is enough for the whole animation** |
| Finished paths older than the 60-route in-memory ring, or a single route by id | `GET /api/gateway/history?day=YYYY-MM-DD`, `GET /api/gateway/route?id=&day=` | Optional (replay / deep link) |
| Provider icons + gateway running state | `GET /api/providers` → `gateway` block | Optional (icons are also in `order[].icon`) |
| Agent display names/icons | `GET /api/state` → `agents[]` | Optional (a route carries only the `agent` id, e.g. `dsh`) |
| Routing groups / models | `GET /api/groups` | Optional — **empty on this deployment** (`groups: []`) |

The one hard problem is **auth + CORS**, not the data (§2): the API is cookie-guarded, `HttpOnly`, and sends **no CORS
headers at all**, so a browser page on another origin cannot call it. It must be proxied by the app's own server.

---

## 1. What the live deployment looks like

| Fact | Value | How |
| --- | --- | --- |
| web (GUI + API) | `http://127.0.0.1:3430/` | the URL given |
| gateway (inference) | `http://127.0.0.1:3425/` (`gateway.url` in `/api/providers`) | ✅ live |
| cookie name | `magpie_web_3430` — `'magpie_web_' + webPort` | ✅ live, 📖 src `web.go:327` |
| serving the gateway? | `mine: true`, `gateway.running: true`, `gateway.mine: true`, `gateway.window: true` | ✅ live |
| providers in use | 1 (`lityouyou`, kind `provider` — a plain API key, no accounts) | ✅ live |
| agents seen in the trace | 1 (`dsh`) | ✅ live |
| routing groups | none (`/api/groups` → `groups: []`) | ✅ live |

Consequence for the animation: on **this** deployment every path is one candidate and one try, so `order[]` and
`tries[]` both have length 1. Multi-candidate / multi-try shapes (§5, §5.3) are real but were exercised here only by
a single captured reroute in history.

---

## 2. Auth: the exact recipe (✅ live, end to end)

### 2.1 The rule

* The page/API is guarded by a **cookie**: `magpie_web_<port>`, value = the key.
* The cookie is set **only** by visiting any URL with `?k=<key>`. The server answers `303 See Other` with the `k`
  stripped out of `Location`, plus `Set-Cookie`.
* Any path accepts `?k=`, including API paths (✅ live: `/api/gateway/trace?after=0&k=…` → `303` to
  `Location: /api/gateway/trace?after=0`).
* The cookie is `HttpOnly; SameSite=Lax; Path=/; Priority=High` and — because this deployment runs with a fixed
  `MAGPIE_WEB_KEY` — carries `Max-Age=34560000` (400 days). Without `MAGPIE_WEB_KEY` magpie mints a new random key
  each start and the cookie is a **session** cookie (`Max-Age` omitted).
* Because it is `HttpOnly`, browser JS can never read it — a server-side proxy is mandatory.

### 2.2 curl (the literal probe used to verify this document)

```bash
# 1. sign in: 303 + Set-Cookie, key ends up only in the jar
curl -s -i -c /tmp/jar3430 'http://127.0.0.1:3430/?k=dbb33b52d0f1d1e51a80916237f94931' | head -6
#    HTTP/1.1 303 See Other
#    Location: /
#    Set-Cookie: magpie_web_3430=dbb33b52d0f1d1e51a80916237f94931; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax; Priority=High

# 2. every later call carries the cookie and nothing else
curl -s -b /tmp/jar3430 'http://127.0.0.1:3430/api/gateway/trace?after=0'        # 200, 106,829 B
curl -s -b /tmp/jar3430 'http://127.0.0.1:3430/api/gateway/trace?after=123&wait=1'
```

### 2.3 TypeScript / Node (this exact code was run; sign-in took 37 ms)

```ts
const base = process.env.MAGPIE_WEB_URL ?? 'http://127.0.0.1:3430'
const key = process.env.MAGPIE_WEB_KEY ?? ''
const u = new URL(base)
const cookieName = 'magpie_web_' + (u.port || (u.protocol === 'https:' ? '443' : '80'))

async function signIn(): Promise<string> {
  // redirect: 'manual' — do not follow the 303, we only want the Set-Cookie
  const res = await fetch(u.origin + '/?k=' + encodeURIComponent(key), { redirect: 'manual' })
  const setCookie = res.headers.getSetCookie()            // Node 22+/undici; one entry per Set-Cookie
  const hit = setCookie.find((c) => c.startsWith(cookieName + '='))
  if (!hit) throw new Error('magpie web refused the key: HTTP ' + res.status)
  return hit.split(';')[0]                                // "magpie_web_3430=<key>"
}

const cookie = await signIn()                             // cache it for the process lifetime
const res = await fetch(u.origin + '/api/gateway/trace?after=0', {
  headers: { Cookie: cookie, Accept: 'application/json' },
  signal: AbortSignal.timeout(40_000),                    // > the 25 s server long-poll (§3.2)
})
```

Notes that bite:

* `getSetCookie()` is the only reliable accessor; `res.headers.get('set-cookie')` merges or omits on some
  runtimes. On Node < 20 read the raw `headers` array instead.
* The key never appears in a response body or URL after sign-in; do not echo the `?k=` URL in logs.
* Send `Accept: application/json` (or nothing). With `Accept: text/html` an unauthenticated call returns a
  1,201-byte **sign-in HTML page** instead of the plain-text 401 (§9.1).

### 2.4 There is no CORS, and no token auth

| Probe | Result (✅ live) |
| --- | --- |
| `Access-Control-Allow-Origin` on any `/api` 200 | **absent** |
| `OPTIONS /api/gateway/trace` (preflight) | `404 page not found` |
| Bearer / `X-Api-Key` header | not supported by the guard — only the cookie is read |
| `Content-Encoding: gzip` | sent when the client offers it (`Vary: Accept-Encoding`) |

So: **the browser can never talk to magpie directly.** The app's server calls magpie and re-exposes the data. (Even if
magpie's `/api/settings/cors` origins were set — that setting exists in the source — a cross-origin call would still
fail, because the cookie is `HttpOnly` and `SameSite=Lax` on another origin.)

### 2.5 Env vars a consumer needs

```dotenv
MAGPIE_WEB_URL=http://127.0.0.1:3430     # origin of the web server (port matters: it names the cookie)
MAGPIE_WEB_KEY=dbb33b52d0f1d1e51a80916237f94931
# optional, following this repo's existing naming (BALANCE_CACHE_TTL_SECONDS):
MAGPIE_TRACE_TIMEOUT_MS=30000           # must exceed the 25 s long-poll hold
MAGPIE_TRACE_WAIT=0                     # 1 = use long-poll, 0 = plain poll (see §7.4)
```

`MAGPIE_WEB_KEY` must be the key magpie web was started with. If magpie runs **without** it, every restart mints a
new key, the old cookie is rejected (§9.1 "holds another key") and the proxy must sign in again — the same code path,
so just retry once on 401.

---

## 3. `GET /api/gateway/trace` — the only required endpoint

### 3.1 Request

| Param | Type | Meaning (✅ live) |
| --- | --- | --- |
| `after` | int64, default `0` | return routes whose **revision counter** is `> after`. `0` (or omitted) = full snapshot |
| `wait` | *presence only* | if the param is present **at all** (`wait=1`, `wait=0`, `wait=yes`) the handler waits up to **25 s** for a change |

`wait` is not a duration and not a boolean — the handler tests `r.URL.Query().Get("wait") != ""` (📖 src
`gui/trace.go:278-280`).

`after` is **one global counter**, not a per-route cursor and not a timestamp.

### 3.2 Response envelope (✅ live)

```jsonc
{
  "seq": 1524,                                   // the trace's revision counter now
  "totals": { "requests": 300, "rerouted": 0, "errors": 0 },
  "ids": [1793163984267, 1793163984268, "..."],  // == routes[].id, same order (0.1.1755 only, redundant)
  "mine": true,                                  // this magpie web serves the gateway
  "now": "2026-10-28T13:20:59.8132146+08:00",    // server clock at response time → client skew
  "routes": [ /* Route[]: changed since the after cursor, oldest request first */ ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `seq` | int64 | trace change counter. Every begin/update of a route bumps it, and the route stores the value it saw (`route.seq`). Monotonic **per gateway run**; resets to a small number when the gateway restarts. |
| `totals` | object | counters **since the gateway started**, not since the ring was filled (300 requests while only 60 routes are kept). Bumped when a route transitions to `done`. `rerouted` = tries that failed and handed the request on; `errors` = requests whose agent got an error. |
| `ids` | int64[] | duplicate of `routes[].id`; ignore it (absent in the source tree's version). |
| `mine` | bool | `false` = **another magpie serves the gateway**, or no gateway at all → `routes` is `[]` and `totals` is zeroed. Do not read that as "no traffic". |
| `now` | RFC3339 string | server time with offset, up to 7 fractional digits. `new Date(now).getTime()` works on V8/Node (verified) and gives an absolute instant → `skew = Date.parse(now) - Date.now()` was `-17 ms` here. |
| `routes` | Route[] | **upserts**, not a delta log. A route is re-sent every time it changes. `order` may be `null` (📖 src: a route the gateway weighed no seats for). |

### 3.3 Measured costs (✅ live, loopback)

| Call | Bytes | Time | Routes returned |
| --- | --- | --- | --- |
| `?after=0` (full snapshot, 60 routes) | 106,829 (gzip 12,277) | 16 ms | 60 |
| `?after=<seq>&wait=1` (steady state) | 2,127 – 3,112 | held **0.002 – 5.2 s** over 30 samples (a near-zero hold means a change was already waiting) | 1 – 3 |
| `?after=<seq>&wait=1` idle | — | **up to 25 s**, then `200` with `routes: []` | 0 |
| `?after=0&wait=1` | 106,829 | **immediate** (waits only when there is nothing to send) | 60 |
| `?after=999999999` (ahead of the server) | 106,829 | immediate | 60 |

The 25 s cap could not be *observed* on this host because other agents keep the gateway busy (traffic never stopped
longer than about 5 s). It is the constant in the handler, 📖 `gui/trace.go:279`: `wait = 25 * time.Second`.

The 60-route ring is `traceKeep = 60` (📖 `gateway/trace.go:25`). Finished routes are evicted first; in-flight routes
are never evicted unless more than 120 are in flight.

---

## 4. One `Route` object, field by field

Trimmed but otherwise verbatim, taken from the live trace.

### 4.1 In flight (✅ live)

```json
{
  "seq": 1617,
  "id": 1793163984430,
  "time": "2026-10-28T13:21:31.1728584+08:00",
  "agent": "dsh",
  "model": "lityouyou/deepseek-v4.1-flash",
  "effort": "high",
  "provider": "lityouyou",
  "order": [
    {
      "id": "lityouyou",
      "provider": "lityouyou",
      "name": "Lityouyou",
      "icon": "file:f67008553dd38964.svg",
      "kind": "provider",
      "model": "deepseek-v4.1-flash",
      "routing": "",
      "used": 0
    }
  ],
  "tries": [
    {
      "id": "lityouyou",
      "model": "deepseek-v4.1-flash",
      "effort": "high",
      "start": "2026-10-28T13:21:31.1785352+08:00",
      "done": false
    }
  ],
  "done": false,
  "prompt": { "tokens": 95647, "turns": 8, "parts": [ "..." ] },
  "conv": "magpie-12a9c653246091a7e4eecf5e",
  "cost": 0,
  "priced": false,
  "unpriced": 0
}
```

### 4.2 Finished, one attempt (✅ live)

```json
{
  "seq": 1634,
  "id": 1793163984432,
  "time": "2026-10-28T13:21:35.0130822+08:00",
  "agent": "dsh",
  "usage": [
    { "provider": "lityouyou", "model": "deepseek-v4.1-flash",
      "in": 169, "out": 111, "cache_read": 33536 }
  ],
  "model": "lityouyou/deepseek-v4.1-flash",
  "effort": "high",
  "provider": "lityouyou",
  "order": [ { "id": "lityouyou", "provider": "lityouyou", "name": "Lityouyou",
               "icon": "file:f67008553dd38964.svg", "kind": "provider",
               "model": "deepseek-v4.1-flash", "routing": "", "used": 0 } ],
  "tries": [
    {
      "id": "lityouyou",
      "model": "deepseek-v4.1-flash",
      "effort": "high",
      "start": "2026-10-28T13:21:35.017707+08:00",
      "done": true,
      "status": 200,
      "ms": 3343,
      "ttft": 2585,
      "flow": 756,
      "served": "deepseek-flash",
      "swapped": true,
      "net": { "own": 7.9, "asks": 1, "reused": true, "send": 1, "wait": 2576.2, "head": 2585.1 }
    }
  ],
  "done": true,
  "status": 200,
  "ms": 3348,
  "tokens": 33816,
  "out": 111,
  "ttft": 2589,
  "flow": 756,
  "sent": 13,
  "own": 12,
  "served": "deepseek-flash",
  "swapped": true,
  "prompt": { "window": 1048576, "tokens": 33705, "counted": true, "turns": 3, "parts": [ "..." ] },
  "conv": "magpie-4c3e94aea0234eee3fb6899a",
  "cost": 0,
  "priced": false,
  "unpriced": 1
}
```


### 4.3 Field table

**Identity / addressing** (always present)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | int64 | request id. Seeded from `Date.now()` at gateway start and incremented per request → **strictly increasing**, and a safe sort key / React key. Live ids: `1793163984267…` |
| `seq` | int64 | trace counter at this route's **last change** — the revision marker for upserts. `0` for rows read from history (📖 + ✅ live) |
| `time` | string | request start, server offset, 7-digit fraction. Absolute instant. |
| `agent` | string | client/agent id as magpie names it (`dsh`, `claude`, `codex`…). Joins `/api/state` `agents[].id`; the display name lives there, not here. |
| `model` | string | model **as the agent asked**, `provider/model` (`lityouyou/deepseek-v4.1-flash`) |
| `provider` | string | provider id the model resolved to (`lityouyou`) |
| `effort` | string? | reasoning level asked (`high`); omitted when none |
| `order` | Weighed[] or null | candidates in the order routing put them (§5.1) |
| `tries` | Try[] | attempts actually made, in order (§5.2). `[]` (never null) |
| `done` | bool | request finished |

**Outcome / totals** (present once `done`)

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | int | HTTP status the agent got (`200`, `502`…) |
| `error` | string? | error text when the request failed |
| `ms` | int64 | total ms, request start → reply end |
| `tokens` | int | total tokens (prompt + output) |
| `out` | int | of those, output |
| `reasoning` | int? | of output, reasoning |
| `ttft` | int64? | ms, request start → first content (text, reasoning or tool call). Streamed replies only. |
| `firstText` | int64? | ms to the first **text** |
| `firstReasoning` | int64? | ms to the start of **paced visible** reasoning (absent when reasoning is hidden) |
| `flow` | int64? | ms the content itself took to arrive (the streaming window) |
| `sent` | int64? | ms, request start → the answering try's request written to the vendor |
| `own` | int64? | of `sent`, magpie's own overhead |
| `retried` | int64? | of `sent`, time spent on tries that failed first (≈ sum of earlier `try.ms + try.again`) |
| `queued` | int64? | of `sent`, ms waiting for a concurrency slot |
| `served` | string? | model the **reply says** answered (`deepseek-flash`) |
| `swapped` | bool? | `served` is a different model than `model` |
| `routed` | bool? | `model` was another magpie's routing group; `served` is its member |
| `upstream` | string? | the upstream an aggregator said answered behind it |
| `usage` | RouteUsage[]? | billable tries' token tiers: `{provider, model, in, out, cache_read?, cache_write?, reasoning?}` — pricing inputs, not display numbers |
| `prompt` | Prompt? | what the prompt held, part by part (§4.4) |
| `conv` | string? | digest of the conversation for requests with no session id |

**GUI-added (not in `gateway.Route`)** — computed per response (📖 `gui/trace.go:26-32`)

| Field | Type | Meaning |
| --- | --- | --- |
| `cost` | number | priced cost of `usage`; `0` when unknown |
| `priced` | bool | every billable call had a known price |
| `unpriced` | int | billable calls with **no** price. `priced:false, cost:0, unpriced:1` means "unknown", not "free" |
| `sessionTitle` | string? | Codex session title (absent for other agents) |

**In the schema, never observed in this deployment's data** (all `omitempty`): `left`, `session`,
`parentSession`, `titleLink`, `parentMatched`, `kind`, `for`, `tier`, `group`, `rule`, `subagent`,
`sub`, `subagentEffort`, `subagentId`, `nested`, `affinity`, `pinned`, `sealedTask`, `leadAccount`,
`folder`, `reasoningHidden`, `archive`. Render defensively — a deployment with accounts or routing groups will
start sending `group`, `rule`, `left` and `nested`.

### 4.4 `prompt` (what the request carried)

| Field | Meaning |
| --- | --- |
| `tokens` | prompt tokens (as counted, or estimated when `counted` is absent or false) |
| `window` | the model's context window, when magpie knows it (finished routes) |
| `counted` | true when the vendor counted them |
| `turns` | how many conversation turns are in it |
| `parts[]` | `{kind, tokens, items[]}` with `kind` in `system / tools / memory / results / chat`; each item `{name, tag?, n?, tokens}` |

`prompt` is **already present while the request is in flight** (it is read from the body before routing) — so a
request can show "95.6k tokens, 8 turns, run_code results 56k" the moment it appears.

---

## 5. `order[]` and `tries[]` — the routing path

These two arrays **are** the animation. `order` is the plan (who could answer, in what order); `tries` is what
happened (who was asked, when, and how it went).

### 5.1 `Weighed` — an element of `order[]` (and of `left[]`)

| Field | Type | Meaning / animation use |
| --- | --- | --- |
| `id` | string | the account/key/provider ref that "rests" after a failure. **Matches `tries[].id`** → this is the join key between plan and attempt |
| `provider` | string | provider id |
| `name` | string | provider display name — use this as the node label |
| `icon` | string? | `file:<hash>.svg` → fetch `GET /api/icons/<hash>.svg` (✅ 200, `image/svg+xml`). Empty or absent → fall back to a generic glyph |
| `kind` | provider / account / key | node class: plain provider = 1 node; account/key = a seat under a provider |
| `model` | string | the model this candidate would serve (may differ from `route.model` for a group member) |
| `routing` | string | the provider's routing mode: empty / order / rotate / usage — why this order |
| `used` | number | share of the allowance used, 0…1 (0 for kind `provider`). Drives a seat's fill |
| `who` | string? | the account user / key name / masked key (`sk-P…LhLF`) |
| `agent`, `plan` | string? | account's agent / plan |
| `fixed`, `fast` | string? / bool | the group member's fixed effort / fast mode |
| `fallback`, `shared`, `known`, `learns`, `turn`, `barred`, `held` | bool? | why it is where it is (fallback candidate, shared provider, allowance known or learned, its turn, barred by model list, held by the caller key) |
| `amount`, `limit`, `unit`, `renews`, `pace`, `due`, `tokens`, `rank`, `fit`, `rest`, `capped`, `capBack`, `sunk`, `via`, `unlisted`, `aside`, `noURL` | — | allowance / ordering detail; optional, safe to ignore for a first animation |

`left[]` has the same shape and means **weighed but never tried** (out of allowance, held) — the greyed-out, skipped
nodes.

### 5.2 `Try` — an element of `tries[]`

| Field | Type | Meaning / animation use |
| --- | --- | --- |
| `id` | string | which candidate was asked (joins `order[].id`) |
| `model` | string? | the model it was asked for |
| `effort` | string? | effort actually sent (fitted to the model's levels) |
| `start` | string | **absolute start of this attempt** — the leg's launch time |
| `done` | bool | false while this attempt is running → the packet is in flight |
| `status` | int? | HTTP status of the attempt |
| `ms` | int64? | attempt duration (start → end) |
| `ttft`, `firstText`, `firstReasoning` | int64? | same as route level, but measured **from `start`** |
| `flow` | int64? | content streaming window |
| `served`, `swapped`, `routed`, `upstream`, `tier`, `tierServed` | mixed | what answered, and whether it differed from what was asked |
| `fail` | string? | failure class, a short word (e.g. `other`) — use it as the failed-leg label |
| `error` | string? | raw error text (vendor message) |
| `rest` | object? | how long this candidate now sits out; **absent for the last try** |
| `again` | int64? | ms waited before this candidate was tried again (the visible pause between two legs) |
| `replan`, `patience`, `gone`, `earlier`, `queued`, `reset`, `auto` | — | retry policy detail |
| `net` | object? | where the attempt's time went, all ms floats: `own` (magpie), `asks` (requests), `reused` (connection reuse), `pool`, `dns`, `connect`, `tls`, `send`, `wait` (to first byte), `head` (to headers / body start) |

### 5.3 How to draw a path from them

```
agent (route.agent) ──▶ magpie ──▶ [try 1: order[0]]  ✗ fail / status >= 400
                                            │
                            again (ms)  ◀───┘
                                            ▼
                                   [try 2: order[0]]  ✓ served
```

Rules (all ✅ live or 📖 src):

1. **Nodes** = `order[]` (plus `left[]` as skipped ones), one node per candidate; `order[i].id` keys the node.
2. **Legs** = `tries[]`, in array order; `try.id` says which node the leg went to.
3. A leg is **in flight** while `try.done === false`. Its progress is `serverNow() - Date.parse(try.start)`.
4. A leg is **failed** when `try.status >= 400` or `try.fail` / `try.error` is set. The pause before the next leg is
   that failed try's `again` (ms) — it really was waited.
5. A leg is **answered** when `try.status` is 2xx; `try.served` (with `swapped: true`) is what actually replied and
   is worth showing as a note ("asked deepseek-v4.1-flash, answered deepseek-flash").
6. The route is over when `route.done`. `route.status` is what the agent got — which may be 200 even if early tries
   failed.

A real reroute, captured from `/api/gateway/history?day=2026-10-28` (only the two arrays, verbatim):

```json
"order": [ { "id": "lityouyou", "provider": "lityouyou", "name": "Lityouyou",
             "icon": "file:f67008553dd38964.svg", "kind": "provider",
             "model": "deepseek-v4.1-flash", "routing": "", "used": 0 } ],
"tries": [
  { "id": "lityouyou", "model": "deepseek-v4.1-flash", "effort": "high",
    "start": "2026-10-28T00:19:15.166378+08:00", "done": true, "status": 502, "ms": 11980,
    "fail": "other",
    "error": "Post https://.../v1/chat/completions: http2: client connection lost",
    "again": 1000,
    "net": { "own": 15, "asks": 1, "reused": true, "send": 7030.9 } },
  { "id": "lityouyou", "model": "deepseek-v4.1-flash", "effort": "high",
    "start": "2026-10-28T00:19:28.1486732+08:00", "done": true, "status": 200, "ms": 14119,
    "ttft": 12544, "firstReasoning": 12544, "flow": 1501,
    "served": "deepseek-flash", "swapped": true,
    "net": { "own": 17, "asks": 1, "pool": 1, "dns": 50.8, "connect": 343.8, "tls": 1423.8,
             "send": 7097.3, "wait": 3536.7, "head": 12470.3 } }
]
```

Route-level totals for that same route: `ms: 27108`, `ttft: 25533`, `retried: 12982`, `sent: 21921`.
Note `tries[1].start ≈ tries[0].start + tries[0].ms + tries[0].again` (15.166 s + 11.980 s + 1.000 s = 28.146 s
vs 28.149 s — the extra 2 ms is the next connection),
and `route.retried` ≈ `tries[0].ms + tries[0].again` (12,982 vs 12,980).

---

## 6. Timing model for the animation

All times are **absolute instants with offset** (`+08:00` here, but that is the server's zone — parse, do not
string-slice): `new Date('2026-10-28T13:21:31.1728584+08:00').getTime()` → `1793164891172` (verified on Node 25;
V8 truncates the 7-digit fraction to ms).

### 6.1 The phases of one request (both levels agree)

```
route.time ──sent──▶ vendor write ──(ttft - sent)──▶ first content ──flow──▶ reply end
   │                     │                               │                      │
   │                     └ among sent: own (magpie), queued (slot), retried (failed tries)
   │
   └ every try has the same: try.start ──try.ttft──▶ ──try.flow──▶ try.start + try.ms
```

Worked example (the finished route in §4.2, all ✅ live):

| Step | Value | Check |
| --- | --- | --- |
| request → try start | `13:21:35.0130822 → 13:21:35.017707` = **4.6 ms** | routing decision + connection |
| `route.ttft` | 2589 ms | = `try.ttft` (2585) + 4 ms |
| `route.flow` | 756 ms | identical to `try.flow` (copied from the answering try) |
| `route.ms` | 3348 ms | ≈ `ttft + flow` = 3345 (+3 ms tail) |
| `try.ms` | 3343 ms | ≈ `try.ttft + try.flow` = 3341 |
| `route.sent` | 13 ms | of which `own` 12 ms |
| `net.wait` / `net.head` | 2576.2 / 2585.1 ms | first byte / headers; `net.own` 7.9 ms |

So: `route.ttft / firstText / firstReasoning / flow / ms` = the answering try's values **plus** the pre-try overhead
(3–5 ms here). Route-level `sent / own / retried / queued` are whole-request values and have no per-try twin except
`net.own`.

### 6.2 Clock skew — mandatory if you animate absolute times

The browser's clock is not the server's. Take skew from the same response:

```ts
const skew = Date.parse(body.now) - Date.now()   // -17 ms on the loopback test
const serverNow = () => Date.now() + skew
const elapsedOfTry = (t: Try) => serverNow() - Date.parse(t.start)
```

Without it, an in-flight leg can look already-finished (or negative) on a client whose clock is minutes off.

### 6.3 Provisional values while in flight

In flight only `route.time`, `order`, `tries[].start` and `prompt` exist; everything under "Outcome" arrives with
`done: true`. So a live leg's progress must be derived (`serverNow() - start`), and only after `done` may you draw
`ttft` / `flow` marks. Do not treat a missing `ttft` as 0.

---

## 7. Polling protocol

### 7.1 The loop (✅ live; the reference client does exactly this, 📖 `routing/client.js:3373-3406`)

1. **First load**: `GET /api/gateway/trace?after=0` — **without** `wait` so it never blocks. Seed the map with
   `routes[]` keyed by `id`, remember `seq`, compute `skew` from `now`, note `mine`.
2. **Every later call**: `GET /api/gateway/trace?after=<seq>&wait=1`.
3. If `body.seq < seq` → **the gateway restarted**: clear the map before merging (the same response already contains
   the full snapshot, because the server resets `after` to `0` when `t.seq < after`, 📖 `gateway/trace.go:634`).
4. `seq = body.seq`, then **upsert**: `for (const r of body.routes) map.set(r.id, r)`.
5. Prune to the newest **60** by `id` (the ring size); a client that never prunes grows without bound on long uptimes.
6. Loop immediately (a long-poll that returned means new data; one that timed out at 25 s means "nothing happened").
   No extra delay is needed; add 250–1000 ms backoff on transport errors.

### 7.2 What `seq` and `after` guarantee

* `after=N` returns routes with `route.seq > N` — all of them, snapshotted under one lock. Nothing in the window is
  skipped (✅ live: after a burst, `after=<old>` returned exactly the routes that had changed).
* A route re-appears **every time it changes** (begin, each try, finish). Same `id`, larger `seq`. **Upsert by
  `id`** and there is no double counting — the latest copy wins.
* `routes[]` is ordered by **request start** (insertion order), not by `seq`. Do not assume the last element is the
  newest change. Sort by `id` (or `time`) when you need request order.
* `after` larger than the server's `seq` (a restart that reset the counter) returns the **full snapshot** rather than
  an empty delta (✅ live with `after=999999999`). Safe to use after waking from sleep.
* `after` must be an integer string; a non-integer parses to 0 → full snapshot (📖: the `strconv.ParseInt` error is
  ignored).

### 7.3 What bumps `seq` (📖 `gateway/trace.go:471-477, 489-516, 594-624`)

Route begin (a request appears), each try added, each try updating, and the finish. Totals only change at finish. So a
delta carries **1–3 routes** in normal traffic (✅ measured 2.1–3.1 KB per poll).

### 7.4 Using it behind an app server (`createServerFn`)

This repo has **no `/api/*` routes and forbids adding one** (verify asserts `/api/foo` → 404) and the client bundle
must not contain the string `/api/` (verify C19). So magpie is reached from `src/server/*.server.ts` only. Two viable
shapes:

| Shape | How | Trade-off |
| --- | --- | --- |
| **A. Plain poll (recommended)** | server fn does `after=<seq>`, no `wait`, returns in ~16 ms; the browser polls it every 1–2 s (React Query `refetchInterval`) | simple, no held HTTP requests, plays well with SSR and the 60-route ring; slightly more chatty |
| **B. Long-poll passthrough** | server fn calls with `wait=1` and a 30 s timeout; the browser keeps one request open per tab | instant updates, but one server request and one magpie connection per viewer, and every SSR/verify probe must avoid it |

Shape A is also what the animation wants: it needs `start` / `ms` / `skew` (absolute instants), and a 1 s poll is
finer than the reference UI's own 620–1400 ms leg animations.

Either way: **cache the sign-in cookie per process**, single-flight the fetch (this repo's `cache + inflight`
pattern), and **never let the fetch reject** — fall back to the last snapshot and surface a warning field, exactly as
`balance.server.ts` does.

---

## 8. Optional endpoints

### 8.1 `GET /api/gateway/history?day=YYYY-MM-DD` (✅ live)

```jsonc
{
  "cut": false,                                              // true = the day had more routes than were returned
  "days": [ { "day": "2026-10-28", "requests": 334 } ],      // newest first, ~19 days kept
  "routes": [ /* Route[], same shape as the trace, but seq: 0 */ ]
}
```

* **`day` is required.** With no `day` the response has `routes: []` and only the `days` index (✅ live).
* History rows carry `seq: 0` — **do not merge them into the live seq tracking**; they are a separate, immutable set.
* Size: 299 routes ≈ 495 KB; a busy day (1,448 routes) is larger. Fetch on demand only.
* Retention: 30 days / 200 MB (📖 `history.go`); a day beyond it returns `routes: []`, `cut: false` (✅ 2026-09-01).
* `cut: true` means the day's log held more than the per-day cap and the oldest rows were dropped.

### 8.2 `GET /api/gateway/route?id=<int>&day=YYYY-MM-DD` (✅ live)

One `Route` (same `routeJSON` shape, 1.6 KB), first from memory, then from that day's history. `404` with
`route history is no longer available` when it is gone. Use it for deep links (`?req=<id>`).

### 8.3 `GET /api/providers` → the `gateway` block (✅ live, 288 KB total)

```jsonc
"gateway": {
  "url": "http://127.0.0.1:3425",
  "lan": true, "lanURLs": ["http://10.201.135.197:3425"],
  "running": true,      // the gateway process is up
  "mine": true,         // this web serves it (the same flag as trace.mine)
  "window": true,       // a magpie window owns it
  "models": 5,
  "calls": [ { "id": 211, "route": 1793163984317, "time": "...", "agent": "dsh",
               "model": "lityouyou/deepseek-v4.1-flash", "provider": "lityouyou",
               "from": "chat", "to": "chat", "status": 200, "ms": 3673, "ttft": 2512,
               "usage": { "input": 676, "output": 436, "cache_read": 79360 } } ]
}
```

`calls[].route` joins the trace's `route.id`. Use this to tell "the gateway is down" apart from "another magpie
serves it" (the three messages in §9.2).

### 8.4 `GET /api/state` (✅ live, 130 KB)

Top level: `agents, clients, profiles, catalog, settings, fx, served`. `agents[]` is the only part the animation
needs: `{ id, name, icon, path, fields, models }` — `id` joins `route.agent`, `name` is the label (`claude` →
`Claude Code`), `icon` is an icon name (e.g. `claudecode-color`). Cache it for a minute; there is nothing
per-request in it.

### 8.5 `GET /api/groups` (✅ live, 1.7 KB)

`{ groups: [], models: [{id,name,provider,providerName,icon,imagesUnknown}], pools, deciders, found, templates, clock }`.
`groups` is empty on this deployment. `models` is a cheap model → provider/icon lookup if you ever need to label a
model without a route.

### 8.6 Not useful for this feature

`GET /api/gateway/call?id=|route=` returns `404 {"error":"This request is no longer in the recent calls."}` almost
always (it serves only the newest few calls; verified 404 for both an old id and a live route id). Do not build on it.
`POST /api/gateway/unrest`, `POST /api/gateway/session-titles`, `POST /api/gateway/take-over` and
`POST /api/gateway/restart` mutate state — out of scope.

---

## 9. Error and edge cases

### 9.1 401 bodies (✅ live, `Content-Type: text/plain`)

Three distinct messages, all `401`, each naming the failure:

| Case | Body | Bytes |
| --- | --- | --- |
| no cookie for this name | `open the link magpie web printed when it started: it carries the key. This browser sent no sign-in cookie for this address. …` | 428 |
| cookie present, key wrong | `… This browser's sign-in cookie holds a key that isn't this magpie web's: the key changed after it signed in (MAGPIE_WEB_KEY changed, or a start without it made a new one).` | 241 |
| wrong `?k=` in the first place | `this link's key is not this magpie web's: use the link it printed when it started` | 82 |

Handler: map 401 → re-run `signIn()` **once** and retry; a second 401 is a configuration error (wrong
`MAGPIE_WEB_KEY`), not a transient failure. If the request carried `Accept: text/html` the 401 body is a 1,201-byte
HTML sign-in form instead — so always send `Accept: application/json`.

### 9.2 `mine: false` / the gateway not serving (📖 src + the reference client's own wording)

`{ "seq": n, "totals": {}, "mine": false, "routes": [] }` with HTTP 200. Three causes, distinguishable via
`/api/providers` → `gateway`:

| Cause | `gateway` block | Message worth showing |
| --- | --- | --- |
| gateway not running | `running: false` | "The gateway isn't running, so nothing is routed." |
| another magpie serves it | `mine: false` (+ `window: true`) | "Another magpie serves the gateway; its routing plays live in that magpie's window." |
| served by `magpie serve` (headless) | `mine: false`, `window: false` | "The gateway is served by a magpie without a window, so its routing can't be watched." |

Never render `mine: false` as "no traffic". The reference UI retries every 5 s in this state.

### 9.3 Empty trace, ring overflow, restart

* `routes: []` with `mine: true` and `totals.requests > 0` is normal right after a gateway restart (the totals reset
  too) or when nothing has changed since `after`.
* The ring keeps 60 finished routes; `totals.requests` is the honest all-time-since-start count — show that as the
  headline number, not `routes.length`.
* On restart `seq` drops and ids jump to `Date.now()` again. Detect with `seq` (not with id ordering) and clear.

### 9.4 Transport

* gzip is on by default (`Content-Encoding: gzip`, 106 KB → 12 KB). Node's `fetch` handles it; if you proxy the bytes
  onward, do not copy `Content-Encoding` unless you also pass the compressed body.
* No `Cache-Control` on the responses — add `Cache-Control: no-store` in your own proxy.
* No rate limit observed, but the long-poll is designed for one connection per viewer.

---

## 10. Reference server-side client (this code ran against the live server)

```ts
// src/server/magpie.server.ts  (server-only: never imported by a client module)
const BASE = process.env.MAGPIE_WEB_URL ?? 'http://127.0.0.1:3430'
const KEY = process.env.MAGPIE_WEB_KEY ?? ''
const u = new URL(BASE)
const COOKIE_NAME = 'magpie_web_' + (u.port || (u.protocol === 'https:' ? '443' : '80'))

let cookie: string | null = null

async function signIn(): Promise<string> {
  const res = await fetch(u.origin + '/?k=' + encodeURIComponent(KEY), { redirect: 'manual' })
  const hit = res.headers.getSetCookie().find((c) => c.startsWith(COOKIE_NAME + '='))
  if (!hit) throw new Error('magpie web refused the key: HTTP ' + res.status)
  return hit.split(';')[0]
}

export async function fetchTrace(after: number, wait = false) {
  const path = '/api/gateway/trace?after=' + after + (wait ? '&wait=1' : '')
  for (let attempt = 0; attempt < 2; attempt++) {
    cookie ??= await signIn()
    const res = await fetch(u.origin + path, {
      headers: { Cookie: cookie, Accept: 'application/json' },
      signal: AbortSignal.timeout(wait ? 30_000 : 10_000),
    })
    if (res.status === 401) { cookie = null; continue }   // key rotated/expired → sign in once more
    if (!res.ok) throw new Error('magpie trace: HTTP ' + res.status)
    return (await res.json()) as TraceResponse
  }
  throw new Error('magpie trace: unauthorized after re-sign-in (check MAGPIE_WEB_KEY)')
}
```

Minimal types (derived from §3–§5; `?` = may be absent):

```ts
type TraceResponse = {
  seq: number
  totals: { requests: number; rerouted: number; errors: number }
  ids?: number[]                     // 0.1.1755 only, redundant
  mine: boolean
  now: string                        // RFC3339 with offset
  routes: Route[]
}

type Route = {
  seq: number
  id: number
  time: string
  agent: string
  model: string
  provider: string
  effort?: string
  order: Weighed[] | null
  left?: Weighed[]
  tries: Try[]
  done: boolean
  status?: number
  error?: string
  ms?: number
  tokens?: number
  out?: number
  reasoning?: number
  ttft?: number
  firstText?: number
  firstReasoning?: number
  flow?: number
  sent?: number
  own?: number
  retried?: number
  queued?: number
  served?: string
  swapped?: boolean
  routed?: boolean
  upstream?: string
  usage?: { provider: string; model: string; in: number; out: number;
            cache_read?: number; cache_write?: number; reasoning?: number }[]
  prompt?: { tokens: number; window?: number; counted?: boolean; turns?: number;
             parts: { kind: string; tokens: number;
                      items: { name: string; tag?: string; n?: number; tokens: number }[] }[] }
  conv?: string
  cost: number
  priced: boolean
  unpriced: number
  sessionTitle?: string
}

type Weighed = {
  id: string
  provider: string
  name: string
  icon?: string
  kind: 'provider' | 'account' | 'key'
  model: string
  routing: '' | 'order' | 'rotate' | 'usage'
  used: number
  who?: string
  agent?: string
  plan?: string
  fixed?: string
  fast?: boolean
  fallback?: boolean
  shared?: boolean
  known?: boolean
  learns?: boolean
  turn?: boolean
  barred?: boolean
  held?: boolean
  [extra: string]: unknown
}

type Try = {
  id: string
  model?: string
  effort?: string
  start: string
  done: boolean
  status?: number
  ms?: number
  ttft?: number
  firstText?: number
  firstReasoning?: number
  flow?: number
  served?: string
  swapped?: boolean
  routed?: boolean
  upstream?: string
  tier?: string
  tierServed?: string
  fail?: string
  error?: string
  rest?: unknown
  again?: number
  net?: { own?: number; asks?: number; reused?: boolean; pool?: number; dns?: number;
          connect?: number; tls?: number; send?: number; wait?: number; head?: number }
  [extra: string]: unknown
}
```

---

## 11. Caveats, and what to re-check on another deployment

1. **Version drift.** The live server is `0.1.1755`. The source tree in `magpie/` differs slightly (it has no `ids`
   field in `traceJSON`), so the checkout is *not* byte-identical to the running build. Trust the wire, not the
   source, and re-run one `curl` after any magpie upgrade.
2. **Single-candidate paths.** This deployment produced `order.length === 1` and `tries.length <= 2`. A user with
   accounts, routing groups, rotation or fallbacks gets longer `order[]` and more `tries[]`; the JSON shape does not
   change, only the lengths. The animation must not assume one node or one leg.
3. **`order` can be `null`** (a refused request weighed no seats). Normalize to `[]` before iterating — the reference
   client does exactly this (`whole()`, 📖 `routing/client.js:1269`) because a single `null` threw in its render path.
4. **`cost` / `priced` / `unpriced` are computed per response** from the pricing table, so they can change between
   two polls of the same route. Display them as advisory.
5. **`ttft` / `flow` / `firstText` only exist for streamed replies** (📖 src). Non-streamed requests have `ms` only
   — do not draw a phase that is absent.
6. **Zone**: `time`, `now`, `start` carry the **server's** offset. Always parse to an instant.
7. **`mine: false` is a normal 200**, not an error. Handle it explicitly (§9.2).
8. **Checklist before shipping the integration**: `curl` the probes in §2.2 and §3.3 against the user's
   `MAGPIE_WEB_URL`; confirm the cookie name matches the port; confirm `mine` is `true`; confirm a `wait=1` call
   returns within 30 s; confirm gzip does not break the proxy.
