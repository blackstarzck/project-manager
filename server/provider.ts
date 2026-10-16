import { AppError } from './errors.js';

export interface GenerationInput {
  system: string;
  prompt: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}

export interface AIProvider {
  readonly model: string;
  readonly configured: boolean;
  generate(input: GenerationInput): Promise<unknown>;
}

export class GroqProvider implements AIProvider {
  readonly model: string;
  readonly configured: boolean;
  constructor(private apiKey = process.env.GROQ_API_KEY || '', model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b', private fetcher: typeof fetch = fetch) {
    this.model = model;
    this.configured = !!apiKey.trim();
  }

  async generate({ system, prompt, signal: requestSignal, onDelta }: GenerationInput): Promise<unknown> {
    if (!this.configured) throw new AppError(503, 'AI_NOT_CONFIGURED', 'Groq API 키가 설정되지 않았습니다. .env의 GROQ_API_KEY를 확인해 주세요.');
    const timeout = AbortSignal.timeout(Math.min(300000,Math.max(10000,Number(process.env.GROQ_TIMEOUT_MS) || 120000)));
    const signal = AbortSignal.any([requestSignal,timeout]);
    const abortError = () => timeout.aborted && !requestSignal.aborted
      ? new AppError(504,'AI_TIMEOUT','AI 응답 대기 시간이 초과되었습니다. 기존 문서는 변경되지 않았습니다. 다시 시도해 주세요.')
      : new AppError(499,'AI_CANCELLED','생성을 취소했습니다.');
    let response: Response;
    try {
      response = await this.fetcher('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], stream: true, response_format: { type: 'json_object' }, max_completion_tokens: Math.min(16000,Math.max(1000,Number(process.env.GROQ_MAX_TOKENS) || 6000)), temperature: 0.4 }),
      });
    } catch (error) {
      if (signal.aborted) throw abortError();
      throw new AppError(502, 'AI_CONNECTION_FAILED', 'Groq에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new AppError(502, 'AI_AUTH_FAILED', 'Groq API 키 또는 모델 접근 권한을 확인해 주세요.');
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Math.min(86400,Math.max(1,Math.ceil(Number(retryAfter)))) : null;
        throw new AppError(429, 'AI_RATE_LIMIT', `Groq 사용 한도에 도달했습니다. ${seconds ? `약 ${seconds >= 120 ? `${Math.ceil(seconds/60)}분` : `${seconds}초`} 후` : '잠시 후'} 다시 시도해 주세요.`);
      }
      if (response.status === 400 || response.status === 404) throw new AppError(502, 'AI_REQUEST_REJECTED', 'Groq가 요청을 처리하지 못했습니다. GROQ_MODEL 설정을 확인해 주세요.');
      throw new AppError(502, 'AI_PROVIDER_ERROR', 'Groq에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    }
    if (!response.body) throw new AppError(502, 'AI_EMPTY_RESPONSE', 'Groq 응답을 받지 못했습니다.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '', result = '', finishReason: string | null = null;
    const accept = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let event: { choices?: { delta?: { content?: string }; finish_reason?: string | null }[]; error?: unknown };
      try { event = JSON.parse(data); } catch { throw new AppError(502, 'AI_INVALID_STREAM', 'AI 응답 스트림이 올바르지 않습니다.'); }
      if (event.error) throw new AppError(502, 'AI_PROVIDER_ERROR', 'Groq 응답 중 오류가 발생했습니다.');
      const choice = event.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === 'string') {
        result += delta;
        if (result.length > 1_000_000) throw new AppError(502, 'AI_RESPONSE_TOO_LARGE', 'AI 응답이 너무 큽니다. 요청 범위를 줄여 주세요.');
        onDelta(delta);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (signal.aborted) throw abortError();
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        for (const line of lines) accept(line);
      }
      pending += decoder.decode();
      if (pending.trim()) accept(pending);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (signal.aborted) throw abortError();
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'AI_STREAM_INTERRUPTED', 'AI 응답 연결이 중단되었습니다. 문서는 변경되지 않았습니다.');
    } finally { reader.releaseLock(); }
    if (finishReason === 'length') throw new AppError(502, 'AI_OUTPUT_TRUNCATED', 'AI 응답 길이 제한에 도달했습니다. 더 작은 범위로 요청해 주세요.');
    if (finishReason !== 'stop') throw new AppError(502, 'AI_INCOMPLETE_RESPONSE', 'AI 응답이 정상적으로 완료되지 않았습니다. 기존 문서는 변경되지 않았습니다.');
    if (signal.aborted) throw abortError();
    try { return JSON.parse(result); }
    catch { throw new AppError(502, 'AI_INVALID_JSON', 'AI 응답을 문서로 변환하지 못했습니다. 기존 문서는 변경되지 않았습니다.'); }
  }
}
