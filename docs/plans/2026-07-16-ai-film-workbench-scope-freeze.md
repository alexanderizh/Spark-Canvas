# AI 影视/短剧生产工作台独立化范围冻结

> 状态: 实施中 | 最后核对: 2026-07-20

## 1. 决策记录

负责人于 2026-07-16 确认产品定位：

> AI 影视/短剧生产工作台：项目 -> 文稿/剧本 -> 角色与场景 -> 分镜 -> 关键帧 -> AI 视频 -> FFmpeg 后处理。

负责人同日确认 Canvas Agent 选择方案 1：

> 现有 Canvas Agent 作为第一版核心能力保留。

该决定保留画布内现有 Agent 交互、49 个画布工具以及其当前 Session、Agent、Skill、MCP、权限、事件和 Claude/Codex 执行闭包。第一版不以轻量助手重写替代现有实现，也不能在没有完整回归证据时删除上述依赖。

保留 Canvas Agent 不等于恢复通用 Agent 平台。旧 Chat 首页、Session Sidebar、Agent/Team/Workflow/MCP/Skill Store 管理页面和代码工作台仍不进入独立产品信息架构；仅 Canvas Agent 当前运行实际需要的共享 UI、协议、存储和服务作为首版例外保留。

负责人于 2026-07-17 确认模型商业模式和云服务边界：

> 第一版采用混合模式；BYOK 与官方托管模型并存。官方托管路径与原 Spark Agent 完全共用账户、余额、套餐、订单、支付和上传空间。

因此 Spark Auth、Platform Model/NewAPI、云端用量、支付和 `/api/v1/upload` 是批准保留的共享云基础设施，不为 Canvas 建立独立账户、独立余额或独立上传命名空间。BYOK 仍是无需登录即可使用的独立路径；官方托管模型必须明确显示账户、额度和费用，不允许在两种模式之间静默切换或扣费。本地 `UsageLedgerService` 只做设备侧 token 观测，不是共享账单。

负责人同日确认本地数据选择方案 3：

> 新 Canvas 应用全新开始，不自动迁移或读取原 Spark Agent 的本地数据。

新应用使用独立 `userData`、SQLite、项目根、localStorage 和 Keychain 命名空间。它不扫描、不复制、不升级旧 `spark.db`，不读取旧 BYOK Key、Spark 登录态、Canvas Agent 会话、用户 Agent/Skill 或偏好。用户需要重新登录同一 Spark 云账户、重新配置 BYOK，并通过明确的 JSON/目录项目包导入旧项目；原 Spark 本地数据保持原样、不被新应用写入。

负责人同日确认正式产品名：

> Spark Canvas

负责人随后选择应用身份方案 1：

> Electron `appId` 使用 `com.spark.canvas.desktop`，URL scheme 使用 `spark-canvas`，Cloud Auth Keychain service 使用 `SparkCanvas.CloudAuth`，Provider vault service 使用 `spark-canvas`。

`Spark Canvas` 用于桌面显示名、安装包名、关于页、系统通知、新导出标识和官网文案，并明确它是使用同一 Spark 云账户的独立视频创作产品。内部 `@spark/*` 包名第一阶段保持不变；新的应用身份不得读取旧 `com.spark-agent.desktop`、`spark-agent://`、`SparkAgent.CloudAuth` 或 `spark-agent` Provider vault。

负责人随后确认生产签名选择方案 1：

> Spark Canvas 与原 Spark Agent 由同一合法主体发行时，复用原 macOS/Windows 生产签名身份。

该选择不豁免发布核验：原 Apple Developer Team、Developer ID、公证权限和 Windows 受信任证书必须仍然有效且获授权；真实 Subject/Team/Issuer/有效期未核验、Windows 只有自签名证书或签名可降级时，只允许内部构建。GitHub Release 已确认由当前 `alexanderizh/Spark-Canvas` 仓库承载，版本中心已确认共用原基础设施并实施严格 v2 `spark-canvas` 全链 product 分区；官网和首发平台继续单独确认。

负责人随后确认 D-016：

> 第一阶段从 workspace 和 CI 断开旧 Spark Agent 官网，桌面独立化不等待官网；桌面稳定后再单独重建 Spark Canvas 官网。首版核心是画布视频工作台可用。

该决策已完成物理断开：`pnpm-workspace.yaml` 只纳入 `apps/desktop` 和 `packages/*`，lockfile 不再包含 Website importer，旧 `.github/workflows/publish-website.yml` 已删除。`apps/website` 源码暂留作历史参考，但不进入 workspace、CI 或 Spark Canvas 首版桌面构建/发布闭包；独立官网在桌面稳定后重建，不阻塞首版。画布视频工作台可用是首版 P0：导入视频后，探测、抽帧、裁剪、转码/分段和产物回填至少有一条代表性 Electron 旅程可重复通过；当前分支已补齐真实视频 E2E，并验证分段产物全量登记，三个首发安装包仍须分别复验。该承诺不扩张为成熟多轨剪辑、完整字幕/BGM/调色或广播级导出。

负责人随后确认 D-017：

> 首发支持 macOS arm64、macOS x64 和 Windows x64；Linux 与 Windows arm64 后续支持。

三个首发目标必须分别通过应用身份、生产签名、原生模块 ABI、FFmpeg 能力和画布视频工作台打包旅程；任一目标未通过就不能对外宣称该目标受支持。Linux/Windows arm64 的源码兼容可以保护，但其构建、签名、FFmpeg 和客服矩阵不阻塞首版。

该选择替代以下两个备选方向：

- 通用 AI 多媒体画布。
- 传统视频剪辑器。

从本文件开始，后续信息架构、模块去留、验收旅程和实施计划均以 AI 影视/短剧生产工作台为准。未经新的负责人决策，不把范围滑向通用 Agent 平台、通用多媒体工作流市场或传统多轨剪辑器。

上游证据：

