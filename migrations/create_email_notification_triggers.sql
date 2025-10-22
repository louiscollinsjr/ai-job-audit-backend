-- Migration: Email notification triggers for user auth and job scoring events
-- Run this in your Supabase SQL Editor

-- 1. Create function to call Edge Function for user signups
CREATE OR REPLACE FUNCTION notify_user_signup()
RETURNS TRIGGER AS $$
BEGIN
  -- Call the Edge Function via pg_net extension
  PERFORM
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'type', 'user_signup',
        'data', jsonb_build_object(
          'user_email', NEW.email,
          'user_id', NEW.id
        )
      )
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create trigger on auth.users table for new signups
DROP TRIGGER IF EXISTS on_user_signup ON auth.users;
CREATE TRIGGER on_user_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION notify_user_signup();

-- 3. Create function to call Edge Function for job scoring
CREATE OR REPLACE FUNCTION notify_job_scored()
RETURNS TRIGGER AS $$
BEGIN
  -- Call the Edge Function via pg_net extension
  PERFORM
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'type', 'job_scored',
        'data', jsonb_build_object(
          'job_url', NEW.job_url,
          'score', NEW.overall_score,
          'report_id', NEW.id,
          'user_email', (SELECT email FROM auth.users WHERE id = NEW.user_id)
        )
      )
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create trigger on reports table for new job scores
DROP TRIGGER IF EXISTS on_job_scored ON public.reports;
CREATE TRIGGER on_job_scored
  AFTER INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_scored();

-- 5. Grant necessary permissions
GRANT USAGE ON SCHEMA net TO postgres, anon, authenticated, service_role;

-- Note: You'll need to enable the pg_net extension first:
-- Go to Database > Extensions in Supabase Dashboard and enable "pg_net"
