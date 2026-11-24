# goim-web-chat 架构与开发规划

> 状态：设计稿（本期只定架构与方案，不写实现代码）
> 依据：`goim-business/api/openapi.yaml`（26 个路径 / 27 个操作）、`docs/FRONTEND_INTEGRATION.md`、`goim-sdk-js`
> 已定决策：Tailwind 自建 UI、Pinia 状态、Vue Router 多路由页面、首期 P0 核心聊天

## 1. 背景与目标

现状是联调 demo：单页、一个 600 行的 `useGoim` composable、日志面板直出。目标是重构为可交付的 Web IM：

- **能力完整**：账号（登录/注册/会话/改密）、资料与头像、设备、IM 消息、文件附件
- **分层清晰**：UI 不直接调 HTTP 与 wasm；接口契约与 `goim-business` handler 一一对应
- **可持续**：新增业务域只加目录，不改核心；消息、上传、鉴权都有明确的职责归属

## 2. 技术选型

| 领域 | 选型 | 说明 |
|---|---|---|
| 框架 | Vue 3 + Vite + TypeScript | 沿用现状 |
| 状态 | Pinia | 四个 store：auth / chat / contacts / settings |
| 路由 | Vue Router | `/login`、`/chat/:conversationID`、`/contacts`、`/settings` |
| UI | Tailwind CSS + 自建组件 | 聊天区定制度高，不引组件库 |
| HTTP | axios | 多实例（业务后端 / 后续文件服务），拦截器统一异常 |
| IM | `@goim/web-sdk`（wasm） | 唯一 IM 连接来源，前端不直连 WebSocket；已含完整群聊能力（建群、成员、禁言、入群申请等） |
| 本地持久化 | wasm 侧 IndexedDB（会话/消息） + localStorage（业务会话/设备 ID/草稿） | wasm 负责消息落库，前端只管业务态 |

## 3. 分层架构

```
┌──────────────────────────────────────────────┐
│ views / components        UI，只读 store      │
├──────────────────────────────────────────────┤
│ stores (Pinia)            auth / chat /       │
│                           contacts / settings │
├──────────────────────────────────────────────┤
│ services                  业务编排：登录流程、 │
│                          发送流程、上传队列   │
├──────────────────────┬───────────────────────┤
│ im（wasm SDK 适配）   │ api（HTTP 契约）       │
│ 单例、事件、消息合并 │ 与 handler 目录一一对应 │
└──────────────────────┴───────────────────────┘
```

约束：

- `views/components` 不得 import `api/*` 或 `@goim/web-sdk`，只能读 store、调 store action
- `stores` 不得直接 `fetch` 或 import `im/`，只能经 `services` 或 `api`
- `services` 可以同时用 `api` 与 `im`，是唯一的跨层编排位置
- `im` 不得 import `api`（避免 IM 层被 HTTP 细节污染）

## 4. 目录结构

跨目录引用统一使用 `@/`（指向 `src/`）；同目录内部仍用 `./`。别名在 `vite.config.ts` 的 `resolve.alias` 与 `tsconfig.json` 的 `paths` 中同时声明。

