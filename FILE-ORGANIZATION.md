# 文件组织规范 · 本项目采纳清单

本文件是《单文件拆解规范》在本项目（YoYo画布，slug: yoyohua-bu）的采纳清单：
红线、角色分档与例外都在这里定版。开工先读本文件；文件触线当场按缝拆分，
不留待「重构期」。

本文件是同目录 `ENGINEERING.md`（YoYo画布工程规范总纲）中文件组织
部分的权威细则：每次新增功能或修改，先读 `ENGINEERING.md` 的
「开工速查」，拆分事项再按本文件执行。

## 采纳的红线（四档）

| 角色 | 红线 | 说明 |
| --- | --- | --- |
| 业务实现 | **500 行** | 执行一文件一职责全量：一个文件只承担一摊可一句话说清的职责 |
| 编排 / 胶水 | **800 行** | 模块入口、命令注册、路由表：只许串联下面的模块，不许内含业务逻辑 |
| 结构硬线 | **单文件 700 行 / 单函数 300 行** | 任何角色都不得越过的上限（例外清单登记者除外，见下） |
| 生成代码 | 免于组织管理 | 文件头须标注生成来源，禁止手改（如 `server/src/.generated/`） |
| 测试 | 不按行数管理 | 按被测单元组织：一个测试文件对应一个被测单元 |

## 通行规则

- **新文件诞生即守一文件一职责**：写代码时发现要往现有文件里加第二摊不相干
  的事，先建新文件再写，不许「先塞进去，以后拆」。
- **触线当场分**：文件触及所属档位红线，即在同一次改动内按职责的缝拆开；
  拆分是纯结构搬移——对外接口不变、行为不变，由特征测试证明拆分前后一致。
- **不留转发壳、不新旧并存**：拆完即删旧位置，不留 re-export 空壳过渡。
- **安全网决定激进程度**：无测试覆盖的纯逻辑，先补特征测试（刻画当前行为）
  再拆；测试放在被测模块同级的 `__tests__/` 目录，`bun test` 运行。

## 例外清单

### 例外 1 · client/src/icons.tsx（长期例外）

619 行，职责单一的图标库（本地 lucide 风格描边图标集），长而不臃肿。
豁免业务实现 500 行线，仍受 700 行结构硬线约束：超过 700 行时必须按图标
族拆分。状态：**合规（例外登记）**。

### 例外 2 · 拆解过渡期存量超线文件（整改中，逐个划除）

以下文件在采纳本清单时已经超线，登记为「整改中」而非合规，按批次 S1 起
逐个拆解，拆完一个划掉一个。在整改完成前，它们不作为新代码的参照：
新代码不得继续往这些文件里堆新职责。

