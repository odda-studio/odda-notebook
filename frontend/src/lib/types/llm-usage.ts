/** Token usage of one LLM call (fields a provider doesn't report are null). */
export interface LlmUsage {
  model: string | null
  input_tokens: number | null
  /** Reasoning included. */
  output_tokens: number | null
  reasoning_tokens: number | null
  cached_input_tokens: number | null
  total_tokens: number | null
  /** Output budget of the call. */
  max_output_tokens: number | null
  /** Local estimate of the prompt before sending it. */
  prompt_tokens_estimate: number | null
  /** "length" = the output budget was exhausted. */
  finish_reason: string | null
  duration_seconds: number | null
}