```
src/
  api/
    client.ts                 # 错误码、BusinessApiError、会话持久化、设备标识、applyAuthSession
    http.ts                   # axios 实例工厂、envelope 解析、401/2004 刷新单飞
    account/
      account.ts              # ↔ handler/account/account.go
      im.ts                   # ↔ handler/account/im.go
    profile/profile.ts        # ↔ handler/profile
    device/device.ts          # ↔ handler/device
    file/file.ts              # ↔ handler/file
    config/config.ts          # ↔ handler/clientconfig
  im/
    client.ts                 # Goim 单例：init / loginWithToken / logout / updateToken / 事件订阅
    events.ts                 # SDK 事件 → 业务事件（消息、会话、连接、同步）
    message.ts                # 发送、历史拉取、已读与撤回
  services/                  # 按业务域分目录，目录=域、文件=流程
    auth/loginFlow.ts         # 账号登录 → im/token → SDK 登录 → 同步完成
    auth/imToken.ts           # IM token 续期：到期前预取并注入 SDK，失败退避/失效登出
    chat/conversation.ts      # 本地优先会话加载、本地/远端历史、未读、已读上报
    chat/send.ts              # 文本 / 图片 / 文件消息发送与失败重试
    chat/upload.ts            # 上传队列：单文件 / 分片 / ETag 续传 / 403 续签
  stores/
    auth.ts                   # 账号会话 + 登录状态机 + IM 凭证
    chat.ts                   # 会话列表、消息、未读、草稿、当前会话
    contacts.ts               # 资料缓存（自己 / 他人）
    settings.ts               # 设备列表、客户端配置
  router/index.ts
  views/
    login/LoginView.vue        # 按页面域分目录，子页面放在同域目录下
    chat/ChatView.vue          # 例：chat/ChatView.vue、chat/panel/ForwardView.vue
    contacts/ContactsView.vue
    settings/SettingsView.vue
  components/
    layout/                   # AppShell、SideNav、SplitPane
    chat/                     # ConversationList、ConversationItem、MessageList、MessageBubble、Composer、AttachmentPicker
    common/                   # Avatar、EmptyState、Toast、ConfirmDialog、LoadingOverlay
    debug/                    # EventLog（保留，仅开发模式显示）
  utils/                      # 时间格式化、文件大小、mime 判断、图片压缩
```

## 5. API 层规范

### 5.1 命名与定位规则

- **目录 = handler 目录，文件 = handler 文件**，例如 `api/file/file.ts` ↔ `internal/handler/file`
- 每个导出函数对应一个 operationId，函数名用「动作 + 资源」，注释标 HTTP 方法与路径
- 类型命名与 `openapi.yaml` 的 schema 对齐（`AuthResponse`、`ProfileView`、`FilePresignResponse`…）

### 5.2 请求头（与 biz 文档 §1 一致）

| 头部 | 位置 | 说明 |
|---|---|---|
| `X-Device-Id` | axios 实例默认头（注册/登录必填） | 1-64 字符，`getDeviceId()` 生成并持久化；请求体不再携带 `deviceId` |
| `X-Client-Platform` | 实例默认头 | 固定 `web` |
| `X-Client-Version` | 实例默认头 | 可选，缺失按空值；接入构建版本后再填 |
| `Authorization` | 请求拦截器 | `Bearer <accessToken>`，`auth:false` 时跳过 |
| `If-None-Match` | `client-config` 专用 | 命中返回 304（无 body），HTTP 层已放行并回退本地缓存 |

### 5.3 错误码处理

| code | 含义 | 处理 |
|---|---|---|
| 0 | 成功 | `data` 交给调用方 |
| 1001 | 参数错误 | 表单校验提示，不重试 |
| 1002 | 未登录/会话撤销 | 清会话、回 `/login` |
| 1004 | 资源不存在 | 按场景提示或回退 |
| 1005 | 状态冲突（已 ready 再刷新等） | 按成功处理（幂等场景） |
| 2004 | access token 过期 | 刷新后重试一次（现有单飞逻辑） |
| 2005 | refresh 重放 | 清会话、强制重登 |
| 9001 | 服务内部错误 | 提示稍后重试，可上报 |
| 9002 | 依赖不可用 | 指数退避重试，上传场景尤其需要 |

分层约定：`BusinessApiError(code, msg)` 承载业务码；`GoimError(code, msg)` 承载 SDK 码；网络/超时统一成 `code = -1`。

### 5.4 端点清单

