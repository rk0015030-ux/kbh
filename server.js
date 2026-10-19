
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 50 * 1024 * 1024 });
const PORT = process.env.PORT || 8080;
const PRIZE_LADDER = [100, 200, 300, 400, 500, 700, 900, 1100, 1500, 2000];

function getQuestionTimeLimit(level) {
  if (level <= 5) return 30;
  if (level <= 8) return 60;
  return 120;
}

// Image storage configuration
const imagesDir = path.join(__dirname, 'public', 'images');
const imageIndexPath = path.join(imagesDir, 'index.json');
const imageDatabase = new Map();
const videosDir = path.join(__dirname, 'public', 'videos');
const videoIndexPath = path.join(videosDir, 'index.json');
const videoDatabase = new Map();
const audioDir = path.join(__dirname, 'public', 'audio');
const audioIndexPath = path.join(audioDir, 'index.json');
const audioDatabase = new Map();
const scoreDataDir = path.join(__dirname, 'data');
const scoreDatabasePath = path.join(scoreDataDir, 'scores.json');
const scoreDatabase = [];
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;
const mediaStorageEnabled = Boolean(supabase);
const mediaBuckets = { images: 'images', videos: 'videos', audio: 'audio' };

async function uploadMedia(bucket, filename, file) {
  const { error } = await supabase.storage.from(bucket).upload(filename, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: true
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
  return data.publicUrl;
}

async function deleteMedia(bucket, filename) {
  const { error } = await supabase.storage.from(bucket).remove([filename]);
  if (error) throw error;
}

async function saveRemoteIndex(bucket, database) {
  const body = Buffer.from(JSON.stringify(Object.fromEntries(database), null, 2));
  const { error } = await supabase.storage.from(bucket).upload('_index.json', body, {
    contentType: 'application/json',
    upsert: true
  });
  if (error) throw error;
}

async function loadRemoteIndex(bucket, database) {
  const { data, error } = await supabase.storage.from(bucket).download('_index.json');
  if (error) {
    if (!/not found/i.test(error.message || '')) console.warn(`Could not load ${bucket} index:`, error.message);
    return;
  }
  const entries = JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'));
  Object.entries(entries).forEach(([id, media]) => database.set(id, media));
}

async function loadRemoteIndexes() {
  if (!mediaStorageEnabled) return;
  await Promise.all([
    loadRemoteIndex(mediaBuckets.images, imageDatabase),
    loadRemoteIndex(mediaBuckets.videos, videoDatabase),
    loadRemoteIndex(mediaBuckets.audio, audioDatabase)
  ]);
}

// Ensure images directory exists
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
if (!fs.existsSync(scoreDataDir)) fs.mkdirSync(scoreDataDir, { recursive: true });

function saveImageIndex() {
  if (mediaStorageEnabled) return saveRemoteIndex(mediaBuckets.images, imageDatabase);
  fs.writeFileSync(imageIndexPath, JSON.stringify(Object.fromEntries(imageDatabase), null, 2));
}

function loadImageIndex() {
  try {
    const entries = JSON.parse(fs.readFileSync(imageIndexPath, 'utf8'));
    Object.entries(entries).forEach(([imageId, image]) => {
      if (image && image.filename && fs.existsSync(path.join(imagesDir, image.filename))) imageDatabase.set(imageId, image);
    });
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not load image index:', error.message);
  }
}

loadImageIndex();

function saveVideoIndex() {
  if (mediaStorageEnabled) return saveRemoteIndex(mediaBuckets.videos, videoDatabase);
  fs.writeFileSync(videoIndexPath, JSON.stringify(Object.fromEntries(videoDatabase), null, 2));
}

function loadVideoIndex() {
  try {
    const entries = JSON.parse(fs.readFileSync(videoIndexPath, 'utf8'));
    Object.entries(entries).forEach(([videoId, video]) => {
      if (video && video.filename && fs.existsSync(path.join(videosDir, video.filename))) videoDatabase.set(videoId, video);
    });
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not load video index:', error.message);
  }
}

loadVideoIndex();

function saveAudioIndex() {
  if (mediaStorageEnabled) return saveRemoteIndex(mediaBuckets.audio, audioDatabase);
  fs.writeFileSync(audioIndexPath, JSON.stringify(Object.fromEntries(audioDatabase), null, 2));
}

function loadAudioIndex() {
  try {
    const entries = JSON.parse(fs.readFileSync(audioIndexPath, 'utf8'));
    Object.entries(entries).forEach(([audioId, audio]) => {
      if (audio && audio.filename && fs.existsSync(path.join(audioDir, audio.filename))) audioDatabase.set(audioId, audio);
    });
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not load audio index:', error.message);
  }
}

loadAudioIndex();

function saveScoreDatabase() {
  fs.writeFileSync(scoreDatabasePath, JSON.stringify(scoreDatabase, null, 2));
}

function loadScoreDatabase() {
  try {
    const entries = JSON.parse(fs.readFileSync(scoreDatabasePath, 'utf8'));
    if (Array.isArray(entries)) {
      entries.forEach((entry) => {
        if (entry && entry.playerId) scoreDatabase.push(entry);
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not load score database:', error.message);
  }
}

function persistScoreSnapshot({ playerId, name, roomId, score, cash, clearedLevel, eliminated }) {
  if (!playerId || !name) return null;

  const snapshot = {
    playerId,
    name: String(name).trim() || 'Player',
    roomId: roomId || 'unknown',
    score: Number(score) || 0,
    cash: Number(cash) || Number(score) || 0,
    clearedLevel: Number(clearedLevel) || 0,
    eliminated: Boolean(eliminated),
    updatedAt: new Date().toISOString()
  };

  const existingIndex = scoreDatabase.findIndex((entry) => entry.playerId === playerId && entry.roomId === snapshot.roomId);
  if (existingIndex >= 0) {
    const previous = scoreDatabase[existingIndex];
    if (typeof eliminated !== 'boolean') snapshot.eliminated = Boolean(previous.eliminated);
    scoreDatabase[existingIndex] = { ...previous, ...snapshot, score: Math.max(previous.score || 0, snapshot.score || 0) };
  } else {
    scoreDatabase.push(snapshot);
  }

  scoreDatabase.sort((a, b) => Number(b.score) - Number(a.score));
  saveScoreDatabase();
  return snapshot;
}

function getTopScores(limit = 20) {
  return [...scoreDatabase]
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, limit);
}

function removeScoreSnapshot(playerId) {
  if (!playerId) return false;
  const beforeLength = scoreDatabase.length;
  const filtered = scoreDatabase.filter((entry) => entry.playerId !== playerId);
  if (filtered.length === beforeLength) return false;
  scoreDatabase.length = 0;
  filtered.forEach((entry) => scoreDatabase.push(entry));
  saveScoreDatabase();
  return true;
}

loadScoreDatabase();

function createImageId() {
  const usedNumbers = Array.from(imageDatabase.keys())
    .map(id => /^image-(\d+)$/i.exec(id))
    .filter(Boolean)
    .map(match => Number(match[1]));
  return `image-${usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1}`;
}

// Multer configuration for image uploads
const storage = mediaStorageEnabled ? multer.memoryStorage() : multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imagesDir);
  },
  filename: (req, file, cb) => {
    const imageId = uuidv4();
    const ext = path.extname(file.originalname);
    const filename = imageId + ext;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per image
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, GIF, WEBP allowed.'));
    }
  }
});

