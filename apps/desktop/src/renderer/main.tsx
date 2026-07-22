import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CanvasWindowApp } from './CanvasWindowApp'
import { SparkCanvasApp } from './SparkCanvasApp'
import { readCanvasWindowProjectId } from './canvasWindowParams'

import './design/styles/styles.css'
import './design/styles/views.css'
import './design/styles/interactions.css'
import './design/styles/board.css'
import './design/styles/global-overrides.css'

const rootElement = document.getElementById('root')
if (rootElement == null) {
  throw new Error('Root element #root not found in DOM')
}

createRoot(rootElement).render(
  <StrictMode>
    {readCanvasWindowProjectId() == null ? <SparkCanvasApp /> : <CanvasWindowApp />}
  </StrictMode>,
)