| 文件 | 采纳时行数 | 状态 |
| --- | --- | --- |
| client/src/App.tsx | 5,769 | 整改中（终局 2,518 行：S3 尾部 9 组件迁出 → 4,766 行；S4 hooks 第一组五摊抽离 → 4,302 行；S5 hooks 第二组三摊抽离 → 2,660 行；S11 渲染段抽 DetailEditor.tsx → 2,518 行。主组件 App 函数本体 2,364 行仍超单函数 300 线、文件仍超 700 硬线——渲染 JSX 与接线同居一函数，继续拆需按渲染段逐块抽组件，属后续独立工作，不在 S1–S11 整改范围内，终局保留登记） |
| client/src/hooks/use-canvas-gestures.ts | —（S5 新拆出） | ~~已转正式例外（S11 拆出连线域 use-connection-wiring.ts 275 行 + 长按域 use-long-press.ts 102 行后，本体 885 行仍超 700 硬线，剩余部分经耦合实测不可再按逐字搬移拆分，登记为例外 4，待负责人确认）~~ |
| client/src/hooks/use-node-ops.ts | —（S5 新拆出） | 整改中（终局 538 行：超业务 500 线、未越 700 硬线；职责单一为节点操作 handler 集，useNodeOps 函数本体 458 行超单函数 300 线系 hook 组装本体，终局保留登记） |
| client/src/components/NodeCard.tsx | —（S3 新拆出） | 整改中（终局 555 行：超业务 500 线、未越 700 硬线；职责单一为节点卡片本体。NodeCard 函数本体 476 行超单函数 300 线，系简报指定边界内的整段逐字搬移结果，本批只搬不拆，函数级超限终局保留登记） |
| server/src/actions.ts | 5,052 | ~~已划除（S1 拆 helper 层 → 2,791；S2 注册段按域拆完 → 27 行纯编排汇总，达标）~~ |
| server/src/actions/generation-dispatch.ts | —（S1 新拆出） | ~~已划除（S2 按三摊再分：本体 427 行达标；分出 queue-sweep.ts 238 行、tool-dispatch.ts 515 行）~~ |
| server/src/actions/package.ts | —（S2 新拆出） | 整改中（终局 515 行：超业务 500 线、未越 700 硬线；其中 importProjectPackage 单个 handler 超单函数 300 线——S2 按 handler 口径记 352 行，S11 终审以 TS 编译器量 defineAction 整体跨度 317 行，两种口径均超线——S2 只搬不拆，已知函数级超限，终局保留登记） |
| server/src/actions/tool-dispatch.ts | —（S2 新拆出） | 整改中（终局 515 行：超业务 500 线、未越 700 硬线；职责单一为工具节点执行，runToolDispatch 已按分支提取为 27 行路由 + 三个分支函数（S11 终审实测最大 205 行），均在单函数线内） |
| server/src/privileged.ts | 1,498 | ~~已划除（S6 按域拆分：handler 与 helper 迁入 server/src/privileged/ 三文件，本体 → 331 行只剩 Contracts 字面量与 Handlers 汇总装配，编排档达标；Contracts 字面量留本体是平台生成口径约束，见例外 3）~~ |
| server/src/privileged/media.ts | —（S6 新拆出） | ~~已划除（S12 补拆：V1 加 makePlaybackProxy 后 661 → 750 行越 700 硬线，按既定缝二分——视频/音频类 media-video.ts 433 行、图片类 media-image.ts 258 行、共享 ffmpeg plumbing media-common.ts 100 行，三文件均在业务线内；代理参数提命名常量 PROXY_MAX_EDGE / PROXY_VIDEO_BITRATE / PROXY_AUDIO_BITRATE；契约投影 sha256 拆分前后一致）~~ |
| client/src/components/SidePanel.tsx | 1,476 | ~~已划除（S7 按三页签拆分：本体 → 148 行只剩壳（SidePanel + TabButton + 三页签 import 组装）；分出 CanvasNodesTab.tsx、AssetsTab.tsx、PromptsTab.tsx）~~ |
| client/src/components/CanvasNodesTab.tsx | —（S7 新拆出） | 整改中（终局 558 行：超业务 500 线、未越 700 硬线；职责单一为画布页签（节点列表/网格 + NodeThumb 缩略图），CanvasNodesTab 函数本体 429 行超单函数 300 线；系 S7 简报指定边界内的整段逐字搬移结果，本批只搬不拆，终局保留登记） |
| client/src/components/AssetsTab.tsx | —（S7 新拆出） | 整改中（终局 606 行：超业务 500 线、未越 700 硬线；职责单一为资产页签（AssetsTab + AssetRow），AssetsTab 函数本体 378 行超单函数 300 线；系 S7 简报指定边界内的整段逐字搬移结果，本批只搬不拆，终局保留登记） |
| client/src/components/ImageEditorDialogs.tsx | 1,129 | ~~已划除（S8 按五对话框拆分：DialogShell.tsx 125 行（共用壳与小件）+ CropDialog.tsx 265、SplitDialog.tsx 241、UpscaleDialog.tsx 163、AngleDialog.tsx 147、MaskDialog.tsx 254，六文件均在业务线内）~~ |
| client/src/components/NodeToolbar.tsx | 824 | ~~已划除（S9 按职责拆分：HoverToolbar.tsx 544 行、SelectionToolbar.tsx 62 行、NodeInfoModal.tsx 143 行、quick-tools.ts 98 行）~~ |
| client/src/components/HoverToolbar.tsx | —（S9 新拆出） | 整改中（终局 545 行：超业务 500 线、未越 700 硬线；职责单一为节点悬浮工具条（HoverToolbar + ToolbarAction + 工具表组装 helper），HoverToolbar 函数本体 360 行超单函数 300 线；系 S9 简报指定边界内的整段逐字搬移结果，本批只搬不拆，终局保留登记） |
| client/src/components/MediaPreview.tsx | 763 | ~~已划除（S9 按职责拆分：MediaPreviewDialog.tsx 613 行、HoverMediaPreview.tsx 157 行）~~ |
| client/src/components/MediaPreviewDialog.tsx | —（S9 新拆出） | 整改中（终局 613 行：超业务 500 线、未越 700 硬线；职责单一为眼睛预览弹窗（原尺寸显示/缩放/平移/捏合/全屏/下载），MediaPreviewDialog 函数本体 563 行超单函数 300 线系组件本体；系 S9 简报指定边界内的整段逐字搬移结果，本批只搬不拆，终局保留登记） |
| client/src/components/GenerationPanel.tsx | 732 | ~~已划除（S10 拆分：ConfigComposerDialog 迁出到 ConfigComposerDialog.tsx 220 行，本体只剩生成大面板；本体拆分后 531 行另行登记，见下行）~~ |
| client/src/components/GenerationPanel.tsx（S10 拆分后） | —（S10 拆分结果） | 整改中（终局 531 行：超业务 500 线、未越 700 硬线；职责单一为生成大面板本体，GenerationPanel 函数本体 476 行超单函数 300 线系组件本体；系 S10 简报指定边界内的整段逐字搬移结果，本批只搬不拆，终局保留登记） |
| client/src/components/ToolPanel.tsx | 665 | ~~已划除（S10 拆分：ToolNodeBody 与工具选项状态机迁出到 ToolNodeBody.tsx 446 行（业务线内），本体只剩说明面板 → 244 行，达标）~~ |
| client/src/types.ts | 360（行数未超线，职责分叉） | ~~已处理（S10：11 个运行时函数迁出到 client/src/node-utils.ts 120 行，types.ts 回归纯类型 + 纯常量登记 → 243 行；无转发 re-export）~~ |

