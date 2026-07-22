# Spark Canvas 旧身份、云服务与本地数据耦合审计

审计日期：2026-07-16
代码基线：`6cfbfcd Copy full spark-agent monorepo into Spark-Canvas`
决策更新：2026-07-17，产品名为 `Spark Canvas`，应用身份采用方案 1；首版完全共用 Spark 云账户，但本地数据全新开始、不自动迁移；生产签名在同一合法主体且证书可用时复用原身份。

## 1. 审计目的

本文件回答独立化过程中另一个高风险问题：哪些 `Spark Agent` / `SparkWork` 身份只是文案，哪些已经进入运行时协议、凭据、本地数据、更新和发布链。

签名、CI Secret、GitHub Release、自建版本中心和官网发布的下钻证据见 [`2026-07-17-canvas-release-signing-readiness.md`](./2026-07-17-canvas-release-signing-readiness.md)。

Auth/NewAPI 完整 endpoint、托管文本范围、BYOK 路由隔离、上传生命周期、支付幂等和故障矩阵见 [`2026-07-17-canvas-shared-spark-cloud-contract.md`](./2026-07-17-canvas-shared-spark-cloud-contract.md)。

项目目录/SQLite/Renderer 权威、空库 bootstrap 和项目包 v3 的冻结契约见 [`2026-07-17-canvas-data-authority-bootstrap.md`](./2026-07-17-canvas-data-authority-bootstrap.md)。

结论先行：不能用全仓字符串替换完成改名。新应用虽不迁移旧本地数据，仍必须从第一次运行就使用独立身份，避免误读或覆盖以下旧数据：

1. Electron `appId`、应用名与 `userData` 目录。
2. Keychain service/account 和 safeStorage 加密文件。
3. `spark-agent://` 深链及更新/发布契约。
4. Canvas 的 localStorage、默认项目目录和导入导出标识。

第三方 Provider 的官方 API URL 不属于旧 Spark 云，不能因为“清理 URL”批量删除。负责人已批准继续共享原 Spark Auth、Platform Model、计费、支付和上传服务；本清单只把桌面产品身份、无关旧平台服务、旧仓库和旧发布基础设施列为替换对象。

## 2. 当前应用身份

### 2.1 安装包和操作系统身份

| 标识                        | 当前值                    | 影响范围                                  | 目标处置                           |
| --------------------------- | ------------------------- | ----------------------------------------- | ---------------------------------- |
| 根包名                      | `spark-agent`             | workspace、脚本、日志、导入导出 metadata  | 替换                               |
| Desktop 包名                | `@spark/desktop`          | pnpm filter、构建和发布脚本               | 品牌后改                           |
| Electron `appId`            | `com.spark-agent.desktop` | 安装身份、系统权限、更新和并存安装        | 替换为 `com.spark.canvas.desktop`  |
| `productName`               | `Spark Agent`             | `.app`/exe/安装包名、默认 `userData` 名称 | 替换为 `Spark Canvas`              |
| macOS `CFBundleDisplayName` | `SparkWork`               | Finder、菜单栏和系统弹窗                  | 替换为 `Spark Canvas`              |
| Windows publisher           | `Spark Foundation`        | 签名和安装器发布者显示                    | 使用原生产证书实际 Subject，待核验 |
| Windows 快捷方式/卸载名     | `SparkWork`               | 开始菜单和卸载列表                        | 替换为 `Spark Canvas`              |
| Linux desktop `Name`        | `SparkWork`               | 桌面菜单                                  | 替换为 `Spark Canvas`              |
| URL scheme                  | `spark-agent`             | 兑换码、远程配对、单实例参数              | 替换为 `spark-canvas`              |
| 安装包模板                  | `${productName}-...`      | 下载页、发布注册和更新资源匹配            | 替换                               |
| Updater cache               | `spark-agent-updater`     | `{userData}` 下安装包缓存                 | 替换                               |
| 开发 Updater cache          | `spark-agent-dev-updater` | 本地更新测试                              | 替换                               |

