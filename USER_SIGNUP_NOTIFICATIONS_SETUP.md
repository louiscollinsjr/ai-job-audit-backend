# User Signup Notifications Setup Guide

This guide explains how to safely add email notifications for new user signups **without modifying your production auth flow**.

## ✅ Safe Implementation: Supabase Auth Webhooks (Recommended)

This approach uses Supabase's built-in auth webhooks, which means:
- ✅ **Zero frontend changes** - No risk to production auth flow
- ✅ **Automatic detection** - Supabase tells us when users sign up
- ✅ **Production-safe** - Completely decoupled from your login logic
- ✅ **Works for all methods** - Magic link, OAuth, etc.

---

## Setup Steps

### 1. Add Webhook Secret to Environment

Add to `/backend/.env`:

```bash
# Supabase Auth Webhook Secret (generate a random string)
SUPABASE_WEBHOOK_SECRET=your-random-secret-here-min-32-chars
```

Generate a secure secret:
```bash
# On Mac/Linux:
openssl rand -hex 32

# Or use any random string generator
```

### 2. Deploy Your Backend

Make sure your backend is accessible from the internet (Supabase needs to reach it).

**Local Development:**
- Use ngrok or similar: `ngrok http 3001`
- Note the public URL: `https://abc123.ngrok.io`

**Production:**
- Your backend should already be deployed
- Note your backend URL: `https://your-backend.com`

### 3. Configure Supabase Auth Webhook

1. Go to **Supabase Dashboard** → Your Project
2. Navigate to **Authentication** → **Webhooks**
3. Click **Create a new hook**
4. Configure:
   - **Name**: User Signup Notifications
   - **Event**: `auth.user.created` or `INSERT on auth.users`
   - **Webhook URL**: `https://your-backend.com/api/supabase-auth-webhook`
   - **HTTP Headers** (optional):
     ```
     x-webhook-signature: your-random-secret-here-min-32-chars
     ```
   - **Method**: POST
5. Click **Create**

### 4. Test It

#### Test with a New Signup:

