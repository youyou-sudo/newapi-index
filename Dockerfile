# 生产镜像：furin build --compile embed 产出单文件可执行程序，运行在 Chainguard glibc-dynamic 上。
#
# 构建阶段用 Bun 安装依赖、构建客户端/服务端产物，再把 Bun 服务端 + 内嵌客户端与
# public 资源编译成一个二进制（furin 的 embed 目标）；运行阶段只有
# cgr.dev/chainguard/glibc-dynamic + 二进制，没有 Bun 运行时、没有 shell、没有 node_modules。
#
# 运行期密钥（BALANCE_API_KEY 等）绝不写入镜像，只通过部署平台注入。
# 构建期公开变量只有 FURIN_PUBLIC_NEWAPI_DASHBOARD_URL（会进入浏览器 bundle）。

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
ARG FURIN_PUBLIC_NEWAPI_DASHBOARD_URL=
ENV FURIN_PUBLIC_NEWAPI_DASHBOARD_URL=${FURIN_PUBLIC_NEWAPI_DASHBOARD_URL}
ENV BUILD_ID=${BUILD_ID}

# furin build + tsc --noEmit：类型错误会让镜像构建失败。
RUN bun run build

# 单文件编译：.furin/build/bun/server（客户端与 public 资源内嵌）。
RUN bun run build:binary

# ---------- 运行阶段 ----------
# Chainguard glibc-dynamic（Wolfi）：动态链接版本的 glibc + libgcc/libstdc++ +
# ca-certificates，没有 shell；镜像默认以非 root（65532/nonroot）运行。
FROM cgr.dev/chainguard/glibc-dynamic:latest

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

ARG BUILD_ID=dev
ENV BUILD_ID=${BUILD_ID}

# Chainguard 镜像里的 nonroot 账户是 65532:65532；直接用数字，避免依赖 /etc/passwd。
COPY --from=build --chown=65532:65532 /app/.furin/build/bun/server /app/server

# 非 root 运行（镜像默认用户也是 65532）。
USER 65532:65532

EXPOSE 3000

# 运行镜像里没有 curl/wget：二进制自带 --healthcheck 模式（请求 /_furin/health/ready）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/app/server", "--healthcheck"]

ENTRYPOINT ["/app/server"]
