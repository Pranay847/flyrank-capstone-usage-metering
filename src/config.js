export const plans = {
  free: { api_calls: 1000, ai_tokens: 100000 },
  pro: { api_calls: 50000, ai_tokens: 5000000 }
};

// Integer microcents; no floating-point money.
export const pricing = {
  api_call: 100,
  input_token: 50,
  cached_input_token: 5,
  output_token: 200,
  reasoning_token: 200
};

export function tokenCost(parts) {
  return parts.input * pricing.input_token + parts.cached_input * pricing.cached_input_token +
    parts.output * pricing.output_token + parts.reasoning * pricing.reasoning_token;
}
