/**
 * Newsletter Tracker
 *
 * Persists last-seen state for weekly newsletters (Dividend Cafe, Thoughts from the Frontline)
 * to gh-pages so we only include new issues in the podcast.
 */

const axios = require('axios');

const GH_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const BRANCH = 'gh-pages';
const TRACKER_FILE = 'newsletter-tracker.json';
const API_BASE = `https://api.github.com/repos/${REPO}`;

/**
 * Fetch existing newsletter state from gh-pages.
 * Returns { data: { newsletters: {} }, sha: null } on first run.
 */
async function getNewsletterState() {
  try {
    const response = await axios.get(
      `${API_BASE}/contents/${TRACKER_FILE}?ref=${BRANCH}`,
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
      return { data: { newsletters: {} }, sha: null };
    }
    throw error;
  }
}

/**
 * Commit updated newsletter state to gh-pages.
 */
async function commitNewsletterState(stateData, sha) {
  const contentBase64 = Buffer.from(
    JSON.stringify(stateData, null, 2),
    'utf-8'
  ).toString('base64');

  const body = {
    message: 'Update newsletter tracker',
    content: contentBase64,
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  };

  await axios.put(`${API_BASE}/contents/${TRACKER_FILE}`, body, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Update state for a specific newsletter after including it in an episode.
 */
function updateNewsletterState(stateData, newsletterKey, url, title) {
  return {
    ...stateData,
    newsletters: {
      ...stateData.newsletters,
      [newsletterKey]: {
        lastSeenUrl: url,
        lastSeenTitle: title,
        lastSeenDate: new Date().toISOString(),
      },
    },
  };
}

module.exports = { getNewsletterState, commitNewsletterState, updateNewsletterState };
