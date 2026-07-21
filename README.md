# Lantern — a Socratic study tutor

Lantern is a domain-specific AI chat interface. Instead of handing over answers,
it guides students toward them with questions — a tutor, not a lookup tool.
Responses stream in token-by-token, the same way a real conversation unfolds.

## How it meets the requirements

| Requirement | How it's met |
|---|---|
| Functional, responsive frontend | Plain HTML/CSS/JS chat UI (`/frontend`), no framework build step, responsive down to mobile (sidebar collapses to a top bar under 780px) |
| Backend server with secure API routing | Node.js + Express (`/backend/server.js`); the Anthropic API key lives only in the container's environment, never sent to the browser |
| LLM API integration | Backend calls the Anthropic Messages API server-side and relays results |
| Streaming responses | Backend proxies Anthropic's `stream: true` response as Server-Sent Events; frontend reads the response body incrementally and renders tokens as they arrive — no framework, just `ReadableStream` |
| Containerization | Single root `Dockerfile` packages frontend + backend into one image |
| Live AWS deployment | Ships as one container — deploys directly to **AWS App Runner** (steps below) |
| Security best practices | API key only ever read from `process.env`; `.env` is git-ignored and docker-ignored; `.env.example` documents required vars with no real values |

## Project structure

```
lantern/
├── Dockerfile              # single image: Express serves API + static frontend
├── docker-compose.yml      # local dev
├── .dockerignore
├── backend/
│   ├── server.js           # Express app, /api/chat (SSE), /api/health
│   ├── package.json
│   └── .env.example        # copy to .env locally — never commit the real one
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js
```

## Run locally

```bash
cd lantern
cp backend/.env.example backend/.env
# edit backend/.env and set ANTHROPIC_API_KEY

docker compose up --build
```

Visit `http://localhost:3000`.

Without Docker:

```bash
cd backend
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
npm start
```

The server serves the frontend directly from `/backend/public` (copied in
at Docker build time — for non-Docker local dev, point `server.js`'s
`frontendPath` at `../frontend` or run a static server alongside it).

## Deploy to AWS App Runner

App Runner is the simplest path for a single containerized service with a
public HTTPS URL and no load balancer/VPC to configure by hand.

1. **Push the image to Amazon ECR**
   ```bash
   aws ecr create-repository --repository-name lantern
   aws ecr get-login-password --region <region> | \
     docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com

   docker build -t lantern .
   docker tag lantern:latest <account-id>.dkr.ecr.<region>.amazonaws.com/lantern:latest
   docker push <account-id>.dkr.ecr.<region>.amazonaws.com/lantern:latest
   ```

2. **Store the API key as a secret**, not a plain environment variable:
   - AWS Secrets Manager → create secret `lantern/anthropic-api-key` with your key.

3. **Create the App Runner service**
   - Source: Container registry → the ECR image above.
   - Port: `3000`.
   - Environment variables: add `ANTHROPIC_API_KEY` sourced from the Secrets
     Manager secret (App Runner supports referencing secrets directly —
     don't paste the raw key into the console).
   - Instance role: grant `secretsmanager:GetSecretValue` on that one secret.
   - Auto scaling: default concurrency (App Runner scales automatically).

4. **HTTPS is automatic** — App Runner issues a public `https://<id>.<region>.awsapprunner.com`
   URL out of the box. Attach a custom domain later via the App Runner console
   if you want a branded URL.

5. **CI/CD (optional)**: connect App Runner directly to your GitHub repo
   instead of ECR, and it will rebuild on every push to `main` — no pipeline
   to write.

### Elastic Beanstalk alternative

If you'd rather use Elastic Beanstalk: choose the "Docker" platform, upload
a zip containing the `Dockerfile` and both folders, and set `ANTHROPIC_API_KEY`
under Configuration → Software → Environment properties (backed by Secrets
Manager via `.ebextensions` if you want it out of plaintext env vars).

## Security notes

- `backend/.env` is listed in both `.gitignore` and `.dockerignore` — it
  never reaches version control or the image.
- The frontend never sees the API key; it only ever talks to your own
  `/api/chat` endpoint.
- A basic rate limiter (20 requests/min per IP) sits in front of `/api/`
  to reduce abuse of your API budget.
- In production, set `ALLOWED_ORIGIN` to your real domain instead of `*`.
