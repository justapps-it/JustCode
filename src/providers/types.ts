export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Provider-specific data that must be echoed back (e.g. Gemini thought signatures). */
  meta?: Record<string, unknown>;
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatResult {
  text: string;
  /** The model's reasoning / thought summary, when the provider exposes it. */
  thinking?: string;
  toolCalls: ToolCall[];
  usage?: { input: number; output: number };
}

export interface Provider {
  id: string;
  chat(model: string, messages: Message[], tools: ToolDef[], signal?: AbortSignal, opts?: ChatOptions): Promise<ChatResult>;
  /** Model ids the provider currently offers (for pickers and autocomplete). */
  listModels?(signal?: AbortSignal): Promise<string[]>;
}

export interface ChatOptions {
  /** Ask the provider for its reasoning / thought summaries (shown in the UI). */
  thinking?: boolean;
}

/** Splits `<think>…</think>` blocks (Qwen, DeepSeek-R1, Ollama…) out of a reply. */
export function splitThink(content: string): { text: string; thinking: string } {
  const thoughts: string[] = [];
  let text = content.replace(/<think>([\s\S]*?)(<\/think>|$)/gi, (_m, t: string) => {
    if (t.trim()) thoughts.push(t.trim());
    return '';
  });
  // some servers drop the opening tag and only send "...reasoning</think>answer"
  const close = text.indexOf('</think>');
  if (close >= 0) {
    if (text.slice(0, close).trim()) thoughts.push(text.slice(0, close).trim());
    text = text.slice(close + 8);
  }
  return { text: thoughts.length ? text.replace(/^\s+/, '') : text, thinking: thoughts.join('\n\n') };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** fetch with retry on 429/5xx and exponential backoff. */
export async function fetchRetry(url: string, init: RequestInit, signal?: AbortSignal, tries = 4): Promise<Response> {
  let last: Response | undefined;
  for (let i = 0; i < tries; i++) {
    last = await fetch(url, { ...init, signal });
    if (last.status !== 429 && last.status < 500) return last;
    const ra = Number(last.headers.get('retry-after'));
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 800 * 2 ** i;
    await new Promise((r) => setTimeout(r, Math.min(wait, 15_000)));
    if (signal?.aborted) break;
  }
  return last!;
}
