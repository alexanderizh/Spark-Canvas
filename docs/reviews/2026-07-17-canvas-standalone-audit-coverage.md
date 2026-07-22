# Spark Canvas 独立化审计覆盖与决策总表

> 核对日期: 2026-07-17 | 代码基线: `6cfbfcd` | 当前阶段不修改业务代码

## 1. 用途

本文件从总负责人视角检查当前审计是否真正覆盖原始目标：熟悉架构、完整列出现有功能、判断需要与不需要的模块、识别依赖闭包，并形成可以按批次实施和验收的拆分依据。

它不重复抄录各清单，而是回答：

1. 每项交付要求由哪份文档和哪类源码证据支撑。
2. 当前数字是否仍可从工作树复现。
3. 哪些边界已经冻结，哪些必须由负责人选择。
4. 哪些是技术负责人应基于证据自行收敛的设计问题，不应全部回抛给产品负责人。
5. 满足什么条件后，本轮“只审计、不改业务代码”的目标才可以判定完成。

## 2. 权威文档分工

| 文档                                                                                         | 权威范围                                                                       | 当前状态                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| [架构与功能总审计](../plans/2026-07-16-canvas-standalone-audit.md)                           | 当前架构、数据流、Canvas/影视/旧平台功能全量清单、风险和目标架构               | 已覆盖                                     |
| [AI 影视工作台范围冻结](../plans/2026-07-16-ai-film-workbench-scope-freeze.md)               | 第一版、二期、移除、替换和产品承诺                                             | 已覆盖，发布项待决策                       |
| [模块处置总账](./2026-07-16-canvas-module-disposition-ledger.md)                             | Renderer、Main、Runtime、Storage、Protocol、Shared、资源、脚本、官网和依赖去留 | 已覆盖，条件项有删除门槛                   |
| [源码依赖切片](./2026-07-16-canvas-standalone-dependency-slice.md)                           | IPC、跨目录 import、数据库、服务、启动和 npm/native 依赖闭包                   | 已覆盖                                     |
| [身份与云耦合审计](./2026-07-16-canvas-identity-cloud-coupling.md)                           | 共享 Spark 云、本地数据隔离、Keychain、深链和旧身份                            | 已覆盖                                     |
| [共享 Spark 云、计费与上传契约](./2026-07-17-canvas-shared-spark-cloud-contract.md)          | Auth/NewAPI endpoint、BYOK/托管隔离、token、上传生命周期、支付幂等和故障矩阵   | T-013 已冻结，服务端证据待取               |
| [数据权威、空库启动与项目包](./2026-07-17-canvas-data-authority-bootstrap.md)                | revision、原子保存、新数据库/项目根、bootstrap、v3 项目包和删除语义            | T-001 至 T-004 已冻结                      |
| [签名、发布与更新链审计](./2026-07-17-canvas-release-signing-readiness.md)                   | 证书、CI、GitHub Release、版本中心、MinIO 和官网发布                           | D-013 已冻结；本机无签名身份，生产证据待取 |
| [版本中心产品隔离与更新完整性](./2026-07-17-canvas-version-center-product-isolation.md)      | v1 线上矩阵、v2 schema、对象前缀、下载 hash/signature 和迁移 Gate              | D-015 已冻结，E-004 服务端实施待验收       |
| [运行时、凭据与 FFmpeg 边界](./2026-07-17-canvas-runtime-security-boundary.md)               | IPC/stream 权限、Provider vault、Agent lazy runtime 和 FFmpeg installer        | T-005 至 T-008 已冻结                      |
| [FFmpeg 分发物来源与发布门](./2026-07-17-canvas-ffmpeg-artifact-provenance-release-gates.md) | 四个 ZIP、八个二进制、上游哈希、codec/许可和签名 Gate                          | E-005 分发物已审，当前四包已拒绝           |
| [不可达模块逐文件处置](./2026-07-17-canvas-unreachable-module-disposition.md)                | 15 个不可达 Canvas 模块的删除、接管、修复和验收门                              | T-009 已冻结                               |
| [旧平台删除与发布安全门](./2026-07-17-canvas-platform-removal-release-gates.md)              | 旧平台依赖删除批次、保护闭包和生产发布状态机                                   | T-010、T-011 已冻结                        |
| [发行决策就绪审计](./2026-07-17-canvas-release-decisions-readiness.md)                       | D-014 至 D-018 的源码、在线契约、平台矩阵和 FFmpeg 许可选择依据                | D-014 至 D-018 已全部冻结                  |
| [资源来源、许可与发布门](./2026-07-17-canvas-resource-provenance-release-gates.md)           | 图片、3D、Skills、字体、官网素材、notices 和 artifact 资源对账                 | T-012 已冻结，E-006 部分闭环               |

