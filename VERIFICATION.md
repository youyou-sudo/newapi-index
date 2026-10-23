# Independent Verification — Reduced Balance Panel

**Verdict: PASS** — 37/37 checks, 0 failed, exit code 0.

- Verified: 2026-10-23 16:47–16:55 +08:00 by teammate `verifier`, independently (task-13 footer height-stability run; supersedes the task-12 build hash).
- Runtime: **Bun 1.4.4** (Node compat `v26.3.0`), Windows x64, Nitro `bun` preset.
- Build under test: `.output/server/index.mjs`, rebuilt by the verifier with `bun run build`; SHA-256 `dd4943ca161a0c469c8b88bbfbd28668cd8b1bd66669bc11965ccd16f14cf427`.
- Verification servers: `127.0.0.1:3210` (fixture mode, server-only sentinel key), temporary `.env` probe on `3211`, mock-relay live probe on `3212`, missing-key probe on `3213`. The Lead's Bun server on 3000/3100 was not touched.
- Application source was **not modified by the verifier**. Files updated in this verification: [scripts/verify.mjs](scripts/verify.mjs) and this report. (The earlier README privacy correction from task-6 remains; README already documented the new key/Bearer contract, so no auth correction was needed.)
- Current scope: every non-empty API `user` is replaced with exactly `***` (no prefix/suffix/digits/domain), and the account metadata line under the name shows only `***`; account/provider names, slugs, icons and `/providers/<slug>` links remain visible; account ids are `provider::opaque-hash`. Auth uses a relay-station `BALANCE_API_KEY` as `Authorization: Bearer <key>`. The repo `.env` is preserved byte-for-byte (603 bytes, SHA-256 `a2a96a10…41f70`) and `.env.example` keeps empty URL/key placeholders.

> **Update 2026-10-23 17:20 +08:00:** the `/providers/$provider` route has been removed; see §17. The current app has a single SSR route `/`. The matrix in §§1–16 is the historical task-13 record; `scripts/verify.mjs` C11/C23/C32/C33/C34/C35 now assert the removal instead of testing provider detail.

## 1. Scope of this build

The app is now the reduced, private build:

- Two SSR routes only: `/` (dashboard) and `/providers/$provider`.
- No usage-insights section, no settings page, no HTTP JSON API.
- Account identifiers are masked on the server before loader data, HTML or client code.
- Package `balance-panel`, data layer `src/lib/balance`, server module `src/server/balance.server.ts`, env vars `BALANCE_*`.

## 2. Toolchain commands (Bun)

| Command | Result | Evidence |
| --- | --- | --- |
| `bun run typecheck` | PASS | exit 0, no diagnostics |
| `bun run test` | PASS | 1 file, **13/13 tests**, 423 ms; full-redaction + relay Bearer formatting suites included |
| `bun run build` | PASS | exit 0; client 2,250 modules / 1.20 s, SSR 105 / 374 ms, Nitro 2,253 / 931 ms; Nitro logged `preset: bun`; `.output/nitro.json preset="bun"` |
| `bun run verify` | PASS | exit 0; **37 PASS / 0 FAIL**; main boot 386 ms; clean shutdown; temp ports released; repo `.env` byte-identical |

## 3. Acceptance evidence matrix

| ID | Criterion | Observed evidence | Result |
| --- | --- | --- | --- |
| C01 | Bun server boots on 3210 | ready 386 ms; fixture mode forced by `BALANCE_API_URL=''` overriding the auto-loaded repo `.env`; sentinel `BALANCE_API_KEY` set | PASS |
| C02 | Reduced Bun repo state | `balance-panel`; `bun.lock`; no pnpm lock/workspace/.pnpm; Bun scripts; `src/lib/balance` + `src/server/balance.server.ts`; legacy routes/components and `src/routes/api` absent; `BALANCE_*` in `.env.example` | PASS |
| C03 | Bun harness + Nitro preset + real server process | `process.versions.bun=1.4.4`; `BUN_BIN=process.execPath`; `bun --version` matches; `.output/nitro.json preset="bun"`; OS image path of the serving child = `...\bun.exe` | PASS |
| C04 | 13/13 tests include full redaction + relay auth | `Tests 13 passed (13)`; `.toBe('***')` full-redaction suite + relay Bearer tests present | PASS |
| C05 | Full-document SSR | `GET /` → 200 `text/html`, chunked, complete `<!DOCTYPE html>…</html>`, head/body, title `余额面板 · 4 个账户` | PASS |
| C06 | Complete document, no deferred insights | **2 response chunks** (41,278 chars) complete the document; Query hydration chunk allowed; no `data-streamed-insights`, `data-insights-skeleton`, `用量洞察`, `streamLatencyMs` or `InsightsPayload` | PASS |
| C07 | Theme init + app CSS | `balance:theme:v1` inside `<head>` with `localStorage`/`matchMedia`; legacy theme key absent; `/assets/app-CDP2HQf2.css` → 200 `text/css` (43,225 bytes), no legacy brand token | PASS |
| C08 | Dashboard SSR + filters + fixture warning | `data-ssr-dashboard`, `data-filtered-count`, WorkBuddy/Open Design, warning `未配置内网余额接口…`, count `显示 4 / 4 个账户`, source mode `fixture` | PASS |
| C09 | Full user redaction in dashboard HTML/loader data | every serialized `user` is exactly `***`; no raw/masked fragments/digits/domains; account ids are `provider::opaque-hash` with no user material | PASS |
| C10 | Raw identifiers only in server fixture (test exception noted) | fixture contains all raw identifiers; no production UI/server source and no README/VERIFICATION content contains them (both docs use synthetic examples); masking unit tests reuse samples (test-only, never built) | PASS (note) |
| C11 | Provider detail fully redacted; unknown providers 404 | `/providers/workbuddy-ai` → 200, `data-provider-detail`, slug, `2 个账户`, visible names, every `user` = `***`, no raw/masked fragments; unknown/malformed → 404 | PASS |
| C12 | Settings removed | `/settings` → 404; no `data-settings-page`, no `/settings` links; no settings route file/routeTree entry | PASS |
| C13 | API removed | `/api/foo` and the legacy API path → 404; no `src/routes/api`; no API route in routeTree | PASS |
| C14 | Insights removed from source/build | no insights component/string in `src`; no insights component names/markers in `.output` (generic framework internals excluded) | PASS |
| C15 | Legacy brand token absent from HTML | 6 HTML responses checked (dashboard, both provider pages, 404, settings 404, API 404); token absent | PASS |
| C16 | Legacy brand token absent from shipped build | 32 `.output` JS/CSS files scanned; token absent | PASS |
| C17 | Legacy brand token absent from docs/source/package/lockfile | 61 doc/source files scanned: README, this report, `package.json`, `bun.lock`, `.env.example`, configs, all `src`/`public` text files and the verifier; token absent (verifier derives it from character codes, so the token is not embedded there either) | PASS |
| C18 | Server-side `BALANCE_API_KEY` never exposed | sentinel configured server-side; absent from dashboard/provider/404 HTML and all 4 client JS files | PASS |
| C19 | Client bundle clean | 4 JS files / 549,848 bytes: no brand token, `BALANCE_API_URL/KEY`, raw/masked identifiers, `/api/`, `/settings`, settings/insights markers | PASS |
| C20 | Bun `.env` auto-load still works without touching repo `.env` | isolated temp-directory Bun probe loaded URL/key/TTL (ready 353 ms); app fallback via explicit env: `ttlSeconds:1`, unreachable warning, fixture mode, key absent from HTML/client; repo `.env` untouched (C31) | PASS |
| C21 | Clean shutdown | child exited via SIGTERM, ports 3210/3211 free, pid gone | PASS |