### 例外 3 · server/src/privileged.ts 的 Contracts 字面量（平台约束，长期例外）

`export const Contracts = definePrivilegedContracts({...})`（20 个契约）必须
字面留在 privileged.ts 本文件内，不得迁入子模块：构建体系生成
`server/.generated/privileged.contract.ts` 的方式，是用正则从 privileged.ts
的**源文件文本**中提取该调用的实参原文（extract-privileged-contracts 的
--source 模式）。S6 实测：把契约改为从子模块 import + re-export 后，提取器
返回 generated:false 并**删除**已生成的投影文件，契约内容随之丢失。故
contracts.ts 一摊不拆；privileged.ts 其余部分（handler/helper）已按域拆完，
本体 331 行属编排档（800 线内）。本例外为平台生成口径约束，非代码臃肿：
若平台日后改为按模块导出收集契约，应即行拆出并划除本例外。

### 例外 4 · client/src/hooks/use-canvas-gestures.ts 剩余调度本体（正式例外，**待负责人确认**）

S11 已按手势子域拆出两摊干净的：连线域（use-connection-wiring.ts
275 行：connecting/pendingConnect/tapConnect 状态与 refs、screenToWorld
与 computeDropTarget 几何、addConnection/createConnectedNode 与全部
连线清理/菜单函数）与长按域（use-long-press.ts 102 行：longPressRef、
cancelLongPress、fireLongPress），主文件 1,059 → 885 行，仍超 700
结构硬线。剩余部分（指针事件总调度 + 手势状态汇总）经耦合实测
**不可再按「逐字搬移、不改行为」拆分**，登记为正式例外：

- **捏合/多指追踪拆不出**：activePointersRef/pinchRef/pinchStaleRef
  的写入在 onCanvasPointerDown 的多指段、变换在
  handleWindowPointerMove 的首分支、收尾在 handleWindowPointerUp
  的首段与 window blur 处理里——与平移/节点拖动/框选共用同三个
  handler，捏合的进入与退出同时改写 gestureRef 并取消正在进行的
  单指手势。抽出捏合即须把三个 handler 的函数体按分支切开重组，
  不是整段搬移。
- **节点拖动/手柄拖动/框选拆不出**：三者是同一状态机
  （GestureState 的 pan/node/box/none 四态）的分支，分布在
  down/move/up 三个 handler 内按 gestureRef.current.kind 分发；
  move 的节点分支直写 nodesRef、up 的节点分支管编辑器抑制与
  多选 tap-toggle，共享同一份 origins 与 moved 判定（3px 阈值）。
  按子域拆即须重写分发结构。
- **长按与连线两域已拆出**的前提正是它们的状态（longPressRef /
  connecting 三态）有独立的所有权边界、handler 只经 ref 与回调
  与之交互；剩余各域不具备这一边界。

本例外为耦合约束，非职责混杂：文件剩余职责单一（指针事件总
调度），内部最大逻辑函数 onCanvasPointerDown 240 行在单函数线
内。若日后要再降，只能以「重构调度结构 + 补手势特征测试」为
前提另行立项，不属纯结构搬移。**状态：待负责人确认。**

## 批次记录

- **S1（2026-11-15，已完成）**：前置（本清单落地 + 第一批特征测试）+
  server/src/actions.ts 前半 helper 层按缝拆分到 server/src/actions/
  子目录。拆分后行数：actions.ts 2,791（只剩 46 个 defineAction 注册与
  deliverGeneratedFile）；contracts.ts 231、plugins-manifest.ts 102、
  project-dirs.ts 168、ratios.ts 184、graph-helpers.ts 399、
  generation-context.ts 188、generation-dispatch.ts 1,132（见例外 2 的
  续拆登记）。特征测试 3 个文件 37 条（ratios / project-dirs /
  graph-helpers），拆分前后同一套全绿；细节见 DATA-PLAN.md 的 S1 条目。