## 3. 原始目标覆盖矩阵

| 原始要求                     | 主要证据                                                  | 判定                                      |
| ---------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| 熟悉仓库架构                 | 总审计第 3、4、9、13 节；依赖切片第 3 至 7 节             | 已覆盖                                    |
| 完整列出现有 Canvas 功能     | 总审计第 5 节                                             | 已覆盖用户能力面                          |
| 完整列出影视生产能力         | 总审计第 6 节；范围冻结第 3、4 节                         | 已覆盖第一版与二期边界                    |
| 列出 Canvas Agent 能力和成本 | 总审计第 7 节；依赖切片第 3.4、5.3 节                     | 已覆盖 49 工具及运行闭包                  |
| 列出旧 Agent 平台能力        | 总审计第 8 节；范围冻结第 5 节                            | 已覆盖并有去留结论                        |
| 逐模块判断需要/不需要        | 模块处置总账第 4 至 14 节                                 | 已按目录全覆盖加例外明示                  |
| 识别 Canvas 最小依赖闭包     | 依赖切片；模块处置总账                                    | 已覆盖 IPC、表、Service、Runtime 和包依赖 |
| 保留账户、计费和上传         | 范围冻结第 3.9 节；身份审计第 3 节；共享云专项            | 已冻结为共享 Spark 云并有 T-013 实施契约  |
| 新应用不污染旧本地数据       | 范围冻结第 7.3 节；身份审计第 4、7 节                     | 已冻结                                    |
| 独立产品和应用身份           | 范围冻结第 7.4 节；身份审计第 2 节                        | 已冻结                                    |
| 发布链独立                   | 发布审计                                                  | 决策已冻结，服务端契约仍待实施验收        |
| 数据权威与项目可移植         | 数据权威专项审计                                          | 技术契约已冻结，业务代码尚未实施          |
| 形成可执行拆分顺序           | 总审计第 14、15 节；范围冻结第 9、10 节；总账第 15、16 节 | 已形成 Phase、Gate 和删除控制线           |
| 当前阶段不修改业务代码       | Git 状态只有审计文档新增                                  | 符合                                      |

“已覆盖”表示审计证据和处置规则齐全，不表示对应业务代码已经实施或运行验收已经完成。

## 4. 当前工作树数字复核

2026-07-17 重新使用 `rg --files`、源码过滤和 TypeScript AST 读取核对，结果如下：