- [架构与功能审计](./2026-07-16-canvas-standalone-audit.md)
- [源码依赖切片](../reviews/2026-07-16-canvas-standalone-dependency-slice.md)
- [模块处置总账](../reviews/2026-07-16-canvas-module-disposition-ledger.md)
- [旧身份与云耦合审计](../reviews/2026-07-16-canvas-identity-cloud-coupling.md)
- [共享 Spark 云、计费与上传契约审计](../reviews/2026-07-17-canvas-shared-spark-cloud-contract.md)
- [数据权威、空库启动与项目包审计](../reviews/2026-07-17-canvas-data-authority-bootstrap.md)
- [签名、发布与更新链审计](../reviews/2026-07-17-canvas-release-signing-readiness.md)
- [版本中心产品隔离与更新完整性审计](../reviews/2026-07-17-canvas-version-center-product-isolation.md)
- [发行决策就绪审计](../reviews/2026-07-17-canvas-release-decisions-readiness.md)
- [FFmpeg 分发物来源与发布门审计](../reviews/2026-07-17-canvas-ffmpeg-artifact-provenance-release-gates.md)
- [资源来源、许可与发布门审计](../reviews/2026-07-17-canvas-resource-provenance-release-gates.md)
- [审计覆盖与决策总表](../reviews/2026-07-17-canvas-standalone-audit-coverage.md)

## 当前实施快照

截至 2026-07-20，当前分支已实施：

- 独立 `Spark Canvas` 产品身份、`userData` / SQLite / Keychain / URL scheme 命名空间和 Canvas-only 主壳；当前主壳只保留“项目、模型服务、账户、设置”四个一级入口。
- D-016 已落地：旧 `apps/website` 源码仍保留，但已从 workspace、lockfile importer 和 CI 发布链断开；官网重建不阻塞桌面首版。
- 画布项目创建、独立 Canvas 窗口、Canvas Agent 和视频工作台入口的真实 Electron E2E。
- `055_canvas_assistant_default.sql` 将已种入的内置 Canvas Assistant 设为数据库唯一默认 Agent 并清除其他默认标记；Canvas Assistant 缺失时不会清空原默认。该迁移不改写任何既有 `sessions.agent_id`，只为既有 Canvas Assistant 会话补 `metadata.surface=canvas`。
- Session 的缺省创建、损坏/NULL Agent 运行回退、读取摘要和 RuntimeComposition 缺省层均已统一为 Canvas Assistant；显式有效 Agent（包括旧 `platform-manager-agent`）仍优先命中且不会被改写，旧 Team metadata 的 host fallback 保持在团队兼容边界内。
- `session:list` 支持 `surface=canvas` 并在 SQL 分页前同时过滤 workspace JSON 与 metadata surface；`CanvasAgentModal` 只请求并接管 Canvas 会话，非 Canvas created stream 不会被画布接管。
- `CanvasOperationPanel`、`CanvasOperationPresetModal` 和 `CanvasInlineAiComposer` 三个画布文本入口，以及后端 `canvas:task:generate-text`，只允许内置 Canvas Assistant；平台管理 Agent、自定义 Agent 均被拒绝，Canvas Assistant 缺失、禁用或不是 built-in 时 fail closed。
- Skills 启动 bootstrap 与 `skill:list` 精确收口到 4 个批准 Skill：`canvas-studio`、`multimedia-use`、`video-workflow`、`platform-manager`。画布会话不再挂载 `spark_platform` 或原生全量 Skill 插件，仅暴露内置 Canvas Assistant、49 个画布工具和这 4 个 Skill；`platform-manager` 只是批准的 Skill，不是数据库默认 Agent。
- 共享 Spark 云账户、余额、消耗与近期用量 UI，BYOK 仍可脱离登录配置。
- 画布输入传输已收口到独立模块：`auto`/未指定默认把本地图片、音频和视频转为 base64，不请求 Spark；只有显式 `cloud_url` 才调用共享 Spark 上传，失败保持原 Provider 并明确失败。显式上传支持图片、音频和视频，并保留输入 type/role。
- 媒体任务持久化只在 `input_files_json` 保存输入的 `type`、`role`、`mimeType`，不落 URL、`aiUrl`、data URL/base64 或本地绝对路径；`raw_response_json` 通过 `compactForLog` 脱敏，`requestCall.body` 与 `requestCall.response` 同样脱敏，`requestCall.url` 则按设计保留原始 Provider endpoint，是明确例外。
- 主进程共享上传现已执行 canonical SafeFile 白名单、符号链接逃逸、普通/非空文件、100 MB 和 raster 图片/常用音视频 MIME 校验；登录、注册、短信、微信和刷新 IPC 只向 Renderer 返回非敏感会话状态，Cloud Auth/NewAPI 凭据留在主进程凭据域。
- Provider vault 已从 Auth IPC 注册迁到数据库初始化后的启动阶段：macOS 集中 vault 可一次性导入 `safeStorage` 加密文件并原子替换，独立 `spark-canvas` namespace 不读取旧 `spark-agent` 凭据；Provider 凭据持久化、托管凭据恢复和账号归属校验均 fail closed，失败会向调用方传播而不静默回退。
- 系统 `ffmpeg + ffprobe` 同目录同版本回退，旧 Registry/MinIO 安装链已切断；未有批准制品时托管安装 fail closed。
- 项目普通删除保留磁盘目录，视频产物使用系统播放器打开，Provider 普通导出不再包含 Keychain API Key。
- 画布保存已使用 per-project mutation revision：保存期间再次编辑不会误清 dirty；项目 `project.json`、`snapshots/latest.json` 和日期快照均经临时文件 + rename 写入，文件提交失败时不会继续更新 SQLite。
- v3 目录项目包已实现对称导出/导入，manifest 使用相对 POSIX 路径、SHA-256、大小和 MIME，并在临时目录完整校验后 rename；legacy v1/v2 目录桥只映射旧包记录根下的 `assets/`，支持跨平台 Windows 路径，包外/缺失引用跳过并产生 warning。旧 JSON 快照继续作为独立入口，绝不读取绝对路径或 `safe-file://` 指向的本机文件。
- `spark_media` 打包闭包已补齐 `media-extract.mjs`、`media-request-compiler.mjs` 两个 helper，并以构建产物子进程启动测试验证；构建会先清空 `out/main/tools`，再只复制 `image-generation`、`media-generation`、`platform-management`、`present-files`、`spark-canvas` 和 `spark-memory` 6 个批准的 MCP server。Canvas surface 不再自动解析 Web Search、Browser Automation 或 Debug MCP。
- 旧 Remote Connection 运行时不再随应用启动，旧 Remote 回信目标和 Session 事件死代码已移除；Canvas Agent 的权限请求、完成、失败、取消、等待输入和重启恢复通知，以及 MCP OAuth/托管 Skill metadata，均统一使用 `Spark Canvas` 品牌。
- Desktop IPC 已建立严格产品闸口：独立的共享 policy 精确允许 115 个 invoke 与 14 个 stream，主进程在唯一 `ipcMain.handle` 注册点清理旧 handler 后 fail closed，preload 在触达 Electron 前同时校验 `invoke/on`。Terminal 与 GitHub Connector 注册入口已移除；运行态最新启动实际注册 115 个唯一 handler，与 policy 完全一致，Board、Team、Workflow、Remote、Scheduler/Task Execution、Terminal、Skill Registry、Playwright、GitHub Connector、History Import、Memory、Rules、MCP 管理、Command 和 Usage 旧域均为 0。完整 Canvas、Spark Auth/上传、Platform Model/支付和 BYOK Provider 域继续保留。
- Scheduled Task/Task Execution 已作为首个旧平台域完成全纵向物理删除：专属页面/样式、15 个 invoke、1 个 stream、main service/executor、protocol types/export schema、agent-runtime 出口、storage 出口和两个 Repository 均已移除；migration 024 暂留到 Canvas 最小数据库基线单独落地。删除边界测试、四层 typecheck、protocol/storage/agent-runtime/desktop 全量单测、Desktop build 和 Electron 核心旅程均通过。
- 内置媒体目录已校准为 102 个唯一 manifest（图片 34、视频 63、音频 5）、35 个 vendor、52 个 preset、24 个媒体 preset、99 条显式 `mediaModelRefs`；非 `custom:` 引用错配和 manifest 语义问题均为 0。
- 更新客户端和 CI 候选注册已固定 v2 `spark-canvas` product/appId/prefix/hash/evidence 边界；GitHub 仅允许生成 draft，未实现 promote 前不公开 stable。
- Windows stable 发布 Gate 已禁止 signing-required 与 unsigned fallback 并用，要求 Authenticode `Valid`、非自签 signer、系统受信 signer/timestamp 链、在线吊销检查和 RFC3161 时间戳；本地非公开构建才可显式使用 unsigned fallback。真实 Windows CA 证书安装包仍需 Windows CI 验收。
- 真实视频 Electron E2E 使用 6 秒、320x180、24fps、H.264 且带 AAC 音轨的 MP4，覆盖 FFprobe、均匀抽帧、0-2 秒精确裁剪、H.264 转码和每 2 秒分为 3 段；裁剪、转码及 3 个分段共 5 条产物全部登记，验证产物可经 `file:open` 打开、关键帧以真实像素回填画布，并在保存后通过 `canvas:snapshot:load` 从 SQLite 回读 5 条产物记录。
- 正式基线 Node 22.14.0、pnpm 11.7.0 下，5 个 workspace 的类型检查全部退出码 0；fresh 全 workspace 单测为 357 个文件、2846 passed、4 todo、0 failed，Lint 为 0 errors / 1524 warnings。新增 IPC policy、主进程注册、preload、注册源和原生注册点边界定向测试为 33/33。生产构建退出码 0，产物包含 55 个 migration、2 个媒体 helper，并恰有 6 个批准 MCP server：`image-generation`、`media-generation`、`platform-management`、`present-files`、`spark-canvas`、`spark-memory`。完整 Electron 主壳/Canvas Agent/项目包/真实视频工作台旅程 fresh 4/4 通过，截图已人工核对 Canvas-only 首屏、工作区和视频回填状态。