- **S2（2026-11-15，已完成）**：actions.ts 注册段按 8 域拆到
  server/src/actions/（projects 336、graph 226、assets 369、prompts 68、
  generation 633、media-edit 441、package 515、plugins 219 行），
  actions.ts 只剩 27 行 Actions 汇总注册（展开各域对象、satisfies
  ActionsModule），纯编排达标；generation-dispatch.ts 按三摊再分
  （本体 427、queue-sweep 238、tool-dispatch 515 行），runToolDispatch
  按既有三分支提取为独立函数、主函数 27 行只做路由。46 个
  defineAction 块与 deliverGeneratedFile 经脚本逐字比对与拆分前
  备份完全一致；typecheck 全绿、37 条特征测试全绿。仍超线者：
  package.ts（515 行 + importProjectPackage handler 352 行函数级
  超限）与 tool-dispatch.ts（515 行）已登记例外 2；generation.ts
  633 行为注册档（编排 800 线内）。细节见 DATA-PLAN.md 的 S2 条目。
- **S3（2026-11-15，已完成）**：App.tsx 尾部 9 个同居组件整段迁出到
  client/src/components/ 五个新文件：NodeCard.tsx 556 行（NodeCard +
  NodeZoomButton）、ConfigNodeBody.tsx 224 行、NodeBodies.tsx 104 行
  （Html/Svg/Panorama 三种文档节点本体）、EdgePath.tsx 59 行、
  ProjectChrome.tsx 117 行（ProjectMenuItem + ChatStatusBadge）。
  App.tsx 5,769 → 4,766 行，仍超线、保留「整改中」，待 S4 抽 hooks。
  九个组件块经脚本逐字比对与拆分前原文完全一致（仅加 export 与
  文件头/导入）；App.tsx 本体 diff 仅限导入增删、videoToggleSuppressUntil
  共享状态随 NodeCard 迁出（原样保留在 NodeCard.tsx，App 侧改经
  suppressVideoToggleUntil 写入）与尾部删除。NodeCard.tsx 556 行
  超业务 500 线已登记例外 2。typecheck 全绿、37 条特征测试全绿。
  细节见 DATA-PLAN.md 的 S3 条目。
- **S4（2026-11-15，已完成）**：App() 内部五摊状态与逻辑抽成
  client/src/hooks/ 下五个 hook 文件：use-appearance.ts 78 行
  （外观偏好三态 + localStorage 持久化 effect）、use-plugins.ts
  117 行（pluginsQ 查询、disabledPluginByType/disabledTypes 计算、
  启停/卸载/安装 handler 与忙碌态）、use-history.ts 304 行
  （撤销/重做历史 + 持久化调度：applyNodes/applyEdges/applyGraph/
  applyViewport 四个变更入口、scheduleSave/flushSave、adoptSeqs、
  loaded/intentionalEmpty 守卫、saveTimer；图 refs 与 setter 仍由
  App 持有、经入参传入）、use-package-io.ts 102 行（项目包导出/
  导入 handler、importInputRef、导入报告态）、use-panel-chrome.ts
  152 行（键盘/焦点隐藏状态机：panelTextFocused 单一写者
  recomputePanelTextFocus、全部监听与恢复漏斗、kbInset 几何
  watcher、keyboardUp 派生，四路恢复逻辑逐字未动）。五个新文件
  均在业务 500 线内，无需新增例外登记。App.tsx 4,766 → 4,302 行，
  仍超线、保留「整改中」，待 S5。十五个搬移段经脚本逐段比对
  （去一层缩进后）与拆分前原文完全一致、且在 App.tsx 中已无残留；
  App 侧改动仅限五处 hook 调用、switchProject 的四行重置改经
  hook 的 cancelPendingSave/resetHistory 两助手（语句逐字收入
  hook）、anyPanelOpen 漏斗 effect 原样保留在 App（其触发值在
  渲染中段才派生、且排在消费 kbInset 的编辑器几何之后，无法作
  为 hook 入参——effect 本体未动、仍调用 hook 返回的
  recomputePanelTextFocus）、三处随迁出失效的导入删除。
  typecheck 全绿、37 条特征测试全绿。细节见 DATA-PLAN.md 的
  S4 条目。