| 范围                                   |                              复核结果 | 与现有文档                            |
| -------------------------------------- | ------------------------------------: | ------------------------------------- |
| Renderer 非 `design` 生产入口          |                                     8 | 一致                                  |
| Renderer `design` TS/TSX 生产模块      |                                   342 | 一致                                  |
| Renderer `design` 样式                 |                                    75 | 一致                                  |
| 主应用 `ViewId`                        |                                    15 | 已补别名和嵌入入口关系                |
| Canvas TS/TSX 生产模块                 |                                   173 | 一致                                  |
| Canvas 样式                            |                                    24 | 一致                                  |
| Canvas 测试文件                        |                                    88 | 一致                                  |
| Settings 可见分区 / 隐藏未完成分区     |                                18 / 2 | 已补逐项功能与处置表                  |
| Main process 生产模块                  |                                    60 | 一致                                  |
| Preload 生产模块                       |                                     1 | 一致                                  |
| `agent-runtime` 生产运行文件           |                                   121 | 已纠正：原口径漏 9 个 MCP `.mjs` 脚本 |
| `agent-runtime` 运维脚本               |                                     2 | 已补旧 Memory 迁移与真实抽取 smoke    |
| `storage/src` 生产模块                 |                                    38 | 一致                                  |
| 历史 SQL migration                     |                                    53 | 一致                                  |
| `protocol/src` 生产模块                |                                    22 | 一致                                  |
| `shared/src` 生产模块                  |                                     8 | 一致                                  |
| Package manifest / 唯一直接依赖名      |                                7 / 89 | 已补 Renderer/UI/构建依赖处置         |
| Website 生产文件                       | 68：66 个 TS/TSX、1 个 CSS、1 个 JSON | 一致；另有 1 个测试文件               |
| Website 构建/部署脚本                  |                                     3 | D-016 已冻结首版移除                  |
| D-016 首版桌面资源候选面               |                563 / 100,549,186 字节 | 已排除 39 个旧 Website public 文件    |
| Desktop resources 文件                 |                                   156 | 一致                                  |
| Desktop scripts 文件                   |                                    19 | 一致                                  |
| Desktop E2E 文件                       |                                     2 | 已补 App smoke 与品牌旅程处置         |
| GitHub workflow                        |                                     2 | 一致                                  |
| `IpcChannelMap`                        |                                   336 | 一致                                  |
| `IpcStreamChannelMap`                  |                                    38 | 一致                                  |
| Canvas 工作区核心直接通道              |                                    43 | 一致                                  |
| 共享 Spark 上传直接通道                |                                     1 | 一致                                  |
| Canvas Agent/增强直接通道              |                                    16 | 一致                                  |
| `CANVAS_TOOLS` 工具定义                |                                    49 | 一致                                  |
| Bundled Skills                         |                                    16 | 一致                                  |
| AI 操作契约 / capability / 新建入口    |                          15 / 13 / 12 | 已补入口差异说明                      |
| 内置媒体 manifest                      |                                   101 | 已纠正：42 只是顶层表达式数           |
| manifest 唯一 ID / 结构失败 / 语义问题 |                           101 / 0 / 2 | 语义问题待 Phase 1 修复               |
| Provider vendor / preset / 媒体 preset |                          35 / 52 / 24 | 已补目录库存                          |
| 显式 media ref / 未命中非 custom ref   |                                99 / 2 | 已补 resolver 漂移                    |
| 构建生成 file-viewer 资产              |                  14 / 41,088,016 字节 | 原资源库存漏项                        |
| better-sqlite3 vendor prebuild         |                    2，均 Darwin arm64 | 原生测试矩阵漏项                      |

`6cfbfcd` 基线共有 1,782 个 tracked 文件，当前工作树对应文件字节合计 96,650,346。目录级总账已补齐此前未显式点名的 `.gitattributes`、`.gitignore`、Prettier/ESLint/TypeScript 基础配置、`docs/design`、`docs/superpowers`、`vendor/prebuilds` 和 `apps/desktop/e2e`。本机被全局 ignore 的 `.agents/.claude/.codex/.cursor` 及 `AGENTS.md`、`CLAUDE.md` 属于治理工具，不是产品运行或发行闭包。

121 个 Agent Runtime 生产文件由 109 个 TS、1 个 d.mts、2 个媒体 helper mjs 和 9 个 MCP server mjs 构成。当前构建无条件复制 9 个工具脚本，却不复制 `spark_media` 相对引用的 2 个 helper；这是打包 P0，不再用源码测试覆盖结论替代安装产物验证。

15 个操作契约并不等于所有入口各有 15 项：`CANVAS_CAPABILITIES` 缺 2 个直接条目，节点新建菜单缺 3 个操作。媒体目录也存在两类真实漂移：2 个 manifest 语义问题、2 个非 `custom:` preset ref 未命中却会被 resolver 合成。它们已进入 Phase 1 的逐项矩阵和 seed Gate。

`SettingsView` 的 18 个可见分区和 2 个隐藏未完成分区已逐项映射到保留、精简、替换或移除。Provider、Spark 账户和 FFmpeg 另有独立页面或服务入口，因此设置导航数量只用于核对该页面，不作为这些底座能力的完整库存。

