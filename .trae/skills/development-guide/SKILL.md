---
name: development-guide
description: Scaffold a business domain across api, service, store, view and router, and check layer violations. Use when adding pages, API modules or stores. Do not use for protocol or wasm changes.
---

# development-guide

新增业务域或页面时按以下顺序落地，完成后执行第 6 步自检。先读 `AGENTS.md`（硬约束）与 `docs/ARCHITECTURE.md`（目录与规划）。

## 1. api — 契约层

- 对照 goim-business `internal/handler/<域>/<handler>.go` 建 `src/api/<域>/<handler>.ts`
- 目录名 = handler 目录，文件名 = handler 文件名
- 只声明路径、类型与导出函数；请求统一走 `@/api/http` 的 `request`，错误码与刷新复用 `@/api/client`
- 字段与 Go `binding` / `types` 一致；会话、IM 凭证等类型以 `openapi.json` 为准

## 2. services — 编排层

- `src/services/<域>/<流程>.ts`，一个文件对应一条业务流程
- 唯一允许同时使用 `api` 与 `im` 的位置
- 不持有 UI 状态；返回数据或抛出 `BusinessApiError` / `GoimError`

## 3. stores — 状态层

- `src/stores/<域>.ts`（单一文件；超过 300 行或出现子域时再拆目录）
- 禁止 `fetch` / `axios` / `import '@/im/*'`
- 只调用 services，或使用 api 中的纯工具（如本地会话持久化）

## 4. views / components — 展示层

- `src/views/<域>/<View>.vue`；子页面放同域目录（如 `views/chat/search/SearchView.vue`）
- 只读 store、调用 store action；禁止 import `api/` 或 `im/`
- 跨目录 import 用 `@/`，同目录用 `./`
- 消息内容必须经 `@/utils/message` 解析

## 5. router

- 登录后的页面挂在 `/` 的 `ChatLayout` children 下，例如：

```ts
{ path: 'chat', name: 'chat', component: ChatView },
```

- `LoginView` 独立注册在 `/login`

## 6. 自检清单（提交前必须全过）

```powershell
# 分层违规：stores 不应出现 im / fetch / axios
Get-ChildItem -Recurse src\stores -Filter *.ts | Select-String -Pattern "@/im/|fetch\(|axios"
# 展示层不应直接依赖 api / im
Get-ChildItem -Recurse src\views, src\components -Filter *.vue | Select-String -Pattern "from '@/api/|from '@/im/"
npm run typecheck
npm run build
```

人工确认：

- 消息 `content` 未直接渲染（使用 `messageText` / `messagePreview`）
- IM 事件在 `login` 之前订阅
- SDK 能力变更时以 `goim/docs/protocol-message.md` 为准，修改 SDK 契约而不是在前端兜底

## 常见错误

- 在 store 里直接 `getIM().conversations.getAll()`
- 在 view 里 `import '@/api/profile/profile'` 自行发起请求
- 新建平铺的 `src/api/xxx.ts`，未按 handler 目录分组
- 组件中 `{{ msg.content }}` 直出 JSON
