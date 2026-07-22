/**
 * Spark Canvas 全局常量
 */

/** 应用标识 */
export const APP_ID = 'spark-canvas'
export const APP_BUNDLE_ID = 'com.spark.canvas.desktop'
export const APP_NAME = 'Spark Canvas'
export const APP_PROTOCOL = 'spark-canvas'
export const APP_VERSION = '0.1.0'

/** Built-in Agent allowed to own Canvas sessions and text tasks. */
export const CANVAS_ASSISTANT_AGENT_ID = 'canvas-assistant-agent'

/** Keychain 服务名（与 keystore 模块保持一致） */
export const KEYCHAIN_SERVICE = 'spark-canvas'
export const CLOUD_AUTH_SERVICE = 'SparkCanvas.CloudAuth'

/** SQLite 数据库文件名 */
export const DB_FILENAME_PROD = 'spark-canvas.db'
export const DB_FILENAME_DEV = 'spark-canvas.db'

/** Electron 本地目录名 */
export const USER_DATA_DIRECTORY_NAME = 'Spark Canvas'
export const SESSION_DATA_DIRECTORY_NAME = 'session-data'

/** Agent 事件相关 */
export const MAX_EVENTS_PER_SESSION = 10_000
export const EVENT_STREAM_BATCH_SIZE = 50

/** IPC Channel 命名空间前缀 */
export const IPC_NS = {
  SESSION: 'session',
  PROVIDER: 'provider',
  WORKSPACE: 'workspace',
  KEYSTORE: 'keystore',
  SETTINGS: 'settings',
  USAGE: 'usage',
} as const

/** Workspace 相关 */
export const SPARK_DIR = '.spark'
export const AGENT_SPARK_DIR = '.agent_spark'
