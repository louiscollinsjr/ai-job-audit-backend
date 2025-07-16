# Backend Overview

This backend powers the AI Job Posting Audit platform, providing endpoints and logic for analyzing job postings, managing users, and storing audit results. It is designed to work seamlessly with the SvelteKit frontend and Supabase authentication.

## Key Features
- **Job Audit API**: Receives job posting data (URL or text), runs AI-powered audits, and returns scores and feedback.
- **Supabase Integration**: Uses Supabase for authentication and persistent storage of audit results.
- **User Management**: Relies on Supabase Auth for secure, passwordless login and user identification.
- **Result Storage**: Persists audit results (scores, feedback, metadata) in a `job_audits` table linked to each user.

## How It Works

### 1. Authentication
- All user authentication is handled by Supabase (magic link login).
- Backend endpoints expect a Supabase JWT token for requests that require user context.

### 2. Audit Flow
1. **Frontend** collects job posting input from the user (URL or text).
2. **Frontend** sends a request to the backend audit endpoint with the job data and user token.
3. **Backend** verifies the token with Supabase, extracts the user ID, and runs the audit logic (AI/ML model or external service).
4. **Backend** returns a structured response with scores, feedback, and an overall score (see `static/sample.json`).
5. **Frontend** displays the results and may save them to Supabase via an insert into the `job_audits` table.

### 3. Data Model
- **job_audits** table (in Supabase):
  - `id` (uuid, PK)
  - `user_id` (uuid, FK to auth.users)
  - `job_url` (text, nullable)
  - `job_text` (text, nullable)
  - `scores` (jsonb)
  - `feedback` (text)
  - `overall_score` (float8)
  - `created_at` (timestamp)

### 4. API Endpoints (Example)
- `POST /api/audit` — Analyze a job posting (requires auth)
- `GET /api/audits` — List user's previous audits (requires auth)
- `GET /api/audit/:id` — Get a specific audit result (requires auth)

### 5. Environment Variables
- `SUPABASE_URL` — Supabase instance URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service key for admin actions (never expose to frontend)
- `OPENAI_API_KEY` — (If using OpenAI or similar for audit logic)

## Local Development
1. Install dependencies: `bun install` or `npm install`
2. Set up a `.env` file with Supabase and any AI keys.
3. Run the backend: `bun run dev` or `npm run dev`
4. Test endpoints with your frontend or tools like Postman.

## Security Notes
- Always validate Supabase JWTs on protected endpoints.
- Never expose the service role key to the frontend.
- Use Row Level Security (RLS) in Supabase to protect user data.

## Extending
- Add new endpoints for analytics, admin tools, or user profiles as needed.
- Integrate additional AI models or scoring logic in the audit endpoint.

## Contact
For questions or issues, contact the engineering team at support@JobPostScore.ai.
