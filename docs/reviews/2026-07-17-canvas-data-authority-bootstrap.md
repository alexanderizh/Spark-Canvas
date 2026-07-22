# Spark Canvas 数据权威、空库启动与项目包审计

> 审计快照: 2026-07-17 | 代码基线: `6cfbfcd` | 本阶段只形成拆分依据，不修改业务代码

## 1. 审计目的

本文件收敛 Spark Canvas 独立化中的四项数据设计：

1. 项目目录、SQLite 与 Renderer 热存储谁是权威。
2. 全新 `userData` 应建立什么数据库、项目根和 migration 基线。
3. 空库应种入哪些 Agent、Skills、媒体模型清单和默认设置。
4. JSON 与目录项目包怎样兼容旧导出，同时保证音视频可移植和导入安全。

它同时核对归档、软删除和永久删除语义。当前源码仍保持不变；本文件定义后续实施不得违反的契约和验收 Gate。

关联文档：

- [范围冻结](../plans/2026-07-16-ai-film-workbench-scope-freeze.md)
- [架构与功能总审计](../plans/2026-07-16-canvas-standalone-audit.md)
- [源码依赖切片](./2026-07-16-canvas-standalone-dependency-slice.md)
- [模块处置总账](./2026-07-16-canvas-module-disposition-ledger.md)
- [旧身份与云耦合审计](./2026-07-16-canvas-identity-cloud-coupling.md)
- [审计覆盖与决策总表](./2026-07-17-canvas-standalone-audit-coverage.md)

## 2. 结论摘要

1. 当前保存会先写项目目录，再写 SQLite；项目目录写失败只记 warning，随后仍更新 SQLite 并返回 `saved: true`。
2. 当前加载却优先读取项目目录 `snapshots/latest.json`，只有目录读取失败才回退 SQLite。因此一次目录写失败后，旧目录快照会遮蔽更新后的 SQLite，重启可能回到旧内容。
3. 源码注释把 SQLite 称为生产权威，但真实加载顺序以项目目录为先，当前是没有 revision 对账的双主模型。
4. Renderer 把整库写进 `spark-canvas:v1`，约 4 MB 后只留内存；自动保存默认关闭。它适合作为当前编辑草稿，不具备独立持久化权威的可靠性。
5. 当前项目目录写入不是原子替换，每次保存都会新增时间戳快照，也没有保留上限。
6. 当前 UI 只能选择 JSON 文件导入；目录项目包可以导出，但没有目录包导入入口。JSON 只内嵌图片，音频和视频仍可能引用本机路径。
7. 当前 v2 项目包仍写 `app: Spark-Agent`，并在快照中保存绝对路径或 `safe-file://` URL；没有 checksum、大小清单、总量限制或严格的包根路径约束。
8. 当前 JSON 导入会尝试复制快照中任意本机绝对路径或 `safe-file://` 引用。导入器不能把不受信任项目文件当成本机文件读取授权。
9. 当前数据库名仍是 `spark.db`，启动执行全部 53 条旧 migration；启动还会自动软链宿主机 `~/.claude/skills` 和 `~/.codex/skills`。
10. 当前内置 Canvas Assistant 不是全局默认 Agent，绑定 3 个 Skills；`video-workflow` 已随资源打包但未绑定。运行时展开后共有 101 个内置媒体 manifest，它们在首次访问目录服务时懒 seed，不是空库 bootstrap 的显式步骤。
11. 当前“软删除”会先删除项目目录，再把数据库状态设为 `deleted`，与可恢复语义冲突；自定义项目根又可能因为默认根安全检查而无法清理。
12. 目标契约已经收敛：项目目录是已保存项目内容的权威源；SQLite 是索引、查询缓存和恢复镜像；Renderer 内存/localStorage 只保存当前编辑草稿。

## 3. 当前持久化事实

### 3.1 Renderer 热存储

当前 Renderer 的行为是：

- `writeDb` 更新模块内存、标记项目 dirty，并防抖写入 `spark-canvas:v1`。
- 全部 Canvas 数据作为一个 JSON 对象写入 localStorage，不按项目拆分。
- 序列化结果超过 `4_000_000` 字符时写入 `hotOverflow` 内存，不再更新 localStorage。
- localStorage 写入连续失败时也转为内存兜底。
- 自动保存偏好按项目保存，未设置时返回 `false`；手动保存、退出保存或用户主动开启自动保存才会 flush 到主进程。

