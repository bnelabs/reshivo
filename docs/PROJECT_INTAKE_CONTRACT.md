# Prompt-first project intake

`read_project_intake(request, *, client=None, root=ROOT)` makes one explicit
`MetaClient.generate` call. Validation and module import make no model calls. The
caller owns the explicit user action and the later review/apply action; this
function never updates a case, chooses a route, creates a trial or calculates a dose.

## Request

- `message`: nonempty user text, at most 4000 characters. No completed brief required.
- `history` (optional): at most six recent `{role, content}` entries. Roles are
  `user` or `assistant`; each content is at most 3000 characters. Message plus
  history is at most 18000 characters. Indices refer to this exact supplied order.
- `reviewed_draft` (optional, or null): the seven-field draft below, explicitly
  reviewed/edited by the user. Its literal values are normalized to
  `{value, source: "user_review", quote: value}`. This preserves confirmed facts
  across history limits, manual edits and Save/Open. The caller must not label
  an unreviewed assistant draft as reviewed.

Unknown request keys, oversized conversation and malformed reviewed drafts fail
before generation with `ProductInputError`. Requests are not mutated or truncated.

## Response

The model returns exactly `reply` (up to 1200 characters), `project_draft`,
`questions` (zero to three distinct strings, each up to 350 characters), and
`first_step` (a useful concrete action, up to 700 characters). No route arrays,
whole trial, hidden result or model-supplied assurance fields are accepted.

`project_draft` has exactly these fields:

`product`, `input`, `variation`, `use`, `priorities`, `process`, `constraints`.

Each is null when unknown, otherwise `{value, source, quote}`. `source` is
`message`, `history.N` (N from 0 to 5), or `user_review`. History evidence must
be from a **user** entry. For message/history, `quote` must occur literally in
that source and `value` literally inside the quote without clipping a numeric
token. For `user_review`, value must exactly equal the same field in the supplied
reviewed draft, with quote=value; another field cannot supply its evidence.
Values are at most 1000 characters; quotes at most
1500. Amounts and units stay text exactly as supplied: no conversion, rounding,
numeric inference from adjectives, invented price/limit or image-based material
identification. A quote match checks literal provenance, **not semantic truth,
correct interpretation or physical validation**. The reviewer must check meaning,
negation, relevance, material identity and quantities before applying a draft.

The backend adds:

- `result_kind: "project_intake"` and a SHA-256 `request_fingerprint` for binding.
- `readiness: "can_explore"` when product, input and either use or priorities are
  present; otherwise `"needs_context"`. Missing context requires at least one
  question on initial turns. After at least two earlier user turns, further
  questions are optional so the helper can offer a conditional step and state
  unknowns. `unknown_fields` lists null fields. Readiness permits conditional
  ideas, not physical predictions, and does not block exploration.
- `review_required: true`, `interpretation_verified: false`,
  `ready_for_calculation: false`, `physical_product_tested: false`,
  `performance_verified: false`.
- Transport metadata: provider (generation's provider, default `meta`), model,
  live, usage, request_id, elapsed_ms, requested_reasoning_effort.

Floor-mat clarification starts with the job (comfort, grip, wear, cleaning), use
and available input. Sound-sheet clarification starts with sound blocking versus
room echo versus impact noise, the source and installation. Engineering units are
not an entry requirement; supplied units are preserved. These are prompt guidance,
not a claim that offline fixtures prove live conversational quality. Other product
types remain open. Known unknowns should support a useful first comparison rather
than an endless mandatory questionnaire. Numerical calculations need their own
matching data and suitable calculation after review.

Malformed, empty or ungrounded model output raises `MetaValidationError`.
Configuration, transport and truncated-response errors propagate unchanged;
there is no substitute advice or fake fallback. The injectable client supports
offline checks. Other providers are not claimed configured by this module.
