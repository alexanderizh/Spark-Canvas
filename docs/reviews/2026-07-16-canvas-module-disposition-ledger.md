# Spark Canvas 独立化模块处置总账

审计日期：2026-07-16
代码基线：`6cfbfcd Copy full spark-agent monorepo into Spark-Canvas`
决策更新：2026-07-17，产品名为 `Spark Canvas`，应用身份采用方案 1；首版采用混合模式并完全共用 Spark 云账户，本地数据全新开始、不自动迁移；生产签名在同一合法主体且证书可用时复用原身份。

## 1. 用途和边界

本文件把仓库中的生产模块逐域归入 `保留`、`精简保留`、`替换`、`移除`、`二期`、`待确认`，作为后续独立化的删除清单和验收索引。

它与三份上游文档配套使用：

- 总体架构、现有功能和阶段计划：[`2026-07-16-canvas-standalone-audit.md`](../plans/2026-07-16-canvas-standalone-audit.md)
- IPC、跨目录 import、数据库和服务闭包：[`2026-07-16-canvas-standalone-dependency-slice.md`](./2026-07-16-canvas-standalone-dependency-slice.md)
- 旧品牌、云服务、本地数据和发布身份：[`2026-07-16-canvas-identity-cloud-coupling.md`](./2026-07-16-canvas-identity-cloud-coupling.md)
- 共享 Spark 云、计费、支付和上传契约：[`2026-07-17-canvas-shared-spark-cloud-contract.md`](./2026-07-17-canvas-shared-spark-cloud-contract.md)
- 数据权威、空库 seed 和项目包：[`2026-07-17-canvas-data-authority-bootstrap.md`](./2026-07-17-canvas-data-authority-bootstrap.md)
- 签名、发布、更新源和版本中心风险：[`2026-07-17-canvas-release-signing-readiness.md`](./2026-07-17-canvas-release-signing-readiness.md)
- 版本中心 v2、对象前缀和更新完整性：[`2026-07-17-canvas-version-center-product-isolation.md`](./2026-07-17-canvas-version-center-product-isolation.md)
- IPC、凭据、Agent lazy runtime 和 FFmpeg 安装：[`2026-07-17-canvas-runtime-security-boundary.md`](./2026-07-17-canvas-runtime-security-boundary.md)
- FFmpeg 四包真实来源、许可和签名 Gate：[`2026-07-17-canvas-ffmpeg-artifact-provenance-release-gates.md`](./2026-07-17-canvas-ffmpeg-artifact-provenance-release-gates.md)
- 15 个不可达 Canvas 模块逐文件处置：[`2026-07-17-canvas-unreachable-module-disposition.md`](./2026-07-17-canvas-unreachable-module-disposition.md)
- 旧平台依赖删除顺序和生产发布 Gate：[`2026-07-17-canvas-platform-removal-release-gates.md`](./2026-07-17-canvas-platform-removal-release-gates.md)
- D-014 至 D-018 发行选择依据：[`2026-07-17-canvas-release-decisions-readiness.md`](./2026-07-17-canvas-release-decisions-readiness.md)
- 总目标覆盖与决策：[`2026-07-17-canvas-standalone-audit-coverage.md`](./2026-07-17-canvas-standalone-audit-coverage.md)

当前处置结论按已确认的产品定位、Canvas Agent、混合模型和“全新本地数据”边界编制。因此：

1. `移除` 表示完成表中前置解耦后移除，不表示现在立即删除。
2. `待确认` 只用于静态接管证据、官网、签名、许可等尚未落地项。
3. 本阶段不修改业务代码，不批准大规模移动或重命名。
4. 测试、样式和静态资产默认跟随其生产模块；例外项在对应章节单列。

## 2. 处置标签

| 标签     | 总账语义                                                         |
| -------- | ---------------------------------------------------------------- |
| 保留     | 独立视频画布直接需要，后续可以内部拆文件，但不能丢失行为         |
| 精简保留 | 能力需要，当前实现混入旧平台职责或文件过大，先缩小运行闭包       |
| 替换     | 能力需要，但旧品牌、未批准云服务、旧入口或旧发布身份不能沿用     |
| 移除     | 独立产品不需要，满足删除门槛后连同协议、存储、测试和依赖一起删除 |
| 二期     | 现有能力有价值，但不应阻塞第一轮独立化；保持可用，不继续扩大范围 |
| 待确认   | 取决于静态接管证据、官网、签名、许可等尚未完成项                 |

## 3. 源码普查口径

以下数量通过文件系统重新统计，测试文件不计入生产模块；`less/css` 单独计数并跟随所属模块。

| 范围                      | 生产模块/文件 | 补充说明                                       |
| ------------------------- | ------------: | ---------------------------------------------- |
| Renderer 非 `design` 入口 |             8 | 另有 `index.html`、`FloatingSidebar.less`      |
| Renderer `design`         |           342 | 另有 75 个样式文件                             |
| 其中 Canvas               |           173 | 另有 24 个样式文件、88 个测试文件              |
| Main process              |            60 | 另有 34 个测试文件                             |
| Preload                   |             1 | 当前是全平台通用桥                             |
| `packages/agent-runtime`  |           121 | 109 TS、1 d.mts、2 媒体 helper mjs、9 MCP 脚本 |
| Agent Runtime 运维脚本    |             2 | 旧 Memory 迁移和真实抽取 smoke，不进产品包     |
| `packages/storage/src`    |            38 | 另有 53 个历史 SQL migration                   |
| `packages/protocol/src`   |            22 | 其中 IPC 主文件 6081 行                        |
| `packages/shared/src`     |             8 | 含旧 `edu-asset-url`                           |
| Website `src`             |            68 | 66 个 TS/TSX、1 个 CSS、1 个生成 JSON          |
| Desktop resources         |           156 | 大部分是旧 Agent Skill 资源                    |
| Generated file-viewer     |            14 | 41,088,016 字节，构建前生成并进入 Renderer     |
| Desktop scripts           |            19 | 发布、浏览器、原生模块、图标和品牌脚本         |
| Desktop E2E               |             2 | App smoke 与品牌测试，随产品入口重写           |
| Vendor native prebuild    |             3 | README + 2 个仅 Darwin arm64 的测试二进制      |
| GitHub workflows          |             2 | 桌面发布和旧官网发布                           |

总账采用“目录全覆盖 + 例外模块明示”的方式，避免把 600 多个文件机械复制成不可维护的路径清单。目录行覆盖该范围全部生产模块；例外行优先于目录默认处置。

## 4. Renderer 入口和应用壳

### 4.1 `apps/desktop/src/renderer` 根模块

| 模块                     | 当前职责                            | 处置     | 前置条件/目标                                               |
| ------------------------ | ----------------------------------- | -------- | ----------------------------------------------------------- |
| `main.tsx`               | 解析窗口参数并选择主 App/Canvas App | 精简保留 | Canvas 成为唯一产品入口后简化双入口逻辑                     |
| `canvasWindowParams.ts`  | 读取 Canvas 独立窗口参数            | 精简保留 | 若改为唯一主窗口，改成项目路由参数                          |
| `CanvasWindowApp.tsx`    | Canvas 壳和三个全局 Provider        | 精简保留 | 去掉 `SessionSidebarProvider`；保留共享 Spark Auth          |
| `App.tsx`                | 完整 Agent 平台导航和页面路由       | 替换     | `CanvasProjectsView` 成为首页并提供精简设置入口后删除旧路由 |
| `sidebarAutoSync.ts`     | Session 侧栏自动同步                | 移除     | Canvas 壳不再挂 Session 侧栏                                |
| `user-question-queue.ts` | Agent 问答队列                      | 保留     | 当前 Canvas Agent 第一版会话和提问响应                      |
| `arco-design-color.d.ts` | UI 类型补充                         | 保留     | 若最终不再使用对应库，再由依赖扫描决定                      |
| `env.d.ts`               | Vite 环境类型                       | 保留     | 随构建入口维护                                              |
| `index.html`             | Renderer HTML                       | 保留     | 更新产品标题、图标和 CSP                                    |
| `FloatingSidebar.less`   | 旧主应用侧栏样式                    | 移除     | 旧主导航删除                                                |

### 4.2 全局 Provider 闭包

