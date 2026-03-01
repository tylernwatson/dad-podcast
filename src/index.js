/**
 * Dad's Daily Digest — Main Orchestrator
 *
 * Pipeline:
 * 1. Fetch newsletter state
 * 2. Fetch content (WSJ, NYT, newsletters)
 * 3. Fetch episode memory
 * 4. Synthesize script with Claude
 * 5. Convert to audio with TTS
 * 6. Publish to GitHub Pages with RSS feed
 * 7. Update episode memory + newsletter tracker
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const { fetchAllContent } = require('./fetcher');
const { synthesizeScript } = require('./synthesizer');
const { convertToAudio } = require('./tts');
const { buildUpdatedFeed } = require('./publisher');
const { publishEpisode } = require('./githubCommitter');
const { CostTracker } = require('./costTracker');
const { updateTTSUsage } = require('./ttsUsageTracker');
const {
  getEpisodeMemory,
  commitEpisodeMemory,
  extractKeyTopics,
  addEpisodeToMemory,
  formatMemoryForPrompt,
} = require('./episodeMemory');
const {
  getNewsletterState,
  commitNewsletterState,
  updateNewsletterState,
} = require('./newsletterTracker');

const BASE_URL = process.env.PAGES_BASE_URL;
const REPO = process.env.GITHUB_REPOSITORY;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const PODCAST_TITLE = process.env.PODCAST_TITLE || "Dad's Daily Digest";
const PODCAST_AUTHOR = process.env.PODCAST_AUTHOR || 'Tyler Watson';
const PODCAST_EMAIL = process.env.PODCAST_EMAIL || 'howdy@tyler.rodeo';

/**
 * Get current feed.xml from gh-pages branch
 */
