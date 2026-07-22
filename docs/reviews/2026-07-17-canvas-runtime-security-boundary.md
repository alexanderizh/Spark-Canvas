# Spark Canvas 运行时、凭据与 FFmpeg 边界审计

> 审计快照: 2026-07-17 | 代码基线: `6cfbfcd` | T-005 至 T-008 已冻结，本阶段不修改业务代码

## 1. 目的

本文件把独立化中四个互相耦合的技术项收敛为实施契约：

- T-005：Renderer IPC request/stream 运行时权限边界；
- T-006：BYOK Provider vault 的身份、初始化和失败隔离；
- T-007：Canvas Agent 的按需 Session/MCP/SDK 启动；
- T-008：FFmpeg 安装从旧 Skill Registry/MinIO 解耦。

这些结论不改变已冻结产品能力：Canvas Agent 首版保留当前实现，Spark 账户、计费、托管模型和上传继续共用，BYOK 必须离线可用，本地数据使用全新的 Spark Canvas namespace。

共享云内部的 token、路由、订单、用量和上传生命周期进一步由[共享 Spark 云、计费与上传契约审计](./2026-07-17-canvas-shared-spark-cloud-contract.md)的 T-013 约束。

## 2. 当前事实

### 2.1 IPC 面

| 项目                  | 当前值 | 风险                                            |
| --------------------- | -----: | ----------------------------------------------- |
| request/response 协议 | 336 个 | Canvas preload 可在运行时转发任意字符串 channel |
| stream 协议           |  38 个 | 通用 `pushStreamEvent` 广播给所有应用窗口       |
| 工作区核心直接通道    |  43 个 | 仍混在 7987 行主 IPC 文件中                     |
| 壳设置通道            |   2 个 | `settings:get` / `settings:set`                 |
| 共享 Spark 上传       |   1 个 | 已批准保留，但 BYOK 不得依赖它                  |
| Canvas Agent 直接增量 |  16 个 | 含通用 `workspace:open`                         |
| ChatPanel 间接增量    |   4 个 | 历史、取消、提问响应和文件类型                  |

当前核心、上传和 Agent 闭包至少是 66 个唯一通道；Auth/账户、Platform Model、Provider 管理、更新和精简设置是另外的显式产品域，不能用“放开全部协议”代替清单。

### 2.2 权限缺口

1. `preload/index.ts:116-140` 的泛型只做 TypeScript 校验，没有运行时 request/stream allowlist。
2. `typedIpcHandle()` 只校验 payload，没有校验 sender 窗口角色、项目归属或 Session 归属。
3. `pushStreamEvent()` 调用 `broadcastToAppWindows()`，会把 Session、权限、媒体、FFmpeg 等流推给所有应用窗口。
4. `workspace:open` 接受 Renderer 提供的任意 `rootPath`；Canvas Agent 用项目快照中的路径直接调用它。
5. `canvas:host-attach` 接收 `sessionId` 和 `projectId`，但当前没有证明两者属于同一项目及当前 sender。
6. `stream:auth:token-refreshed` 当前把 access token、refresh token 和 user ID 通过全窗口广播发送给 Renderer；仓库没有消费者，属于不必要的凭据暴露。
7. `SafeFileProtocol.isSafeFilePathAllowed()` 只对 `resolve()` 后的 lexical 字符串做目录前缀比较，没有 `realpath/lstat`；批准根内的 symlink 可以指向根外文件。
8. `videoProcessHandler.assertPathAllowed()` 同样只做 lexical 前缀比较；它先执行 `resolve(p)` 再调用 `isAbsolute(abs)`，所以注释所说的“相对路径拒绝”实际无效，读写路径也可经 symlink 逃逸。
9. 视频 handler 永久缓存 `getSafeFileAllowedRoots()`：启动后新增项目可能无法读取，已删除/解绑项目的旧根又可能继续获准；仓库没有对应的相对路径、symlink 或动态项目根边界测试。

### 2.3 启动副作用

