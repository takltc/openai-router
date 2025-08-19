/**
 * OpenAI Router for Cloudflare Workers
 * @author jizhejiang
 * @date 2025-08-11
 * @description Routes OpenAI and Anthropic API requests through Cloudflare Workers with format conversion
 */

import {
  formatRequestOpenAI,
  convertClaudeToOpenAI,
  convertOpenAIToClaude,
} from './utils/formatRequestOpenAI';
import { formatResponseOpenAI } from './utils/formatResponseOpenAI';
import { createOpenAIToClaudeTransform } from './utils/streamResponseOpenAI';
import { createClaudeToOpenAITransform } from './utils/streamResponseClaude';
import { validateOpenAIToolCalls, fixOrphanedToolCalls } from './utils/validateToolCalls';
import type {
  OpenAIRequest,
  OpenAIMessage,
  OpenAIToolCall,
  ClaudeRequest,
  ClaudeMessage,
} from './utils/types';
// Session-level tool signature cache to suppress duplicate tool calls across requests
const TOOL_SIG_CACHE: Map<string, Set<string>> = new Map();

function normalizePathLike(p: string): string {
  try {
    if (typeof p !== 'string') return '';
    if (p.startsWith('~/')) {
      const root =
        (globalThis as unknown as { process?: { env?: Record<string, string> } })?.process?.env
          ?.WORKSPACE_ROOT || '/Volumes/JJZ/jerryjiang/code/ai';
      return `${root}/${p.slice(2)}`.replace(/\\+/g, '/');
    }
    return p.replace(/\\+/g, '/');
  } catch {
    return p;
  }
}

function canonicalizeToolCallSignature(name: string, argsJson: string): string {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(argsJson || '{}');
  } catch {
    return `${name}|${(argsJson || '').slice(0, 300)}`;
  }
  const IGNORE_KEYS = new Set([
    'offset',
    'limit',
    'start',
    'end',
    'range',
    'head_limit',
    '-C',
    '-A',
    '-B',
    'count',
    'files_with_matches',
    'output_mode',
    'glob',
    'type',
    'path_only',
    'preview',
    'page',
    'page_size',
  ]);
  const PATH_KEYS = new Set(['file_path', 'filepath', 'file', 'path']);
  const clean: Record<string, unknown> = {};
  const keys = Object.keys(obj)
    .filter((k) => !IGNORE_KEYS.has(k))
    .sort();
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string' && PATH_KEYS.has(k)) clean[k] = normalizePathLike(v);
    else clean[k] = v as unknown;
  }
  const canonical = JSON.stringify(clean).slice(0, 300);
  return `${name}|${canonical}`;
}

export interface Env {
  OPENAI_BASE_URL: string;
  ANTHROPIC_BASE_URL: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  VALIDATE_TOOL_CALLS?: 'off' | 'strict' | 'fix';
  JSON_SCHEMA_VALIDATE?: 'true' | 'false' | '1' | '0';
  DEFAULT_MAX_TOKENS_MAP?: string;
  CLAUDE_DEFAULT_MAX_OUTPUT_TOKENS?: string;
  // Budget configs (string numbers), optional
  CLAUDE_TOTAL_INPUT_BUDGET_CHARS?: string; // default 129000
  CLAUDE_PER_FRAGMENT_MAX_CHARS?: string; // default 120000
  CLAUDE_SYSTEM_MAX_CHARS?: string; // default 120000
  CLAUDE_TOOL_PREVIEW_MAX_CHARS?: string; // default 4000
  // Truncation behavior configs (optional)
  CLAUDE_HEADROOM_RATIO?: string; // default 0.98
  CLAUDE_TOKENIZER_KIND?: string; // 'char' | 'word' | 'approx_byte' | `tiktoken:<name>`
  // Conversation buffer memory configs
  CLAUDE_MEMORY_MODE?: 'buffer' | 'off'; // default buffer
  CLAUDE_MEMORY_MAX_TURNS?: string; // default 8
  CLAUDE_MEMORY_MAX_CHARS?: string; // optional
  // Preflight token counting
  CLAUDE_PREFLIGHT_COUNT?: 'true' | 'false' | '1' | '0';
  CLAUDE_INPUT_LIMIT_TOKENS?: string; // default 129024
}

