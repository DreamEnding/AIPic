# 安全部署与兼容边界

## 访问认证

Node 和 Pages 都必须配置服务端 secret `AIPIC_ACCESS_TOKEN`。未配置返回 503；客户端未发送正确的 `X-Aipic-Access-Token` 返回 401。上游 `Authorization: Bearer ...` 不能代替应用认证。任务、图片、模型列表、代理和 WebSocket 均受保护；`/health` 与 `/ready` 可供健康检查。

浏览器部署应通过已认证的反向代理（例如现有 session / SSO / Basic Auth 网关）注入这个 header。网关必须覆盖客户端同名 header，在验证用户身份后才注入，且后端端口不能绕过网关从公网访问。WebSocket upgrade 和图片请求也须通过该网关。不要把应用 token 写入 `VITE_*`、静态 JS 或 URL。直接 API 调用可以自行携带 header。

这是单租户工作室的共享访问 token，不是多租户用户隔离系统。所有持有应用 token 的访问者共享任务空间与限流预算；不得据此宣称已有逐用户 ACL 或独立账号 session。

## Provider 与出站边界

`AIPIC_PROVIDERS` 是服务端 JSON 对象，例如：

```json
{"company":"https://models.example.com/v1"}
```

任务可以提交 `providerId: "company"`；代理使用 `X-Aipic-Provider: company`。兼容旧客户端的 `baseUrl` / `X-Aipic-Upstream` 仍接受，但必须与服务端配置完全匹配。内置 openai、xai、grok 和 google；代理默认值来自 `API_PROXY_URL` / `DEFAULT_API_URL`。不支持匿名任意目标，也不提供开发模式的私网绕过。

统一 URL 策略要求 HTTPS，禁止 URL 内凭据、本地名称、私网、loopback、link-local、metadata、IPv4 特殊网段和非普通公网 IPv6。Node 的 undici connector 对实际交给连接器的全部 DNS 地址检查；遇到一个非公网地址即拒绝，没有检查后再次解析的间隙。IP 字面量在发起请求前检查。自动重定向和客户端可见的上游重定向均被拒绝。

Pages 只能直接连接内置 provider 的固定 origin。自定义域名必须绑定 `AIPIC_EGRESS`，通过受控 Node 出站层执行相同 DNS 检查；缺少绑定返回 503。提供了 `deploy/cloudflare/egress.js`：配置 `NODE_EGRESS_URL`、secret `NODE_EGRESS_TOKEN` 及相同的 `AIPIC_PROVIDERS`，将 `aipic-egress` 作为 Pages 的 `AIPIC_EGRESS` service binding。该 worker 的 `workers_dev` 关闭且不得添加公网 route。Node 出站服务仍需独立访问保护。

## 资源限制

- 请求体最多 24 MiB，实际流量计数，不只相信 Content-Length。
- 输入单图/蒙版最多 10 MiB，图片任务参考图最多 8 张，视频参考图最多 9 张，批量最多 4。
- Node 入口写请求默认每分钟 20 次、并发 4；读请求独立预算。任务仍有 IP/API Key 的排队限制与全局 worker 限制，默认队列 16、worker 4。默认不信任 X-Forwarded-For。
- Node 单次上游响应最多 64 MiB；生成图片和远程图片默认最多 10 MiB。视频大响应也受该上限约束。
- Pages 必须绑定 `AIPIC_LIMITER`。先部署 `deploy/cloudflare/wrangler.jsonc` 中的 `aipic-security` Worker，再部署 Pages；根配置已声明跨 Worker Durable Object binding。一个命名对象在所有 Pages isolate 之间共享每分钟 20 次、并发 4 的预算。租约在完成/取消后释放，并有最长存活时间。
- 多 Node 副本的内存队列和入口限流各自独立；此部署按一个 Node 实例设计。扩容前需要共享调度/限流存储。

## 密钥、日志和导出

API Key 目前随设置保存在浏览器 localStorage，这是现有产品行为；同源脚本和能访问浏览器配置文件的人可以读取。IndexedDB 保存任务、图片和对话；后端任务快照不保存 API Key，执行期密钥仅在内存中。

默认 ZIP 导出递归清理配置密钥、Authorization、自定义鉴权字段和 URL token，包括嵌套 JSON 响应。复制含 Key 的配置链接会明确警告；页面读取配置链接时先清理地址栏，再应用设置。`no-referrer` 减少链接泄露，但不能撤销已经进入访问日志或历史记录的 URL，应轮换已泄露的 Key。

生产环境默认关闭应用文件日志及图片/视频上游详细日志。结构化日志统一清理密钥、Authorization、query token、prompt/body 和 Base64 字段。上游错误只返回状态摘要，避免上游回显任意凭据；因此旧版依赖完整 upstream error body 的诊断行为有意改变。

## 任务与运行目录

任务状态包括 queued、processing、completed、failed、interrupted、expired；cancelled 保留用于兼容视频取消。旧的中文排队状态会迁移为 queued。重启时 queued/processing 及其活动子项转为 interrupted，ACK 仅缩短终态任务寿命；过期任务发出 expired 通知后清理。

Docker 保留非 root，启用只读根文件系统、no-new-privileges、丢弃全部 capabilities。运行时静态配置注入改到 `/data/dist`，数据库、媒体和日志也位于 `/data`。`/ready` 检查 SQLite 查询与初始化结果。启动时数据库无法打开会直接失败。

## 渐进拆分与旧数据

server.js 仅保留 HTTP/WS 初始化、入口保护、路由注册和启动/停止。provider 请求、provider dispatch/capability、路由和数据库初始化/恢复已分离。Grok/custom 的 OpenAI 兼容请求共用 OpenAI adapter，避免复制相同实现。

前端使用 editor、task、history、settings、agent 五个 slice，API 调用、Agent 执行、草稿、图片缓存和提示词编辑迁入 services。修图工作台拆为 Canvas、Toolbar、Sidebar、History、Output Settings；InputBar 拆为 PromptInput、ReferenceImages、OutputParameters 和 SubmitControls（原界面没有独立模型选择器，模型选择仍在 API 配置页）。Agent 的消息模型、渲染组件、状态和 API/工具执行分层。`store.ts` 保留兼容调用入口与尚未迁完的持久化动作，采用渐进迁移。

显示名称、包名和新导出文件名采用 AIPic。IndexedDB 名称、Zustand persist key 和已有设置 key 继续使用历史名称，属于有意保留的存储 ABI；未重建数据库、未清除历史数据。未来改存储名须另做事务迁移和回退，不能全局替换。

根 LICENSE 是 MIT；backend 及复用其代码的服务端代理/安全模块受 backend/LICENSE 的 AGPL 约束，保留 FlyReq attribution。Release 单独携带两份许可证，源码归档也保留原路径。不得删除上游声明。

## 验证

`npm test` 运行前端与 Pages 回归；`npm run test:security` 还会启动隔离临时 SQLite 的 Node 后端，检查真实 HTTP 认证、SSRF 拒绝、限流、超大请求和重启恢复。`npm run build` 验证前端类型与生产构建；Pages 可用 `wrangler pages functions build functions` 做本地编译。
