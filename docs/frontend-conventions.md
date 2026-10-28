# 前端约定（balance-panel / newapi-index）

面向「新页面 / 新功能」的落地指南。所有结论都从仓库现状摘录，文件路径对应当前工作区。
新页面必须与这里的机制**同构**，不要引入第二套数据/样式/动效体系。

## 1. 硬事实（package.json、配置文件）

| 项 | 值 | 依据 |
| --- | --- | --- |
| 包管理器 / 运行时 | Bun 1.4.4（`engines.bun >=1.4.0`） | package.json、bun.lock |
| 框架 | @teyik0/furin 0.8.0-alpha.0（文件式路由 + SSG/ISR/SSR + Bun 构建） | package.json、furin.config.ts |
| HTTP 服务 | elysia 2.0.0-beta.32 | package.json、src/server.ts |
| UI | react / react-dom 19.3.1（**真实运行时**，没有替换层） | package.json |
| 样式 | Tailwind **v4.3**，CSS-first，无 `tailwind.config.*`；开发期插件在 bunfig.toml，生产插件在 furin.config.ts | package.json、bunfig.toml、furin.config.ts |
| 类型 | TypeScript 7，`strict`、`noUncheckedIndexedAccess`、`noEmit` | tsconfig.json |
| 测试 | Vitest 5，`environment: 'node'` | vitest.config.ts |
| 路径别名 | `~/*` → `src/*`（tsconfig 的 `paths` 与 vitest 的 `resolve.alias` 双处声明） | tsconfig.json、vitest.config.ts |
| 框架类型 | `furin-env.d.ts` 由 `bun run typegen`（`furin typegen`）生成 | furin-env.d.ts |

### daisyUI：**不存在**

- `package.json` 的 dependencies/devDependencies 两个列表里都没有 `daisyui`，也没有 `@plugin "daisyui"` 之类的 Tailwind 插件声明。
- `src/styles/app.css` 只有一行入口 `@import 'tailwindcss' source('../')`，没有 `@plugin`、没有 daisyui 主题块。
- 仓库里也没有 `components.json`、`tailwind.config.*`、`postcss.config.*`。
- 结论：**不要用 `btn` / `card` / `badge` 这类 daisyUI 类名**，全部走 `src/components/ui` 原语 + token 工具类。任何“UI 库必须用 daisyUI”的通用建议在本仓库都不成立。

## 2. 路由：`src/pages` 文件式 + 类型化路由定义

路由文件在 `src/pages`，当前是：

| 文件 | 作用 | 导出 |
| --- | --- | --- |
| `root.tsx` | 文档外壳：`defineRootRoute()` + `.config({ mode: 'ssg' })` + `.layout()` | `export const route` |
| `index.tsx` | 首页：`defineRoute('/')` + `mode: 'isr', revalidate: 60` | `export const route` |
| `error.tsx` | 错误边界：`ErrorProps` → `DefaultCatchBoundary` | `export default function` |
| `not-found.tsx` | 404 边界：`NotFoundProps` → `NotFound` | `export default function` |

新增页面 = 在 `src/pages` 新增一个文件（例如 `src/pages/routing.tsx`），照这个骨架写：

```tsx
// src/pages/index.tsx（节选，照这个骨架写）
import { defineRoute } from '@teyik0/furin'
import { t } from 'elysia'
import { DashboardPage } from '~/features/dashboard/dashboard-page'
import { parseDashboardSearch } from '~/lib/balance/search'
import { loadBalanceSnapshot } from '~/server/balance.server'

export const route = defineRoute('/')
  .config({
    // 只有 isr（+ revalidate）拿得到 CDN 缓存头；ssr 恒为 no-store，ssg 适合无数据的静态页
    mode: 'isr',
    revalidate: 60,
    // 路由层 schema 只做“是不是字符串”的把关，长度/枚举/回落统一交给 parseDashboardSearch()
    query: t.Object({
      q: t.Optional(t.String()),
      status: t.Optional(t.String()),
      sort: t.Optional(t.String()),
      view: t.Optional(t.String()),
    }),
  })
  .loader(async ({ query }) => {
    const search = parseDashboardSearch({ ...query })
    const snapshot = await loadBalanceSnapshot() // 只在服务端 import 得动（见 §3）
    return { dashboard: buildDashboard(snapshot, { q: search.q }, Date.now()) }
  })
  .head(({ dashboard }) => ({ meta: [{ title: `余额面板 · ${dashboard.summary.accountCount} 个账户` }] }))
  .page(({ dashboard, query }) => (
    <DashboardPage dashboard={dashboard} search={parseDashboardSearch({ ...query })} />
  ))
```