| Provider                 | 处置     | 控制要求                                                               |
| ------------------------ | -------- | ---------------------------------------------------------------------- |
| `AppProvider`            | 精简保留 | 只保留外观、离开守卫、确认框和 Canvas 所需设置                         |
| `AuthProvider`           | 保留     | 官方托管路径继续共用原 Spark 登录；失败不得阻塞 BYOK                   |
| `SessionSidebarProvider` | 移除     | 先移出 `CanvasWindowApp`，阻止打开 Canvas 时查询旧平台五类服务和八条流 |
| `LobeThemeProvider`      | 保留     | 继续作为 UI 主题底座，删除旧页面后复核实际依赖                         |

## 5. Canvas Renderer 处置

根目录：`apps/desktop/src/renderer/design/views/canvas`

### 5.1 默认规则

173 个 Canvas TS/TSX 生产模块和 24 个所属样式文件默认 `保留`。只有下面明确列出的 `精简保留`、`二期`、`替换`、`移除` 和 T-009 已冻结处置覆盖默认规则。

| 领域                        | 模块范围                                                                                                 | 处置     | 理由/后续动作                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| 项目、Board、快照和资产目录 | `CanvasProject*`、`CanvasProjectsView`、`canvas.api`、`canvas.store`、`canvas.types`、`canvasWorkspace*` | 保留     | 独立产品的数据和入口核心                                       |
| 无限画布和几何编辑          | `CanvasStage`、`CanvasNode*`、工具栏、历史、布局、碰撞、吸附、分组、连线和放置 helpers                   | 保留     | 当前成熟编辑底座                                               |
| Prompt 和文本编排           | `CanvasPrompt*`、`canvasPrompt*`、Composer、mention、inheritance、text presentation                      | 保留     | 影视文稿、提示词和生成输入核心                                 |
| AI 操作和媒体任务           | `CanvasOperation*`、`CanvasModelPicker`、`CanvasTaskQueue`、`canvasMedia*`、`canvasPipeline*`            | 保留     | 文本、图片、音频、视频 Provider 主链                           |
| 影视资产和生产链            | `CanvasFilm*`、`CanvasCharacter*`、`CanvasShot*`、manuscript、storyboard、template、Production           | 保留     | 已确认产品定位的主要差异化能力                                 |
| 3D 导演台                   | `stage3d/**`、`CanvasDirectorStageModal.tsx`                                                             | 二期     | 源码/数据兼容受保护；不进入首版默认能力，资源须先通过 T-012    |
| 视频工作台                  | `videoWorkbench/**`、`canvasVideoSubmissionGate.tsx`                                                     | 保留     | 首版 P0；探测、抽帧、裁剪、转码/分段和全部产物回填必须贯通     |
| 图片标注                    | `CanvasImageAnnotationModal.*`                                                                           | 二期     | 有实现但不是独立化阻塞项                                       |
| 宫格拆图                    | `CanvasGridSplitModal.*`、`canvasGridSplit.ts`                                                           | 保留     | 直接服务分镜拆分                                               |
| 360 全景                    | `CanvasPanoramaViewerModal.tsx`                                                                          | 二期     | 保持可用，不作为第一版主流程                                   |
| XLSX 等通用文档输入         | `canvasDocumentParse.ts`                                                                                 | 精简保留 | 保留 DOCX；XLSX 二期；收紧 DOC/XLS/ODT/RTF/PPTX 的虚假支持声明 |
| 安全文件 URL                | `canvas-safe-file.ts`                                                                                    | 替换     | 保留安全 URL 解析，去旧 Workspace 假设并允许共享 Spark 资产域  |
| 超大协调文件                | `CanvasWorkspaceView.tsx`、`canvas.api.ts`、`CanvasFilmAssetCenter.tsx`                                  | 精简保留 | 已超过 3000 行，后续只允许向已有领域模块迁出，不再直接堆新功能 |

### 5.2 Canvas Agent 专属模块

以下六个生产模块不是基础文本/媒体生成的必需项：

- `CanvasAgentModal.tsx`
- `canvas-agent-model-options.ts`
- `canvas-tool-host.ts`
- `canvasAgentContextBuilder.ts`
- `canvasAgentPromptPresets.ts`
- `CanvasAgentPicker.less`（所属样式）

处置：`保留`。

负责人已确认第一版保留当前 Canvas Agent。上述模块、现有行为和 49 个工具进入首版验收；第一版不以重做轻量助手替换现有实现。可以拆出 IPC/启动边界并清理无调用依赖，但不能直接裁剪 10556 行的 `SessionService`，也不能在 Agent 全旅程回归前删除当前运行闭包。

Canvas Agent 当前还间接拉入：

- `ChatPanel`
- `ChatView` 导出的 `MarkdownText`
- `StreamingErrorCard`
- `RuntimeSignalCard`
- `CancellationNotice`
- Avatar、Skills picker、Agent/Skill/Session/Workspace 协议
- Claude/Codex SDK、权限、MCP、Session Repository 闭包

因此不能只删或只留 `CanvasAgentModal.tsx` 来完成处置。

### 5.3 静态零入边和入口不可达模块

Canvas 生产源码静态 import 图中，以下 13 个文件没有 Canvas 内部入边：

- `CanvasAiPanel.tsx`
- `CanvasBoardSidebar.tsx`
- `CanvasContextMenu.tsx`
- `CanvasFloatingNodeToolbar.tsx`
- `CanvasProductionPanel.tsx`
- `CanvasShortcutHelpModal.tsx`
- `CanvasWorkspaceSidePanel.tsx`
- `canvasConnectionSemantics.ts`
- `canvasConsistencyCheck.ts`
- `canvasSelectionContext.tsx`
- `canvasWorkspaceFilm.ts`
- `canvasWorkspaceSnapshot.ts`
- `useCanvasFileInsertion.ts`

T-009 已完成逐文件对账，最终结论不是整体删除：

- 删除旧实现：`CanvasAiPanel.tsx`、`CanvasContextMenu.tsx`、`canvasConsistencyCheck.ts`、`canvasSelectionContext.tsx`。
- 直接接管 Workspace 内联实现：`CanvasShortcutHelpModal.tsx`、`CanvasWorkspaceSidePanel.tsx`、`canvasWorkspaceFilm.ts`、`canvasWorkspaceSnapshot.ts`。
- 对账更新后接管：`CanvasFloatingNodeToolbar.tsx`、`useCanvasFileInsertion.ts`、`canvasWorkspacePlacement.ts`。
- 保留并正式接入：`CanvasBoardSidebar.tsx`、`CanvasProductionPanel.tsx`、`canvasPipelineProgress.ts`、`canvasConnectionSemantics.ts`。

从 `main.tsx`、`App.tsx` 和 `CanvasWindowApp.tsx` 做全 Renderer 静态可达性遍历时，共有 **15 个** Canvas 生产模块不可达。除上面 13 个零入边文件外，还包括：

- `canvasPipelineProgress.ts`，只被不可达的 `CanvasProductionPanel.tsx` 引用。
- `canvasWorkspacePlacement.ts`，只被不可达的 `useCanvasFileInsertion.ts` 引用。

这组结果揭示的是“抽取未接管、能力入口未接线和旧实现残留”的混合集合。特别是：

- `CanvasBoardSidebar.tsx` 承载已冻结的项目内多 Board 导航，不是应删除的旧 Agent Board；当前普通用户缺少可见 Board 切换入口。
- `canvasConnectionSemantics.ts` 揭示当前 `canvas.api.ts` 会把从 Operation/Task 出发的手工连线误写成 `generated`；该语义必须在写边权威边界修复。
- `useCanvasFileInsertion.ts` 和 `CanvasFloatingNodeToolbar.tsx` 落后于当前内联行为，不能直接接线造成回归。

完整证据、逐文件动作和接管顺序见[不可达模块逐文件处置审计](./2026-07-17-canvas-unreachable-module-disposition.md)。

### 5.4 Canvas 的 12 个跨目录目标