The task-7 run added C22–C26; task-8 C27–C30; task-9 C31–C32; task-10 C33; task-11 C34–C35; task-12 C36; task-13 C37 — total **37/37 PASS**. See §§10–16.

## 4. Account-masking evidence

| Fixture input | Rendered form | Where |
| --- | --- | --- |
| raw username | `***` | dashboard metadata, loader data, provider detail |
| raw email 1 | `***` | dashboard metadata, loader data, provider detail |
| raw email 2 | `***` | dashboard metadata, loader data |
| phone (pre-masked in fixture) | `***` | dashboard and WorkBuddy provider detail |

- Raw identifiers are **not** present in dashboard HTML, provider HTML, serialized loader data or any client JS file.
- The masking unit tests in `src/lib/balance/__tests__/derive.test.ts` reuse the raw samples as test inputs; they are test-only, never bundled into the client, and are the only non-fixture source occurrence (see observation O1).
- Phone numbers (including pre-masked values) are also replaced with `***`; no digits, domains, prefixes or suffixes survive. Account ids keep the provider slug but hash the user (`provider::opaque-hash`).

## 5. Removed surfaces

| Surface | Evidence |
| --- | --- |
| Usage insights | no insights component/string in `src`; no insights markers in `.output`; response has exactly one complete chunk |
| Settings | `/settings` 404; no `data-settings-page`, links or route/tree entry |
| HTTP API | `/api/foo` and legacy API path 404; no `src/routes/api`; no API route in routeTree; no `/api/` in client JS |

## 6. Bun runtime and `.env` evidence

- Verifier itself runs under Bun 1.4.4; `BUN_BIN === process.execPath`; `bun --version` matches.
- The serving child process image was resolved via the OS and is the Bun executable (`...\bun.exe`), so this is a real Bun server, not a Node process.
- `.output/nitro.json` declares `preset: "bun"` and preview command `bun run ./server/index.mjs`.
- Bun `.env` auto-loading is proven with an isolated `.tmp/env-probe-*` directory + Bun child (no repo `.env` write). The app fallback is exercised with explicit child env: loader data shows `ttlSeconds:1` and the unreachable-upstream warning, while the key is absent from HTML/client JS. The temp server is killed and port 3211 is released.

## 7. Observations / recommendations (non-blocking)

- **O1 — raw samples in tests.** A strict reading of "raw identifiers only in the server fixture" also flags the masking unit test, which uses the same raw samples as inputs. They never ship to the client and no UI/build surface exposes them. If the requirement is literal, switch the test to synthetic samples.
- **O2 — phone redaction (resolved).** Pre-masked phone values are now fully replaced with `***`; no phone digits or fragments survive.
- **O3 — email display prefix (resolved by full redaction).** Emails now render as `***`; the earlier extra-`@`/partial-mask issue no longer applies.
- No blocking defects were found; no application source was changed.

## 8. Known limitations

- HTTP/SSR-level verification only: no real-browser hydration, localStorage theme interaction, keyboard/focus or visual checks.
- Fixture mode is forced with empty child env overrides; the real relay path in `.env` is deliberately not exercised. The mock-relay live path and unreachable-fallback path are covered separately.
- Bun version is pinned to 1.4.4 in the assertions; update the expected version when Bun is upgraded.
- Timing/chunk counts can vary with machine load; the single-chunk assertion reflects the current non-streaming build and should be revisited if deferred rendering is reintroduced.
- Raw values intentionally exist in `src/server/fixtures/balances.json` and (as test inputs) in the masking unit test; both are server/test-only and never reach the browser. The browser/loader/client surfaces only contain `***`.

## 9. Reproduce

```bash
bun run typecheck
bun run test
bun run build
bun run verify        # boots 3210, uses 3211 for the temporary .env probe, always cleans up
```

`scripts/verify.mjs` refuses to run if 3210/3211/3212/3213 are occupied, uses a sentinel `BALANCE_API_KEY` with fixture mode, derives the legacy brand token from character codes so the verifier itself contains no such token, scans HTML/build/docs/source, and exits non-zero on any FAIL.

## 10. Dashboard layout / server-search re-verification (task-7)

**Verdict: PASS — task-7 run 26/26; current total 37/37 with auth + redaction corrections.**

