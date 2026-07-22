# Spark Canvas 独立化源码依赖切片

> 审计快照: 2026-07-16 | 基线提交: `6cfbfcd` | 2026-07-17 已确认共享 Spark 云、全新本地数据、方案 1 应用身份及复用原生产签名身份

## 1. 范围与方法

本附录把《Spark Canvas 独立化架构与功能审计》继续下钻到源码依赖层，回答五个执行问题：

1. 画布工作区当前实际调用哪些 IPC。
2. 哪些跨目录导入会阻止删除旧 Chat / Agent UI。
3. 独立画布最小需要哪些表和服务。
4. 主进程哪些启动步骤可以删除，删除前要先解开什么耦合。
5. 哪些 npm / 原生依赖可随旧平台域移除。

核对方法：

- 用 TypeScript Compiler API 遍历非测试 Canvas 源文件中的调用表达式和 import。
- 直接阅读主进程、preload、协议、Repository、migration 和包清单。
- 用 `rg` 复核动态 import、服务构造和外部域名。
- GitNexus 当前索引不对应本仓库，按项目降级规则未使用其结果。

本文件是当前源码的审计快照，不批准立即删除业务代码。

项目目录/SQLite/Renderer 权威、空库 seed 和项目包 v3 的已冻结目标契约见[数据权威、空库启动与项目包审计](./2026-07-17-canvas-data-authority-bootstrap.md)。

T-005 至 T-008 的正式权限、凭据、lazy runtime 和安装器契约见[运行时、凭据与 FFmpeg 边界审计](./2026-07-17-canvas-runtime-security-boundary.md)。

T-013 的 BYOK/托管路由隔离、Auth/NewAPI 状态、上传生命周期、支付幂等和用量语义见[共享 Spark 云、计费与上传契约审计](./2026-07-17-canvas-shared-spark-cloud-contract.md)。

## 2. 结论摘要

1. `packages/protocol` 当前定义 **336 个 request/response 通道和 38 个 stream 通道**；主进程也注册了 336 个 handler。
2. Canvas 目录和 `CanvasWindowApp` 直接引用 **60 个 IPC/stream 通道**，其中建议划为：
   - 43 个画布工作区核心通道。
   - 1 个共享 Spark 上传通道，已确认为第一版保留。
   - 16 个 Canvas Agent / Agent 人设与 Skill 增强通道，已确认为第一版保留。
3. `CanvasWindowApp` 还包着 `AuthProvider` 和 `SessionSidebarProvider`。前者已批准用于共享 Spark 账户但不能阻塞 BYOK；后者即使用户不打开 Canvas Agent，也会启动无关 Session、Workspace、Agent 和 Terminal 查询/订阅。
4. preload 只用 TypeScript 类型限制通道，运行时没有 allowlist；当前 Canvas renderer 理论上可以调用已注册的全部平台 IPC。
5. Canvas 基础数据路径有 8 张候选表；第一版新 schema 还必须覆盖当前 Canvas Agent 至少 24 种直接 Repository 闭包，以及混合模型的 profile/usage 数据，但不升级旧 `spark.db`。
6. FFmpeg Runner 可以独立保留，但 `ffmpeg:install` 当前复用了 `SkillRegistryService` 的 manifest、下载、SHA256 和解压能力。删除 Skill Store 前必须先迁出该安装链。
7. 文本生成本体只需要 Provider + `generateCanvasText`；Agent 人设和 Skill prompt 是可拆的附加层，不需要保留整套 Session 平台。
8. 目标身份已冻结为 `Spark Canvas`、`com.spark.canvas.desktop` 和 `spark-canvas` scheme；Cloud Auth / Provider vault 分别使用 `SparkCanvas.CloudAuth` / `spark-canvas`，不读取旧凭据。
9. `agent-runtime` 的真实生产闭包是 121 个文件，不是 112 个；遗漏的 9 个 `.mjs` MCP server 会被当前构建插件无条件复制。
10. 运行时内置媒体目录是 101 个 manifest；24 个媒体 preset 的 99 条显式引用中有 2 条错 ID，结构校验之外还有 2 个语义问题。
11. 构建动态生成 14 个、41,088,016 字节的 file-viewer WASM/worker；两个仓库原生测试 prebuild 又都只适用 Darwin arm64，二者都不在原生产源码计数中。

## 3. IPC 切片

### 3.1 当前总面

| 层                       | 当前数量 | 证据                                                                           |
| ------------------------ | -------: | ------------------------------------------------------------------------------ |
| `IpcChannelMap`          |      336 | `packages/protocol/src/ipc/index.ts:5120`                                      |
| `IpcStreamChannelMap`    |       38 | `packages/protocol/src/ipc/index.ts:5712`                                      |
| 主 IPC 单文件 handler    |      290 | `apps/desktop/src/main/ipc/index.ts`                                           |
| Auth handler             |       22 | `apps/desktop/src/main/services/Auth/registerAuthIpc.ts`                       |
| Terminal handler         |        8 | `apps/desktop/src/main/ipc/registerTerminalIpc.ts`                             |
| Platform Model handler   |       11 | `apps/desktop/src/main/services/PlatformModel/registerPlatformModelIpc.ts`     |
| GitHub Connector handler |        5 | `apps/desktop/src/main/services/GitHubConnector/registerGitHubConnectorIpc.ts` |

