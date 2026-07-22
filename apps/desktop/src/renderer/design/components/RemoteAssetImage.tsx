import { useEffect, useState, type CSSProperties, type ImgHTMLAttributes } from 'react'
import './RemoteAssetImage.less'

type RemoteAssetImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | undefined
  retryLabel?: string
}

/** Loads remote Canvas artwork without letting network failures break its host panel. */
export function RemoteAssetImage({
  src,
  alt = '',
  className = '',
  style,
  retryLabel = '重试',
  ...imgProps
}: RemoteAssetImageProps) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    if (!src) {
      setStatus('error')
      return () => {
        cancelled = true
      }
    }

    setStatus('loading')
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (!cancelled) setStatus('loaded')
    }
    image.onerror = () => {
      if (!cancelled) setStatus('error')
    }
    image.src = src
    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
    }
  }, [src, attempt])

  const wrapperStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  }

  if (status === 'error') {
    return (
      <div
        className={`remote-asset-image ${className}`.trim()}
        style={wrapperStyle}
        role="img"
        aria-label={alt}
      >
        <div className="remote-asset-image-error">
          <span>图片加载失败</span>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            {retryLabel}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`remote-asset-image ${className}`.trim()} style={wrapperStyle}>
      {status === 'loading' && <div className="remote-asset-image-loading" aria-hidden="true" />}
      <img
        {...imgProps}
        src={src}
        alt={alt}
        className={className}
        draggable={imgProps.draggable ?? false}
        onLoad={(event) => {
          setStatus('loaded')
          imgProps.onLoad?.(event)
        }}
        onError={(event) => {
          setStatus('error')
          imgProps.onError?.(event)
        }}
        style={{
          ...style,
          opacity: status === 'loaded' ? 1 : 0,
          transition: 'opacity 180ms ease-out',
        }}
      />
    </div>
  )
}

export function preloadRemoteAsset(src: string | undefined): Promise<void> {
  if (!src) return Promise.resolve()
  return new Promise((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve()
    image.onerror = () => resolve()
    image.src = src
  })
}