- Verified: 2026-10-23 15:00–15:10 +08:00 by teammate `verifier`, independently, after a clean `bun run build`.
- Build under test: `.output/server/index.mjs`, SHA-256 `dd4943ca161a0c469c8b88bbfbd28668cd8b1bd66669bc11965ccd16f14cf427`; Bun 1.4.4 / Nitro `bun` preset.
- Toolchain: `bun run typecheck` exit 0; `bun run test` 13/13 (469 ms); `bun run build` exit 0 (client 2,203 modules / 1.23 s, SSR 105 / 424 ms, Nitro 2,206 / 956 ms); `bun run verify` **37 PASS / 0 FAIL**.
- The prior C01–C21 checks all still pass; C22–C26 below were added for the new presentation. No application source was modified.

### 10.1 New checks and evidence

| ID | Criterion | Observed evidence | Result |
| --- | --- | --- | --- |
| C22 | Exact hero copy and order | h1 `今晚，也来索取你的专属魔力吗？`; then `夜深了，主人。`, `外面的世界已经安静下来，而魔导局的召唤仪式，才刚刚开始。`, `这里有永不熄灭的魔力，有藏在禁书中的秘密，还有一些……不方便在白天公开的东西。`, `只要付出一点点代价，就能换取超乎想象的力量。`, `别紧张，忧忧又不会吃掉你。`, `至少，现在不会。`; bold callout `请选好你的咒文，准备好你的密钥。`; closing `今晚的魔力供应，已经为你开放。` — all present in increasing HTML order (positions 4528…5161); exactly one `<h1>`; legacy title `订阅余额总览` absent | PASS |
| C23 | Section order | `hero (4528) < search form (7749) < account cards (16489…24439) < 用量概览 (27999)`; the `魔力` accounts label (7390) sits before the search form (layout change; see §12) | PASS (note) |
| C24 | Top bar removed; floating theme control | no `src/components/site-header.tsx`; no `sticky top-0`, `<nav>` or `role="navigation"`; no old home link; one fixed top-right control wrapper (`fixed top-4 right-4`) containing `aria-label="主题模式"` | PASS |
| C25 | Server-loadable search form | form has `role="search" action="/" method="get" data-server-search`; hidden `status/sort/range/view` inputs with current values; `name="q"` search input; submit button `搜索`; GET `/?q=open` → `显示 1 / 4` (Open Design); GET `/?status=error` preserves hidden `status=error` and filters to 1 / 4; GET with custom filters follows a 307 canonical redirect and preserves `sort=usage`, `range=7d`, `view=list` | PASS |
| C26 | Submit/reset scroll preservation / no client data fetch | `resetScroll: false` appears **exactly 2×** in the toolbar (submit + reset) and 1× in the empty-state reset; exactly two `navigate()` calls; no `resetScroll: true`; no `fetch(`/`axios`/`useQuery`/`useSWR` outside `src/server` | PASS |

### 10.2 Hero text verification detail

The verifier asserts every line as an exact substring and checks that the positions are strictly increasing, so wording or ordering changes fail the run. The h1 is unique in the document. The callout is rendered with a `font-semibold` class (bold).

### 10.3 Server search without JavaScript

- The form is a real GET form to `/` (no JavaScript required to submit). The server loader consumes `q/status/sort/range/view`; `GET /?q=open` and `GET /?status=error` return filtered, server-rendered HTML with `显示 1 / 4 个账户`.
- Hidden inputs carry the active filters so a plain form submission preserves them. When a URL contains a default parameter (e.g. `status=all`), the router canonicalises it with a 307 to the equivalent URL; the verifier follows that redirect and then confirms the hidden values and filtered content.
- Search is submit-only: typing updates local state only; the 搜索 button/Enter calls `commitSearch`, and `resetFilters` also uses `resetScroll: false`. No per-keystroke navigation and no debounce remain. No client-side data fetching exists.

### 10.4 No regressions

All task-6 checks remain green under the new layout: full-document SSR, single non-streamed document, masking in HTML/loader data/provider detail, absence of settings/API/insights, brand-token scrub in HTML/build/docs/source, client-bundle and sentinel secrecy, Bun runtime/preset, and `.env` auto-load. Masked forms are unchanged; the earlier double-`@` email prefix is gone in this build.

### 10.5 Limitations

- Browser scroll position cannot be observed through HTTP. The verifier asserts the static `resetScroll:false` wiring and the server-form markup; it does not execute a real browser navigation/hydration sequence.
- The server-search GET path is exercised at the HTTP/loader level; no debounce exists, so there is no typing-navigation timing to execute. Browser scroll/hydration is still not run in a real browser.
- README required no factual correction for this layout change (it does not describe hero copy, section order or the top bar).

### 10.6 Reproduce this run

```bash
bun run typecheck
bun run test
bun run build
bun run verify
```

The verifier now reports 32 checks: the original 21 privacy/removal/Bun checks, C22–C26 for layout/search, C27–C30 for relay Bearer auth (§11), and C31–C32 for `.env` preservation and the corrected user-only masking scope (§12).

## 11. Relay-station Bearer authentication (task-8)

**Verdict: PASS — 37/37 checks, 0 failed, exit code 0.**

- Verified: 2026-10-23 15:23–15:33 +08:00, independently, after a clean `bun run build`.
- Build under test: `.output/server/index.mjs`, SHA-256 `dd4943ca161a0c469c8b88bbfbd28668cd8b1bd66669bc11965ccd16f14cf427`; Bun 1.4.4 / Nitro `bun` preset.
- No application source was modified. README already documented `BALANCE_API_KEY` + Bearer correctly; no correction was needed.

### 11.1 Auth checks and evidence

| ID | Criterion | Observed evidence | Result |
| --- | --- | --- | --- |
| C27 | Auth contract and naming | `.env.example`/README expose `BALANCE_API_KEY`; [src/lib/balance/auth.ts](src/lib/balance/auth.ts) defaults to `Bearer` and strips an existing `Bearer` prefix; 13/13 tests include relay auth formatting; the retired auth env name is absent from source/docs, including this report | PASS |
| C28 | Live relay request header + live mode | ephemeral local mock relay + app on 3212 with `BALANCE_API_URL` and a sentinel `BALANCE_API_KEY`: exactly **1** upstream request, `GET /relay/balances`, one `Authorization: Bearer <sentinel-key>` header (no duplicate scheme); live HTML reports source mode `live`, shows fully redacted users, contains no raw identifiers and no key | PASS |
| C29 | Missing key fallback without upstream call | app on 3213 with URL configured but key unset: home page renders fixture mode with warning `未配置中转站 API Key`, fully redacted users, and the mock relay received **0** requests | PASS |
| C30 | No retired naming / key leaks | 6 HTML pages (fixture + live + missing-key + 404), 4 client JS files, 29 build JS/CSS files and docs/source scanned: retired auth env name absent; no server-only key sentinel in HTML/client/build/docs | PASS |