const videoStorage = mediaStorageEnabled ? multer.memoryStorage() : multer.diskStorage({
  destination: (req, file, cb) => cb(null, videosDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname).toLowerCase())
});
const uploadVideos = multer({
  storage: videoStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Only MP4, WEBM, OGG, MOV allowed.'));
  }
});
const audioStorage = mediaStorageEnabled ? multer.memoryStorage() : multer.diskStorage({
  destination: (req, file, cb) => cb(null, audioDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname).toLowerCase())
});
const uploadAudios = multer({
  storage: audioStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm'];
    const allowedExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm'];
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Invalid file type. Only MP3, WAV, OGG, M4A, AAC, and WEBM audio allowed.'));
  }
});

async function storeUploadedMedia(bucket, routePrefix, file) {
  const filename = mediaStorageEnabled
    ? `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`
    : file.filename;
  const url = mediaStorageEnabled
    ? await uploadMedia(bucket, filename, file)
    : `${routePrefix}/${encodeURIComponent(filename)}`;
  return { filename, url };
}

// 2. API Routes for Image Management

// Upload single or multiple images
app.post('/api/images/upload', upload.array('images', 100), async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const uploadedImages = [];
    for (const file of req.files) {
    const imageId = createImageId();
    const stored = await storeUploadedMedia(mediaBuckets.images, '/images', file);
    imageDatabase.set(imageId, {
      name: file.originalname,
      url: stored.url,
      filename: stored.filename,
      uploadedAt: new Date(),
      size: file.size
    });
    uploadedImages.push({
      imageId,
      url: stored.url,
      name: file.originalname
    });
    }

    await saveImageIndex();

    res.json({
      success: true,
      message: `${uploadedImages.length} images uploaded successfully`,
      images: uploadedImages
    });
  } catch (error) {
    next(error);
  }
});

