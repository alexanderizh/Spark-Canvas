# Spark Canvas 不可达模块逐文件处置审计

> 审计快照: 2026-07-17 | 代码基线: `6cfbfcd` | T-009 已冻结，本阶段不修改业务代码

## 1. 目的

Renderer 三个入口的静态可达性遍历发现 15 个 Canvas 生产模块不可达，共 3234 行。本文件逐个判断它们是旧实现、未接线能力，还是已经抽取但尚未接管的模块，防止把“零入边”直接等同于“可以删除”。

审计同时对照了：

- `CanvasWorkspaceView.tsx`、`CanvasStage.tsx` 中当前可达实现；
- 生产 import、动态 import、样式引用和测试引用；
- 已冻结的多 Board、影视生产链和 3000 行文件治理边界；
- 当前实际交互与候选模块之间的行为差异。

## 2. 结论摘要

15 个模块分为四类：

| 处置             | 数量 | 含义                                                   |
| ---------------- | ---: | ------------------------------------------------------ |
| 删除旧实现       |    4 | 已被当前能力替代，或只是无生产消费者的诊断草稿         |
| 直接接管内联实现 |    4 | 与当前可达实现高度一致，接管后删除超大文件内重复代码   |
| 对账更新后接管   |    3 | 模块边界正确，但内容落后于当前内联实现，直接接线会回归 |
| 保留并正式接入   |    4 | 对应已冻结产品能力或揭示现有 P0 语义错误               |

这 15 个文件不是一个删除批次。实施时按下表所属行为分别进入 Board、Workspace 拆分、文件输入、影视生产和连线语义批次。

## 3. 逐文件最终处置矩阵