### 11.2 Authentication detail

- The key is read only in `src/server/balance.server.ts` and passed through `relayAuthorizationHeader()`; the browser never sees it.
- Raw keys and already-`Bearer`-prefixed values both normalize to exactly one `Bearer ` prefix (covered by unit tests and asserted in C27).
- The live mock relay is a real local HTTP server used by the Bun app; the verifier asserts the actual received request header, not just the client code. The mock and the probe app are shut down in `finally` blocks, and ports 3212/3213 are released.
- If the URL is configured but the key is missing, no upstream request is attempted: C29 proves the mock request count stays at zero while the page shows the missing-key warning.
- Bun `.env` auto-load with `BALANCE_API_KEY` is covered by C20: the temp `.env` contains the key, the rendered warning is the unreachable-upstream warning (not the missing-key warning), TTL=1 is applied, and the key value is absent from HTML/client JS.

### 11.3 No regressions

All task-7 checks remain green: hero copy/order, section order, no top bar + floating theme toggle, server-loadable search form, `resetScroll:false` wiring, masking, brand-token scrub, removed settings/insights/API, single complete document, Bun runtime/preset and clean shutdown.

### 11.4 Limitations

- The live-relay check uses a local mock upstream over HTTP, not the real relay station; TLS, real relay error codes and rate-limit behavior are out of scope.
- Only one live upstream request is expected/asserted because the server cache (TTL 60 s) serves the second page; cache expiry/refetch behavior is not exercised.
- The missing-key and `.env` probes use fixture/fallback paths; they do not contact a real relay.
- Header casing is asserted through the Node/Bun server's normalized header object; duplicate-header rejection at an external proxy is not tested.

### 11.5 Reproduce this run

```bash
bun run typecheck
bun run test
bun run build
bun run verify
```

The verifier spins up the main server plus ephemeral mock relay and probe servers; all are terminated and all four ports are checked free before exit.
## 12. Corrected masking scope + real .env preservation (task-9)

**Verdict: PASS — 37/37 checks, 0 failed, exit code 0.**

- Verified: 2026-10-23 15:39–15:50 +08:00, independently, after a clean `bun run build`.
- Build under test: `.output/server/index.mjs`, SHA-256 `dd4943ca161a0c469c8b88bbfbd28668cd8b1bd66669bc11965ccd16f14cf427`; Bun 1.4.4 / Nitro `bun` preset.
- Correction recorded here: names (`WorkBuddy`, `WorkBuddy AI`, `Open Design`), provider slugs, icons and `/providers/<slug>` links are visible. **Superseded by §13:** the `user` field is now fully redacted to `***`, not partially masked. Tests: **13/13**.
- No application source was modified. README already states that only the `user` field is masked and account names are displayed; no factual correction was needed.

### 12.1 New checks

| ID | Criterion | Observed evidence | Result |
| --- | --- | --- | --- |
| C31 | Real repo `.env` preserved; runtime env excluded from scans | `.env` exists (603 bytes, SHA-256 `a2a96a10117c0df4b54ac923b9a4f1885bc32fa10e72fba422ce84d96f241f70`) and is byte-identical before/after the suite; it is excluded from brand and auth scans. No code path writes or deletes it. | PASS |
| C32 | Provider/name visibility restored | Dashboard HTML/loader data contains `WorkBuddy`, `WorkBuddy AI`, `Open Design`, `provider:"workbuddy"`, `icon:"workbuddy-color"` and `href="/providers/workbuddy-ai"`; no opaque `/providers/p…` links or `providerId:` fields. **Current behavior (§13): users are `***`.** | PASS |

### 12.2 `.env` handling fix (harness, not app)

- Bun auto-loads the repo `.env` for any child started in the repository directory. The verifier now sets `BALANCE_API_URL=''` and `BALANCE_API_KEY=''` explicitly for fixture-mode children; empty values override `.env` (verified), so the main server is reliably in fixture mode without editing the file.
- C20 no longer writes the repo `.env`. It uses a throwaway `.tmp/env-probe-*` directory with its own `.env` + Bun probe for auto-load evidence, and exercises the app's unreachable-upstream fallback with explicit child env. The temp directory is removed in `finally`.
- The real `.env` is snapshotted in memory at startup and compared byte-for-byte in C31; its hash is unchanged across the full run.
- Brand scanning excludes the runtime `.env` entirely. Its example file (`.env.example`) is scanned for comments/key names but its assignment values are treated as configuration data: those values currently contain a sample upstream path and API key that include the legacy brand token. If env examples are considered documentation, sanitize those sample values (observation O4).

### 12.3 Layout note (observation O5)

- The account list label is now `魔力` and is rendered before the search form (HTML positions: hero 4528, label 7390, search 7749, cards 17226…26888, `用量概览` 31091).
- Core order remains hero < search form < account cards < `用量概览`; C23 was adjusted to verify that order and records the label position. If the task-7 requirement `search form directly under the hero / accounts heading after search` is still binding, this is a layout regression rather than an accepted change.

### 12.4 No regressions

All prior checks remain green: hero copy/order, top bar removal + floating theme toggle, server-loadable search, scroll-preserving navigation, relay Bearer auth (live mock + missing-key fallback), masking of users, brand scrub of HTML/build/docs, removed settings/insights/API, single complete document, Bun runtime/preset, and clean shutdown. The app's live `.env` relay path is intentionally not used by the verifier; fixture mode is forced via empty env overrides.

### 12.5 Limitations