- **只有 `.page()` 里的组件会进浏览器包**：`.loader()` / `.head()` / `.config()` 在构建时被剥离，页面组件本身才是客户端代码。
- 根文档、主题脚本、`AppLayout`、全局错误/404 统一在 `root.tsx`；新页面**不要**再写 `<html>` / `<head>` / `<Scripts />`，页面 `.head()` 只改 head 元信息。
- 页面组合方式（dashboard 就是模板）：页面文件只管 loader/head/守卫 → `features/<name>/<name>-page.tsx` 只管布局与交互 → 再拆小组件。
- **渲染模式怎么选**：要 CDN 缓存（公开数据）用 `isr` + 一个有意义的 `revalidate`；要严格实时、不介意 `no-store` 用 `ssr`；没有任何数据的纯外壳用 `ssg`。
- **不要手改 `furin-env.d.ts`**：它由 `bun run typegen` 生成（需要先有 `src/pages`）。
- 没有 `/api/*` 路由，也不允许新增：verify 断言 `/api/foo` 必须 404，客户端产物里也不能出现 `/api/`。浏览器需要的增量接口放在根路径下（现有唯一样例是 `/feed/routing`）。

## 3. 服务端数据：**route loader + server-only 模块**（没有 server function）

这是本仓库唯一的数据通路，写页面时照抄：

```ts
// 1) 页面 loader 直接 import 服务端模块
import { loadBalanceSnapshot } from '~/server/balance.server'

// 2) 服务端模块顶部一行标记就是硬边界
// src/server/balance.server.ts
import '@teyik0/furin/server-only'
```

- **server-only 是硬边界**：`src/server/**` 只能被页面的 loader/head/config 引用；构建期 `strip-plugin` 会把这些阶段从浏览器包剥离，所以它们进不了客户端。客户端组件（`.page()` 里的 React 组件）**不能** import `src/server/**`。
- 缓存与降级套路（新页面照搬 `balance.server.ts`）：模块级 `cache` + `inflight` 单飞，TTL 从 `process.env` 读（默认 30 s），过期先返回旧数据并后台刷新（SWR），失败**永不 reject**：先用旧缓存、再退到内置 fixture，并把原因写进 `source.warning`。
- **归一化只有一处**：URL 参数先过 Elysia `t.Object`（只校验类型），再交给 `parseDashboardSearch()` 决定默认值与非法值回落；浏览器、服务端、测试共用同一个函数。zod 只出现在服务端 schema（`src/lib/balance/schema.ts`，校验上游响应），**不要**把 zod 带进浏览器。
- **客户端唯一的 `fetch`** 是 `src/features/routing/use-routing-stream.ts` 里的 `/feed/routing?after=<seq>`（增量轮询：单飞、页面隐藏时暂停、失败指数退避、服务端 `seq` 回退时清空重来）。其它地方禁止 `fetch` / `axios` / `useSWR`；verify 会扫源码。
- **URL 导航统一走 `useNavigate()`（`@teyik0/furin/link`）**：`navigate({ to, search, replace: true, resetScroll: false })`。默认值不写进 URL（`toSearch()` 只输出非默认字段），不新增历史记录，也不把页面滚回顶部。
- **时间/倒计时**：首帧必须用服务端算好的值（`useLiveCountdown` / 轨迹舞台的 `clockOffset`），`useEffect` 里才锚定本地时钟；不要在 render 里读 `Date.now()`。

