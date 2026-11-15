import { PROVIDER_IDS, fmtRef, type Config, type ModelRef, type ProviderId } from '../config.js';
import type { Price } from '../providers/index.js';
import { knownPrice, listModels } from './models.js';
import { hasCredentials } from './setup.js';

/** Slider stops (USD per request). null = no limit. */
export const BUDGET_STEPS: (number | null)[] = [0, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, null];

export function fmtUsd(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(v < 0.1 ? 3 : 2)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtBudget(b: number | null): string {
  return b === null ? 'no limit' : b === 0 ? 'free only' : `${fmtUsd(b)} / request`;
}

/** Parses "free", "off", "none", "0", "0.5", "$2", "50c". */
export function parseBudget(s: string): number | null | undefined {
  const t = s.trim().toLowerCase();
  if (['off', 'none', 'unlimited', 'no', '∞', 'inf'].includes(t)) return null;
  if (t === 'free') return 0;
  const c = /^(\d+(?:\.\d+)?)\s*c$/.exec(t);
  if (c) return Number(c[1]) / 100;
  const n = Number(t.replace(/^\$/, ''));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export type Pricing = { kind: 'free'; why: string } | { kind: 'priced'; price: Price } | { kind: 'unknown' };

/** What a model costs, from the most reliable source available. */
export function pricing(cfg: Config, ref: ModelRef): Pricing {
  const own = cfg.prices?.[fmtRef(ref)];
  if (own) return own.in === 0 && own.out === 0 ? { kind: 'free', why: 'your price' } : { kind: 'priced', price: own };
  if (ref.provider === 'custom') return { kind: 'free', why: 'local' };
  if (cfg.freeTier?.includes(ref.provider)) return { kind: 'free', why: 'free tier' };
  const p = knownPrice(ref.provider, ref.model);
  if (p) return p.in === 0 && p.out === 0 ? { kind: 'free', why: 'free model' } : { kind: 'priced', price: p };
  if (ref.provider === 'openrouter' && ref.model.endsWith(':free')) return { kind: 'free', why: 'free model' };
  return { kind: 'unknown' };
}

export function costOf(cfg: Config, ref: ModelRef, input: number, output: number): number {
  const p = pricing(cfg, ref);
  return p.kind === 'priced' ? (input * p.price.in + output * p.price.out) / 1e6 : 0;
}

export function priceLabel(p: Pricing): string {
  if (p.kind === 'free') return `free (${p.why})`;
  if (p.kind === 'unknown') return 'price unknown';
  const f = (v: number) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
  return `$${f(p.price.in)} in / $${f(p.price.out)} out per 1M tokens`;
}

export interface CatalogEntry {
  ref: string;
  provider: ProviderId;
  model: string;
  pricing: Pricing;
  /** Rough relative cost for sorting (unknown = high). */
  weight: number;
}

const weightOf = (p: Pricing) => (p.kind === 'free' ? 0 : p.kind === 'priced' ? p.price.in + p.price.out * 3 : 1e6);

/** Providers the orchestrator may pick models from: those with credentials (+ local if configured). */
export function usableProviders(cfg: Config): ProviderId[] {
  return PROVIDER_IDS.filter((p) =>
    p === 'custom'
      ? !!cfg.providers.custom || cfg.orchestrator.provider === 'custom' || cfg.subagent.provider === 'custom'
      : hasCredentials(cfg, p),
  );
}

/** Every model of every usable provider, with its pricing. */
export async function buildCatalog(cfg: Config): Promise<CatalogEntry[]> {
  const lists = await Promise.all(usableProviders(cfg).map((p) => listModels(cfg, p)));
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  const add = (provider: ProviderId, model: string) => {
    const ref = `${provider}:${model}`;
    if (seen.has(ref)) return;
    seen.add(ref);
    const p = pricing(cfg, { provider, model });
    out.push({ ref, provider, model, pricing: p, weight: weightOf(p) });
  };
  // the configured models always appear
  add(cfg.subagent.provider, cfg.subagent.model);
  add(cfg.orchestrator.provider, cfg.orchestrator.model);
  for (const l of lists) for (const m of l.models) add(l.provider, m);
  return out;
}

/**
 * Models allowed under a budget: free ones only at 0; otherwise all of them (spend is checked
 * while running; models without a known price can't be counted, which the UI points out).
 */
export function allowedModels(cat: CatalogEntry[], budget: number | null): CatalogEntry[] {
  if (budget === 0) return cat.filter((c) => c.pricing.kind === 'free');
  return cat;
}

/**
 * A compact list for the orchestrator's prompt: per provider the configured default,
 * always-current aliases, free models and the cheapest priced ones.
 */
export function shortlist(cat: CatalogEntry[], cfg: Config, perProvider = 10): CatalogEntry[] {
  const byProv = new Map<ProviderId, CatalogEntry[]>();
  for (const c of cat) byProv.set(c.provider, [...(byProv.get(c.provider) ?? []), c]);
  const out: CatalogEntry[] = [];
  for (const [, list] of byProv) {
    const score = (c: CatalogEntry) =>
      (c.ref === fmtRef(cfg.subagent) || c.ref === fmtRef(cfg.orchestrator) ? -1e9 : 0) + (/-latest$/.test(c.model) ? -1e8 : 0) + c.weight;
    out.push(...[...list].sort((a, b) => score(a) - score(b)).slice(0, perProvider));
  }
  return out;
}

/** The part of the orchestrator's system prompt that explains model choice and budget. */
export function modelGuide(cfg: Config, allowed: CatalogEntry[], spent: number): string {
  const b = cfg.budget;
  const head =
    b === null
      ? 'Budget: no limit — still prefer cheaper models when they are good enough.'
      : b === 0
        ? 'Budget: FREE models only — every model below is free.'
        : `Budget for this request: ${fmtUsd(b)} (spent so far ${fmtUsd(spent)}). Stay within it.`;
  const lines = shortlist(allowed, cfg).map((c) => `- ${c.ref} — ${priceLabel(c.pricing)}`);
  return `
SUB-AGENT MODELS — choose the model of each agent with the "model" field of spawn_agents (exactly as listed).
${head}
- Simple reading, searching, listing, small edits → the cheapest fast model.
- Hard reasoning, tricky bugs, large refactors → a stronger model.
- If unsure use the default: ${fmtRef(cfg.subagent)}.
Available:
${lines.join('\n')}`;
}

/** Spend tracking for one request. */
export class BudgetTracker {
  spent = 0;
  constructor(public limit: number | null) {}
  add(cost: number) {
    this.spent += cost;
  }
  get exceeded() {
    return this.limit !== null && this.limit > 0 && this.spent >= this.limit;
  }
}

export class BudgetError extends Error {}
