# Inference connections

In the web app, each browser session configures its own connection for Meta, OpenRouter, OpenAI, Google, Anthropic, NVIDIA or DeepSeek. One profile is active at a time. Saving or selecting a profile makes no network request. A failed request never switches to another provider, model or key. Browser settings live in server memory, expire after 30 minutes of inactivity or a restart, and never fall back to a server environment or settings file. Custom endpoints are unavailable in browser sessions.

The direct local Python and CLI interfaces retain their separate file and environment configuration; they are not used as a fallback for web sessions.

The Meta connection accepts `muse-spark-1.3-contributor` and `muse-spark-1.2-contributor` for generation and tool conversations. The default is `muse-spark-1.3-contributor`; you can explicitly choose another supported model. Meta describes Contributor mode as permitting use of submitted content to train future models; see [Meta pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits). Availability and capabilities depend on the account. On 3 November 2026, one direct request using this account and a synthetic “Reply with exactly OK.” prompt returned the `muse-spark-1.3-contributor` identifier and a completed stop. A separate synthetic low-effort structured-JSON request through the app's `MetaClient.generate` also succeeded, with 157 completion tokens reported. These two calls establish only those specific request outcomes. Contributor-mode tool calling and the 1.2 Contributor model were not tested live. Both additions have offline transport tests.

## What has been verified

The adapters have offline tests for request fields, authentication headers, response parsing, tool histories, image conversion, settings persistence, secret filtering, error handling and redirect refusal. The existing Meta transport tests still pass. These tests use synthetic responses; they are **not live verification of accounts, model access, output quality or provider availability**. No additional provider credentials were requested or used to implement this layer.

Except for the existing supported Meta models, the app does not guess a model name. Enter the identifier listed by your provider. For other providers, image input, function calling and structured reports start disabled. Enable a capability only when the selected model and endpoint document support for it. These switches describe the connection's configured contract; they do not certify the model's capabilities.

| Provider | Implemented API | Relevant behavior |
| --- | --- | --- |
| Meta | Chat completions | Existing strict JSON schema, images and function calls; existing low/medium/high reasoning control. |
| OpenRouter | Chat completions | Uses one model, requires parameter support and explicitly disables provider fallback. Optional reasoning effort uses its `reasoning` object. |
| OpenAI | Chat completions | Uses its existing chat contract, strict JSON schema and optional reasoning effort. Model support varies. The Responses API is not implemented here. |
| Google | Native `generateContent` | Uses `systemInstruction`, `contents`, `inlineData`, `responseJsonSchema`, function declarations and function responses. It does not send a chat-completions envelope. |
| Anthropic | Native Messages | Uses content blocks, top-level system content, `input_schema`, `tool_use`/`tool_result` and `output_config.format`. Uses version `2026-10-21`. |
| NVIDIA | Hosted chat completions | Uses `max_tokens`; tools, images and output format depend on the selected model endpoint. |
| DeepSeek | Chat completions | Uses `max_tokens`, JSON object mode and explicit `thinking: {type: disabled}`. It does not claim strict server-enforced JSON schema or image support for an arbitrary model. |
| Custom endpoint | Explicitly selected protocol | Chat completions by default; native Messages or `generateContent` can also be selected. The service must implement the chosen contract. |

Some application calls request a reasoning level. That field is sent only when the configured connection supports the implemented control. Returned `Generation.reasoning_effort` and `ToolTurn.reasoning_effort` identify the effort actually sent, or `None` when omitted. A requested level alone is not confirmation that it was applied. Native Google/Anthropic reasoning controls are not implemented in this version.

## Local settings API (direct Python and CLI use)

Functions in `reshivo.providers` accept `root=ROOT, environ=None` for isolated use and testing:

- `provider_catalog()` returns provider names, base URLs, protocols, conservative defaults and documentation links.
- `provider_settings(...)` returns the active connection and a masked `profiles` list.
- `save_provider_settings(payload, ...)` upserts and selects a profile.
- `select_provider_settings(provider_id, ...)` selects a saved profile without re-entering its key. Meta can also select the original `.env` connection.
- `clear_provider_settings(provider_id, ...)` removes one saved profile. If it was active, the original Meta connection becomes active.
- `clear_provider_settings(root=..., environ=...)` removes all saved profiles. It does not edit `.env`.
- `load_provider_profile(...)` is for server-side transport only; it contains the credential and must never be returned to the browser.

