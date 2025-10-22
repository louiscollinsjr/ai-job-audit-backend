/**
 * Supabase Auth Webhook Handler
 * 
 * This endpoint receives webhooks from Supabase when auth events occur.
 * Configure in Supabase Dashboard: Authentication > Webhooks
 * 
 * Webhook URL: https://your-backend.com/api/supabase-auth-webhook
 * Events to listen for: user.created
 * 
 * IMPORTANT: Secure this endpoint with a webhook secret!
 */

const { notifyUserSignup } = require('../services/emailNotificationService');

// Webhook secret for verification (set in Supabase Dashboard)
const WEBHOOK_SECRET = process.env.SUPABASE_WEBHOOK_SECRET || '';

module.exports = async function(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-webhook-signature');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature if secret is configured
    if (WEBHOOK_SECRET) {
      const signature = req.headers['x-webhook-signature'];
      
      if (!signature) {
        console.warn('[Auth Webhook] Missing webhook signature');
        return res.status(401).json({ error: 'Missing signature' });
      }

      // In production, implement proper signature verification
      // For now, simple comparison (Supabase sends the secret as the signature)
      if (signature !== WEBHOOK_SECRET) {
        console.warn('[Auth Webhook] Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { type, record } = req.body;
    
    console.log('[Auth Webhook] Received event:', type);
    console.log('[Auth Webhook] User data:', {
      id: record?.id,
      email: record?.email,
      created_at: record?.created_at
    });

    // Handle user.created event (new signups)
    if (type === 'INSERT' && record?.email) {
      console.log('[Auth Webhook] New user signup detected:', record.email);
      
      // Send email notification asynchronously
      notifyUserSignup(record.email, record.id)
        .then(() => console.log('[Auth Webhook] Signup notification sent'))
        .catch(err => console.error('[Auth Webhook] Failed to send notification:', err));
    }

    // Respond quickly to Supabase
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('[Auth Webhook] Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
