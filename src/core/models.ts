import { PROVIDER_IDS, SUGGESTED_MODELS, type Config, type ProviderId } from '../config.js';
import { createProvider, type Price } from '../providers/index.js';
import { hasCredentials } from './setup.js';

export interface ModelList {
  provider: ProviderId;
  /** true when the list came from the provider; false = built-in suggestions. */
  live: boolean;
  models: string[];
  /** Prices the provider publishes (USD per 1M tokens). */
  prices?: Record<string, Price>;
  error?: string;
}

const cache = new Map<ProviderId, { at: number; list: ModelList }>();
const TTL = 10 * 60_000;

/** Models of a provider: asks the provider (cached 10 min), falls back to the built-in suggestions. */
export async function listModels(cfg: Config, provider: ProviderId, timeoutMs = 10_000): Promise<ModelList> {
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < TTL) return hit.list;
  const fallback = (error?: string): ModelList => ({ provider, live: false, models: SUGGESTED_MODELS[provider], error });
  if (!hasCredentials(cfg, provider)) return fallback('no key for this provider yet');
  const p = createProvider(cfg, provider);
  if (!p.listModels) return fallback();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const infos = await p.listModels(ctrl.signal);
    if (!infos.length) return fallback('the provider returned no models');
    const prices: Record<string, Price> = {};
    for (const m of infos) if (m.price) prices[m.id] = m.price;
    const list: ModelList = { provider, live: true, models: infos.map((m) => m.id), prices };
    cache.set(provider, { at: Date.now(), list });
    return list;
  } catch (e) {
    return fallback(ctrl.signal.aborted ? 'timed out' : (e as Error).message);
  } finally {
    clearTimeout(t);
  }
}

/** Live models already fetched (sync, for autocomplete); otherwise the suggestions. */
export function knownModels(provider: ProviderId): string[] {
  return cache.get(provider)?.list.models ?? SUGGESTED_MODELS[provider];
}

/** Cached published price of a model, if any. */
export function knownPrice(provider: ProviderId, model: string): Price | undefined {
  return cache.get(provider)?.list.prices?.[model];
}

/** Warm the cache for every provider that has credentials (fire and forget). */
export function prefetchModels(cfg: Config): void {
  for (const p of PROVIDER_IDS) if (p !== 'custom' && hasCredentials(cfg, p)) void listModels(cfg, p);
}

/** Forget cached lists (after a key change). */
export function clearModelCache(provider?: ProviderId): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}