冻结的新应用身份为：

- Electron `appId`：`com.spark.canvas.desktop`。
- `productName` 及三端系统显示名：`Spark Canvas`。
- URL scheme：`spark-canvas`；兑换回调为 `spark-canvas://redeem`。
- Cloud Auth Keychain service：`SparkCanvas.CloudAuth`。
- Provider vault Keychain service：`spark-canvas`，account 继续使用 `credential-vault-v1`。
- 新导出 metadata 和默认文件名前缀：`spark-canvas`。

这些值属于目标配置，不表示当前源码已经修改。第一阶段继续保留内部 `@spark/*` 包名。

证据入口：

- `package.json`
- `apps/desktop/package.json`
- `apps/desktop/electron-builder.yml`
- `apps/desktop/dev-app-update.yml`
- `apps/desktop/src/main/index.ts`
- `packages/shared/src/constants/index.ts`

### 2.2 源码包命名

`@spark/protocol`、`@spark/storage`、`@spark/shared`、`@spark/agent-runtime` 被 Desktop 构建、TypeScript path、测试和包 exports 广泛引用。

处置：第一阶段保留内部包名。先收缩运行闭包，再决定是否统一换成新品牌命名；不要为了视觉改名制造一次全仓移动。`agent-runtime` 只有在真正不再包含 Agent 后才改成媒体运行时名称。

以下字符串属于兼容契约，改名时要考虑导入旧文件：

- Provider 导出 `exportedBy: 'spark-agent'`。
- Scheduled Task/旧平台导出 `exportedBy: 'spark-agent'`。
- 默认导出文件名 `spark-agent-providers-*`、`spark-agent-export-*`、`spark-agent-tasks-*`。
- MCP client 名 `spark-agent`、Canvas MCP server 名 `spark_canvas`。

旧格式读取可以兼容原值，新的导出应写新产品标识；不能通过拒绝旧 `exportedBy` 让用户已有配置失效。

## 3. 共享 Spark 云与其他运行时闭包

### 3.1 Cloud Auth 与素材上传

| 项目            | 当前实现                                                        | 独立化处置                                           |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| 默认服务地址    | `https://spark.yiqibyte.com/`                                   | 保留，作为批准共享的 Spark 云入口                    |
| 开发覆盖        | `SPARK_EDUGEN_BASE_URL`                                         | 保留兼容；若新增中性别名，不删除旧配置读取           |
| API 前缀        | `/api/v1`                                                       | 保留并建立账户、计费、模型、上传契约测试             |
| 登录/注册       | captcha、验证码、注册、登录、刷新、微信登录、绑定邮箱、修改密码 | 保留，与原 Spark Agent 共用账户                      |
| 用户资料        | `/me`、bind status、昵称等                                      | 保留，同一 Spark 用户 ID                             |
| Canvas 素材上传 | `/api/v1/upload`，返回第三方模型可访问的公网 URL                | 保留为显式策略；BYOK 默认 base64/Provider 原生上传   |
| Token 存储      | Keychain `SparkAgent.CloudAuth` + `cloud-auth-session.enc`      | 不迁移；新应用重新登录并写入 `SparkCanvas.CloudAuth` |

Canvas 核心对 Cloud Auth 的直接业务依赖包括官方托管模型、账户/账务和需要公网 URL 的媒体输入上传。`AuthProvider` 保留，但云初始化失败不能阻塞项目打开和 BYOK；Provider vault 初始化仍要移出 Auth IPC 注册器。

当前上传调用只保留 `aiUrl` 并丢弃 `fileKey`，没有 TTL/删除/引用闭环；token refresh 还会把明文 token 广播给全部窗口。这两项是 T-013 的 stable 阻塞点，不属于“保留旧服务即可继续沿用”的兼容细节。

### 3.2 Platform Model / NewAPI

当前平台模型包含：

- 登录和换取管理 token。
- 查询套餐、订阅、模型、额度和使用日志。
- 兑换码充值。
- 支付表单。
- 创建/恢复平台 API Key。
- `spark-agent://redeem` 深链。