| # | 方法 | 路径 | 前端函数 / 文件 | 阶段 |
|---|---|---|---|---|
| 1 | POST | `/account/register` | `account/account.ts#register` | P0 |
| 2 | POST | `/account/login` | `account/account.ts#login` | P0 |
| 3 | POST | `/account/refresh` | `http.ts` 内部 `doRenew` | P0 |
| 4 | POST | `/account/logout` | `account/account.ts#logout` | P0 |
| 5 | GET | `/account/sessions` | `listSessions` | P1 |
| 6 | POST | `/account/sessions/revoke` | `revokeSession` | P1 |
| 7 | PUT | `/account/password` | `changePassword` | P1 |
| 8 | DELETE | `/account` | `deleteAccount` | P2 |
| 9 | POST | `/im/token` | `account/im.ts#imToken` | P0 |
| 10 | GET | `/im/status` | `imStatus` | P0 |
| 11 | POST | `/im/retry` | `imRetry` | P1 |
| 12 | GET | `/profile/me` | `profile/profile.ts#getMyProfile` | P0（头像展示） |
| 13 | PUT | `/profile/me` | `updateMyProfile` | P1 |
| 14 | POST | `/profile/batch` | `batchProfiles` | P0 |
| 15 | GET | `/profile/users/{userId}` | `getPublicProfile` | P1 |
| 16 | GET | `/devices` | `device/device.ts#listDevices` | P1 |
| 17 | DELETE | `/devices/{deviceId}` | `removeDevice` | P1 |
| 18 | GET | `/client-config` | `config/config.ts#getClientConfig` | P2（契约已实现） |
| 19 | GET | `/client-config/schema` | `getClientConfigSchema` | P2（契约已实现） |
| 20 | POST | `/files/presign` | `file/file.ts#presignFile` | P0（avatar 与 ≤8MB 附件） |
| 21 | POST | `/files/multipart/presign` | `presignMultipart` | P0（attachment >8MB） |
| 22 | POST | `/files/{fileId}/multipart/complete` | `completeMultipart` | P0 |
| 23 | POST | `/files/{fileId}/multipart/abort` | `abortMultipart` | P0 |
| 24 | POST | `/files/{fileId}/multipart/parts` | `refreshPartURLs` | P0 |
| 25 | POST | `/files/{fileId}/complete` | `completeFile` | P0（avatar） |
| 26 | GET | `/files/{fileId}/url` | `getFileURL` | P0（附件访问） |
| 27 | DELETE | `/files/{fileId}` | `deleteFile` | P1 |

## 6. IM 适配层（`im/`）

### 6.1 单例与生命周期

- `im/client.ts` 模块级单例，全应用只有一个 wasm 客户端
- 初始化只在应用启动时做一次（`loadGoimSdk` + `Goim`）
- 登录成功后 `loginWithToken(userId, token, expireTimeSeconds, platformId)`，不再走 `login(userId)` 的旧路径
- `logout(clearData=false)` 保留本地 IndexedDB，仅断连并清凭证；切换账号时传 `true`

### 6.2 事件模型

```
SDK 原始事件 ──▶ im/events.ts ──▶ 业务事件 ──▶ stores 订阅
```

| 业务事件 `type` | 触发（SDK 事件） | store 动作 |
|---|---|---|
| `transport` | Connect / Connecting / Reconnect / Disconnect | `auth.transportStatus` |
| `sync` | SyncStart / SyncFinish / SyncFailed | `auth.syncState` |
| `message` | NewMsg | `chat.upsertMessages` |
| `message-sent` | MsgSent | `chat.markSent` |
| `message-revoked` | RevokeMsg / MsgRevoked | `chat.markRevoked` |
| `read` | MarkAsRead | `chat.applyReadReceipt` |
| `conversation` | ConversationUpdate / ConversationCreated | `chat.reloadConversations`（重读本地缓存） |
| `conversations-synced` | ConversationSynced（会话本地缓存已更新） | `chat.reloadConversations`（重读本地缓存） |
| `conversation-deleted` | ConversationDelete | `chat.removeConversation` |
| `session-expired` | ForceLogout | 清会话 + 回登录页 |
| `raw` | 其它未映射事件 | 仅进调试日志 |

### 6.3 登录状态机

```
anonymous ──login──▶ biz-authenticated ──im/token──▶ im-connecting
   ▲                                │                      │
   │                                │                      ▼
   └──────── 1002 / 2005 ───────────┴──────────── im-ready ──▶ synced
```