`registerAllIpcHandlers()` 还会启动 Remote runtime，并探测/补种本地 Claude/Codex CLI Provider。因此它不只是“注册函数”，不能原样作为独立画布入口。

### 3.2 画布工作区核心通道（43 个）

以下是保持当前画布项目、编辑、AI 生成和视频工作台行为时需要保留的直接通道。

**窗口壳（4）**

- `canvas:window:open`
- `canvas:window:close-confirmed`
- `stream:canvas-window:close-request`
- `window:maximize`

如果未来 Canvas 直接成为唯一主窗口，前三个“第二窗口”通道可进一步改写，但第一阶段应保留行为再调整窗口模型。

**项目、快照与资产（14）**

- `canvas:project:cleanup-orphans`
- `canvas:project:default-root`
- `canvas:project:delete`
- `canvas:project:ensure-directory`
- `canvas:project:export-package`
- `canvas:project:list`
- `canvas:project:migrate-assets`
- `canvas:project:update-cover`
- `canvas:snapshot:load`
- `canvas:snapshot:save`
- `canvas:asset:copy-to-project`
- `canvas:asset:download`
- `canvas:asset:download-batch`
- `canvas:asset:write-data-url`

**Provider、文本与媒体任务（11）**

- `provider:list`
- `canvas:media-capabilities:list`
- `canvas:media-models:describe`
- `canvas:media-models:list`
- `canvas:media:prune-model-params`
- `canvas:media:prune-model-params-by-inline-manifest`
- `canvas:task:cancel-media`
- `canvas:task:create-media`
- `canvas:task:generate-text`
- `stream:canvas:media-task`
- `stream:canvas:text-task`

`provider:list` 当前会顺手补种本地 Claude/Codex CLI Provider。Canvas Agent 已确认首版保留，因此本地 Provider 仍需可用，但应把补种从通用列表查询副作用迁到 Canvas Agent 的显式初始化或首次配置流程。

**文件与系统对话框（7）**

- `dialog:open-directory`
- `dialog:open-file`
- `dialog:save-file`
- `file:read-text`
- `file:save-pasted-image`
- `file:write-text`
- `tool:open-folder`

**FFmpeg 与视频（7）**

- `ffmpeg:install`
- `ffmpeg:status`
- `video:probe`
- `video:process`
- `stream:ffmpeg:install-progress`
- `stream:ffmpeg:status`
- `stream:video:process-progress`

画布壳中的外观持久化还使用 `settings:get` / `settings:set`。因此当前工作区壳的目标运行时 allowlist 是上面 43 个通道再加这 2 个设置通道，共 **45 个**。Provider 管理、更新、日志等精简设置页通道应作为单独设置域注册，不应重新放开全部平台协议。

### 3.3 已批准的共享 Spark 上传通道（1 个）

- `auth:upload-file`

它为要求公网 URL 的模型输入服务，调用共享 Spark `EduServerClient`。负责人已确认继续共用同一上传空间，因此该通道进入第一版 allowlist；但它只能由 manifest 明确要求公网 URL、用户已登录且任务选择 Spark 上传时调用。Provider 自带上传和 data URL/base64 是 BYOK 默认路径，未登录或 Spark 故障时不得先请求该通道。当前实现丢弃 `fileKey`、只处理图片并按 provider kind 硬编码传输，需按 T-013 替换。

### 3.4 Canvas Agent 与增强项通道（16 个直接，至少 20 个实际增量）

**Agent / Skill 选择（2）**

- `agent:list`
- `skill:list`

这两个通道不只出现在 `CanvasAgentModal`，还被文本操作面板和预设面板用于 Agent 人设、Skill prompt 增强。Canvas Agent 已确认首版保留，因此两者进入产品 allowlist；普通文本生成仍应保留不传 `agentId`/`skillIds` 的 Provider 直连路径。

**Canvas 工具桥（5）**

- `canvas:host-attach`
- `canvas:host-detach`
- `canvas:tool-ack`
- `canvas:tool-result`
- `stream:canvas:tool-call`

**Session / Workspace（9）**

- `workspace:open`
- `session:create`
- `session:list`
- `session:submit-turn`
- `session:update`
- `skill-config:update`
- `stream:session:agent-event`
- `stream:session:created`
- `stream:session:renamed`

以上 16 个是 Canvas 目录内的直接调用。`CanvasAgentModal` 引入的共享 `ChatPanel` 位于 Canvas 目录外，它还间接增加 4 个非核心通道：`file:stat-kind`、`session:answer-question`、`session:cancel`、`session:get-history`。因此保留当前 Canvas Agent 的实际增量至少是 **20 个通道**，并会复用核心文件对话框通道。