- **S5（2026-11-15，已完成）**：App() 内部三摊抽成 hooks 第二组：
  use-canvas-gestures.ts 1,059 行（手势层全部 state/ref/handler：
  指针按下/移动/抬起、捏合、长按、点选连线、框选、连线几何、
  键盘与滚轮监听；模块级 GestureState/PendingConnectState/
  ContextMenuState/CreateMenuState/isFormTarget/MIN·MAX_ZOOM
  随迁）、use-node-ops.ts 538 行（buildNode/persistAddedNode、
  各入口建节点、insertAsset、updateNode、删除/复制/分组/解组、
  createGeneratorNode；模块级 newId/NODE_DEFAULTS 随迁）、
  use-generation.ts 491 行（refreshGraphFromServer 镜像兜底、
  runGeneration/runTool/stopGeneration、run-feedback 状态机
  接线、队列查询与踢动、handleUploadFiles）。App.tsx 4,302 →
  2,660 行，仍超线、保留「整改中」。18 个搬移段经脚本逐段比对
  （去一层缩进后）与拆分前原文完全一致、且在 App.tsx 中已无
  残留；App 侧改动仅限三处 hook 调用与随迁出失效的导入删除
  （18 个未用导入）。contextMenu/createMenu 两态留 App（菜单
  UI 态、由渲染树多处直接写，setter 经入参下传）——同 S4
  anyPanelOpen 的依赖口径。use-canvas-gestures.ts 与
  use-node-ops.ts 超线已登记例外 2；use-generation.ts 491 行
  在业务线内。typecheck 全绿、37 条特征测试全绿。细节见
  DATA-PLAN.md 的 S5 条目。
- **S6（2026-11-15，已完成）**：privileged.ts（1,498 行）按域拆分到
  server/src/privileged/ 三个文件：files.ts 240 行（文件/blob 域
  handler 5 个 + 路径/blob helper 与共享常量，media/package 两域的
  helper 由此 import）、media.ts 661 行（ffmpeg/ffprobe 媒体域
  handler 11 个 + probePixelSize/probeDurationSeconds）、
  package.ts 319 行（项目包 handler 4 个 + ZIP helper 与
  stagingRoot）。privileged.ts 本体 → 331 行：文件头 + Contracts
  字面量 + `definePrivilegedHandlers(Contracts, { ...filesHandlers,
  ...mediaHandlers, ...packageHandlers })` 汇总装配，不含 handler
  业务逻辑。**contracts.ts 一摊未拆（平台约束，见例外 3）**：构建的
  契约投影从 privileged.ts 源文本正则提取 definePrivilegedContracts
  调用，迁出即导致生成物被删——S6 以提取器实测证伪后按简报硬约束
  停摊，Contracts 字面量逐字留本体；拆分后重新生成的
  .generated/privileged.contract.ts 与拆分前逐字一致（sha256
  e18ffba2… 前后不变）。逐字证据：Python 脚本按锚点断言的行号区间
  整段切片，覆盖率核对证明原文件 1,498 行每一行非空行均有唯一去向
  （切片块 / 旧 import 段 / Handlers 包装行），20 个 handler 与 9 个
  helper 块在新文件中逐字命中；唯一非搬移调整是 MAX_BYTES 与三个
  跨域 helper（safeBase/assertInProjectsRoot/readBlobObjectBytes）
  加 export 前缀。media.ts 661 行超业务线已登记例外 2；files.ts /
  package.ts 在线内。typecheck 全绿、37 条特征测试全绿；沙箱三域
  实测（媒体：makePoster 出帧 + extractFrames 抽帧表；包：
  buildProjectPackage 产包 + readPackageFile 读回；文件：
  mirrorBlobToFile 字节级落盘）全通。另含 S5 证据补强：18 个搬移段
  对拆分前基线重跑逐段比对全一致（细节见 DATA-PLAN.md 的 S5 补证
  与 S6 条目）。
- **S7（2026-11-15，已完成）**：SidePanel.tsx（1,476 行）按三页签拆分：
  本体 → 148 行只剩壳（文件头 + SidePanelProps + SidePanel 组件 +
  TabButton + 三页签 import 与组装，页签顺序资产/画布/提示词库不变）；
  CanvasNodesTab.tsx 556 行（画布页签横幅 + TYPE_FILTERS + NodeThumb +
  CanvasNodesTab）；AssetsTab.tsx 606 行（资产页签横幅 + KIND_ORDER +
  AssetsTab + AssetRow）；PromptsTab.tsx 208 行（提示词页签横幅 +
  PromptsTab，业务线内）。各页签以最小 props 取用：CanvasNodesTab 仍
  收 SidePanelProps（type-only 从壳 import，无运行时循环）、AssetsTab /
  PromptsTab 沿用原有内联 props 形参，一字未改。共享件归属：NodeThumb
  被画布页签与资产页签的节点选择器共用，随画布页签入 CanvasNodesTab.tsx
  并 export，AssetsTab 从该文件 import。逐字证据：Python 脚本按锚点
  断言的行号区间整段切片生成四文件，14 个搬移段在新文件中逐字命中
  （唯一调整是 NodeThumb / CanvasNodesTab / AssetsTab / PromptsTab 四个
  函数加 export 前缀，及各新文件的文件头注释与 import 段）；壳内无任何
  已迁定义残留（脚本断言）。CanvasNodesTab.tsx 556 行、AssetsTab.tsx
  606 行超业务线已登记例外 2。typecheck 全绿、37 条特征测试全绿；
  沙箱三页签实测（画布：三段式命名 + 点击只定位选中不开大面板 + 改名
  落库；资产：分组顺序 + 插入生成节点 + 上传入资产；提示词：新增 +
  插入为文本节点）全通。细节见 DATA-PLAN.md 的 S7 条目。