因此 localStorage 和内存可以提高同会话编辑性能，但存在浏览器配额、进程崩溃和整库放大问题。它们不能成为“SQLite/目录失败时仍算保存成功”的持久化兜底。

### 3.2 保存与加载顺序

当前 `canvas:snapshot:save`：

1. 确保项目目录及 `assets/*`、`snapshots/` 等子目录存在。
2. 写 `project.json`。
3. 覆盖 `snapshots/latest.json`。
4. 新增 `snapshots/{timestamp}.json`。
5. 目录阶段任意异常被统一捕获，只记录 warning。
6. upsert `canvas_projects`。
7. upsert `canvas_snapshots`。
8. 返回 `saved: true`。

当前 `canvas:snapshot:load`：

1. 从 SQLite 项目索引取得 `root_path`。
2. 若存在路径，先读 `<root_path>/snapshots/latest.json` 并直接返回。
3. 只有目录文件读取失败时，才读取 `canvas_snapshots.snapshot_json`。

这一组合会产生确定性错误窗口：旧 `latest.json` 存在、新目录写入失败、SQLite 写入成功时，保存响应仍成功，但下一次加载会选择旧文件。没有 revision、checksum 或写入状态可判断哪份更新。

### 3.3 目录写入与历史快照

三个 JSON 文件均通过直接 `writeFile` 更新，没有临时文件、`fsync`、原子 rename 或跨文件 revision。进程终止、磁盘满、权限变化或部分写入时，`project.json`、`latest.json`、历史快照和 SQLite 可能处于不同版本。

每次保存都会新增一个时间戳快照，当前没有数量、年龄或空间上限。长时间编辑会让项目目录持续增长。

### 3.4 项目生命周期

数据库已区分 `active`、`archived`、`deleted`，但删除 handler 对 soft/hard 两种请求都会先尝试递归删除目录：

- soft delete 后数据库行仍在，项目文件却已经被删除，不能按现有承诺恢复。
- hard delete 会继续删除快照和项目行。
- 目录只有严格位于“当前默认项目根”下才允许删除。
- 用户配置自定义项目根后，历史项目或单独选定的根可能不再通过这项检查，形成“数据库已删除、目录仍残留”的不一致。

归档只应改变项目可见状态，不应触碰目录；soft delete 若承诺可恢复，也不得先销毁项目内容。

## 4. 当前项目包事实

### 4.1 JSON 导出

JSON 导出格式当前为：

```json
{
  "kind": "spark.canvas.project",
  "version": 2,
  "app": "Spark-Agent",
  "projectRootPath": "/absolute/path",
  "snapshot": {}
}
```

导出前只把图片 `safe-file://` 内容转成 data URL。音频、视频和普通文件不会内嵌，因此 JSON 文件即使能成功导入，也不等于完整媒体项目可移植。

### 4.2 目录项目包

目录导出会：

- 创建带时间戳的新目录。
- 尝试复制源项目的 `assets/`。
- 把源根下的绝对路径改写为导出目录中的绝对路径或 `safe-file://` URL。
- 写 v2 `project.json`、`snapshots/latest.json` 和时间戳快照。

它仍依赖导出机器的绝对目录，没有资产清单、SHA-256、字节数、包总量限制或格式完整性签名。移动目录后，快照里的绝对路径可能立即失效。

### 4.3 导入与安全边界

项目页当前先选择“导入项目保存位置”，随后只打开 `.json` 文件。导入流程会克隆项目、Board、节点、资产、任务和连线 ID，再调用 `canvas:project:migrate-assets`。

迁移 handler 接受快照中的绝对路径和 `safe-file://` URL，并尝试从这些位置复制文件。它没有“引用必须位于用户刚选择的项目包根内”的约束。因此不受信任 JSON 可以诱导应用尝试读取本机其他文件。即使复制最终失败，这也不是合格的导入安全模型。

导入中的资产复制异常还会被 Renderer 捕获并忽略，以兼容纯 JSON 项目；用户可能得到“已导入”结果，但音视频引用缺失。

