-- Drop legacy table
DROP TABLE IF EXISTS public.rewrite_versions;

-- New semantic versioning table
CREATE TABLE public.optimizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  
  original_text_snapshot TEXT,
  optimized_text TEXT,
  
  original_score INT,
  optimized_score INT,
  
  change_log JSONB,         -- AI-authored "changesMade"
  unaddressed_items JSONB,  -- AI-authored "what's missing"
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (report_id, version_number)
);

CREATE INDEX idx_optimizations_report_id ON public.optimizations(report_id);

-- Remove obsolete column
ALTER TABLE public.reports DROP COLUMN IF EXISTS optimization_data;

-- Add comments for documentation
COMMENT ON TABLE public.optimizations IS 'Stores semantic optimization history with AI-authored change tracking';
COMMENT ON COLUMN public.optimizations.report_id IS 'Reference to the original audit report';
COMMENT ON COLUMN public.optimizations.version_number IS 'Sequential version number for this report';
COMMENT ON COLUMN public.optimizations.change_log IS 'AI-authored list of changes made during optimization';
COMMENT ON COLUMN public.optimizations.unaddressed_items IS 'AI-authored list of items that still need attention';
