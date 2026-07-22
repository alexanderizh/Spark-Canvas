# Spark Canvas 旧平台删除顺序与生产发布安全门

> 审计快照: 2026-07-17 | 代码基线: `6cfbfcd` | T-010、T-011 已冻结，本阶段不修改业务代码

## 1. 目的

本文件定义两件事：

1. 原 Spark Agent 平台按什么依赖顺序退出，避免删除 Canvas Agent 或共享 Spark 云仍需要的闭包；
2. 什么条件下 Spark Canvas 才能从内部构建升级为公开稳定发布。

它不把“源码删除完成”和“产品可发布”混成一个 Gate。旧 UI 可以较早移除，Storage/Protocol 和运行时闭包必须最后按证据收缩；生产签名、更新源和两产品隔离则是独立发布硬门。

## 2. 受保护闭包

以下能力已由负责人确认，不能作为“旧平台清理”顺手删除：

| 受保护域        | 首版必须保留的行为                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| Canvas Agent    | 当前会话行为、ChatPanel、Agent/Skill、权限、MCP、Claude/Codex SDK/CLI、49 个 Canvas 工具及所需 Repository 闭包 |
| Spark 云账户    | 登录、账户资料、余额、套餐、订单、支付、兑换、额度和用量                                                       |
| Spark 托管模型  | Platform Model 状态、计划、购买、偏好和调用                                                                    |
| Spark 上传      | `/upload` 及共享资产 URL 规范化                                                                                |
| BYOK            | Provider/profile/model、独立 vault、直连文本/图片/音频/视频模型                                                |
| Canvas 首版核心 | 项目、Board、节点、资产、任务、影视生产链、视频工作台、FFmpeg、导入导出                                        |
| Canvas 二期保护 | 2D/3D 导演台、360 全景及其数据兼容源码；不进入首版默认入口，未批准资源不进包                                   |
| 桌面基础设施    | 精简设置、日志、签名更新、崩溃可诊断性和安全文件协议                                                           |

“受保护”保护的是已验收行为，不是永远冻结当前 10000 行以上实现。只有在等价行为和数据迁移有测试时才能替换内部实现。

## 3. T-010：依赖有向的删除批次

### 3.1 总顺序

| 批次 | 删除/替换范围                                          | 必须先完成                                                                            | 退出条件                                                               |
| ---: | ------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
|    0 | 建立保护基线，不删代码                                 | 核心旅程、49 工具、通道/Repository/资源清单                                           | 基线在受支持 Node 与打包应用可重复                                     |
|    1 | 旧主导航、Home、Project、旧 Onboarding 和页面路由      | CanvasProjectsView、Workspace、精简设置成为唯一产品入口                               | 启动后没有旧平台入口，深链和返回路径正确                               |
|    2 | `SessionSidebarProvider`、Tray 最近会话、自动查询/订阅 | T-005/T-007 运行时边界                                                                | 打开 Canvas 不启动旧 Workspace/Session/Terminal 查询，Agent 仍按需可用 |
|    3 | 从旧页面迁出共享组件                                   | 中性 Markdown、ChatPanel 所需消息卡、Avatar、ProviderLogo、Icons、AppContext 最小能力 | 删除 Chat/Agent 页面不会破坏 Canvas 节点或 Agent                       |
|    4 | 旧产品 UI 域逐个删除                                   | 每个域完成生产调用点、动态 import 和样式对账                                          | UI、route、overlay、测试和专属样式同时归零                             |
|    5 | Skill Store/通用 artifact UI 与服务                    | T-008 FFmpeg installer 独立；4 个批准 Skills 的运行时独立                             | Store/Registry 删除后 Agent Skills 和 FFmpeg 均通过                    |
|    6 | 旧主进程服务域逐个停止和删除                           | 对应 UI 已删；SessionService/Canvas Agent 无运行调用                                  | 启动、shutdown、IPC 和 background job 不再触达该域                     |
|    7 | Protocol、Repository、旧表和 migration export          | 新 `spark-canvas.db`、新 migration、seed、v3 项目包和 Agent schema 已通过             | request/stream/type/table 的生产引用为零，空库和升级测试通过           |
|    8 | npm/native 依赖、resources、scripts 和包 exports       | 打包产物、动态加载、生成资源和 target ABI 扫描                                        | 核心旅程通过，MCP helper、file-viewer 资产和 native 模块按目标完整     |
|    9 | 旧官网和发布配置                                       | D-014 至 D-018 冻结；T-011 通过                                                       | 旧站不再随桌面发布，新更新链不会串产品                                 |

### 3.2 批次 4：UI 域内部顺序

每项单独提交，不组成一次“大扫除”：