- **S8（2026-11-15，已完成）**：ImageEditorDialogs.tsx（1,129 行）按五
  对话框拆分：DialogShell.tsx 125 行（DialogShell + FooterButtons +
  useImageMeta + clamp 五对话框共用壳与小件，均加 export）；五个对话框
  各自一文件——CropDialog.tsx 265 行（CropDialog + CropRect +
  DEFAULT_CROP/RATIO_PRESETS）、SplitDialog.tsx 241 行（SplitDialog +
  SplitParams + buildLines）、UpscaleDialog.tsx 163 行（UpscaleDialog +
  UpscaleParams + 目标/算法常量）、AngleDialog.tsx 147 行（AngleDialog +
  AngleParams + AngleSlider 随迁）、MaskDialog.tsx 254 行（MaskDialog +
  MaskPayload）。六文件均在业务 500 线内，无需新增例外登记。唯一引用方
  App.tsx 改从五个新文件分别 import（名字与 props 签名不变），旧文件
  删除、不留汇总转发文件。逐字证据：Python 脚本按锚点断言的行号区间
  整段切片，24 个搬移段在新文件中逐字命中，覆盖率核对证明原文件每一
  非空行均有唯一去向（未覆盖者仅旧 import 段）；唯一非搬移调整是壳内
  四个共用件加 export 前缀，及各新文件的文件头注释与 import 段。
  typecheck 全绿、37 条特征测试全绿；沙箱五对话框各开一次并各跑一条
  主路径（细节见 DATA-PLAN.md 的 S8 条目）。
- **S9（2026-11-15，已完成）**：NodeToolbar.tsx（824 行）与 MediaPreview.tsx
  （763 行）两文件在同一批内逐个拆分（拆完一个 typecheck+构建通过再拆
  下一个）。文件一按职责拆为四文件：quick-tools.ts 98 行（工具 id 类型 +
  IMAGE_TOOL_DEFS + 快速工具配置读写——悬浮条的设置读写自成一摊、零
  import，HoverToolbar 单向 import 它，依赖最干净）、HoverToolbar.tsx
  544 行（ToolbarHandlers + Tool/imageTool* helper + HoverToolbar 本体 +
  ToolbarAction——多选条共用的按钮渲染件随悬浮条、由 SelectionToolbar
  import）、SelectionToolbar.tsx 62 行、NodeInfoModal.tsx 143 行
  （NodeInfoModal + InfoRow + formatBytes）。文件二拆为两文件：
  MediaPreviewDialog.tsx 613 行（PreviewTarget + 弹窗本体，缩放/平移/
  捏合手势段逐字保留）、HoverMediaPreview.tsx 157 行（HoverPreviewData +
  悬停预览）；共用件不复制——PreviewTarget 归弹窗文件、HoverPreviewData
  归悬停文件、下载入口仍是既有共用的 download-media.ts。唯一引用方
  App.tsx 改从新文件分别 import（名字与 props 不变），两旧文件删除、
  不留汇总转发文件。逐字证据：Python 脚本按锚点断言的行号区间整段
  切片，两文件共 11 个搬移段在新文件中逐字命中，覆盖率核对证明原文件
  每一非空行均有唯一去向（未覆盖者仅旧文件头/旧 import 段）；唯一非
  搬移调整是 ALL_QUICK_IDS 与 ToolbarAction 加 export 前缀，及各新文件
  的文件头注释与按实际用量裁剪的 import 段。HoverToolbar.tsx 544 行、
  MediaPreviewDialog.tsx 613 行超业务线已登记例外 2；其余四文件在线内。
  typecheck 全绿、37 条特征测试全绿。细节见 DATA-PLAN.md 的 S9 条目。