结论：Canvas Agent 不是一个可独立留下的弹窗。保留当前实现等于保留 Session、Workspace、Agent、Skill、MCP、权限、Claude/Codex 执行器和聊天渲染的大部分闭包。

目标边界不再批准通用 `workspace:open`：Renderer 只提交 `projectId`，主进程从 Canvas Repository 解析 canonical project root 并建立项目、Workspace、Session 和 sender 的绑定。现有通道计数保留为审计基线，实施时以新的 `canvas:agent:*` façade 或等价主进程入口替换任意路径能力。

### 3.5 当前窗口壳的间接 IPC

`CanvasWindowApp.tsx:52-61` 当前挂载三个全局 Provider：

| Provider                 | 当前行为                                                                                         | 独立化处置                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `AppProvider`            | 启动读取 `settings:get`；外观变化写 `settings:set`；同时提供画布离开守卫和确认框                 | 精简保留或抽成 Canvas 壳               |
| `AuthProvider`           | 声明 15 个 Auth 通道；挂载即调用 `auth:bootstrap`、`auth:client-config` 并订阅 2 个 Auth stream  | 保留共享 Spark 登录；失败不得阻塞 BYOK |
| `SessionSidebarProvider` | 声明 27 个通道；挂载即查询 Workspace、Session、Provider、Agent、Terminal，并订阅 8 个平台 stream | 从 Canvas 窗口移除                     |

`SessionSidebarProvider` 的启动查询位于 `SessionSidebarContext.tsx:441-485`。它是“打开画布也初始化旧平台”的直接原因，不是 Canvas Agent 弹窗本身的必需 Provider。

### 3.6 Preload 边界

`apps/desktop/src/preload/index.ts:116-136` 把泛型 `invoke(channel)` 和 `on(channel)` 直接转发给 `ipcRenderer`。泛型只在编译期有效，运行时没有检查 channel 是否属于 Canvas allowlist。

删除门槛：

1. 先建立 Canvas 主窗口可调用的运行时 request/stream allowlist。
2. 精简设置页若需要更多通道，显式加入同一产品 allowlist。
3. 主进程按 sender 角色和项目/Session 归属再次授权，不能把 preload 当成唯一安全边界。
4. Session、权限、媒体和安装 stream 定向发送给授权窗口，不再全窗口广播。
5. 主进程只注册保留域 handler。
6. 增加测试：未知通道、Terminal/Git/通用 Workspace 通道从 Canvas renderer 调用时必须被拒绝。

## 4. Renderer 跨域依赖

TypeScript AST 共发现 Canvas 非测试源码有 **68 个相对跨目录 import，指向 12 个唯一目标**。大部分重复来自共享 `Icons`，真正阻塞删除的依赖如下。

从三个 Renderer 产品入口做静态可达性遍历，173 个 Canvas 生产模块中有 158 个可达、15 个不可达。13 个没有任何生产入边，另外 `canvasPipelineProgress.ts` 和 `canvasWorkspacePlacement.ts` 只被不可达模块引用。T-009 已逐个冻结处置；它们包含旧实现、重复抽取、尚未接线的 Board/Production 能力和一个现有连线语义修复，不能作为同一个死代码批次。详见[不可达模块逐文件处置审计](./2026-07-17-canvas-unreachable-module-disposition.md)。

| 依赖                                       | 使用方                                               | 处置                                                           |
| ------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------- |
| `design/views/chat/ChatMarkdown`           | `CanvasNode.tsx`、`CanvasOperationOutputPreview.tsx` | 提取为产品级 Markdown 展示组件，或保留为无 Chat 语义的共享组件 |
| `design/components/ChatPanel`              | `CanvasAgentModal.tsx`                               | 第一版保留                                                     |
| `AvatarImage`、`SkillsPickerModal`、avatar | `CanvasAgentModal.tsx`                               | 第一版保留                                                     |
| `design/utils/provider-adapter`            | Canvas Agent 模型选择                                | 第一版保留并按当前调用精简                                     |
| `design/components/ProviderLogo`           | `CanvasModelPicker.tsx`、`CanvasAgentModal.tsx`      | 媒体模型选择仍需，移到中性共享组件即可                         |
| `design/AppContext`                        | `CanvasWorkspaceView.tsx`                            | 画布需要离开守卫、确认框和外观；缩成 Canvas AppContext         |
| `design/SidebarExpandButton`               | `CanvasWorkspaceView.tsx`                            | 主导航改为单产品后删除或替换                                   |
| `design/Icons`                             | 54 处 Canvas import                                  | 保留共享图标，不构成旧平台业务依赖                             |
| `renderer/assets/stage3d-actors/*`         | 3D 导演台                                            | 二期源码保护；未通过 T-012，不进入首版安装包                   |