源码中的受管 Provider 固定为 `modelType: text`、Anthropic 兼容 `/v1/messages`，没有媒体 capability，也会被 Canvas media provider 解析明确排除。因此当前只证明托管文本/Canvas Agent，不能据此宣称托管图片或视频。

凭据和设置按原 Spark 用户 ID 分区：

- Keystore ref：`newapi-spark-user-{sparkUserId}-access-token`
- Keystore ref：`newapi-spark-user-{sparkUserId}-api-key`
- Settings category：`platform-model:{sparkUserId}`

处置：`保留`。负责人确认 Canvas 与原 Spark Agent 完全共用账户、余额、套餐、订单、支付和上传空间，因此继续使用原 Spark 用户 ID、Platform Model 服务、Keystore ref 和 Settings category。Spark Canvas 只注册 `spark-canvas`，兑换回调改为 `spark-canvas://redeem`；原客户端继续拥有 `spark-agent://redeem`。共享后端必须按客户端分别生成回调，不能让两个应用争抢同一 scheme。

### 3.3 自动更新

当前 `UpdateService` 的顺序：

1. 默认请求 `https://spark.yiqibyte.com/api/v1/desktop/releases/latest`。
2. 不可用时回退 GitHub owner `alexanderizh`、repo `spark-agent`。
3. 下载到 `{userData}/spark-agent-updater/{version}`。
4. 使用 `Spark-Agent-Updater` User-Agent。

处置：保留自动更新能力，替换官网版本中心、GitHub 仓库、缓存名、User-Agent、签名证书和安装包匹配规则。新应用首次发布前必须同时验证检查、下载、校验、安装和跨版本升级，不能只改配置文件。

### 3.4 FFmpeg 安装源

FFmpeg 探测、probe 和视频处理本身不依赖旧云；安装入口当前通过 Skill Registry 读取：

`https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json`

处置：保留 FFmpeg 能力并沿用原用户体验，但替换安装器和源。FFmpeg 不随安装包捆绑；用户从设置或视频工作台按需显式下载，验证通过的 managed 本地版本为主路径，兼容的系统 PATH FFmpeg 为兜底。两者都不可用时进入 `setup-required`，不静默请求旧 artifact、任意 URL 或云端处理。

受控下载必须改用 Spark Canvas 专用受信 descriptor、独立安装器和合规制品。旧通用 Skill Registry/manifest 与当前四个已拒绝 ZIP 只允许 local/internal 研究，不得进入 candidate/stable。

完成替换前不能删除 Skill Registry，也不能把“系统已有 FFmpeg”的开发机结果当成新用户安装链已通过。

### 3.5 影视资产 URL 兼容

`packages/shared/src/edu-asset-url.ts` 识别：

- `spark.yiqibyte.com`
- `www.yiqibyte.com`
- `yiqibyte.com`

并把旧上传路径规范化到 `https://www.yiqibyte.com/edu-prod`。14 个 Canvas 文件仍调用该能力。

处置：这些域名仍是共享 Spark 上传空间的正常运行时契约，不只属于旧项目兼容。保留 URL 解析和历史路径规范化；可以把函数命名改为中性语义，但不能删除域名支持或设置截止版本。

### 3.6 发布和官网

桌面发布当前同时写入：

- GitHub Release：`alexanderizh/spark-agent`。
- MinIO S3 兼容桶。
- edu-server `/api/v1/ci/desktop/releases/register`。

涉及的 CI 配置名包括：

- `RELEASE_API_BASE`
- `RELEASE_CI_TOKEN`
- `RELEASE_MINIO_ENDPOINT`
- `RELEASE_MINIO_BUCKET`
- `RELEASE_MINIO_ACCESS_KEY`
- `RELEASE_MINIO_SECRET_KEY`

官网构建还通过 `RELEASES_API_BASE` / `VITE_RELEASES_API_BASE` 拉取下载快照，开发代理指向 `spark.yiqibyte.com`。

