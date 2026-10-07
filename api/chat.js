export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return new Response('OPENROUTER_API_KEY missing', { status: 500, headers: cors });

  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: cors }); }

  const { messages = [], model = 'google/gemini-2.0-flash-exp:free', system = '' } = body;

  const chatMessages = [];
  if (system) chatMessages.push({ role: 'system', content: system });
  for (const m of messages) {
    chatMessages.push({ role: m.role, content: String(m.content || '') });
  }

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://hirfa.vercel.app',
      'X-Title': 'Hirfa',
    },
    body: JSON.stringify({
      model,
      messages: chatMessages,
      stream: true,
      temperature: 0.75,
      max_tokens: 8192,
    }),
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return new Response(err, { status: upstream.status, headers: cors });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const j = JSON.parse(payload);
              const t = j?.choices?.[0]?.delta?.content || '';
              if (t) controller.enqueue(encoder.encode(t));
            } catch {}
          }
        }
      } catch (e) { controller.error(e); }
      finally { controller.close(); }
    },
  });

  return new Response(stream, {
    headers: {
      ...cors,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
