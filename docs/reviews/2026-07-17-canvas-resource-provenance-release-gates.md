# Spark Canvas 资源来源、许可与发布门审计

> 审计快照: 2026-07-17 | 代码基线: `6cfbfcd` | T-012 已冻结，本阶段不修改业务代码

## 1. 目的

本文件补齐 E-006：检查会随桌面应用或官网交付的图片、3D 模型、Skill、字体、图标、示例、品牌素材以及构建生成的 WASM/worker，区分“仓库里存在或构建可得”与“有权公开再分发”。

结论不构成法律意见。它提供工程发布门：仓库证据不能证明来源、许可或授权时，稳定发布默认拒绝该资源，不能因为文件已经进入 Git 历史或能够被打包就推定可分发。

## 2. 证据范围与方法

直接核对三个源码候选分发根和一个构建生成根：

- `apps/desktop/resources`；
- `apps/desktop/src/renderer/assets`；
- `apps/website/public`；
- `apps/desktop/public/file-viewer`，由 `prepare:file-viewer-assets` 在 dev/build/pack 前动态生成。

证据包括：

1. 文件路径、字节数、SHA-256、扩展名和真实文件头；
2. PNG 文本块、JPEG EXIF/XMP/Comment/IPTC、GLB `asset` 元数据和 FBX 字符串；
3. 当前 `Spark-Canvas` Git 历史和同级原 `spark-agent` 仓库的逐文件历史；
4. `electron-builder.yml`、`prepare:file-viewer-assets`、Vite 资源输出和现有 `out/renderer` 产物；
5. 本地许可证文件和上游官方页面。

前三个源码根的 588 个候选资源文件按“排序后的 `path + NUL + bytes + NUL + sha256`，记录间以 LF 连接”生成快照摘要：

```text
7a55bfd5b0047040e34f5a113befd0a2233a8500fa8ef25c174e634720ca9556
```

该摘要只标识本次审计输入，不代表其中任何文件已经获批分发。

当前 14 个 file-viewer 生成文件使用同一算法得到独立快照摘要：

```text
9eed36f1f71ad2eee9cddabc168b7884069a30bf0d921e61a3080e31014c5213
```

该值必须由干净构建重新生成；依赖版本或复制工具变化时，文件集合、字节数和摘要都应变化并重新审批。

## 3. 完整库存边界

### 3.1 候选分发根

| 根目录                             |  文件数 |          字节数 | 主要内容                                        |
| ---------------------------------- | ------: | --------------: | ----------------------------------------------- |
| `apps/desktop/resources`           |     156 |       5,241,894 | 142 个 Skill 文件、安装图标、托盘图标和源图     |
| `apps/desktop/src/renderer/assets` |     393 |      54,219,276 | 头像、Prompt 示例、Provider 图标、海报和 3D     |
| `apps/website/public`              |      39 |      16,814,969 | 旧官网截图、Canvas 示例、头像、图标和站点文件   |
| `apps/desktop/public/file-viewer`  |      14 |      41,088,016 | 构建生成的 WASM、worker 和依赖资产清单          |
| **当前本地候选合计**               | **602** | **117,364,155** | 最后一行由依赖版本生成，不在 Git 源码资源计数中 |
| **D-016 首版桌面候选面**           | **563** | **100,549,186** | 排除 39 个旧 Website public 文件                |

前三个源码根中媒体/模型文件 440 个、内容唯一文件 430 个；7 组重复内容产生 10 个重复副本。按扩展名为 343 PNG、51 SVG、38 GLB、4 JPG、2 ICO、1 ICNS、1 FBX。生成的 file-viewer 文件单独按最终构建字节验收，不混入这组媒体扩展名统计。

D-016 已确认第一阶段从 workspace/CI/发布链移除当前旧官网，因此 39 个 `apps/website/public` 文件不进入首版桌面 approved manifest；它们仍保留在上面的全仓审计快照中，直到 Website 域实施删除。未来单独重建官网时重新建立自己的资源 manifest，不能继承这 39 个文件的批准状态。首版桌面候选面的 563/100,549,186 仍只是待审上限，不表示其中资源均可发布。

仓库另有 5 个 `apps/desktop/scripts/*.preview.png` 开发预览图和 1 个 Skill Registry 测试 ZIP；它们不属于当前生产分发根，但删除源码域时仍应随所属脚本或测试处置。