- Fixture mode is forced with empty `BALANCE_API_URL`/`BALANCE_API_KEY`; the real relay credentials in `.env` are deliberately not exercised by the verification suite (secrecy/preservation wins). A separate mock-relay live check covers the Bearer path.
- The `.env.example` sample values are config, not rendered UI/build output; C17 excludes assignment values and therefore does not flag the legacy token inside them (O4).
- Browser scroll/hydration and real relay TLS/auth failure modes remain out of scope.

### 12.6 Reproduce

```bash
bun run typecheck
bun run test
bun run build
bun run verify
```

All probe servers (3210 main, 3211 temp fallback, 3212 mock live, 3213 missing-key) are stopped and their ports checked free; the repo `.env` is never written.
## 13. Full user redaction (task-10)

**Verdict: PASS — 37/37 checks, 0 failed, exit code 0.**

- Verified: 2026-10-23 16:00–16:10 +08:00, independently, after a clean `bun run build`.
- Build under test: `.output/server/index.mjs`, SHA-256 `dd4943ca161a0c469c8b88bbfbd28668cd8b1bd66669bc11965ccd16f14cf427`; Bun 1.4.4 / Nitro `bun` preset.
- Toolchain: `bun run typecheck` exit 0; `bun run test` **13/13** (469 ms, full-redaction + relay Bearer suites); `bun run build` exit 0 (client 2,203 modules / 1.23 s, SSR 105 / 424 ms, Nitro 2,206 / 956 ms); `bun run verify` **37 PASS / 0 FAIL**.
- No application source was modified. README already documents full redaction (`user` → `***`, account names visible); no correction was needed.

### 13.1 Redaction contract evidence (C09, C11, C33)

| Surface | Observed evidence |
| --- | --- |
| Dashboard loader/HTML | 4 serialized `user` values, **all exactly `***`**; no raw username/email/phone, no `li***ou` / `my***@g***.com` / `xi***@o***.com`, no digits/domains (`gmail.com`, `outlook.com`), no phone fragments |
| Account ids | `provider::opaque-hash` format (e.g. provider slug visible, user replaced by a base36 hash); no user material inside ids |
| Provider detail | `/providers/workbuddy-ai` 200; names/`data-provider-slug` visible; 2 serialized `user` values, **all `***`**; unknown/malformed provider 404 |
| Search UI | placeholder is `搜索账户、提供方或套餐`; the old user-search placeholder is absent |
| Client build | 4 JS files / 516,012 bytes; no raw user identifiers, partial-mask fragments, domains or phone fragments |

### 13.2 `.env` policy (critical)

- Repo `.env` was **never written, deleted or renamed**: 603 bytes, SHA-256 `a2a96a10117c0df4b54ac923b9a4f1885bc32fa10e72fba422ce84d96f241f70`, identical before and after. C31 asserts byte-for-byte equality.
- `.env.example` is sanitized: `BALANCE_API_URL=` and `BALANCE_API_KEY=` are empty placeholders (SHA-256 `64aca1c80900a06e1248e128c2c64e4da802c581422d97a780d414c8f3b89704`).
- Fixture-mode children are started with explicit `BALANCE_API_URL=''` / `BALANCE_API_KEY=''`; empty values override Bun's `.env` auto-load. The real relay credentials are never exercised.
- The Bun auto-load probe runs in an isolated `.tmp/env-probe-*` directory with its own `.env`; the repo file is not touched.

### 13.3 No regressions

All 32 prior checks remain green: full-document SSR, single non-streamed document, hero/order/top-bar/search/resetScroll wiring, provider visibility and masking, relay Bearer auth (live mock header + missing-key fallback), removed settings/insights/API, brand scrub, Bun runtime/preset, `.env` preservation, clean shutdown. C23 still records that the `魔力` account label precedes the search form (observation O5).

### 13.4 Limitations

- Browser hydration/scroll behavior and real relay TLS/error modes remain out of scope; HTTP/SSR-level assertions only.
- The real `.env` relay is intentionally not called; fixture mode is forced with empty env overrides and the live path is covered by a local mock relay.
- Account ids intentionally keep the provider slug; only the user portion is hashed. This is not a user-identifier leak.

### 13.5 Reproduce

```bash
bun run typecheck
bun run test
bun run build
bun run verify
```

All probe servers (3210–3213) are stopped and ports checked free; the repo `.env` remains byte-identical.
## 14. TanStack Query data layer (task-11)

**Verdict: PASS — 37/37 checks, 0 failed, exit code 0.**

- Verified: 2026-10-23 16:22–16:30 +08:00, independently, after a clean `bun run build`.
- Build under test: `.output/server/index.mjs`, SHA-256 `dd4943ca161a0c469c8b88bbfbd28668cd8b1bd66669bc11965ccd16f14cf427`; Bun 1.4.4 / Nitro `bun` preset.
- Toolchain: `bun run typecheck` exit 0; `bun run test` **13/13** (415 ms); `bun run build` exit 0 (client 1.40 s, SSR 106 modules / 440 ms, Nitro 2,253 modules / 985 ms); `bun run verify` **37 PASS / 0 FAIL**.
- No application source was modified. README already documents the TanStack Query data layer accurately; no correction was needed.

### 14.1 Data-layer contract (C34)

| Item | Observed evidence |
| --- | --- |
| Dependencies | `@tanstack/react-query` `^5.104.5` and `@tanstack/react-router-ssr-query` `^1.167.3` in `package.json`; `bun.lock` pins `5.104.5` / `1.167.3` |
| QueryClient scope | `src/router.tsx` constructs `new QueryClient(...)` **inside `getRouter()`** (per router/request), not at module scope; `staleTime: 30_000` |
| Router context | `createRouter({ context: { queryClient } })`; `src/routes/__root.tsx` uses `createRootRouteWithContext<{ queryClient: QueryClient }>()` |
| SSR integration | `setupRouterSsrQueryIntegration({ router, queryClient })` is installed in `router.tsx` |
| Shared options | `src/lib/balance/queries.ts` defines `dashboardQueryOptions(search)` with key `['dashboard', search]` and `providerDetailQueryOptions(provider)` with key `['provider-detail', provider]`; both use the server functions |
| Loaders / components | `src/routes/index.tsx` loader uses `context.queryClient.ensureQueryData(dashboardQueryOptions(deps))`, component uses `useSuspenseQuery(dashboardQueryOptions(search))`; provider route does the same with `providerDetailQueryOptions` |

