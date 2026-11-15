import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ProviderId = 'gemini' | 'groq' | 'openrouter' | 'openai' | 'custom';
export const PROVIDER_IDS: ProviderId[] = ['gemini', 'groq', 'openrouter', 'openai', 'custom'];

export interface ModelRef {
  provider: ProviderId;
  model: string;
}

export interface ProviderSettings {
  apiKey?: string;
  baseUrl?: string;
}

export interface GoogleOAuthSettings {
  /** OAuth client ID ("Desktop app") from Google Cloud Console. */
  clientId?: string;
  /** Desktop-app client secret (not truly secret for installed apps, but Google requires it). */
  clientSecret?: string;
  /** Optional Google Cloud project billed for quota (sent as x-goog-user-project). */
  quotaProject?: string;
}

export interface Config {
  orchestrator: ModelRef;
  subagent: ModelRef;
  providers: Partial<Record<ProviderId, ProviderSettings>>;
  google: GoogleOAuthSettings;
  /** Set once the guided setup has been completed (or skipped). */
  setupDone?: boolean;
  turbo: boolean;
  /** Show the models' reasoning (thought summaries) in the UI. */
  showThinking: boolean;
  /** Max spend per request in USD; 0 = free models only; null = no limit. */
  budget: number | null;
  /** The orchestrator chooses the model of each sub-agent (within the budget). */
  autoSubModels: boolean;
  /** Providers whose key has no billing (free tier): their models count as free. */
  freeTier: ProviderId[];
  /** Prices you set yourself, "provider:model" → USD per 1M tokens. */
  prices: Record<string, { in: number; out: number }>;
  maxParallel: number;
  maxSteps: number;
}

export const CONFIG_DIR = process.env.JUST_CODE_HOME ?? path.join(os.homedir(), '.just-code');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/**
 * If you publish just-Code, put your own Google OAuth "Desktop app" client here
 * so end users only have to click "Login with Google".
 */
const BUILTIN_GOOGLE_CLIENT_ID = '600886543133-cdhl2pclnng4mdag0mh03vugt9p2lsam.apps.googleusercontent.com';
// Not committed: load it with /google-client <client_secret.json> or JUST_CODE_GOOGLE_CLIENT_SECRET.
const BUILTIN_GOOGLE_CLIENT_SECRET = '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';

export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  custom: 'http://localhost:11434/v1',
};

export const SUGGESTED_MODELS: Record<ProviderId, string[]> = {
  gemini: ['gemini-pro-latest', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
  groq: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'qwen/qwen3-32b'],
  openrouter: ['google/gemini-2.5-pro', 'anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat'],
  openai: ['gpt-4.1', 'gpt-4.1-mini'],
  custom: ['llama3.1'],
};

const ENV_KEYS: Record<ProviderId, string[]> = {
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  custom: ['JUST_CODE_CUSTOM_API_KEY'],
};

export function defaultConfig(): Config {
  return {
    orchestrator: { provider: 'gemini', model: 'gemini-flash-latest' },
    subagent: { provider: 'gemini', model: 'gemini-flash-lite-latest' },
    providers: {},
    google: {},
    turbo: false,
    showThinking: false,
    budget: null,
    autoSubModels: true,
    freeTier: [],
    prices: {},
    maxParallel: 4,
    maxSteps: 25,
  };
}

export function loadConfig(): Config {
  const base = defaultConfig();
  let file: Partial<Config> = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    /* no config yet */
  }
  return {
    ...base,
    ...file,
    orchestrator: upgradeModel({ ...base.orchestrator, ...file.orchestrator }),
    subagent: upgradeModel({ ...base.subagent, ...file.subagent }),
    providers: { ...base.providers, ...file.providers },
    google: { ...base.google, ...file.google },
  };
}

/**
 * Gemini 1.x / 2.x models are being retired ("no longer available to new users"):
 * move saved configs to Google's aliases, which always point to the current model.
 */
export function upgradeModel(ref: ModelRef): ModelRef {
  if (ref.provider !== 'gemini') return ref;
  const m = /^(?:models\/)?gemini-(?:1\.\d|2\.\d)(?:-[\w.]+)*$/.exec(ref.model);
  if (!m) return ref;
  const model = /flash-lite/.test(ref.model) ? 'gemini-flash-lite-latest' : /flash/.test(ref.model) ? 'gemini-flash-latest' : 'gemini-pro-latest';
  return { ...ref, model };
}

export function saveConfig(cfg: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function providerSettings(cfg: Config, id: ProviderId): Required<Pick<ProviderSettings, 'baseUrl'>> & ProviderSettings {
  const s = cfg.providers[id] ?? {};
  const envKey = ENV_KEYS[id].map((k) => process.env[k]).find(Boolean);
  const envBase = id === 'custom' ? process.env.JUST_CODE_CUSTOM_BASE_URL : undefined;
  return {
    apiKey: s.apiKey ?? envKey,
    baseUrl: s.baseUrl ?? envBase ?? DEFAULT_BASE_URLS[id],
  };
}

export function googleOAuth(cfg: Config): GoogleOAuthSettings {
  return {
    clientId: cfg.google.clientId ?? process.env.JUST_CODE_GOOGLE_CLIENT_ID ?? (BUILTIN_GOOGLE_CLIENT_ID || undefined),
    clientSecret:
      cfg.google.clientSecret ?? process.env.JUST_CODE_GOOGLE_CLIENT_SECRET ?? (BUILTIN_GOOGLE_CLIENT_SECRET || undefined),
    quotaProject: cfg.google.quotaProject ?? process.env.GOOGLE_CLOUD_QUOTA_PROJECT,
  };
}

export function parseModelRef(s: string): ModelRef | null {
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const provider = s.slice(0, i) as ProviderId;
  const model = s.slice(i + 1);
  if (!PROVIDER_IDS.includes(provider) || !model) return null;
  return { provider, model };
}

export const fmtRef = (r: ModelRef) => `${r.provider}:${r.model}`;
