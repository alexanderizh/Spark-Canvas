import { useState } from 'react'
import type { CanvasMediaModelSummary, ProviderProfile } from '@spark/protocol'

import { Icons } from '../../Icons'
import { ProviderModelPickerInline } from './CanvasAgentModal'
import { CanvasModelPicker } from './CanvasModelPicker'
import {
  CANVAS_PRESET_TASK_CARDS,
  isImageUnderstandingProvider,
  type CanvasPresetTaskCardDefinition,
} from './canvasPresetCenterModel'
import { type CanvasTaskDefaultKind, type CanvasTaskRuntimeDefault } from './canvasTaskDefaults'
import { mediaModelKey } from './canvasModelPickerModel'

type TaskDefaultsValue = Record<CanvasTaskDefaultKind, CanvasTaskRuntimeDefault>
type OpenPicker = 'text-model' | 'vision-model' | null

export type CanvasPresetTaskCardsProps = {
  value: TaskDefaultsValue
  providers: ProviderProfile[]
  imageModels: CanvasMediaModelSummary[]
  videoModels: CanvasMediaModelSummary[]
  loading: boolean
  onChange: (kind: CanvasTaskDefaultKind, value: CanvasTaskRuntimeDefault) => void
}

export function CanvasPresetTaskCards({
  value,
  providers,
  imageModels,
  videoModels,
  loading,
  onChange,
}: CanvasPresetTaskCardsProps) {
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null)
  const textProviders = providers.filter(
    (provider) => provider.modelType === 'text' || provider.modelType === 'multimodal',
  )
  const visionProviders = providers.filter(isImageUnderstandingProvider)
  const textDefault = value.text

  return (
    <div className="canvas-preset-task-grid">
      {CANVAS_PRESET_TASK_CARDS.map((card) => {
        const runtime = value[card.kind]
        const configured = hasRuntimeSelection(runtime)
        return (
          <section
            key={card.kind}
            className={`canvas-preset-task-card${configured ? ' is-configured' : ''}`}
            data-task-kind={card.kind}
          >
            <header className="canvas-preset-task-card-head">
              <span className="canvas-preset-task-icon">{taskIcon(card)}</span>
              <span className="canvas-preset-task-heading">
                <strong>{card.label}</strong>
                <small>{card.description}</small>
              </span>
              <span className="canvas-preset-task-status">
                {configured ? '已设置' : '使用平台推荐'}
              </span>
            </header>

            {card.kind === 'text' ? (
              <>
                <span className="canvas-preset-task-field-label">默认模型</span>
                <div className="canvas-preset-task-picker">
                  <ProviderModelPickerInline
                    providers={textProviders}
                    selectedProviderId={textDefault.providerProfileId ?? ''}
                    selectedModelId={textDefault.modelId ?? ''}
                    disabled={loading || textProviders.length === 0}
                    open={openPicker === 'text-model'}
                    onOpenChange={(open) => setOpenPicker(open ? 'text-model' : null)}
                    onChange={(providerProfileId, modelId) =>
                      onChange('text', {
                        providerProfileId,
                        modelId,
                        skillIds: [],
                      })
                    }
                  />
                </div>
                <p className="canvas-preset-task-note">设置文本任务默认使用的模型</p>
              </>
            ) : card.kind === 'image_understanding' ? (
              <>
                <span className="canvas-preset-task-field-label">默认模型</span>
                <div className="canvas-preset-task-picker">
                  <ProviderModelPickerInline
                    providers={visionProviders}
                    selectedProviderId={runtime.providerProfileId ?? ''}
                    selectedModelId={runtime.modelId ?? ''}
                    disabled={loading || visionProviders.length === 0}
                    open={openPicker === 'vision-model'}
                    onOpenChange={(open) => setOpenPicker(open ? 'vision-model' : null)}
                    onChange={(providerProfileId, modelId) =>
                      onChange('image_understanding', {
                        providerProfileId,
                        modelId,
                        skillIds: [...runtime.skillIds],
                      })
                    }
                  />
                </div>
                <p className="canvas-preset-task-note">只显示支持图片输入的多模态模型</p>
              </>
            ) : (
              <>
                <span className="canvas-preset-task-field-label">默认模型</span>
                <div className="canvas-preset-task-picker">
                  <CanvasModelPicker
                    models={card.kind === 'image_generation' ? imageModels : videoModels}
                    value={resolveMediaModelValue(
                      card.kind === 'image_generation' ? imageModels : videoModels,
                      runtime,
                    )}
                    loading={loading}
                    disabled={
                      loading ||
                      (card.kind === 'image_generation' ? imageModels : videoModels).length === 0
                    }
                    allowEmpty
                    emptyLabel="自动选择可用模型"
                    onChange={(modelKey) =>
                      onChange(
                        card.kind,
                        runtimeFromMediaModel(
                          card.kind === 'image_generation' ? imageModels : videoModels,
                          modelKey,
                        ),
                      )
                    }
                  />
                </div>
                <p className="canvas-preset-task-note">
                  {card.kind === 'image_generation'
                    ? '尺寸和比例仍可在具体节点里调整'
                    : '时长和画幅仍可在具体节点里调整'}
                </p>
              </>
            )}
            {configured ? (
              <button
                type="button"
                className="canvas-preset-task-reset"
                onClick={() => onChange(card.kind, { skillIds: [] })}
              >
                恢复推荐
              </button>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function taskIcon(card: CanvasPresetTaskCardDefinition) {
  if (card.icon === 'vision') return <Icons.Eye size={18} />
  if (card.icon === 'image') return <Icons.ImagePlus size={18} />
  if (card.icon === 'video') return <Icons.Video size={18} />
  return <Icons.FileText size={18} />
}

function hasRuntimeSelection(runtime: CanvasTaskRuntimeDefault): boolean {
  return Boolean(runtime.providerProfileId || runtime.manifestId || runtime.modelId)
}

function resolveMediaModelValue(
  models: CanvasMediaModelSummary[],
  runtime: CanvasTaskRuntimeDefault,
): string {
  const model = models.find(
    (item) =>
      (!runtime.providerProfileId || item.providerProfileId === runtime.providerProfileId) &&
      (!runtime.manifestId || item.manifestId === runtime.manifestId) &&
      (!runtime.modelId || item.effectiveModelId === runtime.modelId),
  )
  return model ? mediaModelKey(model) : ''
}

function runtimeFromMediaModel(
  models: CanvasMediaModelSummary[],
  modelKey: string,
): CanvasTaskRuntimeDefault {
  const model = models.find((item) => mediaModelKey(item) === modelKey)
  if (!model) return { skillIds: [] }
  return {
    ...(model.providerProfileId ? { providerProfileId: model.providerProfileId } : {}),
    ...(model.manifestId ? { manifestId: model.manifestId } : {}),
    ...(model.effectiveModelId ? { modelId: model.effectiveModelId } : {}),
    skillIds: [],
  }
}