## 4. 样式：Tailwind v4 token + shadcn 风格原语

`src/styles/app.css` 的结构固定为：`@import 'tailwindcss' source('../')` → `@custom-variant dark (&:is(.dark *))` → `@theme inline`（`--color-*` 指向 `var(--*)`）→ `:root` / `.dark` 两套 oklch 变量 → `@layer base` → `@layer utilities`。

- 语义色工具类：`bg-background`、`text-foreground`、`bg-card`、`text-muted-foreground`、`bg-primary`、`border-border`、`ring-ring`、`text-success/warning/destructive/info`、`bg-accent`。
- 半径只有一套：`--radius: 1rem`，派生 `rounded-md/lg/xl/2xl` 等。
- 字体：`font-sans` = 系统 `sans-serif`（与 new-api 的 `--font-ui-sans` 同值）；`font-serif` 只用于 hero 那句标题与引导句，是 new-api 的 serif 链逐字拷贝。**不要引入 web font**（产物里出现 `.woff2` 会被验收脚本判失败）。
- 明暗主题**由宿主驱动**，不是站点开关：`root.tsx` 的 `<head>` 内联脚本按 `?theme=` 或 `prefers-color-scheme` 给 `<html>` 打 `.dark`，并同步监听父窗口 `postMessage({ themeMode })`（`src/lib/theme.ts` 的 `hostThemeInitScript`）。组件里只用 `dark:` 变体，不要读写 `localStorage`（sandbox iframe 里会抛 SecurityError；verify 断言 head 里不出现 `localStorage`）。
- 合并类名统一 `cn()`（`src/lib/utils.ts`，clsx + tailwind-merge）；变体用 `cva`（`button.tsx`、`badge.tsx`）。
- **样式只有一份产物**：所有新样式写进 `app.css`，构建后是外部资产 `/_client/_hydrate-*.css`（带内容哈希、一年 immutable）。不要新增第二个全局 CSS 文件，也不要写 `<style>` 内联（furin 不提供构建期内联，verify 断言文档里没有 `<style`）。
- 原语清单（`src/components/ui`，都是本地实现、带 `data-slot`）：

| 组件 | 导出 / props |
| --- | --- |
| button.tsx | `Button`（`ComponentProps<'button'> & { variant: default\|outline\|secondary\|ghost\|destructive; size: default\|sm\|lg\|icon }`）、`buttonVariants`（给 `<a>`/`<Link>` 用） |
| card.tsx | `Card` / `CardHeader` / `CardContent`（都是 `ComponentProps<'div'>`） |
| badge.tsx | `Badge`（`<span>`；variant: default\|secondary\|destructive\|warning\|success\|outline\|ghost） |
| input.tsx | `Input`（`ComponentProps<'input'>`，h-8） |
| progress.tsx | `Progress`（`{ value: number \| null; label?: string; className?: string }`，自带 role=progressbar） |
| skeleton.tsx | `Skeleton`（`<div>` + `.skeleton-shimmer`） |
| empty-state.tsx | `EmptyState`（`{ title; description; action?: ReactNode; className? }`） |
| select.tsx | Radix 组合件：`Select/SelectTrigger/SelectValue/SelectContent/SelectItem`（**只允许按需加载**，见 `sort-select.tsx` 的动态 import） |

- 数字用 `.tabular`（`font-variant-numeric`），骨架屏用 `.skeleton-shimmer`；图标一律 lucide-react，装饰性图标加 `aria-hidden="true"`，尺寸写 `size-3.5` / `size-4`。

## 5. 动效约定（现有全部范式，动画功能必须落在这里）

所有关键帧都在 `app.css` 的 `@layer utilities`，**没有动画库**（无 framer-motion 之类依赖），新动画也加在这里：

