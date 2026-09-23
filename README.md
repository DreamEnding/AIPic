# AI 专业修图台

面向专业修图师、设计师、电商视觉和摄影后期的 AI Native 修图工作台。项目基于 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 二次开发，保留图像生成、图生图、遮罩编辑、多 API 配置和历史管理能力，并重构为更适合专业修图工作流的中文界面。

这是可自行部署的开源、无广告版本。应用不提供 API Key，请在设置中配置自己的 OpenAI 或兼容服务。

后端与同源代理现在默认要求应用访问认证及服务端 provider allowlist。升级前请阅读 [安全部署、环境变量与兼容说明](docs/security.md)：Node 需配置 `AIPIC_ACCESS_TOKEN`，Pages 还需部署全局限流 Durable Object；浏览器访问通过已认证反向代理注入访问凭据。

在线使用：[image.simplaj.top](https://image.simplaj.top/)（Cloudflare Pages）；自行部署：[下载 Docker 发布包](https://github.com/DreamEnding/AIPic/releases/tag/v0.4.11)。

## 当前版本重点

- 原生风格工作台：系统字体、浅色 / 深色主题、中性照片画布与蓝色强调；移除全局顶栏，设置位于右上角，AI Native 工具置顶并标记 NEW。
- 自适应布局：桌面展示工具、画布、参数及历史；窄屏分区排列，支持触控、键盘焦点和减少动态效果偏好。
- 文生图 / 图生图：右侧支持模式切换；文生图提交时不会携带参考图或 mask，图生图保留参考图修图链路。
- 专业预设：人像、丰体、瘦身、背景修复、皮肤美化、全局美化、人像调色、衣物、裁剪、AI Native 等分类。
- 纸刊海报：新增「实景纸刊」「抽象映像」「极简留白」，入口为 **AI Native → 纸刊海报**；上传照片并选择一种版式，可叠加常规修图。来源记录见 [预设说明](docs/preset-sources.md)。
- 多选叠加：预设小功能支持多选叠加，并自动映射为结构化中文 prompt。
- 强度和对象：支持轻微、标准、明显、强烈，以及自动、女性、男性、儿童、产品/物体等对象设置。
- 局部修图：支持涂抹指定区域生成 mask，作为局部重绘参考。
- 对比和缩放：支持前后对比线、完整显示、无级缩放和大图查看。
- 修图历史：任务提交后自动记录历史，支持回看输出和任务状态。
- 输出控制：支持 1 张 / 4 版、1K / 2K / 4K、快速 / 标准 / 精修、PNG / WebP / JPEG。点击「设置尺寸」可选择横竖比例、自定义比例或输入宽高像素；当前尺寸会显示在按钮上，切换预览不会覆盖已选尺寸。
- 后台生图任务：直接移植 FlyReq Image Studio 的 Node.js / SQLite 后端，GPT/Grok Images 请求先返回任务 ID，前端轮询结果，模型请求在服务器继续执行。
- API 代理：保留 `/api-proxy/` 供 Responses 和其他同步接口使用；普通 Images 任务走 `/api/flyreq/`。
- 开源无广告：移除推广入口、购买引导和第三方中转站默认配置。

## 快速开始

推荐 Node.js **24 LTS**（后端最低需要 22.19.0）。在项目目录执行：

```bash
npm install
npm run backend:install
npm run build:backend
npm start
```

访问 `http://127.0.0.1:8788/`，在页面 API 设置填写上游地址、API Key 和模型。`npm start` 启动移植后的 FlyReq 后端并提供 `dist` 静态页面，默认只监听本机地址。

本地热更新开发使用两个终端：

```bash
# 终端一：后台任务服务
npm start

# 终端二：前端，自动将 /api/flyreq 转发到本机 8788
npm run dev:backend
```

开发页面为 `http://127.0.0.1:5173/`。`npm run build:backend` 在构建时设置 `VITE_TASK_BACKEND=flyreq`，启用异步 Images 通道；普通 `npm run build` 保留原有静态 / Pages 部署通道。

## 图像生成参数

工作台右侧保留质量（自动 / 快速 / 标准 / 精修）、格式、尺寸和张数快捷选项。完整输出张数、内容审核、压缩质量和背景选项位于「设置 → API 配置 → 高级参数 → 生成参数」，配置随浏览器保存。

| 选项 | 可选值 | 说明 |
| --- | --- | --- |
| 输出张数 | 1–10 | 实际上限以所用服务商为准 |
| 内容审核 | `auto` / `low` | `low` 表示较低审核强度，不代表关闭审核 |
| 压缩质量 | 留空，或 0–100 的整数 | 留空使用服务商默认；仅 JPEG / WebP 支持；数值越高画质越高 |
| 背景 | 服务商默认 / `auto` / `opaque` / `transparent` | 默认不新增请求参数；透明背景需要 PNG / WebP 和支持该参数的模型 |

选择 JPEG 时，透明背景会切换为不透明；导入的透明 JPEG 配置在提交前会规整为 PNG。自定义 HTTP 服务商通过请求模板映射参数，例如 `$params.moderation`、`$params.output_compression` 和 `$params.background`。

在设置的 API 配置中选择服务商、URL、密钥、模型和 Images / Responses 模式；展开「高级参数」可设置生成参数，以及服务端转发、流式传输、中间图数量（0–3）、Base64 返回、Codex 兼容模式和超时（10–3600 秒）。高级参数默认展开；不改变原有参数默认值。Codex 兼容模式使用自动质量。

## API 配置

应用默认使用 OpenAI 兼容接口，默认 API 地址为：

```text
https://www.chream.me
```

用户可以在页面右上角的 API 设置中修改：

- API Key
- 模型 ID
- API 模式
- 是否启用服务端转发：支持代理的部署中，新建 OpenAI 兼容配置默认开启，也可手动关闭。已有配置沿用保存的选择。
- 输出尺寸、质量、格式等参数

前端调用地址固定为 `https://www.chream.me`，页面不能修改。Images API 推荐及默认模型 ID 为 `gpt-image-2.5`。

### Cloudflare Pages API 代理

当前仓库包含 Pages Function：

```text
functions/api-proxy/[[path]].ts
```

代理规则：

- 前端请求 `/api-proxy/images/generations` 等路径。
- Pages Function 默认转发到 `https://www.chream.me`。
- 兼容旧客户端的 `x-aipic-upstream` 请求头只接受服务端允许的 HTTPS 上游。
- 代理返回 CORS 头，方便浏览器直接调用。
- GPT/Grok 图片生成、编辑和 Responses 请求使用保活传输：立即响应，每 15 秒发送一次心跳，并分块转发上游状态及正文。Grok 可以保持非流式生图，前端自动解包保活传输。
- 内部请求头 `x-aipic-proxy-stream` 和 `x-aipic-timeout-seconds` 只供代理使用，不会转发给模型服务。其他请求仍使用普通代理协议。

注意：代理只负责转发请求，不保存 API Key，不记录图片数据。

### GPT / Grok 后台任务与 4K

`backend/` 直接移植自 [doudou770/flyreq-image-studio](https://github.com/doudou770/flyreq-image-studio) 的后端源码，保留其队列、SQLite 任务状态、图片落盘、OpenAI 流式结果处理及任务查询接口。来源版本及修改说明见 `backend/README.md`，对应许可证见 `backend/LICENSE`。

Node / Docker 版本的请求流程：

1. 前端向 `/api/flyreq/tasks` 提交图片参数和 API 配置，服务器返回 **202 + taskId**。
2. 服务器从后台队列发起上游生图请求，等待预算为 **30 分钟**。
3. 前端通过 `/api/flyreq/tasks/:taskId` 查询进度，完成后从同源 `/api/flyreq/images/...` 取回图片并保存到本地历史。

这使模型执行时间不再受单个浏览器生图连接的时长影响。提交成功后，关闭页面不会取消服务器里的任务；但正在处理的任务仍依赖后端进程持续运行，重启进程不能恢复已经发出的上游请求。默认结果保留 12 小时，客户端确认收到结果后会缩短到 2 分钟，再按清理周期回收。

上游中转站自身返回 524、拒绝请求或不支持所选 4K 尺寸时，后台任务会保留实际错误。队列不能解除上游服务自己的限制。任务失败不会自动重复提交生图 POST。

Cloudflare Pages 单独部署无法运行此 Node.js / SQLite 后台队列。需要使用本地 Node、服务器或下方的 Docker Compose 部署；原 Pages 保活代理仍保留给同步通道使用。

## Docker 部署

版本 `0.4.11` 使用**单个镜像、单个容器**：Node.js 24 同时提供前端页面、`/api/flyreq/` 后台任务、WebSocket 和 `/api-proxy/` 同源代理。容器内端口为 `8788`，默认映射到宿主机 `8080`；不再需要单独部署 Nginx 或后端容器。

镜像以普通用户 `node`（UID/GID `1000:1000`）运行。SQLite、生成图片、视频和日志统一写入 `/data`，请始终挂载持久卷。页面历史仍保存在当前浏览器中，服务器结果有独立的自动清理周期。

### 方式一：下载 Release 镜像包（推荐）

打开 [GitHub Release v0.4.11](https://github.com/DreamEnding/AIPic/releases/tag/v0.4.11)，下载以下文件。部署机器只需要 Docker Engine 和 Docker Compose，无需安装 Node.js 或克隆源码。

| 文件 | 用途 |
| --- | --- |
| `aipic-0.4.11-linux-amd64.tar.gz` | x86-64 / Intel / AMD 服务器镜像 |
| `aipic-0.4.11-linux-arm64.tar.gz` | ARM64 / Apple Silicon / ARM 服务器镜像 |
| `docker-compose.yml` | 直接加载发布镜像的部署配置 |
| `SHA256SUMS` | 发布附件的 SHA-256 校验值 |
| `release.json` | 版本、源码提交、镜像架构及 registry digest |
| `aipic-0.4.11-source.tar.gz` | 与本次发布提交一致的完整项目源码 |

两个镜像包选择一个即可，加载后均使用标签 `aipic:0.4.11`。`uname -m` 显示 `x86_64` 时选择 amd64；显示 `aarch64` 或 `arm64` 时选择 arm64。

例如在 Linux x86-64 服务器首次安装：

```bash
mkdir -p aipic-deploy
cd aipic-deploy

# ARM64 机器把 amd64 改为 arm64。
AIPIC_ARCH=amd64
AIPIC_RELEASE_URL=https://github.com/DreamEnding/AIPic/releases/download/v0.4.11
for file in "aipic-0.4.11-linux-${AIPIC_ARCH}.tar.gz" docker-compose.yml release.json SHA256SUMS; do
  curl -fL --retry 3 "$AIPIC_RELEASE_URL/$file" -o "$file" || exit 1
done

# 只核对本次下载的附件，不要求同时下载另一种架构。
awk -v image="aipic-0.4.11-linux-${AIPIC_ARCH}.tar.gz" \
  '$2 == image || $2 == "docker-compose.yml" || $2 == "release.json"' \
  SHA256SUMS > downloaded.sha256
sha256sum -c downloaded.sha256 || exit 1

# 上述校验全部通过后加载并启动。先在 .env 中设置 AIPIC_ACCESS_TOKEN。
docker load -i "aipic-0.4.11-linux-${AIPIC_ARCH}.tar.gz" || exit 1
docker compose up -d --no-build
```

macOS 将校验命令替换为 `shasum -a 256 -c downloaded.sha256`。需要全部附件时，可下载所有 Release 附件后执行 `sha256sum -c SHA256SUMS`。

部署前须设置 `AIPIC_ACCESS_TOKEN`，并通过受保护的反向代理向 API 请求注入 `X-Aipic-Access-Token`。访问站点后，打开右上角 **API 设置**，填写 API Key 和服务商支持的模型 ID。镜像包不需要登录镜像仓库；发布包中的 Compose 文件没有源码构建步骤，默认使用刚加载的 `aipic:0.4.11`。

Compose 只启动 `aipic` 一个服务，并创建项目范围的 `aipic-data` 命名卷。保留此部署目录供后续升级使用；常用管理命令：

```bash
docker compose ps
docker compose logs -f aipic
docker compose down
```

`docker compose down` 保留数据卷。不要使用 `down -v`，除非确实希望删除服务器数据。

不使用 Compose 时，也可在加载镜像后启动单个容器：

```bash
docker volume create aipic-data
docker run -d \
  --name aipic \
  --restart unless-stopped \
  -p 8080:8788 \
  -v aipic-data:/data \
  -e AIPIC_ACCESS_TOKEN="$AIPIC_ACCESS_TOKEN" \
  aipic:0.4.11
```

Compose 和 `docker run` 是两种替代部署方式，不要同时启动同名容器。Compose 默认卷名带项目名前缀；从一种方式切换到另一种时，需要明确挂载原有卷。

### 方式二：直接拉取 GHCR 多架构镜像

镜像地址为 `ghcr.io/dreamending/aipic:0.4.11`，包含 `linux/amd64` 和 `linux/arm64`，Docker 会按主机架构选择。下载 Release 中的 `docker-compose.yml` 后，在同一部署目录创建或修改 `.env`：

```dotenv
AIPIC_IMAGE=ghcr.io/dreamending/aipic:0.4.11
AIPIC_PORT=8080
```

然后执行：

```bash
docker compose pull
docker compose up -d --no-build
```

GHCR 是否允许匿名拉取取决于包的可见性。如果收到权限错误，可使用有该包 `read:packages` 权限的 GitHub Token 登录，或直接使用上面的 Release 镜像包：

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

生产部署建议固定版本 `0.4.11`。如需固定到不可变内容，可将 `.env` 的 `AIPIC_IMAGE` 改为 `ghcr.io/dreamending/aipic@sha256:…`，使用同次 Release 的 `release.json` 中完整 `registryDigest`；不要把示例中的省略号原样粘贴。`latest` 和 `0.4` 是会随新版本更新的别名。

### 方式三：从源码使用 Docker Compose

克隆仓库或解压 Release 的 `aipic-0.4.11-source.tar.gz`，进入包含 `docker-compose.yml` 的源码目录执行：

```bash
docker compose up -d --build
```

源码目录中的 Compose 配置包含构建设置；Release 单独附带的 Compose 配置只使用已发布镜像。

### 从源码构建、导出镜像

构建当前机器架构：

```bash
docker build -f deploy/Dockerfile -t aipic:0.4.11 .
```

分别构建和导出两种架构（Docker Buildx 及跨架构构建支持需已就绪）：

```bash
mkdir -p release
docker buildx build --platform linux/amd64 --load \
  -f deploy/Dockerfile -t aipic:0.4.11 .
docker save aipic:0.4.11 | gzip > release/aipic-0.4.11-linux-amd64.tar.gz

docker buildx build --platform linux/arm64 --load \
  -f deploy/Dockerfile -t aipic:0.4.11 .
docker save aipic:0.4.11 | gzip > release/aipic-0.4.11-linux-arm64.tar.gz
```

每次导出紧跟对应架构的构建，因为两个构建使用相同标签。构建包括前端编译及后端原生依赖安装，不执行测试。`.dockerignore` 只允许项目源码进入上下文，排除 `.env*`、本地数据库、生成图片、依赖缓存和发布产物。

镜像内附构建时的项目源码和许可证，可在「API 设置 → 关于」点击「下载当前版本源码」，或从 `/aipic-source.tar.gz` 下载；源码包不包含依赖目录、API 密钥或运行数据。

### 运行时配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AIPIC_IMAGE` | `aipic:0.4.11` | Compose 使用的镜像标签 |
| `AIPIC_PORT` | `8080` | Compose 映射到宿主机的端口 |
| `AIPIC_ACCESS_TOKEN` | 必填 | 服务端 API 访问令牌，由受保护的反向代理注入请求头 |
| `DEFAULT_API_URL` | `https://www.chream.me` | 旧版环境变量兼容；前端调用地址固定 |
| `API_PROXY_URL` | `https://www.chream.me` | `/api-proxy/` 的后备上游 |
| `ENABLE_API_PROXY` | `true` | 是否开放 `/api-proxy/` 同源代理；不影响后台 Images 队列 |
| `LOCK_API_PROXY` | `true` | 启用代理时，是否锁定前端的代理开关 |
| `FLYREQ_TASK_CONCURRENCY` | `4` | 后台生图并发数 |

通过 Compose 更换端口：

```bash
AIPIC_PORT=3000 \
docker compose up -d --no-build
```

也可以把这些值写入仓库根目录的 `.env` 供 Compose 读取。此文件仅用于本机运行配置，不进入镜像。API Key 在页面设置中填写；不要放入镜像构建参数。

`docker run` 可以用 `-p` 指定宿主机端口。修改容器环境变量需要重建容器，无需重建镜像。

### 升级和数据保留

升级前等待正在执行的任务结束，保存数据卷备份；服务重启无法恢复已经提交到上游的请求。

发布新版本会更新 GHCR 标签和 Release 下载文件，已运行的容器不会自动更新。Compose 升级保持原项目目录与项目名不变，把 `.env` 或 Compose 中的 `AIPIC_IMAGE` 更新为本次版本；使用镜像包时先 `docker load`，使用 GHCR 时先 `docker compose pull`，然后执行：

```bash
docker compose up -d --no-build --force-recreate --remove-orphans
```

从旧版 Nginx + backend 双容器升级时，先停掉旧服务并迁移数据卷所有权，再启动新版：

```bash
docker compose down --remove-orphans
docker compose run --rm --no-deps --user 0 --entrypoint chown \
  aipic -R 1000:1000 /data
docker compose up -d --no-build
```

该操作保留现有卷内容，并使新版普通用户可以读写旧版由 root 创建的文件。使用宿主机目录挂载时，同样确保该目录归 `1000:1000` 所有。不要同时用新旧后端访问同一 SQLite 数据文件。

使用 `docker run` 的部署，停止并删除旧容器后，重新执行原运行命令，继续挂载同一个 `aipic-data:/data` 卷即可。

## Cloudflare Pages 部署

当前线上地址为 **[https://image.simplaj.top/](https://image.simplaj.top/)**，由现有 Cloudflare Pages 项目 `aipic` 连接 GitHub 仓库 `simplaj/AIPic` 自动发布。日常更新只需推送 `main`；Cloudflare 从对应提交重新构建前端和 Pages Functions，再更新生产域名。Docker Release 则由 `v*` 标签触发，两条发布流程独立。

Cloudflare Pages 提供前端和 `/api-proxy/` 保活代理，**不包含 FlyReq 后台任务、SQLite、服务器持久化队列或图片目录**。需要提交后关闭页面仍由服务器处理任务时，请使用上面的 Node / Docker 部署。

### Git 自动构建配置

在 Cloudflare 控制台打开 **Workers & Pages → aipic → Settings → Builds & deployments**，确认生产配置：

| 配置项 | 值 |
| --- | --- |
| Git 仓库 | `simplaj/AIPic` |
| 生产分支 | `main` |
| 根目录 | 仓库根目录 |
| 构建命令 | `npm run build` |
| 构建输出目录 | `dist` |
| Node.js 构建版本 | 构建变量 `NODE_VERSION=24` |
| 自定义域名 | `image.simplaj.top` |

`wrangler.jsonc` 已配置项目名 `aipic` 和 `pages_build_output_dir: "./dist"`。Pages 构建需要保留仓库根目录的 `functions/`，Cloudflare 会把其中的 `/api-proxy/` 一起部署；只把 `dist` 当普通静态文件上传不能替代完整的 Pages Functions 发布。

前端构建变量：

| 变量 | Cloudflare Pages 的设置 |
| --- | --- |
| `VITE_TASK_BACKEND` | 不设置，或留空；不能设为 `flyreq` |
| `VITE_API_PROXY_AVAILABLE` | `true`，仓库 `.env.production` 已提供默认值 |
| `VITE_API_PROXY_LOCKED` | `false`，允许用户在页面设置切换代理 |
| `VITE_DOCKER_DEPLOYMENT` | 不设置，或 `false` |
| `VITE_DEFAULT_API_URL` | 旧版构建变量；前端调用地址固定为 `https://www.chream.me` |

不要在 Pages 使用 `npm run build:backend`，否则前端会调用该部署不存在的 `/api/flyreq/`。Cloudflare 与普通静态托管不同，它已有 `/api-proxy/` Function，因此不应关闭 `VITE_API_PROXY_AVAILABLE`。

`VITE_*` 会进入公开的前端文件，不要把 API Key 写入这些构建变量。用户在页面 API 设置中填写自己的密钥。

### 更新发布

维护者把更新提交到 `main` 后推送：

```bash
git push origin main
```

在 Cloudflare 的 **Deployments** 中查看 Production 部署，确认分支为 `main`、源码 commit 与本次推送一致且状态为 **Success**。只有推送成功还不能说明 Cloudflare 已构建成功；若构建失败，检查该次部署日志，旧生产版本通常继续服务。

Docker 镜像的发布入口为 `.github/workflows/docker.yml`：`v0.4.11` 标签必须指向 `package.json` 和 `package-lock.json` 都为 `0.4.11` 的提交。工作流分别构建 amd64、arm64，核对镜像架构、版本和源码提交，生成源码包与 `SHA256SUMS`，附件齐全后才公开 Release。构建与打包步骤不执行应用测试或启动应用容器。

仓库保留的 **Optional GitHub Pages Deployment** 工作流仅支持手动触发，不参与 `image.simplaj.top` 的发布，也不会在推送标签时创建额外站点。

### dev 分支预览

开发改动先推送 `dev`，不修改生产分支 `main`。在 Cloudflare Pages 的构建设置中启用 `dev` 分支的 Preview deployment，沿用 `npm run build` 和 `dist`。预览环境同样需要 `/api-proxy/` Function，不要设置 `VITE_TASK_BACKEND=flyreq`。

```bash
git push -u origin dev
```

以 Cloudflare Deployments 中该次 `dev` 提交的 Preview 地址为准；生产域名仍由 `main` 管理。不要用 `--branch main` 发布开发版本。

### 手动部署（备用）

生产站点正常使用上述 Git 自动部署即可。确实需要手动部署时，在仓库根目录使用 Node.js 24，确保本机 `.env.*.local` 没有覆盖上述 Pages 配置：

```bash
npm ci
npx wrangler login
VITE_TASK_BACKEND= VITE_API_PROXY_AVAILABLE=true \
  VITE_API_PROXY_LOCKED=false VITE_DOCKER_DEPLOYMENT=false npm run build
npx wrangler pages deploy dist --project-name aipic --branch main
```

从仓库根目录运行 Wrangler，才能包含 `functions/`。该命令会更新现有 `aipic` 项目的生产部署，完成后仍在 Cloudflare Deployments 中核对提交信息和结果。

## 本地代理开发

如果本地遇到 CORS，可复制代理配置：

```bash
cp dev-proxy.config.example.json dev-proxy.config.json
```

然后修改 `dev-proxy.config.json`：

```json
{
  "prefix": "/api-proxy",
  "target": "https://www.chream.me"
}
```

重启开发服务后，在页面 API 设置中开启代理即可。

## 常用命令

```bash
npm run backend:install # 安装后台依赖
npm run build:backend   # 构建启用后台任务的前端
npm start               # 启动后台和生产页面，默认 8788
npm run dev:backend     # 前端热更新，后台另开终端启动
npm run build           # 构建原有静态 / Pages 通道
npm test                # 运行 Vitest 测试
```

## 目录结构

```text
src/components/RetouchWorkspace.tsx   专业修图工作台主界面
src/store.ts                          任务提交、历史、IndexedDB 状态逻辑
src/lib/api.ts                        图片 API 请求入口
src/lib/apiProfiles.ts                API 配置和默认地址
backend/server.js                    FlyReq 后台队列、任务查询和图片存储
backend/LICENSE                      移植后端的 AGPL-3.0 许可证
functions/api-proxy/[[path]].ts       Cloudflare Pages API 代理
src/lib/editorialRetouchPresets.ts   纸刊海报提示词
wrangler.jsonc                        Cloudflare Pages 配置
```

## 使用建议

- 先用 1K、1 张、快速质量测试 prompt 是否正确。
- 参考图修图时优先使用图生图模式，文生图模式不会引用参考图。
- 局部修改时先涂抹 mask，再提交局部修图。
- 4K、精修、多图、带参考图任务推荐使用 Node / Docker 后台任务部署；若出现上游 524，请检查中转站自身限制。
- prompt 中明确写出需要保留的身份、结构、文字、边缘、光影和背景元素。

## 技术栈

- React 19
- TypeScript
- Vite
- Zustand
- Vitest
- Node.js / SQLite 后台任务
- Cloudflare Pages Functions（保留的同步部署通道）
- OpenAI 兼容 Image API / Responses API
- 自定义 HTTP 服务商配置

## 致谢

前端基于 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 开源项目改造，原项目使用 MIT License。

`backend/` 移植自 [doudou770/flyreq-image-studio](https://github.com/doudou770/flyreq-image-studio)，保留其 AGPL-3.0 许可证；来源及修改记录见 `backend/README.md`。

感谢原项目作者和社区贡献者。
