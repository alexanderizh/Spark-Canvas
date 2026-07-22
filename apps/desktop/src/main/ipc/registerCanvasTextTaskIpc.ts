import {
  CanvasTextProviderError,
  CanvasTextTimeoutError,
  generateCanvasText,
  resolveCanvasTextRequestTimeoutMs,
  resolveProviderApiKeyForProfile,
  type SDKInvocationSnapshot,
  type SessionService,
} from '@spark/agent-runtime'
import type {
  CanvasTextTaskCreateResponse,
  ProviderProfile,
  SessionAgentAdapter,
  SessionPermissionMode,
} from '@spark/protocol'
import {
  buildCanvasRuntimeRequest,
  buildCanvasSystemPrompt,
  resolveCanvasAgentTurnResult,
} from './canvas-prompt-runtime.js'
import {
  buildCanvasTextRawResponse,
  resolveCanvasTextTokenBudget,
} from './canvasTextTaskDiagnostics.js'
import {
  CanvasTextAdaptiveGenerationError,
  generateCanvasTextWithAdaptiveOutput,
  type CanvasTextOutputLimitRetryDiagnostics,
} from './canvasTextAdaptiveGeneration.js'
import {
  type CanvasTextOutputCapabilityCache,
  type CanvasTextOutputCapabilityKey,
} from './canvasTextOutputCapability.js'
import {
  buildCanvasTextOutputBudgetInstruction,
  resolveCanvasTextExecutionAdapter,
  resolveCanvasTextModel,
} from './canvasTextTaskRuntime.js'
import {
  buildCanvasSessionRuntimeRequestCall,
  CanvasSessionRuntimeInvocationError,
} from './canvasTextTaskRequestCall.js'
import { createCanvasTaskLifecycleLog, canvasTaskLogger } from './canvas-task-lifecycle-log.js'
import { typedIpcHandle } from './typed-ipc.js'

type CanvasTextAgent = {
  id: string
  name: string
  prompt?: string | null
  providerProfileId?: string | null
  modelId?: string | null
  reasoningEffort?: string | null
  agentAdapter?: string | null
}

export interface RegisterCanvasTextTaskIpcDependencies {
  listProviders(): Promise<ProviderProfile[]>
  resolveAgent(agentId: string | null | undefined): CanvasTextAgent | null
  buildSkillSystemPrompt(skillId: string): string | null
  getSessionService(): SessionService
  ensureNoProjectDirectoryExists(): Promise<void>
  authorizeProject(
    sender: unknown,
    projectId: string | undefined,
  ): Promise<{ projectId: string; workspaceId: string }>
  decodeSafeFileUrl(url: string | undefined): string | null
  resolveReadableFile(sender: unknown, filePath: string): string
  outputCapabilityCache: CanvasTextOutputCapabilityCache
}