```css
/* 标题/文案进场：620ms，错峰靠内联 animation-delay */
.rise-in { animation: rise-in 620ms cubic-bezier(0.22, 1, 0.36, 1) both; }

/* 列表逐个淡入：360ms，nth-child 每项 +40ms */
.list-stagger > * { animation: list-enter 360ms cubic-bezier(0.22, 1, 0.36, 1) backwards; }

/* 面板开合：开 150ms，关 110ms */
.select-content[data-state='open'] { animation: select-content-in 150ms cubic-bezier(0.22, 1, 0.36, 1); }
.select-content[data-state='closed'] { animation: select-content-out 110ms ease-in; }

/* 全局唯一的降级开关 */
@media (prefers-reduced-motion: reduce) {
  .rise-in, .list-stagger > *, .select-content[data-state='open'], .select-content[data-state='closed'] { animation: none; }
}
```

规则（都是从上面代码和注释里提炼的，**不要破例**）：

1. **时长/缓动只有三个值**：620 ms、360 ms、150/110 ms；缓动 `cubic-bezier(0.22, 1, 0.36, 1)`（出场用 `ease-in`）。新动画优先复用这些数值。
2. **SSR 输出必须是静止的**：首屏 HTML 里不能出现“正在播放”的动画。`.rise-in` 只用确定性的内联 `animation-delay`（`dashboard-hero.tsx` 的 `RISE_START_MS` / `RISE_STEP_MS`），SSR 与 hydration 才会一致；依赖交互状态的类（`.list-stagger`）必须在 hydration 之后才加（`dashboard-page.tsx` 的 `hydrated` / `reveal` 门闩）。
3. **只动 `opacity` / `transform`**，用 `translate3d`；尺寸变化走 `transition-[width]`（`progress.tsx`）。状态色用 `transition-colors`、卡片用 `transition-shadow`、整体淡出用 `transition-opacity duration-200` + `opacity-60`。
4. **必须写进 `prefers-reduced-motion` 白名单**（上面那个块）。做“路径飞行”时，降级态要保留最终位置/最终颜色，只去掉位移与透明度补间。
5. **数据驱动的动画不能在 render 里读时钟**：首帧用服务端算好的值（照抄 `useLiveCountdown`：首渲染返回 `initialSeconds`，`useEffect` 里才锚定本地时钟并 `setInterval(1000)`）；轨迹舞台用 `useRoutingStream()` 返回的 `clockOffset` 把本机时钟换算成服务端时钟，不要直接把 `Date.now()` 喂给时间轴。
6. **重放靠重挂载，不靠残留动画**：`.list-stagger` 用 `backwards`（不是 `forwards`）避免动画残留在 `getAnimations()` 里，并用一个由 `sort`/`status`/`view` 拼出来的 `key` 强制重挂载来重播。
7. **不要假设有“列表加载中”中间态**：筛选/排序/视图切换走的是 furin 路由导航（一次该 URL 的路由数据请求），页面没有列表骨架或「正在更新」提示；`role="status"` 容器保留但为空。新动画不要围绕某个 `loading` 布尔量设计。
8. 无障碍：加载/暂态用 `role="status" aria-live="polite"`，列表忙碌用 `aria-busy`，装饰图形 `aria-hidden="true"`；键盘可达性由原语保证（不要自己写 div 当按钮）。

## 6. 测试约定

- 位置：与实现同目录的 `__tests__/*.test.ts`（例如 `src/lib/balance/__tests__/derive.test.ts`、`src/lib/routing/__tests__/timeline.test.ts`、`src/features/routing/__tests__/motion.test.ts`）。`include` 只匹配 `src/**/*.test.ts`（**不匹配 .tsx**），`environment: 'node'` → **不写组件/DOM 测试**，只测纯函数与纯逻辑。
- 当前规模：**8 个文件 / 94 个用例**。验收脚本要求用例数 **≥ 94 且只增不减**，删测试会让 `bun run verify` 直接失败。
- 命名：`describe('parseDashboardSearch')` + `it('applies defaults for an empty search object')`（英文）；断言用 `toEqual` / `toBe`，时间基准用常量（例如 `const NOW = Date.parse('2026-10-23T04:00:00Z')`）。
- 每个新纯函数模块至少一个测试文件；动画的几何/时间轴计算必须可测（纯函数抽到 `geometry.ts` / `timeline.ts`，已落地）。