// Get all uploaded images
app.get('/api/images/list', (req, res) => {
  const images = Array.from(imageDatabase.entries()).map(([imageId, data]) => ({
    imageId,
    name: data.name,
    url: data.url,
    uploadedAt: data.uploadedAt,
    size: data.size
  }));
  res.json({ images });
});

// Get image by ID
app.get('/api/images/:imageId', (req, res) => {
  const { imageId } = req.params;
  const imageData = imageDatabase.get(imageId);
  if (!imageData) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.json({
    imageId,
    name: imageData.name,
    url: imageData.url,
    uploadedAt: imageData.uploadedAt
  });
});

// Delete image by ID
app.delete('/api/images/:imageId', async (req, res) => {
  const { imageId } = req.params;
  const imageData = imageDatabase.get(imageId);
  if (!imageData) {
    return res.status(404).json({ error: 'Image not found' });
  }

  try {
    if (mediaStorageEnabled) {
      await deleteMedia(mediaBuckets.images, imageData.filename);
    } else {
      const filePath = path.join(imagesDir, imageData.filename);
      await fs.promises.unlink(filePath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    imageDatabase.delete(imageId);
    await saveImageIndex();
    res.json({ success: true, message: 'Image deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete image file' });
  }
});

function createVideoId() {
  const usedNumbers = Array.from(videoDatabase.keys())
    .map(id => /^video-(\d+)$/i.exec(id)).filter(Boolean).map(match => Number(match[1]));
  return `video-${usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1}`;
}

app.post('/api/videos/upload', uploadVideos.array('videos', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No videos uploaded' });
  try {
    const videos = [];
    for (const file of req.files) {
      const videoId = createVideoId();
      const stored = await storeUploadedMedia(mediaBuckets.videos, '/videos', file);
      const video = {
        name: file.originalname,
        url: stored.url,
        filename: stored.filename,
        uploadedAt: new Date(),
        size: file.size
      };
      videoDatabase.set(videoId, video);
      videos.push({ videoId, name: video.name, url: video.url });
    }
    await saveVideoIndex();
    res.json({ success: true, message: `${videos.length} videos uploaded successfully`, videos });
  } catch (error) {
    res.status(500).json({ error: 'Could not upload video files' });
  }
});

app.get('/api/videos/list', (req, res) => {
  res.json({ videos: Array.from(videoDatabase.entries()).map(([videoId, data]) => ({
    videoId, name: data.name, url: data.url, uploadedAt: data.uploadedAt, size: data.size
  })) });
});

app.get('/api/scores', (req, res) => {
  const limit = Number(req.query.limit) || 20;
  res.json({ success: true, scores: getTopScores(limit) });
});

app.post('/api/scores', (req, res) => {
  let body = {};
  try {
    body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
  } catch (error) {
    return res.status(400).json({ error: 'Invalid score payload' });
  }

  const saved = persistScoreSnapshot({
    playerId: body.playerId,
    name: body.name,
    roomId: body.roomId,
    score: body.score,
    cash: body.cash,
    clearedLevel: body.clearedLevel,
    eliminated: body.eliminated
  });

  if (!saved) return res.status(400).json({ error: 'playerId and name are required' });
  res.json({ success: true, score: saved, scores: getTopScores(20) });
});

app.delete('/api/scores/:playerId', (req, res) => {
  const { playerId } = req.params;
  const removed = removeScoreSnapshot(playerId);
  if (!removed) return res.status(404).json({ error: 'Player score not found' });
  res.json({ success: true, scores: getTopScores(20) });
});

app.delete('/api/videos/:videoId', async (req, res) => {
  const video = videoDatabase.get(req.params.videoId);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  try {
    if (mediaStorageEnabled) {
      await deleteMedia(mediaBuckets.videos, video.filename);
    } else {
      await fs.promises.unlink(path.join(videosDir, video.filename)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    videoDatabase.delete(req.params.videoId);
    await saveVideoIndex();
    res.json({ success: true, message: 'Video deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete video file' });
  }
});

function createAudioId() {
  const usedNumbers = Array.from(audioDatabase.keys())
    .map(id => /^audio-(\d+)$/i.exec(id)).filter(Boolean).map(match => Number(match[1]));
  return `audio-${usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1}`;
}

app.post('/api/audio/upload', (req, res, next) => {
  uploadAudios.array('audios', 50)(req, res, error => {
    if (!error) return next();
    const isBadRequest = error instanceof multer.MulterError || error.message.startsWith('Invalid file type');
    res.status(isBadRequest ? 400 : 500).json({
      error: isBadRequest ? error.message : 'Could not process audio upload'
    });
  });
}, async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No audio files uploaded' });
  try {
    const audios = [];
    for (const file of req.files) {
      const audioId = createAudioId();
      const stored = await storeUploadedMedia(mediaBuckets.audio, '/audio', file);
      const audio = {
        name: file.originalname,
        url: stored.url,
        filename: stored.filename,
        uploadedAt: new Date(),
        size: file.size
      };
      audioDatabase.set(audioId, audio);
      audios.push({ audioId, name: audio.name, url: audio.url });
    }
    await saveAudioIndex();
    res.json({ success: true, message: `${audios.length} audio files uploaded successfully`, audios });
  } catch (error) {
    res.status(500).json({ error: 'Could not upload audio files' });
  }
});

app.get('/api/audio/list', (req, res) => {
  res.json({ audios: Array.from(audioDatabase.entries()).map(([audioId, data]) => ({
    audioId, name: data.name, url: data.url, uploadedAt: data.uploadedAt, size: data.size
  })) });
});

app.delete('/api/audio/:audioId', async (req, res) => {
  const audio = audioDatabase.get(req.params.audioId);
  if (!audio) return res.status(404).json({ error: 'Audio not found' });
  try {
    if (mediaStorageEnabled) {
      await deleteMedia(mediaBuckets.audio, audio.filename);
    } else {
      await fs.promises.unlink(path.join(audioDir, audio.filename)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    audioDatabase.delete(req.params.audioId);
    await saveAudioIndex();
    res.json({ success: true, message: 'Audio deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete audio file' });
  }
});

// 2. Default Routes
function createVideoId() {
  const usedNumbers = Array.from(videoDatabase.keys()).map(id => /^video-(\d+)$/i.exec(id)).filter(Boolean).map(match => Number(match[1]));
  return `video-${usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1}`;
}

app.post('/api/videos/upload', uploadVideos.array('videos', 50), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No videos uploaded' });
  const videos = req.files.map(file => {
    const videoId = createVideoId();
    const video = { name: file.originalname, url: `/videos/${encodeURIComponent(file.filename)}`, filename: file.filename, uploadedAt: new Date(), size: file.size };
    videoDatabase.set(videoId, video);
    return { videoId, name: video.name, url: video.url };
  });
  saveVideoIndex();
  res.json({ success: true, message: `${videos.length} videos uploaded successfully`, videos });
});

app.get('/api/videos/list', (req, res) => {
  res.json({ videos: Array.from(videoDatabase.entries()).map(([videoId, data]) => ({ videoId, name: data.name, url: data.url, uploadedAt: data.uploadedAt, size: data.size })) });
});

app.delete('/api/videos/:videoId', (req, res) => {
  const video = videoDatabase.get(req.params.videoId);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  fs.unlink(path.join(videosDir, video.filename), error => {
    if (error && error.code !== 'ENOENT') return res.status(500).json({ error: 'Could not delete video file' });
    videoDatabase.delete(req.params.videoId);
    saveVideoIndex();
    res.json({ success: true, message: 'Video deleted' });
  });
});

app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, 'host.html'));
});