`ChatPanel` 又从 `ChatView.tsx` 导入 `MarkdownText`，并依赖 Chat 事件映射、运行状态卡和取消提示。也就是说当前 Canvas Agent 不只依赖一个可复用聊天组件，还反向挂住了超大 `ChatView` 模块。第一版保留这些行为；删除旧 Chat 页面前，必须先把 Markdown 与当前 Agent 所需消息渲染迁到中性组件并通过回归。

此外，14 个 Canvas 文件调用 `normalizeEduAssetUrl`。该函数把 `yiqibyte` 域名和相对上传路径规范化到 `https://www.yiqibyte.com/edu-prod`。这些域名仍是共享 Spark 上传空间的正常契约；可以收敛为中性命名的统一解析模块，但不能按旧项目迁移层限期删除。

## 5. 数据库与服务闭包

### 5.1 独立画布核心 schema 候选

| 表                       | 用途                                      | 当前直接服务                                |
| ------------------------ | ----------------------------------------- | ------------------------------------------- |
| `schema_migrations`      | schema 版本                               | `SparkDatabase`                             |
| `app_settings`           | 画布根目录、外观、Provider/更新设置       | `SettingsService`                           |
| `provider_profiles`      | 文本/图片/音频/视频 Provider 配置         | `ProviderService`                           |
| `canvas_projects`        | 项目元数据                                | `CanvasProjectRepository`                   |
| `canvas_snapshots`       | 完整画布 JSON 快照                        | `CanvasSnapshotRepository`                  |
| `media_generation_tasks` | 媒体任务生命周期、请求和产物              | `MediaTaskRuntimeService`                   |
| `media_model_manifests`  | 媒体模型能力清单                          | `MediaModelCatalogService`                  |
| `media_provider_models`  | 历史 Provider 与 manifest 启用关系 schema | `MediaModelManifestRepository.ensureSchema` |

Provider API Key 不在 SQLite，当前通过 `keystore_ref` 存到系统 Keychain。新应用使用 `spark-canvas` Provider vault service，不读取旧 `spark-agent` 条目。前 7 张表属于当前直接数据路径；`media_provider_models` 会被 Repository 建立，但生产调用点只存在于该 Repository 内，当前模型启用关系主要来自 `provider_profiles.config_json`。它应作为 schema 收缩候选，而不是无条件保留。

`model_profiles`、`usage_ledger` 和 `media_artifacts` 不在基础 Canvas 文本/媒体主路径的直接必需集合中；混合模式已确认保留前两者，`media_artifacts` 仍按实际运行调用决定。

### 5.2 当前项目数据还有三处落点

- 渲染端内存/本地缓存：编辑即时状态。
- 项目目录：`snapshots/latest.json` 与 `assets/*`。
- SQLite：`canvas_projects` 与 `canvas_snapshots`。

当前加载逻辑优先项目目录快照，SQLite 作为兼容回退；旧注释仍把 SQLite 描述为生产权威。保存时目录失败又会被吞掉并继续写 SQLite，所以旧 `latest.json` 可以遮蔽更新后的 SQLite。

目标已经冻结：项目目录是已保存内容的权威源，SQLite 是同 revision 的索引/查询缓存/恢复镜像，Renderer 内存/localStorage 只作当前编辑草稿。保存使用临时文件、flush/校验、同卷原子 rename 和 SQLite transaction；两层完成前不清 dirty。新数据库固定为 `spark-canvas.db`，默认项目根为 `projects/`，完整迁移使用 v3 目录项目包。

### 5.3 Canvas Agent 当前闭包

`SessionService` 直接引用至少 24 种 Repository：

`Event`、`ProviderProfile`、`Rules`、`Session`、`Workspace`、`McpServer`、`Settings`、`Skill`、`ContextPreference`、`Agent`、`Workflow`、`WorkflowRun`、`TeamDispatch`、`TeamDiscussion`、`TeamDefinition`、`MediaModelManifest`、`UsageLedger`、`Goal`、`ConnectorConnection`、`TurnRequest`、`Memory`、`MemorySearch`、`ModelProfile`、`MemoryEntity`。

主进程还为它接入 Permission、MCP OAuth、Canvas MCP、Browser MCP、Remote reply 和 Claude/Codex SDK。技术审计原本推荐二期不挂载或重做轻量助手，但负责人已选择第一版保留当前实现。因此首版接受 `SessionService`、至少 24 种 Repository、ChatPanel、MCP 与 Claude/Codex SDK/CLI 的现有闭包，并把它们列入删除保护范围。

该决策不批准直接裁剪超过一万行且职责交织的 `SessionService`。可以逐项移除明确无调用的 Browser MCP、Remote、代码工作台等分支，但每项都必须先完成调用点核对和 Canvas Agent 全旅程回归；轻量助手重写放到第一版之后另行决策。

### 5.4 两条隐藏服务耦合

**文本生成增强**

`canvas:task:generate-text` 的基础路径是 `ProviderService -> Keychain -> generateCanvasText`。只有传入 `agentId` / `skillIds` 时才访问 `AgentRepository` 和 `SkillService`。当前 Canvas Agent/Skill 已确认保留；全新数据库必须种入可用默认记录，同时保留不传这些字段的 Provider 直连路径。