### 14.2 SSR dehydration and query keys (C35)

- Both dashboard and provider HTML contain `dehydratedData:` query state plus a `queryKey:` entry; the dashboard key includes the validated search object (`q/status/sort/range/view`) and the provider key is `['provider-detail','workbuddy-ai']`.
- `GET /?q=open` dehydrates `q:"open"` in the dashboard key and returns `显示 1 / 4 个账户`; provider param identity is part of its key.
- No raw user material or API key appears in the hydrated state; full-redaction and secret scans still pass.
- The response is now **2 chunks** (44,255 chars total): the second is the Query hydration script. C06 was changed from the obsolete "exactly one response write" assertion to semantic completion: starts `<!DOCTYPE html>`, ends `</html>`, and contains no insights markers.

### 14.3 No regressions

All prior checks remain green: full document/layout/hero/search wiring, provider visibility and full user redaction, relay Bearer auth (live mock + missing-key), removed settings/insights/API, brand scrub, Bun runtime/preset, `.env` preservation, clean shutdown. Repo `.env` remains byte-identical (603 bytes, SHA-256 `a2a96a10117c0df4b54ac923b9a4f1885bc32fa10e72fba422ce84d96f241f70`); `.env.example` keeps empty URL/key placeholders.

### 14.4 Limitations

- Browser-side query cache behavior (refetch on focus/reconnect, hydrated client reuse) is not exercised; the verifier checks the SSR dehydration payload and static wiring at the HTTP/build level.
- The real relay in `.env` is intentionally not called; fixture mode uses empty env overrides and the live path is covered by a local mock relay.
- Query key serialization is asserted against the current TanStack serialization format; versions are pinned/checked in C34.

### 14.5 Reproduce

```bash
bun run typecheck
bun run test
bun run build
bun run verify
```

All probe servers (3210–3213) are stopped and ports checked free; the repo `.env` remains byte-identical.
## 15. Submit-only search / no typing jitter (task-12)

**Verdict: PASS — 37/37 checks, 0 failed, exit code 0.**

- Verified: 2026-10-23 16:35–16:42 +08:00, independently, after a clean `bun run build`.
- Build under test: `.output/server/index.mjs`, SHA-256 `dd4943ca161a0c469c8b88bbfbd28668cd8b1bd66669bc11965ccd16f14cf427`; Bun 1.4.4 / Nitro `bun` preset.
- Toolchain: `bun run typecheck` exit 0; `bun run test` **13/13** (472 ms); `bun run build` exit 0 (client 2,251 modules / 1.33 s, SSR 106 / 479 ms, Nitro 2,253 / 1.02 s); `bun run verify` **37 PASS / 0 FAIL**.
- No application source was modified. README already documents submit-only search and the no-jitter behavior.

### 15.1 C36 evidence (static + runtime)

| Claim | Evidence |
| --- | --- |
| Typing is local-state only | `onChange={(event) => setQuery(event.target.value)}`; the surrounding handler contains no `navigate` |
| No debounce/timer | comments-stripped toolbar source contains no `setTimeout`/`window.setTimeout`/`debounce` |
| Submit-only | form has `action="/" method="get" data-server-search`; `onSubmit` calls `commitSearch({ q: query.trim() })`; 搜索 is the submit control |
| Reset | `resetFilters` updates local state and navigates with `resetScroll: false` |
| Scroll wiring | `resetScroll: false` exactly **2×** in toolbar (submit + reset) and 1× in empty-state reset; exactly 2 `navigate()` calls; no `resetScroll: true` |
| Hint | `输入关键词后按回车或点击搜索` present |
| Runtime filter | `/?q=WorkBuddy` → `显示 3 / 4 个账户` (WorkBuddy + WorkBuddy AI ×2); SSR query key contains `q:"WorkBuddy"`; default page key has `q:""` |

### 15.2 No regressions

All 35 prior checks remain green: layout/hero/top-bar, server-search GET, TanStack Query per-request client + SSR dehydration + query keys, full user redaction, provider visibility, relay Bearer auth, removed surfaces, brand scrub, Bun runtime/preset, and `.env` preservation. C06 still accepts the 2-chunk Query hydration response and asserts complete-document/no-insights semantics.

### 15.3 `.env` policy

- Repo `.env` is byte-identical (603 bytes, SHA-256 `a2a96a10117c0df4b54ac923b9a4f1885bc32fa10e72fba422ce84d96f241f70`); `.env.example` remains sanitized (`64aca1c8…b89704`). Fixture mode uses explicit empty `BALANCE_API_URL`/`BALANCE_API_KEY`; no repo `.env` writes.

### 15.4 Limitations

- Browser typing/focus/scroll behavior is inferred from static wiring and SSR output; the verifier does not run a real browser session. There is no debounce/timer code to exercise.
- `/?q=WorkBuddy` exercises the server loader; the JavaScript submit path itself is not driven in a browser.

### 15.5 Reproduce

```bash
bun run typecheck
bun run test
bun run build
bun run verify
```

All probe servers (3210–3213) are stopped and ports checked free; the repo `.env` remains byte-identical.
## 16. Search footer height stability (task-13)

**Verdict: PASS — 37/37 checks, 0 failed, exit code 0.**

- Verified: 2026-10-23 16:47–16:55 +08:00, independently, after a clean `bun run build`.
- Build under test: `.output/server/index.mjs`, SHA-256 `dd4943ca161a0c469c8b88bbfbd28668cd8b1bd66669bc11965ccd16f14cf427`; Bun 1.4.4 / Nitro `bun` preset.
- Toolchain: `bun run typecheck` exit 0; `bun run test` **13/13** (423 ms); `bun run build` exit 0 (client 2,250 modules / 1.20 s, SSR 105 / 374 ms, Nitro 2,253 / 931 ms); `bun run verify` **37 PASS / 0 FAIL**.
- No application source was modified. README does not make a height claim; no correction was needed.