### 3.2 Renderer 资产分组

| 分组                     | 文件数 | 当前产品归属                                              |
| ------------------------ | -----: | --------------------------------------------------------- |
| `builtin-avatars`        |     77 | 只保留 Canvas Agent 所需最小默认头像，其余随旧 Agent 删除 |
| `canvas-prompt-examples` |    194 | Prompt Library 核心候选，必须补生成/授权记录              |
| `file-icons`             |     16 | 旧文件预览闭包；若保留需聚合 MIT notice                   |
| `onboarding-posters`     |     10 | 旧 Agent 引导，全部替换                                   |
| `providers`              |     47 | BYOK/托管模型设置候选，需按实际 Provider 收缩和商标复核   |
| `remote-channels`        |      4 | Remote Connections 域，移除                               |
| `stage3d-actors`         |      2 | 二期 3D；当前公开分发证据不足                             |
| `stage3d-furniture`      |     37 | 二期 3D；疑似 Kenney CC0，当前缺精确来源链                |
| `tools`                  |      1 | VS Code/代码工具域，移除                                  |
| Renderer 根部图片        |      5 | 旧 Logo、QQ 群、额度海报和旧平台头像，替换或移除          |

### 3.3 构建生成的 file-viewer 资产

`apps/desktop/package.json` 的 `dev`、`build` 和 `pack` 都先运行 `prepare:file-viewer-assets`。当前生成 14 个文件、41,088,016 字节，主要包括：

- Typst compiler/renderer WASM；
- CAD/libredwg worker、JS 和 WASM；
- SQLite、libarchive WASM 与 worker；
- XLSX、DOCX 和本地 PDF worker；
- `flyfish-viewer-assets.json` 与 manifest。

这些文件位于 Git ignore 路径，但会由 Vite 进入 Renderer 产物；“未跟踪”不等于“不分发”。`@file-viewer/web`、`@file-viewer/core`、`@file-viewer/react` 和当前 `pdfjs-dist` 包 metadata 均声明 Apache-2.0，但这不能自动证明每个由工具复制的 WASM/worker 都来自同一许可证、带齐上游 notice 或允许当前再分发。必须按生成清单逐项追溯实际 npm 包、版本、源文件、哈希和许可证。

仓库根部另有忽略的 `public/file-viewer`，当前 13 个文件、38,727,884 字节，是不含额外 PDF worker 的重复生成物；它不是 Desktop 当前构建输入，也不应被官网或其他发布脚本误收集。CI 应从干净工作树生成唯一目标目录，并在构建后按实际 artifact 对账，不能依赖开发机残留。

### 3.4 图片元数据并不能证明来源

仓库范围内：

- 333 个真实 PNG 均没有 `tEXt`、`zTXt` 或 `iTXt` 来源字段；
- 18 个 JPEG 均没有 EXIF、XMP、Comment 或 IPTC 来源字段；
- 15 个 `.png` 实际是 JPEG，1 个 `.jpg` 实际是 PNG，扩展名不能作为格式或来源证据；
- `generated/` 目录名只能说明团队意图，不能证明生成 Provider、账户、时间、Prompt、模型条款或输出授权。

原 `spark-agent` 历史也没有补足这一点：大部分头像、Prompt 示例、3D 家具和 Skills 只追溯到 `5f3f431e Initial commit`；Onboarding 海报追溯到 `365657aa`，但提交中没有来源凭证。当前 `Spark-Canvas` 又只保留整仓复制提交 `6cfbfcd`。

## 4. 3D 模型专项结论

### 4.1 UE Mannequin GLB：稳定发布阻断

文件：`stage3d-actors/ue4-mannequin-retopology.glb`

```text
sha256: 5622c6150467fb96ff70d30eb3393286131c8523feaa3b78f80515d499cb1a14
generator: Sketchfab-16.59.0
author: William Luque
license: SKETCHFAB Standard
source: https://sketchfab.com/3d-models/ue-mannequin-retopology-5394d9f894374a2ab7c57a21929ce4c2
```

这些信息来自 GLB 内嵌 `asset.extras`，原仓库提交 `41930701` 只写“add ue4 actor model”，没有发票、Seat、单独授权或再分发说明。