**FFmpeg 安装**

`ffmpeg:status`、`video:probe`、`video:process` 不依赖 Skill Store；`ffmpeg:install` 在 `main/ipc/index.ts:7381-7448` 依赖 `SkillRegistryService`：

- 读取 Spark artifact manifest。
- 按平台和架构选择 FFmpeg。
- 下载、SHA256 校验和解压。
- 落盘到 `{userData}/bin`。

删除 Skill Registry 前，必须把这段能力迁到专用 `BinaryArtifactInstaller` 或改为随应用打包 FFmpeg，并替换旧 `minio.yiqibyte.com` 安装源。

**Provider 凭据初始化**

macOS 上 Provider API Key 使用的集中加密 vault 由 `Auth/registerAuthIpc.ts` 调用 `createCredentialVaultPersistence()` 才完成注入。混合模式中的 BYOK 仍需要这条凭据持久化链，因此即使 Auth 域保留，也必须把 vault 初始化移到应用核心启动或 Provider IPC 注册器，避免共享云故障阻塞 BYOK。新应用使用 `spark-canvas` Provider vault service，用户重新配置 BYOK，不读取旧凭据；Cloud Auth 独立使用 `SparkCanvas.CloudAuth`。

正式契约进一步禁止集中 vault 和单条 ref 的旧 `spark-agent` fallback；`auth:bootstrap` 也不再预读 Connector secret。单个 Provider secret 失败只能影响该 profile，不能阻塞其他 Provider、本地项目或 Cloud Auth。

### 5.5 媒体目录与 MCP 打包闭包

源码和运行时展开后的真实库存如下：

| 范围                     | 数量/结果 | 必须处置                                                              |
| ------------------------ | --------: | --------------------------------------------------------------------- |
| 内置媒体 manifest        |       101 | 101 个唯一 ID；图片 34、视频 62、音频 5，不能再按 42 个顶层表达式计数 |
| manifest 结构校验        |    0 失败 | 保留 `MediaModelManifestSchema` Gate                                  |
| manifest 语义校验        |    2 问题 | 修复 MiniMax speech 的两个未知模板变量，seed 前必须为 0               |
| Provider vendor / preset |   35 / 52 | 其中 24 个 preset 声明媒体能力                                        |
| 显式 `mediaModelRefs`    |        99 | 两条非 `custom:` ref 未命中内置清单，必须修正并禁止静默合成           |
| Agent Runtime 生产文件   |       121 | 109 TS、1 d.mts、2 媒体 helper mjs、9 MCP server mjs                  |

两条错 ref 是 `apimart:gpt-image-1.5-official` 和 `kling:kling-video-3.0`。`resolveProfileMediaModels()` 当前会为任何未命中的 ref 调用 `synthesizeMediaManifestForRef()`，但只有 ID 以 `custom:` 开头时才把结果标为 `synthesized`，因此内置 preset 拼写错误会被静默伪装为正常模型。目标规则是：内置 preset 必须精确命中；只有用户显式创建的 `custom:` ref 可以合成。

101 个内置 manifest 没有 `audio.transcription`。当前 `apimart-audio-whisper` 通过 preset 的 `mediaCapabilities` 和 adapter 提供转写；验收矩阵必须区分“manifest 驱动”和“preset/adapter 兼容路径”，不能把 15 个操作都概括为同一种清单解析。

构建插件 `copyRuntimeToolsPlugin()` 会把 `src/tools/*.mjs` 全部复制到 `out/main/tools`，没有按产品闭包筛选。`media-generation-mcp-server.mjs` 又相对引用 `../services/media/media-extract.mjs`、`media-request-compiler.mjs`，插件没有复制这两个文件，当前 `out/main/services/media` 也不存在。这是确定的打包闭包缺件：源码测试能通过，安装产物启动 `spark_media` 仍会失败。

实施时必须建立 9 个脚本的显式 allowlist，保护 `spark_canvas`、当前媒体/平台/Memory 闭包，逐项移除 Browser/Debug/Web Search 等旧域；每个保留脚本的相对 import、权限、环境变量和打包子进程测试一起验收。

## 6. 主进程启动删除门槛

