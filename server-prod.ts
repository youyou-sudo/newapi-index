/**
 * 生产入口：把 Nitro（bun preset）产物编译成单文件可执行程序。
 *
 * 参考：
 *   - TanStack Router examples/react/start-bun/server.ts（Bun.serve + 静态资源）
 *   - galzy/apps/web-tanstack/{build.ts,server-prod.ts}（单文件编译 + 资源内嵌）
 *
 * 这里的做法：
 *   1. scripts/build-binary.mjs 把 .output/public/** 逐文件以
 *      with { type: "file" } 引入（Bun 会把它们嵌进可执行文件），
 *      并生成 .assets.generated.ts；
 *   2. bun build --compile --asset-naming="[dir]/[name].[ext]" 保留目录结构，
 *      资源在二进制内的虚拟路径为 <root>/.output/public/...；
 *   3. Nitro 的静态资源处理器按 __nitro_main__ 的 dirname + ../public 读文件，
 *      所以把 __nitro_main__ 指向 <root>/.output/server/index.mjs，
 *      node:fs 在 Bun 的可执行文件内可以直接读到内嵌文件。
 *
 * 这样镜像里只需要一个二进制，不需要 bun 运行时、node_modules 或 public 目录。
 * 运行镜像（Chainguard glibc-dynamic）没有 shell/curl，所以 --healthcheck 由本程序自己实现。
 */

import { assetCount } from "./.assets.generated"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// ── 健康检查模式 ────────────────────────────────────
// 供 Docker HEALTHCHECK 调用：请求本机首页，成功退出 0，失败退出 1。
// 必须放在 import Nitro 入口之前，否则会重复启动一个监听进程。
if (process.argv.includes("--healthcheck")) {
  const port = Number(process.env.PORT || 3000)
  const url = "http://127.0.0.1:" + port + "/"
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    process.exit(res.ok ? 0 : 1)
  } catch (error) {
    console.error("[healthcheck] " + url + " -> " + (error as Error).message)
    process.exit(1)
  } finally {
    clearTimeout(timer)
  }
}

// ── 内嵌资源路径 ────────────────────────────────────
const rootDir = dirname(fileURLToPath(import.meta.url))
const nitroMain = pathToFileURL(join(rootDir, ".output", "server", "index.mjs")).href

// 在导入 Nitro 入口之前固定 __nitro_main__：入口里的
// globalThis.__nitro_main__ = import.meta.url 会被 setter 吞掉，
// 从而让静态资源解析到可执行文件内的虚拟路径。
Object.defineProperty(globalThis, "__nitro_main__", {
  configurable: true,
  get: () => nitroMain,
  set: () => {},
})

await import("./.output/server/index.mjs")

console.log(
  "[server] compiled binary · embedded assets: " +
    assetCount +
    " · BUILD_ID: " +
    (process.env.BUILD_ID || "dev"),
)