- **S10（2026-11-15，已完成）**：GenerationPanel.tsx（732 行）、
  ToolPanel.tsx（665 行）、types.ts（360 行）三文件在同一批内逐个拆分
  （拆完一个 typecheck 通过再拆下一个）。其一：ConfigComposerDialog
  迁出到 ConfigComposerDialog.tsx 220 行，GenerationPanel.tsx 本体
  只剩生成大面板 → 531 行；共用件 ChipPromptInput / referenceLabels
  本就在 ChipPromptInput.tsx 单一归属，两文件各自 import、无复制。
  其二：ToolNodeBody 与工具选项状态机（ToolRunOptions /
  readToolOptions / writeToolOptions / useToolOptions / parseSec）
  迁出到 ToolNodeBody.tsx 446 行，ToolPanel.tsx 本体只剩说明面板
  （TOOL_HELP 随面板）→ 244 行。其三：types.ts 的 11 个运行时函数
  （isDocNodeType / isTextSourceType / isToolNodeType / firstTextInput /
  resolveHtml / resolveSvgSource / isValidSvg / stripChipTokens /
  nodeListLabel / nodePreviewText / isMediaUrl）迁出到新文件
  client/src/node-utils.ts 120 行（节点运行时 helper 单一归属，
  单向 import types.ts 的类型与 SEQ_TYPE_LABEL，无循环），types.ts
  回归纯类型 + 纯常量登记 → 243 行；全仓 9 个引用方改走 node-utils，
  不留转发 re-export。逐字证据：三处均以拆分前基线按锚点切片整段
  提取、组装后逐段 diff / 包含断言全命中（唯一非搬移调整：
  readToolOptions / writeToolOptions 加 export 前缀、各新文件的
  文件头注释与按实际用量裁剪的 import 段、NodeBodies 两处指向
  types.ts 的注释改为 node-utils）。GenerationPanel.tsx 531 行超
  业务线已登记例外 2；其余新文件均在线内。每处拆完即跑 typecheck
  全绿；37 条特征测试全绿。细节见 DATA-PLAN.md 的 S10 条目。
- **S11（2026-11-15，已完成，收尾批次）**：最后两个大块的拆分尝试 +
  全仓终审。其一：use-canvas-gestures.ts（1,059 行）按手势子域拆出
  两摊——连线域 use-connection-wiring.ts 275 行、长按域
  use-long-press.ts 102 行，主 hook 改为组装两子 hook，10 个搬移段
  逐字命中 10/10，全部判定阈值原位保留（长按 ~500ms 武装在
  pointer-down、10px 解除半径在 move、3px 拖动判定、8px 手柄
  tap 判定、落点几何 40/32 随连线域迁出）；本体 → 885 行仍超
  700 硬线，剩余调度三 handler 与捏合/拖动/框选共用同一手势
  状态机、不可再逐字拆分，登记为例外 4（正式例外，待负责人
  确认）。其二：App.tsx 渲染段抽出详情编辑器整块 →
  components/DetailEditor.tsx 217 行（壳 + 标题行 + 文本编辑区 +
  各类型面板分发，144 行 JSX 经统一去缩进后逐字命中），
  detailEditorStyle/showDetailEditor 推导与 detailEditorRef 仍留
  App、经 props 传入，App() 的 hook 调用与数据流不变；App.tsx
  2,655 → 2,518 行。其三：全仓终审（见文末「终审」节）。两处拆分
  各自拆完即跑 typecheck 全绿；37 条特征测试全绿。细节见
  DATA-PLAN.md 的 S11 条目。
- **S12（2026-11-15，已完成，规范补拆）**：server/src/privileged/media.ts
  在 V1（播放代理）后由 661 涨至 750 行、越 700 结构硬线，当时未触发
  拆分，本批补拆。按既定缝二分：视频/音频类（makePoster /
  makePlaybackProxy / probeMediaFile / extractFrames / extractAudio /
  composeVideo / probeStreams）→ media-video.ts 433 行；图片类
  （convertImageToPng / shrinkImageForInference / cropImage /
  splitImage / upscaleImage）→ media-image.ts 258 行；共享 plumbing
  （execFileAsync、FFMPEG_BIN/FFPROBE_BIN、probePixelSize /
  probeHasAudioStream / probeDurationSeconds）只留一份 →
  media-common.ts 100 行，两边 import 共用、不复制。原 media.ts
  删除、不留转发壳；唯一引用方 privileged.ts 改直引两组 handler
  （mediaImageHandlers / mediaVideoHandlers）。同批提命名常量：
  makePlaybackProxy 的代理参数由内联字面量提为模块级常量
  PROXY_MAX_EDGE（1280）/ PROXY_VIDEO_BITRATE（"4M"，-b:v 与
  -maxrate 共用）/ PROXY_AUDIO_BITRATE（"128k"），经模板插值使用，
  ffmpeg 参数拼装结果逐字等价（scale 滤镜表达式、aac 参数一字
  不变）。逐字证据：脚本按锚点行号区间整段切片，12 个 handler 与
  3 个 probe helper 在新文件中逐字命中（makePlaybackProxy 除四处
  常量替换外逐字一致），覆盖率核对证明原文件 750 行每一非空行均有
  唯一去向。硬约束验证：拆分后重新生成的
  .generated/privileged.contract.ts 与拆分前逐字节一致（sha256
  5d6aacf5… 前后不变——契约字面量本就只在 privileged.ts 内，
  提取口径未受文件搬移影响）。typecheck 全绿、37 条特征测试
  全绿、构建通过。细节见 DATA-PLAN.md 的 S12 条目与文末终审
  S12 补记。

