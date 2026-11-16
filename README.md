# goim-web-chat

goim 的 Web 聊天客户端，基于 Vue 3 + Vite + TypeScript 实现，通过 `@goim/web-sdk`（goim-sdk-core 的 wasm 封装）连接 goim 服务端，当前处于 M0 链路验证阶段。

## 功能

- wasm 加载与 SDK 初始化，展示连接状态、同步状态、当前登录用户
- 业务账号登录 / 注册 / 登出（生产使用业务账号登录，不再使用 admin secret）
- 会话列表（远端拉取 + 本地缓存兜底）、本地历史消息加载、标记已读
- 按 userID（单聊）或 groupID（群聊）发送文本消息
- 订阅 SDK 事件（新消息、发送成功、会话更新、强制下线等），并在页面底部输出事件日志

## 环境要求

| 依赖 | 说明 |
| --- | --- |
| Node.js | 18 及以上（Vite 5 要求） |
| npm | 随 Node.js 安装 |
| PowerShell | `copy:wasm` / `build:wasm` 脚本基于 PowerShell 编写，Windows 下可直接使用 |
| goim-sdk-js | 必须与本项目位于同一父目录，本项目通过 `../goim-sdk-js` 引用 SDK 源码与 wasm 产物 |
| goim 服务端 | 需要可访问的 HTTP API 与 WebSocket 服务 |

目录结构约定：

```
goim-all/
├── goim/            # 服务端
├── goim-business/   # 业务后端（账号与 IM token 兑换）
├── goim-sdk-core/   # Go SDK 核心
├── goim-sdk-js/     # Web wasm 封装（提供 @goim/web-sdk）
└── goim-web-chat/   # 本项目
```

## 快速开始

### 1. 构建 SDK 的 wasm 产物

首次运行或 SDK 变更后，先在同级的 `goim-sdk-js` 中生成 wasm：

```bash
cd ../goim-sdk-js
npm install
npm run build:wasm
```

产物会输出到 `goim-sdk-js/wasm/`，包含 `goim.wasm`、`wasm_exec.js`、`idb_wrapper.js`、`manifest.json`。

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

在项目根目录创建 `.env.local`（该文件已被 `.gitignore` 忽略，需手动创建）：

```dotenv
# 页面内使用的接口地址（相对路径，由 vite proxy 转发，避免 CORS）
VITE_GOIM_API_URL=/api/v1
VITE_GOIM_WS_URL=/ws

# 平台 ID（Web=5）
VITE_GOIM_PLATFORM_ID=5

# 业务后端（goim-business）账号与 IM 开通接口；生产使用业务账号登录
VITE_BUSINESS_API_URL=/biz-api/v1

# vite proxy 目标（仅开发期生效）
VITE_GOIM_API_PROXY=http://192.168.241.128:18880
VITE_GOIM_WS_PROXY=ws://192.168.241.128:50001
VITE_BUSINESS_API_PROXY=http://127.0.0.1:8080
```

| 变量 | 说明 |
| --- | --- |
| `VITE_GOIM_API_URL` | SDK 使用的 HTTP API 地址，默认 `/api/v1` |
| `VITE_GOIM_WS_URL` | SDK 使用的 WebSocket 地址，默认 `/ws` |
| `VITE_GOIM_PLATFORM_ID` | 平台 ID，Web 应为 `5`（默认 `5`） |
| `VITE_BUSINESS_API_URL` | 业务后端 API 基址，默认 `/biz-api/v1`（由 vite proxy 转发到 `VITE_BUSINESS_API_PROXY`） |
| `VITE_GOIM_API_PROXY` | 开发期 `/api` 代理目标，默认 `http://192.168.241.128:18880` |
| `VITE_GOIM_WS_PROXY` | 开发期 `/ws` 代理目标，默认 `ws://192.168.241.128:50001` |
| `VITE_BUSINESS_API_PROXY` | 开发期 `/biz-api` 代理目标，默认 `http://127.0.0.1:8080` |

如需绕过代理直连服务端，可将 `VITE_GOIM_API_URL` / `VITE_GOIM_WS_URL` / `VITE_BUSINESS_API_URL` 改为完整地址（如 `http://192.168.241.128:18880/api/v1`、`ws://192.168.241.128:50001/ws`、`http://127.0.0.1:8080/api/v1`），并确保服务端已放开 CORS。生产环境使用业务账号登录，不要在前端配置任何 admin secret。

### 4. 启动开发服务

```bash
npm run dev
```

`dev` 之前会自动执行 `copy:wasm`，把 `../goim-sdk-js/wasm` 同步到 `public/wasm/`。启动后访问 <http://localhost:5173>。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器（端口 5173，自动同步 wasm） |
| `npm run build` | 生产构建，产物输出到 `dist/`（构建前自动同步 wasm） |
| `npm run preview` | 本地预览生产构建产物 |
| `npm run typecheck` | 执行 `vue-tsc --noEmit` 类型检查 |
| `npm run copy:wasm` | 仅同步 wasm 产物到 `public/wasm/` |

## 使用说明

1. 页面顶部徽标展示 wasm 加载、连接、同步与登录状态。
2. 在登录栏输入业务后端的登录名与密码，点击「登录」（首次使用可点击「注册」创建账号），客户端会先向业务后端换取 IM token，再建立 WebSocket 连接并等待后台同步完成。
3. IM token 在过期前会自动续期，无需手动重新登录。
4. 在左侧会话列表选择会话，主区域会展示本地历史消息并标记已读。
5. 在发送区选择目标类型（单聊填 userID / 群聊填 groupID），输入内容后发送。
6. 底部日志区实时输出 SDK 事件，便于排查链路问题，可一键清空。

## 常见问题

- **提示「未找到 wasm 产物目录」**：说明 `../goim-sdk-js/wasm` 不存在，先在 `goim-sdk-js` 执行 `npm run build:wasm`。
- **页面显示「初始化失败」**：检查 `.env.local` 是否缺失，并确认 goim 服务端可访问。
- **提示「IM 账号开通失败，请稍后重试」**：说明业务后端已登录但 IM 账号尚未开通成功，确认业务后端与 IM 服务的连通性后重试。
- **连接一直为「未连接」**：确认 `VITE_GOIM_API_PROXY` / `VITE_GOIM_WS_PROXY` 指向的服务可达，注意 WS 是独立端口而非 HTTP 端口。
- **接口 404 或跨域错误**：优先使用相对路径 + vite proxy 方案；若改为直连，需服务端允许当前页面 origin 的 CORS。

## 技术栈

- Vue 3（`<script setup>` + Composition API）
- Vite 5 + `@vitejs/plugin-vue`
- TypeScript 5
- `@goim/web-sdk`（Go wasm + IndexedDB 本地存储）