app.get('/player', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, 'Player.html'));
});

const rooms = new Map();

function send(ws, obj) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj)); 
    }
  } catch (e) { console.error("Send error:", e); }
}

function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.host) send(room.host, message);
  for (const [, p] of room.players.entries()) {
    send(p.ws, message);
  }
}

function broadcastConnectionStatus(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcastToRoom(roomId, {
    type: 'connection_status',
    payload: {
      host: Boolean(room.host && room.host.readyState === WebSocket.OPEN),
      player: Array.from(room.players.values()).some(({ ws }) => ws.readyState === WebSocket.OPEN)
    }
  });
}

wss.on('connection', (ws) => {
  ws.id = uuidv4();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }

    const { type, payload } = msg;

    // 1. JOIN LOGIC
    if (type === 'join') {
      const { role, roomId, name } = payload || {};
      ws.role = role;
      ws.roomId = roomId;
      ws.name = name || (role === 'host' ? 'Host' : `Player-${ws.id.slice(0,4)}`);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, { host: null, players: new Map(), currentQuestion: null, questionLevel: 1, lifelines: { callUsed: false } });
      }
      const room = rooms.get(roomId);

      if (role === 'host') {
        room.host = ws;
        room.currentQuestion = null;
        room.questionLevel = 1;
        for (const [, player] of room.players.entries()) {
          player.cash = 0;
          player.score = 0;
          player.clearedLevel = 0;
          player.eliminated = false;
          persistScoreSnapshot({ playerId: player.ws?.id, name: player.name, roomId, score: 0, cash: 0, clearedLevel: 0, eliminated: false });
          send(player.ws, { type: 'refresh' });
        }
        send(ws, { type: 'joined', payload: { role: 'host', roomId } });
      } else {
        room.players.set(ws.id, { ws, name: ws.name, score: 0, cash: 0, clearedLevel: 0, eliminated: false });
        send(ws, { type: 'joined', payload: { role: 'player', roomId, playerId: ws.id } });
        if (room.lifelines?.callUsed) send(ws, { type: 'lifeline_call' });
        if (room.host) send(room.host, { type: 'player_joined', payload: { playerId: ws.id, name: ws.name } });
      }
      broadcastConnectionStatus(roomId);
      return;
    }

    // 2. HOST-CONTROLLED ANSWER WORKFLOW
    if (type === 'host_select_answer') {
      const room = rooms.get(ws.roomId);
      const answer = String(payload?.answer || '').toUpperCase();
      if (!room || ws.role !== 'host' || !room.currentQuestion || room.currentQuestion.answerLocked || !['A', 'B', 'C', 'D'].includes(answer)) return;
      room.currentQuestion.hostSelectedAnswer = answer;
      broadcastToRoom(ws.roomId, { type: 'host_answer_selected', payload: { answer } });
      return;
    }

    if (type === 'host_lock_answer') {
      const room = rooms.get(ws.roomId);
      const playerId = payload?.playerId || room?.players.keys().next().value || null;
      const answer = String(room?.currentQuestion?.hostSelectedAnswer || payload?.answer || '').toUpperCase();
      if (!room || ws.role !== 'host' || !room.currentQuestion || room.currentQuestion.answerLocked || !['A', 'B', 'C', 'D'].includes(answer)) return;
      const player = playerId ? room.players.get(playerId) : null;
      room.currentQuestion.hostSelectedAnswer = answer;
      room.currentQuestion.answerLocked = true;
      room.currentQuestion.activePlayerId = playerId || null;
      broadcastToRoom(ws.roomId, {
        type: 'answer_locked',
        payload: { answer: room.currentQuestion.hostSelectedAnswer, playerId: playerId || null, playerName: player?.name || 'Player' }
      });
      return;
    }

    if (type === 'host_mark_result') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'host' || !room.currentQuestion?.answerLocked || room.currentQuestion.resultMarked) return;
      const correctAnswer = String(room.currentQuestion.metadata?.correct || '').toUpperCase();
      const result = room.currentQuestion.hostSelectedAnswer === correctAnswer ? 'correct' : 'wrong';
      const playerId = room.currentQuestion.activePlayerId || payload?.playerId;
      const targetPlayer = playerId ? room.players.get(playerId) : null;
      const activeLevel = room.currentQuestion.level || 1;

      if (targetPlayer) {
        if (result === 'correct') {
          targetPlayer.clearedLevel = Math.max(targetPlayer.clearedLevel, activeLevel);
          targetPlayer.cash = PRIZE_LADDER[targetPlayer.clearedLevel - 1] || 0;
        }
        if (result === 'wrong') targetPlayer.eliminated = true;
        targetPlayer.score = targetPlayer.cash;
      }
      if (result === 'wrong') room.questionLevel = 1;
      room.currentQuestion.resultMarked = true;
      if (targetPlayer) {
        persistScoreSnapshot({
          playerId: targetPlayer.ws?.id || targetPlayer.playerId || playerId,
          name: targetPlayer.name,
          roomId: ws.roomId,
          score: targetPlayer.score,
          cash: targetPlayer.cash,
          clearedLevel: targetPlayer.clearedLevel,
          eliminated: targetPlayer.eliminated
        });
      }
      broadcastToRoom(ws.roomId, {
        type: 'answer_result',
        payload: {
          result,
          answer: room.currentQuestion.hostSelectedAnswer,
          playerId: playerId || null,
          cash: targetPlayer?.cash ?? null,
          eliminated: targetPlayer?.eliminated ?? false,
          level: activeLevel,
          resetLevel: result === 'wrong' ? 1 : null
        }
      });
      broadcastScoreboard(room);
      return;
    }

    // 3. SEND QUESTION
    if (type === 'send_question') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'host') return;
      const level = room.questionLevel;
      room.currentQuestion = {
        ...payload,
        level,
        timeLimitSec: getQuestionTimeLimit(level),
        hostSelectedAnswer: null,
        answerLocked: false,
        activePlayerId: null
      };
      room.questionLevel = Math.min(room.questionLevel + 1, PRIZE_LADDER.length);
      broadcastToRoom(ws.roomId, { type: 'question', payload: room.currentQuestion });
      send(ws, {
        type: 'question_sent',
        payload: {
          text: room.currentQuestion.text,
          videoId: room.currentQuestion.videoId || null,
          audioId: room.currentQuestion.audioId || null,
          format: room.currentQuestion.format || 'text'
        }
      });
      return;
    }

    // 4. SCORE UPDATE
    if (type === 'score_update') {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const pId = payload.playerId;
      const playerEntry = room.players.get(pId);
      if (playerEntry) {
        playerEntry.cash = Math.max(0, Number(payload.cash) || 0);
        playerEntry.score = playerEntry.cash;
        persistScoreSnapshot({
          playerId: pId,
          name: playerEntry.name,
          roomId: ws.roomId,
          score: playerEntry.score,
          cash: playerEntry.cash,
          clearedLevel: playerEntry.clearedLevel,
          eliminated: playerEntry.eliminated
        });
        broadcastScoreboard(room);
      }
      return;
    }

    // 6. LIST PLAYERS
    if (type === 'list_players') {
      const room = rooms.get(ws.roomId);
      if (room) {
        const players = Array.from(room.players.entries()).map(([pid, p]) => ({
          playerId: pid,
          name: p.name,
          score: p.score,
          cash: p.cash,
          clearedLevel: p.clearedLevel
        }));
        send(ws, { type: 'players', payload: players });
      }
      return;
    }

    // 7. LIFELINE
    if (type === 'video_preview') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'host' || !payload?.url) return;
      broadcastToRoom(ws.roomId, { type: 'video_preview', payload: { url: payload.url, name: payload.name || 'Video question', videoId: payload.videoId || null } });
      return;
    }

    if (type === 'video_ended') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'player') return;
      if (room.host) send(room.host, { type: 'video_ended', payload: { videoId: payload?.videoId || null, playerId: ws.id } });
      return;
    }

    if (type === 'audio_preview') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'host' || !payload?.url) return;
      broadcastToRoom(ws.roomId, { type: 'audio_preview', payload: { url: payload.url, name: payload.name || 'Audio question', audioId: payload.audioId || null } });
      return;
    }

    if (type === 'audio_ended') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'player') return;
      if (room.host) send(room.host, { type: 'audio_ended', payload: { audioId: payload?.audioId || null, playerId: ws.id } });
      return;
    }

    if (type === 'lifeline_5050') {
      broadcastToRoom(ws.roomId, {
        type: 'lifeline_5050',
        payload
      });
      return;
    }

    if (type === 'lifeline_call') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'host') return;
      room.lifelines = room.lifelines || {};
      room.lifelines.callUsed = true;
      broadcastToRoom(ws.roomId, { type: 'lifeline_call' });
      return;
    }

    // 7.5 TIMER SYNC
    if (type === 'timer_started') {
      const room = rooms.get(ws.roomId);
      if (room && room.host) {
        send(room.host, {
          type: 'timer_started',
          payload
        });
      }
      return;
    }

    if (type === 'timer_update') {
      const room = rooms.get(ws.roomId);
      if (room && room.host) {
        send(room.host, {
          type: 'timer_update',
          payload
        });
      }
      return;
    }

    if (type === 'host_timer_control') {
      const room = rooms.get(ws.roomId);
      const action = payload?.action;
      if (!room || ws.role !== 'host' || !['pause', 'resume'].includes(action)) return;
      broadcastToRoom(ws.roomId, { type: 'timer_control', payload: { action } });
      return;
    }

    // 8. REFRESH PLAYERS
    if (type === 'refresh_players') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'host') return;

      for (const [, player] of room.players.entries()) {
        player.cash = 0;
        player.score = 0;
        player.clearedLevel = 0;
        player.eliminated = false;
        persistScoreSnapshot({ playerId: player.ws?.id, name: player.name, roomId: ws.roomId, score: 0, cash: 0, clearedLevel: 0, eliminated: false });
        send(player.ws, { type: 'refresh' });
      }
      room.currentQuestion = null;
      room.questionLevel = 1;
      room.lifelines = { callUsed: false };
      broadcastScoreboard(room);
      console.log("Players refreshed");
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    if (ws.role === 'host' && room.host === ws) {
      room.host = null;
    } else if (ws.role === 'player') {
      room.players.delete(ws.id);
      if (room.host) send(room.host, { type: 'player_left', payload: { playerId: ws.id } });
    }
    broadcastConnectionStatus(ws.roomId);
  });
});