| 当前启动步骤                               | 目标处置  | 删除/替换门槛                                                                      |
| ------------------------------------------ | --------- | ---------------------------------------------------------------------------------- |
| `registerSafeFileSchemes/Protocol`         | 保留      | 白名单去掉 `workspaces` 查询，只保留 userData、temp、Canvas 项目根                 |
| 单实例、窗口安全参数、菜单                 | 精简保留  | 使用 `spark-canvas` scheme 和 `Spark Canvas` 标题，不注册旧协议                    |
| `initializeShellEnvironment`               | 精简保留  | 系统 FFmpeg 探测仍依赖 GUI 进程 PATH；若只用托管 FFmpeg 才可继续收缩               |
| SQLite + 53 个历史 migration               | 替换      | 使用 `spark-canvas.db` 和新 Canvas migration 链；不发现或升级旧 `spark.db`         |
| Background maintenance worker              | 精简保留  | 当前 Canvas Agent 仍产生 `agent_events` 和 `turn_requests`                         |
| `registerAllIpcHandlers`                   | 替换      | 拆成 Canvas、Canvas Agent、Provider、Auth/Platform Model、Settings、Video 域注册器 |
| Cloud Auth + Platform Model + redeem 深链  | 保留      | 完全共用原 Spark 账户、余额、套餐、订单、支付、额度和上传空间                      |
| Scheduled Task scheduler / no-project 目录 | 移除      | 当前 Agent 核心旅程不需要；删除前核对 SessionService 直接调用                      |
| Session 最近记录 Tray                      | 替换/移除 | 改为项目快捷入口或完全不设 Tray                                                    |
| Playwright 注册、浏览器下载、MCP 自启动    | 移除      | 无浏览器 Agent 功能后整域删除                                                      |
| App Skills 初始化和宿主 Skill 软链         | 替换      | 显式 seed 批准的 4 Skills；禁止自动导入宿主 Claude/Codex Skills                    |
| SDK 完整性检查                             | 保留      | 当前 Canvas Agent 继续使用 Claude/Codex SDK/CLI                                    |
| Shell/Node/npm/git 环境状态推送            | 移除      | FFmpeg 状态改由专用检查承担                                                        |
| FFmpeg 完整性检查                          | 保留      | 更新安装源和文案                                                                   |
| UpdateService                              | 精简保留  | `com.spark.canvas.desktop` 与新仓库、签名和更新源可用                              |
| Session/Terminal/FileWatcher shutdown      | 精简保留  | 保留 SessionService 收尾；Terminal/FileWatcher 分支随对应服务删除                  |

## 7. 包依赖处置

### 7.1 高置信保留

| 依赖                                               | 保留原因                                                 |
| -------------------------------------------------- | -------------------------------------------------------- |
| `better-sqlite3`                                   | Canvas/Provider/媒体任务持久化                           |
| `keytar`                                           | Provider API Key                                         |
| `@napi-rs/canvas`                                  | APIMart 媒体适配器的图片后处理；若最终移除该适配器再复核 |
| `exceljs`、`mammoth`                               | Canvas XLSX/DOCX 文稿输入                                |
| `three`、`@react-three/fiber`、`@react-three/drei` | 二期 3D 源码/数据兼容保护；不是首版默认能力              |
| `@xyflow/react`                                    | 无限画布节点/连线                                        |
| `zod`                                              | IPC 与媒体 manifest 边界校验                             |
| `electron-updater`                                 | 若继续提供桌面自动更新                                   |

### 7.2 第一版 Canvas Agent 闭包保留

| 依赖                                      | 保留原因                                                             |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `@openai/codex-sdk`                       | 当前 Codex Agent executor                                            |
| `@anthropic-ai/claude-agent-sdk` 及平台包 | 当前 Claude Agent executor                                           |
| `@anthropic-ai/sdk`                       | 当前 Agent SDK 类型闭包                                              |
| `@modelcontextprotocol/sdk`               | Canvas MCP 与当前 executor transport                                 |
| `sqlite-vec`、`openai`                    | 当前 SessionService/Memory/Embedding 闭包                            |
| `diff`、`npm`                             | 当前 Agent SDK/CLI 执行和完整性工具；回归证明无调用后再清理          |
| `@file-viewer/*`、`pdfjs-dist`            | ChatPanel/Markdown 闭包；保留时连同 14 个生成 WASM/worker 进入 T-012 |

### 7.3 随旧平台域条件移除

| 依赖                            | 当前归属        |
| ------------------------------- | --------------- |
| `@larksuiteoapi/node-sdk`       | Remote 飞书连接 |
| `@playwright/mcp`、`playwright` | 浏览器自动化    |
| `node-pty`、`@xterm/*`          | 内置终端        |

`js-yaml` 当前只在桌面 branding E2E 被源码引用，却列在生产依赖；应移到开发依赖或随旧测试删除。真正移包前仍需以打包产物和动态 import 扫描为准。

原生测试辅助也必须单列：`vendor/prebuilds/better-sqlite3/better_sqlite3.node.node` 和 `.electron` 分别用于 Node/Electron ABI，但两者实际都是 Darwin arm64 Mach-O；`scripts/sqlite-abi.sh` 不检查 platform/arch 就直接复制。它们不应进入安装包，也不能作为 macOS x64、Windows 或 Linux 测试依据。D-017 已冻结首发 macOS arm64、macOS x64、Windows x64，因此目标是三个 target 分别可复现构建，或使用带 platform/arch/ABI 键和哈希验证的 prebuild 集合；Linux/Windows arm64 不阻塞首版。