| 顺序 | UI 域                                              | 保留例外                                                         |
| ---: | -------------------------------------------------- | ---------------------------------------------------------------- |
|    1 | 旧 Team、Workflow、任务 Board、Scheduled Task 页面 | Canvas Board 完全不同，必须保留                                  |
|    2 | Browser、Remote、Git/代码工作台和 Terminal 页面    | Canvas Agent 的 SDK shell 能力与 Electron Terminal UI 分开核对   |
|    3 | Memory 页面                                        | SessionService 当前 Memory Repository/检索闭包暂受保护           |
|    4 | MCP 管理页面                                       | 当前 Canvas Agent 必需 MCP runtime 暂受保护                      |
|    5 | Skill Store 页面                                   | 默认 Canvas Assistant 的 4 Skills、Skill picker/runtime 暂受保护 |
|    6 | 通用 Chat 页面                                     | 先迁出 ChatPanel、Markdown、流式状态、取消和提问响应             |
|    7 | 通用 Agents 管理页                                 | 保留唯一默认 Canvas Assistant、内嵌选择和 Agent runtime 数据     |
|    8 | 旧 Settings 各 section                             | 以 Canvas 专用 Provider、账户、FFmpeg、更新、日志和存储设置替换  |

### 3.3 批次 6：服务域删除规则

服务层不能简单照 UI 顺序删除。每个候选域按以下判定：

- **可删除**：生产 request/stream、定时器、startup/shutdown、SessionService、Canvas tools 和动态 import 均无调用。
- **只停启动**：Canvas Agent 可能按需调用，但基础应用不应启动；移入 Agent runtime lazy boundary。
- **运行时保留**：当前 Agent 代表性旅程实际使用，或 Repository 仍被 SessionService 直接构造。
- **等待替换**：能力需要，但当前实现属于旧平台，例如 FFmpeg 对 Skill Registry 的依赖。

优先核对 Scheduler/Task Execution、Remote、Browser/Playwright、Electron Terminal/FileWatcher、旧 Board/Workflow/Team service。MCP、Skill、Memory、Session 和 Agent service 在完整 Agent 回归前默认属于运行时保护项。

### 3.4 数据和 migration 最后删除

新应用不运行旧 53 条 migration，但这不表示第一批就可以从仓库删除它们。删除前必须：

1. 新 Canvas migration 覆盖核心、Provider、托管用量和当前 Agent 真实闭包；
2. 空 userData、重复 bootstrap、失败恢复和打包资源 migration 都通过；
3. 所有旧 Repository export 的生产调用归零；
4. v3 项目包不依赖旧表即可完整导入导出；
5. 旧 Spark Agent 数据目录从未被扫描、打开或升级。

旧 migration 删除是依赖收缩的结果，不是实现新 schema 的手段。

## 4. 每个删除域的强制检查单

1. `rg`/TypeScript AST 检查静态和动态生产调用点。
2. request、stream、preload allowlist 和 main handler 四向对账。
3. startup、background timer、shutdown 和 window lifecycle 对账。
4. Repository、表、migration、seed、导入导出和保留 Agent 闭包对账。
5. 专属 UI、样式、测试、资源、文档和 package export 对账。
6. 相关单测、typecheck、构建和至少一条打包核心旅程。
7. `git diff` 只包含一个业务域；GitNexus 不可用时继续按项目降级规则提供直接调用证据。

任一项仍有不清楚的运行调用，该域只能先断启动或隐藏入口，不能宣称已删除。

## 5. T-011：生产发布状态机

### 5.1 发布级别

| 级别      | 用途     | 允许的签名状态                          | 可见范围                           |
| --------- | -------- | --------------------------------------- | ---------------------------------- |
| local     | 开发调试 | ad-hoc、自签名或未签名                  | 本机                               |
| internal  | 团队验收 | 可使用开发签名，但必须明确标记非生产    | 受控 CI artifact，不进入公开更新源 |
| candidate | 生产候选 | 必须使用目标生产证书并通过全部验证      | 受保护环境，等待人工批准           |
| stable    | 公开发布 | 生产签名、公证/时间戳、产品隔离全部通过 | Spark Canvas 独立 Release 和更新源 |

candidate 只能被“提升”为同一组已经验证过的 artifacts，不能在批准后重新构建另一组未验证文件。

### 5.2 Stable 的不可绕过硬门

**身份门**

- `productName=Spark Canvas`、`appId=com.spark.canvas.desktop`、scheme=`spark-canvas`。
- 安装目录、进程单例、userData、数据库、Keychain service、uninstall key 和 updater cache 不与 Spark Agent 冲突。
- 产物名、桌面快捷方式、协议注册和系统显示名均可区分两个产品。

**macOS 门**

- 实际证书 Subject、TeamIdentifier、有效期和使用授权已核验。
- Bundle Identifier 正确，codesign 链有效，notarytool 成功，ticket 已 staple。
- `spctl`、`codesign --verify` 和 `stapler validate` 任一失败即终止。

**Windows 门**

- 证书为获授权的生产证书，Subject 与 publisher 配置匹配，信任链符合发布要求。
- Authenticode 状态为 `Valid`，SHA-256 和 RFC 3161 时间戳存在。
- stable 禁止 `ALLOW_UNSIGNED_WINDOWS_RELEASE=1`，禁止签名失败后重试未签名打包。

**更新源门**

