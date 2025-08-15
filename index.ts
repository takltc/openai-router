/**
 * OpenAI Router for Cloudflare Workers
 * @author jizhejiang
 * @date 2025-08-11
 * @description Routes OpenAI and Anthropic API requests through Cloudflare Workers with format conversion
 */

import { formatRequestClaude } from './utils/formatRequestClaude';
import { convertClaudeToOpenAI } from './utils/formatRequestOpenAI';
import { formatResponseOpenAI } from './utils/formatResponseOpenAI';
import { formatResponseClaude } from './utils/formatResponseClaude';
import { createOpenAIToClaudeTransform } from './utils/streamResponseOpenAI';
import { createClaudeToOpenAITransform } from './utils/streamResponseClaude';
import { validateOpenAIToolCalls, fixOrphanedToolCalls } from './utils/validateToolCalls';
import type { OpenAIRequest } from './utils/types';

export interface Env {
  OPENAI_BASE_URL: string;
  ANTHROPIC_BASE_URL: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  VALIDATE_TOOL_CALLS?: 'off' | 'strict' | 'fix';
  JSON_SCHEMA_VALIDATE?: 'true' | 'false' | '1' | '0';
  DEFAULT_MAX_TOKENS_MAP?: string;
  CLAUDE_DEFAULT_MAX_OUTPUT_TOKENS?: string;
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
    const claudeRequest = formatRequestClaude(openAIRequest as OpenAIRequest);
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
    const claudeResponse = await fetch(`${env.ANTHROPIC_BASE_URL}/messages`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(claudeRequest),
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
      return new Response(JSON.stringify(errorData), {
        status: claudeResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
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
      const openAIResponse = formatResponseClaude(claudeData, openAIRequest as OpenAIRequest);

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
    const openAIRequest = convertClaudeToOpenAI(claudeRequest);
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