仍未完成：

- 共享版本中心 v2 服务端 schema、token scope、对象复验、candidate 验收与事务式 promote。
- 三个首发平台的受信 FFmpeg descriptor/制品、签名证据、SBOM、许可和 notices。
- 全新 Canvas 最小数据库基线；当前新库仍沿用原平台 migration lineage 并执行 55 条 migration。
- 真实 BYOK/托管 Provider、Provider 原生上传、支付幂等、`fileKey`/owner/hash/引用/TTL 上传生命周期、生产签名和三平台安装包验收。

## 2. 产品边界

### 2.1 核心用户任务

独立产品帮助影视创作者、短剧团队或 AI 视频制作者在一个项目中完成：

1. 导入和拆分文稿。
2. 形成章节、剧本和分镜脚本。
3. 建立角色、场景、道具、特效和风格基准。
4. 用 Production Bible 约束下游视觉一致性。
5. 生成分镜、身份板、场景图和关键帧。
6. 用首帧、尾帧、参考图和 Prompt 生成视频片段。
7. 探测、抽帧、裁剪、转码并回填视频产物。
8. 保存、恢复、导出和迁移完整项目。

### 2.2 第一版产品承诺

第一版承诺的是“AI 影视生产画布可以脱离旧 Agent 平台独立运行”，不是立刻补齐所有影视后期能力。

第一版必须做到：

