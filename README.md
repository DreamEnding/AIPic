# AI 专业修图台

面向专业修图师、设计师、电商视觉和摄影后期的 AI Native 修图工作台。项目基于 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 二次开发，保留图像生成、图生图、遮罩编辑、多 API 配置和历史管理能力，并重构为更适合专业修图工作流的中文界面。

这是可自行部署的开源、无广告版本。应用不提供 API Key，请在设置中配置自己的 OpenAI 或兼容服务。

## 当前版本重点

- 专业修图工作台：固定屏幕工作区，左侧功能预设，中间大画布预览，右侧主交互区和历史记录。
- 文生图 / 图生图：右侧支持模式切换；文生图提交时不会携带参考图或 mask，图生图保留参考图修图链路。
- 专业预设：人像、丰体、瘦身、背景修复、皮肤美化、全局美化、人像调色、衣物、裁剪、AI Native 等分类。
- 纸刊海报：新增「实景纸刊」「抽象映像」「极简留白」，入口为 **AI Native → 纸刊海报**；上传照片并选择一种版式，可叠加常规修图。来源记录见 [预设说明](docs/preset-sources.md)。
- 多选叠加：预设小功能支持多选叠加，并自动映射为结构化中文 prompt。
- 强度和对象：支持轻微、标准、明显、强烈，以及自动、女性、男性、儿童、产品/物体等对象设置。
- 局部修图：支持涂抹指定区域生成 mask，作为局部重绘参考。
- 对比和缩放：支持前后对比线、完整显示、无级缩放和大图查看。
- 修图历史：任务提交后自动记录历史，支持回看输出和任务状态。
- 输出控制：支持 1 张 / 4 版、1K / 2K / 4K、快速 / 标准 / 精修、PNG / WebP / JPEG。
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

## API 配置

应用默认使用 OpenAI 兼容接口，默认 API 地址为：

```text
https://api.openai.com/v1
```

用户可以在页面右上角的 API 设置中修改：

- API 地址
- API Key
- 模型 ID
- API 模式
- 是否启用代理
- 输出尺寸、质量、格式等参数

默认地址可在前端构建时通过 `VITE_DEFAULT_API_URL` 设置；Docker 镜像支持启动时设置 `DEFAULT_API_URL`，无需重新构建。已经保存到浏览器的 API 配置不会被新的默认值覆盖。

### Cloudflare Pages API 代理

当前仓库包含 Pages Function：

```text
functions/api-proxy/[[path]].ts
```

代理规则：

- 前端请求 `/api-proxy/images/generations` 等路径。
- Pages Function 默认转发到 `https://api.openai.com/v1`。
- 私有 Pages 部署可通过环境变量 `API_PROXY_URL=https://your-gateway.example.com/v1` 修改默认代理上游。
- 请求头 `x-aipic-upstream` 可以覆盖上游地址，但只接受 HTTPS。
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

版本 `0.4.9` 使用**单个镜像、单个容器**：Node.js 24 同时提供前端页面、`/api/flyreq/` 后台任务、WebSocket 和 `/api-proxy/` 同源代理。容器内端口为 `8788`，默认映射到宿主机 `8080`；不再需要单独部署 Nginx 或后端容器。

镜像以普通用户 `node`（UID/GID `1000:1000`）运行。SQLite、生成图片、视频和日志统一写入 `/data`，请始终挂载持久卷。页面历史仍保存在当前浏览器中，服务器结果有独立的自动清理周期。

### 方式一：加载可直接部署的镜像包

发布产物在 `release/`，按目标服务器架构选择一个：

| 文件 | 适用服务器 |
| --- | --- |
| `aipic-0.4.9-linux-amd64.tar.gz` | x86-64 / Intel / AMD |
| `aipic-0.4.9-linux-arm64.tar.gz` | ARM64 / Apple Silicon / ARM 服务器 |

两个镜像包加载后均使用标签 `aipic:0.4.9`。例如在 x86-64 服务器上：

```bash
docker load -i release/aipic-0.4.9-linux-amd64.tar.gz
docker volume create aipic-data
docker run -d \
  --name aipic \
  --restart unless-stopped \
  -p 8080:8788 \
  -v aipic-data:/data \
  aipic:0.4.9
```

ARM64 服务器把加载文件改为 `release/aipic-0.4.9-linux-arm64.tar.gz`，运行命令相同。镜像包无须登录镜像仓库，也不依赖本机 Node.js。

访问 `http://服务器IP:8080/`，打开右上角 **API 设置**，填写 API 地址、API Key 和服务商支持的模型 ID，然后提交文生图或图生图任务。

### 方式二：Docker Compose

在仓库目录加载对应架构的镜像包后执行：

```bash
docker compose up -d --no-build
```