// Helper: convert Headers to plain object without relying on entries() or iteration protocol
function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

function computeDefaultMaxTokens(model: string, env: Env): number {
  try {
    if (env.DEFAULT_MAX_TOKENS_MAP) {
      const map = JSON.parse(env.DEFAULT_MAX_TOKENS_MAP) as Record<string, number>;
      if (map[model] && Number.isFinite(map[model])) {
        return map[model];
      }
      const prefEntry = Object.entries(map).find(
        ([key]) => key.endsWith('*') && model.startsWith(key.slice(0, -1))
      );
      if (prefEntry && Number.isFinite(prefEntry[1])) {
        return prefEntry[1];
      }
    }
  } catch {
    // ignore parse errors
  }

  const globalDefault = Number(env.CLAUDE_DEFAULT_MAX_OUTPUT_TOKENS || '0');
  if (Number.isFinite(globalDefault) && globalDefault > 0) {
    return globalDefault;
  }
  return 262000;
}

// (Optional) JSON schema validation is deferred; lightweight impl removed to reduce bundle and lints

function redactHeaders(headers: Headers): Record<string, string> {
  const src = headersToObject(headers);
  const result: Record<string, string> = {};
  Object.keys(src).forEach((k) => {
    const key = k.toLowerCase();
    if (key === 'authorization' || key === 'x-api-key') {
      result[k] = '***';
    } else {
      result[k] = src[k];
    }
  });
  return result;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      // Route based on path
      // Format conversion endpoints
      if (url.pathname === '/v1/chat/completions') {
        // OpenAI format -> Claude API
        return await handleOpenAIToClaude(request, env, corsHeaders);
      } else if (url.pathname === '/v1/messages/count_tokens' && request.method === 'POST') {
        // Claude format count_tokens -> OpenAI usage bridge
        return await handleClaudeCountTokensViaOpenAI(request, env, corsHeaders);
      } else if (url.pathname === '/v1/messages') {
        // Claude format -> OpenAI API
        return await handleClaudeToOpenAI(request, env, corsHeaders);
      }
      // Direct proxy endpoints (no conversion)
      else if (url.pathname.startsWith('/openai/') || url.pathname === '/openai') {
        return await handleOpenAIRequest(request, env, corsHeaders);
      } else if (url.pathname.startsWith('/anthropic/') || url.pathname === '/anthropic') {
        return await handleAnthropicRequest(request, env, corsHeaders);
      } else if (url.pathname === '/') {
        return handleRootRequest(corsHeaders);
      } else {
        return new Response('Not Found', {
          status: 404,
          headers: corsHeaders,
        });
      }
    } catch (error) {
      console.error('Error processing request:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: url.pathname,
        method: request.method,
      });
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  },
};