[Sketchfab Standard License](https://sketchfab.com/licenses) 明确限制把 Licensed Material 作为独立文件，或以第三方可以下载、提取、访问独立文件的方式分发。当前模型由 Vite 作为 Renderer 静态资产进入 Electron 包；ASAR 不是版权访问控制，不能据此证明满足该限制。

**处置：** 源码可暂留用于二期替换参考，但候选/稳定安装包默认排除。只有取得明确覆盖“随可安装桌面创作工具分发可提取 GLB”的书面授权，或换成第一方/CC0 可再分发模型后才能恢复。

### 4.2 Mixamo X Bot FBX：稳定发布阻断

文件：`stage3d-actors/mixamo-mannequin.fbx`

```text
sha256: f033925fa4197152eb48e030aede1eb9ee2642ce5c2fa015debac9c9c7f3517d
Original Application Vendor: Mixamo, Inc.
Original Application Name: mixamo.com
Original Native File: Mixamo/Characters/X Bot/clean.ma
```

[Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) 允许把角色和动画用于个人、商业和非营利项目，包括影片和游戏；但该 FAQ 不能单独证明可以把原始 X Bot FBX 作为创作工具内可提取、可复用的独立素材再分发。

**处置：** 与 UE 模型相同，首发安装包排除；取得覆盖原始模型再分发的授权或换成权利清晰的第一方/CC0 素体后再接入。

### 4.3 37 个家具 GLB：可修复但尚未闭环

本地文件名与 [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) 高度一致，官方页面把该资源包标为 CC0；本地 GLB 统一声明 `generator=UniGLTF-1.24`，但没有作者、许可、原始 archive hash、转换脚本或变更记录。

因此“来自 Kenney CC0”目前是高可信推断，不是逐文件来源证明。

**处置：** 二期接回前从官方来源重新取得固定版本，保存原始 archive SHA-256、官方页面快照、CC0 文本和可重复转换记录；不要直接把现有 37 个无来源 sidecar 的 GLB 标为已批准。

## 5. Bundled Skills

`apps/desktop/resources/skills` 有 16 个 Skill、142 个文件、2,539,958 字节；当前 `extraResources` 会把整个目录原样放到安装包。只有 3 个 Skill 自带许可证文件。

| 组别                                                                                              | 数量 | 证据                                                                                                                                                      | 处置                                                                 |
| ------------------------------------------------------------------------------------------------- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `canvas-studio`、`multimedia-use`、`video-workflow`、`platform-manager` 等声明 `author: Spark AI` |   11 | 无独立 license/source sidecar；Git 只能证明由原仓库提交                                                                                                   | 首版只分发已冻结的 4 个，发行主体出具第一方权属确认                  |
| `claude-api`、`frontend-design`、`skill-creator`                                                  |    3 | 本地 `LICENSE.txt` 为 Apache-2.0；`skill-creator` 含 Anthropic copyright                                                                                  | 不在 4 个默认影视 Skills 中，按范围删除；若保留必须带 license/notice |
| `ui-ux-pro-max`                                                                                   |    1 | 内容与 [NextLevelBuilder 上游](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) 对应，上游 metadata 声明 MIT；本地无 LICENSE、作者、版本或 commit | 首版删除；以后重新引入必须固定 commit 并携带 MIT 文本                |
| `react`                                                                                           |    1 | 无作者、license、版本或 source                                                                                                                            | 首版删除；未追溯前不得分发                                           |

[Anthropic Skills 仓库](https://github.com/anthropics/skills) 说明许多示例 Skills 使用 Apache-2.0，但具体 Skill 的本地许可证仍必须保留；不能用仓库级说明替代逐项核验。

**当前问题：** T-003 只批准种入 4 个影视 Skills，而打包配置仍分发全部 16 个。实施时必须把 `extraResources` 从整目录复制改成经 T-012 manifest 批准的显式集合。

## 6. 图片、图标、品牌和官网

| 资源组                        | 当前证据                                                      | 首版处置                                                                          |
| ----------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 194 个 Prompt 示例            | 无生成 Provider、Prompt、模型、账户条款、时间或输出 receipt   | 取得第一方生成台账，或用已批准 Provider 重新生成；否则不打包                      |
| 77 个内置头像                 | 文件名显示大量 Agent/Team/旧平台角色，无来源 metadata         | 删除旧平台集合；只重做并核验 Canvas 用户/助手所需最小头像                         |
| 10 个 Onboarding 海报         | 有原仓库提交但无素材来源，且内容属于旧 Agent 引导             | 全部替换为 Spark Canvas 新引导                                                    |
| 47 个 Provider 图标           | 多数使用第三方名称、色彩或标识，无统一 source/brand guideline | 只保留实际支持 Provider；记录商标使用依据，优先使用有许可证的图标包或中性文字标识 |
| 16 个文件图标                 | SVG 内嵌 Mallowigi MIT copyright 和许可文本                   | 仅在文件预览闭包保留时分发，并把 MIT attribution 聚合进 notices                   |
| Remote/VS Code/QQ 群资源      | 属于已删除产品域或旧联系入口                                  | 移除                                                                              |
| App、Tray、Taskbar 图标及源图 | 无设计源文件权属记录，且仍是旧 Spark 品牌                     | 用 Spark Canvas 第一方品牌包整体替换并保存设计交付凭证                            |
| 旧官网 39 个 public 文件      | 22 张旧平台 Showcase、旧头像、旧 Canvas 示例和下载元数据      | 第一阶段断开并移除；未来官网只使用新产品实拍和独立 provenance manifest            |

第三方 Provider 名称和 Logo 可能涉及商标规范；开源图标许可证不自动授予品牌背书权。设置页应只表达兼容性，不暗示第三方赞助或官方合作。

## 7. 字体与第三方 notices

Renderer 直接导入：

- `@lobehub/webfont-geist`；
- `@lobehub/webfont-geist-mono`；
- `@lobehub/webfont-harmony-sans-sc`。

本地包 metadata 把三个 wrapper 标为 MIT，但实际字体许可证不同：Geist 的 bundled `LICENSE` 是 SIL OFL 1.1；HarmonyOS Sans 使用华为专用字体协议，要求软件中显著声明使用该字体、不得修改、不得单独分发，并保留版权声明和协议。

现有 `out/renderer` 有 27 个 WOFF2，包括 Geist、HarmonyOS Sans 和 KaTeX 字体，却没有任何 license/notice artifact。`electron-builder.yml` 又显式排除 `LICENSE`、`LICENSE.txt` 等文件。

**处置：** 候选发布前生成并随安装包提供 `THIRD_PARTY_NOTICES`，保留字体实际许可证而不是只抄 package.json 的 `license` 字段；HarmonyOS Sans 继续使用时还要满足其显著声明要求。该机制同时覆盖保留的 MIT/Apache/OFL 资源。

## 8. 根许可证与商业发行权

根 `LICENSE` 是自定义 `Spark Agent Personal Use License`，SHA-256：

```text
b9922b28ee9bd9e9c65ba61d1cbde9dd87b132f7e41b02fb3e5d47d42c9acbef
```

它明确把复制、修改和分发权限限制为个人非商业用途，商业用途需要 copyright holders 事先书面许可。仓库没有 CLA、DCO、AUTHORS、NOTICE、第三方清单或权利转让文件。

这不表示发行主体一定没有权利；它表示**当前仓库证据不足以批准商业稳定发布**。发布前必须由有权限的主体提供以下至少一种闭环：

1. copyright holders 对 Spark Canvas 商业复制、修改和分发的书面授权；
2. 有权主体对 Spark Canvas 代码重新许可，并证明贡献和外部代码链允许这样做；
3. 对不在授权范围内的代码和资源完成替换。

更换 GitHub Release 仓库、签名证书或产品名都不能替代这一权利链。

## 9. T-012：资源 provenance 与 notices 契约

T-012 冻结如下：

1. **默认拒绝分发。** 桌面安装包、增量更新、官网和下载镜像只能包含 manifest 中状态为 `approved` 且 SHA-256 完全匹配的资源。
2. **源码保留不等于安装包保留。** 二期源码可以暂存受控资源引用，但未批准文件不得进入 candidate/stable artifact。
3. **每项可追溯。** manifest 至少记录 `path`、`sha256`、`bytes`、`kind`、`distributionTarget`、`origin`、`sourceUrl`、`sourceRevision`、`copyright`、`licenseId`、`licenseFile`、`modifications`、`permissionRef`、`trademarkReview`、`status` 和复核时间。
4. **许可证随包。** 构建从 approved manifest 生成第三方 notices 和需要的完整协议；不能继续全局排除许可证而没有替代产物。
5. **生成内容也登记。** AI 生成图记录 Provider、模型、生成时间、Prompt/任务 receipt、当时适用条款和人工复核；目录名或 Git 作者不是生成权证明。
6. **最终产物反查。** Gate 对解包后的 DMG/APP、NSIS 安装目录和官网静态产物重新枚举，而不是只检查源码目录。
7. **动态依赖资源同样受控。** 构建从 npm 包复制的 WASM、worker、字体和其他静态字节必须带 `sourcePackage`、`sourceVersion`、源路径、实际许可证与生成器版本；Git ignore 或 package metadata 不能替代逐文件记录。
8. **机密凭证分离。** 发票、合同或含账户信息的授权可以存于受控合规系统，但 manifest 必须保存稳定引用 ID 和审批结果，不能只存在个人聊天或本机目录。

manifest 是后续实现规格，本阶段不新建运行时代码或改构建脚本。

## 10. 发布硬门

| Gate  | 必须证明                                                   | 失败动作              |
| ----- | ---------------------------------------------------------- | --------------------- |
| RES-0 | 根代码商业授权/重新许可和发行主体权限已书面确认            | 只允许本地或内部构建  |
| RES-1 | 最终 artifact 内每个非代码资源都命中 approved manifest     | 构建失败              |
| RES-2 | SHA-256、大小、来源 revision 和许可文件一致                | 构建失败              |
| RES-3 | 第三方 notices、字体协议和要求的显著声明随包可见           | 禁止 candidate/stable |
| RES-4 | UE/Mixamo 等禁止或不明 raw redistribution 的模型不在包内   | 禁止 candidate/stable |
| RES-5 | 4 个默认 Skills 有权属确认，另外 12 个不被误打包           | 构建失败              |
| RES-6 | AI 示例图、头像和新品牌资产有生成/设计授权台账             | 未核验项替换或排除    |
| RES-7 | Provider Logo/名称按实际支持集合收缩并完成商标复核         | 使用中性标识或排除    |
| RES-8 | macOS、Windows 和官网最终产物完成解包级资源复核            | 不晋级 stable         |
| RES-9 | file-viewer 的 WASM/worker 逐项命中依赖来源、许可和 notice | 构建失败              |

这些 Gate 进入 T-011 的 candidate -> stable 晋级条件；stable 不允许“先发包、后补许可证”。

## 11. 实施批次

### Batch R1：最小分发集合

- 把 16 个 bundled Skills 收缩为已冻结的 4 个；
- 排除二期 UE/Mixamo/Furniture 3D 文件；
- 删除 Remote、VS Code、QQ 群、旧平台头像和旧官网资源；
- 生成首版资源 manifest 骨架。

### Batch R2：第一方视觉替换

- 交付 Spark Canvas App/Tray/Taskbar 完整品牌源文件；
- 重做 Onboarding 和最小默认头像；
- 对 Provider 图标做支持集合和商标复核。

### Batch R3：影视示例内容

- 为 194 个 Prompt 示例补来源记录，无法补证的统一重新生成；
- 记录 Provider、模型、Prompt、receipt、许可判断和人工内容复核；
- 只把 approved 输出纳入构建。

### Batch R4：3D 二期恢复

- 用第一方/CC0 素体替代 UE/Mixamo raw 资产；
- 从官方 Kenney 来源重新取得 Furniture Kit，固定 archive 和转换链；
- 通过 3D 视觉/交互回归后再进入二期 candidate。

### Batch R5：Notices 与 artifact 对账

- 生成 `THIRD_PARTY_NOTICES` 和完整许可包；
- 从干净工作树生成 file-viewer 资产，固定依赖版本并逐项核对 WASM/worker 来源与许可证；
- 解包 macOS/Windows 安装产物并与 manifest 双向核对；
- 把 RES-0 至 RES-9 接入 T-011 发布状态机。

## 12. 审计结论

E-006 已从“没有资源清单”推进为可复核的库存、风险分组和发布契约，但尚未闭环：D-016 已把旧 Website 资源排除出首版桌面候选面；当前最明确的稳定发布阻断仍是根个人使用许可证、两个 raw 3D Actor、缺生成凭证的图片集合、file-viewer WASM/worker 缺逐项来源许可证据，以及构建产物缺第三方 notices。

技术路径已经冻结，不再需要产品负责人决定“未知资源能否先发”。未知或不匹配一律不进入 stable；负责人后续只需在需要保留某项受限资产且替换会影响产品时，选择购买授权还是采用可分发替代品。