```ts
// src/lib/balance/__tests__/search.test.ts
describe('parseDashboardSearch', () => {
  it('applies defaults for an empty search object', () => {
    expect(parseDashboardSearch({})).toEqual(defaults)
  })
})
```

## 7. 验证：命令序列与 verify.mjs 的硬性约束

```bash
bun run typecheck   # tsc --noEmit
bun run test        # vitest run（8 文件 / 94 用例）
bun run build       # furin build --target bun && tsc --noEmit → .furin/build/bun/
bun run verify      # bun scripts/verify.mjs
```

必须先 `build`：verify 找不到 `.furin/build/bun/server.js` 会直接以 1 退出。**CI 已把 `bun run verify` 作为门禁**（`quality` 任务在 build 之后执行），所以本地这四步就是流水线的等价复现。verify 会：

1. 用 Bun 起 `.furin/build/bun/server.js` 在 **127.0.0.1:3210**（fixture 模式 + sentinel key），另用 3211（隔离 `.env` 探针）/ 3212（mock 上游）/ 3213（缺 Key）做探针；**3210/3211 被占用就直接拒绝运行**（不杀未知进程）。跑 verify 前先关掉占用的本地服务。
2. 自己再跑一次 `bun run test`，要求 **≥ 94 个用例通过**（8 个文件）——新增测试只会更多，不会更少。
3. 在多个层面扫 **禁用词与泄漏**，新增文件也在扫描范围内：
   - 源码/构建产物/README/package.json 里不得出现上游旧品牌词（品牌词在 verify 里用 charCode 拼出来，源码里也别写）。
   - 客户端 bundle 里不得出现 `/api/`、`/settings`、`BALANCE_API_URL`、`BALANCE_API_KEY`、原始账号标识。**新页面任何客户端字符串都别含 `/api/`**（上游路径只能待在 `src/server/` 下）。
   - 源码/文档里也不要把 cookie 名/主机名里的品牌词写成字面量，需要时通过 `process.env` 注入。
4. 对产物与响应头有 furin 专属断言：`.furin/build/manifest.json` 可解析且 `targets.bun.buildId` 与响应头 `x-furin-build-id` 一致；`/_client/*` 的 CSS/JS 能取到；ISR 页面带 `ETag` + `Content-Length` 与 `s-maxage/stale-while-revalidate=60`（后台再生成那一次 `s-maxage` 会是 0，断言不会写死 60）；`/_furin/health/live|ready` 均 200；页面框架数据是 `<script id="__FURIN_DATA__">` 里的普通 JSON（可直接 `JSON.parse` 查 query/accounts）。
5. 对 `/` 的 HTML 有硬断言：唯一一个 `<h1>`、section 顺序 hero < 搜索表单 < 账户卡 < 用量概览、**不允许出现 `<nav>` / `sticky top-0` / 主题开关**。→ 新页面不要往 `AppLayout` 里加导航栏；给首页加入口时用普通链接放在 section 内。
6. `/providers/*`、`/settings`、`/api/*` 必须 404 —— 新页面选路径时避开这些前缀。
7. 文档里必须没有内联样式（`<style` 计数为 0）、没有 web font 文件（`.woff2?/.ttf/.otf` 为 0）、CSS 以 `/_client/*.css` 外链形式出现。→ 新样式必须写进 `app.css`。
8. 验证期间 **`.env` 必须逐字节不变**；`.env.example` 的 `BALANCE_API_URL` / `BALANCE_API_KEY` 必须仍为空值。
9. CORS：`OPTIONS` 预检 204 + `Access-Control-Allow-Origin: *`；带 `Origin` 的文档、`/_client/*` 资源与 `/feed/routing` 都带 ACAO，并暴露 `x-furin-build-id`。→ 新的浏览器可访问接口必须经过 `src/server.ts` 的 `onRequest`（不要在路由内部自己发 CORS 头）。

手动检查：`bun run dev`（3000 端口），嵌入场景加 `?theme=dark` 固定主题。

