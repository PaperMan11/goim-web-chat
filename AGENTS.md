# AGENTS.md

GoIM Web 聊天客户端。详细架构、目录树与开发规划见 `docs/ARCHITECTURE.md`（单一事实源）；此处只列必须遵守的硬约束。

## 分层与依赖

1. 依赖方向：`views/components → stores → services → api/im`，禁止反向引用。
2. `stores` 不得直接 `fetch` / `axios` / import `im/`；网络与 SDK 调用一律经 `services` 或 `api`。
3. `views` / `components` 只读 store、调 store action，不得 import `api/` 或 `im/`。
4. `im/` 不得 import `api/`。

## 目录与命名

5. `src/api/<域>/<handler>.ts` 必须与 goim-business `internal/handler/<域>/<handler>.go` 对齐（目录=handler 目录，文件=handler 文件）。
6. `src/services/<域>/<流程>.ts`；`src/views/<域>/<View>.vue`，子页面放在同域目录下。
7. 跨目录引用使用 `@/`（指向 `src/`），同目录内部使用 `./`。

## 消息与协议

8. 消息 `content` 是 JSON 字符串，展示前必须经 `@/utils/message`（`messageText` / `messagePreview` / `mergeMessages`），禁止直接渲染 `msg.content`。
9. SDK 事件必须在登录之前订阅（`initIM → bindIMEvents → loginIM`），状态由事件驱动，不用快照回填。
10. 协议类型与枚举以 `goim/docs/protocol-message.md` 为准；后端契约变更时修正 SDK 侧契约，不要在前端做兼容兜底。

## 生成物与验证

11. `public/wasm/`、`goim-sdk-js/wasm/` 是构建生成物，不手改；更新流程为 sdk-js `npm run build:wasm` → 本项目 `npm run copy:wasm`。
12. 前端提交前必须通过 `npm run typecheck` 与 `npm run build`。
13. 涉及 Go 侧（`goim-sdk-core`、`goim-business` 等仓库）的改动，提交前必须依次通过 `gofmt -w`、`go build ./...`、`go vet ./...`、`go test ./... -count=1`。
14. 先保证代码与测试通过，再更新文档与注释；不要先写文档再改代码。

## 提交规范

15. 除非用户明确要求提交，否则不要执行 `git commit` / `git push`。
16. 提交信息使用 Conventional Commits 前缀 + 中文说明：`feat:` 新功能、`fix:` 修复、`docs:` 文档、`refactor:` 重构、`chore:` 构建/配置/依赖。格式：`<scope>: <中文简述>`。
17. 每次提交只解决一个主题；若有不相关的改动，拆开或暂存。
