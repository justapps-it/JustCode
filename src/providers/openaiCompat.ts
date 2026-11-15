import { fetchRetry, ProviderError, splitThink, type ChatOptions, type ChatResult, type ModelInfo, type Message, type Provider, type ToolDef } from './types.js';

/** Any OpenAI-compatible Chat Completions API: Groq, OpenRouter, OpenAI, Ollama, LM Studio, vLLM... */
export class OpenAICompatProvider implements Provider {
  constructor(
    public id: string,
    private baseUrl: string,
    private apiKey: string | undefined,
    private requireKey = true,
  ) {}

  async chat(model: string, messages: Message[], tools: ToolDef[], signal?: AbortSignal, opts?: ChatOptions): Promise<ChatResult> {
    if (this.requireKey && !this.apiKey)
      throw new ProviderError(`${this.id}: missing API key. Use /key ${this.id} <KEY> or set the env variable.`);

    const msgs = messages.map((m) => {
      switch (m.role) {
        case 'assistant':
          return {
            role: 'assistant',
            content: m.content || null,
            ...(m.toolCalls?.length
              ? {
                  tool_calls: m.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                  })),
                }
              : {}),
          };
        case 'tool':
          return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
        default:
          return { role: m.role, content: m.content };
      }
    });

    const body: Record<string, unknown> = { model, messages: msgs, temperature: 0.4 };
    if (tools.length) {
      body.tools = tools.map((t) => ({ type: 'function', function: t }));
      body.tool_choice = 'auto';
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    // OpenRouter returns the reasoning of thinking models in `reasoning` when asked
    if (opts?.thinking && this.id === 'openrouter') body.include_reasoning = true;
    if (this.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://code.justapps.it';
      headers['X-Title'] = 'just-Code';
    }

    const res = await fetchRetry(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, signal);
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new ProviderError(`${this.id} ${res.status}: ${json?.error?.message ?? res.statusText}`, res.status);

    const msg = json.choices?.[0]?.message ?? {};
    const toolCalls = (msg.tool_calls ?? []).map((tc: any, i: number) => {
      let args: Record<string, unknown> = {};
      try {
        args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = { _raw: tc.function?.arguments };
      }
      return { id: tc.id ?? `call_${Date.now()}_${i}`, name: tc.function?.name, args };
    });
    // reasoning: `reasoning` (OpenRouter, Groq gpt-oss), `reasoning_content` (DeepSeek, vLLM), or <think> tags
    const split = splitThink(typeof msg.content === 'string' ? msg.content : '');
    const reasoning = [msg.reasoning, msg.reasoning_content, split.thinking].filter((x) => typeof x === 'string' && x.trim()).join('\n\n');
    return {
      text: split.text,
      thinking: reasoning || undefined,
      toolCalls,
      usage: json.usage ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 } : undefined,
    };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    if (this.requireKey && !this.apiKey) throw new ProviderError(`${this.id}: missing API key.`);
    const headers: Record<string, string> = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/models`, { headers, signal });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new ProviderError(`${this.id} ${res.status}: ${json?.error?.message ?? res.statusText}`, res.status);
    const list: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
    return list
      // agents need tool calling: keep models that declare it (OpenRouter) or don't say
      .filter((m) => !Array.isArray(m?.supported_parameters) || m.supported_parameters.includes('tools'))
      .filter((m) => m?.active !== false)
      .map((m): ModelInfo => {
        const id = String(m?.id ?? m?.name ?? '');
        // OpenRouter: pricing.prompt / pricing.completion are USD per token (strings)
        const pin = Number(m?.pricing?.prompt);
        const pout = Number(m?.pricing?.completion);
        const price = Number.isFinite(pin) && Number.isFinite(pout) && pin >= 0 && pout >= 0 ? { in: pin * 1e6, out: pout * 1e6 } : undefined;
        return { id, price };
      })
      .filter((m) => m.id && !/(embed|whisper|tts|dall-e|moderation|guard|transcri|image|audio|realtime)/i.test(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
