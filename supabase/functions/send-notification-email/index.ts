import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const APP_OWNER_EMAIL = Deno.env.get('APP_OWNER_EMAIL') || 'your-email@example.com'

interface EmailPayload {
  type: 'user_signup' | 'job_scored'
  data: {
    user_email?: string
    user_id?: string
    job_url?: string
    score?: number
    report_id?: string
  }
}

serve(async (req) => {
  try {
    const payload: EmailPayload = await req.json()
    
    let subject = ''
    let html = ''
    
    if (payload.type === 'user_signup') {
      subject = '🎉 New User Signup - JobPostScore'
      html = `
        <h2>New User Signed Up!</h2>
        <p><strong>User Email:</strong> ${payload.data.user_email}</p>
        <p><strong>User ID:</strong> ${payload.data.user_id}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      `
    } else if (payload.type === 'job_scored') {
      subject = '📊 New Job Post Scored - JobPostScore'
      html = `
        <h2>New Job Post Analyzed!</h2>
        <p><strong>Job URL:</strong> ${payload.data.job_url || 'Text input'}</p>
        <p><strong>Score:</strong> ${payload.data.score}/100</p>
        <p><strong>Report ID:</strong> ${payload.data.report_id}</p>
        <p><strong>User:</strong> ${payload.data.user_email || 'Guest'}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      `
    }

    // Send email via Resend
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'JobPostScore <notifications@yourdomain.com>',
        to: [APP_OWNER_EMAIL],
        subject: subject,
        html: html
      })
    })

    const data = await res.json()

    return new Response(
      JSON.stringify({ success: true, data }),
      { headers: { "Content-Type": "application/json" } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
})