- 不进入旧 Chat 或 Agent 首页即可创建、打开和恢复项目。
- 可直接在画布内打开 Canvas Agent，创建或继续会话，并调用现有 49 个画布工具。
- 不登录原 Spark 账户也能完成至少一条文本、图片和视频 Provider 链。
- 登录同一 Spark 账户后可使用原有余额、套餐、订单、支付、托管模型和上传空间。
- 全新安装不依赖旧 Spark 本地目录即可完成初始化、种入默认 Canvas Agent/影视 Skills 并创建首个项目。
- 用户主动导入 JSON 或目录项目包后，项目结构与图片、音频、视频资产可用。
- 文稿、影视资产、分镜、关键帧和视频片段在同一项目内可追溯。
- 画布视频工作台的导入、FFprobe 探测、抽帧、裁剪、转码/分段和产物回填核心旅程在打包应用可重复通过。
- 所有项目资产有明确本地落点，删除、归档和恢复不会误伤磁盘文件。
- FFmpeg 的检测、安装或系统依赖路径明确。
- 安装包只启动画布核心和 Canvas Agent 明确需要的运行闭包，不启动无关的 Team、Workflow、Scheduler、Playwright、Remote 和代码工作台服务。
- macOS arm64、macOS x64、Windows x64 三个首发安装包分别通过视频工作台、FFmpeg、native ABI、签名和更新验收。

### 2.3 第一版不承诺

- 成熟的多轨视频时间线。
- 专业音频混音、调色和关键帧特效系统。
- 完整对白配音、BGM、音效和字幕编排。
- 整集/整片一键装配和广播级导出。
- 多人实时协作和云项目同步。
- 通用 Agent、Team、Workflow、MCP 或 Skill Store 平台。
- 对所有内置媒体 Provider 的持续可用性保证。

这些缺口必须如实出现在产品文案和验收报告中，不能因后端存在部分 FFmpeg 操作就宣传为传统视频剪辑器。

## 3. 第一版必须保留

### 3.1 应用壳和项目入口

- Electron 生命周期、单实例、窗口控制和安全参数。
- Canvas 项目列表作为唯一首页。
- 新建、搜索、排序、置顶、归档、恢复和删除项目。
- 项目封面、项目文件夹和默认项目位置。
- 独立项目目录和项目窗口行为。
- 精简后的首次启动与设置入口。
- 崩溃边界、本地日志、日志导出和自动更新能力。

### 3.2 项目、Board 和无限画布

- 多 Board、新建、重命名、复制、删除、排序和默认 Board。
- 一章/一集与 Board 的关联。
- 平移、缩放、框选、多选、拖动、缩放和旋转。
- 对齐、分布、层级、锁定、隐藏、复制和删除。
- 分组、组内布局、自动布局、碰撞和吸附。
- 撤销重做、手动保存、自动保存、脏状态和离开保护。
- 节点连线、来源关系、版本、确认和 stale 状态。
- 文本、Prompt、图片、音频、视频、组和 15 个 AI 操作运行契约 ID；不同入口的暴露集合并不相同。

### 3.3 文稿与影视资产

- 电影、剧集、短剧、动画、广告项目格式。
- 文稿导入、章节识别、章节拆分和章节索引。
- 文稿、章节、剧本、角色、场景、道具、特效和提示词库。
- 角色与场景字段、一致性约束、参考图、锁定项和生命周期信息。
- 从剧本提取角色和场景。
- 保存节点到影视资产库并重新插入画布。
- 资产搜索、筛选、引用位置、使用次数和主参考管理。

### 3.4 Production Bible 和分镜

- 视觉风格、色板、光照、镜头语言和画幅。
- 角色、场景和世界观一致性。
- 全片反向提示词和默认模型参数。
- 风格包转 Production Bible。
- 分镜分组、镜号、描述、对白、旁白和时长。
- 角色、场景、道具、首帧、尾帧和关键帧关联。
- JSON/Markdown 分镜表解析。
- 超长镜头拆分、分镜宫格和关键帧转换。
- 镜头状态、多个产物版本和回链。

### 3.5 Prompt、Provider 和 AI 任务

- Lexical Prompt 文档、节点/资产引用和连接上下文。
- first frame、last frame、reference 和 mask 输入角色。
- 项目 Prompt、反向 Prompt 和 Production Bible 继承。
- Provider、模型、参数和推理强度选择。
- BYOK Provider 与 Spark 官方托管模型并列选择，来源和计费方式可识别。
- 当前已实现的 Spark 托管范围是文本 Provider；图片/视频仍走 BYOK 媒体 Provider，未扩展前不作托管媒体承诺。
- 媒体 Manifest 动态参数、裁剪、别名和兼容警告。
- 文生图、图生图、图片编辑、多图合成和分镜宫格图。
- 文本生成、改写和 Prompt 优化。
- 文生视频、图生视频、视频编辑和视频扩展。
- 文生音频、语音和音频转写底层能力。
- 任务状态、进度、取消、重试、恢复、输入快照和产物血缘。
- 主产物选择、候选比较和脱敏诊断。
- Provider CRUD、模型清单、API Key 和 OS Keychain。

当前 15 个操作契约并未在所有入口一一暴露：`CANVAS_CAPABILITIES` 有 13 项，未单列 `image_to_image` 和 `text_rewrite`，其中 `image_to_image` 会别名到 `image_edit`；节点新建菜单有 12 项，未列 `image_to_image`、`video_edit` 和 `video_extend`。这不等同于底层操作缺失，但第一版验收必须使用“操作 ID -> 入口 -> Provider 能力 -> 产物类型”的逐项矩阵，不能再以“存在 15 个类型”代替所有入口已实现。

内置媒体清单运行时展开为 102 项，而不是源码数组的顶层表达式数；当前分为图片 34、视频 63、音频 5，没有 `audio.transcription` manifest，语音转写仍依赖 APIMart preset 与 adapter。Provider 目录为 35 个 vendor、52 个 preset、24 个媒体 preset 和 99 条显式 `mediaModelRefs`；所有非 `custom:` preset ref 已精确命中内置清单，当前结构错配和语义校验问题均为 0。

普通文本和媒体生成必须直接依赖 Provider，不得以 `SessionService` 为必经路径。

### 3.6 本地数据和文件

