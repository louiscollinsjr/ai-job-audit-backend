-- ============================================================================
-- Supabase User Signup Notification Trigger
-- ============================================================================
-- This trigger calls your backend webhook whenever a new user signs up.
-- Uses pg_net extension for direct HTTP calls from Postgres.
--
-- SETUP INSTRUCTIONS:
-- 1. Enable pg_net extension (see below)
-- 2. Update YOUR_BACKEND_URL with your actual backend URL
-- 3. Run this SQL in Supabase SQL Editor
-- ============================================================================

-- Step 1: Enable pg_net extension (if not already enabled)
-- Go to: Database > Extensions > Search "pg_net" > Enable
-- Or run this (requires superuser):
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Step 2: Grant permissions
GRANT USAGE ON SCHEMA net TO postgres, anon, authenticated, service_role;

-- Step 3: Create the notification function
CREATE OR REPLACE FUNCTION notify_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  webhook_url TEXT;
  webhook_secret TEXT;
  request_id BIGINT;
BEGIN
  -- ⚠️ UPDATE THESE VALUES:
  -- For local testing with ngrok:
  webhook_url := 'https://YOUR-NGROK-URL.ngrok-free.app/api/supabase-auth-webhook';
  
  -- For production:
  -- webhook_url := 'https://api.jobpostscore.com/api/supabase-auth-webhook';
  
  webhook_secret := 'a7f8e9d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8';

  -- Make async HTTP POST request using pg_net
  SELECT net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-signature', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'record', jsonb_build_object(
        'id', NEW.id,
        'email', NEW.email,
        'created_at', NEW.created_at
      )
    )
  ) INTO request_id;

  -- Log the request (optional, for debugging)
  RAISE NOTICE 'User signup webhook triggered for %. Request ID: %', NEW.email, request_id;

  RETURN NEW;
END;
$$;

-- Step 4: Create the trigger
DROP TRIGGER IF EXISTS on_user_signup ON auth.users;
CREATE TRIGGER on_user_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION notify_user_signup();

-- ============================================================================
-- TESTING
-- ============================================================================
-- After running this, sign up with a new email and check:
-- 1. Your backend logs for webhook received
-- 2. Your email for signup notification
--
-- To check pg_net request status:
-- SELECT * FROM net._http_response ORDER BY created DESC LIMIT 10;
-- ============================================================================

-- ============================================================================
-- CLEANUP (if you need to remove the trigger)
-- ============================================================================
-- DROP TRIGGER IF EXISTS on_user_signup ON auth.users;
-- DROP FUNCTION IF EXISTS notify_user_signup();
-- ============================================================================
