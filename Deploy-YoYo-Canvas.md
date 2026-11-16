# YoYo-Canvas · 用空间源码包在其它 Muse 部署的提示词

用法：把「YoYo-Canvas-source-clean.zip」作为附件上传到目标 Muse 的对话，然后把下面这段提示词整段发给它。

---

我随附的 zip 是一个现成全栈空间「YoYo画布」的完整源码包（干净版，不含任何项目数据），请你在这边把它部署成一个新的空间：创建时 slug 定为 `yoyo-canvas`、显示名定为 `YoYo-Canvas`，不要从零重写、不要换设计、不要删功能。包的结构是：

- client/ 前端源码，server/ 服务端动作源码，drizzle/ 数据库迁移（0001–0014）
- app.db 是空数据库：表结构与迁移记录已就绪，全部业务表 0 行（projects 0、canvas_nodes 0、canvas_edges 0、assets 0、prompts 0、generation_records 0），部署后从新建的第一个项目开始用
- blobs/ 是应用内部的媒体 blob 存储目录，本包为空（仅占位），没有历史媒体文件
- package.json / bun.lock / bunfig.toml / tsconfig.base.json 是工程配置；space.json 里已写好新身份（slug `yoyo-canvas`、name `YoYo-Canvas`），创建空间时照此定
- DATA-PLAN.md 是这个空间的数据方案说明，ENGINEERING.md 是工程规范总纲（动手改代码前先读它的「开工速查」），FILE-ORGANIZATION.md 是文件组织约定，AGENTS.md 是原空间目录内的建造约定，icon.webp 是空间图标，README.md 是项目说明，Deploy-YoYo-Canvas.md 就是本文件
- 包里没有 node_modules，按 bun.lock 用 bun install 还原依赖即可；也没有 client/server 的 dist 构建产物，构建时生成

部署步骤：

1. 新建一个全栈空间，slug 定为 `yoyo-canvas`、显示名定为 `YoYo-Canvas`，把 client/ 与 server/ 的源码逐文件作为新空间的实现来源落进去（你的建造通道怎么落文件按你的规矩办，但内容以包内源码为准，包括里面已经修好的全部行为，不要按你自己的习惯改写）；drizzle/ 的迁移照原样执行，表结构不要改名改字段。
2. 数据库直接用包里的 app.db 作初始库（也可以按 drizzle/ 迁移从零建库，结果一致）；落库后核对一遍：各业务表 0 行、表结构完整，对不上先停下来报告我，不要自己改表。
3. 生成通道不要接外部 API Key、不要用 Cookie 或 muse2api，图/视频/音频生成一律走你自己的生成能力，照 server/ 里动作的既定契约接（动作签名、落盘规则、尺寸口径以源码和 ENGINEERING.md / DATA-PLAN.md 为准：图片八档比例各有确切像素、genSize 只记实测像素；比例属于 {16:9, 9:16, 1:1} 且无参考媒体时走直出同步出图，其它情况走任务通道；生成队列每轮最多 3 个并行，不要改成严格串行）。
4. 空间之外的配套基建要在你这边重新建（这些不在源码包里）：
   - 项目目录 ~/workspace/yoyo-canvas-projects/<项目名>-<项目id前8位>/，由空间动作 ensureProjectWorkspace 维护，生成成品与资产文件落在这里；
   - 一个每分钟的定时任务，调用空间的 processQueue 动作处理生成队列（认领排队任务、派发生成、做落地修复与回填）。
5. 页面内 logo 用原空间同款图片，我会另行发你（310×310 PNG）；部署时先留占位、不要自己画一个。

部署完逐项实测再报我，探针验不了的真机手势（拖拽、右键、Ctrl+框选、冷启动滚轮、iPad 触摸与键盘）要明说未验、不许报全绿。验收清单：新建一个项目，直接可用；底部工具条添加一个节点，落在画布正中、刷新后还在（新 ID 生成必须带降级，目标 WebView 可能没有 crypto.randomUUID；新节点必须单行立即落库，不要只靠整图保存）；在项目里生成一张图，成品原地落在发起生成的节点上；生成队列抽屉里能看到「队列 / 记录」两个页签，停止和取消操作可用，删掉已生成节点后记录页签里的历史仍在。建造与验收测试只许在你新建的测试项目里做。