| 模块                            | 源码证据                                                                                                                                                    | 最终处置               | 实施动作与验收门                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CanvasAiPanel.tsx`             | 78 行、无生产入边；当前 `CanvasInlineAiComposer`、`CanvasOperationPanel` 和节点工厂已提供更完整的操作、模型、输入与参数流程                                 | **删除旧实现**         | 删除前确认没有动态 import 和专属样式；保留当前 Inline AI/Operation Panel 旅程，不把这个简化表单重新接回                                                  |
| `CanvasBoardSidebar.tsx`        | 213 行、样式仍存在；Store 已有 create/rename/delete/duplicate/switch/default Board API，但当前可见工作区没有 Board 导航，只有 Canvas Agent 间接持有部分操作 | **保留并正式接入**     | 作为项目内 Board 导航的候选实现接入或按同等能力重做；验证新建、切换、重命名、复制、删除、默认 Board、视口记忆和章节/剧集关联。它不是旧 Agent `BoardView` |
| `CanvasContextMenu.tsx`         | 396 行旧菜单；当前 `CanvasStage.tsx` 已有尺寸感知定位、选择上下文、连线菜单、2D/3D 导演台和完整 AI 操作菜单                                                 | **删除旧实现**         | 不直接接线旧菜单；先保留 `canvasContextMenuModel.ts` 的当前定位/选择测试。若拆 `CanvasStage`，应从当前可达实现重新抽取，而不是复活本文件                 |
| `CanvasFloatingNodeToolbar.tsx` | 393 行；与 `CanvasWorkspaceView.tsx:8212` 的内联组件同源，但条件已有差异，例如外部版对 Operation 产物开放资源动作，当前版显式隐藏                           | **对账更新后接管**     | 以当前可达行为为基线更新本模块，再由 Workspace import；对账普通节点、Group、Operation、产物、全屏、AI、流水线、素材和删除动作后移除内联组件              |
| `CanvasProductionPanel.tsx`     | 129 行，样式完整；展示文稿到视频六阶段，但未接线                                                                                                            | **保留并正式接入**     | 进入制作进度/影视资产中心入口；不能先把“任意一个对象存在”当作阶段完成，需要定义项目级完成证据、部分完成和 stale 状态后再展示百分比                       |
| `CanvasShortcutHelpModal.tsx`   | 108 行；数据和 UI 与 Workspace 当前内联快捷键帮助一致                                                                                                       | **直接接管内联实现**   | 导入组件并删除 `CANVAS_SHORTCUT_HELP_GROUPS` 与内联 Modal；用实际键盘 handler 对账文案，至少验证 macOS/Windows 修饰键和关闭行为                          |
| `CanvasWorkspaceSidePanel.tsx`  | 231 行；与 Workspace 当前属性/任务/资产/项目信息侧栏结构一致                                                                                                | **直接接管内联实现**   | 收紧 `snapshot`、task、asset 的 `any` 类型后接管；验证折叠、resize、四个 tab、历史/目录/模板和所有回调，再删除 Workspace 内联 JSX                        |
| `canvasConnectionSemantics.ts`  | 11 行且只有测试入边；明确“手工连线永不推断 generated”。当前 `canvas.api.ts:3698-3704` 却把从 Operation/Task 出发的手工边默认设为 `generated`                | **保留并正式接入，P0** | 把统一推断放到写边的权威边界；`generated` 只能由任务成功回写显式创建。修复后验证输入同步、血缘、删除边和旧项目兼容，禁止只在 UI 调用 helper              |
| `canvasConsistencyCheck.ts`     | 64 行，只被测试引用；评分结果没有 UI、保存或提交消费者，且用 prompt 前 24 字匹配视觉圣经，规则脆弱                                                          | **删除旧实现**         | 不新增未要求的一致性评分功能；保留 `canvasStyleContext` 的“提交前继承视觉约束”测试，将该测试改为直接断言任务归一化结果后删除模块                         |
| `canvasSelectionContext.tsx`    | 7 行，无生产和测试消费者；当前已有 `canvasContextMenuModel.ts` 的选择摘要模型                                                                               | **删除旧实现**         | 确认无 Provider 动态挂载后直接删除，不以第二套 Context 取代现有 selection state                                                                          |
| `canvasWorkspaceFilm.ts`        | 434 行；9 个导出函数都在 Workspace 中存在同名内联实现                                                                                                       | **直接接管内联实现**   | 先为剧本拆解、资产引用 prompt、分镜/关键帧 prompt 补纯函数测试，再改为 import 并删除同名内联逻辑                                                         |
| `canvasWorkspaceSnapshot.ts`    | 322 行；快照文件名、颜色归一化、Group 后代、导演台 draft 等函数均在 Workspace 中同名内联                                                                    | **直接接管内联实现**   | 为颜色回退、文件名、Group 边界和失败消息补测试后接管；截图 DOM 副作用仍由 Workspace 协调                                                                 |
| `useCanvasFileInsertion.ts`     | 482 行；封装图片选择、粘贴和拖放，但落后于当前内联实现：缺富文档、跨类型顺序布局、occupied bounds、独立上传入口和当前 selection 语义                        | **对账更新后接管**     | 先把当前可达文件输入行为完整迁入 hook，再接线；测试图片单/多选分组、文本、DOCX、视频、音频、不支持类型、粘贴、拖放、连线落点和部分失败                   |
| `canvasPipelineProgress.ts`     | 177 行，仅由不可达 Production Panel 使用；目前按 active Board 节点计关键帧/视频，却按项目资产和 metadata 计其他阶段，并用 `count > 0` 判完成                | **保留并正式接入**     | 与 Production Panel 同批；改为项目级一致口径，定义阶段完成/部分完成/stale 规则并增加纯函数测试，避免显示虚假的 100%                                      |
| `canvasWorkspacePlacement.ts`   | 189 行；大部分几何函数与 Workspace 内联同名，但缺当前文件输入使用的 bounds/next-origin helpers                                                              | **对账更新后接管**     | 补齐当前布局类型和 helpers、与 `canvasNodeSize` 统一尺寸函数后接管；为多图网格、窄视口、媒体连续落点和浮动编辑器边界加测试                               |

## 4. 两个不能误删的能力

### 4.1 Canvas Board 与旧 Agent Board 不是同一域

已冻结范围要求一个项目支持多个 Canvas Board，以及新建、切换、重命名、复制、删除、排序、默认 Board、视口记忆和章节/剧集关联。旧平台 `BoardView.tsx` 是通用任务看板，应删除；`CanvasBoardSidebar.tsx` 是影视项目内部导航，应保留。

当前 Workspace 将 `createBoard`、`renameBoard`、`deleteBoard`、`duplicateBoard`、`switchBoard` 传给 Canvas Agent，但没有给普通用户可见的 Board 切换入口。因此本模块的不可达不是“功能重复”，而是一个首版核心入口尚未接线的证据。

### 4.2 手工连线不能伪造生成血缘

`canvasConnectionSemantics.test.ts` 已记录期望：

- 连入 Operation/Task 的手工边为 `used_as_input`；
- 其他手工边为 `references`；
- `generated` 只允许任务系统在产物回写时显式创建。

当前 `canvas.api.ts` 的默认推断却会把从 Operation/Task 指向普通节点的手工边写成 `generated`，并同步到任务输出。这会污染血缘、产物定位和删除边语义。实施时必须在数据写入边界修复，不能只让 `CanvasStage` 调用 helper，因为 Canvas Agent、导入和其他调用方也能直接连线。

## 5. 接管顺序

| 批次 | 模块                                                                                           | 原因                                                |
| ---: | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
|    1 | `canvasConnectionSemantics.ts`                                                                 | 先修数据语义，防止后续拆 UI 时继续产生错误血缘      |
|    2 | `canvasWorkspaceFilm.ts`、`canvasWorkspaceSnapshot.ts`、`canvasWorkspacePlacement.ts`          | 纯逻辑先迁出，降低 Workspace 拆组件风险             |
|    3 | `useCanvasFileInsertion.ts`                                                                    | 依赖更新后的 placement，且当前版本需要先补齐行为    |
|    4 | `CanvasShortcutHelpModal.tsx`、`CanvasWorkspaceSidePanel.tsx`、`CanvasFloatingNodeToolbar.tsx` | 迁出当前大块 JSX，保持可见行为不变                  |
|    5 | `CanvasBoardSidebar.tsx`                                                                       | 补齐多 Board 可见入口并完成跨 Board 旅程            |
|    6 | `CanvasProductionPanel.tsx`、`canvasPipelineProgress.ts`                                       | 完成项目级进度语义后再对用户展示                    |
|    7 | 4 个删除项                                                                                     | 对应接管/测试完成后单独删除，避免和行为迁移混在一起 |

## 6. 每个接管批次的统一门槛

1. 修改前对账外部模块与当前可达实现，当前实现优先。
2. 一次只接管一个行为域，不顺手重设计 UI。
3. 先补纯函数或组件测试，再切 import，最后删除内联代码。
4. 执行 Canvas typecheck、相关单测、构建和对应可见旅程。
5. 重跑入口可达性扫描；目标是消除重复实现，不是机械追求零个不可达文件。
6. `CanvasWorkspaceView.tsx` 后续只减行，不再直接增加业务逻辑。

## 7. T-009 冻结结论

T-009 已完成技术决策：4 个删除、4 个直接接管、3 个更新后接管、4 个保留并接入。后续不再把这 15 个文件整体标为“待确认”，但每个实施批次仍必须通过本文件列出的行为门和测试门。