| 跨目录目标                           | 处置     | 说明                                                  |
| ------------------------------------ | -------- | ----------------------------------------------------- |
| `design/Icons`                       | 保留     | 54 个 Canvas import，属于共享图标底座                 |
| `design/AppContext`                  | 精简保留 | 缩成 Canvas 壳需要的外观、守卫和确认能力              |
| `design/SidebarExpandButton`         | 替换     | 单产品信息架构落地后删除旧侧栏语义                    |
| `design/views/chat/ChatMarkdown`     | 精简保留 | 抽成中性 Markdown 组件；Canvas 节点和操作产物直接需要 |
| `design/components/ProviderLogo`     | 保留     | Canvas 模型选择器直接需要                             |
| `design/components/ChatPanel`        | 保留     | 当前 Canvas Agent 第一版需要                          |
| Avatar、`AvatarImage`、Skills picker | 保留     | 当前 Canvas Agent 第一版需要                          |
| `design/utils/provider-adapter`      | 精简保留 | 当前 Canvas Agent 模型/adapter 选择；仅收缩无调用分支 |
| `renderer/assets/stage3d-actors/*`   | 二期     | 3D 导演台 FBX/GLB；未证明可再分发，不进入首版安装包   |

`ChatMarkdown` 自身还引用文件预览、代码块、图片预览和 `ChatDocumentOutput`。独立化时应留下 Markdown 展示所需的最小闭包，去掉 Workspace 文件路径和 Chat 文档卡语义，同时保留共享 Spark 资产 URL。

## 6. Renderer 旧平台视图

### 6.1 `design/views` 根目录 28 个模块

| 模块                                                                        | 处置     | 删除/替换门槛                                            |
| --------------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| `FfmpegStatusCard.tsx`                                                      | 保留     | 移入精简设置或视频工作台                                 |
| `ProvidersView.tsx`、`provider-card-actions.ts`、`providerApiKeyEcho.ts`    | 精简保留 | 只保留文本/图片/音频/视频 Provider、凭据和模型清单       |
| `SettingsView.tsx`                                                          | 替换     | 建立 Canvas 专用设置分区；原文件 6208 行，不继续直接扩写 |
| `OnboardingView.tsx`、`onboardingPosters.ts`                                | 替换     | 改为项目位置、Provider、FFmpeg 的最小首次启动流程        |
| `AccountCenterView.tsx`                                                     | 精简保留 | 保留共享 Spark 账户、余额、套餐、订单、支付和用量        |
| `HomeView.tsx`、`ProjectView.tsx`                                           | 移除     | `CanvasProjectsView` 成为唯一首页                        |
| `ChatView.tsx`、`chat-copy.ts`、`chat-scroll.ts`、`chat-session-routing.ts` | 移除     | 先迁出 Canvas Agent 当前使用的 Markdown/消息渲染依赖     |
| `chat-session-status.ts`                                                    | 保留     | 当前 `ChatPanel` 第一版仍使用                            |
| `chat-team-visibility.ts`                                                   | 移除     | Team 域删除                                              |
| `AgentsView.tsx`、`agent-config-counts.ts`                                  | 移除     | 移除通用管理页；Canvas Agent 的 Agent 数据和内嵌选择保留 |
| `TeamsPanel.tsx`                                                            | 移除     | Team 域删除                                              |
| `WorkflowView.tsx`                                                          | 移除     | Workflow 域删除                                          |
| `BoardView.tsx`                                                             | 移除     | 这是旧 Agent Board，不是 Canvas Board                    |
| `ScheduledTasksView.tsx`                                                    | 移除     | Scheduler 域删除                                         |
| `MemoryPanel.tsx`                                                           | 移除     | Memory 域删除                                            |
| `McpView.tsx`                                                               | 移除     | MCP 域删除                                               |
| `SkillStoreView.tsx`                                                        | 移除     | FFmpeg installer 和文本 prompt 已迁出 Skill 系统         |
| `BrowserPanelView.tsx`、`PlaywrightStatusCard.tsx`                          | 移除     | 浏览器自动化域删除                                       |
| `overlays.tsx`                                                              | 精简保留 | 删除旧平台 overlay 后，仅保留独立产品实际调用项          |

相应 `.less` 文件跟随所属视图处置。

### 6.2 子目录视图

| 目录                                     | 数量/范围     | 默认处置 | 例外和门槛                                                    |
| ---------------------------------------- | ------------- | -------- | ------------------------------------------------------------- |
| `design/views/chat/**`                   | 48 个生产模块 | 移除     | `ChatMarkdown`、ChatPanel 当前消息卡及最小依赖先标为精简保留  |
| `design/views/platform-model/**`         | 9 个生产模块  | 精简保留 | 继续使用共享 Spark 账户、额度和支付；去无关 Agent 页面语义    |
| `design/views/provider-import-export/**` | 2 个生产模块  | 精简保留 | Provider 导入导出若继续支持，限制到保留字段且不得导出明文 Key |
| `design/views/workflow/**`               | 6 个生产模块  | 移除     | Workflow 页面、模板和图适配器一起删除                         |

### 6.3 共享 Renderer 模块

| 范围/模块                                                                                                   | 处置     | 说明                                                      |
| ----------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `design/Icons.tsx`                                                                                          | 精简保留 | Canvas 广泛依赖；删除旧平台图标后再收缩                   |
| `design/AppContext.tsx`                                                                                     | 精简保留 | 去 Session/Team/Chat 全局职责                             |
| `design/hooks/useAppearance.ts`、`useResolvedTheme.ts`、`useIpc.ts`、`useKeyboard.ts`、`useSaveShortcut.ts` | 保留     | Canvas 和精简设置基础能力                                 |
| `design/hooks/useDebounce.ts`、`useAppDialogKeyboard.ts`                                                    | 保留     | 按实际调用保留                                            |
| `design/hooks/useTerminalSessions.ts`                                                                       | 移除     | Terminal 域                                               |
| `design/hooks/useRefreshable.ts`                                                                            | 精简保留 | 仅在保留视图仍有调用时留下                                |
| `design/auth/**`                                                                                            | 保留     | 继续使用共享 Spark 登录、注册、验证码和账户状态           |
| `design/i18n/**`                                                                                            | 保留     | 更新产品文案和旧平台词条                                  |
| `design/theme/**`、`arcoTheme.ts`                                                                           | 精简保留 | 保留主题底座，删除仅展示主题预览的旧页面代码              |
| `ConfirmDialog`、`ErrorBoundary`、`ImagePreviewModal`、`MacWindowDragHeader`、`Toast`、`WindowControls`     | 保留     | 通用桌面/Canvas UI                                        |
| `ProviderLogo`、`ProviderManifestContractEditor`                                                            | 精简保留 | 服务精简 Provider 设置和 Canvas 模型选择                  |
| `MarkdownCodeBlock`、`MarkdownImage`、`ClickableFilePath`、`FileDisplay`                                    | 精简保留 | 中性 Markdown 最小闭包；去 Workspace 和旧 Edu URL 假设    |
| `ChatPanel`、`AvatarImage`、`SkillsPickerModal`                                                             | 保留     | 当前 Canvas Agent 第一版闭包                              |
| `design/avatar.ts` 及内置 Agent avatar 数据                                                                 | 保留     | 当前 Canvas Agent 第一版选择和展示                        |
| `design/services/event-mapper.ts`、Chat 事件缓冲/状态 helpers                                               | 保留     | 当前 ChatPanel 流式事件与状态展示                         |
| `BuiltInTerminalPanel`、`WorktreePanel`、`CheckpointTimelinePanel`、`HistoryImportModal`                    | 移除     | Git/Terminal/History Import 域                            |
| `AgentsPickerModal`、`Team*`、`SkillAssignHintModal`                                                        | 移除     | Agent/Team/Skill 域                                       |
| `FilePreviewPanel`、`SessionFileOpenPicker`、Composer/Mention/Permission 组件                               | 移除     | 旧 Chat/Session 域；Markdown 所需的最小文件展示先单独迁出 |
| `design/data/available-tools.ts`、`design/utils/agent-execution-config.ts`、`permission-options.ts`         | 移除     | 代码 Agent 配置                                           |
| `design/utils/provider-adapter.ts`、`skills-data.ts`                                                        | 精简保留 | 当前 Canvas Agent/Skill 闭包；只清理无调用选项            |
| `design/styles/views.css`                                                                                   | 精简保留 | 16509 行；按删除域同步迁出/删除样式，不做一次性全局重写   |
| `design/styles/board.css`、Chat/Team interaction 样式                                                       | 移除     | 对应旧页面删除后移除                                      |
| `design/styles/styles.css`、`global-overrides.css`                                                          | 精简保留 | 保留实际使用的全局基础样式，随旧页面清理无效规则          |

