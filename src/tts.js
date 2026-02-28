/**
 * Text-to-Speech Converter
 *
 * Converts two-speaker script to MP3 audio using Google Cloud TTS
 * Uses WaveNet voices: Wavenet-D (HOST) and Wavenet-F (COHOST)
 */

const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const path = require('path');

const VOICE_CONFIGS = {
  HOST: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
  COHOST: { languageCode: 'en-US', name: 'en-US-Wavenet-F' },
};

/**
 * Parse a two-speaker script into ordered segments by speaker.
 */
function parseScriptBySpeaker(script) {
  const segments = [];
  const parts = script.split(/\[(HOST|COHOST)\]/);

  for (let i = 1; i < parts.length; i += 2) {
    const speaker = parts[i];
    const text = (parts[i + 1] || '').trim();
    if (text) {
      segments.push({ speaker, text });
    }
  }

  return segments;
}

/**
 * Split text into chunks under the byte limit
 */
function chunkScript(script, maxBytes = 4500) {
  const sentences = script.match(/[^.!?]+[.!?]+/g) || [script];
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const testChunk = currentChunk + sentence;

    if (Buffer.byteLength(testChunk, 'utf8') > maxBytes) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        chunks.push(sentence.trim());
      }
    } else {
      currentChunk = testChunk;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

async function synthesizeChunk(client, text, voiceConfig) {
  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: voiceConfig,
    audioConfig: {
      audioEncoding: 'MP3',
      pitch: 0,
      speakingRate: 1.0,
      effectsProfileId: ['large-home-entertainment-class-device'],
    },
  });

  return response.audioContent;
}

async function synthesizeChunkWithRetry(client, text, voiceConfig, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await synthesizeChunk(client, text, voiceConfig);
    } catch (error) {
      if (attempt <= maxRetries) {
        const delaySec = attempt * 3;
        process.stdout.write(`\n  Chunk attempt ${attempt} failed (${error.message}). Retrying in ${delaySec}s...\n`);
        await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
      } else {
        throw error;
      }
    }
  }
}

function combineMP3Files(files, outputPath) {
  const combinedBuffer = Buffer.concat(
    files.map(file => fs.readFileSync(file))
  );
  fs.writeFileSync(outputPath, combinedBuffer);
  files.forEach(file => fs.unlinkSync(file));
}

async function convertToAudio(script, outputPath) {
  console.log('Converting script to audio with Google Cloud TTS...');

  try {
    const client = new textToSpeech.TextToSpeechClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });

    const segments = parseScriptBySpeaker(script);
    const totalChars = Buffer.byteLength(script, 'utf8');
    console.log(`  Script size: ${totalChars} bytes, ${segments.length} speaker segments`);

    const tmpDir = '/tmp/tts-chunks';
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const chunkFiles = [];
    let chunkIndex = 0;

    for (let s = 0; s < segments.length; s++) {
      const { speaker, text } = segments[s];
      const voiceConfig = VOICE_CONFIGS[speaker];
      const segmentBytes = Buffer.byteLength(text, 'utf8');

      const textChunks = segmentBytes > 4500 ? chunkScript(text, 4500) : [text];

      for (const chunk of textChunks) {
        process.stdout.write(`  Synthesizing segment ${s + 1}/${segments.length} [${speaker}] chunk ${chunkIndex + 1}...\r`);

        const audioContent = await synthesizeChunkWithRetry(client, chunk, voiceConfig);
        const chunkPath = path.join(tmpDir, `chunk-${chunkIndex.toString().padStart(3, '0')}.mp3`);
        fs.writeFileSync(chunkPath, audioContent, 'binary');
        chunkFiles.push(chunkPath);
        chunkIndex++;
      }
    }

    console.log();

    if (chunkFiles.length === 1) {
      fs.renameSync(chunkFiles[0], outputPath);
    } else {
      console.log(`  Combining ${chunkFiles.length} audio chunks...`);
      combineMP3Files(chunkFiles, outputPath);
    }

    try {
      fs.rmdirSync(tmpDir);
    } catch (e) {
      console.warn('Warning: could not remove temp directory:', e.message);
    }

    const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(2);
    console.log(`  Audio saved to ${outputPath} (${sizeKB} KB)`);

    return {
      outputPath,
      characters: totalChars,
    };

  } catch (error) {
    console.error('Error converting to audio:', error.message);
    throw error;
  }
}

module.exports = { convertToAudio, parseScriptBySpeaker };
