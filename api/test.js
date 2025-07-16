// Simple test endpoint
module.exports = async function(req, res) {
  try {
    return res.status(200).json({ 
      message: "API is working!", 
      env: {
        hasOpenAI: !!process.env.OPENAI_API_KEY || !!process.env.VITE_OPENAI,
        nodeEnv: process.env.NODE_ENV,
        vercelEnv: process.env.VERCEL_ENV
      },
      body: req.body || null
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