- `CanvasWindowApp` 挂载 `SessionSidebarProvider`。
- Provider 挂载后立即查询 Workspace、Session、当前 Workspace、Provider、Agent 和 Terminal，并订阅旧平台流。
- `SessionService` 本身是 lazy，但 `initializeAppSkills()` 在启动时调用 `getSessionService()` 注入目录，实际提前构造服务。
- 主进程启动时还会 `startAllEnabled()` MCP、启动 Scheduler、初始化宿主 Skills 和 Browser/Playwright 相关能力。

### 2.4 Provider vault

- `packages/shared/src/keystore/index.ts` 把 service 固定为 `spark-agent`。
- macOS 新 vault 文件不存在时，会从旧 `spark-agent` 集中 Keychain 条目导入；单条凭据也有旧条目 fallback。
- `registerAuthIpc()` 才注入 Electron safeStorage persistence。
- `auth:bootstrap` 同时收集 Provider 和 Connector refs 后预读凭据。

这与“Spark Canvas 不读取旧 Keychain、BYOK 不依赖登录”冲突。

### 2.5 FFmpeg

`ffmpeg:install` 通过 `SkillRegistryService.fetchSparkManifestForQuery()` 和 `installBinaryArtifact()` 使用旧 Spark artifact manifest。现有实现已有 SHA-256 和部分路径检查，但仍存在：

- manifest、下载源和 Skill Store 生命周期耦合；
- SHA-256 可选，且 hash 与包来自同一远端信任域；
- URL/redirect 没有产品级 allowlist 和下载大小上限；
- 系统 `tar` 在解压后才做路径扫描，扫描不能撤销已经写出临时目录的危险条目；
- 安装前删除旧目录，再复制新目录，没有原子切换和失败回滚；
- 完整性服务会扫描 `{userData}/bin` 任意子目录并选择第一个可执行文件。

2026-07-17 逐包实测进一步证明 manifest 标签不能作为信任依据：macOS arm64 声明 7.1.1，实际是 `N-125450-gfad2e0bc50` 开发快照；Windows `4.1` 归档混合 npm FFmpeg 4.1.0 和 FFprobe 5.1.0。四个归档都只含两个可执行文件，没有许可/source offer；arm64 严格 codesign 失败，macOS x64 与 Windows 未签名。完整哈希和上游对账见[FFmpeg 分发物来源与发布门审计](./2026-07-17-canvas-ffmpeg-artifact-provenance-release-gates.md)。

当前 `FfmpegRunner.ts` 至少 8 处固定/默认使用 `libx264`，视频工作台还暴露 `libx265` 和 `libvpx-vp9`；完整性检测却只执行 `-version`。一个缺少这些 encoder 的 FFmpeg 会被误判 ready，随后在真实编辑时失败。

## 3. T-005：IPC 与 stream 权限契约

### 3.1 三层防线

| 层           | 必须实现的控制                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Preload      | request 和 stream 使用运行时 `Set` 默认拒绝；未知 channel 在到达 `ipcRenderer` 前失败                                         |
| Main handler | 每个 channel 声明允许的窗口角色/能力；`typedIpcHandle` 在 schema 校验前验证 sender                                            |
| 资源归属     | 涉及 `projectId`、`sessionId`、文件路径的 handler 验证 sender 绑定和 canonical 实体路径，不能只凭 channel 或 lexical 前缀获权 |

Preload allowlist 是减少误调用的第一层，不是安全边界的全部。Renderer 一旦被注入或 XSS 影响，主进程仍必须独立拒绝越权调用。

### 3.2 产品域清单

目标协议按注册器和能力拆分：

