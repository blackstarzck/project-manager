import { describe, expect, it } from 'vitest';
import { GroqProvider } from './provider.js';

function streamed(chunks: string[]) {
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }), { status: 200 });
}

describe('Groq provider transport', () => {
  it('reads split UTF-8 / SSE frames and validates final JSON without persisting deltas', async () => {
    const deltas: string[] = [];
    let sent: RequestInit | undefined;
    const fixtureFetch = (async (_url, init) => {
      sent = init;
      return streamed(['data: {"choices":[{"delta":{"content":"{\\"title\\":\\""}}]}\n\n', 'data: {"choices":[{"delta":{"content":"기획\\"}"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\n']);
    }) as typeof fetch;
    const provider = new GroqProvider('fixture-key', 'test-model', fixtureFetch);
    const result = await provider.generate({ system: 'JSON only', prompt: 'test', signal: new AbortController().signal, onDelta: text => deltas.push(text) });
    expect(result).toEqual({ title: '기획' });
    expect(deltas.join('')).toBe('{"title":"기획"}');
    expect(JSON.parse(String(sent?.body))).toMatchObject({ stream: true, model: 'test-model', response_format: { type: 'json_object' } });
  });

  it('rejects truncated output even if JSON appears syntactically complete', async () => {
    const provider = new GroqProvider('fixture', 'test', (async () => streamed(['data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"length"}]}\n'])) as typeof fetch);
    await expect(provider.generate({ system: '', prompt: '', signal: new AbortController().signal, onDelta: () => {} })).rejects.toMatchObject({ code: 'AI_OUTPUT_TRUNCATED' });
  });

  it('does not expose upstream body or API keys in auth errors', async () => {
    const provider = new GroqProvider('secret-fixture', 'test', (async () => new Response('secret-fixture upstream debug credentials', { status: 401 })) as typeof fetch);
    await expect(provider.generate({ system: '', prompt: '', signal: new AbortController().signal, onDelta: () => {} })).rejects.toMatchObject({ code: 'AI_AUTH_FAILED' });
  });

  it('shows only a bounded numeric retry delay from provider headers', async () => {
    const provider = new GroqProvider('fixture', 'test', (async () => new Response('private upstream body', { status:429, headers:{'retry-after':'45'} })) as typeof fetch);
    await expect(provider.generate({system:'',prompt:'',signal:new AbortController().signal,onDelta:()=>{}})).rejects.toThrow('약 45초 후');
    const malformed = new GroqProvider('fixture','test',(async()=>new Response('private',{status:429,headers:{'retry-after':'api-secret-do-not-echo'}})) as typeof fetch);
    await expect(malformed.generate({system:'',prompt:'',signal:new AbortController().signal,onDelta:()=>{}})).rejects.toThrow('잠시 후');
  });

  it('rejects invalid output and canceled requests', async () => {
    const provider = new GroqProvider('fixture', 'test', (async () => streamed(['data: {"choices":[{"delta":{"content":"not json"},"finish_reason":"stop"}]}\n'])) as typeof fetch);
    await expect(provider.generate({ system: '', prompt: '', signal: new AbortController().signal, onDelta: () => {} })).rejects.toMatchObject({ code: 'AI_INVALID_JSON' });
    const controller = new AbortController(); controller.abort();
    await expect(provider.generate({ system: '', prompt: '', signal: controller.signal, onDelta: () => {} })).rejects.toMatchObject({ code: 'AI_CANCELLED' });
  });
});