- SQLite 基础、`app_settings`、`provider_profiles`。
- `canvas_projects`、`canvas_snapshots`。
- `media_generation_tasks`、`media_model_manifests`。
- 项目目录 `snapshots/latest.json` 和 `assets/*`。
- 图片、音频、视频、TXT/MD、DOCX 和剪贴板输入。
- JSON 导入导出和目录项目包导入导出。
- `safe-file://`、Range 请求、路径白名单和文件对话框。
- 全新的 Provider credential vault；不读取旧 BYOK 凭据。
- 新登录产生的 Spark 登录态和平台模型配置，以及独立新库中的本地 Usage Ledger。

数据契约已经冻结；其中原子文件提交和 Renderer mutation revision 已落地，显式持久化 revision 对账与最小 schema 仍是目标：

- 项目目录是已保存项目内容的权威源；保存使用 revision、临时文件和原子替换。
- SQLite 是项目索引、查询缓存和恢复镜像，使用同一 revision 对账。
- Renderer 内存/localStorage 只保存当前编辑草稿，超限或失败不能被当作持久化成功。
- 新数据库为 `{userData}/spark-canvas.db`，默认项目根为 `{userData}/projects`；当前仍沿用原平台 migration lineage 并执行 55 条 migration，最小 Canvas schema 尚未落地。
- migration 055 将内置 Canvas Assistant 设为数据库唯一默认 Agent，但不改写既有 `sessions.agent_id`；既有 Canvas Assistant 会话仅补 `metadata.surface=canvas`，保留历史会话人格与归属。
- 媒体任务的 `input_files_json` 只保存 `type`、`role`、`mimeType`；`raw_response_json`、`requestCall.body` 和 `requestCall.response` 经 `compactForLog` 脱敏，`requestCall.url` 保留原始 Provider endpoint。
- 完整迁移使用相对路径、checksum 和大小清单的 v3 目录项目包；v1/v2 JSON 只做兼容快照导入。

详细保存、恢复、bootstrap、导入安全和删除语义见[数据权威、空库启动与项目包审计](../reviews/2026-07-17-canvas-data-authority-bootstrap.md)。

### 3.7 视频和 FFmpeg

- FFmpeg/FFprobe 状态和完整性检查。
- 视频元数据探测。
- 场景突变、I 帧、均匀采样和手动时间点抽帧。
- 关键帧预览、删除和回填画布。
- 入出点裁剪和片段导出。
- MP4/WebM/MOV/GIF 转码。
- H.264/H.265/VP9、缩放和 CRF。
- 固定时长分段、变速、倒放和画面裁剪。
- 产物记录和项目回填。

主进程已有但 UI 未完整开放的拼接、缩略图、水印和字幕烧录，不作为第一轮独立化阻塞项。是否开放必须由视频生产闭环设计决定。

### 3.8 Canvas Agent

- 保留当前 `CanvasAgentModal` 入口和画布内对话体验。
- 保留 Agent、Provider、模型和推理强度选择。
- 保留会话创建、继续、历史、取消、提问响应和流式事件。
- 保留 `spark_canvas` 工具桥、ACK/超时处理和现有 49 个画布工具。
- 保留当前 Claude SDK、Codex SDK/CLI 及其所需的 Canvas MCP 执行路径。
- 保留 `ChatPanel`、必要消息卡、Avatar、Skills picker 和 `canvas-studio` 等当前直接依赖。
- 保留第一版运行所需的 Session、Agent、Skill、Event、Permission、Workspace 等协议、Repository 和服务闭包。
- Canvas 会话查询固定使用 `session:list surface=canvas`，Repository 在 SQL 分页前过滤 Canvas surface；`CanvasAgentModal` 不展示或接管旧平台会话。
- 画布三个文本入口与 `canvas:task:generate-text` 固定使用内置 Canvas Assistant；自定义/平台 Agent 被拒绝，内置 Agent 缺失、禁用或身份不符时 fail closed。

Canvas Agent 是第一版验收项。其运行闭包可以在行为等价、测试覆盖充分的前提下拆分边界，但第一版不以重做轻量助手为交付前提，也不能为了缩小安装包而降低现有能力。

### 3.9 混合模型与共享 Spark 云

- BYOK 路径使用本地 Provider Profile、用户 API Key 和 OS Keychain，不要求登录 Spark。
- 官方托管路径继续使用原 Spark 登录、用户 ID、余额、套餐、订单、支付和模型额度。
- `PlatformModelService`、Account Center、用量查询、兑换/购买和支付回调按现有共享账户契约保留。
- `auth:upload-file` 与 `/api/v1/upload` 继续写入同一 Spark 上传空间，但只作为 manifest 要求公网 URL 时的显式传输策略；BYOK 默认使用 base64 或 Provider 原生上传。
- BYOK Key 不上传到 Spark 账户后端；托管模型 Token 与 BYOK 凭据分域存储。
- 模型来源、预计/实际用量和扣费结果必须可见；BYOK 与托管模式之间不得静默回退。
- Spark 云不可用时，本地项目和已配置的 BYOK 路径仍应可打开和运行。
- 新应用不复用旧 `SparkAgent.CloudAuth` 登录态；用户重新登录后仍进入同一云账户。
- 上传必须保存 `fileKey`/owner/hash/项目引用并具备 TTL 或删除闭环；支付必须有订单 ID、幂等键和订单状态权威。
- Auth/NewAPI token 不进入 Renderer；管理会话冲突与 inference 可用性分开表达。

“独立产品”在本阶段指桌面端产品入口、Canvas 业务闭包、品牌和发布链独立，不表示账户、账务和上传后端独立。

## 4. 二期保留

以下能力不删除，但不阻塞第一版独立化，也不继续向超大文件增加功能：

- 2D 镜头导演台。
- 真 3D 导演台、姿势编辑、IK、本地模型和批量镜头截图。
- 360 全景生成、查看和视角截图。
- 图片标注。
- XLSX 通用表格输入。
- 角色子视图的进一步深化。
- 对白配音、BGM、音效和字幕编排。
- 整集镜头装配和最终成片导出。

