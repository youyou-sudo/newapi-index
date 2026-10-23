# 生产镜像：Nitro（bun preset）产物编译成单文件可执行程序，运行在 distroless/base 上。
#
# 参考 galzy/apps/web-tanstack/Dockerfile 与 TanStack Router examples/react/start-bun：
#   构建阶段用 Bun 安装依赖并构建，再用 bun build --compile 产出单个二进制
#   （.output/public 全部内嵌）；运行阶段只有 gcr.io/distroless/base + 二进制，
#   没有 Bun 运行时、没有 shell、没有 node_modules。
#
# 运行期密钥（BALANCE_API_KEY 等）绝不写入镜像，只通过部署平台注入。
# 构建期公开变量只有 VITE_NEWAPI_DASHBOARD_URL（会进入浏览器 bundle）。

ARG BUILD_ID=dev

# ---------- 构建阶段 ----------
FROM oven/bun:1.4.4-slim AS build

WORKDIR /app

# 先只拷贝依赖清单，让 bun install 层只在依赖变化时才失效。
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# BUILD_ID 在 FROM 之前声明后不会自动进入本阶段作用域，需要重复声明。
ARG BUILD_ID
ARG VITE_NEWAPI_DASHBOARD_URL=
ENV VITE_NEWAPI_DASHBOARD_URL=${VITE_NEWAPI_DASHBOARD_URL}
ENV BUILD_ID=${BUILD_ID}

# vite build + tsc --noEmit：类型错误会让镜像构建失败。
RUN bun run build

# 单文件编译：生成 .assets.generated.ts 并内嵌 .output/public，产出 .output/server-bin。
RUN bun run build:binary

# ---------- 运行阶段 ----------
# distroless/base：仅有 glibc、ca-certificates、tzdata 等运行时依赖，没有 shell。
FROM gcr.io/distroless/base

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

ARG BUILD_ID=dev
ENV BUILD_ID=${BUILD_ID}

COPY --from=build --chown=nonroot:nonroot /app/.output/server-bin /app/server

# 非 root 运行。
USER nonroot:nonroot

EXPOSE 3000

# distroless 里没有 curl/wget：二进制自带 --healthcheck 模式（请求本机首页）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/app/server", "--healthcheck"]

ENTRYPOINT ["/app/server"]