| 域                     | 当前基线                                                                | 目标                                                                      |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Canvas shell/workspace | 43 核心 + 2 设置                                                        | 独立注册器；未来窗口模型变化时逐项删第二窗口通道                          |
| Canvas Agent           | 16 直接 + 4 ChatPanel 间接                                              | 保留当前行为，但去掉任意路径入口并增加 Session/项目归属                   |
| Spark upload           | `auth:upload-file`                                                      | 只给明确要求 cloud URL 的任务；失败后按 Provider 能力回退，不改变计费路径 |
| Spark Auth/account     | AuthProvider 13 request + 2 有效状态 stream；另有 1 个敏感 token stream | 独立域；删除 token payload，登录失败不影响本地首页和 BYOK                 |
| Platform Model/billing | 当前 11 request                                                         | 独立域；所有托管调用显式显示并使用 Spark 额度                             |
| Provider settings      | Provider、model profile 和媒体模型管理的实际调用                        | 精简页面生成单独清单；导入导出不得导出明文 Key                            |
| Update/log/settings    | 新精简设置实际调用                                                      | 独立清单；不得把旧 Remote/MCP/Workspace 设置通道带回                      |

数量是当前审计基线，不是允许以后自动扩张的通配规则。新增 channel 必须同时更新协议、角色清单、handler 注册和拒绝测试。

### 3.3 禁止 Renderer 提交任意 Workspace 路径

Canvas Agent 入口只接受 `projectId`。主进程必须：

1. 从 Canvas 项目 Repository 读取该项目的 canonical root；
2. 验证 root 位于批准的 Canvas 项目根或用户明确导入的项目包根；
3. 在主进程内部建立项目到 Workspace/Session 的绑定；
4. 返回 opaque id，不允许 Renderer 用 `rootPath` 创建或切换任意 Workspace；
5. 后续 Session create/list/update/submit/cancel/history 都验证该绑定。

可以通过新的 `canvas:agent:*` 入口完成，也可以在专用 façade 内复用底层 SessionService；不可继续把通用 `workspace:open` 暴露给 Canvas Renderer。

文件读写还必须满足：

1. 在解析前拒绝相对路径和 NUL/非法编码，不能对 `resolve()` 后必然为绝对路径的结果再做无效检查。
2. 对已存在读目标和根目录使用 `realpath` 后比较；对新建写目标验证 canonical parent，并用不跟随 symlink 的打开/替换策略防止检查后切换。
3. 用 `lstat` 拒绝路径链中的不受控 symlink、非普通文件和目录替换；Windows 还要覆盖 junction/reparse point 与大小写语义。
4. 允许根由项目 Repository 的当前所有权记录产生，新增、归档、删除、导入或根迁移时失效/刷新，不能永久缓存启动快照。
5. `safe-file://`、视频 input/additionalInputs/logo/srt/output 和项目包复制共享同一套受测 canonical 归属规则。

### 3.4 stream 定向投递

目标 stream API 必须支持：

- 按窗口角色过滤系统级 stream；
- 按 `projectId`、`sessionId`、`requestId` 或安装任务 owner 定向投递；
- webContents 销毁时自动清理订阅和 Canvas host attachment；
- 未订阅窗口收不到 payload；
- 一个项目窗口不能收到另一项目的 Agent、媒体任务或权限请求；
- stream channel 也经过 preload 运行时 allowlist。

`broadcastToAppWindows()` 只能保留给真正无敏感数据且所有产品窗口都需要的事件；Session、权限、项目、媒体和安装进度不得继续使用全窗口广播。

### 3.5 T-005 验收门

1. 未知 request/stream 在 preload 和 main 两层均被拒绝。
2. Canvas 窗口调用 Terminal、Git、Playwright、Remote 和通用 Workspace 通道失败。
3. 篡改 `projectId`、`sessionId`、root path 或 host attachment 不能越权。
4. 两个项目窗口并行运行时，Session、媒体、权限和 FFmpeg owner stream 不串流。
5. 66 个当前核心/Agent 通道及批准的 Auth、Platform Model、Provider、更新设置清单有契约测试。
6. Renderer 永远收不到 Cloud Auth、NewAPI 或 Provider 明文 token；刷新事件只携带非敏感状态。
7. 白名单根中的 symlink/junction 指向根外文件时，`safe-file://` 和所有视频读写操作均拒绝；检查后替换目标也不能越界。
8. 相对路径被拒绝；新增项目根立即可用，删除/解绑项目根立即失效，缓存不会扩大授权寿命。

