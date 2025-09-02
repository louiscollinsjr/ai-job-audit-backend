-- Migration: Add optimization_data column to reports table
-- This column will store cached optimization results as JSON

ALTER TABLE reports 
ADD COLUMN IF NOT EXISTS optimization_data JSONB;

-- Add an index on optimization_data for performance
CREATE INDEX IF NOT EXISTS idx_reports_optimization_data 
ON reports USING GIN (optimization_data);

-- Add comment for documentation
COMMENT ON COLUMN reports.optimization_data IS 'Cached optimization results including optimized text, scores, and improvements';