function broadcastScoreboard(room) {
  const scoreboard = Array.from(room.players.entries()).map(([playerId, player]) => ({
    playerId,
    name: player.name,
    score: player.score,
    cash: player.cash,
    clearedLevel: player.clearedLevel,
    eliminated: player.eliminated
  }));
  broadcastToRoom(room.host && room.host.roomId, { type: 'scoreboard', payload: scoreboard });
}

app.use('/images', express.static(imagesDir));
app.use('/videos', express.static(videosDir));
app.use('/audio', express.static(audioDir));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'host.html')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'Player.html')));
app.use(express.static(__dirname));
function getNetworkAddress() {
  const networkInterfaces = Object.values(os.networkInterfaces()).flat();
  const address = networkInterfaces.find((networkInterface) => (
    networkInterface && networkInterface.family === 'IPv4' && !networkInterface.internal
  ));
  return address ? address.address : 'localhost';
}

function printServerUrls(message = 'Server running at') {
  const baseUrl = `http://${getNetworkAddress()}:${PORT}`;
  console.log(`${message} ${baseUrl}`);
  console.log(`Host: ${baseUrl}/`);
  console.log(`Player: ${baseUrl}/player`);
}

server.listen(PORT, '0.0.0.0', () => {
  loadRemoteIndexes()
    .then(() => printServerUrls())
    .catch(error => {
      console.error('Could not load Supabase media indexes:', error.message);
      printServerUrls();
    });
});

wss.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    printServerUrls('Server is already running at');
    return;
  }
  console.error('WebSocket server error:', error);
});
