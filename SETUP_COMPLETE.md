# Email Notifications Setup - COMPLETE ✅

## What's Configured

### ✅ Step 1: Environment Variables (DONE)

Your `.env` file is now configured with:

```bash
EMAIL_PROVIDER=resend
APP_OWNER_EMAIL=jasonjdaniels@verizon.net,louiscollins@atem.gdn
FROM_EMAIL=hello@jobpostscore.com
RESEND_API_KEY=re_ik7P7xoX_3nnUENZ919RhpKqECD6bauAT
SUPABASE_WEBHOOK_SECRET=a7f8e9d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8
```

**Note:** Fixed typo `REASEND_API_KEY` → `RESEND_API_KEY`

---

## ✅ What's Already Working

### Job Post Scoring Notifications

**Status:** ✅ READY TO USE

Every time a job post is scored, both email addresses will receive:
- Job URL
- Score (color-coded: green ≥85, yellow ≥60, red <60)
- Report ID
- User type (Authenticated/Guest)
- Timestamp

**To test:**
1. Restart your backend: `npm start`
2. Audit a job posting from your app
3. Check both email inboxes!

---

## 🚧 Next Step: User Signup Notifications (Optional)

### Step 2: Configure Supabase Webhook

To receive emails when new users sign up:

#### A. Get Your Backend URL

**For Testing (Local Development):**
```bash
# Install ngrok if you don't have it
brew install ngrok

# Start ngrok
ngrok http 3001

# Copy the HTTPS URL (e.g., https://abc123.ngrok-free.app)
```

**For Production:**
- Use your deployed backend URL (e.g., `https://api.jobpostscore.com`)

#### B. Configure Database Trigger in Supabase

**Note:** Supabase's Auth Hooks (Beta) don't support user insert webhooks yet. We'll use a database trigger instead.

1. **Enable pg_net Extension:**
   - Go to: https://supabase.com/dashboard/project/zincimrcpvxtugvhimny
   - Navigate to: **Database** → **Extensions**
   - Search for `pg_net`
   - Click **Enable**

2. **Run the SQL Trigger:**
   - Navigate to: **SQL Editor**
   - Open the file: `backend/supabase-user-signup-trigger.sql`
   - **IMPORTANT:** Update line 32 with your backend URL:
     ```sql
     -- For local testing:
     webhook_url := 'https://YOUR-NGROK-URL.ngrok-free.app/api/supabase-auth-webhook';
     
     -- For production:
     -- webhook_url := 'https://api.jobpostscore.com/api/supabase-auth-webhook';
     ```
   - Copy the entire SQL file
   - Paste into Supabase SQL Editor
   - Click **Run** (bottom right)
   - You should see: "Success. No rows returned"

#### C. Test It

1. Go to your login page: https://jobpostscore.com/login
2. Sign up with a **new email address** (one that hasn't signed up before)
3. Complete the magic link flow
4. Check your email inboxes - you should receive a signup notification!

---

## 🔍 Verification

### Check Backend Logs

After restarting your backend, you should see:

```bash
# When a job is scored:
Report saved successfully with ID: abc123
✅ Email sent via Resend: re_xxxxx

# When a user signs up (after webhook is configured):
[Auth Webhook] Received event: INSERT
[Auth Webhook] New user signup detected: user@example.com
[Auth Webhook] Signup notification sent
✅ Email sent via Resend: re_xxxxx
```

### Check Resend Dashboard

1. Go to: https://resend.com/emails
2. You should see sent emails with delivery status
3. Check for any bounces or errors

---

## 📧 Email Recipients

Both emails will be sent to:
- ✅ jasonjdaniels@verizon.net
- ✅ louiscollins@atem.gdn

---

## 🎯 Quick Test Commands

### Test Job Scoring Notification (Already Working)

```bash
# 1. Restart backend
cd backend
npm start

# 2. In another terminal, test the audit endpoint
curl -X POST http://localhost:3001/api/audit-job-post \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/job"}'

# 3. Check your email!
```

### Test User Signup Notification (After webhook setup)

```bash
# 1. Make sure backend is running
# 2. Make sure ngrok is running (for local testing)
# 3. Sign up with a new email on your app
# 4. Check your email!
```

---

## 🔧 Troubleshooting

### Job Scoring Emails Not Sending

**Check:**
1. Backend is running: `npm start`
2. Resend API key is valid (check Resend dashboard)
3. `FROM_EMAIL` domain is verified in Resend
4. Backend logs show email sending

**Fix:**
- Verify `hello@jobpostscore.com` is verified in Resend
- If not, either verify the domain or use `onboarding@resend.dev` temporarily

### User Signup Emails Not Sending

**Check:**
1. Webhook is configured in Supabase
2. Webhook URL is correct and accessible
3. Webhook secret matches in both places
4. Backend logs show webhook received

**Common Issues:**
- ❌ ngrok URL expired (regenerate with `ngrok http 3001`)
- ❌ Backend not running
- ❌ Webhook secret mismatch
- ❌ Firewall blocking Supabase

---

## 📚 Documentation Reference

- **Quick Start:** [QUICK_START_EMAIL_NOTIFICATIONS.md](./QUICK_START_EMAIL_NOTIFICATIONS.md)
- **Full Setup:** [EMAIL_NOTIFICATIONS_SETUP.md](./EMAIL_NOTIFICATIONS_SETUP.md)
- **User Signups:** [USER_SIGNUP_NOTIFICATIONS_SETUP.md](./USER_SIGNUP_NOTIFICATIONS_SETUP.md)

---

## ✅ Checklist

- [x] Environment variables configured
- [x] Typo fixed (REASEND → RESEND)
- [x] Multiple email recipients set up
- [x] Webhook secret generated
- [x] Job scoring notifications ready
- [ ] Supabase webhook configured (optional)
- [ ] User signup notifications tested (optional)

---

## 🎉 You're All Set!

**What's working now:**
- ✅ Job post scoring notifications (ready to use)
- 🚧 User signup notifications (needs webhook configuration)

**Next steps:**
1. Restart your backend
2. Test by auditing a job post
3. (Optional) Configure Supabase webhook for user signups

Questions? Check the documentation files linked above!
