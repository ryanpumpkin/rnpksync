const axios = require('axios');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getVideoTitle(videoId, logger) {
  try {
    const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': UA },
      timeout: 8000
    });
    const match = response.data.match(/<title>(.*?)<\/title>/);
    if (match && match[1]) {
      return match[1].replace(' - YouTube', '').trim();
    }
  } catch (error) {
    if (logger) logger.warn({ videoId, err: error.message }, 'getVideoTitle failed');
  }
  return 'Unknown Title';
}

function decodeJsonString(s) {
  try { return JSON.parse('"' + s + '"'); } catch (e) { return s; }
}

async function getPlaylistVideos(playlistId, logger) {
  try {
    const url = `https://www.youtube.com/playlist?list=${playlistId}&hl=en`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': UA },
      timeout: 10000
    });
    const items = [];
    const seen = new Set();
    const re = /"playlistVideoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"[\s\S]*?"title":\{(?:"runs":\[\{"text":"((?:\\.|[^"\\])*)"|"simpleText":"((?:\\.|[^"\\])*)")/g;
    let m;
    while ((m = re.exec(response.data)) !== null) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const rawTitle = m[2] || m[3] || '';
      items.push({ videoId: id, title: decodeJsonString(rawTitle) || 'Unknown Title' });
    }
    return items;
  } catch (error) {
    if (logger) logger.warn({ playlistId, err: error.message }, 'getPlaylistVideos failed');
    return [];
  }
}

function extractPlaylistID(url) {
  if (!url) return null;
  const decoded = decodeURIComponent(url);
  const m = decoded.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const id = m[1];
  if (id.startsWith('RD') || id === 'WL' || id === 'LL') return null;
  return id;
}

function extractYouTubeID(url) {
  if (!url) return null;
  const decodedUrl = decodeURIComponent(url);
  const patterns = [
    /(?:(?:music|m|www)\.)?youtube\.com\/watch\?(?:[^&]+&)*v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /(?:(?:music|m|www)\.)?youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /(?:(?:m|www)\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /(?:(?:m|www)\.)?youtube\.com\/live\/([A-Za-z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = decodedUrl.match(pattern);
    if (match) return match[1];
  }
  return null;
}

module.exports = { getVideoTitle, getPlaylistVideos, extractPlaylistID, extractYouTubeID };
