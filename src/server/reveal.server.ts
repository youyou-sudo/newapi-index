import '@teyik0/furin/server-only'

/**
 * 本机调试时是否把真实身份（账号、provider 名、客户端名）发给浏览器。
 *
 * 为什么要有这个开关：页面默认对身份打码（验收脚本 C09/C10/C19 把“浏览器里
 * 没有任何真实账号”当成硬约束），但本机调试时要和上游页面逐张卡片对账，
 * 打码之后就分不清谁是谁、也看不出顺序对不对。
 *
 * 默认值刻意与“生产”反着来：只有 `NODE_ENV === 'development'`（vite dev）才
 * 打开；生产构建、bun 单文件与验收脚本都打码。`REVEAL_IDENTITIES=1` / `0`
 * 可以显式覆盖，用来在打包产物上复现问题。
 */
export function revealIdentities(): boolean {
  const raw = process.env.REVEAL_IDENTITIES?.trim().toLowerCase()
  if (raw === '1' || raw === 'true' || raw === 'yes') return true
  // 默认一律打码（等字数星号 + 高斯模糊）：页面上只保留模型名与订阅 plan 名。
  // 要本机对账时显式 REVEAL_IDENTITIES=1。
  return false
}
