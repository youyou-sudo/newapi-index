import { defineConfig } from "@teyik0/furin/config";
import tailwind from "bun-plugin-tailwind";

/**
 * 生产构建配置（`furin build`）。
 *
 * - pagesDir / serverEntry 与 src/server.ts 里 furin() 的挂载保持一致；
 * - Tailwind 只需要参与生产 bundle，开发期由 bunfig.toml 的 [serve.static] 负责；
 * - 目标固定为 Bun 服务端包（Docker 里再用 --compile embed 产单文件）。
 */
export default defineConfig({
  rootDir: ".",
  pagesDir: "src/pages",
  serverEntry: "src/server.ts",
  plugins: [{ ...tailwind, buildOnly: true }],
  targets: ["bun"],
});
