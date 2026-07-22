# Spark Canvas 发行决策就绪审计

> 审计快照: 2026-07-17 | 代码基线: `6cfbfcd` | D-014 至 D-018 已全部冻结，本阶段不修改业务代码

## 1. 目的

本文件为 D-014 至 D-018 提供统一、可复核的选择依据。D-014 至 D-018 均已由负责人确认；实现仍必须遵守源码、在线契约与制品审计形成的发布 Gate。

在线事实于 2026-07-17 只读核验：

- GitHub Repository API：`alexanderizh/Spark-Canvas`；
- GitHub Releases API：当前仓库没有 Release；
- Spark 版本中心：`/api/v1/desktop/releases/latest`；
- Spark artifact manifest：`/spark-desktop/artifact-repository/v1/index.json`；
- FFmpeg 官方法律、许可和下载说明。

FFmpeg 四个真实归档、八个内层二进制、上游包哈希和签名结果见[FFmpeg 分发物来源与发布门审计](./2026-07-17-canvas-ffmpeg-artifact-provenance-release-gates.md)。

## 2. 决策摘要

| 编号                 | 推荐/冻结结果                                             | 已排除的做法                                        | 当前状态/为什么仍需负责人确认                  |
| -------------------- | --------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| D-014 GitHub Release | 当前 `alexanderizh/Spark-Canvas` 代码仓库同时承载 Release | 继续指向 `alexanderizh/spark-agent`                 | **已确认方案 1**                               |
| D-015 版本中心       | 共用基础设施，强制 `product=spark-canvas` 全链分区        | 复用当前无 product 的接口                           | **已确认推荐方案**                             |
| D-016 官网           | 第一阶段从 workspace/CI 移除旧官网，桌面稳定后单独重建    | 直接把现有 Spark Agent 官网改名发布                 | **已确认推荐方案；视频工作台可用为 P0**        |
| D-017 首发平台       | macOS arm64/x64 + Windows x64；Linux 后续                 | 把未进发布矩阵的 Linux/Windows arm64 宣称为首发支持 | **已确认推荐方案**                             |
| D-018 FFmpeg         | 沿用原按需显式下载，managed 优先、兼容系统版回退          | 随包、仅系统版或直接沿用当前四个异构第三方包        | 新 descriptor、合规制品、GPL/codec 和专利 Gate |

## 3. D-014：GitHub Release 仓库

**冻结结论：负责人已确认方案 1，由当前 `alexanderizh/Spark-Canvas` 仓库同时承载源码和 GitHub Release。**

### 3.1 已证明事实

- 本地 `origin` 已是 `https://github.com/alexanderizh/Spark-Canvas.git`，当前分支 `main`。
- GitHub API 显示仓库公开、未归档、默认分支为 `main`，当前 Release 列表为空。
- 发布 workflow 仍监听 `master`。
- `electron-builder.yml`、`UpdateService` 和 updater cache 仍指向旧 `spark-agent`。

因此当前仓库具备作为独立 Release 容器的干净起点，但现有发布配置尚未指向它。

### 3.2 选项

| 选项                                        | 适用情况                                           | 代价                                                                             |
| ------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| **1. 当前仓库同时承载代码和 Release，推荐** | 同一维护团队、公开代码和公开安装包使用同一权限边界 | 配置最少；需把 workflow、builder、UpdateService、tag 和 Secrets 全部改到当前仓库 |
| 2. 单独 Release 仓库                        | 二进制发布权限、保留周期或可见性必须与源码分开     | 增加跨仓库 token、tag/commit 对账、Release 清理和故障面                          |
| 3. 不用 GitHub Release                      | 明确接受自建版本中心成为唯一更新源                 | 当前版本中心尚会串包；在 D-015 完成和高可用验证前不可作为稳定方案                |

选择 1 不等于立即可发布；签名、D-015 版本中心严格 v2 全链 product 分区和双产品安装隔离仍是独立硬门。

## 4. D-015：自建版本中心

