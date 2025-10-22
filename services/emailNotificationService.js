/**
 * Email Notification Service
 * Sends notifications to app owner for key events
 * 
 * Supports multiple email providers:
 * - Resend (recommended, free tier: 3000 emails/month)
 * - SendGrid (free tier: 100 emails/day)
 * - Nodemailer (SMTP)
 */

// Support multiple email addresses (comma-separated)
const APP_OWNER_EMAIL = process.env.APP_OWNER_EMAIL || 'your-email@example.com';
const APP_OWNER_EMAILS = APP_OWNER_EMAIL.split(',').map(email => email.trim());
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'resend'; // 'resend', 'sendgrid', or 'smtp'

// Email provider configurations
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'notifications@jobpostscore.com';

/**
 * Send email via Resend (recommended)
 */
async function sendViaResend(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured, skipping email notification');
    return { success: false, error: 'API key not configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: Array.isArray(to) ? to : [to],
        subject: subject,
        html: html
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('Resend API error:', data);
      return { success: false, error: data };
    }

    console.log('✅ Email sent via Resend:', data.id);
    return { success: true, data };
  } catch (error) {
    console.error('Failed to send email via Resend:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send email via SendGrid
 */
async function sendViaSendGrid(to, subject, html) {
  if (!SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not configured, skipping email notification');
    return { success: false, error: 'API key not configured' };
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SENDGRID_API_KEY}`
      },
      body: JSON.stringify({
        personalizations: [{
          to: Array.isArray(to) 
            ? to.map(email => ({ email }))
            : [{ email: to }]
        }],
        from: { email: FROM_EMAIL },
        subject: subject,
        content: [{ type: 'text/html', value: html }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('SendGrid API error:', error);
      return { success: false, error };
    }

    console.log('✅ Email sent via SendGrid');
    return { success: true };
  } catch (error) {
    console.error('Failed to send email via SendGrid:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send email notification
 */
async function sendEmail(to, subject, html) {
  switch (EMAIL_PROVIDER) {
    case 'resend':
      return await sendViaResend(to, subject, html);
    case 'sendgrid':
      return await sendViaSendGrid(to, subject, html);
    default:
      console.warn(`Unknown email provider: ${EMAIL_PROVIDER}`);
      return { success: false, error: 'Unknown provider' };
  }
}

/**
 * Notify app owner of new user signup
 */
async function notifyUserSignup(userEmail, userId) {
  const subject = '🎉 New User Signup - JobPostScore';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4F46E5;">New User Signed Up!</h2>
      <div style="background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>User Email:</strong> ${userEmail}</p>
        <p><strong>User ID:</strong> ${userId}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      </div>
      <p style="color: #6B7280; font-size: 14px;">
        This is an automated notification from JobPostScore.
      </p>
    </div>
  `;

  return await sendEmail(APP_OWNER_EMAILS, subject, html);
}

/**
 * Notify app owner of new job post scored
 */
async function notifyJobScored(jobUrl, score, reportId, userEmail = 'Guest') {
  const subject = '📊 New Job Post Scored - JobPostScore';
  const scoreColor = score >= 85 ? '#10B981' : score >= 60 ? '#F59E0B' : '#EF4444';
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4F46E5;">New Job Post Analyzed!</h2>
      <div style="background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Job URL:</strong> ${jobUrl || 'Text input'}</p>
        <p>
          <strong>Score:</strong> 
          <span style="color: ${scoreColor}; font-size: 24px; font-weight: bold;">
            ${score}/100
          </span>
        </p>
        <p><strong>Report ID:</strong> ${reportId}</p>
        <p><strong>User:</strong> ${userEmail}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      </div>
      <p style="color: #6B7280; font-size: 14px;">
        This is an automated notification from JobPostScore.
      </p>
    </div>
  `;

  return await sendEmail(APP_OWNER_EMAILS, subject, html);
}

module.exports = {
  notifyUserSignup,
  notifyJobScored,
  sendEmail
};
