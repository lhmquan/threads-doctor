# Security Checklist (60s)

Use this at the start of every new project.

## Must-pass before coding
- [ ] Provider is trusted and has clear no-log / no-training policy.
- [ ] No real secrets in prompts, screenshots, or committed files.
- [ ] Secrets are stored only in local `.env` (never in repo).
- [ ] `.gitignore` excludes `.env`, keys, and `secrets.*`.
- [ ] Repo visibility (private/public) is set correctly.

## If any item fails
Stop and fix it first, then continue coding.

## Quick routine for a new project
1. Copy these starter files into the new project root.
2. Create local `.env` from `.env.example`.
3. Run through the 5 must-pass checks.
4. Mark: `Security check: PASS (YYYY-MM-DD)` in your project notes.

## Rotation rule
If a token/key was pasted in chat, logs, or commits: rotate immediately.
