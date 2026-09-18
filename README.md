# AI 专业修图台

面向专业修图师、设计师、电商视觉和摄影后期的 AI Native 修图工作台。项目基于 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 二次开发，保留图像生成、图生图、遮罩编辑、多 API 配置和历史管理能力，并重构为更适合专业修图工作流的中文界面。

生产地址：[https://image.simplaj.top/](https://image.simplaj.top/)

推荐 API 中转：[https://sub2api.simplaj.top/](https://sub2api.simplaj.top/)

顶部中转站入口可配置，默认指向上面的地址；私有部署时可以换成自己的中转站或购买页。

## 当前版本重点

- 专业修图工作台：固定屏幕工作区，左侧功能预设，中间大画布预览，右侧主交互区和历史记录。
- 文生图 / 图生图：右侧支持模式切换；文生图提交时不会携带参考图或 mask，图生图保留参考图修图链路。
- 专业预设：人像、丰体、瘦身、背景修复、皮肤美化、全局美化、人像调色、衣物、裁剪、AI Native 等分类。
- 多选叠加：预设小功能支持多选叠加，并自动映射为结构化中文 prompt。
- 强度和对象：支持轻微、标准、明显、强烈，以及自动、女性、男性、儿童、产品/物体等对象设置。
- 局部修图：支持涂抹指定区域生成 mask，作为局部重绘参考。
- 对比和缩放：支持前后对比线、完整显示、无级缩放和大图查看。
- 修图历史：任务提交后自动记录历史，支持回看输出和任务状态。
- 输出控制：支持 1 张 / 4 版、1K / 2K / 4K、快速 / 标准 / 精修、PNG / WebP / JPEG。
- 后台生图任务：直接移植 FlyReq Image Studio 的 Node.js / SQLite 后端，GPT/Grok Images 请求先返回任务 ID，前端轮询结果，模型请求在服务器继续执行。
- API 代理：保留 `/api-proxy/` 供 Responses 和其他同步接口使用；普通 Images 任务走 `/api/flyreq/`。
- 可配置推广入口：顶部中转站 URL 和文案可通过环境变量修改，不再写死在界面组件里。

## 界面预览

![AI 专业修图台](public/retouch-studio-sample.png)

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
https://sub2api.simplaj.top/
```

用户可以在页面右上角的 API 设置中修改：

- API 地址
- API Key
- 模型 ID
- API 模式
- 是否启用代理
- 输出尺寸、质量、格式等参数

没有 API 时，页面顶部和 API 设置区域会引导到：

```text
https://simplaj-docs.pages.dev/
```

### 顶部中转站入口配置

默认顶部入口显示：

```text
https://sub2api.simplaj.top/ 稳定API中转站，注册送5刀，可免费修10张图
```

如果要换成自己的中转站、购买页或文档页，可以在构建时配置：

```bash
VITE_PROMO_API_URL=https://your-gateway.example.com/ \
VITE_PROMO_API_LABEL=我的中转站 \
npm run build
```

这只影响顶部宣传入口的跳转和显示文案，不会修改真实模型请求地址。真实请求地址仍由 `VITE_DEFAULT_API_URL`、页面 API 设置、`API_PROXY_URL` 或用户手动配置控制。

### Cloudflare Pages API 代理

当前仓库包含 Pages Function：

```text
functions/api-proxy/[[path]].ts
```

代理规则：

- 前端请求 `/api-proxy/images/generations` 等路径。
- Pages Function 默认转发到 `https://sub2api.simplaj.top/v1`。
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

## Docker 一键部署

Docker 版本适合本地服务器、NAS、轻量云服务器或内网工作站部署。Compose 启动 Nginx 前端和 Node 后端两个服务，SQLite、生成图片与日志保存在 `aipic-data` 命名卷：

- 页面访问地址：`http://服务器IP:8080/`
- 默认 API 地址：`https://sub2api.simplaj.top/`
- 默认代理上游：`https://sub2api.simplaj.top/v1`
- Images 任务使用同源 `/api/flyreq/`，Nginx 转发到内部后端 `backend:8788`。
- Responses 等原有请求继续使用 `/api-proxy/`；后端端口不直接发布到宿主机。

### 方式一：Docker Compose

克隆项目后，在项目目录执行：

```bash
docker compose up -d --build
```

启动后访问：

```text
http://127.0.0.1:8080/
```

如果部署在服务器上，把 `127.0.0.1` 换成服务器 IP 或域名。

查看运行状态：

```bash
docker compose ps
docker compose logs -f aipic backend
```

停止服务：

```bash
docker compose down
```

### 方式二：docker run

独立运行需要前端和后端两个镜像，并放入同一 Docker 网络：

```bash
docker build -f deploy/Dockerfile --target frontend -t aipic:local .
docker build -f deploy/Dockerfile --target backend -t aipic-backend:local .
docker network create aipic-net
docker volume create aipic-data

docker run -d \
  --name aipic-backend --network aipic-net --network-alias backend \
  --restart unless-stopped \
  -v aipic-data:/data \
  -e FLYREQ_TASK_CONCURRENCY=4 \
  aipic-backend:local

docker run -d \
  --name aipic --network aipic-net \
  --restart unless-stopped \
  -p 8080:80 \
  -e DEFAULT_API_URL=https://sub2api.simplaj.top/ \
  -e API_PROXY_URL=https://sub2api.simplaj.top/v1 \
  aipic:local
```

### Docker 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AIPIC_PORT` | `8080` | Compose 暴露到宿主机的端口 |
| `FLYREQ_TASK_CONCURRENCY` | `4` | Compose 后台生图并发数 |
| `DEFAULT_API_URL` | `https://sub2api.simplaj.top/` | 前端 API 设置里显示的默认地址 |
| `API_PROXY_URL` | `https://sub2api.simplaj.top/v1` | 容器内 Nginx 代理转发目标 |
| `ENABLE_API_PROXY` | `true` | 是否启用 `/api-proxy/` 同源代理 |
| `LOCK_API_PROXY` | `true` | 是否强制走代理，避免用户误关后触发 CORS |
| `PROMO_API_URL` | `https://sub2api.simplaj.top/` | 顶部中转站入口跳转地址 |
| `PROMO_API_LABEL` | `稳定API中转站，注册送5刀，可免费修10张图` | 顶部中转站入口显示文案 |

修改端口示例：

```bash
AIPIC_PORT=3000 docker compose up -d --build
```

切换到其他 OpenAI 兼容接口示例：

```bash
DEFAULT_API_URL=https://example.com/ \
API_PROXY_URL=https://example.com/v1 \
docker compose up -d --build
```

只替换顶部中转站入口，不改模型请求接口：

```bash
PROMO_API_URL=https://your-gateway.example.com/ \
PROMO_API_LABEL=我的中转站 \
docker compose up -d --build
```

### Docker 使用流程

1. 打开 `http://服务器IP:8080/`。
2. 点击右上角 `API 设置`。
3. 填入 API Key，模型 ID 默认可用 `gpt-image-2`。
4. 提交文生图或图生图任务，后台执行期间可查看任务状态。

如果请求失败，优先检查：

- `API_PROXY_URL` 是否带 `/v1`。
- API Key 是否有效。
- 上游是否支持 `/v1/images/generations` 和 `/v1/images/edits`。
- 服务器是否能访问上游 API。

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

部署后生产地址：

```text
https://image.simplaj.top/
```

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
  "target": "https://sub2api.simplaj.top/v1"
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
public/retouch-studio-sample.png      工作台示例图
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