## 4. T-006：Provider vault 契约

### 4.1 固定身份

| 凭据域                    | 目标 service/namespace                                 | 是否读取旧值 |
| ------------------------- | ------------------------------------------------------ | ------------ |
| BYOK Provider vault       | `spark-canvas`                                         | 否           |
| Spark Cloud Auth          | `SparkCanvas.CloudAuth`                                | 否           |
| Electron safeStorage 文件 | 新 `com.spark.canvas.desktop` userData 内的 vault 文件 | 否           |

Provider vault 和 Cloud Auth 是两个独立凭据域。共享 Spark 账户不表示共用旧产品的本地 token 或 Provider Key。

### 4.2 初始化顺序

Provider vault persistence 必须在以下动作之前初始化：

1. 注册 Provider/Auth IPC；
2. 构造或查询 ProviderService；
3. 预读 Provider refs；
4. 启动任何可能发起模型请求的服务。

推荐顺序是：应用 ready -> 新 userData/数据库 -> 配置 `spark-canvas` vault persistence -> 注册 Provider IPC -> 启动本地 Canvas -> 独立尝试 Cloud Auth。初始化代码不得藏在 `registerAuthIpc()` 中。

### 4.3 禁止旧凭据 fallback

Spark Canvas 模式下必须禁用：

- 从 `spark-agent` 集中 vault 导入；
- 按 ref 读取旧 `spark-agent` Keychain 条目；
- 删除新 Key 时顺手访问或删除旧产品条目；
- `auth:bootstrap` 预读 Connector 凭据。

用户需要重新配置 BYOK。若未来提供显式凭据迁移，必须是另一个经确认的用户主动导入流程，不得作为启动 fallback。

### 4.4 失败隔离

- 某 Provider Key 解密/读取失败，只把该 profile 标为不可用并给出可操作错误。
- 其他 Provider、本地项目、项目导入导出和 FFmpeg 仍可用。
- Cloud Auth 启动、续期或网络失败不阻塞 BYOK 列表、Key 保存和直连模型调用。
- BYOK 请求不得静默切到 Spark 托管模型，也不得静默扣除 Spark 额度。
- Spark 托管请求必须由用户选择或明确的任务配置触发。

### 4.5 T-006 验收门

1. 预置旧 `spark-agent` Keychain/vault 后首次启动 Spark Canvas，旧条目访问次数为 0。
2. 新 Provider Key 重启后可读，service 固定为 `spark-canvas`。
3. 无网络、未登录和 Cloud Auth 返回错误时，BYOK 创建、测试和生成仍通过。
4. 一个损坏的 Provider secret 不影响其他 profile。
5. 日志、IPC 错误和导出文件不包含明文 Key。

## 5. T-007：Canvas Agent 按需启动契约

### 5.1 基础应用启动不得触发

仅打开项目列表或 Canvas 工作区时，不得：

- 挂载 `SessionSidebarProvider`；
- 查询旧 Workspace/Session/Agent/Terminal 列表；
- 构造 `SessionService`；
- `startAllEnabled()` 通用 MCP；
- 自动导入宿主 Claude/Codex Skills；
- 启动 Scheduler、Remote、Browser 或 Playwright。

### 5.2 Agent 启动状态机

| 阶段                   | 允许动作                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Core ready             | 项目、Provider、媒体、Auth、FFmpeg 和 4 个批准 Skill 的 metadata/路径可用；不构造 SessionService                   |
| Agent metadata         | 打开 Agent 面板可直接查询 Canvas 项目自己的 Session 索引和可选 Provider，不启动 SDK/MCP executor                   |
| Agent runtime starting | 首次创建/继续/发送 turn 时，单飞构造 SessionService，注入已准备好的 Skill 路径，启动当前 Canvas Agent 必需 MCP/SDK |
| Agent runtime ready    | 当前会话、取消、提问响应、历史、权限和 49 个工具可用                                                               |
| Shutdown               | 只在 runtime 实际构造过时执行 Session/MCP 清理                                                                     |