## 5. 当前空库启动事实

### 5.1 数据库与项目根

- 数据库路径是 `{userData}/spark.db`。
- `createDatabase` 默认发现并执行 `packages/storage/migrations/` 中全部 53 个 SQL migration。
- 默认 Canvas 项目根是 `{userData}/canvas-projects`，也允许设置自定义路径。
- 当前没有只面向 Spark Canvas 的 migration 目录或版本化 bootstrap 编排器。

### 5.2 Agent 与 Skills

- migration 049 创建 `canvas-assistant-agent`，但 `is_default=0`；注释明确全局默认仍是 `platform-manager-agent`。
- Canvas Assistant 当前绑定 `builtin:platform-manager`、`builtin:canvas-studio`、`builtin:multimedia-use`。
- `builtin:video-workflow` 已有资源和 manifest，但没有绑定到 Canvas Assistant。
- `apps/desktop/resources/skills` 当前共有 16 组 bundled Skills。
- 应用启动时会自动扫描并软链 `~/.claude/skills` 与 `~/.codex/skills`，随后登记为默认可用技能。

全新产品不能把宿主机 Skills 当成自己的默认能力或可重复 bootstrap 数据。它们来源、版本、许可和行为都不受 Spark Canvas 控制。

### 5.3 媒体模型清单

`BUILTIN_MEDIA_MODEL_MANIFESTS` 的数组字面量有 42 个顶层表达式，其中 5 项通过展开的 `.map()` 批量生成清单；运行时真实结果是 **101 个 manifest、101 个唯一 ID**，不是 42 个。当前分布为图片 34、视频 62、音频 5，覆盖 11 个 provider kind；101 项全部通过 `MediaModelManifestSchema` 结构校验。

目录之外还有三组必须一起验收的漂移：

1. `validateMediaModelManifestSemantics()` 当前对 `minimax:speech-2.8-turbo` 报 2 个 `unknown_template_variable`：`subtitle_enable`、`subtitle_type`。结构校验通过不等于运行契约完整。
2. Provider 目录共有 35 个 vendor、52 个 preset，其中 24 个声明媒体能力；21 个 preset 显式提供共 99 条 `mediaModelRefs`。`apimart:gpt-image-1.5-official` 和 `kling:kling-video-3.0` 两条非 `custom:` 引用没有命中内置 manifest，前者真实 ID 使用 `gpt-image-1-5-official`。
3. `media-model-resolver` 会为任何未命中的 ref 合成 manifest，而不只为 `custom:` ref 合成；非 `custom:` 错 ID 因此会被静默掩盖。首版必须要求所有内置 preset ref 精确命中，只有显式 `custom:` ref 才允许合成。

此外，101 个内置 manifest 中没有 `audio.transcription`；当前语音转写来自 `apimart-audio-whisper` preset 的声明能力和 adapter，不是 manifest 驱动。功能矩阵必须如实区分这两条路径。

`MediaModelCatalogService.seedBuiltinManifests()` 可以幂等 upsert，但主进程只在第一次访问 catalog service 时调用；Session 媒体路径也会自行 seed。

这意味着“空库启动完成”和“媒体目录已可用”不是同一个显式原子步骤。独立产品应在 bootstrap 阶段种入清单，运行时查询只读取或按版本刷新，不依赖用户先触发某个媒体入口。

## 6. 已冻结目标契约

### T-001：项目内容权威与保存协议

**已冻结：项目目录是已保存项目内容的权威源。**

职责边界：

| 层级                       | 目标职责                                            | 禁止事项                                 |
| -------------------------- | --------------------------------------------------- | ---------------------------------------- |
| 项目目录                   | 项目快照、资产和可移植 metadata 的权威副本          | 直接覆盖半成品；保存绝对机器路径         |
| SQLite                     | 项目索引、查询缓存、任务/账户数据和项目快照恢复镜像 | 在 revision 更新时反向遮蔽较新的目录内容 |
| Renderer 内存/localStorage | 当前会话编辑草稿、dirty 状态和短时崩溃恢复候选      | 被当作持久化成功条件或项目长期唯一副本   |