如果没有镜像包，直接从源码构建并启动：

```bash
docker compose up -d --build
```

Compose 只启动 `aipic` 一个服务，并创建项目范围的 `aipic-data` 命名卷。常用管理命令：

```bash
docker compose ps
docker compose logs -f aipic
docker compose down
```

`docker compose down` 保留数据卷。不要使用 `down -v`，除非确实希望删除服务器数据。

### 从源码构建、导出镜像

构建当前机器架构：

```bash
docker build -f deploy/Dockerfile -t aipic:0.4.9 .
```

分别构建和导出两种架构（Docker Buildx 及跨架构构建支持需已就绪）：

```bash
mkdir -p release
docker buildx build --platform linux/amd64 --load \
  -f deploy/Dockerfile -t aipic:0.4.9 .
docker save aipic:0.4.9 | gzip > release/aipic-0.4.9-linux-amd64.tar.gz

docker buildx build --platform linux/arm64 --load \
  -f deploy/Dockerfile -t aipic:0.4.9 .
docker save aipic:0.4.9 | gzip > release/aipic-0.4.9-linux-arm64.tar.gz
```

每次导出紧跟对应架构的构建，因为两个构建使用相同标签。构建包括前端编译及后端原生依赖安装，不执行测试。`.dockerignore` 只允许项目源码进入上下文，排除 `.env*`、本地数据库、生成图片、依赖缓存和发布产物。

镜像内附构建时的项目源码和许可证，可在「API 设置 → 关于」点击「下载当前版本源码」，或从 `/aipic-source.tar.gz` 下载；源码包不包含依赖目录、API 密钥或运行数据。

### 运行时配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AIPIC_IMAGE` | `aipic:0.4.9` | Compose 使用的镜像标签 |
| `AIPIC_PORT` | `8080` | Compose 映射到宿主机的端口 |
| `DEFAULT_API_URL` | `https://api.openai.com/v1` | 前端 API 设置中的初始地址；不覆盖浏览器已保存配置 |
| `API_PROXY_URL` | `https://api.openai.com/v1` | `/api-proxy/` 的后备上游；页面选择的上游优先 |
| `ENABLE_API_PROXY` | `true` | 是否开放 `/api-proxy/` 同源代理；不影响后台 Images 队列 |
| `LOCK_API_PROXY` | `true` | 启用代理时，是否锁定前端的代理开关 |
| `FLYREQ_TASK_CONCURRENCY` | `4` | 后台生图并发数 |

通过 Compose 更换端口和上游：

```bash
AIPIC_PORT=3000 \
DEFAULT_API_URL=https://example.com/v1 \
API_PROXY_URL=https://example.com/v1 \
docker compose up -d --no-build
```

也可以把这些值写入仓库根目录的 `.env` 供 Compose 读取。此文件仅用于本机运行配置，不进入镜像。API Key 在页面设置中填写；不要放入镜像构建参数。

`docker run` 使用 `-e DEFAULT_API_URL=... -e API_PROXY_URL=...` 传入同样配置。修改容器环境变量需要重建容器，无需重建镜像。旧的 `API_URL` 仍可作为两项地址的兼容后备值，新部署请使用独立变量。

### 升级和数据保留

升级前等待正在执行的任务结束，保存数据卷备份；服务重启无法恢复已经提交到上游的请求。

Compose 升级保持原项目目录与项目名不变，先加载新镜像，然后执行：

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

以下是保留的同步版本部署方式，**不包含 FlyReq 后台任务**。GPT/Grok 长时生图请使用上述 Node / Docker 部署。

项目已配置 Cloudflare Pages：

```text
wrangler.jsonc
project name: aipic
build output: dist
```

登录 Cloudflare：

```bash
npx wrangler login
```

构建并部署：

```bash
npm run build
npx wrangler pages deploy dist --project-name aipic --branch main
```

部署命令会输出该项目的访问地址；也可在 Cloudflare 控制台配置自己的域名。

如果需要确认账号权限：

```bash
npx wrangler whoami
```

## 本地代理开发

如果本地遇到 CORS，可复制代理配置：

```bash
cp dev-proxy.config.example.json dev-proxy.config.json
```

然后修改 `dev-proxy.config.json`：

```json
{
  "prefix": "/api-proxy",
  "target": "https://api.openai.com/v1"
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
- fal.ai 和自定义 HTTP 服务商配置

## 致谢

前端基于 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 开源项目改造，原项目使用 MIT License。

`backend/` 移植自 [doudou770/flyreq-image-studio](https://github.com/doudou770/flyreq-image-studio)，保留其 AGPL-3.0 许可证；来源及修改记录见 `backend/README.md`。

感谢原项目作者和社区贡献者。