async function handleClaudeCountTokensViaOpenAI(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Parse Claude count_tokens request body
    let claudeBody: unknown;
    try {
      claudeBody = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request_error' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Expect at least model and messages
    const cb = claudeBody as Pick<ClaudeRequest, 'model' | 'messages'> | null;
    if (!cb || !cb.model || !cb.messages) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Missing required fields: model, messages',
            type: 'invalid_request_error',
          },
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Reuse converter to build OpenAI chat request from Claude format
    // For count_tokens, Claude body may not include max_tokens; construct a minimal valid ClaudeRequest
    const cbFull: ClaudeRequest = {
      model: cb.model,
      messages: cb.messages as ClaudeMessage[],
      max_tokens: 1,
    };
    const converted = convertClaudeToOpenAI(cbFull);
    if (!converted) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Invalid Claude request: conversion failed',
            type: 'invalid_request_error',
          },
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ensure non-stream and minimal generation; we only need token usage
    converted.stream = false;
    if (converted.max_tokens == null) {
      converted.max_tokens = 262000;
    }

    // Prepare headers for OpenAI
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization');
    if (apiKey) {
      headers.set('Authorization', apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`);
    } else if (env.OPENAI_API_KEY) {
      headers.set('Authorization', `Bearer ${env.OPENAI_API_KEY}`);
    }

    // Call OpenAI chat completions to obtain usage
    const upstream = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(converted),
    });

    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok) {
      let errorData: unknown = null;
      if (contentType.includes('application/json')) {
        try {
          errorData = await upstream.json();
        } catch {}
      }
      return new Response(
        JSON.stringify(
          errorData || { error: { message: 'Upstream error', status: upstream.status } }
        ),
        { status: upstream.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!contentType.includes('application/json')) {
      const text = await upstream.text();
      return new Response(
        JSON.stringify({
          error: {
            message: 'Expected JSON from OpenAI usage call',
            type: 'invalid_content_type',
            textPreview: text.slice(0, 500),
          },
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await upstream.json();
    const promptTokens = data?.usage?.prompt_tokens;
    if (typeof promptTokens !== 'number') {
      return new Response(
        JSON.stringify({
          error: {
            message: 'OpenAI response missing usage.prompt_tokens',
            type: 'upstream_usage_missing',
          },
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Claude count_tokens minimal-compatible response
    const claudeCountResponse = {
      input_tokens: promptTokens,
    };

    return new Response(JSON.stringify(claudeCountResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          type: 'internal_error',
        },
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

async function handleOpenAIRequest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const targetPath = url.pathname.replace('/openai', '');
  const targetUrl = `${env.OPENAI_BASE_URL}${targetPath}${url.search}`;

  const headers = new Headers(request.headers);

  // Add API key if configured
  if (env.OPENAI_API_KEY && !headers.get('Authorization')) {
    headers.set('Authorization', `Bearer ${env.OPENAI_API_KEY}`);
  }

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: headers,
    body: request.body,
  });

  const responseHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

async function handleAnthropicRequest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const targetPath = url.pathname.replace('/anthropic', '');
  const targetUrl = `${env.ANTHROPIC_BASE_URL}${targetPath}${url.search}`;

  const headers = new Headers(request.headers);

  // Add API key if configured
  if (env.ANTHROPIC_API_KEY && !headers.get('X-API-Key')) {
    headers.set('X-API-Key', env.ANTHROPIC_API_KEY);
  }

  // Ensure anthropic-version header is set
  if (!headers.get('anthropic-version')) {
    headers.set('anthropic-version', '2023-06-01');
  }

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: headers,
    body: request.body,
  });

  const responseHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

/**
 * Handle OpenAI format request and forward to Claude API
 */
async function handleOpenAIToClaude(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    console.log('=== OpenAI to Claude Request Start ===');
    // Parse request body
    let openAIRequest;
    try {
      openAIRequest = await request.json();
    } catch (parseError) {
      console.error('Failed to parse OpenAI request JSON:', {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        stack: parseError instanceof Error ? parseError.stack : undefined,
        requestSummary: {
          method: request.method,
          url: request.url,
          headers: redactHeaders(request.headers),
        },
      });
      throw new Error('Invalid JSON request body');
    }
    const isStream = openAIRequest.stream === true;
    console.log('Request parsed:', {
      isStream,
      model: openAIRequest.model,
      messageCount: openAIRequest.messages?.length,
      headers: redactHeaders(request.headers),
    });

    // Global dedupe: collapse duplicate tool calls by signature across entire conversation
    try {
      const sessionId = request.headers.get('X-Session-Id') || 'default';
      if (!TOOL_SIG_CACHE.has(sessionId)) TOOL_SIG_CACHE.set(sessionId, new Set());
      const sessionSeen = TOOL_SIG_CACHE.get(sessionId)!;
      const seenSig = new Set<string>();
      const deduped: OpenAIMessage[] = [];
      const collectToolSig = (tc: OpenAIToolCall): string => {
        return canonicalizeToolCallSignature(tc.function?.name || '', tc.function?.arguments || '');
      };
      for (const m of (openAIRequest.messages || []) as OpenAIMessage[]) {
        if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
          const uniqueBySig = new Map<string, OpenAIToolCall>();
          const suppressedIds: string[] = [];
          for (const tc of m.tool_calls) {
            const sig = collectToolSig(tc);
            // skip if already seen in this session
            if (sessionSeen.has(sig)) {
              // record as suppressed to synthesize a minimal tool result to avoid re-trigger
              suppressedIds.push(tc.id);
              continue;
            }
            if (!seenSig.has(sig) && !uniqueBySig.has(sig)) {
              uniqueBySig.set(sig, tc);
              seenSig.add(sig);
            }
          }
          const kept = Array.from(uniqueBySig.values());
          if (kept.length > 0) deduped.push({ ...m, tool_calls: kept });
          else deduped.push({ ...m, tool_calls: [] });
          // Insert synthetic tool results for suppressed duplicates to satisfy pairing
          for (const dupId of suppressedIds) {
            const toolMsg = {
              role: 'tool' as const,
              content: JSON.stringify({
                duplicate_call: true,
                note: 'Suppressed duplicate tool invocation by signature',
              }),
              // attach id via cast when pushing
            } as OpenAIMessage;
            (toolMsg as unknown as { tool_call_id: string }).tool_call_id =
              dupId as unknown as string;
            deduped.push(toolMsg);
          }
        } else if (m.role === 'tool' && m.tool_call_id) {
          // keep tool results only if their originating signature still exists in conversation
          // we can't map id->sig reliably here without state, so keep tool messages as-is;
          // they will be adjusted by ensureToolCallAdjacency downstream
          deduped.push(m);
        } else {
          deduped.push(m);
        }
      }
      openAIRequest.messages = deduped;
      // update session-level cache after dedupe
      for (const m of deduped) {
        if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            const sig = collectToolSig(tc);
            sessionSeen.add(sig);
          }
        }
      }
    } catch {}

    // Optional: tool call validation/fixup
    const validationMode = (env.VALIDATE_TOOL_CALLS as Env['VALIDATE_TOOL_CALLS']) || 'off';
    if (validationMode !== 'off') {
      const validation = validateOpenAIToolCalls(openAIRequest.messages || []);
      if (!validation.valid) {
        if (validationMode === 'strict') {
          return new Response(
            JSON.stringify({
              error: {
                message: 'Invalid tool_calls pairing',
                type: 'invalid_request_error',
                details: validation.errors,
              },
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (validationMode === 'fix') {
          openAIRequest.messages = fixOrphanedToolCalls(openAIRequest.messages || []);
        }
      }
    }

    // Default max_tokens when absent
    if (openAIRequest.max_tokens == null) {
      openAIRequest.max_tokens = computeDefaultMaxTokens(openAIRequest.model, env);
    }

    // Convert OpenAI request to Claude format
    let claudeRequest = convertOpenAIToClaude(openAIRequest as OpenAIRequest);

    console.log('Claude request formatted:', {
      stream: claudeRequest.stream,
      model: claudeRequest.model,
      max_tokens: claudeRequest.max_tokens,
    });

    // Prepare headers for Claude API
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('anthropic-version', '2023-06-01');

    // Add API key from request header or environment
    const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization');
    if (apiKey) {
      // If it starts with 'Bearer ', remove it (Claude uses x-api-key directly)
      const cleanKey = apiKey.startsWith('Bearer ') ? apiKey.slice(7) : apiKey;
      headers.set('x-api-key', cleanKey);
    } else if (env.ANTHROPIC_API_KEY) {
      headers.set('x-api-key', env.ANTHROPIC_API_KEY);
    }

    console.log('Sending request to Claude API:', env.ANTHROPIC_BASE_URL);
    // Forward to Claude API
    let claudeResponse = await fetch(`${env.ANTHROPIC_BASE_URL}/messages`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        ...claudeRequest,
        // reduce chance of provider-side token explosion due to generation
        max_tokens: Math.min(claudeRequest.max_tokens || 262000, 2048),
      }),
    });

    console.log('Claude API response status:', claudeResponse.status, claudeResponse.statusText);
    console.log('Claude API response headers:', headersToObject(claudeResponse.headers));

    // Check if response is an error
    if (!claudeResponse.ok) {
      console.error('Claude API error response:', claudeResponse.status);
      // Return error response directly without format conversion
      let errorData;
      try {
        errorData = await claudeResponse.json();
      } catch (parseError) {
        console.error('Failed to parse Claude error response JSON:', {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          stack: parseError instanceof Error ? parseError.stack : undefined,
          responseSummary: {
            status: claudeResponse.status,
            statusText: claudeResponse.statusText,
            headers: headersToObject(claudeResponse.headers),
          },
        });
        errorData = { error: { message: 'Failed to parse error response', type: 'parse_error' } };
      }
      console.error('Claude API error data:', errorData);

      // If input length exceeded, retry once with reduced budgets
      try {
        const msg = String(errorData?.error?.message || '');
        if (/Range of input length should be\s*\[1,\s*129024\]/i.test(msg)) {
          console.warn('Retrying with reduced input budgets');
          claudeRequest = convertOpenAIToClaude({
            ...openAIRequest,
            max_tokens: Math.min((openAIRequest as OpenAIRequest).max_tokens || 262000, 1536),
          });
          claudeResponse = await fetch(`${env.ANTHROPIC_BASE_URL}/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              ...claudeRequest,
              max_tokens: Math.min(claudeRequest.max_tokens || 262000, 1536),
            }),
          });
        }
      } catch (e) {
        console.warn('Budget retry failed:', e);
      }

      if (!claudeResponse.ok) {
        try {
          errorData = await claudeResponse.json();
        } catch {}
        return new Response(JSON.stringify(errorData), {
          status: claudeResponse.status,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        });
      }
    }

    // Handle response based on stream mode
    if (isStream && claudeResponse.body) {
      console.log('=== Starting Claude to OpenAI Stream Conversion ===');
      // Transform Claude SSE to OpenAI format
      const transformedStream = claudeResponse.body.pipeThrough(
        createClaudeToOpenAITransform(openAIRequest.model)
      );

      console.log('Stream transformation created, returning response');
      return new Response(transformedStream, {
        status: claudeResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } else {
      // Convert non-streaming response
      let claudeData;
      try {
        claudeData = await claudeResponse.json();
      } catch (parseError) {
        console.error('Failed to parse Claude response JSON:', {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          stack: parseError instanceof Error ? parseError.stack : undefined,
          responseSummary: {
            status: claudeResponse.status,
            statusText: claudeResponse.statusText,
            headers: headersToObject(claudeResponse.headers),
          },
        });
        throw new Error('Failed to parse Claude API response');
      }
      const openAIResponse = claudeData;

      // Optional JSON schema validation (non-stream only)
      if (env.JSON_SCHEMA_VALIDATE) {
        const jsonSchemaValidate = String(env.JSON_SCHEMA_VALIDATE).toLowerCase();
        if (jsonSchemaValidate === 'true' || jsonSchemaValidate === '1') {
          const rf = (openAIRequest as OpenAIRequest).response_format as
            | { type: 'json_schema'; json_schema?: { schema?: Record<string, unknown> } }
            | undefined;
          const msg = openAIResponse?.choices?.[0]?.message;
          if (
            rf &&
            rf.type === 'json_schema' &&
            rf.json_schema?.schema &&
            msg &&
            typeof msg.content === 'string'
          ) {
            try {
              const parsed = JSON.parse(msg.content);
              const schema = rf.json_schema.schema as { required?: string[]; type?: string };
              const errors: string[] = [];
              if (schema && schema.type === 'object') {
                const req = Array.isArray(schema.required) ? schema.required : [];
                for (const key of req) {
                  if (!(key in (parsed as Record<string, unknown>))) {
                    errors.push(`Missing required property: ${key}`);
                  }
                }
              }
              if (errors.length > 0) {
                return new Response(
                  JSON.stringify({
                    error: {
                      message: 'Response does not conform to provided json_schema',
                      type: 'schema_validation_error',
                      details: errors,
                    },
                  }),
                  { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
              }
            } catch (e) {
              return new Response(
                JSON.stringify({
                  error: {
                    message: 'Response is not valid JSON',
                    type: 'schema_validation_error',
                    details: [e instanceof Error ? e.message : String(e)],
                  },
                }),
                { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          }
        }
      }

      return new Response(JSON.stringify(openAIResponse), {
        status: claudeResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  } catch (error) {
    console.error('Error in OpenAI to Claude conversion:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestSummary: {
        method: request.method,
        url: request.url,
        headers: headersToObject(request.headers),
      },
    });
    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          type: 'internal_error',
        },
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

/**
 * Handle Claude format request and forward to OpenAI API
 */
async function handleClaudeToOpenAI(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Parse request body
    let claudeRequest;
    try {
      claudeRequest = await request.json();
    } catch (parseError) {
      console.error('Failed to parse Claude request JSON:', {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        stack: parseError instanceof Error ? parseError.stack : undefined,
        requestSummary: {
          method: request.method,
          url: request.url,
          headers: headersToObject(request.headers),
        },
      });
      throw new Error('Invalid JSON request body');
    }
    const isStream = claudeRequest.stream === true;

    // Convert Claude request to OpenAI format
    const openAIRequest = formatRequestOpenAI(claudeRequest);
    if (!openAIRequest) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Invalid Claude request: conversion failed',
            type: 'invalid_request_error',
            details: { note: 'Please check required fields: model, messages, max_tokens' },
          },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Optional: validate/fix tool_calls pairing before sending to OpenAI
    const validationMode2 = (env.VALIDATE_TOOL_CALLS as Env['VALIDATE_TOOL_CALLS']) || 'off';
    if (validationMode2 !== 'off') {
      const validation = validateOpenAIToolCalls(openAIRequest.messages || []);
      if (!validation.valid) {
        if (validationMode2 === 'strict') {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  'Invalid tool_calls pairing: An assistant message with tool_calls must be followed by corresponding tool messages',
                type: 'invalid_request_error',
                details: validation.errors,
              },
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (validationMode2 === 'fix') {
          openAIRequest.messages = fixOrphanedToolCalls(openAIRequest.messages || []);
        }
      }
    }

    // Prepare headers for OpenAI API
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');

    // Add API key from request header or environment
    const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization');
    if (apiKey) {
      headers.set('Authorization', apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`);
    } else if (env.OPENAI_API_KEY) {
      headers.set('Authorization', `Bearer ${env.OPENAI_API_KEY}`);
    }

    // Forward to OpenAI API
    const openAIResponse = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(openAIRequest),
    });

    // Inspect Content-Type to detect non-JSON/HTML responses (e.g., login/SPA pages)
    const contentType = openAIResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = await openAIResponse.text();
      const textPreview = html.slice(0, 500);
      const isGPTLoadPage = /<title>\s*GPT\s+Load\s*<\/title>/i.test(html) || /id="app"/.test(html);
      const suggestion = isGPTLoadPage
        ? '检查 OPENAI_BASE_URL 是否指向了网站前端而非 API 域名；确认无登录重定向；在服务器侧直连官方 API 或正确的反代路径（/v1/...）。'
        : '收到 HTML 而非 JSON。请检查网关/反代是否将请求重定向到登录或前端页；确认 Authorization 头与 BASE_URL 正确。';

      return new Response(
        JSON.stringify({
          error: {
            message: 'Non-JSON HTML response received from upstream OpenAI endpoint',
            type: 'invalid_content_type',
            upstream: {
              status: openAIResponse.status,
              statusText: openAIResponse.statusText,
              contentType,
              textPreview,
            },
            possible_cause: isGPTLoadPage
              ? '请求被路由到一个前端应用（如“GPT Load”页），通常是反代/域名配置错误或需要登录的页面'
              : '反代/网关返回了 HTML（可能是登录/跳转/错误页）',
            suggestion,
          },
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if response is an error
    if (!openAIResponse.ok) {
      // Return error response directly without format conversion
      let errorData;
      try {
        errorData = await openAIResponse.json();
      } catch (parseError) {
        console.error('Failed to parse OpenAI error response JSON:', {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          stack: parseError instanceof Error ? parseError.stack : undefined,
          responseSummary: {
            status: openAIResponse.status,
            statusText: openAIResponse.statusText,
            headers: headersToObject(openAIResponse.headers),
          },
        });
        errorData = { error: { message: 'Failed to parse error response', type: 'parse_error' } };
      }
      return new Response(JSON.stringify(errorData), {
        status: openAIResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    // Handle response based on stream mode
    if (isStream && openAIResponse.body) {
      console.log('=== Starting OpenAI to Claude Stream Conversion ===');
      console.log('OpenAI response status:', openAIResponse.status);
      console.log('OpenAI response headers:', headersToObject(openAIResponse.headers));

      // For stream, ensure upstream is SSE
      if (!contentType.includes('text/event-stream')) {
        console.error('ERROR: Expected SSE but got:', contentType);
        // Some upstreams may still send JSON errors with 200; handle as error
        const text = await openAIResponse.text();
        return new Response(
          JSON.stringify({
            error: {
              message:
                'Expected text/event-stream for streaming response but received different content type',
              type: 'invalid_content_type',
              upstream: { contentType, status: openAIResponse.status },
              textPreview: text.slice(0, 500),
              suggestion:
                '确认已使用 stream:true 且上游返回了 SSE。若经反代，请配置不缓存且不改写 Content-Type。',
            },
          }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Creating OpenAI to Claude transform stream...');
      // Transform OpenAI SSE to Claude format
      const transformedStream = openAIResponse.body.pipeThrough(createOpenAIToClaudeTransform());
      console.log('Transform stream created, returning response');

      const response = new Response(transformedStream, {
        status: openAIResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
      console.log('OpenAI to Claude stream response created and being returned');
      return response;
    } else {
      // Convert non-streaming response (expect JSON)
      if (!contentType.includes('application/json')) {
        const text = await openAIResponse.text();
        return new Response(
          JSON.stringify({
            error: {
              message:
                'Expected application/json but received different content type from upstream',
              type: 'invalid_content_type',
              upstream: { contentType, status: openAIResponse.status },
              textPreview: text.slice(0, 500),
              suggestion: '确认调用的是 /v1/chat/completions API，且未被反代改写为 HTML/文本。',
            },
          }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let openAIData;
      try {
        openAIData = await openAIResponse.json();
      } catch (parseError) {
        console.error('Failed to parse OpenAI response JSON:', {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          stack: parseError instanceof Error ? parseError.stack : undefined,
          responseSummary: {
            status: openAIResponse.status,
            statusText: openAIResponse.statusText,
            headers: headersToObject(openAIResponse.headers),
          },
        });
        throw new Error('Failed to parse OpenAI API response');
      }
      const claudeResponse = formatResponseOpenAI(openAIData);

      return new Response(JSON.stringify(claudeResponse), {
        status: openAIResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  } catch (error) {
    console.error('Error in Claude to OpenAI conversion:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestSummary: {
        method: request.method,
        url: request.url,
        headers: headersToObject(request.headers),
      },
    });
    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          type: 'internal_error',
        },
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

function handleRootRequest(corsHeaders: Record<string, string>): Response {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OpenAI Router</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 2rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }
        .container {
          background: white;
          border-radius: 8px;
          padding: 2rem;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        h1 {
          color: #333;
          margin-bottom: 1rem;
        }
        .endpoints {
          background: #f7f7f7;
          padding: 1rem;
          border-radius: 4px;
          margin-top: 1rem;
        }
        code {
          background: #e2e2e2;
          padding: 0.2rem 0.4rem;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
        }
        .endpoint {
          margin: 0.5rem 0;
        }
        .status {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          background: #10b981;
          color: white;
          border-radius: 4px;
          font-size: 0.875rem;
          margin-bottom: 1rem;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="status">Active</div>
        <h1>🚀 OpenAI Router</h1>
        <p>A Cloudflare Workers-based router for OpenAI and Anthropic APIs with bidirectional format conversion.</p>
        
        <div class="endpoints">
          <h2>Format Conversion Endpoints:</h2>
          <div class="endpoint">
            <strong>OpenAI → Claude:</strong> <code>POST /v1/chat/completions</code>
            <br><small>Use OpenAI format to call Claude API</small>
          </div>
          <div class="endpoint">
            <strong>Claude → OpenAI:</strong> <code>POST /v1/messages</code>
            <br><small>Use Claude format to call OpenAI API</small>
          </div>
        </div>
        
        <div class="endpoints">
          <h2>Direct Proxy Endpoints (No Conversion):</h2>
          <div class="endpoint">
            <strong>OpenAI Direct:</strong> <code>/openai/*</code>
            <br><small>Direct proxy to OpenAI API</small>
          </div>
          <div class="endpoint">
            <strong>Anthropic Direct:</strong> <code>/anthropic/*</code>
            <br><small>Direct proxy to Anthropic API</small>
          </div>
        </div>
        
        <div class="endpoints">
          <h2>Features:</h2>
          <div class="endpoint">✅ Bidirectional format conversion</div>
          <div class="endpoint">✅ Streaming support</div>
          <div class="endpoint">✅ Tool/Function calling support</div>
          <div class="endpoint">✅ Complete API compatibility</div>
        </div>
      </div>
    </body>
    </html>
  `;

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html',
    },
  });
}