保存协议必须满足：

1. 每次保存分配单调递增或全序可比较的 `revision`，项目目录与 SQLite 写入同一 revision。
2. 先在项目目录内写临时文件，完成 flush/校验后用同卷 rename 原子替换 `latest.json` 和项目 manifest。
3. 目录提交成功后，用一个 SQLite transaction 更新项目索引和恢复镜像。
4. 两层都完成后才向 Renderer 返回完整保存成功并清 dirty。
5. 若目录已提交而 SQLite 失败，保留目录内容，返回“待对账”状态并保持 dirty；下次启动按目录 revision 修复 SQLite。
6. 加载时验证 manifest、revision 和 checksum；SQLite 只在目录缺失或损坏时作为明确的恢复候选，不能静默覆盖较新的目录。
7. 历史快照必须有受测的数量/时间/空间上限，不允许无限增长。
8. localStorage 超限或写入失败不能改变保存成功语义；未 flush 的内存草稿必须继续显示为未保存。

### T-002：全新数据库、项目根与生命周期

**已冻结：新产品只建立 Spark Canvas 基线，不运行旧平台升级链。**

- 数据库文件固定为 `{userData}/spark-canvas.db`。
- 默认项目根固定为 `{userData}/projects`。
- 新 migration 链从 Canvas 基线开始，只包含 Canvas、当前 Canvas Agent 闭包、BYOK、共享 Spark 云账户/用量和视频任务所需 schema。
- 旧 53 条 migration 可作为字段和约束证据，但不进入新应用运行时目录。
- 首次启动不得探测 `spark.db`、旧项目根、旧 localStorage、旧 Keychain 或 Agent 历史。
- archive 只改变项目状态，不移动或删除目录。
- soft delete 必须保留可恢复内容；若产品不提供回收站，则 UI 不应把永久删除伪装成软删除。
- permanent delete 必须二次确认，并依据项目创建时记录的受管根/所有权信息校验路径；不能用“当前默认根”推断历史目录所有权。
- 自定义目录只在用户明确授权且所有权可证明时删除，拒绝删除时必须把残留状态返回 UI，不能只记日志。

### T-003：空库 bootstrap

**已冻结：空库 bootstrap 是显式、版本化、幂等流程。**

空库成功退出前必须完成：

1. 建立新 schema 和 bootstrap 版本记录。
2. 创建唯一默认内置 Agent `canvas-assistant-agent`。
3. 只登记批准的首版运行 Skills：`platform-manager`、`canvas-studio`、`multimedia-use`、`video-workflow`。
4. 禁止启动时自动导入宿主 `~/.claude/skills` 或 `~/.codex/skills`；以后若提供用户主动导入，必须是明确操作并与内置 seed 分域。
5. 显式种入经批准的内置媒体 manifest 集合；当前源码基线为 101 项。预期数量和 ID 必须从批准集合读取，不再手工统计数组顶层表达式；同时验证 ID 唯一、结构 schema、语义校验、内置 preset 引用精确命中，以及只有 `custom:` ref 可以合成。
6. 建立应用设置默认值，但不创建虚假登录态、BYOK Key、余额或项目。
7. bootstrap 中途失败时可安全重试，不产生两个默认 Agent、重复 Skills 或半套 manifest。

Canvas Assistant 仍按 D-003 保留当前 Session/Agent/Skill/MCP/Claude/Codex 运行闭包；“唯一默认内置 Agent”不代表可以提前删掉其底层依赖。

### T-004：项目包 v3 与兼容导入

**已冻结：完整迁移使用目录项目包 v3；JSON v1/v2 只做兼容快照导入。**

v3 最低契约：

```text
project-package/
├── project.json
├── snapshots/
│   └── latest.json
└── assets/
    ├── images/
    ├── audio/
    ├── videos/
    └── files/
```

`project.json` 至少包含：

- `kind: spark.canvas.project`
- `version: 3`
- `app: Spark Canvas`
- 格式 revision 和导出时间
- 快照相对路径
- 每个资产的相对 POSIX 路径、SHA-256、字节数和 MIME type

导出要求：

