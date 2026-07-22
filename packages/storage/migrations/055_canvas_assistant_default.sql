-- Migration 055: Make the built-in Canvas Assistant the standalone product default.
-- Existing sessions retain their explicit agent_id. Canvas Assistant sessions created
-- before surface metadata existed are marked as Canvas-owned for list isolation.

UPDATE agents
SET is_default = 1
WHERE id = 'canvas-assistant-agent'
  AND built_in = 1;

UPDATE agents
SET is_default = 0
WHERE id <> 'canvas-assistant-agent'
  AND EXISTS (
    SELECT 1
    FROM agents AS canvas_assistant
    WHERE canvas_assistant.id = 'canvas-assistant-agent'
      AND canvas_assistant.built_in = 1
      AND canvas_assistant.is_default = 1
  );

UPDATE sessions
SET metadata_json = json_set(
  CASE
    WHEN json_valid(COALESCE(NULLIF(metadata_json, ''), '{}'))
      THEN COALESCE(NULLIF(metadata_json, ''), '{}')
    ELSE '{}'
  END,
  '$.surface',
  'canvas'
)
WHERE agent_id = 'canvas-assistant-agent'
  AND json_extract(
    CASE
      WHEN json_valid(COALESCE(NULLIF(metadata_json, ''), '{}'))
        THEN COALESCE(NULLIF(metadata_json, ''), '{}')
      ELSE '{}'
    END,
    '$.surface'
  ) IS NULL;
