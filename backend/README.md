# AllMedia Tools API

API-only Docker context: this backend directory. Combined website/API context: project root (use the root Dockerfile).

The root Dockerfile serves the website at `/tools/` and the health endpoint at `/api/health`. The API-only Dockerfile is for separate hosting; set `ALLOWED_ORIGINS` to the website origin.

Keep credentials in hosting secrets. Before a public launch, add rate limiting, a job queue for longer media tasks, and outbound network restrictions.