- 导出前先完成一次稳定 revision 保存。
- 包内快照和 manifest 不得出现绝对路径或 `safe-file://` URL。
- 只复制 manifest 声明的项目资产，不跟随符号链接逃出项目根。
- 导出完成前写入临时目录，校验通过后再原子 rename 为最终目录。

导入要求：

1. UI 必须提供目录项目包选择入口，不再用 JSON 文件选择替代完整迁移。
2. 所有路径先标准化，并验证位于所选包根内；拒绝绝对路径、`..` 穿越、符号链接逃逸和特殊文件。
3. 在复制前校验 manifest schema、格式版本、路径唯一性、单文件/总大小上限、声明大小和 SHA-256。
4. 先复制到新项目根内的临时目录；全部资产和快照通过后再原子提交，永不修改源包。
5. 导入失败删除未提交临时目录，不创建可见的半成品项目，不读取包外本机文件。
6. 当前旧应用导出的 v2 目录包可以进入显式 legacy 导入：只把 manifest 中旧根前缀后的相对部分映射到用户所选包根，绝不直接读取记录的绝对路径；所有映射结果仍须通过包根、文件类型和大小校验，并提示该格式没有原始 checksum 保证。
7. v1/v2 单文件 JSON 可以继续导入并重映射 ID；图片 data URL 可物化。音频、视频或普通文件缺失时必须明确警告，不得宣称完整可移植。
8. 旧 JSON 中的绝对路径默认视为不可移植引用，不自动读取；完整旧项目应优先由旧应用导出目录包，再由新应用的 legacy 目录入口导入。

## 7. 实施批次

| 批次 | 内容                                         | 退出条件                                                   |
| ---- | -------------------------------------------- | ---------------------------------------------------------- |
| D1   | 新数据库名、Canvas migration 基线、bootstrap | 空 `userData` 可重复启动，seed 数量和唯一默认 Agent 稳定   |
| D2   | revision、原子目录保存、SQLite 镜像和恢复    | 所有故障注入点都不会返回假成功或加载旧 revision            |
| D3   | v3 目录包、JSON 兼容导入和资产校验           | 图片/音频/视频可移植；恶意路径、错 checksum 和超限包被拒绝 |
| D4   | archive、soft delete、permanent delete       | 三种语义和 UI 文案一致，自定义路径不会误删或静默残留       |
| D5   | Renderer 草稿与 localStorage 收缩            | 大项目不把完整媒体塞入热存储；崩溃恢复不改变持久化权威     |

D1 是单一产品入口的前置批次；D2 和 D3 是允许真实用户项目进入新应用前的 P0；D4 必须在开放删除入口前完成。

## 8. 验收 Gate

### Gate A：空库和旧数据隔离

- 空 `userData` 创建 `spark-canvas.db` 与 `projects/`，不创建或打开 `spark.db`。
- 文件、SQLite、Keychain 和网络监控证明没有访问旧 Spark 本地目录或凭据。
- 只有一个默认 Canvas Assistant；批准的 4 个 Skills 和当前 101 个媒体 manifest 可重复 seed，预期集合来自同一批准清单。
- 101 个 manifest 的 ID 唯一、结构和语义校验通过；所有非 `custom:` preset ref 精确命中，错 ID 不会被 resolver 合成掩盖。
- 宿主 Claude/Codex Skills 不会自动出现在新应用。

### Gate B：保存一致性

- 在临时文件写入、flush、rename、SQLite transaction 和响应前分别注入失败。
- 任一失败都不会清 dirty、返回完整成功或让旧目录 revision 遮蔽新数据。
- 目录与 SQLite revision 不一致时按契约恢复并留下可诊断记录。
- 突然终止进程后，最多丢失明确显示为“未保存”的草稿，不损坏上一次成功 revision。
- 历史快照清理受数量/时间/空间上限约束。

### Gate C：项目包

- v3 包移动到另一台机器和不同路径后仍可完整导入图片、音频和视频。
- 导入不会修改源目录，失败后不留下可见项目或孤立资产。
- 绝对路径、路径穿越、符号链接逃逸、错 checksum、缺文件、重复路径和超限包全部被拒绝。
- v2 legacy 目录包只在所选包根内重建路径；v1/v2 单文件 JSON 的兼容范围和缺失媒体警告可见且有测试。

