import { EventEmitter } from 'node:events';
import { fmtRef, parseModelRef, type Config, type ModelRef } from '../config.js';
import { createProvider } from '../providers/index.js';
import type { Message } from '../providers/types.js';
import { TOOLS, shellInfo, type PermissionRequest, type ToolContext } from '../tools/index.js';
import { runLoop, type LoopTool } from './loop.js';
import {
  BudgetError,
  BudgetTracker,
  allowedModels,
  buildCatalog,
  costOf,
  fmtUsd,
  modelGuide,
  pricing,
  priceLabel,
  type CatalogEntry,
} from '../core/budget.js';

export type AgentStatus = 'queued' | 'running' | 'done' | 'error';

export type JustEvent =
  | { type: 'orch:thinking' }
  | { type: 'orch:text'; text: string }
  | { type: 'orch:reasoning'; text: string }
  | { type: 'agent:reasoning'; id: string; text: string }
  | { type: 'orch:tool'; name: string; summary: string }
  | { type: 'agent:spawn'; id: string; name: string; task: string; model: string; price: string; note?: string }
  | { type: 'notice'; text: string }
  | { type: 'budget'; spent: number; limit: number | null }
  | { type: 'agent:start'; id: string }
  | { type: 'agent:tool'; id: string; name: string; summary: string }
  | { type: 'agent:done'; id: string; result: string }
  | { type: 'agent:error'; id: string; error: string }
  | { type: 'usage'; input: number; output: number; cost: number; id?: string };

const ORCH_SYSTEM = (cwd: string) => `You are the ORCHESTRATOR of just-Code, a terminal coding IDE.
Workspace: ${cwd}. OS: ${process.platform}. Shell for run_shell: ${shellInfo().name}. Date: ${new Date().toISOString().slice(0, 10)}.

Your job: understand the user's request, plan, and DELEGATE work to sub-agents with the spawn_agents tool.
- Split the work into small, independent, well-scoped tasks (e.g. "explore src/auth and summarise how login works",
  "write unit tests for utils/date.ts", "implement function X in file Y").
- Sub-agents run IN PARALLEL and have tools: read_file, list_files, search, write_file, edit_file, run_shell.
  They do NOT see the conversation: give each one complete context (file paths, conventions, exact goal, expected output).
- Avoid giving two parallel agents edits to the same file.
- You may use the tools yourself for quick checks; for anything bigger, delegate.
- After agents report back, verify/integrate (spawn another wave if needed), then reply to the user with a concise summary.
- For simple questions or chit-chat, just answer directly without spawning agents.
Reply in the user's language. Use Markdown sparingly (terminal output).`;

const SUB_SYSTEM = (cwd: string, name: string) => `You are "${name}", a focused sub-agent inside just-Code (terminal coding IDE).
Workspace: ${cwd}. OS: ${process.platform}. Shell for run_shell: ${shellInfo().name} (use commands valid for it).
Complete ONLY the task you were given, using your tools. Read before you edit. Keep changes minimal and consistent with the codebase.
When done, reply with a short report: what you did, files touched, anything the orchestrator must know (problems, follow-ups).`;

export interface OrchestratorOptions {
  cwd: string;
  getConfig: () => Config;
  requestPermission: (req: PermissionRequest) => Promise<boolean>;
}

export class Orchestrator extends EventEmitter {
  history: Message[] = [];
  private abort?: AbortController;
  private seq = 0;
  private tracker = new BudgetTracker(null);
  private allowed: CatalogEntry[] = [];

  /** Counts the cost of a model call and reports it. */
  private spend(ref: ModelRef, input: number, output: number, id?: string) {
    const cost = costOf(this.o.getConfig(), ref, input, output);
    this.tracker.add(cost);
    this.emitEv({ type: 'usage', input, output, cost, id });
    this.emitEv({ type: 'budget', spent: this.tracker.spent, limit: this.tracker.limit });
  }