未在“保留/待确认”例外中列出的 `design/components/**`、`design/services/**` 和根侧栏/Team helper，默认随旧 Chat、Session、Agent、Team、Git 域 `移除`。

## 7. Main Process 与 Preload

### 7.1 根模块和 IPC

| 模块/范围                                                              | 处置     | 前置条件/目标                                                                 |
| ---------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `main/index.ts`                                                        | 替换     | 拆成 App Shell、Canvas、Provider、Auth/Platform Model、Settings、Video 注册器 |
| `main/db.ts`                                                           | 替换     | 使用 `{userData}/spark-canvas.db` 建立新 schema；不发现或升级旧 `spark.db`    |
| `main/app-shutdown.ts`                                                 | 精简保留 | 只保留数据库、更新、媒体任务和窗口收尾                                        |
| `main/single-instance.ts`                                              | 精简保留 | 更新产品协议、项目打开和品牌                                                  |
| `main/canvas-host-bridge.ts`                                           | 保留     | Canvas Agent 当前工具调用和 ACK 桥                                            |
| `main/session-service-shutdown.ts`                                     | 保留     | Canvas Agent 第一版继续使用 SessionService                                    |
| `ipc/canvas-prompt-runtime.ts`                                         | 保留     | Canvas 文本 prompt 运行时                                                     |
| `ipc/canvasTextTaskDiagnostics.ts`                                     | 保留     | 修复现有 typecheck 基线，继续做脱敏诊断                                       |
| `ipc/ipc-performance.ts`、`ipc/typed-ipc.ts`、`ipc/window-controls.ts` | 保留     | IPC 基础设施                                                                  |
| `ipc/index.ts`                                                         | 替换     | 7987 行；按域迁出 Canvas、共享 Spark 云和精简设置通道                         |
| `ipc/user-question-store.ts`                                           | 保留     | 当前 Canvas Agent/Session 问答                                                |
| `ipc/git-status-utils.ts`、`ipc/workspace-git-status.ts`               | 移除     | Git/Workspace 域                                                              |
| `ipc/registerTerminalIpc.ts`                                           | 移除     | Terminal 域                                                                   |
| `security/index.ts`                                                    | 保留     | Electron 安全参数                                                             |
| `windows/index.ts`                                                     | 替换     | 旧主窗口、Tray、最近 Session 改为 Canvas 项目入口或删除 Tray                  |
| `preload/index.ts`                                                     | 精简保留 | 增加运行时 allowlist，不能只依赖 TypeScript 泛型                              |

### 7.2 Main services 60 文件闭包

| 模块/目录                                                                                                          | 处置     | 删除/替换门槛                                                                     |
| ------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------- |
| `CanvasProjectPath.ts`、`CanvasWindowService.ts`                                                                   | 保留     | 统一项目路径验证；窗口模型可从“第二窗口”精简成主产品窗口                          |
| `SafeFileProtocol.ts`                                                                                              | 替换     | 白名单只保留 userData、temp、Canvas 项目根，并用 realpath/lstat 阻断 symlink 逃逸 |
| `CredentialVaultPersistence.ts`                                                                                    | 保留     | 从 Auth 初始化迁到核心启动；使用 `spark-canvas` vault，不读旧 BYOK Key            |
| `FfmpegIntegrityService.ts`、`FfmpegRunner.ts`、`videoProcessHandler.ts`                                           | 精简保留 | 替换旧安装源；修复相对路径检查、symlink 边界和白名单缓存，再验收视频旅程          |
| `ShellEnvironmentService.ts`                                                                                       | 精简保留 | 只保留 GUI 进程 PATH/FFmpeg 所需部分，移除 Node/npm/git 状态                      |
| `UpdateService.ts`                                                                                                 | 替换     | 使用严格 v2 product/appId；新下载和缓存验证 host、size、hash 与签名               |
| `AppSkillsManager.ts`                                                                                              | 替换     | 显式 seed 批准的 4 Skills；禁止自动导入宿主 Claude/Codex Skills                   |
| `BrowserBridgeServer.ts`、`InternalBrowserService.ts`、`PlaywrightEnvironment.ts`、`PlaywrightIntegrityService.ts` | 移除     | 浏览器功能不再注册                                                                |
| `PlaywrightMcpRegistration.ts`                                                                                     | 移除     | MCP/Playwright 域                                                                 |
| `ExternalToolService.ts`                                                                                           | 移除     | 删除 IDE/Terminal 探测；保留的“打开项目文件夹”直接用 `shell.openPath`             |
| `FilePatchService.ts`、`FileWatcherService.ts`                                                                     | 移除     | 代码 Agent Workspace 域                                                           |
| `RemoteConnectionService.ts`                                                                                       | 移除     | 飞书/远程 Agent 域                                                                |
| `TerminalService.ts`                                                                                               | 移除     | 内置终端域                                                                        |
| `SdkIntegrityService.ts`                                                                                           | 保留     | 当前 Canvas Agent 继续使用 Claude/Codex SDK/CLI                                   |
| `background-maintenance-worker.ts`、`workers/background-maintenance.worker.ts`                                     | 精简保留 | 当前 Canvas Agent 仍产生 Agent event/turn request                                 |
| `services/Auth/**`                                                                                                 | 精简保留 | 共用 Spark 登录和显式 `/upload`；移除 token 广播并按 T-013 补上传生命周期         |
| `services/PlatformModel/**`                                                                                        | 精简保留 | 共用 Spark 账户、余额、套餐、订单、支付和文本托管额度；补幂等/状态隔离            |
| `services/GitHubConnector/**`                                                                                      | 移除     | GitHub/代码 Agent 域                                                              |
| `services/HistoryImport/**`                                                                                        | 移除     | Claude/Codex 历史导入域                                                           |
| `services/mcp-oauth/**`                                                                                            | 移除     | MCP 域                                                                            |

## 8. Agent Runtime

根目录：`packages/agent-runtime/src`，生产运行闭包共 121 个文件：109 个 `.ts`、1 个 `.d.mts`、2 个媒体 helper `.mjs` 和 `src/tools` 下 9 个生产 MCP server `.mjs`。此前 112 的口径漏掉了 9 个工具脚本。

### 8.1 独立产品核心

| 模块/范围                                                                                              | 处置     | 说明                                                     |
| ------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------- |
| `services/canvas-text-generator.ts`                                                                    | 保留     | 基础文本生成不依赖 Session                               |
| `services/provider-credential-resolver.ts`、`provider.service.ts`                                      | 精简保留 | 只保留文本/媒体 Provider，去本地代码 Agent Provider seed |
| `services/settings.service.ts`                                                                         | 精简保留 | 只服务独立产品设置                                       |
| `services/media/media-adapter.types.ts`                                                                | 保留     | 媒体 Adapter 契约                                        |
| `services/media/media-artifact.service.ts`                                                             | 保留     | 生成产物物化                                             |
| `services/media/media-debug-log.ts`、`media-error-normalizer.ts`、`media-http.util.ts`                 | 保留     | 媒体诊断、错误和 HTTP 边界                               |
| `services/media/media-model-catalog.service.ts`、`media-model-resolver.ts`                             | 保留     | 模型能力和解析                                           |
| `services/media/media-request-compiler.ts`、`media-router.service.ts`、`media-task-runtime.service.ts` | 保留     | 请求编译、路由和任务生命周期                             |
| `services/media/adapters/*.ts`                                                                         | 保留     | 现有 8 个 Adapter 先保留；逐个真实合约测试后再决定下线   |
| 根 `index.ts`                                                                                          | 精简保留 | 收缩 exports；包名等运行时真正不含 Agent 后再改          |

媒体目录真实库存是 101 个唯一 manifest（图片 34、视频 62、音频 5，11 个 provider kind），不是源码数组的 42 个顶层表达式。当前 101 项结构 schema 全过，但 `minimax:speech-2.8-turbo` 有 2 个语义校验问题；24 个媒体 preset 的 99 条显式 ref 中又有 2 条非 `custom:` 错 ID。seed、Provider preset 和 resolver 必须作为同一闭包验收，非 `custom:` ref 不得靠合成 manifest 静默通过。