完整矩阵与逐项证据见 [../VERIFICATION.md](../VERIFICATION.md)。

## 8. 语言与注释约定（实际是“混合”，按位置分）

仓库不是全中文，也不是全英文，按位置分工：

- **UI 文案、标签、错误提示：中文**（`labels.ts`、`not-found.tsx`、`dashboard-page.tsx`）。
- **解释“为什么/背景/契约”的注释：中文**，且写成长段 `/* */`（`app.css`、`theme.ts`、`src/server.ts`、`routing.server.ts`、`sort-select.tsx`）。
- **导出的纯函数：一行英文 JSDoc** 说明契约（`derive.ts`、`search.ts`、`auth.ts`）；**测试描述用英文** `it('...')`。
- 配置文件也遵守同样的“为什么”风格：`furin.config.ts`、`bunfig.toml`、`Dockerfile` 顶部都有一段中文说明。
- 只写“为什么”，不写逐行翻译；性能/SSR/ISR/hydration/iframe/缓存这类取舍必须写清。新增文件跟随所在目录（`src/server/` 中文、`lib/*/derive.ts` 英文单行、CSS 中文块注释）。

## 9. 推荐文件布局（以路由轨迹为例，已落地）

路由轨迹不是独立页面，而是首页里的一个 section（数据由首页 loader 的种子 + 浏览器轮询提供）。新增同类功能时按这个结构放文件：

```text
src/lib/routing/
  types.ts          上游 trace 形状 + 页面视图模型（不含运行时依赖）
  schema.ts         zod 校验上游响应；只允许 server 引用
  derive.ts         snapshot -> RoutingView（纯函数：排序、去重、座位/智能体编号）
  geometry.ts       纯几何：节点坐标、路径弧线、弧长插值（可单测）
  timeline.ts       纯时间轴：把 TripView + 现在时刻映射成“第几段、进度 0-1”
  __tests__/        derive / geometry / timeline
src/server/
  routing.server.ts 仅服务端：登录上游 web（cookie）+ TTL/单飞 + 降级 + 打码
src/api/
  routing.ts        Elysia 子应用：GET /feed/routing?after=N（避开 /api 前缀）
src/features/routing/
  routing-section.tsx 页面骨架：标题区 / 舞台 / 图例 / 空态（复用 Card、Badge、EmptyState、Skeleton）
  routing-stage.tsx   舞台容器：SVG 连线 + 节点；只负责动画编排
  stage-nodes.tsx     agent / seat / trip 三类节点（带 data-* 标记）
  motion.ts           动效常量与判定（可单测）
  wiring.ts           纯配置拼装（可单测）
  labels.ts           RoutingSourceMode -> 中文文案
  use-routing-stream.ts  浏览器轮询 /feed/routing 的唯一入口
src/styles/app.css     @layer utilities 追加 keyframes（+ reduced-motion 白名单）
```

**新增一个页面时的最小改动集**

1. `src/pages/<name>.tsx`：`defineRoute('/<path>')` + `.config({ mode, revalidate?, query })` + `.loader()` + `.head()` + `.page()`。
2. `src/server/<name>.server.ts`：取数 + 缓存 + 降级（顶部 `import '@teyik0/furin/server-only'`）。
3. `src/features/<name>/<name>-page.tsx`：页面骨架与交互，只依赖 `.page()` 收到的 props。
4. `src/lib/<name>/*`：纯逻辑与类型（能单测的都放这里）。
5. `src/styles/app.css`：只追加 `@layer utilities` 的 keyframes 与 reduced-motion 条目。
6. 需要浏览器轮询时再加 `src/api/<name>.ts`（路径避开 `/api`，并自己写 `cache-control: no-store`）。

**不要做**：不要改 `package.json` 的依赖与 scripts（verify 会核对 bun 版本、包名、脚本）；不要手改 `furin-env.d.ts`；不要新增 `/api` 路由；不要在客户端出现 `/api/` 或品牌词；不要给 `AppLayout` 加 `<nav>`；不要引入第二个数据/样式/动效体系。
