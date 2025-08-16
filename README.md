[English](./README.md) | [中文](./README.zh-CN.md)

# openai-router

[![License](https://img.shields.io/badge/License-Apache_2.0-yellow.svg)](https://opensource.org/licenses/Apache-2.0)
[![Claude Code Compatible](https://img.shields.io/badge/Claude%20Code-Compatible-blue)](https://claude.ai/code)

A Cloudflare Worker that translates between Anthropic's Claude API and OpenAI API. This allows you to use Claude-compatible clients with OpenAI models.

## Features

openai-router acts as a translation layer that:
- Accepts requests in the Anthropic API format.
- Converts the request to OpenAI's format.
- Forwards the request to the OpenAI API.
- Converts the OpenAI API's response back into Anthropic's format.
- Supports both streaming and non-streaming responses.

This tool is particularly useful for tools that natively support the Claude API, like Claude Code, allowing them to seamlessly switch to using OpenAI models.

## Quick Start

### Manual Setup

**Step 1:** Get an OpenAI API key from [OpenAI Platform](https://platform.openai.com/api-keys).

**Step 2:** Configure your client to use the openai-router's endpoint. For example, for Claude Code, you can set the following environment variables in your shell profile (`~/.bashrc` or `~/.zshrc`):

```bash
export ANTHROPIC_BASE_URL="https://xxxx" // Your deployed Cloudflare worker instance address
export ANTHROPIC_API_KEY="your-openai-api-key"
export ANTHROPIC_MODEL="gpt-4"
export ANTHROPIC_SMALL_FAST_MODEL="gpt-3.5-turbo"
```

## Self-Hosting

For better reliability and control, you can deploy your own instance of openai-router.

1. **Clone and deploy:**
   ```bash
   git clone https://github.com/takltc/openai-router
   cd openai-router
   npm install -g wrangler
   wrangler deploy
   ```

2. **Set environment variables:**
   
   ```bash
   # Optional: defaults to https://api.openai.com/v1
   wrangler secret put OPENAI_BASE_URL
   ```
   
3. **Configure your client:**
   - Set the API endpoint to your deployed Worker URL.
   - Use your own OpenAI API key.

## Development

```bash
npm run dev    # Start the development server
npm run deploy # Deploy to Cloudflare Workers
```

## Disclaimer

**Important Legal Notice:**

- **Third-Party Tool**: openai-router is an independent, unofficial tool and is not affiliated with, endorsed by, or supported by Anthropic PBC or OpenAI in any way.
- **Terms of Service**: Users are responsible for ensuring their usage complies with the terms of service of all relevant parties, including Anthropic, OpenAI, and any other API providers.
- **API Key Responsibility**: Users must use their own valid API keys and are solely responsible for any usage, costs, or violations associated with those keys.
- **No Warranty**: This software is provided "as is" without any warranty of any kind. The author is not responsible for any damages, service interruptions, or legal issues that may arise from its use.
- **Data Privacy**: While openai-router does not intentionally store user data, users should review the privacy policies of all connected services.
- **Compliance**: Users are responsible for ensuring their usage complies with all applicable laws and regulations in their jurisdiction.

**Use at your own risk.**