### Gate D：生命周期

- archive 可恢复且不触碰文件。
- soft delete 可恢复项目内容，或在产品不提供恢复时被移除并改成明确的永久删除。
- permanent delete 只删除已证明属于当前项目的受管目录；拒绝或部分失败会反馈给用户并保持可对账状态。

## 9. 关键源码证据

| 事实                                       | 源码证据                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录写失败后仍写 SQLite                    | `apps/desktop/src/main/ipc/index.ts:3685-3722`                                                                                               |
| 目录优先、SQLite fallback                  | `apps/desktop/src/main/ipc/index.ts:3725-3737`                                                                                               |
| v2、旧 app 名和非原子快照写入              | `apps/desktop/src/main/ipc/index.ts:820-859`                                                                                                 |
| 每次保存新增时间戳快照                     | `apps/desktop/src/main/ipc/index.ts:854-858`                                                                                                 |
| 4 MB localStorage 与内存 fallback          | `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts:532-650`                                                                        |
| 自动保存默认关闭                           | `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx:659-669`                                                              |
| JSON 只内嵌图片                            | `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts:846-880`                                                                        |
| UI 只有 JSON 文件导入                      | `apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.tsx:249-269`、`canvas.api.ts:1803-1833`                                    |
| 目录包只提供导出                           | `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts:1742-1770`                                                                      |
| 目录包复制资产并写绝对包路径               | `apps/desktop/src/main/ipc/index.ts:3945-3991`                                                                                               |
| 任意绝对路径/safe-file 导入复制            | `apps/desktop/src/main/ipc/index.ts:3994-4094`                                                                                               |
| soft delete 先删目录                       | `apps/desktop/src/main/ipc/index.ts:3761-3775`                                                                                               |
| 可恢复注释与数据库状态                     | `packages/storage/src/repositories/canvas.repository.ts:119-143`                                                                             |
| 数据库仍为 `spark.db`                      | `apps/desktop/src/main/db.ts:20-27`                                                                                                          |
| 默认执行完整 migration 目录                | `packages/storage/src/database.ts:72-116`                                                                                                    |
| 默认项目根仍为 `canvas-projects`           | `apps/desktop/src/main/ipc/index.ts:383-387`                                                                                                 |
| 启动自动导入宿主 Skills                    | `apps/desktop/src/main/ipc/index.ts:1353-1394`、`apps/desktop/src/main/services/AppSkillsManager.ts:74-135`                                  |
| Canvas Assistant 非全局默认且绑定 3 Skills | `packages/storage/migrations/049_builtin_canvas_assistant_agent.sql:1-63`                                                                    |
| `video-workflow` 已打包但未绑定            | `apps/desktop/resources/skills/video-workflow/manifest.json`                                                                                 |
| 101 个 manifest 由 catalog 懒 seed         | `packages/protocol/src/media-model-manifest.ts:1930`、`packages/agent-runtime/src/services/media/media-model-catalog.service.ts:43-67`       |
| preset ref 未命中仍会合成 manifest         | `packages/protocol/src/provider-presets.ts`、`packages/agent-runtime/src/services/media/media-model-resolver.ts:161-181`                     |
| 语义校验与结构 seed 当前分离               | `packages/protocol/src/media-model-manifest-validation.ts`、`packages/agent-runtime/src/services/media/media-model-catalog.service.ts:48-67` |

## 10. 决策状态

| 编号  | 结果                                                                      | 状态   |
| ----- | ------------------------------------------------------------------------- | ------ |
| T-001 | 项目目录权威；SQLite 为索引/恢复镜像；Renderer 只存编辑草稿               | 已冻结 |
| T-002 | `spark-canvas.db`、`projects/`、新 Canvas migration 链和三种生命周期      | 已冻结 |
| T-003 | 唯一默认 Canvas Assistant、4 Skills、批准的 manifest 集合、禁宿主自动导入 | 已冻结 |
| T-004 | v3 目录包完整迁移；v1/v2 JSON 仅兼容快照导入                              | 已冻结 |

这些结论不需要再回抛产品选择；后续业务代码实施仍按 D1 至 D5 分批，并通过 Gate A 至 D 验收。