七个 package manifest 指根、Desktop、Website、Agent Runtime、Protocol、Shared 和 Storage。对 `dependencies`、`devDependencies`、`optionalDependencies` 做 JSON 解析后共有 89 个唯一依赖名：70 个已在审计文档逐字出现，其余 8 个 Claude 平台 optional package 按 Canvas Agent 发行矩阵成组保护，11 个 TypeScript/ESLint/Vite/React/Node 类型工具按编译检查链成组保留。`devDependencies` 中的 Renderer 包仍会进入 Vite 产物，不能按字段名当作非生产依赖；逐域处置见源码依赖切片第 7.4 节。

资源源码三根仍是 588 文件、76,276,139 字节；加上当前构建生成的 file-viewer 14 文件后，本地候选面是 602 文件、117,364,155 字节。最终发布以干净构建后的 artifact 双向清单为权威，不把 Git ignore 当作排除证据。

超大文件行数也与治理清单一致：`protocol/src/ipc/index.ts` 6081 行、`main/ipc/index.ts` 7987 行、`CanvasWorkspaceView.tsx` 9336 行、`SettingsView.tsx` 6208 行、`design/styles/views.css` 16509 行。实施时不能继续向这些文件直接堆业务逻辑。

## 5. 已冻结边界

| 编号  | 决策           | 冻结结果                                                               |
| ----- | -------------- | ---------------------------------------------------------------------- |
| D-001 | 产品定位       | AI 影视/短剧生产工作台                                                 |
| D-002 | 核心生产链     | 项目 -> 文稿/剧本 -> 角色与场景 -> 分镜 -> 关键帧 -> AI 视频 -> FFmpeg |
| D-003 | Canvas Agent   | 第一版保留当前完整实现、49 工具和所需运行闭包                          |
| D-004 | 模型模式       | BYOK + Spark 官方托管模型                                              |
| D-005 | Spark 云       | 完全共用账户、余额、套餐、订单、支付、模型额度和上传空间               |
| D-006 | BYOK 可用性    | 不得被登录或 Spark 云故障阻塞，不允许静默切换/扣费                     |
| D-007 | 本地数据       | 全新开始；不读取、升级或迁移旧本地数据                                 |
| D-008 | 旧项目入口     | 只允许用户主动导入 JSON/目录项目包                                     |
| D-009 | 产品名         | `Spark Canvas`                                                         |
| D-010 | 应用身份       | `com.spark.canvas.desktop` + `spark-canvas`                            |
| D-011 | 本地凭据       | `SparkCanvas.CloudAuth` + `spark-canvas` Provider vault                |
| D-012 | 内部包名       | 第一阶段保留 `@spark/*`，不为品牌做全仓移动                            |
| D-013 | 生产签名       | 同一合法发行主体且证书可用时复用原生产身份；实际证书核验为发布硬门     |
| D-014 | GitHub Release | 当前 `alexanderizh/Spark-Canvas` 仓库同时承载源码和 Release            |
| D-015 | 版本中心       | 共用原基础设施，实施严格 v2 `spark-canvas` 全链 product 分区           |
| D-016 | 第一阶段官网   | 从 workspace/CI/发布链移除旧站，桌面稳定后单独重建；视频工作台为 P0    |
| D-017 | 首发平台       | macOS arm64、macOS x64、Windows x64；Linux 和 Windows arm64 后续       |
| D-018 | FFmpeg 分发    | 沿用原按需显式下载；managed 优先、兼容系统版回退；新受信链替换旧制品   |

## 6. 已冻结的负责人决策

这些事项涉及发行权属、额外基础设施成本或产品对外承诺，现已全部由负责人确认。

| 编号  | 决策        | 冻结结论                                                                                  | 实施/发布 Gate                |
| ----- | ----------- | ----------------------------------------------------------------------------------------- | ----------------------------- |
| D-018 | FFmpeg 分发 | 沿用原按需显式下载；managed 优先、兼容系统 PATH FFmpeg 回退；不得沿用旧 Registry 和拒绝包 | 新合规 descriptor、制品和许可 |

D-014 至 D-018 已全部冻结，不再有待负责人选择的发行决策。