## 终审（S11，2026-11-15 · 单文件拆解整改终局状态）

全仓清点口径：client/src + server/src 全部 .ts/.tsx 共 **85 个文件、
24,214 行**（wc -l）；函数跨度以 TypeScript 编译器 AST 实测
（声明起止行）。与红线逐一对照：

### 超 700 结构硬线（2 个）

| 文件 | 终局行数 | 状态 |
| --- | --- | --- |
| client/src/App.tsx | 2,518 | 例外 2 保留登记（整改中）：主组件函数本体 2,364 行；渲染段继续逐块抽组件属后续独立工作 |
| client/src/hooks/use-canvas-gestures.ts | 885 | 例外 4 正式例外（**待负责人确认**）：连线/长按两域已拆出，剩余调度本体耦合不可逐字再分 |

### 超 500 业务线、未越 700 硬线（10 个，均为职责单一、终局保留登记；另附 1 个仅函数级超限者）

| 文件 | 行数 | 其中函数级超 300 线 |
| --- | --- | --- |
| server/src/privileged/media.ts | 661 | 无 |
| client/src/components/MediaPreviewDialog.tsx | 613 | 组件本体 563 |
| client/src/components/AssetsTab.tsx | 606 | 组件本体 378 |
| client/src/components/CanvasNodesTab.tsx | 558 | 组件本体 429 |
| client/src/components/NodeCard.tsx | 555 | 组件本体 476 |
| client/src/components/HoverToolbar.tsx | 545 | 组件本体 360 |
| client/src/hooks/use-node-ops.ts | 538 | hook 本体 458 |
| client/src/components/GenerationPanel.tsx | 531 | 组件本体 476 |
| server/src/actions/tool-dispatch.ts | 515 | 无（最大分支函数 205） |
| server/src/actions/package.ts | 515 | importProjectPackage 317（S2 口径 352） |
| client/src/hooks/use-generation.ts | 491（线内，仅函数级） | hook 本体 457 |

另：client/src/icons.tsx 619 行属例外 1（长期例外，合规）；
server/src/actions/generation.ts 633 行属 S2 已定版的注册档
（编排 800 线内）；client/src/components/CanvasToolbar.tsx 455 行、
ToolNodeBody.tsx 446 行文件在线内，其组件本体分别为 405 / 320 行
超单函数线，一并在此记明（组件本体即文件单一职责本身）。

### 单函数超 300 线清单（AST 实测，终局）

组件/hook 本体类（函数即文件职责本身）：App 2,364、
useCanvasGestures 788、MediaPreviewDialog 563、NodeCard 476、
GenerationPanel 476、useNodeOps 458、useGeneration 457、
CanvasNodesTab 429、CanvasToolbar 405、AssetsTab 378、
HoverToolbar 360、ToolNodeBody 320。普通逻辑函数类仅 1 个：
importProjectPackage 317（package.ts）。其余全部函数 ≤300 行
（最接近者 PanoramaViewer 294）。

### 需负责人确认的例外（单独标出）

- **例外 4 · use-canvas-gestures.ts 剩余调度本体（885 行）**：
  耦合原因见例外 4 正文。**待负责人确认。**
- 例外 1（icons.tsx）与例外 3（privileged Contracts 字面量）为
  既有已登记例外，状态不变，不需重新确认。

### 终局结论

整改前两个巨头（App.tsx 5,915 / actions.ts 5,015）已分别降至
2,518 / 27 行；全仓超 700 硬线只剩上表 2 个且均有登记；超 500
业务线 10 个全部职责单一、逐项登记在例外 2；其余 71 个文件全部
在业务线内（含 3 个测试文件，其不按行数管理）。S1 建立的 37 条
特征测试全程全绿。单文件拆解整改
至 S11 收尾，剩余登记项如上表保留，不再自行开启新批次。

### S12 补记（2026-11-15，终审后补拆）

上表「超 500 业务线」中的 server/src/privileged/media.ts 一行已
过时：该文件在 S11 终审后因 V1 播放代理涨至 750 行越硬线，已于
S12 按缝补拆为 media-video.ts 433 行 / media-image.ts 258 行 /
media-common.ts 100 行（均在业务线内），例外 2 登记已划除。
据此更新终局口径：超 500 业务线由 10 个减为 9 个，超 700 硬线
仍为上表 2 个不变；全仓文件数 85 → 87（media.ts 删、新增三
文件）。其余终审结论不变。
