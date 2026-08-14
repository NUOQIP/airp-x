# Airp X

Airp X 是一个本地、单用户、桌面端优先的 AIRP WebApp。故事只通过拟真的 X 平台界面呈现，评论、评论回复、私信和可发言群聊会开启 AI 回合；点赞、转帖、收藏、关注和投票先作为本地动作保存，并进入下一次 AI 上下文。

## 启动

双击 `start-airp.cmd`。首次启动会安装依赖、创建 SQLite 数据库、导入已提供的两张角色卡和全局规则，然后在浏览器打开：

`http://127.0.0.1:4317`

要求 Node.js 22 或更高版本。关闭运行窗口即可停止应用。

开发模式使用：

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

开发页面为 `http://127.0.0.1:4318`，本地 API 为 `http://127.0.0.1:4317`。

## 首次配置

1. 打开“配置 → 模型”。
2. 填写 OpenAI 兼容 Base URL、API Key 和模型名称。
3. 点击“结构化输出测试”。OpenAI 兼容服务默认使用 `response_format: json_schema`；DeepSeek 官方接口自动使用 `json_object`，输出仍须通过本地 Zod Schema 才能写入剧情。
4. 打开“配置 → 主页建设”，粘贴自然语言主页并生成结构化预览；确认后再应用到当前空白会话。
5. 在角色卡、提示词、世界书、规则、宏/正则页面检查已导入内容。

首次安装与每个新建会话都使用空白主页。主页建设只整理账号资料、统计数字、栏目和 MVU 初始状态，不会推进剧情，也不会自动创建帖文、评论或私信。已有剧情回合的分支不能覆盖主页，需要新建空白会话后再建设。

API Key 采用 SAFE1：只保存在项目根目录的本机 `.env` 文件，不进入 SQLite 数据库，也不会进入手动备份。

## AI 调用日志

- 服务端会像 SillyTavern 的 DEBUG 日志一样，在终端输出每次模型调用的开始、结束、耗时、token 用量和结果摘要。
- 完整的实际请求、供应商原始响应、`reasoning_content`、最终 `content` 以及 JSON/Schema 错误按日写入 `data/logs/ai-YYYY-MM-DD.jsonl`；同一次调用用 `callId` 关联。
- API Key、Bearer 凭据、敏感 URL 参数和 Data URL 会在落盘前脱敏。日志写入失败不会中断剧情生成。
- 日志包含完整提示词和角色扮演内容，仅用于本机排错；分享日志文件前仍应自行检查隐私内容。

## 数据与回合安全

- SQLite 数据库：`data/airp.db`
- 玩家输入会在 AI 请求前保存；AI 失败不会删除玩家输入。
- AI 输出必须先通过固定 Zod/JSON Schema、玩法约束和引用一致性检查，之后才在一个事务中提交。
- 重新生成会增加候选结果；编辑旧玩家输入会创建独立分支。
- 多个故事会话彼此独立，可在“配置 → 会话”中切换；每个新会话都有自己的主页与主线分支。
- 每个分支拥有独立的平台快照、MVU、滚动记忆和候选检查点。
- “配置 → 数据”可导出或恢复完整项目 JSON；恢复不会包含或覆盖 API Key。

## 项目结构

- `apps/web`：React、Vite、TypeScript、Tailwind、Radix UI、Zustand、TanStack Query
- `apps/server`：Fastify、TypeScript、SQLite、Drizzle ORM
- `packages/shared`：前后端共用的固定事件 Schema、MVU 和 API 类型
- `apps/server/drizzle`：版本化数据库迁移

这是独立项目；SillyTavern 仅用于机制参考，不存在兼容层或运行时依赖。