`prepare:file-viewer-assets` 每次 dev/build/pack 会生成 `apps/desktop/public/file-viewer`。当前 14 个文件共 41,088,016 字节，包含 Typst、CAD/libredwg、SQLite、libarchive WASM 与 DOCX/XLSX/PDF worker；这些文件由 Vite 进入 Renderer，必须按最终 artifact 资源而非“忽略的构建缓存”审计。

### 7.4 Renderer、UI 与构建依赖

`apps/desktop/package.json` 把纯 Renderer 依赖放在 `devDependencies`，因为它们由 Vite 打入产物；这只是打包布局，不表示这些包是开发期可选项。按生产 import 和构建入口核对后的处置如下：

| 依赖组                                                              | 当前调用域                                           | 处置                                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `react`、`react-dom`、`@xyflow/react`                               | Electron Renderer、Canvas 节点/连线                  | 保留                                                                         |
| `lexical`、`@lexical/react`                                         | Canvas Prompt 结构化编辑                             | 保留                                                                         |
| `html2canvas`                                                       | Canvas 工作区快照和截图                              | 保留                                                                         |
| `@tanstack/react-virtual`                                           | Canvas 资产列表和 Canvas Agent 消息列表              | 保留；同时属于 Agent 闭包                                                    |
| `react-easy-crop`                                                   | 共享 Spark 账户头像裁切                              | 保留；账户中心继续共享时需要                                                 |
| `three`、`@react-three/fiber`、`@react-three/drei`                  | 二期 3D 导演台                                       | 二期源码/数据兼容保护；不默认进入首版资源包                                  |
| `@file-viewer/*`、`pdfjs-dist`、`katex`、`shiki`                    | ChatPanel、Markdown、文件预览                        | 第一版 Canvas Agent 闭包保护；生成资源进入 T-012                             |
| `@lobehub/emojilib`、`@lobehub/fluent-emoji`                        | Chat/消息表情与 Vite alias                           | 第一版 Agent 闭包保护；移除前以打包产物和动态 import 复核                    |
| `antd`、`@lobehub/ui`、`@lobehub/icons`、`lucide-react`、`motion`   | 当前共用 UI 壳、Canvas 和旧平台视图                  | 第一阶段保留；旧视图删除后再按生产 import 收缩                               |
| `@lobehub/webfont-*`、`less`、`tailwindcss`、`@tailwindcss/vite`    | 字体、样式和 Renderer 构建                           | 精简保留；字体进入 T-012 notices/provenance，样式链按最终入口收缩            |
| `@rc-component/qrcode`                                              | QQ 联系入口和 Remote 配对二维码                      | 随旧联系/Remote 域移除；当前不属于共享 Spark 登录闭包                        |
| `react-router-dom`                                                  | Desktop 生产源码无调用，只有 `renderer.test.ts` mock | 删除或改写该测试后移除                                                       |
| `@xterm/xterm`、`@xterm/addon-fit`、`@xterm/addon-web-links`        | 内置 Terminal                                        | 随 Terminal 域移除                                                           |
| `@electron-toolkit/preload`、`@electron-toolkit/utils`              | Preload/Main Electron 辅助                           | 精简保留                                                                     |
| `electron`、`electron-vite`、`electron-builder`、`electron-rebuild` | 桌面开发、构建、原生重编译和安装包                   | 保留并按 D-017 的 target 矩阵验收                                            |
| `@playwright/test`                                                  | Desktop E2E                                          | 精简保留；它不同于要删除的应用内 `@playwright/mcp`/`playwright` 浏览器 Agent |
| TypeScript、ESLint、Vitest、React/Node 类型包                       | 编译、静态检查和单元测试                             | 保留；删除源码域后收缩配置和测试，不因产品依赖减少而提前移除                 |

工作区依赖 `@spark/agent-runtime`、`@spark/protocol`、`@spark/shared`、`@spark/storage` 第一阶段全部保留，按 D-012 不做品牌式重命名；只有完成新 schema、协议收缩和旧域调用归零后才能缩 exports 或拆包。Claude 各平台 optional package 也属于当前 Canvas Agent 发行矩阵，不能只在开发机可运行就删掉其他目标包。

## 8. 按域删除门槛

### Gate A：单产品入口

- Canvas 项目列表成为唯一首页。
- `CanvasWindowApp` 不再挂 `SessionSidebarProvider`。
- 保留 AuthProvider，但 bootstrap 失败不能阻塞项目首页、项目打开或 BYOK。
- 旧导航只隐藏，不先删底层。

### Gate B：Canvas IPC 独立注册

- 45 个工作区/壳核心通道有独立注册器和协议出口。
- preload allowlist 显式包含 Canvas Agent 与共享 Spark Auth/Platform Model 必需通道。
- 主进程按窗口角色与 project/session owner 再次授权，敏感 stream 定向投递。
- Canvas 项目、保存恢复、媒体、视频测试通过。
- Canvas renderer 不接收或提交任意 Workspace root；Agent 入口按 `projectId` 由主进程解析目录，并拒绝 Terminal/Git/通用 Workspace/Playwright 通道。
- 所有读写路径在主进程用 `realpath/lstat` 或等价无跟随策略校验；白名单内 symlink 不能逃逸，视频白名单随项目生命周期刷新。

