-- Migration 054: Isolate the built-in Canvas assistant from platform management.
--
-- Keep platform-manager-agent as the global default for legacy sessions. The Canvas
-- assistant is selected explicitly by the Spark Canvas renderer.

UPDATE agents
SET
  description = 'Spark Canvas 视频画布工作台的内置助手。熟悉画布节点、布局整理、影视流水线和多媒体生成，默认挂载画布工作室、多媒体使用和视频工作流技能。',
  prompt = REPLACE(
    REPLACE(
      prompt,
      '你是 Spark Agent 的「画布助手」',
      '你是 Spark Canvas 的「画布助手」'
    ),
    '- 平台管理：需要查看或配置 Agent、Provider、Skill、MCP、Workflow、Settings 时使用平台管理能力。',
    ''
  ),
  skill_ids_json = '["builtin:canvas-studio","builtin:multimedia-use","builtin:video-workflow"]'
WHERE id = 'canvas-assistant-agent'
  AND built_in = 1;