### 8.2 条件能力

| 模块                                  | 处置     | 决策门                                                                                 |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `services/canvas-mcp-server.ts`       | 保留     | 当前 Canvas Agent 的 49 个画布工具协议                                                 |
| `services/model.service.ts`           | 保留     | 当前 Canvas Agent 的 embedding/completion 闭包；Provider 选择另由 ProviderService 负责 |
| `services/usage-ledger.service.ts`    | 保留     | 本机 Agent Session token/cost 观测；不是共享 Spark 账单                                |
| `services/platform-bridge.service.ts` | 精简保留 | 本机 Platform Management MCP 桥，不是 Spark 云模型桥；只保留 Canvas Agent 实际调用     |
| `services/skill-registry/**`          | 精简保留 | 当前 Canvas Agent 的 Skill 运行时；FFmpeg 安装和无关 Registry 职责迁出                 |

### 8.3 第一版 Canvas Agent 当前闭包

| 目录/模块                                                                                                                      | 处置     | 第一版边界                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------ |
| `core/**`                                                                                                                      | 精简保留 | 保留当前 Agent event/command 调用链；不开放通用平台入口            |
| `mcp/**`                                                                                                                       | 精简保留 | 保留 Canvas MCP 和当前 executor transport；外部管理/OAuth 另行清理 |
| `sdk/**`                                                                                                                       | 保留     | 当前 Claude/Codex executor、事件映射、权限和 diff 闭包             |
| `services/memory/**`、`tools/recall-memory.tool.ts`                                                                            | 精简保留 | 当前 SessionService 直接闭包；不开放 Memory 产品页面               |
| `skills/**`、`services/local-skill-importer.ts`、`services/skill.service.ts`                                                   | 精简保留 | 保留当前 Skill 选择、配置和影视 Skills；无关 Skills 按调用点清理   |
| `services/session.service.ts`、`session-event-sequencer.ts`、`session-title-generator.ts`、`conversation-summarizer.ts`        | 保留     | 当前 Canvas Agent 会话、历史、标题、流式事件和取消核心             |
| `services/team-*.ts`、`member-execution-lifecycle.ts`、`team-dispatch.service.ts`                                              | 精简保留 | 仅作为当前 SessionService 迁移闭包；不保留 Team 产品能力           |
| `services/workflow-executor.ts`                                                                                                | 精简保留 | 仅作为当前 SessionService 迁移闭包；不保留 Workflow 产品能力       |
| `services/scheduled-task.service.ts`                                                                                           | 移除     | 当前 Canvas Agent 核心旅程无需求，删除前仍需直接调用点验证         |
| `services/mcp-server.service.ts`、`permission.service.ts`、`hook.service.ts`、`rule-composition.engine.ts`、`rules.service.ts` | 精简保留 | 保留当前 Agent 工具、权限、Hooks 和 Rules 调用分支                 |
| `services/checkpoint-git.service.ts`、`git-worktree.service.ts`、`github-connector.service.ts`、`worktree-name-generator.ts`   | 移除     | Git/Worktree/GitHub 不是 Canvas Agent 画布工具                     |
| `services/workspace.service.ts`、`workspace-snapshot.service.ts`、`project-context.service.ts`                                 | 精简保留 | 当前 SessionService/Canvas Agent 上下文闭包；去代码 Workspace UI   |
| `services/runtime-composition.service.ts`、`model-router.service.ts`                                                           | 保留     | 当前 Canvas Agent Claude/Codex 运行时组合和模型路由                |
| `services/debug-log-server.service.ts`、`validation-suggestion.service.ts`、`goal-contract.ts`                                 | 精简保留 | 当前 SessionService 迁移闭包；无调用分支在 Agent 回归后删除        |

`src/tools/*.mjs` 的 9 个生产脚本必须单列，不能再被 TS 模块统计掩盖：

| MCP 脚本                             | 处置     | 第一版边界                                                         |
| ------------------------------------ | -------- | ------------------------------------------------------------------ |
| `spark-canvas-mcp-server.mjs`        | 保留     | Codex/CLI 的 49 个 Canvas 工具桥                                   |
| `image-generation-mcp-server.mjs`    | 保留     | 当前 Agent 旧图片生成路径，媒体路径等价迁移后再决定合并            |
| `media-generation-mcp-server.mjs`    | 保留     | 当前 Agent 图片/音频/视频 MCP；必须连同两个媒体 helper 打包        |
| `platform-management-mcp-server.mjs` | 精简保留 | 默认 `platform-manager` Skill 当前闭包，不恢复通用平台管理入口     |
| `spark-memory-mcp-server.mjs`        | 精简保留 | 当前 Session/Memory CLI 闭包；Memory 等价拆除和 Agent 回归后再移除 |
| `present-files-mcp-server.mjs`       | 精简保留 | 仅允许绑定 Canvas 项目产物；证明当前 Agent 无调用后可移除          |
| `browser-automation-mcp-server.mjs`  | 移除     | Browser/Playwright 域；先清配置和调用点，再从打包 allowlist 删除   |
| `debug-mode-mcp-server.mjs`          | 移除     | 旧 Debug 工具；当前 Canvas 诊断改用受控本地日志后删除              |
| `web-search-mcp-server.mjs`          | 移除     | 通用 Web Search 域；当前影视生产没有首版产品承诺                   |

当前 `copyRuntimeToolsPlugin()` 会无条件复制 9 个脚本，必须改为与上述处置一致的显式 allowlist。另有打包 P0：`media-generation-mcp-server.mjs` 相对 import `../services/media/media-extract.mjs` 和 `media-request-compiler.mjs`，插件却只复制 `src/tools/*.mjs`；当前 `out/main/services/media/` 不存在，安装产物中的 `spark_media` 会缺运行文件。不能用源码目录单测替代打包子进程实跑。

包级运维脚本也不进入产品运行闭包，但必须随领域处置：

| 脚本                                       | 处置     | 边界                                                             |
| ------------------------------------------ | -------- | ---------------------------------------------------------------- |
| `scripts/migrate-orphan-memories.mjs`      | 移除     | 只迁移旧 Spark 数据；新应用明确不打开旧库                        |
| `scripts/smoke-test-memory-extraction.mjs` | 精简保留 | 当前 Memory 闭包的开发验证；等价拆除 Memory 后随对应测试一起移除 |

该处置接受当前实现带来的较大闭包，不把通用 Team、Workflow、Memory 等重新定义为产品功能。第一版只能在保持现有 Canvas Agent 行为、模型路径和 49 个工具回归通过的前提下逐项缩小依赖；轻量助手重写属于第一版之后的新决策。

## 9. Storage

### 9.1 Repository

| 模块/范围                                                                                           | 处置     | 说明                                                           |
| --------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| `database.ts`、`repository.ts`、`repositories/base.repository.ts`                                   | 保留     | SQLite/WAL/Repository 基础                                     |
| `repositories/canvas.repository.ts`                                                                 | 替换     | SQLite 收缩为项目索引、查询缓存和同 revision 恢复镜像          |
| `repositories/provider.repository.ts`                                                               | 保留     | 文本/媒体 Provider                                             |
| `repositories/settings.repository.ts`                                                               | 保留     | 应用设置                                                       |
| `repositories/media-generation-task.repository.ts`、`media-model-manifest.repository.ts`            | 保留     | 媒体任务和模型清单                                             |
| `repositories/model-profile.repository.ts`、`usage-ledger.repository.ts`                            | 保留     | Canvas Agent 模型配置与本机 token/cost 观测；不充当 Spark 云账 |
| `index.ts`、`repositories/index.ts`                                                                 | 精简保留 | 只导出保留 Repository                                          |
| `migrations/index.ts`                                                                               | 替换     | 只发现 Canvas 新基线及后续 migration，不加载旧平台升级链       |
| `segment-cjk.ts`                                                                                    | 精简保留 | 当前 Memory 闭包使用；Memory 从 SessionService 拆除后再移除    |
| Agent、Connector、Context、Event、Goal、MCP、Memory、Permission、Rules Repository                   | 精简保留 | 当前 Canvas Agent/SessionService 直接闭包                      |
| Session、Session Summary、Skill、Skill Registry、Team、Turn Request、Workflow、Workspace Repository | 精简保留 | 当前 Canvas Agent 会话、Skill、事件和上下文闭包                |
| Scheduled Task、Task Execution Repository                                                           | 移除     | 不属于当前 Canvas Agent 核心；删除前完成直接调用点验证         |

