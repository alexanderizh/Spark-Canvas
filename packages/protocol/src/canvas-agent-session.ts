import { z } from 'zod'

import type {
  CommandExecuteResponse,
  ManagedAgent,
  SessionAnswerQuestionResponse,
  SessionAttachment,
  SessionCancelResponse,
  SessionCreateResponse,
  SessionGetHistoryResponse,
  SessionListResponse,
  SessionSubmitTurnResponse,
  SessionUpdateResponse,
  SkillItem,
} from './ipc/index.js'

const CanvasAgentSessionIdSchema = z.string().uuid()
const CanvasAgentAdapterSchema = z.enum(['claude-sdk', 'codex'])
const CanvasAgentSkillIdSchema = z.enum([
  'builtin:canvas-studio',
  'builtin:multimedia-use',
  'builtin:video-workflow',
])
const CanvasAgentSkillIdsSchema = z.array(CanvasAgentSkillIdSchema).max(3).optional()
const CanvasAgentAttachmentsSchema = z
  .array(
    z
      .object({
        type: z.enum(['image', 'file', 'directory']),
        path: z.string().min(1).max(4_000),
      })
      .strict(),
  )
  .max(20)
  .optional()

export const CanvasAgentConfigurationRequestSchema = z.object({}).strict()
export const CanvasAgentSessionCreateRequestSchema = z
  .object({
    providerProfileId: z.string().min(1).max(200),
    modelId: z.string().min(1).max(200).optional(),
    agentAdapter: CanvasAgentAdapterSchema.optional(),
    skillIds: CanvasAgentSkillIdsSchema,
  })
  .strict()
export const CanvasAgentSessionListRequestSchema = z
  .object({
    includeArchived: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict()
export const CanvasAgentSessionUpdateRequestSchema = z
  .object({
    sessionId: CanvasAgentSessionIdSchema,
    providerProfileId: z.string().min(1).max(200).optional(),
    modelId: z.string().min(1).max(200).nullable().optional(),
    agentAdapter: CanvasAgentAdapterSchema.optional(),
    skillIds: CanvasAgentSkillIdsSchema,
  })
  .strict()
export const CanvasAgentSessionSubmitTurnRequestSchema = z
  .object({
    sessionId: CanvasAgentSessionIdSchema,
    message: z.string().min(1).max(100_000),
    providerProfileId: z.string().min(1).max(200).optional(),
    modelId: z.string().min(1).max(200).nullable().optional(),
    agentAdapter: CanvasAgentAdapterSchema.optional(),
    attachments: CanvasAgentAttachmentsSchema,
  })
  .strict()
export const CanvasAgentSessionGetHistoryRequestSchema = z
  .object({
    sessionId: CanvasAgentSessionIdSchema,
    full: z.boolean().optional(),
    limit: z.number().int().min(1).max(1_000).optional(),
    turnLimit: z.number().int().min(1).max(500).optional(),
    eventLimit: z.number().int().min(100).max(10_000).optional(),
    beforeSeq: z.number().int().nonnegative().optional(),
  })
  .strict()
export const CanvasAgentSessionCancelRequestSchema = z
  .object({
    sessionId: CanvasAgentSessionIdSchema,
  })
  .strict()
export const CanvasAgentSessionExecuteCommandRequestSchema = z
  .object({
    sessionId: CanvasAgentSessionIdSchema,
    message: z.string().min(1).max(100_000),
  })
  .strict()
export const CanvasAgentSessionAnswerQuestionRequestSchema = z
  .object({
    sessionId: CanvasAgentSessionIdSchema,
    questionId: z.string().min(1).max(500),
    answers: z.record(z.string(), z.unknown()),
  })
  .strict()

export type CanvasAgentConfigurationRequest = z.infer<
  typeof CanvasAgentConfigurationRequestSchema
>
export interface CanvasAgentConfigurationResponse {
  agents: ManagedAgent[]
  skills: SkillItem[]
}
export type CanvasAgentSessionCreateRequest = z.infer<
  typeof CanvasAgentSessionCreateRequestSchema
>
export type CanvasAgentSessionListRequest = z.infer<typeof CanvasAgentSessionListRequestSchema>
export type CanvasAgentSessionUpdateRequest = z.infer<typeof CanvasAgentSessionUpdateRequestSchema>
export type CanvasAgentSessionSubmitTurnRequest = z.infer<
  typeof CanvasAgentSessionSubmitTurnRequestSchema
> & { attachments?: SessionAttachment[] }
export type CanvasAgentSessionGetHistoryRequest = z.infer<
  typeof CanvasAgentSessionGetHistoryRequestSchema
>
export type CanvasAgentSessionCancelRequest = z.infer<typeof CanvasAgentSessionCancelRequestSchema>
export type CanvasAgentSessionExecuteCommandRequest = z.infer<
  typeof CanvasAgentSessionExecuteCommandRequestSchema
>
export type CanvasAgentSessionAnswerQuestionRequest = z.infer<
  typeof CanvasAgentSessionAnswerQuestionRequestSchema
>

declare module './ipc/index.js' {
  interface IpcChannelMap {
    'canvas:agent:configuration': [
      CanvasAgentConfigurationRequest,
      CanvasAgentConfigurationResponse,
    ]
    'canvas:agent:session:create': [CanvasAgentSessionCreateRequest, SessionCreateResponse]
    'canvas:agent:session:list': [CanvasAgentSessionListRequest, SessionListResponse]
    'canvas:agent:session:update': [CanvasAgentSessionUpdateRequest, SessionUpdateResponse]
    'canvas:agent:session:submit-turn': [
      CanvasAgentSessionSubmitTurnRequest,
      SessionSubmitTurnResponse,
    ]
    'canvas:agent:session:get-history': [
      CanvasAgentSessionGetHistoryRequest,
      SessionGetHistoryResponse,
    ]
    'canvas:agent:session:cancel': [CanvasAgentSessionCancelRequest, SessionCancelResponse]
    'canvas:agent:session:execute-command': [
      CanvasAgentSessionExecuteCommandRequest,
      CommandExecuteResponse,
    ]
    'canvas:agent:session:answer-question': [
      CanvasAgentSessionAnswerQuestionRequest,
      SessionAnswerQuestionResponse,
    ]
  }
}
