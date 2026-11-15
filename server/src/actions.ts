// Actions for YoYo画布 — 纯编排层（批次 S2）：只汇总各域注册对象成
// Actions 注册表，不含任何 handler 业务逻辑。各域实现在
// server/src/actions/ 下：projects / graph / assets / prompts /
// generation / media-edit / package。数据全部在本空间自有
// 表内（projects / canvas_nodes / canvas_edges / assets / prompts），
// 项目工作目录在 ~/workspace/yoyo-canvas-projects 下。

import type { ActionsModule } from "@hatch/space-sdk";
import { AssetsActions } from "./actions/assets";
import { GenerationActions } from "./actions/generation";
import { GenerationRecordsActions } from "./actions/generation-records";
import { GraphActions } from "./actions/graph";
import { MediaEditActions } from "./actions/media-edit";
import { PackageActions } from "./actions/package";
import { ProjectsActions } from "./actions/projects";
import { PromptsActions } from "./actions/prompts";

export const Actions = {
  ...ProjectsActions,
  ...GraphActions,
  ...AssetsActions,
  ...PromptsActions,
  ...GenerationActions,
  ...GenerationRecordsActions,
  ...MediaEditActions,
  ...PackageActions,
} satisfies ActionsModule;
