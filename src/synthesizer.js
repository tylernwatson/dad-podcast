/**
 * Script Synthesizer
 *
 * Uses Claude API to generate a two-host conversational podcast script
 * tailored for Dad's Daily Digest — general news + markets content
 */

const Anthropic = require('@anthropic-ai/sdk');
const { fetchDallasWeather } = require('./weather');

/**
 * Synthesize audio script from content bundle
 */
async function synthesizeScript(contentBundle, episodeMemory = null) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 60 * 1000,
  });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Chicago',
  });

  // Fetch Dallas weather
  let weatherSummary = 'weather data unavailable';
  try {
    const weather = await fetchDallasWeather();
    weatherSummary = `${weather.description}, currently ${weather.current}°F, `
      + `high of ${weather.high}°F, low of ${weather.low}°F, `
      + `${weather.precip}% chance of rain, winds at ${weather.wind} mph`;
  } catch (err) {
    console.error(`  Warning: could not fetch weather: ${err.message}`);
  }

  const memoryContext = episodeMemory
    ? `═══════════════════════════════════════════════
RECENT EPISODE CONTEXT (last 7 days):
═══════════════════════════════════════════════
The following summaries capture what this podcast covered recently. Use this context to create natural continuity — for example, noting when a story has developed since a previous episode, or briefly recapping something relevant before diving deeper. Only reference prior coverage when it genuinely adds value. Never force connections that aren't there.

${episodeMemory}

`
    : '';

  // Build newsletter section if there are new newsletters
  const newsletterItems = contentBundle.newsletters || [];
  const newsletterSection = newsletterItems.length > 0
    ? `
═══════════════════════════════════════════════
WEEKLY NEWSLETTER CONTENT (give these dedicated discussion):
═══════════════════════════════════════════════
These are in-depth weekly market newsletters that Dan follows closely. When a new issue appears, give it a dedicated segment — not just a passing mention. Summarize the key arguments, highlight any contrarian or notable viewpoints, and discuss what it means for investors.

${JSON.stringify(newsletterItems, null, 2)}

`
    : '';

  const prompt = `
You are writing the script for "Dad's Daily Digest," a two-host personal morning podcast for Dan.
Today is ${today}. Dan is based in Dallas, Texas.

Dallas weather right now: ${weatherSummary}

${memoryContext}The show has two hosts:
- HOST: The primary anchor. Warm and authoritative, like a trusted morning news anchor. Drives the agenda, delivers the main stories, and keeps the episode moving.
- COHOST: The color commentator. Adds reactions, market context, follow-up questions, and practical takeaways. Occasionally plays devil's advocate.

Below is the raw content gathered from WSJ, NYT, and weekly market newsletters.

YOUR TASK:
Produce a complete, ready-to-record two-speaker podcast script for an 8–12 minute episode.

═══════════════════════════════════════════════
FORMAT RULES (critical):
═══════════════════════════════════════════════
- Every speaker turn MUST start with a speaker tag on its own line: [HOST] or [COHOST]
- The spoken text for that turn follows on the next line(s).
- Alternate between speakers naturally. Not every exchange needs to be equal length.
- Example:

[HOST]
Good morning! Big day in the markets.

[COHOST]
No kidding. That jobs report really caught everyone off guard.

[HOST]
Let's get right into it.

═══════════════════════════════════════════════
STRUCTURE (follow this exactly):
═══════════════════════════════════════════════

[COLD OPEN — 15–30 seconds]
- HOST greets Dan warmly (use "Dan" naturally, not every sentence).
- One sentence on what today's episode covers (the "headline of headlines").
- COHOST reacts and weaves in the Dallas weather naturally (not as a weather report — more like what a friend would say: "beautiful morning out there in Dallas" or "might want to grab a jacket today").

[THEME SEGMENTS — 3 to 6 segments, each ~1–2 minutes]
Cluster today's news into 3–6 named themes. Choose theme names that fit the actual news.
Good examples: "Markets & Economy", "Washington Watch", "Global Headlines",
"Business & Earnings", "Energy & Oil", "Technology & Innovation".
Discard low-signal or redundant items — not everything needs coverage.

For each theme segment:
- HOST introduces the theme with a punchy framing sentence, then delivers the core story.
- COHOST jumps in with reactions, market implications, follow-up questions, or "why it matters" color.
- Together they explain what happened, why it matters, and who it impacts.
- Add light, confident commentary — both hosts have opinions. Examples of the right tone:
  "This puts real pressure on the Fed to hold steady."
  "Honestly, this is better news for retirees than the market's giving it credit for."
  "I think this is being undersold — here's why it matters for dividend investors."
- Use first-person ("I think", "what I find interesting here is", "we've been watching this").
- Transitions between segments should feel natural, not formulaic.

${newsletterItems.length > 0 ? `[NEWSLETTER SEGMENT — dedicated discussion for each new newsletter]
When a weekly newsletter (Dividend Cafe or Thoughts from the Frontline) has a new issue,
give it a full 1–2 minute segment. Summarize the key thesis, notable data points, and
any contrarian or surprising viewpoints. Don't just mention it in passing — treat it
as substantial content that Dan values.

` : ''}[WRAP-UP — 15–30 seconds]
- HOST gives a quick recap of the 1–2 biggest themes.
- COHOST adds what Dan should keep an eye on over the coming days.
- Both sign off warmly and personally.

═══════════════════════════════════════════════
STYLE RULES:
═══════════════════════════════════════════════
- Write for the ear, not the eye. Short sentences. Active voice. No bullet points, no URLs, no markdown in the script.
- Conversational and smart — like two well-informed colleagues discussing the news over coffee.
- The banter should feel natural, not forced. Don't overdo the back-and-forth — let each host make substantive points.
- Do NOT pad with filler. If today is a slow news day, say so honestly and go deeper on fewer items.
- Target word count: 1,200–1,800 words (8–12 minutes at a natural speaking pace).
- The ONLY bracketed labels allowed are [HOST] and [COHOST] at the start of each speaker turn.
  No other stage directions, segment headers, or bracketed labels.
- Assume Dan is an experienced, sophisticated reader of financial news — don't over-explain basic concepts, but do provide context for complex developments.

═══════════════════════════════════════════════
RAW NEWS CONTENT:
═══════════════════════════════════════════════
${JSON.stringify(contentBundle.newsItems, null, 2)}

${newsletterSection}Return ONLY the two-speaker script with [HOST] and [COHOST] tags. No other labels, headers, stage directions, or markdown.
`;

  console.log('Synthesizing script with Claude Sonnet 4.6...');

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    });

    if (!message.content || message.content.length === 0) {
      throw new Error('Empty response from Claude API');
    }
    const script = message.content[0].text;
    const wordCount = script.split(/\s+/).length;

    console.log(`  Generated script: ${wordCount} words`);

    // Generate a short summary for the episode description
    console.log('  Generating episode summary...');
    const summaryMessage = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `In 2-3 sentences, summarize the key topics covered in this podcast episode. Write it as a listener-facing description — informative and engaging, no host names or personal references.\n\nScript:\n${script}`,
      }],
    });
    const summary = summaryMessage.content[0].text.trim();

    return {
      script,
      summary,
      usage: {
        inputTokens: message.usage.input_tokens + summaryMessage.usage.input_tokens,
        outputTokens: message.usage.output_tokens + summaryMessage.usage.output_tokens,
      },
    };

  } catch (error) {
    console.error('Error synthesizing script:', error.message);
    throw error;
  }
}

module.exports = { synthesizeScript };