二期保留表示源码和数据兼容暂留，不表示第一版 UI 必须默认展示全部入口。

## 5. 确定移除的旧平台域

以下能力与确认后的产品定位无关，完成各自解耦门槛后移除：

### 5.1 产品和协作

- 通用 Chat 页面和 Session Sidebar 产品入口；Canvas Agent 使用的 `ChatPanel`、Session 运行时除外。
- 通用 Agent 管理页面、导入导出和团队型权限 Profile；Canvas Agent 使用的 Agent 选择、配置和权限运行时除外。
- Teams、Team Dispatch、Team Discussion 和 A2A。
- Goal、Context Governor、Rules、Hooks 和通用命令。
- 通用 Workflow、Workflow Runs 和模板。
- 旧任务 Board、Scheduled Tasks 和 Task Execution。
- Memory 产品页面、通用记忆能力和对外配置入口；当前 `SessionService` 直接使用的 Memory Repository、检索服务和 `sqlite-vec` 首版按 Canvas Agent 运行闭包保护，完成等价拆除和 Agent 全旅程回归后才能删除。
- 外部 MCP 管理、OAuth 和通用工具市场；Canvas Agent 的 Canvas MCP 与当前执行器所需 transport 除外。
- 通用 Skill Store、安装管理和无关内置 Skills；Canvas Agent 使用的 Skill 运行时、Registry 和影视 Skills 除外。

### 5.2 代码开发工具

- Claude/Codex 的通用代码工作台能力；Canvas Agent 当前调用的 SDK/CLI 执行路径除外。
- Git、GitHub Connector、Worktree 和 Checkpoint。
- 内置 Terminal、node-pty 和 xterm。
- File Patch、代码 Workspace 和 File Watcher。
- Claude Code/Codex History Import。
- Playwright、Internal Browser 和 Browser MCP。
- External IDE/Terminal 探测。
- Telegram、飞书等 Remote Connections。
- Web Search 和旧平台工具桥。

### 5.3 旧产品内容

- 旧 Agent 平台首页、导航和欢迎页。
- Agents、Teams、Workflow、Board、MCP、Skill 和 Memory 页面。
- 与 Canvas、Canvas Agent、Provider、Spark 账户/托管模型无关的旧平台设置分区。
- 旧 Spark Agent 官网内容、截图、文档和路线图。
- 旧 Agent avatars 和 App Skills 资源。

“确定移除”不是批准立即删除。必须先停止挂载和启动，再按领域删除 UI、IPC、Service、Repository、migration 新装路径、测试和 npm 依赖。

## 6. 必须替换

| 当前实现                           | 目标                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `App.tsx` 完整 Agent 壳            | Canvas 项目首页 + 工作区 + 精简设置                                                     |
| `CanvasWindowApp` 旧全局 Provider  | Canvas AppContext + Agent + Spark Auth；无 Session Sidebar                              |
| 7987 行 `main/ipc/index.ts`        | Canvas、Canvas Agent、Provider、Auth/Platform Model、Settings、Video 分域注册           |
| Preload 泛型透传                   | 含 Canvas Agent 和共享 Spark 云必需通道的运行时 request/stream allowlist                |
| Cloud Auth `/upload`               | 保留为显式共享上传策略；manifest 驱动 base64/Provider 原生上传，并补 `fileKey` 生命周期 |
| `normalizeEduAssetUrl`             | 精简为共享 Spark 资产 URL 解析，并覆盖历史项目兼容                                      |
| Skill Registry FFmpeg 安装         | 专用受信安装器；固定 GPL/codec/source 基线后选择随包或受控下载，系统版只作回退          |
| 超大 Providers/Settings 页面       | 影视文本/媒体 Provider、存储、FFmpeg、日志、更新和关于页                                |
| `spark-agent`/`SparkWork` 应用身份 | 替换为 `Spark Canvas`、`com.spark.canvas.desktop`、`spark-canvas` 和新凭据 namespace    |
| 原官网和下载链                     | 删除或重建独立产品官网                                                                  |

## 7. 已确认和仍待决策

### 7.1 Canvas Agent

**已确认选择第 1 项：第一版核心保留当前 Agent。**

已接受的直接成本是首版继续保留 ChatPanel、SessionService、Agent/Skill/MCP/权限/事件协议与存储，以及 Claude/Codex SDK/CLI 等当前运行闭包。通用平台页面仍移除；任何底层删除必须先证明不影响 Canvas Agent 的现有行为和 49 个工具旅程。

### 7.2 模型商业模式

**已确认混合模式，并选择与原 Spark Agent 完全共用云账户体系。**

- BYOK 与官方托管模型同时进入第一版。
- Spark Auth、Account Center、Platform Model/NewAPI、云端用量、余额、套餐、订单、支付和上传服务保留；本地 Usage Ledger 作为独立观测能力保留。
- Canvas 不建立独立用户、独立余额、独立订单或独立上传空间。
- 独立化不得把已批准的 Spark 云服务误列为旧平台残留，也不得让 BYOK 被登录状态阻塞。
- T-013 冻结 Provider/计费域不回退、上传生命周期、订单幂等、token 主进程边界和故障矩阵。

### 7.3 旧数据兼容

**已确认全新开始，不做自动迁移。**

- 不读取或升级旧 `spark.db`。
- 不发现或复制旧默认/自定义项目目录。
- 不迁移旧 Provider Key、Spark 登录态、localStorage、Canvas Agent 会话、Agent 或 Skill 数据。
- 新应用使用全新本地数据库、凭据命名空间和默认项目根。
- 旧项目仅通过用户主动选择的 JSON/目录项目包导入；不提供后台扫描或静默导入。
- 原 Spark Agent 本地目录保持只读意义上的隔离，新应用不得写入或清理它。

### 7.4 品牌和发布

**产品名已确认为 `Spark Canvas`。**