async function getCurrentFeed() {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${REPO}/contents/feed.xml?ref=gh-pages`,
      {
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );
    return Buffer.from(response.data.content, 'base64').toString('utf-8');
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('  No existing feed.xml found (first run)');
      return '';
    }
    throw error;
  }
}

async function run({ dryRun = false } = {}) {
  console.log('='.repeat(60));
  console.log("Starting Dad's Daily Digest Pipeline");
  console.log('='.repeat(60));
  console.log();

  if (!dryRun) {
    const required = ['PAGES_BASE_URL', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const startTime = Date.now();
  const costTracker = new CostTracker();

  try {
    // 1. Fetch newsletter state
    console.log('STEP 1: Fetching newsletter tracker state...');
    let newsletterStateData = { newsletters: {} };
    let newsletterStateSha = null;

    if (!dryRun) {
      try {
        const { data, sha } = await getNewsletterState();
        newsletterStateData = data;
        newsletterStateSha = sha;
        const tracked = Object.keys(data.newsletters).length;
        console.log(`  Tracking ${tracked} newsletter(s)`);
      } catch (err) {
        console.error(`  Warning: could not load newsletter state: ${err.message}`);
      }
    }
    console.log();

    // 2. Fetch content from all sources
    console.log('STEP 2: Fetching content from sources...');
    console.log();

    const { newsItems, newsletters } = await fetchAllContent(newsletterStateData);

    const totalItems = newsItems.length + newsletters.length;
    console.log();
    console.log(`  Total items collected: ${totalItems}`);
    console.log();

    // 3. Fetch episode memory for cross-episode continuity
    console.log('STEP 3: Fetching episode memory...');
    let episodeMemoryData = { episodes: [] };
    let episodeMemorySha = null;
    let episodeMemoryForPrompt = '';

    if (!dryRun) {
      try {
        const { data, sha } = await getEpisodeMemory();
        episodeMemoryData = data;
        episodeMemorySha = sha;
        episodeMemoryForPrompt = formatMemoryForPrompt(data, 7);
        const count = data.episodes.length;
        console.log(`  Loaded ${count} episode${count !== 1 ? 's' : ''} from memory`);
      } catch (err) {
        console.error(`  Warning: could not load episode memory: ${err.message}`);
        console.error('  Continuing without cross-episode context.');
      }
    }
    console.log();

    // 4. Synthesize script with Claude
    console.log('STEP 4: Synthesizing audio script...');
    console.log();

    const contentBundle = { newsItems, newsletters };
    const { script, summary, usage: claudeUsage } = await synthesizeScript(
      contentBundle,
      episodeMemoryForPrompt || null
    );
    const wordCount = script.split(/\s+/).length;

    const claudeCost = costTracker.trackClaude(claudeUsage.inputTokens, claudeUsage.outputTokens);
    console.log(`  Claude cost: $${claudeCost.totalCost.toFixed(4)} (${claudeUsage.inputTokens} in + ${claudeUsage.outputTokens} out tokens)`);
    console.log();

    // Get current time in Central Time
    const now = new Date();
    const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const dateStr = centralTime.toISOString().slice(0, 10);

    // Save script to file for reference
    const scriptFileName = `Dads-Digest-${dateStr}-script.txt`;
    const scriptPath = path.join('/tmp', scriptFileName);
    fs.writeFileSync(scriptPath, script, 'utf8');
    console.log(`  Script saved to: ${scriptPath}`);
    console.log();

    // 5. Convert to audio
    console.log('STEP 5: Converting to audio...');
    console.log();

    const episodeFileName = `Dads-Digest-${dateStr}.mp3`;
    const audioPath = path.join('/tmp', episodeFileName);
    const { outputPath: finalAudioPath, characters: ttsCharacters } = await convertToAudio(script, audioPath);

    const ttsCost = costTracker.trackTTS(ttsCharacters, 'wavenet');
    console.log(`  TTS cost: $${ttsCost.cost.toFixed(4)} (${ttsCharacters} characters)`);
    console.log();

    if (!fs.existsSync(finalAudioPath)) {
      throw new Error(`Audio file not created by TTS conversion: ${finalAudioPath}`);
    }
    const fileSizeBytes = fs.statSync(finalAudioPath).size;
    const durationSeconds = Math.round((fileSizeBytes * 8) / (128 * 1000));

    if (dryRun) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log('='.repeat(60));
      console.log('DRY RUN COMPLETE (no publish)');
      console.log('='.repeat(60));
      console.log(`  Duration: ${duration}s`);
      console.log(`  Items processed: ${totalItems}`);
      console.log(`  Script words: ${wordCount}`);
      console.log(`  Script file: ${scriptPath}`);
      console.log(`  Audio file: ${finalAudioPath}`);
      console.log();
      costTracker.printSummary();
      costTracker.logToFile('/tmp/podcast-costs.jsonl');
      return;
    }

    // 6. Build updated RSS feed
    console.log('STEP 6: Building RSS feed...');
    console.log();

    const existingFeed = await getCurrentFeed();
    const updatedFeed = buildUpdatedFeed(
      existingFeed,
      {
        title: `${PODCAST_TITLE} — ${dateStr}`,
        date: dateStr,
        fileName: episodeFileName,
        fileSizeBytes,
        durationSeconds,
        description: summary,
      },
      BASE_URL,
      {
        title: PODCAST_TITLE,
        author: PODCAST_AUTHOR,
        email: PODCAST_EMAIL,
        description: "Daily news digest covering WSJ, NYT, and weekly market newsletters — built with love for Dad's 70th birthday.",
      }
    );

    console.log('  Feed updated successfully');
    console.log();

    // 7. Publish to GitHub Pages
    console.log('STEP 7: Publishing to GitHub Pages...');
    console.log();

    await publishEpisode(finalAudioPath, updatedFeed, episodeFileName);

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('='.repeat(60));
    console.log('PIPELINE COMPLETE!');
    console.log('='.repeat(60));
    console.log(`  Duration: ${duration}s`);
    console.log(`  Items processed: ${totalItems}`);
    console.log(`  Script words: ${wordCount}`);
    console.log(`  Audio file: ${episodeFileName}`);
    console.log(`  Episode URL: ${BASE_URL}/episodes/${episodeFileName}`);
    console.log(`  RSS feed: ${BASE_URL}/feed.xml`);
    console.log();
    console.log('Episode published! Subscribe in your podcast app:');
    console.log(`   ${BASE_URL}/feed.xml`);

    // 7.5. Extract key topics and update episode memory
    console.log('Updating episode memory...');
    try {
      const { topics: keyTopics, usage: topicsUsage } = await extractKeyTopics(script);
      const newRecord = { date: dateStr, summary, keyTopics };
      const updatedMemory = addEpisodeToMemory(episodeMemoryData, newRecord);
      await commitEpisodeMemory(updatedMemory, episodeMemorySha);
      console.log(`  Memory updated: ${keyTopics.length} topics extracted for ${dateStr}`);
      if (topicsUsage) {
        const topicsCost = costTracker.trackClaude(topicsUsage.inputTokens, topicsUsage.outputTokens);
        console.log(`  Memory topics cost: $${topicsCost.totalCost.toFixed(4)}`);
      }
    } catch (err) {
      console.error(`  Warning: failed to update episode memory: ${err.message}`);
    }
    console.log();

    // 7.6. Update newsletter tracker state
    if (newsletters.length > 0) {
      console.log('Updating newsletter tracker...');
      try {
        let updatedState = newsletterStateData;
        for (const nl of newsletters) {
          updatedState = updateNewsletterState(updatedState, nl.newsletterKey, nl.url, nl.title);
        }
        await commitNewsletterState(updatedState, newsletterStateSha);
        console.log(`  Newsletter tracker updated for ${newsletters.length} newsletter(s)`);
      } catch (err) {
        console.error(`  Warning: failed to update newsletter tracker: ${err.message}`);
      }
      console.log();
    }

    // Print cost summary and log to file
    costTracker.printSummary();
    costTracker.logToFile('/tmp/podcast-costs.jsonl');

    // Persist TTS usage to gh-pages
    console.log('Tracking TTS usage...');
    try {
      await updateTTSUsage(ttsCharacters);
    } catch (err) {
      console.error(`  Failed to update TTS usage tracking: ${err.message}`);
    }
    console.log();

  } catch (error) {
    console.error();
    console.error('='.repeat(60));
    console.error('PIPELINE FAILED');
    console.error('='.repeat(60));
    console.error(error);
    console.error();
    throw error;
  }
}

async function runWithRetry({ dryRun = false, maxRetries = 2 } = {}) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Retry attempt ${attempt - 1}/${maxRetries}...`);
        console.log();
      }
      await run({ dryRun });
      return;
    } catch {
      if (attempt <= maxRetries) {
        const delaySec = attempt * 5;
        console.error(`Retrying in ${delaySec}s...`);
        await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
      } else {
        console.error('All retry attempts exhausted. Exiting.');
        process.exit(1);
      }
    }
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('*** DRY RUN MODE — will not publish to RSS/GitHub Pages ***');
    console.log();
  }
  runWithRetry({ dryRun });
}

module.exports = { run };
