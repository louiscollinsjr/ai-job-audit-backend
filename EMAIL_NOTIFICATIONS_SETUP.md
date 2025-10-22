# Email Notifications Setup Guide

This guide explains how to set up email notifications for user authentication and job post scoring events.

## Overview

You have **three options** for implementing email notifications:

1. **Backend API Integration** (Easiest, Recommended) ✅
2. **Supabase Database Webhooks** (More robust, requires Supabase setup)
3. **PostHog Webhooks** (If you want to use your existing analytics)

---

## Option 1: Backend API Integration (Recommended)

### ✅ Already Implemented!

I've added the email notification service to your backend. Here's what's included:

**Files Created:**
- `/services/emailNotificationService.js` - Email service with Resend & SendGrid support
- `/api/audit-job-post.js` - Updated to send notifications when jobs are scored

### Setup Steps:

#### 1. Choose an Email Provider

**Resend (Recommended):**
- Free tier: 3,000 emails/month
- Sign up: https://resend.com
- Get API key from dashboard

**SendGrid (Alternative):**
- Free tier: 100 emails/day
- Sign up: https://sendgrid.com
- Get API key from dashboard

#### 2. Add Environment Variables

Add to your `/backend/.env` file:

```bash
# Email Configuration
EMAIL_PROVIDER=resend              # or 'sendgrid'

# Single email address:
APP_OWNER_EMAIL=your-email@example.com

# OR multiple email addresses (comma-separated):
APP_OWNER_EMAIL=owner@example.com,partner@example.com,admin@example.com

FROM_EMAIL=notifications@yourdomain.com

# Resend (if using Resend)
RESEND_API_KEY=re_xxxxxxxxxxxxx

# SendGrid (if using SendGrid)
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
```

#### 3. Configure Domain (for Resend)

If using Resend with a custom domain:
1. Go to Resend Dashboard → Domains
2. Add your domain (e.g., `jobpostscore.com`)
3. Add DNS records to your domain provider
4. Verify domain
5. Update `FROM_EMAIL` to use your domain

#### 4. Test It

Restart your backend server and trigger a job post audit. You should receive an email!

```bash
cd backend
npm start
```

Then audit a job posting from your frontend.

### What Gets Notified:

✅ **Job Post Scored** - Every time a job is analyzed
- Job URL
- Score (with color coding)
- Report ID
- User (authenticated or guest)
- Timestamp

🚧 **User Signup** - Not yet implemented (see below)

---

## Option 2: Supabase Database Webhooks

This approach uses Supabase's built-in database triggers and Edge Functions.

### Setup Steps:

#### 1. Enable pg_net Extension

In Supabase Dashboard:
1. Go to **Database** → **Extensions**
2. Search for `pg_net`
3. Click **Enable**

#### 2. Deploy Edge Function

```bash
cd backend
npx supabase functions deploy send-notification-email
```

Set environment variables:
```bash
npx supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxx
npx supabase secrets set APP_OWNER_EMAIL=your-email@example.com
```

#### 3. Run Database Migration

1. Go to Supabase Dashboard → **SQL Editor**
2. Open `/backend/migrations/create_email_notification_triggers.sql`
3. Replace `YOUR_PROJECT_REF` with your Supabase project reference
4. Run the migration

#### 4. Test It

Create a new user or audit a job posting. Check your email!

### Advantages:
- ✅ Runs independently of your backend
- ✅ More reliable (database-level triggers)
- ✅ Scales automatically with Supabase

### Disadvantages:
- ❌ Requires Supabase setup
- ❌ More complex to debug

---

## Option 3: PostHog Webhooks

Since you already have PostHog configured, you can use their webhook feature.

### Setup Steps:

#### 1. Create Webhook Endpoint

Add to `/backend/api/posthog-webhook.js`:

```javascript
const { notifyUserSignup, notifyJobScored } = require('../services/emailNotificationService');

module.exports = async function(req, res) {
  const { event, properties } = req.body;
  
  if (event === 'user_signup') {
    await notifyUserSignup(properties.email, properties.user_id);
  } else if (event === 'job_scored') {
    await notifyJobScored(
      properties.job_url,
      properties.score,
      properties.report_id,
      properties.user_email
    );
  }
  
  res.json({ success: true });
};
```

#### 2. Configure PostHog Webhook

1. Go to PostHog Dashboard → **Project Settings** → **Webhooks**
2. Add new webhook: `https://your-backend.com/api/posthog-webhook`
3. Select events: `user_signup`, `job_scored`
4. Save

#### 3. Track Events in Frontend

Update your frontend to track these events with PostHog.

---

## Adding User Signup Notifications

**✅ SAFE PRODUCTION-READY SOLUTION**

I've created a **webhook-based approach** that won't modify your auth flow at all!

### Quick Setup:

1. **Add webhook secret** to `/backend/.env`:
   ```bash
   SUPABASE_WEBHOOK_SECRET=your-random-secret-here
   ```

2. **Configure Supabase webhook**:
   - Go to Supabase Dashboard → Authentication → Webhooks
   - Create webhook for `auth.user.created` event
   - Point to: `https://your-backend.com/api/supabase-auth-webhook`

3. **Done!** No frontend changes needed.

### Full Documentation:

See **[USER_SIGNUP_NOTIFICATIONS_SETUP.md](./USER_SIGNUP_NOTIFICATIONS_SETUP.md)** for:
- Complete step-by-step setup
- Testing instructions
- Troubleshooting guide
- Alternative database trigger approach
- Security best practices

---

## Troubleshooting

### Emails Not Sending

1. **Check API Keys**: Ensure `RESEND_API_KEY` or `SENDGRID_API_KEY` is set
2. **Check FROM_EMAIL**: Must be verified domain or resend.dev subdomain
3. **Check Logs**: Look for error messages in backend console
4. **Test Email Service**: Try sending a test email via provider dashboard

### Emails Going to Spam

1. **Verify Domain**: Add SPF, DKIM, and DMARC records
2. **Use Custom Domain**: Don't use generic domains like gmail.com
3. **Warm Up Domain**: Start with low volume, gradually increase

### Rate Limits

- **Resend Free**: 3,000 emails/month
- **SendGrid Free**: 100 emails/day

If you hit limits, consider:
- Batching notifications (daily digest)
- Upgrading to paid plan
- Using multiple providers

---

## Recommended Configuration

For production, I recommend:

```bash
# Use Resend with custom domain
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxx
FROM_EMAIL=notifications@jobpostscore.com
APP_OWNER_EMAIL=owner@jobpostscore.com
```

**Why Resend?**
- ✅ Modern, developer-friendly API
- ✅ Generous free tier (3,000/month)
- ✅ Great deliverability
- ✅ Easy domain verification
- ✅ Beautiful email templates support

---

## Next Steps

1. ✅ Set up email provider (Resend or SendGrid)
2. ✅ Add environment variables to `.env`
3. ✅ Test job scoring notifications
4. 🚧 Add user signup notifications (optional)
5. 🚧 Customize email templates (optional)
6. 🚧 Add daily digest option (optional)

---

## Questions?

- **Resend Docs**: https://resend.com/docs
- **SendGrid Docs**: https://docs.sendgrid.com
- **Supabase Edge Functions**: https://supabase.com/docs/guides/functions