- `im-ready`：WS 已连接，可发送
- `synced`：会话与消息同步完成，UI 可展示全量数据
- 登录中断（token 失效/IM 未开通）时停留在 `biz-authenticated`，提示重试 `im/retry`

## 7. 状态设计（Pinia）

### 7.1 `stores/auth.ts`

| 字段 | 说明 |
|---|---|
| `stage` | `anonymous / biz-authenticated / im-connecting / im-ready / synced` |
| `session` | `BusinessSession`（含 accessToken/refreshToken/过期时间） |
| `me` | `ProfileView`（昵称、`avatarUrl`） |
| `userId` / `loginName` | 来自登录响应 |
| `transportStatus` / `syncState` | 来自 IM 事件 |
| `imError` | IM 开通/登录失败原因（`9002` 等） |

actions：`login`、`register`、`logout`、`bootstrap`（刷新页面后恢复会话）、`refreshIM`。

### 7.2 `stores/chat.ts`

| 字段 | 说明 |
|---|---|
| `conversations` | `Conversation[]`，按最后消息时间倒序 |
| `activeConversationID` | 当前会话（路由参数同步） |
| `messagesByConversation` | `Record<conversationID, MsgData[]>`，按 seq 升序 |
| `unread` | 未读数：`local.unreadCount(conversationID)`（SDK Local 门面）本地推导（不发网络请求），口径为缓存中 `seq > hasReadSeq` 且未撤回的条数；`local.unreadTotal()` 为全部会话总和 |
| `drafts` | 会话草稿，持久化 localStorage |
| `sending` | 进行中的发送任务（clientMsgID → 状态） |

actions：`loadConversations`、`selectConversation`、`upsertMessage`、`sendText`、`sendAttachment`、`markRead`、`revoke`。

### 7.3 `stores/contacts.ts`

| 字段 | 说明 |
|---|---|
| `profiles` | `userId → PublicProfileView` |
| `groups` | 已加入的群（`getJoinedGroupList`），按群 ID 索引 |
| `loadingIDs` | 正在批量拉取的 userId 集合 |
| `lastFetchAt` | 每批次的 TTL（默认 10 分钟） |

actions：`ensureProfiles(userIds)`（内部按 100 个一批调用 `profile/batch`）、`loadJoinedGroups(page)`、`ensureGroupInfo(groupIDs)`、`invalidate(userId)`。

### 7.4 `stores/settings.ts`

| 字段 | 说明 |
|---|---|
| `devices` | `DeviceView[]` |
| `clientConfig` | 配置对象 + `etag` |
| `debugPanelVisible` | 开发模式日志面板开关 |

## 8. 关键流程

### 8.1 登录

```
LoginView submit
  └─▶ account.login（X-Device-Id 头）
        └─▶ 保存 BusinessSession
              └─▶ im.imToken()
                    └─▶ im/client loginWithToken
                          └─▶ 等待 im-ready + synced
                                └─▶ chat.loadConversations → router /chat
```

失败分支：`9002` → 展示「IM 服务暂不可用，可重试」并保留业务登录态；`1002/2005` → 清会话回登录页。

### 8.2 发送文本

1. 生成 `clientMsgID`，插入乐观消息（`status=Sending`，`sendTime=now`）
2. `im/message.sendText` 调用 SDK
3. 回包补 `serverMsgID/seq`，状态改 `Success`
4. 失败：状态 `Failed`，消息气泡显示「重试」，重试复用原 `clientMsgID`（避免服务端重复）

### 8.3 发送图片 / 文件

1. 本地校验大小与 MIME（附件 ≤200MB，图片可先压缩）
2. `services/upload` 建任务，按大小分流：
   - **≤8MB**（含头像）：`POST /files/presign`（`purpose=avatar` 或 `attachment`）→ 按 `uploadUrl/headers` 单文件 PUT → `POST /files/{fileId}/complete`
   - **>8MB**（仅附件）：走 §8.4 分片流程
3. 上传成功后拿到 `fileId/objectKey/mime/size`，塞进消息 `content` 的 JSON
4. 发送消息（同 8.2）
5. 对方收到消息后按 `fileId` 调 `/files/{fileId}/url` 换 15 分钟预签名 URL 下载/预览