  private checkBudget = () => {
    if (this.tracker.exceeded)
      throw new BudgetError(`Budget reached: spent ${fmtUsd(this.tracker.spent)} of ${fmtUsd(this.tracker.limit ?? 0)} for this request (/budget to change it).`);
  };

  /** The model a sub-agent will use: the orchestrator's pick if allowed, else the default, else the cheapest allowed. */
  private resolveModel(cfg: Config, requested?: string): { ref: ModelRef; note?: string } {
    const want = requested ? parseModelRef(requested.trim()) : null;
    if (!cfg.autoSubModels) return { ref: cfg.subagent };
    const ok = (r: ModelRef) => this.allowed.some((c) => c.ref === fmtRef(r));
    if (want && ok(want)) return { ref: want };
    if (ok(cfg.subagent)) return { ref: cfg.subagent, note: want ? `${fmtRef(want)} not allowed by the budget` : undefined };
    const cheapest = [...this.allowed].sort((a, b) => a.weight - b.weight)[0];
    if (!cheapest) throw new BudgetError('No model fits the budget: raise it with /budget, or mark a free-tier provider.');
    return { ref: { provider: cheapest.provider, model: cheapest.model }, note: want ? `${fmtRef(want)} not allowed by the budget` : 'cheapest allowed model' };
  }

  constructor(private o: OrchestratorOptions) {
    super();
  }

  emitEv(e: JustEvent) {
    this.emit('event', e);
  }

  reset() {
    this.history = [];
  }

  interrupt() {
    this.abort?.abort();
  }

  get busy() {
    return !!this.abort && !this.abort.signal.aborted;
  }

  private fileTools(agent: string, signal: AbortSignal, onTool: (name: string, summary: string) => void): LoopTool[] {
    const ctx: ToolContext = { cwd: this.o.cwd, agent, signal, requestPermission: this.o.requestPermission };
    return Object.values(TOOLS).map((t) => ({
      def: t.def,
      summarize: t.summarize,
      run: (args) => {
        onTool(t.def.name, t.summarize(args));
        return t.run(args, ctx);
      },
    }));
  }