**冻结结论：负责人已确认共用原版本中心基础设施，并实施严格 v2 `spark-canvas` 全链 product 分区。该结论不代表服务端改造已完成；E-004 实施验收前继续禁止 Canvas 使用旧 v1 更新接口。**

### 4.1 在线契约已证明会串包

2026-07-17 查询：

```text
GET /api/v1/desktop/releases/latest?channel=stable&platform=mac&arch=arm64
```

返回 `Spark Agent-0.5.3-mac-arm64.dmg`，对象键为：

```text
stable/0.5.3/Spark Agent-0.5.3-mac-arm64.dmg
```

即使增加：

```text
product=spark-canvas
```

服务仍返回同一 Spark Agent 记录。这比源码“没有 product 参数”更强：当前在线服务实际忽略该维度。

扩大矩阵后，`spark-agent`、任意不存在的 product 和 `appId=com.spark.canvas.desktop` 也都返回同一记录；官网形态的 `product=spark-canvas&channel=stable` 仍返回三条 Spark Agent 0.5.3。更严重的是，响应虽有 SHA-512，桌面端会丢弃该字段，新下载和缓存都不验 hash/signature。完整证据见[版本中心产品隔离与更新完整性审计](./2026-07-17-canvas-version-center-product-isolation.md)。

### 4.2 已冻结目标

优先共用服务器和对象存储基础设施，但把 `product` 变成不可缺省的稳定主键维度：

- 注册 body、查询参数和响应都包含 `product`；
- 数据库唯一键至少覆盖 `product + channel + version + platform + arch + fileName`；
- latest、rollout、minSupported 和管理后台按 product 分区；
- 对象键使用 `spark-canvas/{state}/{channel}/{version}/{artifact}`；
- CI token 限制到指定 product；
- 旧 Spark Agent 显式使用 `spark-agent`，迁移期可兼容旧缺省，Spark Canvas 不使用缺省；
- 未识别 product 返回 4xx/空结果，不能回落到另一产品。
- Spark Canvas 使用严格 v2 endpoint；v1 只为已发布旧 Agent 客户端保留 legacy 行为。
- 下载和缓存必须校验 product/appId、批准 host、size、SHA-256/SHA-512 和平台签名。

若当前服务端无法改造，才选择独立版本中心和独立 bucket。继续使用现状不是第三个有效选项。

无论共享还是独立，版本中心若是 stable 对外源，MinIO 上传、注册和候选提升都必须成为 stable 硬 Gate；不能继续 `autoPublish=true`、上传失败 warning 后让各发布源状态分叉。

## 5. D-016：第一阶段官网

**冻结结论：负责人已确认第一阶段从 workspace/CI/发布链移除当前旧官网，桌面稳定后再以独立产品流重建；官网不阻塞首版，画布视频工作台核心旅程可用是首版 P0。**

### 5.1 已证明事实

- `apps/website` 与桌面运行闭包独立。
- 68 个生产文件中有 49 个仍包含 `Spark Agent`、`SparkWork` 或 `spark-agent` 标识。
- 内容仍宣传 Agent、Team、Workflow、MCP、浏览器和代码开发。
- 下载接口使用无 product 的旧版本中心。
- 发布 workflow、容器、域名和 metadata 仍属于旧产品。

### 5.2 已冻结目标

第一阶段从 workspace 和 CI 断开旧官网，桌面独立化不等待官网。之后以单独产品流重建 Spark Canvas 官网，使用真实产品截图、新域名和 `spark-canvas` 下载 namespace。

直接改 Logo/产品名发布会形成错误功能承诺和串包下载，不是有效方案。

## 6. D-017：首发桌面平台

**冻结结论：负责人已确认首发 macOS arm64、macOS x64、Windows x64；Linux 和 Windows arm64 后续。三个首发目标分别通过视频工作台、FFmpeg、native ABI、签名和更新 Gate 后才可宣称支持。**

### 6.1 当前可交付矩阵

当前发布 workflow 只有三个 target：

