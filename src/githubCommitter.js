/**
 * GitHub Pages Committer
 *
 * Commits files to gh-pages branch via GitHub API (no git binary needed)
 */

const axios = require('axios');
const fs = require('fs');

const GH_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY; // e.g. "username/repo-name"
const BRANCH = 'gh-pages';
const API_BASE = `https://api.github.com/repos/${REPO}`;

/**
 * Get the SHA of an existing file (needed for updates)
 */
async function getFileSha(filePath) {
  try {
    const response = await axios.get(
      `${API_BASE}/contents/${filePath}?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );
    return response.data.sha;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return null; // File doesn't exist yet
    }
    throw error;
  }
}

/**
 * Commit a file to gh-pages branch
 */
async function commitFile(filePath, contentBase64, message) {
  const sha = await getFileSha(filePath);

  const body = {
    message,
    content: contentBase64,
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  };

  await axios.put(`${API_BASE}/contents/${filePath}`, body, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
  });

  console.log(`  Committed: ${filePath}`);
}

/**
 * Publish episode to gh-pages (MP3 + updated feed.xml)
 */
async function publishEpisode(mp3Path, feedXml, episodeFileName) {
  console.log('Publishing to GitHub Pages...');

  try {
    // Upload MP3
    console.log(`  Uploading MP3: episodes/${episodeFileName}`);
    const mp3Base64 = fs.readFileSync(mp3Path).toString('base64');
    await commitFile(
      `episodes/${episodeFileName}`,
      mp3Base64,
      `Add episode: ${episodeFileName}`
    );

    // Upload updated feed.xml
    console.log('  Updating feed.xml');
    const feedBase64 = Buffer.from(feedXml, 'utf-8').toString('base64');
    await commitFile('feed.xml', feedBase64, `Update feed for ${episodeFileName}`);

    console.log();
    console.log('Published to gh-pages!');
    return true;
  } catch (error) {
    console.error('Failed to publish to GitHub Pages:', error.message);
    if (error.response) {
      console.error('  Response:', error.response.data);
    }
    throw error;
  }
}

module.exports = { publishEpisode, commitFile, getFileSha };