### 8.4 分片上传（attachment，>8MB）

```
multipart/presign → parts[]（并发 3-4 片 PUT，记 ETag）
   ├─ 403/签名过期 → multipart/parts 刷新失败分片（切勿重新 presign）
   ├─ 全部完成 → multipart/complete（幂等，可重试）
   └─ 用户取消 → multipart/abort（或 DELETE /files/{fileId}）
```

- 每片最多重试 3 次，1s/2s/4s 退避；仅网络错误、5xx、签名过期 403 重试
- `fileId/uploadId/已传分片 ETag/expiresAt` 持久化到 localStorage，刷新页面可续传
- pending 记录 24 小时失效（`1004`）→ 重新申请

### 8.5 token 刷新

`http.ts` 已有单飞刷新：命中 `1002/2004` → `POST /account/refresh` → 重试一次；失败清会话。
上传实例不挂自动刷新重试，改为在上传开始前确保 token 有效，避免大文件重传。

### 8.6 断线重连

由 SDK 负责（已实现连续失败 5 次后放弃）。前端页面需提供手动「重连」入口：
`im.retry()` → `GET /im/status` → 必要时 `POST /im/retry` → 重新 `connect`。

## 9. 路由与页面

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | LoginView | 登录 / 注册切换；已登录自动跳 `/chat` |
| `/chat` | ChatView | 无选中会话时显示空状态 |
| `/chat/:conversationID` | ChatView | 三栏布局，右栏按会话 ID 定位 |
| `/contacts` | ContactsView | 「联系人 / 群」两个 tab，点击跳会话；群详情复用会话右栏 |
| `/settings` | SettingsView | 资料、设备、密码、注销（P1/P2） |
| `/settings/devices` | 子路由 | 设备管理与踢出 |

路由守卫：无 `BusinessSession` → 重定向 `/login`；有会话但 `stage < im-ready` → 展示连接中遮罩。

## 10. UI 规范

- **三栏骨架**：左侧导航（会话/联系人/设置） + 会话列表（320px） + 聊天区（自适应）
- **响应式**：< 900px 时导航折叠为图标栏；< 700px 单栏切换（列表 ↔ 聊天）
- 组件清单：`Avatar`（头像+默认占位）、`MessageList`（虚拟滚动，按会话懒加载历史）、`MessageBubble`（文本/图片/文件三种形态 + 发送状态）、`Composer`（输入 + 附件 + 发送快捷键 Enter/Ctrl+Enter）、`UploadProgress`
- 深色模式：Tailwind `dark:` 变量，配置项留在 P2 由 `client-config` 决定

## 11. 本地持久化策略

| 数据 | 存储 | 说明 |
|---|---|---|
| 业务会话（token） | localStorage | `goim_biz_session` |
| 设备 ID | localStorage | `goim_biz_device_id` |
| 草稿 | localStorage | 按 conversationID |
| 会话/消息 | wasm IndexedDB | 由 SDK 读写，前端只经 SDK API |
| 上传任务（断点） | localStorage | `goim_upload_tasks`，完成后清理 |
| 资料缓存 | 内存（Pinia） | TTL 10 分钟，刷新页面重建 |

## 12. 错误与可观测性

- 统一 Toast：业务错误展示 `msg`，网络/超时展示统一文案
- 日志分级：`api`（请求路径/耗时/错误码）、`im`（SDK 事件）、`ui`（关键交互）
- 保留 `EventLog` 调试面板，仅 `import.meta.env.DEV` 或 `client-config.debug` 开启
- 关键埋点（可选）：登录成功率、消息发送成功率、上传成功率与耗时

## 13. 分期任务清单

### P0 核心聊天

