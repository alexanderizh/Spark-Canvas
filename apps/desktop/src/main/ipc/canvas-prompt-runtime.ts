import type { AgentEvent, CanvasMediaTaskInputFile, CanvasPromptTaskFields } from '@spark/protocol'
import { composeCanvasMediaProviderPrompt } from '@spark/protocol'

export type CanvasRuntimeRequest = {
  prompt: string
  system: string
  images: Array<{ url?: string; dataUrl?: string; mimeType?: string }>
  relationManifest: CanvasPromptTaskFields['relationManifest']
}

export type CanvasAgentTurnPollResult = {
  terminal: boolean
  text?: string
  error?: string
}

/** Select the final result for a background SessionService turn. */
export function resolveCanvasAgentTurnResult(events: AgentEvent[]): CanvasAgentTurnPollResult {
  const terminalError = events.find((event) => event.type === 'agent_error')
  const terminalErrorMessage =
    terminalError?.type === 'agent_error' ? terminalError.message : undefined

  const assistantMessages = events.filter(
    (event): event is Extract<AgentEvent, { type: 'assistant_message' }> =>
      event.type === 'assistant_message' &&
      event.mode === 'complete' &&
      event.content.trim().length > 0,
  )
  let finalMessage: Extract<AgentEvent, { type: 'assistant_message' }> | undefined
  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    const candidate = assistantMessages[index]
    if (candidate?.isFinal === true) {
      finalMessage = candidate
      break
    }
  }
  let terminalStatus: Extract<AgentEvent, { type: 'agent_status' }> | undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index]
    if (
      candidate?.type === 'agent_status' &&
      (candidate.status === 'completed' ||
        candidate.status === 'cancelled' ||
        candidate.status === 'error')
    ) {
      terminalStatus = candidate
      break
    }
  }
  if (terminalStatus == null) {
    return {
      terminal: false,
      ...(finalMessage != null ? { text: finalMessage.content } : {}),
      ...(terminalErrorMessage ? { error: terminalErrorMessage } : {}),
    }
  }
  if (terminalStatus.status !== 'completed' || terminalErrorMessage) {
    return {
      terminal: true,
      error:
        terminalErrorMessage ||
        terminalStatus.message ||
        `本地 Agent 状态：${terminalStatus.status}`,
    }
  }
  const fallback = finalMessage ?? assistantMessages.at(-1)
  return {
    terminal: true,
    ...(fallback != null ? { text: fallback.content } : {}),
  }
}

export function buildCanvasSystemPrompt(input: {
  capabilityPrompt?: string
  presetPrompt?: string
  agentPrompt?: string
  skillPrompts?: string[]
  negativePrompt?: string
}): string {
  const sections = [
    input.agentPrompt,
    ...(input.skillPrompts && input.skillPrompts.length > 0
      ? [`[Selected Skills]\n${input.skillPrompts.filter((item) => item.trim()).join('\n\n')}`]
      : []),
    input.presetPrompt,
    // Capability contracts come last so personas and skills cannot replace the output schema.
    input.capabilityPrompt,
    input.negativePrompt?.trim() ? `约束（不可违反）：${input.negativePrompt.trim()}` : undefined,
  ]
  return sections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section))
    .join('\n\n')
}

export function buildCanvasRuntimeRequest(
  input: {
    prompt?: string
    inputFiles?: CanvasMediaTaskInputFile[]
  } & CanvasPromptTaskFields,
): CanvasRuntimeRequest {
  const images = (input.inputFiles ?? [])
    .filter((file) => file.type === 'image')
    .map((file) => ({
      ...(file.url != null ? { url: file.url } : {}),
      ...(file.dataUrl != null ? { dataUrl: file.dataUrl } : {}),
      ...(file.mimeType != null ? { mimeType: file.mimeType } : {}),
    }))
    .filter((image) => image.url != null || image.dataUrl != null)
  return {
    prompt: (input.compiledUserText ?? input.prompt ?? '').trim(),
    system: input.systemPrompt?.trim() ?? '',
    images,
    relationManifest: input.relationManifest ?? [],
  }
}

export function buildCanvasMediaProviderPrompt(input: {
  systemPrompt?: string
  userPrompt: string
}): string {
  return composeCanvasMediaProviderPrompt(input)
}