处置：共享账户、模型和上传 API 可以继续使用 `spark.yiqibyte.com`；桌面更新、发布桶、GitHub 仓库、下载产物、官网和联系信息仍按独立产品品牌决策处理，不能因共用云账户而继续发布原 Spark Agent 安装包。

## 4. 本地数据身份与迁移风险

### 4.1 旧 `userData` 的隔离边界

| 当前落点                  | 用途                        | 处置                                                |
| ------------------------- | --------------------------- | --------------------------------------------------- |
| `spark.db`                | SQLite 全平台数据库         | 不读取、不升级、不复制；新应用建立新 schema         |
| `canvas-projects/`        | 默认 Canvas 项目根          | 不自动发现或挂载；旧项目由用户导出/导入             |
| `.spark-artifacts/media/` | 媒体生成与视频工作台产物    | 不扫描或复制；随用户主动项目包导入的资产进入新项目  |
| `bin/`                    | 托管 FFmpeg                 | 不复用；新应用重新检测或安装                        |
| `credential-vault-v1.enc` | Provider/API Key 集中 vault | 不读取；用户重新配置 BYOK                           |
| `cloud-auth-session.enc`  | 原 Spark 登录态             | 不读取；用户在新应用重新登录同一 Spark 账户         |
| `skills/`                 | 内置/安装 Skill             | 不迁移；新应用只种入批准的 Canvas Agent 影视 Skills |
| Updater cache             | 下载中的安装包              | 不读取；新发布身份使用独立缓存                      |

`app.getPath('userData')` 通常受应用名/打包身份影响。负责人已选择全新开始并冻结 `com.spark.canvas.desktop` / `Spark Canvas`，因此首次正式运行必须得到独立空目录，不能用旧目录作回退。

全新开始顺序：

1. 应用已冻结的 `com.spark.canvas.desktop`、`Spark Canvas`、`SparkCanvas.CloudAuth` 和 `spark-canvas` Provider vault，并固定新 `userData`、`spark-canvas.db` 和默认 `projects/`。
2. 启动时只创建新 schema，不探测旧 Spark 路径。
3. 幂等种入唯一默认 Canvas Assistant、批准的 4 Skills、批准的内置媒体 manifest 集合和设置；当前源码基线为运行时展开后的 101 项，不自动导入宿主 Claude/Codex Skills。
4. 用户重新登录同一 Spark 云账户并重新配置 BYOK。
5. 旧项目只通过用户明确选择的 JSON/目录项目包导入，原目录永不被新应用写入。

### 4.2 项目目录

项目目录至少包含：

- `snapshots/latest.json`
- `assets/*`
- 项目封面和导出包引用

项目目录是已保存项目内容的权威源；SQLite 只保存项目索引、查询缓存和同 revision 恢复镜像，Renderer 内存/localStorage 只作编辑草稿。保存必须使用 revision 和原子替换，不能在目录写失败后返回成功或让旧目录快照遮蔽新 SQLite。

旧数据库中的 `canvas_projects.root_path` 不会被新应用读取。用户若要继续使用旧项目，应先在旧应用导出目录项目包，再在新应用主动导入；v3 包只含包内相对路径并校验 checksum/大小，导入器复制到新项目根后原子提交，不能继续写原目录。v1/v2 JSON 只作兼容快照导入，不承诺音视频完整可移植。

### 4.3 OS Keychain 与 safeStorage

| 凭据域          | 当前 service/account                                   | 风险                                     |
| --------------- | ------------------------------------------------------ | ---------------------------------------- |
| Provider vault  | service `spark-agent`，account `credential-vault-v1`   | 直接改 service 会读不到所有 BYOK API Key |
| Provider 旧条目 | service `spark-agent`，account 为 provider/profile ref | 当前会按需迁入集中 vault；兼容期仍需读取 |
| Cloud Auth      | service `SparkAgent.CloudAuth`，三个 account           | 登录 token、refresh token、user ID       |
| Platform Model  | Provider vault 中 `newapi-spark-user-*` refs           | 与原 Spark 用户 ID 绑定                  |