## 7. 技术负责人自行收敛的设计项

这些事项不需要默认回抛给产品负责人。应在对应实施批次前通过源码、测试和数据安全分析形成技术 ADR 或实现规格；只有出现明显产品/成本权衡时才升级提问。

| 编号  | 技术设计项                                | 当前约束                                                                            | 最迟完成点           |
| ----- | ----------------------------------------- | ----------------------------------------------------------------------------------- | -------------------- |
| T-001 | 项目快照、SQLite、Renderer 缓存的权威顺序 | **已冻结**：目录权威、SQLite 同 revision 恢复镜像、Renderer 草稿                    | 存储实施前           |
| T-002 | 新数据库文件名、项目根和 migration 基线   | **已冻结**：`spark-canvas.db`、`projects/`、新 Canvas 链                            | Phase 1              |
| T-003 | 空数据 seed 清单                          | **已冻结**：唯一默认 Canvas Assistant、4 Skills、批准集合；当前 101 manifests       | Phase 1              |
| T-004 | JSON/目录项目包规格                       | **已冻结**：v3 目录包完整迁移，v1/v2 JSON 兼容快照导入                              | Phase 1              |
| T-005 | IPC/stream allowlist                      | **已冻结**：双层默认拒绝、canonical 路径/归属、symlink 防逃逸和定向 stream          | Phase 2              |
| T-006 | Provider vault 初始化位置                 | **已冻结**：核心启动早于 Auth/Provider IPC，禁用旧凭据 fallback                     | Phase 2              |
| T-007 | Canvas Agent 按需 Session 启动            | **已冻结**：去 Sidebar/Skills/MCP 启动副作用，发送 turn 时单飞启动                  | Phase 2              |
| T-008 | FFmpeg installer 抽离                     | **已冻结**：专用受信 manifest、原子版本安装，不依赖 Skill Registry                  | Phase 3              |
| T-009 | 15 个静态不可达 Canvas 模块               | **已冻结**：4 删除、4 直接接管、3 更新后接管、4 保留并接入                          | 对应 Canvas 拆分批次 |
| T-010 | 旧平台按域删除                            | **已冻结**：九个依赖批次、受保护闭包和逐域强制检查单                                | Phase 4/5            |
| T-011 | 生产更新安全门                            | **已冻结**：四级发布状态机；稳定发布不可降级且产品全链隔离                          | 发布实施前           |
| T-012 | 资源 provenance 与 notices                | **已冻结**：approved manifest 默认拒绝、动态依赖资源、随包 notices 和 artifact 对账 | 资源删除/发布前      |
| T-013 | 共享 Spark 云路由、计费与上传隔离         | **已冻结**：计费域固定、token 主进程边界、上传生命周期和订单幂等                    | Phase 2/共享云实施前 |

## 8. 外部证据与实施前核验

以下信息无法从当前仓库单独证明，但已明确责任和阻塞点：

| 编号  | 证据或待核验项                                      | 当前状态/获取方式                                                        | 阻塞点                   |
| ----- | --------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------ |
| E-001 | Node 22.14.0 的测试/typecheck 基线                  | 已实跑；包级基线通过，Desktop 基线仍非绿                                 | 第一批业务改动           |
| E-002 | macOS 证书 Subject、Team、有效期和授权              | 本机已核对为 `0 valid identities`；仍需 Apple/CI evidence packet         | D-013/发布               |
| E-003 | Windows 证书 Subject、Issuer、有效期和信任链        | 本机、环境和两仓库未发现证书；仍需目标 pfx 的 evidence packet            | D-013/发布               |
| E-004 | 自建版本中心服务端 schema 和唯一键                  | D-015 已选共享严格 v2；仍需真实服务端 diff、token scope、迁移和运行验收  | 版本中心实施/发布        |
| E-005 | FFmpeg 二进制的 GPL、codec 和再分发条件             | 四包/八个二进制已逐哈希审计并拒绝稳定发布；替代构建和法律批准待实施      | FFmpeg 实施/打包         |
| E-006 | 图片、3D、Skill、字体、示例、官网和生成依赖资产许可 | 已覆盖 588 源码文件 + 14 个生成文件和 T-012；授权、替换与 notices 待实施 | 删除/发布资源批次        |
| E-007 | 真实 Provider、FFmpeg、Electron Canvas、二期 3D E2E | 在打包应用运行代表性旅程；3D 不阻塞首版                                  | 实施验收，不阻塞审计成稿 |
| E-008 | Auth/NewAPI 服务端 schema 与运营策略                | 客户端 endpoint 已审；上传 TTL/删除、订单幂等、多客户端 token 待取证     | T-013/stable             |

