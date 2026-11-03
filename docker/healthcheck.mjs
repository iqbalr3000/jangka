// The worker serves no HTTP, so for it a running process is healthy.
if (process.env.APP_ROLE === "worker") process.exit(0);

const port = process.env.PORT || 3000;

fetch(`http://127.0.0.1:${port}/api/v1/health`).then(
  (res) => process.exit(res.ok ? 0 : 1),
  () => process.exit(1),
);
