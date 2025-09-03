-- Create resolutions table for tracking user-resolved issues
CREATE TABLE resolutions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    optimization_id UUID NOT NULL REFERENCES optimizations(id) ON DELETE CASCADE,
    issue_category TEXT NOT NULL,
    issue_summary TEXT NOT NULL,
    resolved_by_user_id UUID REFERENCES auth.users(id),
    resolved_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Prevent duplicate resolutions for the same issue
    CONSTRAINT unique_resolution_per_issue UNIQUE (optimization_id, issue_category, issue_summary)
);

-- Index for efficient lookups by optimization_id
CREATE INDEX idx_resolutions_optimization_id ON resolutions(optimization_id);

-- Index for user queries
CREATE INDEX idx_resolutions_user_id ON resolutions(resolved_by_user_id);

-- Index for temporal queries
CREATE INDEX idx_resolutions_resolved_at ON resolutions(resolved_at);

-- Add RLS (Row Level Security) policies
ALTER TABLE resolutions ENABLE ROW LEVEL SECURITY;

-- Users can only see resolutions for optimizations they have access to
CREATE POLICY "Users can view resolutions for their reports" ON resolutions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM optimizations o
            JOIN reports r ON o.report_id = r.id
            WHERE o.id = optimization_id 
            AND (r.userid = auth.uid() OR r.userid IS NULL)
        )
    );

-- Users can create resolutions for optimizations they have access to
CREATE POLICY "Users can create resolutions for their reports" ON resolutions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM optimizations o
            JOIN reports r ON o.report_id = r.id
            WHERE o.id = optimization_id 
            AND (r.userid = auth.uid() OR r.userid IS NULL)
        )
    );

-- Users can update their own resolutions
CREATE POLICY "Users can update their own resolutions" ON resolutions
    FOR UPDATE USING (resolved_by_user_id = auth.uid());

-- Users can delete their own resolutions  
CREATE POLICY "Users can delete their own resolutions" ON resolutions
    FOR DELETE USING (resolved_by_user_id = auth.uid());