第一版冻结、不得在 Agent 回归前删除的 Repository 至少包括：

`agent`、`connector`、`context-preference`、`event`、`goal`、`mcp-server`、`memory-entity`、`memory-search`、`memory`、`permission`、`rules`、`session-summary`、`session`、`skill-registry`、`skill`、`team-definition`、`team-discussion`、`team-dispatch`、`turn-request`、`workflow-run`、`workflow`、`workspace`。

### 9.2 Migration

负责人已确认新应用全新开始，不打开或升级旧 `spark.db`。当前 53 个 migration 不进入新应用运行时升级链；在新 schema 基线与空目录启动测试完成前暂留源码作为结构证据，随后归档或移除。

可用于推导新基线字段和约束的历史 migration：

- `002_add_keystore_ref.sql`
- `004_add_model_profiles.sql`（混合模式保留）
- `010_app_settings.sql`
- `011_usage_ledger.sql`、`051_usage_reasoning_tokens.sql`（混合模式保留）
- `027_canvas_snapshots.sql`
- `029_media_generation_tasks.sql`
- `031_canvas_project_root_path.sql`
- `033_media_model_manifests.sql`
- `035_canvas_project_pinned.sql`
- `036_canvas_project_cover_url.sql`

`001_initial_schema.sql` 同时建立大量旧平台表，不能作为新装基线原样复用。正确顺序是：

1. 应用已冻结的 `com.spark.canvas.desktop`、`SparkCanvas.CloudAuth` 和 `spark-canvas` Provider vault，并固定新 `userData`、`spark-canvas.db` 和默认 `projects/`。
2. 从保留 Repository、Canvas Agent 闭包和混合模型路径推导新 schema。
3. 建立全新安装基线，并幂等种入唯一默认 Canvas Assistant、批准的 4 Skills、批准的媒体 manifest 集合和设置；当前运行时基线为 101 项，预期数量和 ID 从批准集合读取，不自动导入宿主 Skills。
4. 在空目录验证创建、重启、升级一个新版本和异常恢复。
5. 验证用户主动执行的 v3 目录项目包与 v1/v2 JSON 兼容导入，不扫描旧 Spark 目录、不读取包外路径。
6. 将 migration 注册器切到新链后，再归档或移除 53 条旧平台 migration。

`packages/storage/scripts/verify-migrations.mjs` 继续 `保留`，改为校验新基线和新链连续性；不再把旧 Spark 数据库升级作为 Canvas 发布门槛。

## 10. Protocol 与 Shared

### 10.1 `packages/protocol/src`

| 模块/范围                                                                                | 处置     | 说明                                                                               |
| ---------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `canvas-prompt.ts`、`canvas-prompt-ipc-augmentation.ts`                                  | 保留     | Canvas prompt 协议                                                                 |
| `custom-media-manifest.ts`、`media-config.ts`、`media-model-contract.ts`                 | 保留     | 媒体模型配置和契约                                                                 |
| `media-model-manifest.ts`、`media-model-manifest-validation.ts`、`model-capabilities.ts` | 保留     | 模型清单、校验和能力                                                               |
| `provider-export.ts`、`provider-presets.ts`                                              | 精简保留 | 限制到保留 Provider；凭据不得明文导出                                              |
| `ipc/index.ts`                                                                           | 替换     | 336 request、38 stream；按 Canvas/Provider/Auth/Platform Model/Settings/Video 拆域 |
| 根 `index.ts`、`schemas/index.ts`                                                        | 精简保留 | 收缩 exports 和 schema                                                             |
| `events/index.ts`                                                                        | 保留     | 当前 Canvas Agent/ChatPanel 流式事件协议                                           |
| `auto-router-provider.ts`、`local-cli-provider.ts`、`model-router.ts`                    | 精简保留 | 当前 Agent 模型路径；显式区分 BYOK 与 Spark 托管来源                               |
| `connectors.ts`、`history-import.ts`、`hooks.ts`                                         | 移除     | Remote、历史导入、Agent Hooks                                                      |
| `scheduled-task-export.ts`、`workflow-tools.ts`                                          | 移除     | Scheduler、Workflow                                                                |

### 10.2 `packages/shared/src`

| 模块                    | 处置     | 说明                                                                   |
| ----------------------- | -------- | ---------------------------------------------------------------------- |
| `logger/index.ts`       | 保留     | 本地日志                                                               |
| `errors/index.ts`       | 保留     | 通用错误                                                               |
| `keystore/index.ts`     | 替换     | 后端账户继续共享；本地 Auth/BYOK 凭据使用新 namespace，不读旧 Keychain |
| `constants/index.ts`    | 精简保留 | 清理旧平台常量                                                         |
| `model-capabilities.ts` | 保留     | Provider/模型能力                                                      |
| `edu-asset-url.ts`      | 精简保留 | `yiqibyte` 仍是共享 Spark 上传域；收敛为官方资产 URL 解析              |
| `team-avatar.ts`        | 移除     | Team 域                                                                |
| 根 `index.ts`           | 精简保留 | 只导出保留模块                                                         |

## 11. 桌面资源、脚本和发布

### 11.1 `apps/desktop/resources`

| 范围                              | 处置     | 说明                                                                |
| --------------------------------- | -------- | ------------------------------------------------------------------- |
| `entitlements.mac.plist`          | 精简保留 | 按独立产品实际权限复核                                              |
| `icon.*`、`taskbarIcon*`、`tray*` | 替换     | 全部仍是旧品牌；若取消 Tray，同时删除 Tray 资源                     |
| `source/*`                        | 替换     | 旧图标源，不进入最终品牌资产                                        |
| `skills/canvas-studio/**`         | 保留     | 当前 Canvas Agent 第一版强制 Skill                                  |
| `skills/multimedia-use/**`        | 保留     | 当前 Canvas Agent 媒体模型使用闭包                                  |
| `skills/video-workflow/**`        | 保留     | 首版 FFmpeg 视频处理 Skill，加入默认 Canvas Assistant               |
| `skills/platform-manager/**`      | 精简保留 | 当前 Canvas Agent 配置闭包；不恢复通用平台管理入口                  |
| 其余 `skills/**`                  | 移除     | 当前 Agent Skill 选择范围收紧后，删除代码、搜索、前端设计等无关资源 |

156 个资源文件中绝大多数属于 16 组旧 App Skill。收缩 `AppSkillsManager` 前先完成 FFmpeg installer 和 Canvas 文本增强解耦；不要因资源目录可删而反向破坏运行时。

资源是否在源码中保留和是否允许进入安装包是两个维度。当前 `extraResources` 会分发全部 16 个 Skills，而 T-003 只批准 4 个；Renderer 还包含无完整来源链的图片和 3D 模型。实施时按[资源来源、许可与发布门审计](./2026-07-17-canvas-resource-provenance-release-gates.md)的 T-012 manifest 显式 allowlist，未批准资源不得进入 candidate/stable。

构建还会运行 `prepare:file-viewer-assets`，向忽略的 `apps/desktop/public/file-viewer` 生成 14 个文件、41,088,016 字节，包括 Typst/CAD/SQLite/libarchive WASM 和 DOCX/XLSX/PDF worker。它们会经 Vite 进入 Renderer 产物，虽然不在 Git 源码资源计数中，也必须逐项进入 T-012 approved manifest、许可证和 notices。根 `public/file-viewer` 还有 13 个、38,727,884 字节的本地重复生成物，不是当前 Desktop 构建输入，应保持忽略并避免被其他发布脚本误收集。

### 11.2 脚本