E-001 已取得真实证据，但不能标记为“全绿”：Protocol、Shared、Storage、Agent Runtime 和 Desktop Renderer typecheck 通过，Desktop Main/Preload 有 6 个错误；Protocol 61、Shared 27、Storage 176、Agent Runtime 1141 个测试通过；Desktop 为 181/189 个文件通过、1151 个测试通过、29 个失败、4 个 todo，另有 2 个 suite 导入失败。该结果把“缺运行环境”收敛为可执行的 Phase 0 修复清单。

E-002、E-003 已完成当前开发机与两个仓库可见范围的只读核验：用户 Keychain 中没有有效代码签名身份，当前进程没有签名相关环境变量，两仓库当前工作树也没有证书文件。该结果不覆盖 GitHub Secrets、Apple Developer 账户或受控 Windows 签名环境，因此状态是“本机已核对、生产证据仍缺”，不能写成证书不可用或签名已就绪。生产证据须按签名审计第 3.5 节生成并绑定候选产物哈希。

E-005 已完成当前在线分发物的真实字节审计：四个 archive hash 均匹配，但 arm64 版本标签错误、Windows 混合两代 npm 包、所有 ZIP 都剥离许可材料，macOS/Windows 还存在无效或缺失代码签名。状态不是“来源完全未知”，而是“来源已追到、当前包明确拒绝、替代基线和法律批准待实施”。

E-004 已完成仓库可见契约和线上只读矩阵：所有 product/appId 变体仍返回 Spark Agent，桌面端还丢弃服务提供的 SHA-512 并信任未校验缓存。共享/独立两种部署的严格 v2、数据约束、迁移顺序与验收 Gate 已形成；服务端源码/schema、token scope 和真实迁移仍是实施证据，不能伪装成已落地。

E-008 已完成客户端两层服务和 23 个 edu-server、15 个 NewAPI/推理 method+path 的源码库存，并证明当前托管能力只含文本。仓库不含服务端源码，因此上传公开性/TTL/删除、支付订单/幂等、quota 金额单位以及 Spark Agent/Canvas 并行 token 策略仍必须由后端 schema、测试环境和运营配置提供证据。

## 9. 本轮审计目标完成判定

只有同时满足以下条件，才能把“当前阶段只做审计”的目标标记完成：

1. 本文件第 3 节所有原始要求都有权威证据，且数字复核没有矛盾。
2. D-014 至 D-018 按顺序得到负责人确认并同步回范围、总账和相关专项审计；D-013 已冻结。
3. T-001 至 T-013 至少有明确实施批次、不可违反的约束和验收门；不要求本阶段修改业务代码。
4. 所有 `待确认` 模块都有责任人、触发时点和删除前证据要求，不把未知项伪装成可删除项。
5. E-001 至 E-008 明确当前证据、获取方式和阻塞阶段；部分验证和全绿验收不会混写。
6. 审计文档格式、相对链接、状态标记和当前工作树范围检查通过。

当前第 1 至 6 项均已具备文档依据，T-001 至 T-013 全部形成冻结契约，D-013 至 D-018 已全部确认。E-001 已完成实跑但基线非绿，E-002/E-003 已核对本机但仍缺生产证据，E-004 已审完现有契约、D-015 已冻结，但服务端迁移尚未实施，E-005 已审完现有分发物但替代基线未实施，E-006 已覆盖源码与当前动态生成资产并建立发布门，但授权/替换和最终 artifact 对账尚未实施，E-008 已审完客户端但服务端证据待取；这些属于后续实施和 candidate/stable 发布 Gate，不阻塞本阶段审计定稿。
