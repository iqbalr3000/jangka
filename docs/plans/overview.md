# Jangka — Overview

Self-hosted workspace (like Metabase: one Docker image + Postgres) for writing BRD, PRD, and TSD documents
with LLM assistance. The assistant interviews the user first, flags gaps, then drafts each section into a
standardized template with Mermaid diagrams — never inventing content it wasn't given. Documents live in
collections with group-based permissions, link to each other for traceability (BRD → PRD → TSD), and export
to PDF/DOCX. Bring-your-own LLM key (Anthropic, OpenAI, Gemini, OpenRouter).

- What & why: `docs/PRD.md`
- UX/UI: `docs/DESIGN.md` (visual design in progress in Claude Design)
- Technical reference + feature list: `docs/SPEC.md`
- Per-feature specs: `docs/plans/spec-<feature>.md`
- Status: `docs/plans/roadmap.md`