| 脚本/范围                                                                          | 处置     | 说明                                                                               |
| ---------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `build-mac-release.sh`、`build-win-release.sh`、`notarize.js`、`import-cert-ci.sh` | 替换     | 更新产品名、签名、仓库和发布源                                                     |
| `rebuild-native-for-electron.sh`、`verify-native-electron-abi.cjs`                 | 保留     | SQLite/keytar/native ABI 构建与验证                                                |
| 根 `scripts/sqlite-abi.sh`、`vendor/prebuilds/better-sqlite3/**`                   | 替换     | 当前两份二进制都只适用 Darwin arm64；按 target 键控或可复现构建                    |
| `regenerate-icons.py`、`list-icns-types.py` 及图标预览文件                         | 替换     | 新品牌资产生成后复核保留                                                           |
| `register-release.mjs`                                                             | 替换     | 旧发布服务不可沿用                                                                 |
| `scan-client-i18n.mjs`                                                             | 保留     | 清理旧词条时继续使用                                                               |
| `download-browser.js`                                                              | 移除     | Playwright 删除后移除                                                              |
| `copy-file-viewer-assets.mjs`                                                      | 精简保留 | 当前 Agent/Markdown 文件预览闭包未拆除；生成资产必须进入 T-012，证明无调用后再移除 |
| `use-original-logo.py`                                                             | 移除     | 旧品牌辅助脚本                                                                     |
| `generate-windows-self-signed-cert.ps1`                                            | 替换     | 仅作为开发签名工具保留时更新产品和证书标识                                         |
| 根 `scripts/debug-mcp/**`                                                          | 移除     | MCP 调试                                                                           |

### 11.3 配置与工作流

| 配置/工作流                                     | 处置     | 说明                                                                                |
| ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `electron-builder.yml`                          | 替换     | 写入 `com.spark.canvas.desktop`、`Spark Canvas`、`spark-canvas`，再替换图标和发布源 |
| `dev-app-update.yml`                            | 替换     | 新更新源                                                                            |
| `electron.vite.config.ts`                       | 替换     | 工具脚本和 helper 使用显式 allowlist；删除旧资源和包的 external/打包规则            |
| `playwright.config.ts`、`apps/desktop/e2e/**`   | 精简保留 | 保留桌面产品 E2E 并改成 Canvas 核心/品牌旅程，不等同于应用内 Playwright Agent       |
| `.github/workflows/publish-desktop-release.yml` | 替换     | 新仓库/Secrets/签名；Canvas prefix、candidate 注册和显式 stable promote             |
| `.github/workflows/publish-website.yml`         | 移除     | D-016 已确认首版断开旧官网；未来官网使用独立产品发布流                              |

## 12. Website

`apps/website` 是完整的旧 Spark Agent 官网，不是可直接换 Logo 的 Canvas 官网。D-016 已冻结第一阶段从 workspace/CI 移除当前 Website 包，桌面稳定后再单独重建，因此下表当前源码全部按旧站移除；“以后重建”不是保留这些文件的理由。

| 范围/模块                                                                                                | 处置 | 说明                                                 |
| -------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------- |
| `src/App.tsx`、`main.tsx`、路由/主题/SEO 技术壳                                                          | 移除 | 当前旧站技术壳不进入首版 workspace；未来官网单独选型 |
| `routes/CanvasPage.tsx`、`components/CanvasWorkflow.tsx`、Canvas 相关真实截图                            | 移除 | 当前截图不作为首版官网资产；视频工作台稳定后重新拍摄 |
| `routes/HomePage`、`FeaturesPage`、`ArchitecturePage`、`RoadmapPage`、`OpenSourcePage`、`ContactPage`    | 移除 | 内容、品牌、链接和承诺均属于旧平台                   |
| `routes/Docs*`、`components/Docs*`                                                                       | 移除 | 未来官网只发布独立产品真实文档                       |
| `routes/DownloadPage`、`components/DownloadPanel`、`content/downloads*`、`lib/releases.ts`               | 移除 | 未来下载页接入 D-014/D-015 新发布链                  |
| `content/docs-pages/agents-workflows`、`board-view`、`browser-automation`、`code-development`            | 移除 | 旧 Agent/Board/Browser/代码工作台文档                |
| `content/docs-pages/long-term-memory`、`mcp-skills`、`remote-connections`、`team-mode`、`workflow-usage` | 移除 | Memory/MCP/Remote/Team/Workflow 文档                 |
| `content/docs-pages/canvas-mvp`、`image-providers`、`media-providers`、`desktop-guide`、`auto-update`    | 移除 | 未来按独立产品实际行为重写，不直接沿用旧站源码       |
| `public/showcase` 中 Agents、代码、终端、Skill、Team、Remote、Workflow 图片                              | 移除 | 对应产品域删除                                       |
| `public/showcase` 和 `public/docs/img` 中 Canvas、资产、导演台、媒体节点图片                             | 移除 | 视频工作台稳定后使用独立产品新截图                   |
| `public/avatars/**`                                                                                      | 移除 | 旧 Agent/用户头像                                    |
| `public/canvas-nodes/**`                                                                                 | 移除 | 未来示例素材重新走授权和产品一致性审计               |
| `public/icon.png`、manifest、robots、sitemap、`llms*.txt`                                                | 移除 | 旧品牌、域名和路由不进入未来官网                     |
| `scripts/fetch-downloads.mjs`、部署脚本、Dockerfile/nginx                                                | 移除 | 旧仓库、镜像、主机和无 product 下载链全部退出        |
| `index.html`、`package.json`、`vite.config.ts`、`tsconfig.json`                                          | 移除 | 当前 Website 包从首版 workspace 移除                 |
| `.env.example`、`.dockerignore`、`.npmrc`                                                                | 移除 | 未来官网单独建立环境和部署边界                       |
| Website 独立 `pnpm-lock.yaml`                                                                            | 移除 | monorepo 统一由根 lockfile 管理，避免双锁漂移        |

D-016 已确认第一轮独立化不把官网重写设为桌面运行闭包或 stable 阻塞项。先从默认 workspace/CI/发布链移除旧官网，画布视频工作台核心旅程稳定后再单独重建。

## 13. 仓库清单与包身份

| 范围/文件                                            | 处置     | 说明                                                                      |
| ---------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `.node-version`、`.nvmrc`、`.npmrc`                  | 保留     | 固定并实际使用 Node 22.14.x / pnpm 11                                     |
| `.gitattributes`、`.gitignore`、`.prettierrc`        | 精简保留 | 保持跨平台文本、生成物忽略和格式基线；随新产物路径更新                    |
| `eslint.config.js`、`tsconfig.base.json`             | 精简保留 | 包删除后收缩路径，不做无关规则重写                                        |
| 根 `package.json`                                    | 替换     | 更名、描述、脚本和 workspace 随域删除逐步收缩                             |
| `pnpm-workspace.yaml`                                | 精简保留 | D-016 实施时不再纳入当前 `apps/website` 包                                |
| `pnpm-lock.yaml`                                     | 精简保留 | 只随经过验证的依赖变更更新，不手工清理                                    |
| 各 `packages/*/package.json`                         | 精简保留 | 先收缩 exports/dependencies；`agent-runtime` 真正无 Agent 后再改名        |
| `apps/desktop/package.json`                          | 替换     | 产品描述、版本、依赖、构建脚本和发布身份                                  |
| `apps/*/tsconfig*`、Vite/Vitest/Playwright 配置      | 精简保留 | 官网随 D-016 处置；桌面与包级配置按保留源码和测试矩阵收缩                 |
| `packages/*/tsconfig.json`、`vitest.config.ts`       | 精简保留 | 包删除或测试范围变化时同步收缩，不为品牌做无关重写                        |
| `README.md`、`CHANGELOG.md`、`welcome.md`、`test.md` | 替换     | 对照独立产品重写或删除过期入口，不能继续描述完整 Agent 平台               |
| `LICENSE`                                            | 待确认   | 当前个人使用限制不能直接批准商业稳定发布；按 T-012 完成书面授权或重新许可 |
| `AGENTS.md`、`CLAUDE.md`                             | 保留     | 项目治理规则；实施阶段持续维护                                            |
| `docs/design/**`、`docs/superpowers/**`              | 精简保留 | 作为当前/历史设计证据逐份核对；过期计划按文档保鲜规则更新或废弃           |
| `.agents/`、`.claude/`、`.codex/`、`.cursor/`        | 保留     | 当前机器上的 Agent 治理/技能配置，受全局 ignore；不属于产品运行或安装闭包 |
| `vendor/prebuilds/better-sqlite3/**`                 | 替换     | 测试辅助而非安装资源；现有 Node/Electron 文件都是 Darwin arm64            |