- `productName`、macOS/Windows/Linux 显示名、安装包名和关于页统一为 `Spark Canvas`。
- 新导出 metadata/默认文件名前缀使用 `spark-canvas`；导入器继续识别批准的旧导出格式，但不得扫描旧本地目录。
- 第一阶段保留 `@spark/protocol`、`@spark/storage`、`@spark/shared`、`@spark/agent-runtime` 内部包名。
- Electron `appId` 固定为 `com.spark.canvas.desktop`，URL scheme 固定为 `spark-canvas`。
- Cloud Auth Keychain service 固定为 `SparkCanvas.CloudAuth`，Provider vault service 固定为 `spark-canvas`；两个 namespace 均不读取旧条目。
- 兑换回调使用 `spark-canvas://redeem`；原 Spark Agent 继续拥有 `spark-agent://redeem`，共享后端需要分别生成两个客户端的回调。
- 生产签名选择复用原生产身份，前提是同一合法发行主体且证书、公证权限和使用授权核验通过；生产流水线禁止未签名降级。
- GitHub Release 已确认使用当前 `alexanderizh/Spark-Canvas` 仓库；版本中心已确认共用原基础设施并实施严格 v2 `spark-canvas` 全链 product 分区；旧官网已从 workspace、lockfile importer 和 CI 发布链断开，源码暂留，独立官网在桌面稳定后重建且不阻塞首版；首发平台已确认 macOS arm64/x64 和 Windows x64，FFmpeg 分发与下载镜像仍待确认。

## 8. 目标运行边界

```text
apps/desktop
├── renderer
│   ├── Canvas 项目首页
│   ├── Canvas 工作区和影视生产
│   ├── Canvas Agent 和画布工具交互
│   └── Provider / Spark 账户与托管模型 / 存储 / FFmpeg / 日志 / 更新设置
├── main
│   ├── App Shell 和安全文件协议
│   ├── Canvas 项目、快照和资产 IPC
│   ├── Canvas Agent 会话、事件和工具桥
│   ├── 文本/媒体 Provider 任务
│   ├── Spark Auth / Platform Model / Usage / Upload
│   ├── FFmpeg / Video
│   └── 精简设置与更新
└── preload
    └── 独立产品运行时 allowlist

packages/protocol
    Canvas / Canvas Agent / Session / Provider / Auth / Platform Model / Media / File / Settings 协议
packages/storage
    Canvas / Canvas Agent 当前闭包 / Provider / Model Profile / Usage / Media Task / Settings 仓储
packages/agent-runtime
    第一版保留当前 Canvas Agent + 文本与媒体运行时，不改包名
packages/shared
    Logger / Error / Keychain / 中性共享类型
```

不在第一轮为了目录美观创建大量新包。先缩小产品入口和注册边界；如果第一版以后用新实现替换当前 Agent，并且 `agent-runtime` 确实不再包含 Agent，再讨论重命名。

## 9. 实施顺序

### Phase 0：恢复可验证基线

- 将已校验的 Node 22.14.0 固定到可重复的开发和 CI 环境。
- 已修复原有 6 个桌面 Main/Preload `exactOptionalPropertyTypes` 错误。
- 已清理历史 Desktop 非绿基线；不得继续引用旧的失败测试和 suite 导入失败数字。本轮 Node 22 fresh 全量结果已记录为 357 个文件、2846 passed、4 todo、0 failed。
- 保持 Protocol、Shared、Storage、Agent Runtime 和 Desktop 全量测试可重复通过，并记录核心手工旅程和打包基线。
- 替换 `vendor/prebuilds/better-sqlite3` 中仅适用于 Darwin arm64 的 Node/Electron 双 ABI 文件；测试和打包必须按目标 platform/arch 可复现构建或选择经验证的键控 prebuild。
- Canvas Agent、混合模型模式和全新本地数据策略均已确认。

### Phase 1：单一产品入口

- Canvas 项目列表成为唯一首页。
- 工作区成为主产品窗口。
- 建立含 BYOK Provider、Spark 账户和托管模型的精简设置入口。
- 新数据库通过 migration 055 将已种入的内置 Canvas Assistant 设为唯一默认 Agent，不改写已有 `sessions.agent_id`；启动 bootstrap 和 `skill:list` 只种入、列出 4 个批准 Skill：`canvas-studio`、`multimedia-use`、`video-workflow`、`platform-manager`，不自动导入宿主 Claude/Codex Skills。批准的媒体 manifest 当前运行时展开为 102 项，验收从批准集合读取数量和 ID。
- v3 目录项目包导入已补齐，用户可主动导入旧项目及音视频资产；legacy v1/v2 目录桥与旧 JSON 快照兼容范围在独立入口中明确可见。
- 旧导航和旧页面停止挂载，但暂不删除底层。

### Phase 2：独立运行闭包

- 已先用独立共享 policy 接管注册边界：精确允许 115 个 invoke 与 14 个 stream，main/preload 双侧 fail closed；Canvas/Canvas Agent/Provider/Auth/Platform Model/Settings/Video 的物理注册器拆分仍待下一批完成。
- Preload 已加入与主进程共用的运行时 allowlist，旧平台 channel 在触达 `ipcRenderer.invoke/on` 前被拒绝。
- 移除 Session Sidebar 启动副作用，同时保留 Canvas Agent 按需使用的 SessionService。
- 文本生成直连 Provider。
- Provider vault 初始化已迁到应用启动阶段，并完成集中 vault -> `safeStorage` 加密文件的一次性导入路径；继续保持 BYOK 不依赖 Auth IPC。
- 建立 Canvas Agent 会话、流式事件和 49 个工具的回归基线。
- 内置 preset 错 ref 和 manifest 语义校验问题已清零；继续建立 15 个操作契约的入口/Provider/产物矩阵，并禁止非 `custom:` ref 静默合成。
- `spark_media` 所需两个 `.mjs` helper 已随构建产物复制并通过子进程启动测试；生产构建已收口为 6 个 MCP 脚本的产品级显式 allowlist，并在复制前清理旧产物，防止增量构建残留。

### Phase 3：验证共享 Spark 云和迁出 FFmpeg 安装

