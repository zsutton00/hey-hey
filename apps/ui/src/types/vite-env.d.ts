/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_WS_URL?: string
  readonly VITE_ENV?: string
  readonly VITE_FEATURE_WORKFLOW_MANAGEMENT?: string
  readonly VITE_FEATURE_DEBUG_TOOLS?: string
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface HeyHeyRuntimeConfig {
  apiProtocol?: string
  apiHost?: string
  localAgentPort?: string
  apiPort?: string
  apiBasePath?: string
  apiUrl?: string
  wsUrl?: string
  env?: string
}

interface Window {
  __HEY_HEY_RUNTIME_CONFIG__?: HeyHeyRuntimeConfig
}
