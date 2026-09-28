// src/ia/gemini.ts — chamada REST direta ao Gemini via fetch nativo do Node.
// NÃO instala nem usa o SDK @google/generative-ai. A chave sai exclusivamente
// de process.env.GEMINI_API_KEY e nunca é registrada em log nem devolvida
// em respostas.
import { PC_IA_SYSTEM_PROMPT, buildPcIaUserPayload, type PcIaEstado } from './prompt.js';

export const PC_IA_TIMEOUT_MS = 20_000;

export class PcIaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PcIaConfigError';
  }
}

export class PcIaUpstreamError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'PcIaUpstreamError';
    this.status = status;
  }
}

function resolveModel(): string {
  const raw = (process.env.GEMINI_MODEL || '').trim();
  return raw.length > 0 ? raw : 'gemini-3.5-flash-lite';
}

function resolveApiKey(): string {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    throw new PcIaConfigError('GEMINI_API_KEY não configurada no daemon.');
  }
  return key;
}

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

function extractText(body: GenerateContentResponse): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const texto = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();
  return texto;
}

export async function gerarAnalisePcIa(estado: PcIaEstado): Promise<{ texto: string; modelo: string }> {
  const apiKey = resolveApiKey();
  const modelo = resolveModel();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: PC_IA_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildPcIaUserPayload(estado) }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 800 },
    }),
    signal: AbortSignal.timeout(PC_IA_TIMEOUT_MS),
  });

  const body = (await response.json().catch(() => null)) as GenerateContentResponse | null;
  if (!response.ok) {
    const detalhe = body?.error?.message ? `: ${body.error.message}` : '';
    throw new PcIaUpstreamError(`Gemini respondeu HTTP ${response.status}${detalhe}`, 502);
  }
  const texto = body ? extractText(body) : '';
  if (!texto) {
    throw new PcIaUpstreamError('Gemini retornou resposta vazia.', 502);
  }
  return { texto, modelo };
}
