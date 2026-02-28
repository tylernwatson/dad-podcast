# CLAUDE.md

## Development workflow

All development work must take place on feature branches, never directly on main. Create a branch, make changes, and open a PR to merge into main.

## Project overview

Dad's Daily Digest — an auto-generated daily podcast that fetches news from WSJ, NYT, and weekly market newsletters (Dividend Cafe, Thoughts from the Frontline), synthesizes a two-host conversational script with Claude, converts it to audio with Google Cloud TTS, and publishes it as a subscribable podcast via GitHub Pages.

## Key commands

- `node src/index.js --dry-run` — generate script + MP3 locally without publishing
- `node src/index.js` — full pipeline (fetch, synthesize, TTS, publish to gh-pages)
- `npm run cost-report` — view API cost history

## Architecture

- `src/index.js` — main orchestrator with retry logic
- `src/fetcher.js` — WSJ RSS, NYT API, newsletter scraping, deduplication
- `src/synthesizer.js` — Claude script generation (Sonnet 4.6 for script, Haiku for summary)
- `src/tts.js` — Google Cloud TTS with WaveNet voices and chunking
- `src/publisher.js` — RSS 2.0 feed builder
- `src/githubCommitter.js` — publishes to gh-pages via GitHub API
- `src/newsletterTracker.js` — deduplicates weekly newsletters across runs
- `src/episodeMemory.js` — rolling 14-episode context for cross-episode continuity

## Secrets

Never commit `.env`, `service-account.json`, or API keys. These are gitignored.