Spark Cloud Auth 和 Platform Model 继续使用同一后端账户，但新应用不读取旧 `SparkAgent.CloudAuth`、Provider vault 或 `newapi-spark-user-*` 本地条目。用户重新登录后在新凭据 namespace 写入 Token，并重新配置 BYOK；旧 Keychain 条目保持不变。

目标凭据落点为 Cloud Auth service `SparkCanvas.CloudAuth`，以及 Provider vault service `spark-canvas` / account `credential-vault-v1`。`cloud-auth-session.enc` 和 `credential-vault-v1.enc` 可以在独立新 `userData` 内沿用文件名，因为目录身份已经隔离；不得增加读取旧目录或旧 Keychain service 的回退。

### 4.4 Canvas localStorage

独立产品仍有价值的本地 key：

- `spark-canvas:v1`
- `spark-canvas:auto-save:{projectId}`
- `spark-canvas:operation-presets:v1`
- `spark-canvas:operation-last-used:v1`
- `spark-canvas:inline-ai-composer:v1`
- `spark-canvas:inline-ai-composer:advanced-open:v1`
- `spark-canvas:side-panel-width`
- `spark.canvas.video-submit-reminder.v1.dismissed`
- `spark.stage3d.savedPoses`

Canvas Agent 已确认第一版保留，但以下旧 key 不迁移；新应用从默认值重新创建：

- `spark-agent:canvas-agent-composer-prefs`
- `spark-agent:canvas-agent-input-drafts`
- `spark-canvas:agent-panel-width`
- `spark-canvas:agent-panel-open`
- `spark-canvas:agent-panel-open-default-v2`
- `spark-canvas:agent-panel-width-migrated-v2`

新应用不读取任何旧 localStorage key。旧 Chat/Session/Agent/Team/Workflow 与 Canvas key 都留在原应用目录；新产品可使用新品牌 key 或在独立 `userData` 中复用无冲突的 Canvas key，但不得实现旧路径回退。

## 5. 随旧平台域删除的身份

以下标识属于确定移除的旧平台域，不需要为独立 Canvas 保留长期兼容：

- `~/.spark-agent/memory/**`
- `~/.spark-agent/board-tasks.json`
- Remote 配对 `spark-agent://remote-pair`
- Chat/Agent/Team 的 localStorage key
- Browser 默认打开旧官网
- Claude/Codex/MCP client 的 `Spark Agent` 名称
- 旧 Agent 系统通知、权限弹窗和远程连接文案

前提仍是对应旧域已经停止挂载和启动。不要只删目录字符串而保留仍会读写它的服务。

## 6. 不能误删的第三方 URL

以下 URL 类型属于独立产品需要的外部能力，应由 Provider/manifest 或共享 Spark 云 allowlist 管理，不能随网络清理误删：

- OpenAI-compatible API base URL。
- Google Generative AI、火山方舟、xAI 等官方接口。
- 用户自定义 Provider Base URL。
- GitHub API 仅在保留自动更新回退时使用；代码 Agent GitHub Connector 仍应删除。

域名清理验收必须使用明确 allowlist：第三方 Provider 与批准共享的 Spark Auth/Platform Model/支付/上传域名可以保留，其余旧产品网络依赖必须归零。

## 7. 独立身份迁移门槛

### Gate I：全新本地数据策略

- 已确认不迁移旧 Spark 数据、项目索引、凭据、登录态、偏好或 Agent 历史。
- 新应用不扫描、读取、升级或写入旧 `userData`、项目目录、Keychain 和 localStorage。
- 用户主动项目包导入是唯一旧项目入口，导入失败不修改源包或原项目。

### Gate II：冻结共享 Spark 云边界

- Auth、账户、余额、套餐、订单、支付、Platform Model 和 `/upload` 继续使用原 Spark 契约。
- 共享云失败时项目和 BYOK 路径仍可使用，且不得静默消耗托管额度。
- Provider vault 初始化不再位于 Auth IPC 注册器。
- FFmpeg 安装不再读取旧 MinIO manifest。
- 自动更新和发布源与共享账户 API 分开处置，不隐式沿用旧安装包。