- 验证同一 Spark 账户、余额、套餐、订单、支付和上传空间。
- 保留 `auth:upload-file` 与 Spark 资产 URL，按 manifest 选择 BYOK Provider 原生上传/base64/显式 Spark 上传，并保存 `fileKey` 生命周期。
- 同时跑通无需登录的 BYOK 链和登录后的官方托管链。
- 验证云账与本地 Usage Ledger 分栏、重复支付单订单、两产品同账号并行推理及 token 不进 Renderer。
- 迁出 FFmpeg installer。
- 文本、图片和视频至少各有一条真实模型链通过。

### Phase 4：逐域删除旧平台

- 一次只删除一个域。
- 先删除通用 Chat/Agent 管理入口，但保留 Canvas Agent 当前共享 UI 和运行闭包。
- Scheduler/Task Execution 已完成；继续删除未被 Canvas Agent 调用的 Workflow/Board、MCP/Skill/Memory 子域。
- 再 Git/Terminal/Playwright/Remote/History Import。
- 每域完成 IPC、Repository、资源、测试和依赖对账。

### Phase 5：协议、存储和依赖收缩

- 收缩协议 exports 和数据库注册。
- 建立只面向全新安装的最小 schema，包含 Canvas 核心、当前 Canvas Agent 闭包和混合模型所需表。
- 新应用当前仍沿用原平台 migration lineage 并执行 55 条 migration；最小 Canvas schema 基线通过后归档不再需要的旧平台 migration。
- 删除无用生产依赖和原生模块。
- 原子快照写入和 Renderer mutation revision/dirty 已落地；继续完成项目目录权威、SQLite 同持久化 revision 镜像、Renderer 草稿边界和故障恢复。

### Phase 6：品牌与发布

- 将 `productName`、系统显示名、安装包、关于页、通知和导出标识统一为 `Spark Canvas`。
- 应用 `com.spark.canvas.desktop`、`spark-canvas`、`SparkCanvas.CloudAuth` 和 `spark-canvas` Provider vault，并验证独立 `userData`。
- 复用经核验的原生产签名身份，强制校验证书 Subject/Team/Issuer/有效期、公证和时间戳，禁止稳定发布降级到未签名产物。
- Windows stable Gate 已要求 Authenticode `Valid`、系统受信 signer/timestamp 链、在线吊销检查和 RFC3161 时间戳，并拒绝自签 signer；真实 CA 安装包证据仍由 Windows CI 补齐。
- 替换应用图标、更新源和仓库；Spark 账户凭据与支付/兑换深链按共享后端兼容要求处理。
- 落地 T-012 approved resource manifest、第三方 notices 和最终安装包资源对账；构建时生成的 `public/file-viewer` WASM/worker 也必须进入双向清单，未核验资源不得进入 stable。
- 删除或重建官网。
- 完成 macOS/Windows 安装、升级、卸载和重装测试。

### Phase 7：影视生产闭环

- 普通删除保留磁盘目录已修正；继续完成归档/恢复语义验收。
- 已补齐视频分段的全部产物记录，并由 6 秒真实视频 Electron E2E 验证 3 个分段与裁剪、转码共 5 条产物。
- 补跨镜角色/场景一致性验收。
- 逐步补配音、音效、字幕和镜头装配。

## 10. 删除控制规则

- 不按目录名判断可删，按运行时调用闭包判断。
- 不直接复用或升级旧数据库；先建立并验证新装基线，再归档旧 migration。
- 已冻结的 appId、URL scheme 和凭据 namespace 必须在首次正式运行前一起落地，并验证用户数据目录不会回退到旧路径。
- 不把隐藏导航当成完成独立化。
- 不在 3000 行以上文件继续直接加业务逻辑。
- 不把静态不可达模块自动判为死代码；先确认是否应接管内联实现。
- 不在真实 Provider、FFmpeg 和打包应用未验收时删除兼容路径。
- 只允许显式批准的 Spark Auth、Platform Model、支付和上传服务；禁止其他旧 Spark 网络服务或静默回退。

## 11. 范围验收

范围冻结完成的判定：

- 产品定位明确且写入总控文档。
- 第一版、二期、移除、替换和待确认项边界明确。
- 除已确认的 Canvas Agent 运行闭包和共享 Spark 云基础设施外，旧 Agent 平台没有任何模块被误列为影视主流程核心。
- 影视文稿、资产、分镜、关键帧、AI 视频和 FFmpeg 主链均有保留归属。
- Canvas Agent 的当前交互、会话和 49 个画布工具均有首版保留归属。
- BYOK 免登录链与完全共享 Spark 云账户的官方托管链均有首版保留归属。
- 全新安装、默认 Agent/Skill 种入、重新登录/配置以及手工项目包导入有明确验收归属。
- 条件项在决策前没有被批准删除。
- 后续实现可以按 Phase 和 Gate 拆成独立、可验证的变更批次。

生产签名已确认复用原生产身份并设置证书核验硬门；D-014 已确认由当前 `alexanderizh/Spark-Canvas` 仓库同时承载源码和 GitHub Release；D-015 已确认共用原版本中心基础设施并实施严格 v2 `spark-canvas` 全链 product 分区；D-016 已完成旧官网 workspace、lockfile importer 和 CI 发布链断开，旧 `apps/website` 源码暂留，桌面稳定后再重建独立官网且不阻塞画布视频工作台首版 P0；D-017 已确认首发 macOS arm64/x64 和 Windows x64；D-018 已确认沿用原 FFmpeg 用户体验：不随安装包捆绑，由用户在设置或视频工作台按需显式下载，managed 本地版本优先，兼容的系统 PATH FFmpeg 兜底。旧通用 Skill Registry/manifest 和当前四个已拒绝 ZIP 不进入候选或稳定发布，改由 Spark Canvas 专用受信 descriptor、独立安装器和合规制品承接。D-014 至 D-018 已全部冻结，不再有待负责人选择的发行决策。
