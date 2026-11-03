### Highlights

- What's new, one line each, written for the person running Jangka.

### Breaking changes

- What breaks and what to do instead (MAJOR releases only).

### Upgrade notes

- Back up your database before upgrading (migrations are forward-only).
- Set `JANGKA_VERSION=X.Y.Z`, then run `docker compose pull && docker compose up -d`.
- New, renamed, or removed env vars and any manual steps — or "None".

### Fixes

- …

### Images

```bash
docker pull iqbalr3000/jangka:X.Y.Z
docker pull ghcr.io/iqbalr3000/jangka:X.Y.Z
```

Platforms: `linux/amd64`, `linux/arm64`.