  private spawnTool(signal: AbortSignal): LoopTool {
    return {
      def: {
        name: 'spawn_agents',
        description:
          'Launch sub-agents IN PARALLEL, each with a small self-contained task. Returns every agent report. ' +
          'Choose a model per agent as "provider:model" from the list in your instructions (cheap for simple work, stronger for hard work).',
        parameters: {
          type: 'object',
          properties: {
            agents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Short role name, e.g. "explorer", "test-writer"' },
                  task: { type: 'string', description: 'Complete, self-contained instructions' },
                  model: { type: 'string', description: 'provider:model from the available list; omit for the default' },
                },
                required: ['name', 'task'],
              },
            },
          },
          required: ['agents'],
        },
      },
      summarize: (a) => `${(a.agents ?? []).length} agents`,
      run: async (a) => {
        const specs = (Array.isArray(a.agents) ? a.agents : []) as { name: string; task: string; model?: string }[];
        if (!specs.length) return 'ERROR: no agents given';
        if (this.tracker.exceeded) return `ERROR: the budget for this request is used up (${fmtUsd(this.tracker.spent)}). Answer with what you have.`;
        return JSON.stringify(await this.runAgents(specs, signal), null, 1);
      },
    };
  }

  private async runAgents(specs: { name: string; task: string; model?: string }[], signal: AbortSignal) {
    const cfg = this.o.getConfig();
    const jobs = specs.map((s) => {
      const id = `a${++this.seq}`;
      const { ref, note } = this.resolveModel(cfg, s.model);
      this.emitEv({ type: 'agent:spawn', id, name: s.name || id, task: s.task, model: fmtRef(ref), price: priceLabel(pricing(cfg, ref)), note });
      return { id, spec: s, ref };
    });

    const results: { agent: string; ok: boolean; report: string }[] = new Array(jobs.length);
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const i = next++;
        const { id, spec, ref } = jobs[i];
        this.emitEv({ type: 'agent:start', id });
        try {
          const provider = createProvider(cfg, ref.provider);
          const report = await runLoop({
            provider,
            model: ref.model,
            maxSteps: cfg.maxSteps,
            signal,
            messages: [
              { role: 'system', content: SUB_SYSTEM(this.o.cwd, spec.name) },
              { role: 'user', content: spec.task },
            ],
            tools: this.fileTools(spec.name, signal, (name, summary) => this.emitEv({ type: 'agent:tool', id, name, summary })),
            thinking: cfg.showThinking,
            onThinking: (text) => this.emitEv({ type: 'agent:reasoning', id, text }),
            onUsage: (input, output) => this.spend(ref, input, output, id),
            beforeCall: this.checkBudget,
          });
          this.emitEv({ type: 'agent:done', id, result: report });
          results[i] = { agent: spec.name, ok: true, report };
        } catch (e) {
          const msg = (e as Error).message;
          this.emitEv({ type: 'agent:error', id, error: msg });
          results[i] = { agent: spec.name, ok: false, report: `FAILED: ${msg}` };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(cfg.maxParallel, jobs.length)) }, worker));
    return results;
  }

  /** Runs one user turn. Returns the orchestrator's final answer. */
  async send(userText: string): Promise<string> {
    const cfg = this.o.getConfig();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.tracker = new BudgetTracker(cfg.budget);
    this.emitEv({ type: 'orch:thinking' });
    this.emitEv({ type: 'budget', spent: 0, limit: cfg.budget });
    // what the orchestrator may pick for its sub-agents, refreshed every request
    let guide = '';
    if (cfg.autoSubModels) {
      this.allowed = allowedModels(await buildCatalog(cfg), cfg.budget);
      guide = this.allowed.length ? modelGuide(cfg, this.allowed, 0) : '';
      if (cfg.budget === 0 && pricing(cfg, cfg.orchestrator).kind !== 'free')
        this.emitEv({ type: 'notice', text: `Budget is "free only" but the orchestrator ${fmtRef(cfg.orchestrator)} is not a free model: its own requests are not counted.` });
      if (!this.allowed.length) this.emitEv({ type: 'notice', text: 'No sub-agent model fits the budget: raise it with /budget or mark a free-tier provider.' });
    }
    const system = ORCH_SYSTEM(this.o.cwd) + guide;
    if (!this.history.length) this.history.push({ role: 'system', content: system });
    else if (this.history[0].role === 'system') this.history[0] = { role: 'system', content: system };
    this.history.push({ role: 'user', content: userText });
    try {
      const provider = createProvider(cfg, cfg.orchestrator.provider);
      return await runLoop({
        provider,
        model: cfg.orchestrator.model,
        maxSteps: cfg.maxSteps,
        signal,
        messages: this.history,
        tools: [
          this.spawnTool(signal),
          ...this.fileTools('orchestrator', signal, (name, summary) => this.emitEv({ type: 'orch:tool', name, summary })),
        ],
        onText: (text) => this.emitEv({ type: 'orch:text', text }),
        thinking: cfg.showThinking,
        onThinking: (text) => this.emitEv({ type: 'orch:reasoning', text }),
        onToolStart: (call, summary) => {
          if (call.name === 'spawn_agents') this.emitEv({ type: 'orch:tool', name: call.name, summary });
        },
        onUsage: (input, output) => this.spend(cfg.orchestrator, input, output),
        beforeCall: this.checkBudget,
      });
    } catch (e) {
      // Keep history consistent: drop a dangling tool-call turn so the next request is valid.
      const last = this.history[this.history.length - 1];
      if (last?.role === 'assistant' && last.toolCalls?.length) this.history.pop();
      throw e;
    } finally {
      this.abort = undefined;
    }
  }
}
