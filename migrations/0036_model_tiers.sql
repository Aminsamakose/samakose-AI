-- Model routing: record which tier (luna, sol, astra) handled each AI request so cost and quality can be compared by tier. Additive.
ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS tier text;