| target      | CI runner        | 原生依赖证据                                              | 当前成熟度                               |
| ----------- | ---------------- | --------------------------------------------------------- | ---------------------------------------- |
| macOS arm64 | `macos-latest`   | Claude/Codex、sqlite-vec、`@napi-rs/canvas` 均有 arm64 包 | 已有独立构建、公证脚本                   |
| macOS x64   | `macos-15-intel` | 对应 x64 原生包齐全                                       | 已有独立构建、公证脚本                   |
| Windows x64 | `windows-2022`   | Claude/Codex、sqlite-vec、`@napi-rs/canvas` 均有 x64 包   | 已有 NSIS 和签名脚本，但生产签名仍待核验 |

Linux 虽有 builder 配置和 `build:linux`，但不在 Release matrix，没有稳定签名/包格式/更新验收。Windows arm64 虽有部分 SDK 包，`sqlite-vec` 当前只锁定 win32 x64，且无 CI target。

### 6.2 已冻结目标

首发范围冻结为 macOS arm64、macOS x64、Windows x64；Linux 和 Windows arm64 不阻塞首版，也不对外宣称支持。每个平台仍需在新应用身份、签名和 FFmpeg 固定后完成打包 E2E。

## 7. D-018：FFmpeg 分发

### 7.1 当前 manifest 不是可直接批准的发行基线

2026-07-17 在线 manifest 有四个 FFmpeg 包；实际下载并核对全部字节后，声明版本与真实二进制身份如下：

| 平台        | manifest 版本 | 真实二进制身份                                              |         大小 |
| ----------- | ------------- | ----------------------------------------------------------- | -----------: |
| macOS arm64 | 7.1.1         | ffmpeg/ffprobe 均为 `N-125450-gfad2e0bc50` 开发快照         | 56,562,590 B |
| macOS x64   | 8.1.2         | ffmpeg/ffprobe 均为 `8.1.2-tessus`                          | 53,549,382 B |
| Linux x64   | 7.0.2         | ffmpeg/ffprobe 均为 `7.0.2-static`                          | 58,935,098 B |
| Windows x64 | 4.1           | FFmpeg npm 4.1.0 + FFprobe npm 5.1.0，不是同一版本/构建年代 | 51,174,911 B |

manifest 提供 SHA-256 和大小，但没有：

- 原始下载 URL和构建产物签名；
- 精确 source tag/commit、对应源码包和修改；
- configure line、外部 codec 清单和 `--enable-gpl`/`--enable-nonfree` 状态；
- 许可文本、source offer 和第三方 notices；
- 四个平台统一的功能/版本基线。

四个 Spark ZIP 的 archive 大小和 SHA-256 都与 manifest 一致，但每包只含两个可执行文件。arm64 标签错误且严格 codesign 失败；macOS x64 未签名；Windows 两个 PE 未签名且混用 4.1.0/5.1.0；上游 license/source/signature 材料均未随 Spark 重打包保留。因此当前四个 artifact id 已被证据排除，只允许 local/internal，不允许 candidate/stable。完整哈希和来源对账见 FFmpeg 专项审计。

### 7.2 当前产品事实上需要 GPL codec profile

`FfmpegRunner.ts` 至少 8 处把 `libx264` 作为默认或固定编码器，视频工作台还向用户提供 `libx265` 和 `libvpx-vp9`。

FFmpeg 官方说明：FFmpeg 默认是 LGPL v2.1+，但启用 GPL 部分或组合 `libx264`、`libx265` 等 GPL 库后，FFmpeg 构建转为 GPL；`--enable-nonfree` 构建不可再分发：