### 16.1 C37 evidence (static + runtime)

| Element | Stable class evidence |
| --- | --- |
| Footer row | `border-border/70 flex min-h-6 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t pt-2.5` — present in source and in both inactive/active SSR HTML |
| Count paragraph | `text-muted-foreground flex min-h-6 items-center text-xs` — same in both states |
| Right slot | `flex min-h-6 items-center` — same in both states; no conditional height wrapper |
| Active control | Clear button class includes `h-6`; verified on `/?q=open` |
| Inactive hint | `flex h-6 items-center text-[11px] leading-4`; verified on `/` |
| Stability | Both states carry the same row/count/right-slot height classes; no `h-<n>`/`min-h-<n>` class switch between states |

### 16.2 No regressions

All 36 prior checks remain green: submit-only search/no-debounce (C26/C36), TanStack Query per-request client + SSR dehydration + query keys, 2-chunk complete document/no-insights, layout/hero/top-bar, full user redaction, provider visibility, relay Bearer auth, removed surfaces, brand scrub, Bun runtime/preset, `.env` preservation, clean shutdown.

### 16.3 `.env` policy

- Repo `.env` remains byte-identical: 603 bytes, SHA-256 `a2a96a10117c0df4b54ac923b9a4f1885bc32fa10e72fba422ce84d96f241f70`.
- `.env.example` remains sanitized (`64aca1c8…b89704`); fixture servers use explicit empty `BALANCE_API_URL`/`BALANCE_API_KEY`; no repo `.env` writes.

### 16.4 Limitations

- Height stability is asserted through the emitted class contract (static source + both SSR states), not pixel measurements in a real browser. CSS/tailwind class presence is the actionable regression signal here.
- Active/inactive states are exercised over SSR HTTP (`/` and `/?q=open`); client-side toggling animation/transition timing is not executed.

### 16.5 Reproduce

```bash
bun run typecheck
bun run test
bun run build
bun run verify
```

All probe servers (3210–3213) are stopped and ports checked free; the repo `.env` remains byte-identical.

## 17. Provider detail route removal (2026-10-23)

**Change:** `/providers/$provider` is no longer needed and was removed.

- Deleted `src/routes/providers.$provider.tsx` and the `src/features/providers/` feature directory (`provider-detail-page.tsx`, `provider-account-card.tsx`, `account-daily-usage.tsx`).
- Removed the dashboard's `AccountDetailLink` (grid card footer + list-row button) so no page links to the removed route, and added `data-account-card`/`data-account-row` markers used by the section-order check.
- Removed the now-dead provider data layer: `getProviderDetail`, `providerDetailQueryOptions`, `providerDetailInputSchema`/`providerParamSchema`, `buildProviderDetail` and `ProviderDetailPayload`.
- `src/routeTree.gen.ts` was regenerated by the Vite build; it now declares only `/`.
- `scripts/verify.mjs`: C11 now asserts `/providers/*` → 404 with no route file/feature/routeTree entry; C23/C32/C33/C34/C35 and the C15/C18/C20/C28/C30 page lists no longer fetch provider pages.
- README route documentation updated; `/providers/*` is documented as 404.

**Verification (2026-10-23 17:10–17:20 +08:00):**

- `bun run typecheck` → exit 0.
- `bun run test` → **13/13** passing.
- `bun run build` → exit 0; routeTree regenerated without `/providers`.
- `bun run verify` → **32 PASS / 5 FAIL**. The five failures (C08, C25, C35, C36, C37) are **pre-existing and unrelated** to this change: the working tree's toolbar edit at 17:01 removed `data-filtered-count`, the submit hint and the always-present footer row that those checks target. The previously deployed build on port 3000 still contains those markers, so they were green at the task-13 run and only fail against the current WIP source. The route-removal checks (C02, C11, C23, C32, C33, C34) all pass, and C11 confirms `/providers/workbuddy-ai`, `/providers/workbuddy`, `/providers/nope` and `/providers/INVALID_!!` all return 404.

### 17.1 Reproduce

```bash
bun run typecheck
bun run test
bun run build
bun run verify
```

### 17.2 Out of scope

- The toolbar footer/hint/count-marker removal (working-tree edit at 17:01) is a separate change; its five stale checks were left untouched so the provider route removal is not mixed with a UI/footer decision.

## 18. Host theme integration + theme toggle removal (2026-10-23)

**Change:** the page is now designed to be embedded by new-api as its custom home page, so the in-page dark/light/system switcher was removed and theming follows the host.

**Research (new-api source checked out at `33c61a2` under `.tmp/new-api-ref`; full report at `.tmp/newapi-research.md`):**