`initializeAppSkills()` 只能准备批准的 4 个 Skills 和 managed plugin 路径；应把路径保存到独立 runtime config，不能通过 `getSessionService().set...` 提前实例化。

### 5.3 保留行为

按需启动不是裁剪 Canvas Agent。以下首版行为仍必须通过：

- 创建与继续项目会话、历史、取消和问题回答；
- Agent/Provider/模型选择；
- Claude/Codex SDK/CLI、权限和批准的 MCP 闭包；
- 49 个 `spark_canvas` 工具、ACK、结果、超时和重连；
- Agent 只操作绑定项目，不跨项目发送工具调用。

### 5.4 T-007 验收门

1. 冷启动到项目首页/工作区，SessionService 构造次数、MCP start 次数和旧 Sidebar 查询均为 0。
2. 第一次实际发送 turn 时 runtime 只构造一次；并发点击不会重复启动。
3. Agent 启动失败不会让 Canvas 保存、BYOK 普通生成或项目关闭失效。
4. 完整 Canvas Agent 代表性旅程和 49 工具协议回归通过。
5. 退出时已启动和未启动两种路径都能干净结束。

## 6. T-008：FFmpeg installer 契约

### 6.1 组件边界

目标链路为：

```text
FFmpeg settings/workbench
  -> ffmpeg:install
  -> CanvasFfmpegInstaller
  -> Spark Canvas 专用受信 manifest
  -> BinaryArtifactInstaller
  -> versioned install + active manifest
  -> FfmpegIntegrityService / FfmpegRunner
```

`SkillRegistryService`、Skill Store 数据库、通用 `binary:install` 和旧 MinIO manifest 不在这条链中。

### 6.2 受信描述符

D-018 已冻结为用户按需显式下载。安装器只接受应用选择的 FFmpeg 描述符，不接受 Renderer 提供任意 URL 或通用 artifact id。

下载模式必须满足：

- manifest 随应用签入，或由应用内置公钥验证签名；
- platform、arch、版本、文件大小、SHA-256、归档格式和预期可执行文件均固定；
- 只允许 HTTPS allowlist，重定向每一跳重新校验；
- SHA-256 必填，下载字节数和声明大小都有上限；
- 超时、取消、并发单飞和失败清理明确。

### 6.3 安全解压与原子安装

1. 下载到 `{userData}` 内私有 staging，不在目标目录原地覆盖。
2. 解压前或解压过程中拒绝绝对路径、`..`、symlink、hardlink、device、超量条目和解压膨胀。
3. 不把不可信归档交给会先写盘再扫描的系统 `tar` 路径。
4. 校验存在 `ffmpeg`、`ffprobe`，归档其他条目必须在 manifest 文件清单内；执行 `-version`、`-buildconf` 和 `-encoders`，匹配当前产品批准的 codec profile。
5. 安装到 `bin/ffmpeg/<version>/<platform-arch>/`，完成后原子切换 `active.json`。
6. 新版本失败时保留旧 active；成功后再按保留策略清理旧版本。
7. 完整性检测只读取 `active.json` 指向的固定目录，不扫描任意 `bin` 子目录。

### 6.4 许可边界

D-018 已确认 FFmpeg 不随安装包捆绑，由用户按需显式触发受控下载。该模式仍是 Spark 分发行为，必须先固定 FFmpeg 构建来源、启用 codec、LGPL/GPL 配置、许可文本和需要的 source offer。

现有功能依赖 `libx264`，不能在不改变业务行为的情况下假设使用 LGPL-only build。若保留当前 codec 能力，最终 FFmpeg 构建至少需要按 GPL 构建事实完成许可和法律核验；若改走 LGPL profile，必须另行批准编码器替换及画质/兼容性回归。许可核验失败时可以继续使用用户系统 PATH 中合法安装的 FFmpeg，但不能公开分发未经核验的二进制。