- [FFmpeg License and Legal Considerations](https://ffmpeg.org/legal.html)
- [FFmpeg LICENSE and external libraries](https://ffmpeg.org/doxygen/trunk/md_LICENSE.html)
- [FFmpeg downloads](https://ffmpeg.org/download.html)

因此不能继续写成“优先选择 LGPL 包”而不改变业务实现。有效路线只有：

1. 保留当前 H.264/H.265 行为，固定可再分发的 GPL 构建并履行对应源码、许可和 notices 义务，同时对专利/商业 codec 风险做法务核验；
2. 另开产品决策，把编码器和部分功能改成经验证的 LGPL profile，再重新做画质、兼容性和性能验收；
3. 只使用用户系统 FFmpeg，不由 Spark 分发，但首装、codec 一致性和视频主链可靠性显著下降。

本审计不是法律意见。公开商业发行前必须由有权限的负责人/法律顾问核对最终二进制，而不是只看 FFmpeg 项目总许可证。

### 7.3 随包与受控下载的真实差异

若 Spark 托管并自动安装二进制，“首次下载”仍然是 Spark 在分发 FFmpeg，不能规避许可证义务。

| 模式         | 优点                               | 代价                                                              |
| ------------ | ---------------------------------- | ----------------------------------------------------------------- |
| 随安装包     | 离线即用、版本与应用强绑定         | 每个平台安装包增加约 50-60 MB，FFmpeg 安全更新需发整包            |
| 受控首次下载 | 安装包较小、FFmpeg 可独立修复/回滚 | 首次视频流程依赖网络；必须使用 T-008 的受信 manifest 和原子安装器 |
| 系统 FFmpeg  | Spark 不托管二进制                 | 版本、codec、路径和用户支持不可控，不适合作为唯一首版路径         |

D-018 已冻结为沿用原用户体验：FFmpeg 不随安装包捆绑，用户在设置或视频工作台需要时显式下载；Spark Canvas managed 版本是主路径，兼容的系统 FFmpeg 是回退。受控下载只有在固定构建来源、GPL/codec profile、源码与 notices 后才能公开启用。

推荐方案中的“回退”不是随意选择 PATH：主进程优先使用通过 descriptor 复验的 managed 版本，缺失/损坏时才接受通过同 revision ffmpeg/ffprobe、codec profile 和真实 probe smoke 的系统版本。两者都不可用时进入 `setup-required` 并展示受控安装，不静默下载旧包、不切云端；每个任务固定二进制 digest，运行中不换源。

D-018 批准的是原按需下载体验，不是当前四包。受控下载必须换用 FFmpeg 专项审计第 8 节定义的 approved descriptor、同 revision 的 ffmpeg/ffprobe、平台签名和 candidate evidence packet。

## 8. 额外发行权利门

GitHub API 将仓库 license 标为 `NOASSERTION`；仓库内是自定义 `Spark Agent Personal Use License`。这不证明 Spark Canvas 已取得所有复制代码、外部贡献、图片、3D 模型、Skills、示例和官网素材的商业再分发权。

D-014 已选择当前源码仓库承载 Release，但这个选择不能修复权利链问题。公开发布前仍必须完成资源来源和授权清单；588 个源码候选分发文件、当前构建生成的 14 个 file-viewer WASM/worker、raw UE/Mixamo 模型、Bundled Skills、字体 notices 和 T-012 artifact Gate 详见[资源来源、许可与发布门审计](./2026-07-17-canvas-resource-provenance-release-gates.md)。

## 9. 决策结果

1. D-014 GitHub Release 仓库：**已确认方案 1**；
2. D-015 版本中心部署方式：**已确认共享基础设施加严格 v2 全链 product 分区**；
3. D-016 官网首发范围：**已确认首版移除旧站、桌面稳定后单独重建**；
4. D-017 平台范围：**已确认 macOS arm64/x64 和 Windows x64**；
5. D-018 FFmpeg 分发与许可路线：**已确认沿用原按需显式下载，managed 优先、兼容系统版回退，并以新受信链和合规制品替换旧链**。

D-014 至 D-018 已全部冻结，不再有待负责人选择的发行决策。D-015 的“现状直接复用”、D-016 的“旧站改名上线”和 D-018 的“未知构建直接分发”已被证据排除；E-004/E-005/E-006 的生产证据仍待实施，是发布 Gate 而非审计阻塞项。
