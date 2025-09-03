-- Enable Row Level Security on optimizations table
ALTER TABLE public.optimizations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access optimizations for their own reports
CREATE POLICY "Users can access optimizations for their own reports" ON public.optimizations
  FOR ALL USING (
    report_id IN (
      SELECT id FROM public.reports 
      WHERE userid = auth.uid()
    )
  );

-- Policy: Service role can access all optimizations (for API operations)
CREATE POLICY "Service role can access all optimizations" ON public.optimizations
  FOR ALL TO service_role USING (true);

-- Grant necessary permissions
GRANT ALL ON public.optimizations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.optimizations TO authenticated;