- GitHub Release 只指向 D-014 冻结的 Spark Canvas 仓库。
- 自建版本中心的注册、查询、唯一键和对象前缀均包含 `spark-canvas`，或切到独立服务。
- `latest*.yml`/blockmap/checksum 与同一 product、channel、platform、arch 和版本绑定。
- Desktop/Website 只使用 product 必填的严格 v2；响应身份不匹配、未知 product、hash 或签名错误一律 fail closed。
- updater 新下载与缓存都校验 size、SHA-256/SHA-512、批准 host/redirect 和平台签名，不能只凭 `isFile()` 启动。
- 两产品使用相同版本号同时发布时不会覆盖、误查或交叉升级。

**数据门**

- 稳定包首次启动不读取旧数据库、Keychain、localStorage、项目索引或 updater cache。
- Spark Agent 与 Spark Canvas 可以同时安装、启动、更新、卸载和重装。
- 卸载任一产品不会删除另一产品的数据、凭据、协议或更新状态。

**资源与权利门**

- 根代码商业授权或重新许可已由有权限主体书面确认。
- 最终安装包内每个非代码资源都命中 T-012 approved manifest，SHA-256 和大小一致。
- UE/Mixamo raw 模型等未证明可再分发的资源不在包内，4 个默认 Skills 以外的旧 Skills 不被误打包。
- 构建生成的 file-viewer WASM/worker 逐项有来源、版本、许可和 notice；Git ignore 不作为排除证明。
- `better-sqlite3` 等原生文件与目标 platform/arch/ABI 匹配，不复制 Darwin arm64 测试 prebuild 到其他平台。
- `THIRD_PARTY_NOTICES`、字体协议和要求的显著声明随同一 artifact 提供。
- 完整 Gate 见[资源来源、许可与发布门审计](./2026-07-17-canvas-resource-provenance-release-gates.md)。

### 5.3 共享与隔离边界

| 可以共享                                                                    | 必须隔离                                                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Spark 登录服务、账户、计费、订单、支付、额度、托管模型、上传 API 和上传空间 | GitHub Release、更新 metadata、版本中心 product key、对象存储前缀、安装包、app identity、本地数据、凭据 namespace、updater cache |

共享云账户不能被用作复用旧桌面更新源或本地 token 的理由。

### 5.4 CI 失败策略

- 缺少证书、Secret、公证权限、时间戳或产品 namespace：失败并停止上传。
- 验证脚本无法读取 Subject/Team/签名状态：视为失败，不按 warning 放行。
- 内部未签名 artifact 使用单独 job、单独名称和单独保留策略，永不创建 stable Release。
- 上传 Release 前生成并保存构建清单：commit、版本、平台、arch、hash、签名主体和验证结果；不包含任何私钥或密码。
- 发布后做一次从公开源安装/更新的 smoke test；失败时撤下更新 metadata，不把另一个产品的版本作为回退。

## 6. T-011 验收旅程

| 旅程                                    | 预期                                              |
| --------------------------------------- | ------------------------------------------------- |
| Spark Agent 已安装，再安装 Spark Canvas | 两个应用、协议、数据和更新状态并存                |
| 两产品同时为 `1.0.0`                    | 各自版本中心和 updater 只返回自己的产物           |
| Windows 证书缺失或无时间戳              | stable job 失败，公开 Release 无产物              |
| macOS 公证或 staple 失败                | stable job 失败，候选不能提升                     |
| Spark 云离线                            | 本地项目和 BYOK 可用，托管账户功能显示离线错误    |
| Spark Canvas 更新失败                   | 不启动/覆盖 Spark Agent，也不读取其 updater cache |
| 分别卸载两个产品                        | 另一产品仍可启动、更新并读取自己的数据            |

## 7. 已冻结的决策依赖

T-010 和 T-011 的技术边界已冻结。以下发行选择已由负责人全部确认：

1. D-014：GitHub Release 仓库；**已确认 `alexanderizh/Spark-Canvas`**。
2. D-015：**已确认共享原版本中心基础设施并实施严格 v2 `spark-canvas` 全链 product 分区**。
3. D-016：**已确认第一阶段移除旧官网、桌面稳定后单独重建；画布视频工作台可用为首版 P0**。
4. D-017：**已确认首发 macOS arm64、macOS x64、Windows x64；Linux/Windows arm64 后续**。
5. D-018：**已确认沿用原按需显式下载，不随安装包捆绑；managed 优先、兼容系统版回退，并以新受信链和合规制品替换旧链**。

D-014 至 D-018 已全部冻结，不再有待负责人选择的发行决策。这些选择影响具体配置和验收平台，不允许削弱签名、产品 namespace、本地数据隔离和不可串包四个硬门。

## 8. 冻结结论

T-010 已从“按目录删代码”收敛为九个依赖批次，并明确 Canvas Agent/共享 Spark 云保护线；T-011 已形成 local、internal、candidate、stable 四级发布状态机和不可降级安全门；T-012 又补入资源 provenance、notices 和 artifact 对账。后续实施可以据此逐域交付，不能再以旧入口已隐藏或 CI 已产出安装包代替真正的删除和发布验收。
