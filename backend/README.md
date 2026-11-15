# AllMedia Tools API

API-only Docker context: this backend directory. Combined website/API context: project root (use the root Dockerfile).

See ../AUDIT_AND_SETUP.md for fixes, configuration, validation and known limitations. For a Hugging Face Space using the combined build, upload root Dockerfile, backend/ and web/; website URL ends with /tools/ and health is /api/health.

Use ALLOWED_ORIGINS for separately hosted website origins. Keep credentials in hosting secrets. Protect public deployments with rate limiting, a job queue, and restricted network egress.