export function registerCanvasTextTaskIpc(
  dependencies: RegisterCanvasTextTaskIpcDependencies,
): void {
  typedIpcHandle('canvas:task:generate-text', async (req, event) => {
    const projectContext = await dependencies.authorizeProject(event.sender, req.projectId)
    const taskLog = createCanvasTaskLifecycleLog({
      kind: 'text',
      projectId: req.projectId,
      clientTaskId: req.clientTaskId,
      operation: req.operation,
      providerProfileId: req.providerProfileId,
      modelId: req.modelId,
      background: req.waitForCompletion === false,
      inputCount: req.inputFiles?.length ?? 0,
    })
    taskLog.started()

    const fail = (
      code: string,
      message: string,
      extra: Partial<Omit<CanvasTextTaskCreateResponse, 'status' | 'text' | 'error'>> = {},
    ): CanvasTextTaskCreateResponse => ({
      status: 'failed',
      providerProfileId: extra.providerProfileId ?? '',
      provider: extra.provider ?? '',
      model: extra.model ?? '',
      text: '',
      ...(extra.rawResponse !== undefined ? { rawResponse: extra.rawResponse } : {}),
      ...(extra.requestCall !== undefined ? { requestCall: extra.requestCall } : {}),
      error: { code, message },
    })

    const runWithCanvasAgentRuntime = async (
      profile: ProviderProfile,
      agent: CanvasTextAgent | null,
      runtimeRequest: ReturnType<typeof buildCanvasRuntimeRequest>,
      adapter: SessionAgentAdapter,
      model: string,
      tokenBudget: ReturnType<typeof resolveCanvasTextTokenBudget>,
      requestTimeoutMs: number,
    ): Promise<CanvasTextTaskCreateResponse> => {
      const permissionMode: SessionPermissionMode =
        adapter === 'codex' ? 'codex-auto-review' : 'claude-auto'
      const selectedSkillIds = normalizedSkillIds(req.skillIds)
      const skillPrompts = selectedSkillIds
        .map((skillId) => dependencies.buildSkillSystemPrompt(skillId))
        .filter(
          (prompt): prompt is string => typeof prompt === 'string' && prompt.trim().length > 0,
        )
      const responseFormat = readResponseFormat(req.modelParams)
      const jsonConstraint =
        responseFormat.toLowerCase() === 'json'
          ? '\n\n输出格式硬约束：这是纯文本结构化转换，不要调用工具、不要读写文件；只返回合法 JSON，不要 Markdown，不要代码块，不要额外解释。'
          : ''
      const outputBudgetInstruction = buildCanvasTextOutputBudgetInstruction(
        req.taskPipelineRole,
        tokenBudget.maxTokens,
      )
      const agentPrompt =
        agent?.prompt?.trim() || '你是影视创作助手。严格遵循用户指令，直接输出结果，不要解释过程。'
      const system = buildCanvasSystemPrompt({
        capabilityPrompt: [runtimeRequest.system, jsonConstraint, outputBudgetInstruction]
          .filter(Boolean)
          .join('\n\n'),
        agentPrompt,
        skillPrompts,
        ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
      })
      const message = [system ? `[画布任务约束]\n${system}` : '', runtimeRequest.prompt]
        .filter((part) => part.trim().length > 0)
        .join('\n\n')
      if (!message) throw new Error('画布文本任务提示词为空')

      // The temporary session must stay on the Canvas Assistant allowlist even when
      // provider/model overrides differ from the assistant's persisted defaults.
      const sessionAgentId = agent?.id
      const attachments = (req.inputFiles ?? []).flatMap((file) => {
        if (file.type !== 'image') return []
        const candidate = file.path?.trim() || dependencies.decodeSafeFileUrl(file.url)
        if (!candidate) return []
        return [
          {
            type: 'image' as const,
            path: dependencies.resolveReadableFile(event.sender, candidate),
          },
        ]
      })
      const effectiveReasoningEffort = resolveReasoningEffort(
        req.reasoningEffort,
        req.modelParams,
        agent?.reasoningEffort,
      )
      const createSessionInvocation = {
        title: `[画布文本] ${req.operation}`,
        providerProfileId: profile.id,
        projectId: projectContext.projectId,
        workspaceId: projectContext.workspaceId,
        ...(sessionAgentId ? { agentId: sessionAgentId } : {}),
        modelId: model,
        agentAdapter: adapter,
        permissionMode,
        chatMode: 'agent' as const,
        surface: 'canvas' as const,
      }
      const sendTurnInvocation = {
        message,
        providerProfileId: profile.id,
        modelId: model,
        ...(selectedSkillIds[0] ? { skillId: selectedSkillIds[0] } : {}),
        ...(sessionAgentId ? { agentId: sessionAgentId } : {}),
        agentAdapter: adapter,
        permissionMode,
        ...(effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      }
      let requestCall = buildCanvasSessionRuntimeRequestCall({
        profile,
        adapter,
        model,
        invocation: {
          captureStatus: 'session-dispatch',
          createSession: createSessionInvocation,
          sendTurn: sendTurnInvocation,
        },
      })
      let sessionId: string | undefined
      let turnId: string | undefined
      let terminal = false
      try {
        await dependencies.ensureNoProjectDirectoryExists()
        const sessionService = dependencies.getSessionService()
        const created = await sessionService.createSession(createSessionInvocation)
        sessionId = created.sessionId
        const sendTurnRequest = {
          sessionId,
          ...sendTurnInvocation,
          invocationObserver: (snapshot: SDKInvocationSnapshot) => {
            requestCall = buildCanvasSessionRuntimeRequestCall({
              profile,
              adapter,
              model,
              invocation: {
                captureStatus: 'executor-final',
                transport: snapshot.transport,
                sdkOrCliRequest: snapshot.request,
              },
            })
          },
        }
        requestCall = buildCanvasSessionRuntimeRequestCall({
          profile,
          adapter,
          model,
          invocation: {
            captureStatus: 'session-dispatch',
            createSession: createSessionInvocation,
            sendTurn: { sessionId, ...sendTurnInvocation },
            timeoutMs: requestTimeoutMs,
          },
        })
        const turn = await sessionService.sendTurn(sendTurnRequest)
        turnId = turn.turnId
        const deadline = Date.now() + requestTimeoutMs
        let finalText: string | undefined
        while (Date.now() < deadline) {
          const history = await sessionService.getHistory({ sessionId, full: true })
          const events = history.events.filter(
            (historyEvent) => historyEvent.turnId === turn.turnId,
          )
          const result = resolveCanvasAgentTurnResult(events)
          if (result.terminal) terminal = true
          if (result.error) throw new Error(result.error)
          if (result.text) finalText = result.text
          if (terminal) break
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (!terminal) throw new CanvasTextTimeoutError(requestTimeoutMs)
        if (finalText == null) throw new Error('本地 Agent 未返回文本结果')
        return {
          status: 'succeeded',
          providerProfileId: profile.id,
          provider: profile.provider,
          model,
          text: finalText,
          requestCall,
          rawResponse: {
            providerProfileId: profile.id,
            provider: profile.provider,
            providerName: profile.name,
            model,
            executionPath: 'session-runtime',
            adapter,
            desiredMaxTokens: tokenBudget.desiredMaxTokens,
            maxTokens: tokenBudget.maxTokens,
            maxTokensSource: tokenBudget.source,
            remainingContextTokens: tokenBudget.remainingContextTokens,
            contextSafetyTokens: tokenBudget.contextSafetyTokens,
            requestTimeoutMs,
            agentId: agent?.id ?? null,
            skillIds: selectedSkillIds,
            relationManifest: runtimeRequest.relationManifest,
            modelCallUrl: requestCall.url,
          },
        }
      } catch (error) {
        throw new CanvasSessionRuntimeInvocationError(error, requestCall)
      } finally {
        if (sessionId != null) {
          const sessionService = dependencies.getSessionService()
          if (!terminal && turnId != null) {
            await sessionService.cancelSessionExecution(sessionId).catch(() => undefined)
          }
          await sessionService.deleteSession(sessionId).catch(() => undefined)
        }
      }
    }

    const runTextGeneration = async (): Promise<CanvasTextTaskCreateResponse> => {
      const profiles = await dependencies.listProviders()
      const isTextProvider = (profile: ProviderProfile) =>
        profile.modelType === undefined ||
        profile.modelType === 'text' ||
        profile.modelType === 'multimodal'
      const agent = dependencies.resolveAgent(req.agentId)
      const agentPersona = agent?.prompt?.trim() || ''
      const requestedModelId = req.modelId?.trim() || null
      const modelOwner = requestedModelId
        ? profiles.find(
            (profile) =>
              isTextProvider(profile) &&
              (profile.defaultModel === requestedModelId ||
                profile.modelIds.includes(requestedModelId)),
          )
        : null
      const requestedProvider = req.providerProfileId
        ? profiles.find((profile) => profile.id === req.providerProfileId)
        : null
      const requestedProviderSupportsModel =
        requestedModelId == null ||
        (req.providerProfileId == null
          ? true
          : requestedProvider != null &&
            (requestedProvider.defaultModel === requestedModelId ||
              requestedProvider.modelIds.includes(requestedModelId)))
      const preferredProviderId =
        modelOwner != null && !requestedProviderSupportsModel
          ? modelOwner.id
          : (req.providerProfileId ??
            modelOwner?.id ??
            (agent?.providerProfileId ? agent.providerProfileId : null))
      const ordered = preferredProviderId
        ? profiles.filter((profile) => profile.id === preferredProviderId)
        : [...profiles].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      const runtimeRequest = buildCanvasRuntimeRequest(req)
      const requestedMaxTokens = readRequestedMaxTokens(req.modelParams)
      const requestTimeoutMs = resolveCanvasTextRequestTimeoutMs()
      const candidate = ordered.find((profile) => isTextProvider(profile))
      const executionAdapter =
        candidate != null ? resolveCanvasTextExecutionAdapter(candidate, agent) : null

      if (candidate != null && executionAdapter != null) {
        const model = resolveCanvasTextModel(req.modelId, agent?.modelId, candidate.defaultModel)
        const tokenBudget = resolveCanvasTextTokenBudget({
          operation: req.operation,
          modelId: model,
          requestedMaxTokens,
          providerMaxTokens: candidate.maxTokens,
          providerContextWindow: candidate.contextWindow,
          providerSupportsMillionContext: candidate.supportsMillionContext,
          taskPipelineRole: req.taskPipelineRole,
          prompt: runtimeRequest.prompt,
          systemPrompt: [
            agent?.prompt,
            runtimeRequest.system,
            ...(req.skillIds ?? []).map((skillId) => dependencies.buildSkillSystemPrompt(skillId)),
            req.negativePrompt,
          ]
            .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
            .join('\n\n'),
        })
        canvasTaskLogger.info(
          `canvas:task:generate-text budget projectId=${req.projectId ?? '(n/a)'} clientTaskId=${req.clientTaskId ?? '(n/a)'} model=${model} maxTokens=${tokenBudget.maxTokens} source=${tokenBudget.source} executionPath=session-runtime adapter=${executionAdapter}`,
        )
        const requestStartedAt = taskLog.textCallRequest({
          model,
          apiKind: executionAdapter,
          executionPath: 'session-runtime',
          adapter: executionAdapter,
          systemPromptChars: runtimeRequest.system.length,
          userPromptChars: runtimeRequest.prompt.length,
          maxTokens: tokenBudget.maxTokens,
          maxTokensSource: tokenBudget.source,
          attachmentCount: runtimeRequest.images.length,
        })
        try {
          const response = await runWithCanvasAgentRuntime(
            candidate,
            agent,
            runtimeRequest,
            executionAdapter,
            model,
            tokenBudget,
            requestTimeoutMs,
          )
          taskLog.textCallResponse({ textChars: response.text.length }, requestStartedAt)
          return response
        } catch (error) {
          const runtimeError =
            error instanceof CanvasSessionRuntimeInvocationError ? error.cause : error
          const message =
            runtimeError instanceof Error ? runtimeError.message : String(runtimeError)
          return fail(
            runtimeError instanceof CanvasTextTimeoutError
              ? runtimeError.code
              : 'text_generation_failed',
            message,
            {
              providerProfileId: candidate.id,
              provider: candidate.provider,
              model,
              ...(error instanceof CanvasSessionRuntimeInvocationError
                ? { requestCall: error.requestCall }
                : {}),
              rawResponse: {
                providerProfileId: candidate.id,
                provider: candidate.provider,
                providerName: candidate.name,
                model,
                executionPath: 'session-runtime',
                adapter: executionAdapter,
                desiredMaxTokens: tokenBudget.desiredMaxTokens,
                maxTokens: tokenBudget.maxTokens,
                maxTokensSource: tokenBudget.source,
                remainingContextTokens: tokenBudget.remainingContextTokens,
                contextSafetyTokens: tokenBudget.contextSafetyTokens,
                requestTimeoutMs,
                ...(error instanceof CanvasSessionRuntimeInvocationError
                  ? { modelCallUrl: error.requestCall.url }
                  : {}),
              },
            },
          )
        }
      }

      let chosen: { profile: ProviderProfile; apiKey: string } | null = null
      for (const profile of ordered) {
        if (preferredProviderId == null && !isTextProvider(profile)) continue
        if (!profile.keystoreRef) continue
        try {
          const apiKey = await resolveProviderApiKeyForProfile(profile)
          if (apiKey?.trim()) {
            chosen = { profile, apiKey }
            break
          }
        } catch {
          // Skip credentials that cannot be resolved.
        }
      }
      if (!chosen) {
        return fail(
          'provider_not_configured',
          '未找到可用的文本模型 Provider（需要已配置 API Key 的文本/通用模型）',
        )
      }

      const model = resolveCanvasTextModel(req.modelId, agent?.modelId, chosen.profile.defaultModel)
      const baseSystem =
        agentPersona || '你是影视创作助手。严格遵循用户指令，直接输出结果，不要解释过程。'
      const selectedSkillIds = normalizedSkillIds(req.skillIds)
      const skillPrompts = selectedSkillIds
        .map((skillId) => dependencies.buildSkillSystemPrompt(skillId))
        .filter(
          (prompt): prompt is string => typeof prompt === 'string' && prompt.trim().length > 0,
        )
      const responseFormat = readResponseFormat(req.modelParams)
      const jsonConstraint =
        responseFormat.toLowerCase() === 'json'
          ? '\n\n输出格式硬约束：只返回合法 JSON，不要 Markdown，不要代码块，不要额外解释。'
          : ''
      const temperature =
        typeof req.modelParams?.temperature === 'number' ? req.modelParams.temperature : undefined
      const apiKind = chosen.profile.codexApiKind === 'responses' ? 'responses' : 'chat'
      const capabilityKey: CanvasTextOutputCapabilityKey = {
        providerProfileId: chosen.profile.id,
        ...(chosen.profile.apiEndpoint ? { endpoint: chosen.profile.apiEndpoint } : {}),
        model,
        apiKind,
      }
      const learnedMaxTokens = dependencies.outputCapabilityCache.get(capabilityKey)
      const tokenBudget = resolveCanvasTextTokenBudget({
        operation: req.operation,
        modelId: model,
        requestedMaxTokens,
        providerMaxTokens: chosen.profile.maxTokens,
        learnedMaxTokens,
        providerContextWindow: chosen.profile.contextWindow,
        providerSupportsMillionContext: chosen.profile.supportsMillionContext,
        taskPipelineRole: req.taskPipelineRole,
        prompt: runtimeRequest.prompt,
        systemPrompt: [baseSystem, runtimeRequest.system, ...skillPrompts]
          .filter(Boolean)
          .join('\n\n'),
      })
      const outputBudgetInstruction = buildCanvasTextOutputBudgetInstruction(
        req.taskPipelineRole,
        tokenBudget.maxTokens,
      )
      const system = buildCanvasSystemPrompt({
        capabilityPrompt: [req.systemPrompt, jsonConstraint, outputBudgetInstruction]
          .filter(Boolean)
          .join('\n\n'),
        agentPrompt: baseSystem,
        skillPrompts,
        ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
      })
      const reasoningEffort = resolveReasoningEffort(
        req.reasoningEffort,
        req.modelParams,
        agent?.reasoningEffort,
      )
      const disableThinking =
        req.taskPipelineRole === 'shot' || responseFormat.toLowerCase() === 'json'
      let result: Awaited<ReturnType<typeof generateCanvasText>>
      let learnedOutputCap = learnedMaxTokens
      let retryDiagnostics: CanvasTextOutputLimitRetryDiagnostics = {
        retryCount: 0,
        attempts: [tokenBudget.maxTokens],
      }
      const requestStartedAt = taskLog.textCallRequest({
        model,
        apiKind,
        executionPath: 'http',
        systemPromptChars: system.length,
        userPromptChars: runtimeRequest.prompt.length,
        maxTokens: tokenBudget.maxTokens,
        maxTokensSource: tokenBudget.source,
        ...(temperature != null ? { temperature } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(responseFormat ? { responseFormat } : {}),
        attachmentCount: runtimeRequest.images.length,
      })
      try {
        const adaptiveResult = await generateCanvasTextWithAdaptiveOutput({
          initialMaxTokens: tokenBudget.maxTokens,
          generate: (attemptMaxTokens) =>
            generateCanvasText({
              providerType: chosen.profile.provider,
              apiKind,
              apiKey: chosen.apiKey,
              ...(chosen.profile.apiEndpoint ? { apiEndpoint: chosen.profile.apiEndpoint } : {}),
              model,
              system,
              prompt: runtimeRequest.prompt,
              ...(runtimeRequest.images.length > 0 ? { images: runtimeRequest.images } : {}),
              ...(temperature != null ? { temperature } : {}),
              maxTokens: attemptMaxTokens,
              ...(reasoningEffort != null ? { reasoningEffort } : {}),
              ...(disableThinking ? { disableThinking: true } : {}),
              ...(responseFormat.toLowerCase() === 'json'
                ? { responseFormat: 'json' as const }
                : {}),
              timeoutMs: requestTimeoutMs,
            }),
          onLearnedSafeMaxTokens: (value, source) => {
            dependencies.outputCapabilityCache.record(capabilityKey, value, source)
            learnedOutputCap = learnedOutputCap == null ? value : Math.min(learnedOutputCap, value)
          },
        })
        result = adaptiveResult.value
        retryDiagnostics = adaptiveResult.retryDiagnostics
        taskLog.textCallResponse(
          {
            textChars: result.text.length,
            ...(result.finishReason ? { finishReason: result.finishReason } : {}),
            ...(result.usage ? { usage: result.usage } : {}),
            ...(result.reasoningContentChars != null
              ? { reasoningContentChars: result.reasoningContentChars }
              : {}),
          },
          requestStartedAt,
        )
      } catch (error) {
        const adaptiveError = error instanceof CanvasTextAdaptiveGenerationError ? error : null
        const providerError = adaptiveError?.cause ?? error
        if (adaptiveError != null) retryDiagnostics = adaptiveError.retryDiagnostics
        const requestCall =
          providerError instanceof CanvasTextProviderError ||
          providerError instanceof CanvasTextTimeoutError
            ? providerError.requestCall
            : undefined
        const rawResponse = buildCanvasTextRawResponse({
          providerProfileId: chosen.profile.id,
          provider: chosen.profile.provider,
          providerName: chosen.profile.name,
          model,
          apiKind,
          agentId: agent?.id ?? null,
          agentName: agent?.name ?? null,
          skillIds: selectedSkillIds,
          relationManifest: runtimeRequest.relationManifest,
          taskPipelineRole: req.taskPipelineRole,
          desiredMaxTokens: tokenBudget.desiredMaxTokens,
          effectiveMaxTokens: retryDiagnostics.attempts.at(-1) ?? tokenBudget.maxTokens,
          maxTokensSource: tokenBudget.source,
          promptTokensEstimate: tokenBudget.promptTokensEstimate,
          providerMaxTokens: tokenBudget.providerMaxTokens,
          learnedMaxTokens: tokenBudget.learnedMaxTokens,
          providerContextWindow: tokenBudget.providerContextWindow,
          contextWindow: tokenBudget.contextWindow,
          remainingContextTokens: tokenBudget.remainingContextTokens,
          contextSafetyTokens: tokenBudget.contextSafetyTokens,
          learnedOutputCap,
          outputLimitRetryCount: retryDiagnostics.retryCount,
          outputLimitAttempts: retryDiagnostics.attempts,
          outputLimitEvidence: retryDiagnostics.evidence,
          requestTimeoutMs,
          ...(providerError instanceof CanvasTextProviderError
            ? { statusCode: providerError.statusCode, errorBody: providerError.responseBody }
            : {}),
        })
        return fail(
          providerError instanceof CanvasTextProviderError ||
            providerError instanceof CanvasTextTimeoutError
            ? providerError.code
            : 'text_generation_failed',
          providerError instanceof Error ? providerError.message : String(providerError),
          {
            providerProfileId: chosen.profile.id,
            provider: chosen.profile.provider,
            model,
            ...(requestCall !== undefined ? { requestCall } : {}),
            rawResponse,
          },
        )
      }

      return {
        status: 'succeeded',
        providerProfileId: chosen.profile.id,
        provider: chosen.profile.provider,
        model,
        text: result.text,
        ...(result.requestCall !== undefined ? { requestCall: result.requestCall } : {}),
        rawResponse: buildCanvasTextRawResponse({
          providerProfileId: chosen.profile.id,
          provider: chosen.profile.provider,
          providerName: chosen.profile.name,
          model,
          apiKind,
          agentId: agent?.id ?? null,
          agentName: agent?.name ?? null,
          skillIds: selectedSkillIds,
          relationManifest: runtimeRequest.relationManifest,
          taskPipelineRole: req.taskPipelineRole,
          outputText: result.text,
          desiredMaxTokens: tokenBudget.desiredMaxTokens,
          effectiveMaxTokens: retryDiagnostics.attempts.at(-1) ?? tokenBudget.maxTokens,
          maxTokensSource: tokenBudget.source,
          promptTokensEstimate: tokenBudget.promptTokensEstimate,
          providerMaxTokens: tokenBudget.providerMaxTokens,
          learnedMaxTokens: tokenBudget.learnedMaxTokens,
          providerContextWindow: tokenBudget.providerContextWindow,
          contextWindow: tokenBudget.contextWindow,
          remainingContextTokens: tokenBudget.remainingContextTokens,
          contextSafetyTokens: tokenBudget.contextSafetyTokens,
          learnedOutputCap,
          outputLimitRetryCount: retryDiagnostics.retryCount,
          outputLimitAttempts: retryDiagnostics.attempts,
          outputLimitEvidence: retryDiagnostics.evidence,
          requestTimeoutMs,
          providerFinishReason: result.finishReason,
          usage: result.usage,
          reasoningContentChars: result.reasoningContentChars,
        }),
      }
    }

    if (req.waitForCompletion === false) {
      void runTextGeneration()
        .catch((error) =>
          fail('text_generation_failed', error instanceof Error ? error.message : String(error)),
        )
        .then((response) => {
          taskLog.settled({
            status: response.status,
            provider: response.provider,
            model: response.model,
            outputChars: response.text.length,
            error: response.error,
          })
          if (!event.sender.isDestroyed()) {
            event.sender.send('stream:canvas:text-task', {
              projectId: projectContext.projectId,
              ...(req.clientTaskId !== undefined ? { clientTaskId: req.clientTaskId } : {}),
              status: response.status === 'succeeded' ? 'succeeded' : 'failed',
              response,
            })
          }
        })
      return {
        status: 'running',
        providerProfileId: '',
        provider: '',
        model: '',
        text: '',
      }
    }

    try {
      const response = await runTextGeneration()
      taskLog.settled({
        status: response.status,
        provider: response.provider,
        model: response.model,
        outputChars: response.text.length,
        error: response.error,
      })
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      taskLog.failed({ code: 'text_generation_failed', message })
      return fail('text_generation_failed', message)
    }
  })
}

function readRequestedMaxTokens(modelParams: Record<string, unknown> | null | undefined) {
  return typeof modelParams?.maxTokens === 'number'
    ? modelParams.maxTokens
    : typeof modelParams?.max_tokens === 'number'
      ? modelParams.max_tokens
      : undefined
}

function readResponseFormat(modelParams: Record<string, unknown> | null | undefined): string {
  return typeof modelParams?.responseFormat === 'string'
    ? modelParams.responseFormat
    : typeof modelParams?.response_format === 'string'
      ? modelParams.response_format
      : ''
}

function normalizedSkillIds(value: string[] | null | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
}

function resolveReasoningEffort(
  requestValue: string | null | undefined,
  modelParams: Record<string, unknown> | null | undefined,
  agentValue: string | null | undefined,
) {
  const raw =
    requestValue ??
    (typeof modelParams?.reasoningEffort === 'string'
      ? modelParams.reasoningEffort
      : typeof modelParams?.reasoning_effort === 'string'
        ? modelParams.reasoning_effort
        : agentValue)
  return raw != null && isProtocolReasoning(raw) ? raw : undefined
}

function isProtocolReasoning(
  value: string,
): value is 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  return (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  )
}