Example save payload, with placeholder values:

```json
{
  "provider": "google",
  "model": "MODEL_IDENTIFIER_FROM_PROVIDER",
  "base_url": "https://generativelanguage.googleapis.com/v1beta",
  "api_key": "ENTER_LOCALLY",
  "capabilities": {
    "vision": false,
    "tool_calls": true,
    "structured_output": "json_schema",
    "reasoning": false
  }
}
```

`structured_output` is `none`, `json_object` or `json_schema`. Native Google/Anthropic reports use schema mode. DeepSeek's implemented chat connection uses JSON object mode. Some Anthropic keys also require `workspace_id`, such as `wrkspc_WORKSPACE_IDENTIFIER`; leave it blank for a key already scoped to its workspace.

An omitted or blank key keeps the saved key only when both provider and base URL match. Setting `clear_api_key: true` with no replacement explicitly clears that profile's key. A first explicit Meta profile may retain the original `.env` key when its endpoint matches. Changing the endpoint never silently transfers the old key.

For direct local use without a browser session, settings are stored in `.env.providers.json`, already covered by the repository's ignore rules, with file mode `0600`. Multiple profiles are retained in `{active_provider, profiles}`. The file contains credentials in local plaintext; it is not an encrypted vault. Status shows `key_configured` and a fixed mask, never a key suffix or plaintext key. Symlinks, invalid settings, unsafe permissions and unreadable files are rejected rather than silently using another connection. Clearing all saved profiles can recover a damaged settings file.

## Transport and output limits

Connections use HTTPS. Custom endpoints are limited to direct local use, not browser sessions. Plain HTTP is permitted only for the custom endpoint on `localhost` or a literal loopback address. Custom remote endpoints must use HTTPS and an API key. Named providers require their official host; use Custom endpoint deliberately for a gateway or proxy. URLs cannot include embedded credentials, query parameters or fragments. Supply the API **base URL**, excluding the final method path.

The transport refuses redirects, retries and fallbacks. It bounds generation requests to 3.2 MB, tool requests to 192 KiB, responses to 512 kB and completion requests to 8,192 tokens. HTTP errors expose a status code rather than the remote response body. Credentials are rejected in request content and returned JSON. Keys are sent in authentication headers, never URL parameters.

Native tool replies become the same bounded canonical tool calls already checked by the application. Native IDs are retained where usable; generated canonical IDs map privately back to Google's original call IDs. Opaque thought signatures and native tool context stay on the client and are replayed in subsequent turns. They are not exposed as user-visible reasoning. Missing signed context stops the conversation; the adapter does not fabricate a replacement.

For JSON object mode, the schema is supplied as a format instruction and the returned value is checked locally. Anthropic's documented unsupported number, string and array bounds are moved into field descriptions; the original report bounds are checked locally. Local checking covers the schema vocabulary emitted by this app, including objects, required fields, arrays, types, enums, local references, alternatives and numerical/string/array bounds. It is not a general-purpose implementation of every JSON Schema keyword. A rejected report is not automatically retried or repaired.

## Official contracts checked on 3 November 2026

- [Meta developer documentation](https://dev.meta.ai/docs)
- [OpenRouter chat API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request), [structured output](https://openrouter.ai/docs/guides/features/structured-outputs) and [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenAI chat completion API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [structured output](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)
- [Google generateContent reference](https://ai.google.dev/api/generate-content), [function calling](https://ai.google.dev/gemini-api/docs/function-calling) and [thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [authentication overview](https://platform.claude.com/docs/en/api/overview) and [structured output constraints](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [NVIDIA hosted language APIs](https://docs.api.nvidia.com/nim/reference/llm-apis)
- [DeepSeek chat API](https://api-docs.deepseek.com/api/create-chat-completion/), [JSON mode](https://api-docs.deepseek.com/guides/json_mode/) and [thinking/tool history](https://api-docs.deepseek.com/guides/thinking_mode/)