### Gate C：共享 Spark 云与 FFmpeg 边界

- `auth:upload-file` 继续调用共享 Spark `/upload`，但只作显式 `spark_cloud_url` 策略；base64/Provider 原生上传不请求 Spark。
- `normalizeEduAssetUrl` 继续支持共享 Spark 资产域及历史路径。
- 同一账户、余额、套餐、订单、支付和托管文本模型通过契约测试；当前无托管图片/视频路径，不作超范围承诺。
- `fileKey`/owner/hash/项目引用/TTL 或删除闭环、支付订单幂等、云账与本地 Usage 分栏通过。
- token 不进入 Renderer；未登录且 Spark 域不可达时，BYOK 文本/图片/视频对 Spark 请求数为 0。
- FFmpeg 安装不再依赖 Skill Registry 和旧 MinIO。

### Gate D：Canvas Agent 决策落地

- 已确认第一版保留当前 Canvas Agent，不采用二期下线或轻量重写方案。
- 画布内创建/继续会话、历史、取消、提问响应、Agent/Provider/模型选择通过回归。
- 49 个 `spark_canvas` 工具及 ACK、超时、结果桥通过代表性旅程验收。
- 至少 20 个直接/间接 Agent 通道进入产品 allowlist，其他平台通道默认拒绝。
- `SessionSidebarProvider` 不再因打开画布启动无关查询，但 Canvas Agent 的 SessionService 按需可用。
- 打开项目列表、Canvas 或 Agent 面板但未发送 turn 时，不构造 SessionService，不启动通用 MCP；首次实际运行单飞启动。
- 当前 Session/Agent/Skill/MCP/SDK/Repository 闭包在上述回归前不得删除。

### Gate E：删除旧平台域

- 一次只删除一个领域：Chat/Session、Agent/Team、Workflow/Board/Scheduler、MCP/Skill/Memory、Git/Terminal/Playwright/Remote。
- 每个领域删除前后都做调用点检索、协议 handler 对账和相关测试。
- `registerAllIpcHandlers` 不再启动该领域服务。

### Gate F：协议、全新数据库与依赖收缩

- Node 22.14.x 下 typecheck 和测试基线可重复。
- 空 `userData` 创建 `spark-canvas.db` 和 `projects/`；唯一默认 Canvas Assistant、4 Skills 和批准的媒体 manifest 集合幂等 seed，当前基线为 101 项，且不导入宿主 Skills。
- 101 个 manifest 的 ID、结构和语义校验通过；非 `custom:` preset ref 全部精确命中，resolver 不会掩盖内置拼写错误。
- 项目目录权威、SQLite 同 revision 恢复镜像和 Renderer 草稿边界通过逐阶段故障注入。
- v3 目录项目包由用户主动导入导出，媒体可移植且只含校验过的相对路径；v1/v2 JSON 仅作兼容快照导入。
- 新应用不扫描旧 Spark 目录，不运行旧 53 条 migration。
- 再删除历史协议类型、Repository export、53 条旧 migration 和 npm/native 包。
- 9 个 MCP 脚本使用显式打包 allowlist，保留脚本的 helper 全部存在；14 个动态 file-viewer 资产和 native prebuild 完成目标平台对账。
- 打包后的 macOS/Windows 核心旅程通过，不能只以单元测试判断依赖可删。

## 9. 关键源码证据

- `apps/desktop/src/renderer/CanvasWindowApp.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasAgentModal.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx`
- `apps/desktop/src/renderer/design/SessionSidebarContext.tsx`
- `apps/desktop/src/renderer/design/auth/AuthContext.tsx`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/ipc/index.ts`
- `apps/desktop/src/main/services/SafeFileProtocol.ts`
- `apps/desktop/src/main/services/videoProcessHandler.ts`
- `apps/desktop/src/main/services/FfmpegIntegrityService.ts`
- `apps/desktop/electron.vite.config.ts`
- `apps/desktop/scripts/copy-file-viewer-assets.mjs`
- `packages/agent-runtime/src/services/session.service.ts`
- `packages/agent-runtime/src/services/canvas-text-generator.ts`
- `packages/agent-runtime/src/services/media/media-model-resolver.ts`
- `packages/agent-runtime/src/tools/media-generation-mcp-server.mjs`
- `packages/protocol/src/media-model-manifest.ts`
- `packages/protocol/src/media-model-manifest-validation.ts`
- `packages/protocol/src/provider-presets.ts`
- `packages/storage/migrations/027_canvas_snapshots.sql`
- `packages/storage/migrations/029_media_generation_tasks.sql`
- `packages/storage/migrations/033_media_model_manifests.sql`
- `packages/protocol/src/ipc/index.ts`
- `scripts/sqlite-abi.sh`
- `vendor/prebuilds/better-sqlite3/README.md`