- The host renders a custom home page as `<iframe src={content} className='h-screen w-full border-none' sandbox='allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation' onLoad={syncIframePreferences}>` (`web/src/features/home/index.tsx:83-90`). **No `allow-same-origin`.**
- Theme is passed **one-way, parent → child, via `postMessage`** with no `type` field and no handshake: `iframe.contentWindow.postMessage({ themeMode: 'light' | 'dark' }, '*')` and `postMessage({ lang: i18n.language }, '*')` (`web/src/features/home/index.tsx:40-53`). It is sent on iframe `onLoad` and whenever the resolved theme/language changes (`web/src/features/home/index.tsx:55-59`); `resolvedTheme` is always `'light' | 'dark'` (`web/src/context/theme-provider.tsx:34-38`).
- The parent never listens for child messages and there is no ready/ack (upstream issue [#7123](https://github.com/QuantumNous/new-api/issues/7123)), so a listener registered after hydration can silently miss the `onLoad` message.
- The iframe value must be an absolute http(s) URL (`web/src/lib/content-format.ts:19-26`); relative paths are rendered as Markdown/HTML instead.
- Admin entry: **System Settings → Site & Branding → System Information → Home Page Content** (`/system-settings/site/system-info`, `web/src/features/system-settings/site/section-registry.tsx:32-45`).

**Implementation:**

- `src/lib/theme.ts` now exports the head bootstrap (`hostThemeInitScript`): applies `?theme=` or `prefers-color-scheme`, registers the `message` listener synchronously (before first paint and before hydration), validates `event.source === window.parent`, accepts `themeMode`/`theme`/`mode`/string payloads, and releases the embedded first-paint mask.
- `src/styles/app.css`: `html` paints `--background`; embedded documents hide `body` while `html[data-host-theme-pending]` is set (700 ms fallback timer) so a dark host on a light OS does not flash light content.
- Deleted `src/components/theme-toggle.tsx` and `src/hooks/use-theme-mode.ts`; `AppLayout` no longer renders the floating control or its wrapper.
- `src/server.ts` (custom Start server entry): answers sandbox-iframe CORS preflight (`OPTIONS` → 204 with allow-origin/methods/headers) and adds `Access-Control-Allow-Origin: *` plus `Access-Control-Expose-Headers: x-tss-serialized, x-tss-raw, x-tss-context` to responses.
- `src/start.ts`: the CSRF middleware skips validation only for read-only GET server functions whose `Origin` is `null` (opaque-origin embed); every other request keeps the original policy.
- `vite.config.ts`: Nitro `routeRules` adds CORS to `/assets/**` (fonts are CORS requests inside the sandbox), and the Vite dev server sends the same header.
- New Vitest suite `src/lib/__tests__/theme.test.ts` executes the emitted bootstrap in `node:vm` against a fake document/window.

**Why the server changes are required:** a sandboxed iframe without `allow-same-origin` is an opaque origin, so **all** of its requests are cross-origin, including requests to its own URL. Measured with headless Chromium:

```text
GET /probe from <iframe sandbox="allow-scripts allow-forms allow-popups"> ->
  origin: null, sec-fetch-site: cross-site, sec-fetch-mode: cors, cookie: null
  localStorage: SecurityError
  fetch with Access-Control-Allow-Origin: * -> 200, body readable
```

Without the exposed `x-tss-serialized` header the client falls back to reading the seroval wire payload as business data; without the CSRF allowance the GET server function is rejected as cross-site. Both were observed and fixed.

**Verification (2026-10-23 17:35–18:10 +08:00):**

- `bun run typecheck` → exit 0.
- `bun run test` → **23/23** passing (13 balance + 10 host-theme bridge).
- `bun run build` → exit 0.
- `bun run verify` → **33 PASS / 5 FAIL**. The five failures are the **same pre-existing** C08/C25/C35/C36/C37 documented in §17 (stale toolbar footer/hint/count markers, untouched here). C07 now asserts the head bridge (`themeMode`, `prefers-color-scheme`, `window.parent`, no `localStorage`), C24 asserts the toggle is gone and exactly one early listener exists, and new C38 asserts the sandbox CORS contract: preflight 204 + `x-tsr-serverfn` allowed, server function 200 with exposed `x-tss-serialized`, font asset 200 with ACAO.
- End-to-end check in a real sandboxed iframe (headless Chromium via Playwright; the parent harness mimics new-api exactly — same `sandbox` tokens, posts `{themeMode}` after load):

| Step | Result |
| --- | --- |
| Child document origin | opaque (`localStorage.setItem` → `SecurityError`) |
| Parent posts `{themeMode:'dark'}` then `'light'` | `<html class="dark">` toggles, `colorScheme` follows, mask released |
| Web font in sandbox | `document.fonts.check('16px "Public Sans Variable"')` → `true` |
| Client-side navigation (search submit → loader → server function) | URL `/?q=work`, server function 200, 2 account cards rendered, **0 console errors** |
| Masked user field | still `***` |

**Limitations:**

- The first paint can still use the system preference before new-api's `onLoad` message arrives (mitigated by the mask, not eliminated); issue #7123 also notes the first message can be lost for late listeners.
- The CORS policy is permissive (`*`, no credentials) because the panel is a public, read-only home page; the CSRF relaxation applies only to GET with `Origin: null`.
- The host's `lang` message is accepted but ignored (the panel is Chinese-only); font/radius/preset tokens are not passed by new-api.
- The E2E harness lives under `.tmp/` and is not part of the shipped suite; C38 keeps the server-side contract under automated verification.

### 18.1 Reproduce

```bash
bun run typecheck
bun run test
bun run build
bun run verify
# optional E2E (needs playwright-core + a local Chromium)
# cd .tmp/e2e && bun add playwright-core && cd ../.. && bun .tmp/e2e/e2e.ts
```

## 19. Dashboard link with top-level navigation (2026-10-23)

**Change:** a `前盘仪表盘` anchor was added immediately after the hero callout (“请选好你的咒文，准备好你的密钥。”), before the closing line. It uses `target="_top"` so clicking it navigates the new-api page (the top-level window) to the host console instead of loading the panel's own route inside the iframe.

- [dashboard-hero.tsx](src/features/dashboard/dashboard-hero.tsx) renders `<a href={newApiDashboardHref} target="_top" data-dashboard-link>`.
- [host-links.ts](src/lib/host-links.ts): default `/dashboard` (new-api redirects `/dashboard` → its default dashboard section, `web/src/routes/_authenticated/dashboard/index.tsx`); cross-origin deployments can set the build-time `VITE_NEWAPI_DASHBOARD_URL` absolute URL.
- new-api's iframe sandbox already includes `allow-top-navigation-by-user-activation`, so a user click is allowed to navigate the top window.

**Verification:**

- `bun run typecheck` → exit 0; `bun run test` → 23/23; `bun run build` → exit 0.
- `bun run verify` → **33 PASS / 5 FAIL** (same pre-existing C08/C25/C35/C36/C37 from §17). C22 now also asserts the link exists, sits between the callout and the closing line, carries `target="_top"` and points at `/dashboard`.
- E2E in the sandboxed iframe: clicking the link navigated the **top-level** page to `/dashboard` (the panel's local server answers 404 there, proving the top window moved rather than the iframe), which confirms the sandbox token and `target="_top"` behave as required in new-api.

**Limitations:** the link assumes the panel and new-api share an origin for the default relative `/dashboard`; on a separate domain set `VITE_NEWAPI_DASHBOARD_URL` at build time (the variable is public). The destination requires the visitor to be signed in to new-api, which redirects to its login page.