### Gate III：建立全新本地身份

- `com.spark.canvas.desktop` / `Spark Canvas` 与旧应用可并存测试，且只注册 `spark-canvas` scheme。
- `SparkCanvas.CloudAuth` 和 `spark-canvas` Provider vault 不读取或覆盖旧 Keychain service。
- 空 `userData` 自动创建 `spark-canvas.db`、`projects/`、唯一默认 Canvas Assistant、4 Skills 和批准的媒体 manifest 集合；当前基线为 101 项，数量和 ID 从批准集合读取。
- 用户重新登录共享 Spark 账户、重新配置 Provider API Key，且日志不泄密。
- v3 目录项目包由用户主动导入，图片、音频和视频资产完成路径、大小与 checksum 校验后复制；v1/v2 JSON 明示兼容限制。
- 测试证明新应用未访问或修改旧本地目录。

### Gate IV：替换发布身份

- 复用原生产签名身份的合法主体、证书 Subject/Team/Issuer/有效期、公证和时间戳已核验，稳定发布不可降级为未签名产物。
- 新图标、协议、仓库、更新源和官网全部就绪。
- macOS/Windows 安装、升级、卸载和重装旅程通过。
- 打包产物、关于页、日志、导出文件和系统通知不再出现旧应用身份；网络请求只允许批准共享的 Spark 云域名。

## 8. 验收检索规则

最终清理时至少检查并按用途分类：

- `Spark Agent`
- `SparkWork`
- `spark-agent`
- `com.spark-agent.desktop`
- `minio.yiqibyte.com`
- `spark-agent.dev`
- `alexanderizh/spark-agent`

以下标识允许继续出现在共享云协议或新本地数据中：

- `Spark Canvas`
- `com.spark.canvas.desktop`
- `spark-canvas`
- `SparkCanvas.CloudAuth`
- `spark.yiqibyte.com`
- `www.yiqibyte.com`
- `newapi-spark-user-*`
- `platform-model:{sparkUserId}`

旧本地 Keychain service `SparkAgent.CloudAuth` 不进入新应用正常路径；后端账户共享不等于本地 Token 共享。

其余旧应用身份只允许出现在迁移代码、旧格式读取兼容或历史 changelog 中，并必须有明确用途。发布配置和用户界面不能因共享账户而继续冒充原 Spark Agent 产品。

## 9. 已确认与仍需负责人确认

1. 数据兼容：**已确认全新开始，不自动迁移旧本地数据；旧项目仅手工导入**。
2. 模型商业模式：**已确认混合模式，并完全共用原 Spark 账户、账务和上传空间**。
3. 产品与应用身份：**已确认 `Spark Canvas`、`com.spark.canvas.desktop`、`spark-canvas`、`SparkCanvas.CloudAuth` 和 `spark-canvas` Provider vault**。
4. 生产签名：**已确认同一合法发行主体且证书可用时复用原生产身份；公开发布前仍需核验证书和授权**。
5. GitHub Release：**已确认使用当前 `alexanderizh/Spark-Canvas` 仓库**。
6. 版本中心：**已确认共用原基础设施并实施严格 v2 `spark-canvas` 全链 product 分区**。
7. 第一阶段官网：**已确认从 workspace/CI/发布链移除旧站，桌面稳定后单独重建；画布视频工作台可用为首版 P0**。
8. 首发平台：**已确认 macOS arm64、macOS x64、Windows x64；Linux/Windows arm64 后续**。
9. FFmpeg 分发：**已确认沿用原按需下载加系统回退体验；managed 版本优先，旧 Registry 链和已拒绝制品必须替换**。

D-014 至 D-018 已全部冻结，不再有待负责人选择的发行决策。本地数据无需等待迁移，但必须从第一次正式运行就使用已冻结的新身份和数据契约；FFmpeg 替代制品、许可和三平台 evidence packet 是实施/发布 Gate，不是审计决策阻塞项。
