/**
 * TTS Usage Tracker
 *
 * Persists monthly TTS character usage to gh-pages and checks free-tier thresholds.
 * Google Cloud TTS provides 1M free WaveNet characters per month.
 */

const axios = require('axios');

const GH_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const BRANCH = 'gh-pages';
const USAGE_FILE = 'tts-usage.json';
const API_BASE = `https://api.github.com/repos/${REPO}`;

const FREE_TIER_LIMIT = 1_000_000;
const WARNING_THRESHOLD = 0.8;
const OVERAGE_RATE = 16.00 / 1_000_000; // $16 per 1M chars for WaveNet

async function getUsageData() {
  try {
    const response = await axios.get(
      `${API_BASE}/contents/${USAGE_FILE}?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    return { data: JSON.parse(content), sha: response.data.sha };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return { data: { months: {} }, sha: null };
    }
    throw error;
  }
}

async function commitUsageData(usageData, sha) {
  const contentBase64 = Buffer.from(
    JSON.stringify(usageData, null, 2),
    'utf-8'
  ).toString('base64');

  const body = {
    message: 'Update TTS usage data',
    content: contentBase64,
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  };

  await axios.put(`${API_BASE}/contents/${USAGE_FILE}`, body, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
  });
}

function checkThreshold(monthChars) {
  const pct = (monthChars / FREE_TIER_LIMIT) * 100;
  const formatted = monthChars.toLocaleString();
  const limit = FREE_TIER_LIMIT.toLocaleString();

  if (monthChars > FREE_TIER_LIMIT) {
    const overage = monthChars - FREE_TIER_LIMIT;
    const overageCost = overage * OVERAGE_RATE;
    console.log(`  TTS Usage: ${formatted} / ${limit} free chars this month (${pct.toFixed(0)}%)`);
    console.log(`  WARNING: Free tier exceeded! Estimated overage cost: $${overageCost.toFixed(4)} (${overage.toLocaleString()} chars over limit)`);
  } else if (pct >= WARNING_THRESHOLD * 100) {
    console.log(`  TTS Usage: ${formatted} / ${limit} free chars this month (${pct.toFixed(0)}%) — approaching free tier limit!`);
  } else {
    console.log(`  TTS Usage: ${formatted} / ${limit} free chars this month (${pct.toFixed(0)}%)`);
  }
}

async function updateTTSUsage(characters) {
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);

  const { data: usageData, sha } = await getUsageData();

  if (!usageData.months[monthKey]) {
    usageData.months[monthKey] = { characters: 0, runs: 0 };
  }
  usageData.months[monthKey].characters += characters;
  usageData.months[monthKey].runs += 1;

  await commitUsageData(usageData, sha);

  checkThreshold(usageData.months[monthKey].characters);
}

module.exports = { updateTTSUsage, getUsageData, checkThreshold };
