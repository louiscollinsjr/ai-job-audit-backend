# Quick Start: Email Notifications

Get email notifications for user signups and job scoring in 5 minutes.

## ⚡ Quick Setup

### 1. Get Resend API Key (2 minutes)

1. Sign up: https://resend.com
2. Get API key from dashboard
3. Free tier: 3,000 emails/month

### 2. Configure Environment (1 minute)

Add to `/backend/.env`:

```bash
# Email notifications
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxx
APP_OWNER_EMAIL=your-email@example.com,partner@example.com
FROM_EMAIL=notifications@jobpostscore.com

# For user signup notifications (optional)
SUPABASE_WEBHOOK_SECRET=generate-random-32-char-string
```

### 3. Restart Backend (30 seconds)

```bash
cd backend
npm start
```

### 4. Test Job Scoring (1 minute)

1. Go to your app
2. Audit a job posting
3. Check your email! 📧

---

## ✅ What's Already Working

**Job Post Scored Notifications:**
- ✅ Automatically sends when a job is audited
- ✅ Includes: URL, score, report ID, user type
- ✅ Color-coded score display
- ✅ Non-blocking (doesn't slow down API)

---

## 🚧 Optional: User Signup Notifications

**Safe, production-ready approach using Supabase webhooks.**

### Quick Setup:

1. **Add webhook secret** to `.env` (see above)

2. **Configure in Supabase**:
   - Dashboard → Authentication → Webhooks
   - Event: `auth.user.created`
   - URL: `https://your-backend.com/api/supabase-auth-webhook`
   - Header: `x-webhook-signature: your-secret-here`

3. **Test**: Sign up with a new email

**Full guide:** [USER_SIGNUP_NOTIFICATIONS_SETUP.md](./USER_SIGNUP_NOTIFICATIONS_SETUP.md)

---

## 📧 Email Examples

### Job Scored Email

```
Subject: 📊 New Job Post Scored - JobPostScore

New Job Post Analyzed!

Job URL: https://example.com/careers/engineer
Score: 87/100 (green)
Report ID: abc123
User: Authenticated User
Time: 10/22/2025, 11:30:00 AM
```

### User Signup Email

```
Subject: 🎉 New User Signup - JobPostScore

New User Signed Up!

User Email: user@company.com
User ID: 123e4567-e89b-12d3-a456-426614174000
Time: 10/22/2025, 11:30:00 AM
```

---

## 🎯 Multiple Recipients

Use comma-separated emails:

```bash
APP_OWNER_EMAIL=owner@example.com,partner@example.com,admin@example.com
```

All recipients get the same notification.

---

## 🔍 Troubleshooting

### Not receiving emails?

**Check backend logs:**
```bash
# Should see:
✅ Email sent via Resend: re_xxxxx
```

**Common issues:**
- ❌ `RESEND_API_KEY` not set
- ❌ `APP_OWNER_EMAIL` not set
- ❌ `FROM_EMAIL` domain not verified
- ❌ Backend not running

### Verify Resend setup:

1. Go to Resend Dashboard
2. Check "Logs" for sent emails
3. Verify domain if using custom domain

---

## 📚 Full Documentation

- **[EMAIL_NOTIFICATIONS_SETUP.md](./EMAIL_NOTIFICATIONS_SETUP.md)** - Complete setup guide
- **[USER_SIGNUP_NOTIFICATIONS_SETUP.md](./USER_SIGNUP_NOTIFICATIONS_SETUP.md)** - User signup webhooks

---

## 🎉 That's It!

You're now receiving email notifications for:
- ✅ Every job post scored
- 🚧 New user signups (optional, requires webhook setup)

Questions? Check the full documentation linked above.