1. Go to your login page: `https://your-app.com/login`
2. Enter a **new email address** (one that hasn't signed up before)
3. Complete the magic link flow
4. Check your email (APP_OWNER_EMAIL) for the notification!

#### Test with Existing User:

- Existing users logging in again **won't** trigger notifications (only new signups)

#### Check Backend Logs:

```bash
# You should see:
[Auth Webhook] Received event: INSERT
[Auth Webhook] New user signup detected: user@example.com
[Auth Webhook] Signup notification sent
✅ Email sent via Resend: re_xxxxx
```

---

## Alternative: Database Trigger (More Robust)

If you want a more reliable solution that doesn't depend on webhooks:

### Setup SQL Trigger in Supabase

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Run this SQL:

```sql
-- Create function to call your backend API when user signs up
CREATE OR REPLACE FUNCTION notify_new_user_signup()
RETURNS TRIGGER AS $$
DECLARE
  webhook_url TEXT := 'https://your-backend.com/api/supabase-auth-webhook';
  payload JSONB;
BEGIN
  -- Build payload
  payload := jsonb_build_object(
    'type', 'INSERT',
    'record', jsonb_build_object(
      'id', NEW.id,
      'email', NEW.email,
      'created_at', NEW.created_at
    )
  );

  -- Call webhook asynchronously using pg_net
  PERFORM
    net.http_post(
      url := webhook_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-signature', 'your-random-secret-here-min-32-chars'
      ),
      body := payload
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users table
DROP TRIGGER IF EXISTS on_new_user_signup ON auth.users;
CREATE TRIGGER on_new_user_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_user_signup();
```

3. **Enable pg_net extension** (if not already enabled):
   - Go to **Database** → **Extensions**
   - Search for `pg_net`
   - Click **Enable**

---

## Troubleshooting

### Webhook Not Firing

**Check Supabase Webhook Logs:**
1. Go to **Authentication** → **Webhooks**
2. Click on your webhook
3. View **Recent Deliveries**
4. Check for errors

**Common Issues:**
- ❌ Backend URL not accessible from internet
- ❌ Webhook secret mismatch
- ❌ Backend not running
- ❌ Firewall blocking Supabase IPs

### Emails Not Sending

**Check Backend Logs:**
```bash
# Look for these messages:
[Auth Webhook] Received event: INSERT
[Auth Webhook] New user signup detected: user@example.com
✅ Email sent via Resend: re_xxxxx
```

**If you see errors:**
- Check `RESEND_API_KEY` is set correctly
- Check `APP_OWNER_EMAIL` is set
- Check `FROM_EMAIL` is verified in Resend
- Check Resend dashboard for delivery status

### Testing Locally with ngrok

```bash
# Terminal 1: Start your backend
cd backend
npm start

# Terminal 2: Start ngrok
ngrok http 3001

# Copy the ngrok URL (e.g., https://abc123.ngrok.io)
# Use this URL in Supabase webhook configuration
```

---

## Security Considerations

### Webhook Secret

**Why it's important:**
- Prevents unauthorized requests to your webhook endpoint
- Ensures only Supabase can trigger notifications

**Best practices:**
- Use a strong, random secret (min 32 characters)
- Store in environment variables, never commit to git
- Rotate periodically

### Rate Limiting

Consider adding rate limiting to prevent abuse:

```javascript
// In supabase-auth-webhook.js
const rateLimit = new Map();

function checkRateLimit(email) {
  const now = Date.now();
  const lastRequest = rateLimit.get(email);
  
  if (lastRequest && now - lastRequest < 60000) { // 1 minute
    return false; // Too many requests
  }
  
  rateLimit.set(email, now);
  return true;
}
```

---

## What Gets Sent

When a new user signs up, you'll receive an email like this:

```
Subject: 🎉 New User Signup - JobPostScore

New User Signed Up!

User Email: user@company.com
User ID: 123e4567-e89b-12d3-a456-426614174000
Time: 10/22/2025, 11:30:00 AM

This is an automated notification from JobPostScore.
```

---

## Production Checklist

Before deploying to production:

- [ ] Backend deployed and accessible from internet
- [ ] `SUPABASE_WEBHOOK_SECRET` set in production environment
- [ ] `RESEND_API_KEY` set and verified
- [ ] `APP_OWNER_EMAIL` set to correct email(s)
- [ ] `FROM_EMAIL` domain verified in Resend
- [ ] Supabase webhook configured with production URL
- [ ] Webhook secret matches between Supabase and backend
- [ ] Tested with a new signup in production
- [ ] Email received successfully

---

## Monitoring

### Check Webhook Health

**Supabase Dashboard:**
- Authentication → Webhooks → View Recent Deliveries
- Look for 200 status codes

**Backend Logs:**
- Monitor for `[Auth Webhook]` messages
- Set up alerts for errors

### Email Delivery

**Resend Dashboard:**
- View sent emails
- Check delivery status
- Monitor bounce rates

---

## FAQ

**Q: Will this slow down the signup process?**
A: No! The webhook is called asynchronously after the user is created. It doesn't block the auth flow.

**Q: What if the webhook fails?**
A: Supabase will retry failed webhooks automatically. You can also use the database trigger approach for guaranteed delivery.

**Q: Can I customize the email template?**
A: Yes! Edit `/backend/services/emailNotificationService.js` → `notifyUserSignup()` function.

**Q: Will this work with OAuth (Google, GitHub, etc.)?**
A: Yes! The webhook fires for all signup methods, not just magic links.

**Q: How do I test without creating real users?**
A: Use Supabase's "Test Webhook" feature in the dashboard, or create test users and delete them after.

---

## Next Steps

1. ✅ Set up webhook secret in `.env`
2. ✅ Deploy backend (or use ngrok for testing)
3. ✅ Configure Supabase webhook
4. ✅ Test with a new signup
5. 🎉 Receive notifications!

---

## Support

If you encounter issues:
1. Check backend logs for errors
2. Check Supabase webhook delivery logs
3. Verify all environment variables are set
4. Test email service separately using the notification service directly
