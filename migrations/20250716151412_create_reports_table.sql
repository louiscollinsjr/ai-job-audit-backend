-- Create reports table
CREATE TABLE public.reports (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  userid UUID NOT NULL,
  jobtitle TEXT NOT NULL,
  jobbody TEXT NOT NULL,
  feedback TEXT NULL,
  totalscore INTEGER NULL,
  categories JSONB NULL,
  recommendations JSONB NULL,
  redflags JSONB NULL,
  savedat TIMESTAMP WITH TIME ZONE NULL,
  source TEXT NULL,
  originalreport JSONB NULL,
  json_ld JSONB NULL,
  improved_text TEXT NULL,
  original_text TEXT NULL,
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_userid_fkey FOREIGN KEY (userid) 
    REFERENCES auth.users (id)
) TABLESPACE pg_default;

-- Add comments to explain the table
COMMENT ON TABLE public.reports IS 'Stores job posting audit reports';
COMMENT ON COLUMN public.reports.userid IS 'ID of the user who created the report';
COMMENT ON COLUMN public.reports.jobtitle IS 'Title of the job being analyzed';
COMMENT ON COLUMN public.reports.jobbody IS 'Full text of the job posting';
COMMENT ON COLUMN public.reports.totalscore IS 'Overall job posting visibility score';
COMMENT ON COLUMN public.reports.json_ld IS 'Structured JSON-LD schema.org data';

-- Create indexes for faster queries
CREATE INDEX idx_reports_userid ON public.reports (userid);
CREATE INDEX idx_reports_savedat ON public.reports (savedat);