当前四个旧 Spark artifact id 已逐包判定为 candidate/stable `DENY`。D-018 的“沿用原先”只沿用按需下载和系统回退体验，不能理解为继续复用当前异构包；新 descriptor 和 evidence packet 以 FFmpeg 专项审计第 8 节为准。

### 6.5 已冻结的来源选择与回退状态机

主进程按以下固定顺序解析 FFmpeg，Renderer 不能提交路径或改写优先级：

1. `active.json` 指向的 managed 版本通过 descriptor、内层 hash 和 codec profile 复验时，作为主路径。
2. managed 不存在或失效时，只把 canonical PATH 中的系统 FFmpeg 当临时回退；ffmpeg/ffprobe 必须同目录或同一可证明发行版本，并通过 `-version`、`-buildconf`、批准 encoder 和真实 probe smoke。
3. 两者均不可用时，视频工作台仍可打开项目和预览已有素材，但处理命令进入 `setup-required`，明确展示受控安装入口；不得静默请求旧 artifact、任意 URL 或把任务改发云端。
4. 每个视频任务创建时固定 `sourceKind + descriptorId + binary digest`；运行中 managed 安装完成、PATH 变化或完整性刷新都不能让任务切换二进制，重试才重新解析来源。
5. 受控下载必须显示来源、版本、大小和进度，并支持取消；许可证、notices、source/build/SBOM digest 与 source offer 随 managed 版本保存并可从关于/诊断入口查看。
6. 系统回退的一次成功只证明该设备临时可用，不能替代三个首发平台 managed candidate 的 evidence packet，也不能把系统路径写进可迁移项目数据。

### 6.6 T-008 验收门

1. 删除/禁用 Skill Registry 后 FFmpeg 安装、探测、probe 和处理仍通过。
2. hash 错误、超大下载、危险路径、symlink、错误平台、缺少 ffprobe、缺少批准 encoder 和失败切换均被拒绝。
3. 安装中断后旧版本仍可用，staging 无残留。
4. 两个并发安装只执行一次，进度只发给发起窗口。
5. 打包的 macOS arm64/x64、Windows x64 运行真实 probe、抽帧、裁剪、拼接和导出旅程。
6. managed 有效、managed 损坏后系统兼容回退、系统不兼容进入 `setup-required`、任务运行中安装完成不切源四条状态旅程通过。

## 7. 实施顺序

| 顺序 | 工作                                      | 原因                                     |
| ---: | ----------------------------------------- | ---------------------------------------- |
|    1 | T-006 vault 初始化与 namespace            | 先确保 BYOK 不依赖旧 Auth 启动           |
|    2 | T-005 request/stream 双层权限             | 后续拆 handler 前先建立拒绝边界          |
|    3 | T-007 移除 Sidebar 副作用并按需启动 Agent | 缩小基础应用运行闭包，同时保留完整 Agent |
|    4 | T-008 抽离 FFmpeg installer               | 为删除 Skill Store/Registry 建立前置条件 |
|    5 | 按产品域拆 `registerAllIpcHandlers`       | 在已有权限和服务边界上做机械迁移         |

每一步必须独立提交和验证，不把凭据、IPC、Agent 和 FFmpeg 四个高风险改动放在同一批。

## 8. 冻结结论

T-005 至 T-008 已有明确实施边界、禁止项和验收门。D-014 已冻结使用当前 `alexanderizh/Spark-Canvas` 仓库，D-015 已冻结共享原版本中心基础设施并实施严格 v2 `spark-canvas` 全链 product 分区，D-016 已冻结首版移除旧官网并以画布视频工作台可用为 P0，D-017 已冻结首发 macOS arm64/x64 和 Windows x64，D-018 已冻结沿用原按需下载加系统回退体验并替换旧受信链。D-014 至 D-018 已全部冻结；后续实现不改变默认拒绝 IPC、BYOK 隔离、Agent 按需启动和 FFmpeg 安全安装四条技术底线。