## 14. 包依赖处置摘要

### 14.1 高置信保留

- `better-sqlite3`
- `keytar`
- `@xyflow/react`
- `three`、`@react-three/fiber`、`@react-three/drei`（二期源码/数据兼容保护，不是首版默认能力）
- `zod`
- `exceljs`、`mammoth`（按文档输入范围精简）
- `electron-updater`（若继续桌面自动更新）
- `@napi-rs/canvas`（当前 APIMart 图片处理需要）

### 14.2 第一版 Canvas Agent 闭包保留

- `@openai/codex-sdk`
- `@anthropic-ai/claude-agent-sdk` 及平台包
- `@anthropic-ai/sdk`
- `@modelcontextprotocol/sdk`
- `openai`
- `diff`
- `sqlite-vec`

生产依赖中的 `npm` 以及 Chat/Markdown 文件展示使用的 `@file-viewer/*`、`pdfjs-dist`，在第一版 Agent/打包回归前也不批准删除；只有证明当前 Canvas Agent 不调用后才能清理。保留 file-viewer 时，其动态生成的 14 个 WASM/worker 必须按最终产物资源纳入 T-012。

### 14.3 旧平台域删除后移除

- `@larksuiteoapi/node-sdk`
- `@playwright/mcp`、应用内 `playwright`
- `node-pty`、`@xterm/*`

上述依赖真正移包前必须再检查动态 import、Canvas Agent executor 组合和打包产物。

## 15. 删除顺序和硬门槛

T-010 已在[旧平台删除顺序与生产发布安全门](./2026-07-17-canvas-platform-removal-release-gates.md)中冻结为九个依赖批次。下表保留总览，专项文档中的受保护闭包、逐域检查单和发布状态机优先于旧的目录级删除理解。

| 顺序 | 域                                  | 删除前必须满足                                                                                |
| ---: | ----------------------------------- | --------------------------------------------------------------------------------------------- |
|    1 | 旧导航和页面挂载                    | Canvas 项目列表、工作区和精简设置可以独立完成核心旅程                                         |
|    2 | SessionSidebar/旧平台启动副作用     | Canvas Window 不再启动 Workspace、Session、Agent、Terminal 查询/订阅                          |
|    3 | Canvas IPC                          | preload/main 双层默认拒绝、资源归属校验和定向 stream；通用 `workspace:open` 不再暴露给 Canvas |
|    4 | 共享 Spark 云                       | T-013 的计费域固定、token 边界、订单幂等、上传生命周期和故障矩阵通过；BYOK 对 Spark 请求为 0  |
|    5 | Skill Store                         | FFmpeg 安装器已迁出；保留 4 Skills 与 Agent Skill 运行时，仅删除通用商店和 Registry           |
|    6 | Canvas Agent                        | 当前会话、模型路径和 49 个工具通过回归；所需 IPC/存储/依赖有明确清单                          |
|    7 | Chat/Agent/Team/Workflow/MCP/Memory | 只删除 Canvas Agent 闭包外的产品域；每项调用点和 handler 逐项归零                             |
|    8 | Git/Terminal/Playwright/Remote      | Canvas 核心和精简设置没有运行时调用                                                           |
|    9 | Protocol/Storage/Migration          | `spark-canvas.db`、原子保存、revision 对账、幂等 seed 和 v3 项目包通过                        |
|   10 | 品牌、官网和发布                    | 新身份与经核验的原生产签名已落地；stable 四级状态机、安全门和产品隔离通过                     |

每删除一个域，必须重新执行：

1. 生产调用点和动态 import 检索。
2. IPC request/stream 声明与 handler 对账。
3. Repository 和 migration 影响核对。
4. 相关单元测试、typecheck、构建和至少一条核心旅程。
5. `git diff` 范围检查。

## 16. 总负责人控制线

在后续实施中，以下规则作为不可跳过的总控约束：

- 产品定位已经确认，后续不得把范围滑向通用多媒体画布或传统视频剪辑器。
- Canvas Agent、混合模型、全新本地数据、`Spark Canvas` 品牌、应用身份和复用原生产签名身份已确认；其余发布项继续设独立决策门。
- Spark Auth、Platform Model、云端 Usage、支付和上传是批准共享的基础设施，不纳入旧平台删除清单；本地 Usage Ledger 不是云账。
- T-013 已冻结：当前托管范围只含文本；BYOK/托管不静默回退，Spark 上传是显式策略，token 不进 Renderer。
- 新应用不得扫描、读取、升级或写入旧 `spark.db`、Keychain、localStorage、项目索引和 Agent 历史。
- 目录项目包导入和媒体可移植性是无自动迁移策略下的数据入口，属于首版 P0。
- 15 个操作契约、13 个 capability、12 个节点新建入口必须逐项对账；不以类型数量替代可达功能验收。
- 当前媒体 seed 基线是运行时 101 项；结构、语义、preset 精确引用和自定义合成规则必须共同通过。
- 9 个 MCP 工具脚本、2 个媒体 helper、动态 file-viewer 资产和 native prebuild 都属于构建/测试闭包，不能因不在 TS 或 Git 资源计数中漏审。
- 先断运行时挂载和启动，再删源码；先迁出隐藏依赖，再删所属旧域。
- 3000 行以上文件不再直接增加业务代码；优先让已有拆分模块接管逻辑。
- 每次只删除一个领域，不做跨域“大扫除”提交。
- 项目目录权威、SQLite revision 镜像、Renderer 草稿边界、v3 项目包和三种项目生命周期已冻结为数据安全 P0，按数据专项批次实施。
- GitNexus 当前索引不对应本仓库，继续按项目降级规则使用源码、`rg`、测试、日志和 Git 证据；索引恢复健康前不把它作为交付门槛。

## 17. 已冻结的决策门

按顺序一次确认一个：

1. 产品定位：**已确认 AI 影视/短剧工作台**。
2. Canvas Agent：**已确认第一版核心保留当前实现**。
3. 模型商业模式：**已确认 BYOK + 官方托管，并完全共用原 Spark 账户、账务和上传空间**。
4. 数据兼容：**已确认全新开始，不自动迁移旧本地数据；旧项目仅手工导入**。
5. 品牌与应用身份：**已确认 `Spark Canvas`、`com.spark.canvas.desktop`、`spark-canvas` 和新本地凭据 namespace**。
6. 生产签名：**已确认同一合法发行主体且证书可用时复用原生产身份；证书、公证和时间戳核验为公开发布硬门**。
7. GitHub Release：**已确认当前 `alexanderizh/Spark-Canvas` 仓库同时承载源码和 Release**。
8. 版本中心：**已确认共用原基础设施并实施严格 v2 `spark-canvas` 全链 product 分区；服务端实施验收仍是发布硬门**。
9. 第一阶段官网：**已确认从 workspace/CI 移除旧官网，桌面稳定后单独重建；画布视频工作台可用是首版 P0**。
10. 首发平台：**已确认 macOS arm64、macOS x64、Windows x64；三个目标分别通过 native ABI、签名、FFmpeg 和视频工作台 Gate，Linux/Windows arm64 后续**。
11. FFmpeg 分发：**已确认沿用原按需下载体验，不随安装包捆绑；managed 本地版本优先，兼容的系统 PATH FFmpeg 兜底；以 Spark Canvas 专用受信 descriptor、独立安装器和合规制品替换旧通用 Registry 链和当前四个已拒绝 ZIP**。

本总账中十一项决策以及 D-014 至 D-018 已全部冻结，不再有待负责人选择的发行决策；FFmpeg 许可与替代制品仍按 E-005 独立证据 Gate 实施和验收。

本总账剩余 `待确认` 行只剩 `LICENSE`，归 E-006/RES-0，由有权限的发行主体与法律负责人提供商业授权或重新许可证据；它是 candidate/stable 硬门，不是可用偏好选择绕过的 D-019。生产证书真实性同理由 E-002/E-003 证据包验收，不重新打开已冻结的 D-013。