- [x] 修正 `X-Device-Id` 放请求头，注册/登录请求体移除 `deviceId`
- [x] API 补全 `profile`（me/batch）、`file` 契约
- [x] `im/` 适配层：单例、事件映射、`loginWithToken`
- [x] `stores/auth` + `services/auth/loginFlow`：登录状态机
- [x] `stores/chat` + `services/chat/send`：会话、消息收发、乐观合并、已读
- [x] 历史消息分页：`messages.pullBySeq`（seq 区间 + `num` + `order`）向前/向后加载
- [ ] `services/chat/upload`：单文件 PUT + 分片 + 续签 + 断点
- [x] 视图：LoginView、ChatView（三栏）、ContactsView 骨架
- [x] 断线重连与手动重连入口

### P1 完整账号与资料

- [ ] `/account/sessions`、revoke、password、`/devices`
- [ ] 资料编辑与头像上传（`purpose=avatar`）
- [ ] `profile/users/{userId}` 详情、`im/retry`
- [ ] 草稿、会话置顶

### P2 增强

- [ ] `client-config` + schema（契约已实现，待接入 settings store 与 UI）
- [ ] 账号注销（`DELETE /account`）
- [ ] 群聊管理：`getJoinedGroupList` 群列表、`getGroupMembersInfo` / `getGroupMemberList` 成员、建群与邀请/踢人、禁言、转让/退群/解散、入群申请处理
- [ ] 消息搜索、撤回 UI

## 14. 待确认与风险

当前无待确认项。

已确认的规则（不再列为风险）：

- 头像与 ≤8MB 附件统一走 `POST /files/presign` 单文件 PUT（`purpose` 分别 `avatar` / `attachment`）；附件 >8MB 走分片，上限 200MB、8MB/片、最多 100 片
- 对象存储 CORS 已配置，允许浏览器直接 PUT 预签名 URL
- 群聊能力由 SDK 提供（`GroupMgr`）：建群、群资料、入群申请、成员列表/邀请/踢人/禁言、转让与解散
- 本地数据统一走 SDK `Local` 门面（只读缓存、owner 由 core 按登录用户解析）：会话 `local.listConversations`（置顶优先 + 时间内倒序、分页）、消息 `local.listMsgs`（seq 游标分页）、未读 `local.unreadCount/unreadTotal`；本地清理用 `local.purgeMsgs` / `local.clearLocalData`（仅本机，不影响服务端）
- IM token 续期：wasm 无同步回调，采用预取模式——到期前（最多提前 5 分钟、短 TTL 按剩余 20%）调用 `/im/token` 后 `updateToken` 注入，core 在认证失败时消费；后台标签页定时器被节流，故 `visibilitychange` / `online` / 重连前补检。可重试错误按 30s→5min 退避，凭证失效（1002/2004）直接走被动下线流程
- 本地未读：`local.unreadCount(conversationID)` / `local.unreadTotal()` 不发起网络请求；`hasReadSeq` 取本地已读消息最大 seq，未读数 = 缓存中 `seq > hasReadSeq` 且未撤回的条数。缓存不完整时结果为下界，跨端一致性依赖 2200 已读回执；需要服务端精确值时用 `ConvMgr.GetSortedConversationList`（返回 `unreadTotal` / `unreadCount`），该方法的 js 封装在 P1 补
- 历史分页：sdk-core 已实现分页拉取；js 侧用 `messages.pullBySeq(conversationID, begin, end, num, order)` 按 seq 区间拉取，向前加载取 `order=1`
- 注册/登录请求体不含 `deviceId`，设备信息只从 `X-Device-Id` 请求头读取（已实施）
- `client-config` 304：biz CORS 已返回 `Access-Control-Expose-Headers: ETag`；前端只在 `client-config` 单请求放行 304，命中后返回 localStorage 缓存（按 platform 存储，TTL 24h；schema 缓存 7 天；缓存丢失时去掉条件头回退一次 200）

## 15. 开发约定

- 目录边界即依赖边界，新增业务域按 `api/<handler 目录>/` 平行添加
- 所有 API 函数必须有返回值类型，类型名与 openapi schema 同名
- store 不写业务分支逻辑（判断多个接口结果），一律放 `services`
- 提交粒度：一个业务域一个提交，消息格式 `feat(<域>): <说明>`
