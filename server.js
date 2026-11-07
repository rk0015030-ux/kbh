const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  deleteDoc,
  getDocFromServer,
  setLogLevel
} = require('firebase/firestore');

// Silence internal Firestore gRPC idle stream warnings in Node
try {
  setLogLevel('silent');
} catch (e) {}

// Global safety error handlers to ensure robust deployment in Cloud Run
process.on('unhandledRejection', (reason, promise) => {
  console.warn('[Safety] Unhandled Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Safety] Uncaught Exception:', err?.message || err);
});

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 50 * 1024 * 1024 });
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PRIZE_LADDER = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000];

function getQuestionTimeLimit(level) {
  const lvl = Number(level) || 1;
  if (lvl <= 4) return 30;
  if (lvl <= 7) return 45;
  return 60;
}

function fixDevanagariMatras(text) {
  if (!text) return '';
  let s = String(text).normalize('NFC');
  const baseChar = '[\\u0915-\\u0939\\u0958-\\u095F]';
  const halant = '\\u094D';
  const nukta = '\\u093C';
  const postMatras = '[\\u0901-\\u0903\\u093A-\\u093E\\u0940-\\u094F\\u0951-\\u0957\\u0962-\\u0963]';
  const vowelSigns = '[\\u093E-\\u094C]';
  const cluster = '(?:' + baseChar + nukta + '?(?:' + halant + baseChar + nukta + '?)*)';
  const devStart = '(^|[^\\u0900-\\u097F])';
  const devEnd = '(?=[^\\u0900-\\u097F]|$)';

  // 1. Remove zero-width spaces and BOM
  s = s.replace(/[\u200B\uFEFF]/g, '');

  // 2. Specific common PDF spaced decompositions for Priya / Priye / Priyaa
  s = s.replace(/प\s*्\s*र\s*ि\s*य\s*ा/gu, 'प्रिया');
  s = s.replace(/प\s*्\s*र\s*ि\s*य/gu, 'प्रिय');
  s = s.replace(/प\s*्\s*र\s+य\s*ा/gu, 'प्रिया');
  s = s.replace(/प\s*्\s*र\s+य(?=[^\u0900-\u097F]|$)/gu, 'प्रिय');

  // 3. Remove artificial spaces around halant (e.g. "प ् र" -> "प्र", "प् र" -> "प्र", "प ्" -> "प्")
  s = s.replace(new RegExp('(' + baseChar + ')\\s+(' + halant + ')', 'g'), '$1$2');
  s = s.replace(new RegExp('(' + halant + ')\\s+(' + baseChar + ')', 'g'), '$1$2');

  // 4. Pre-base matra reordering: visual "ि" (\u093F) appearing BEFORE a consonant cluster
  // Handles: "िप्रया" -> "प्रिया", "बहुत िप्रय" -> "बहुत प्रिय", "बहुत ि  प्रय" -> "बहुत प्रिय"
  const nonConsonantBefore = '(^|[\\s\\p{P}\\u0901-\\u0914\\u093E\\u0940-\\u094C\\u0966-\\u096F।॥])\\s*';
  s = s.replace(new RegExp(nonConsonantBefore + '\\u093F\\s*(' + cluster + ')', 'gu'), '$1$2\u093F');

  // 5. Remove spaces between consonant/cluster and following POST-BASE matras / marks
  s = s.replace(new RegExp('(' + baseChar + ')\\s+(' + postMatras + ')', 'g'), '$1$2');

  // 6. Remove spaces between vowel signs and anusvara/visarga/candrabindu
  s = s.replace(new RegExp('([\\u093E-\\u094C])\\s+([\\u0901-\\u0903])', 'g'), '$1$2');

  // 7. Repair displaced matra sequence: cluster1 + cluster2 + \u093F + vowelSign (e.g. "प्रयिा" -> "प्रिया", "कतिाब" -> "किताब")
  s = s.replace(new RegExp('(' + cluster + ')(' + cluster + ')\\u093F(' + vowelSigns + ')', 'g'), '$1\u093F$2$3');

  // 8. Repair accidental space between cluster + \u093F and next syllable in single words (e.g. "प्रि या" -> "प्रिया", "प्रि य" -> "प्रिय")
  s = s.replace(new RegExp('(' + cluster + '\\u093F)\\s+(' + cluster + '[\\u093E-\\u094C]?)', 'g'), '$1$2');

  // 9. Devanagari specific repair for "प्र" split from "य", "या", "ये", etc. where \u093F was dropped or lost
  s = s.replace(new RegExp(devStart + 'प्र\\s+य' + devEnd, 'gu'), '$1प्रिय');
  s = s.replace(new RegExp(devStart + 'प्र\\s+या' + devEnd, 'gu'), '$1प्रिया');
  s = s.replace(new RegExp(devStart + 'प्र\\s+ये' + devEnd, 'gu'), '$1प्रिये');
  s = s.replace(new RegExp(devStart + 'प्र\\s+यों' + devEnd, 'gu'), '$1प्रियों');
  s = s.replace(new RegExp(devStart + 'प्र\\s+यतम' + devEnd, 'gu'), '$1प्रियतम');
  s = s.replace(new RegExp(devStart + 'प्र\\s+यता' + devEnd, 'gu'), '$1प्रियता');
  s = s.replace(new RegExp(devStart + 'प्र\\s+यजन' + devEnd, 'gu'), '$1प्रियजन');
  s = s.replace(new RegExp(devStart + 'प्र\\s+यंका' + devEnd, 'gu'), '$1प्रियंका');
  s = s.replace(new RegExp(devStart + 'प्र\\s+यंक' + devEnd, 'gu'), '$1प्रियंक');
  s = s.replace(new RegExp(devStart + 'प्र\\s+यदर्शी' + devEnd, 'gu'), '$1प्रियदर्शी');
  s = s.replace(new RegExp(devStart + 'प्र\\s+येक' + devEnd, 'gu'), '$1प्रत्येक');
  s = s.replace(new RegExp(devStart + 'प्र\\s+त' + devEnd, 'gu'), '$1प्रति');
  s = s.replace(new RegExp(devStart + 'प्र\\s+ति' + devEnd, 'gu'), '$1प्रति');

  // Handle words where "प्रय" is standalone or preceded by prefixes/modifiers
  s = s.replace(new RegExp('(^|\\s)प्रय' + devEnd, 'gu'), '$1प्रिय');
  s = s.replace(new RegExp(devStart + 'अप्रय' + devEnd, 'gu'), '$1अप्रिय');
  s = s.replace(new RegExp(devStart + 'सर्वप्रय' + devEnd, 'gu'), '$1सर्वप्रिय');
  s = s.replace(new RegExp(devStart + 'प्राणप्रय' + devEnd, 'gu'), '$1प्राणप्रिय');

  // Handle known Hindi words where \u093F is dropped from PDF extraction
  s = s.replace(new RegExp(devStart + 'क्रोधत' + devEnd, 'gu'), '$1क्रोधित');
  s = s.replace(new RegExp(devStart + 'हर्षत' + devEnd, 'gu'), '$1हर्षित');
  s = s.replace(new RegExp(devStart + 'समर्पत' + devEnd, 'gu'), '$1समर्पित');
  s = s.replace(new RegExp(devStart + 'आकर्शत' + devEnd, 'gu'), '$1आकर्षित');
  s = s.replace(new RegExp(devStart + 'स्थत' + devEnd, 'gu'), '$1स्थित');
  s = s.replace(new RegExp(devStart + 'स्थति' + devEnd, 'gu'), '$1स्थिति');
  s = s.replace(new RegExp(devStart + 'प्रतियोगता' + devEnd, 'gu'), '$1प्रतियोगिता');
  s = s.replace(new RegExp(devStart + 'ऐतहासिक' + devEnd, 'gu'), '$1ऐतिहासिक');
  s = s.replace(new RegExp(devStart + 'प्राथमक' + devEnd, 'gu'), '$1प्राथमिक');
  s = s.replace(new RegExp(devStart + 'सामाजक' + devEnd, 'gu'), '$1सामाजिक');
  s = s.replace(new RegExp(devStart + 'धार्मक' + devEnd, 'gu'), '$1धार्मिक');
  s = s.replace(new RegExp(devStart + 'आर्थक' + devEnd, 'gu'), '$1आर्थिक');

  // 10. Reconnect detached "प्र" prefix when followed by common words
  s = s.replace(new RegExp(devStart + 'प्र\\s+(कार|श्न|श|थम|योग|भाव|सिद्ध|सिद्द|सिद्धि|देश|बंध|माण|वेश|हार|सार|कृति|कति|गति|काश|तष्ठित|तिष्ठित|मुख|तभा|तिभा|क्रिया|क्रया|णाम|यास)' + devEnd, 'gu'), (m, p0, p1) => {
    let word = p1;
    if (p1 === 'श') word = 'श्न';
    else if (p1 === 'सिद्द') word = 'सिद्ध';
    else if (p1 === 'कति') word = 'कृति';
    else if (p1 === 'तष्ठित') word = 'तिष्ठित';
    else if (p1 === 'तभा') word = 'तिभा';
    else if (p1 === 'क्रया') word = 'क्रिया';
    return (p0 || '') + 'प्र' + word;
  });

  // 11. Deduplicate adjacent identical matras (e.g. \u093F\u093F -> \u093F)
  s = s.replace(/(\u093F)+/g, '$1');
  s = s.replace(/([\u093E-\u094C])\1+/g, '$1');

  // 12. Normalize multiple horizontal spaces
  s = s.replace(/[ \t]+/g, ' ');
  return s.trim();
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
let firebaseApp = null;
let firestoreDb = null;
try {
  let firebaseConfig = null;
  if (process.env.FIREBASE_CONFIG) {
    try {
      firebaseConfig = typeof process.env.FIREBASE_CONFIG === 'string' 
        ? JSON.parse(process.env.FIREBASE_CONFIG) 
        : process.env.FIREBASE_CONFIG;
    } catch (e) {
      console.warn('[Firebase] Could not parse process.env.FIREBASE_CONFIG JSON');
    }
  } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_API_KEY) {
    firebaseConfig = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
      firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID || '(default)',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_APP_ID || ''
    };
  } else if (fs.existsSync(path.join(__dirname, 'firebase-applet-config.json'))) {
    firebaseConfig = require('./firebase-applet-config.json');
  }

  if (firebaseConfig && firebaseConfig.projectId) {
    firebaseApp = initializeApp(firebaseConfig);
    firestoreDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId || '(default)');
    console.log('[Firebase] Initialized Firestore successfully for', firebaseConfig.projectId);
  }
} catch (err) {
  console.warn('[Firebase] Config load error:', err.message);
}

function getOrCreateFirestore() {
  if (firestoreDb) return firestoreDb;
  try {
    const configPath = path.join(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      try {
        delete require.cache[require.resolve('./firebase-applet-config.json')];
      } catch (e) {}
      firebaseConfig = require('./firebase-applet-config.json');
      if (firebaseConfig && firebaseConfig.projectId) {
        firebaseApp = initializeApp(firebaseConfig);
        firestoreDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId || '(default)');
        console.log('[Firebase] Dynamically connected Firestore for', firebaseConfig.projectId);
      }
    }
  } catch (e) {
    console.warn('[Firebase] Dynamic connect error:', e.message);
  }
  return firestoreDb;
}

let firebaseConnectionVerified = false;

async function testFirebaseConnection() {
  if (firebaseConnectionVerified || firestoreQuotaExhausted) return;
  const db = getOrCreateFirestore();
  if (!db) return;
  try {
    await Promise.race([
      getDocFromServer(doc(db, 'test', 'connection')),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase connection timeout')), 2000))
    ]);
    firebaseConnectionVerified = true;
    console.log('[Firebase] Connection to Firestore verified.');
  } catch (error) {
    if (error && error.message && error.message.includes('the client is offline')) {
      console.warn('Firebase Firestore client is offline.');
    } else if (error && error.message && (error.message.includes('Quota') || error.message.includes('RESOURCE_EXHAUSTED'))) {
      firestoreQuotaExhausted = true;
      lastQuotaExhaustedTime = Date.now();
      console.warn('[Firebase] Firestore quota limit reached on connection test.');
    } else {
      console.warn('[Firebase] Connection check:', error?.message || error);
    }
  }
}

let remoteIndexesLoaded = false;
let remoteIndexesPromise = null;
let remoteScoresLoaded = false;
let remoteScoresPromise = null;

let firestoreQuotaExhausted = false;

async function saveRemoteMedia(mediaId, item, localFilePath = null) {
  const db = getOrCreateFirestore();
  if (!db || firestoreQuotaExhausted) return;
  try {
    // 1. Immediately persist media metadata record with a fast 3-second safety timeout
    await Promise.race([
      setDoc(doc(db, 'media', mediaId), {
        id: mediaId,
        name: item.name || '',
        url: item.url || '',
        filename: item.filename || '',
        type: item.type || 'image',
        uploadedAt: item.uploadedAt ? (item.uploadedAt instanceof Date ? item.uploadedAt.toISOString() : String(item.uploadedAt)) : new Date().toISOString(),
        size: Number(item.size) || 0,
        hasChunks: false,
        totalChunks: 0
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 3000))
    ]);

    // 2. Persist binary chunks if file is present on disk (up to 25MB)
    if (localFilePath && fs.existsSync(localFilePath)) {
      try {
        const stats = fs.statSync(localFilePath);
        if (stats.size > 0 && stats.size <= 25 * 1024 * 1024) {
          const fileBuf = fs.readFileSync(localFilePath);
          const base64Str = fileBuf.toString('base64');
          const CHUNK_SIZE = 800 * 1024;
          const totalChunks = Math.ceil(base64Str.length / CHUNK_SIZE);
          for (let i = 0; i < totalChunks; i++) {
            const chunkData = base64Str.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            await setDoc(doc(db, 'media', mediaId, 'chunks', String(i)), {
              index: i,
              total: totalChunks,
              data: chunkData
            });
          }
          await setDoc(doc(db, 'media', mediaId), {
            hasChunks: true,
            totalChunks: totalChunks
          }, { merge: true });
        }
      } catch (chunkErr) {
        if (chunkErr.message && chunkErr.message.includes('RESOURCE_EXHAUSTED')) {
          firestoreQuotaExhausted = true;
          console.warn('[Firebase] Firestore daily write quota reached; saving media locally on disk.');
        } else {
          console.warn(`[Firebase] Could not save chunks for ${mediaId}:`, chunkErr.message);
        }
      }
    }
  } catch (error) {
    if (error.message && error.message.includes('RESOURCE_EXHAUSTED')) {
      firestoreQuotaExhausted = true;
      console.warn('[Firebase] Firestore daily write quota reached; continuing with local storage.');
    } else {
      console.warn(`[Firebase] Could not save media ${mediaId} to Firestore:`, error.message);
    }
  }
}

async function deleteRemoteMedia(mediaId) {
  const db = getOrCreateFirestore();
  if (!db) return;
  try {
    try {
      const chunksSnap = await getDocs(collection(db, 'media', mediaId, 'chunks'));
      await Promise.all(chunksSnap.docs.map(chunkDoc => deleteDoc(chunkDoc.ref).catch(() => {})));
    } catch (e) {
      // Ignore if no chunks
    }
    await deleteDoc(doc(db, 'media', mediaId));
  } catch (error) {
    console.warn(`[Firebase] Could not delete media ${mediaId} from Firestore:`, error.message);
  }
}

async function rehydrateMediaFile(type, filename) {
  const db = getOrCreateFirestore();
  if (!db || !filename) return false;
  try {
    let targetDir = imagesDir;
    let dbMap = imageDatabase;
    if (type === 'video') { targetDir = videosDir; dbMap = videoDatabase; }
    else if (type === 'audio') { targetDir = audioDir; dbMap = audioDatabase; }

    const targetPath = path.join(targetDir, filename);
    if (fs.existsSync(targetPath)) return true;

    const item = Array.from(dbMap.values()).find(m => m.filename === filename);
    if (!item || !item.id) return false;

    const chunksSnap = await getDocs(collection(db, 'media', item.id, 'chunks'));
    if (chunksSnap.empty) return false;

    const chunks = [];
    chunksSnap.forEach(snap => chunks.push(snap.data()));
    chunks.sort((a, b) => a.index - b.index);

    const fullBase64 = chunks.map(c => c.data).join('');
    const buffer = Buffer.from(fullBase64, 'base64');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, buffer);
    console.log(`[Firebase] Successfully rehydrated ${type} "${item.name}" (${filename}) to disk`);
    return true;
  } catch (err) {
    console.warn(`[Firebase] Could not rehydrate ${filename}:`, err.message);
    return false;
  }
}

let lastRemoteIndexesFetchTime = 0;

function inferMediaType(name, filename, url) {
  const target = String(name || filename || url || '').toLowerCase().split('?')[0];
  const ext = path.extname(target);
  if (['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.qt', '.mkv', '.avi', '.m4v', '.3gp', '.flv', '.wmv'].includes(ext)) {
    return 'video';
  }
  if (['.mp3', '.wav', '.oga', '.m4a', '.aac', '.flac', '.opus', '.wma', '.alac', '.aiff'].includes(ext)) {
    return 'audio';
  }
  return 'image';
}

function normalizeMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  let url = rawUrl.trim();

  // 1. Google Drive URLs (converts preview/share link to direct stream/download)
  const gDriveMatch = url.match(/(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/file\/d\/)([a-zA-Z0-9_-]+)/i);
  if (gDriveMatch && gDriveMatch[1]) {
    return `https://drive.google.com/uc?export=download&id=${gDriveMatch[1]}`;
  }

  // 2. Dropbox URLs (dl=0 -> raw=1 allows direct media stream in browser)
  if (url.includes('dropbox.com')) {
    if (url.includes('dl=0')) {
      return url.replace('dl=0', 'raw=1');
    }
    if (!url.includes('raw=1')) {
      return url.includes('?') ? `${url}&raw=1` : `${url}?raw=1`;
    }
  }

  return url;
}

let lastQuotaExhaustedTime = 0;

async function loadRemoteIndexes(force = false) {
  if (firestoreQuotaExhausted && (Date.now() - lastQuotaExhaustedTime < 10 * 60 * 1000)) {
    remoteIndexesLoaded = true;
    return;
  }
  await testFirebaseConnection();
  const db = getOrCreateFirestore();
  if (!db) {
    remoteIndexesLoaded = true;
    return;
  }
  try {
    const collectionsToCheck = ['media'];
    let totalDocsLoaded = 0;

    for (const colName of collectionsToCheck) {
      try {
        const snap = await getDocs(collection(db, colName));
        snap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const docId = docSnap.id;
          const id = String(data.id || data.mediaId || data.videoId || data.imageId || data.audioId || docId);
          
          let type = String(data.type || data.fileType || data.mediaType || '').toLowerCase();
          if (!['image', 'video', 'audio'].includes(type)) {
            type = inferMediaType(data.name, data.filename, data.url);
          }

          const name = String(data.name || data.fileName || data.filename || data.title || data.originalName || id);
          
          let filename = data.filename || data.fileName;
          if (!filename) {
            const raw = data.url ? path.basename(String(data.url).split('?')[0]) : name;
            filename = raw && raw.includes('.') ? raw : `${id}.${type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg'}`;
          }

          let url = data.url || data.downloadUrl || data.downloadURL || data.src || data.link;
          if (!url) {
            const prefix = type === 'video' ? '/videos' : type === 'audio' ? '/audio' : '/images';
            url = `${prefix}/${encodeURIComponent(filename)}`;
          }

          const item = {
            id,
            name,
            url,
            filename,
            type,
            uploadedAt: data.uploadedAt ? (data.uploadedAt.toDate ? data.uploadedAt.toDate().toISOString() : String(data.uploadedAt)) : new Date().toISOString(),
            size: Number(data.size) || 0,
            hasChunks: Boolean(data.hasChunks),
            totalChunks: Number(data.totalChunks) || 0
          };

          // If document has inline base64 data, write to disk if missing
          const inlineBase64 = data.base64 || data.data || data.dataUrl || data.content;
          if (inlineBase64 && typeof inlineBase64 === 'string') {
            try {
              let cleanBase64 = inlineBase64;
              if (cleanBase64.includes(';base64,')) {
                cleanBase64 = cleanBase64.split(';base64,')[1];
              }
              const targetDir = type === 'video' ? videosDir : type === 'audio' ? audioDir : imagesDir;
              const targetPath = path.join(targetDir, filename);
              if (!fs.existsSync(targetPath)) {
                fs.writeFileSync(targetPath, Buffer.from(cleanBase64, 'base64'));
              }
            } catch (inlineErr) {
              console.warn('[Firebase] Could not write inline base64 for', id, inlineErr.message);
            }
          } else if (data.hasChunks) {
            const targetDir = type === 'video' ? videosDir : type === 'audio' ? audioDir : imagesDir;
            const targetPath = path.join(targetDir, filename);
            if (!fs.existsSync(targetPath)) {
              rehydrateMediaFile(type, filename).catch(err => {
                console.warn(`[Firebase] Auto-rehydrate background notice for ${filename}:`, err.message);
              });
            }
          }

          if (type === 'video') {
            videoDatabase.set(id, item);
          } else if (type === 'audio') {
            audioDatabase.set(id, item);
          } else {
            imageDatabase.set(id, item);
          }
          totalDocsLoaded++;
        });
      } catch (colErr) {
        if (colErr.message && (colErr.message.includes('Quota') || colErr.message.includes('RESOURCE_EXHAUSTED'))) {
          firestoreQuotaExhausted = true;
          lastQuotaExhaustedTime = Date.now();
          console.warn('[Firebase] Read quota limit reached on Firestore. Using local storage.');
          break;
        }
      }
    }

    saveImageIndex();
    saveVideoIndex();
    saveAudioIndex();
    lastRemoteIndexesFetchTime = Date.now();
    if (totalDocsLoaded > 0) {
      console.log(`[Firebase] Loaded ${totalDocsLoaded} total media records from Firestore`);
    }
  } catch (error) {
    if (error.message && (error.message.includes('Quota') || error.message.includes('RESOURCE_EXHAUSTED'))) {
      firestoreQuotaExhausted = true;
      lastQuotaExhaustedTime = Date.now();
      console.warn('[Firebase] Read quota limit reached. Using local media cache.');
    } else {
      console.warn('[Firebase] Could not load media indexes:', error.message);
    }
  } finally {
    remoteIndexesLoaded = true;
  }
}

function ensureRemoteIndexesLoaded(force = false) {
  const isStale = (Date.now() - lastRemoteIndexesFetchTime) > 60000;
  if (!force && remoteIndexesLoaded && !isStale) {
    return Promise.resolve();
  }
  if (remoteIndexesPromise) {
    return remoteIndexesPromise;
  }
  remoteIndexesPromise = loadRemoteIndexes(force).finally(() => {
    remoteIndexesPromise = null;
  });
  return remoteIndexesPromise;
}

// Ensure local directories exist
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
if (!fs.existsSync(scoreDataDir)) fs.mkdirSync(scoreDataDir, { recursive: true });

function saveImageIndex() {
  fs.writeFileSync(imageIndexPath, JSON.stringify(Object.fromEntries(imageDatabase), null, 2));
}

function loadImageIndex() {
  try {
    const entries = JSON.parse(fs.readFileSync(imageIndexPath, 'utf8'));
    Object.entries(entries).forEach(([imageId, image]) => {
      if (image && image.filename) imageDatabase.set(imageId, image);
    });
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not load image index:', error.message);
  }
}

loadImageIndex();

function saveVideoIndex() {
  fs.writeFileSync(videoIndexPath, JSON.stringify(Object.fromEntries(videoDatabase), null, 2));
}

function loadVideoIndex() {
  try {
    const entries = JSON.parse(fs.readFileSync(videoIndexPath, 'utf8'));
    Object.entries(entries).forEach(([videoId, video]) => {
      if (video && video.filename) videoDatabase.set(videoId, video);
    });
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not load video index:', error.message);
  }
  try {
    if (fs.existsSync(videosDir)) {
      const diskFiles = fs.readdirSync(videosDir);
      const existingFilenames = new Set(Array.from(videoDatabase.values()).map(v => v.filename));
      diskFiles.forEach(file => {
        if (file === 'index.json' || existingFilenames.has(file)) return;
        const filePath = path.join(videosDir, file);
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) return;
        const videoId = createVideoId();
        const item = {
          id: videoId,
          name: file,
          url: `/videos/${encodeURIComponent(file)}`,
          filename: file,
          type: 'video',
          uploadedAt: stats.mtime.toISOString(),
          size: stats.size
        };
        videoDatabase.set(videoId, item);
        existingFilenames.add(file);
      });
      saveVideoIndex();
    }
  } catch (err) {
    console.warn('Could not scan videosDir:', err.message);
  }
}

loadVideoIndex();

function saveAudioIndex() {
  fs.writeFileSync(audioIndexPath, JSON.stringify(Object.fromEntries(audioDatabase), null, 2));
}

function loadAudioIndex() {
  try {
    const entries = JSON.parse(fs.readFileSync(audioIndexPath, 'utf8'));
    Object.entries(entries).forEach(([audioId, audio]) => {
      if (audio && audio.filename) audioDatabase.set(audioId, audio);
    });
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not load audio index:', error.message);
  }
  try {
    if (fs.existsSync(audioDir)) {
      const diskFiles = fs.readdirSync(audioDir);
      const existingFilenames = new Set(Array.from(audioDatabase.values()).map(a => a.filename));
      diskFiles.forEach(file => {
        if (file === 'index.json' || existingFilenames.has(file)) return;
        const filePath = path.join(audioDir, file);
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) return;
        const audioId = createAudioId();
        const item = {
          id: audioId,
          name: file,
          url: `/audio/${encodeURIComponent(file)}`,
          filename: file,
          type: 'audio',
          uploadedAt: stats.mtime.toISOString(),
          size: stats.size
        };
        audioDatabase.set(audioId, item);
        existingFilenames.add(file);
      });
      saveAudioIndex();
    }
  } catch (err) {
    console.warn('Could not scan audioDir:', err.message);
  }
}

loadAudioIndex();

const defaultKbcAudioFiles = [
  { file: '30 sec timer.mp3', id: 'audio-30-sec-timer', name: '30 Sec Timer' },
  { file: '45 sec audio.mp3', id: 'audio-45-sec-timer', name: '45 Sec Timer' },
  { file: '60 sec timer.mp3', id: 'audio-60-sec-timer', name: '60 Sec Timer' },
  { file: '50 50.mp3', id: 'audio-50-50', name: '50-50 Lifeline Sound' },
  { file: 'kbc timer real.mp3', id: 'audio-kbc-timer-real', name: 'KBC Timer Real' },
  { file: 'question lock sound.mp3', id: 'audio-question-lock', name: 'Question Lock Sound' },
  { file: 'wrong buzzer.mp3', id: 'audio-wrong-buzzer', name: 'Wrong Buzzer' },
  { file: 'correct answer.wav', id: 'audio-correct-answer', name: 'Correct Answer Bell' }
];

async function seedDefaultAudioFiles() {
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  for (const item of defaultKbcAudioFiles) {
    const rootPath = path.join(__dirname, item.file);
    const destPath = path.join(audioDir, item.file);
    if (fs.existsSync(rootPath)) {
      if (!fs.existsSync(destPath)) {
        try {
          fs.copyFileSync(rootPath, destPath);
        } catch (copyErr) {
          console.warn('Could not copy default audio file:', item.file, copyErr.message);
        }
      }
      if (!audioDatabase.has(item.id)) {
        const stats = fs.existsSync(destPath) ? fs.statSync(destPath) : fs.statSync(rootPath);
        const audioItem = {
          id: item.id,
          name: item.name,
          url: `/audio/${encodeURIComponent(item.file)}`,
          filename: item.file,
          type: 'audio',
          uploadedAt: stats.mtime.toISOString(),
          size: stats.size
        };
        audioDatabase.set(item.id, audioItem);
        saveRemoteMedia(item.id, audioItem, destPath).catch(() => {});
      }
    }
  }
  saveAudioIndex();
}
seedDefaultAudioFiles().catch(e => console.warn('Could not seed default audio files:', e.message));

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

async function loadRemoteScores() {
  const db = getOrCreateFirestore();
  if (!db) {
    remoteScoresLoaded = true;
    return;
  }
  try {
    const snap = await getDocs(collection(db, 'scores'));
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.playerId) {
        const existingIdx = scoreDatabase.findIndex((e) => e.playerId === data.playerId && e.roomId === data.roomId);
        if (existingIdx >= 0) {
          scoreDatabase[existingIdx] = { ...scoreDatabase[existingIdx], ...data };
        } else {
          scoreDatabase.push(data);
        }
      }
    });
    scoreDatabase.sort((a, b) => Number(b.score) - Number(a.score));
    saveScoreDatabase();
  } catch (error) {
    console.warn('[Firebase] Could not load scores from Firestore:', error.message);
  } finally {
    remoteScoresLoaded = true;
  }
}

function ensureRemoteScoresLoaded() {
  if (remoteScoresLoaded) return Promise.resolve();
  if (!remoteScoresPromise) {
    remoteScoresPromise = loadRemoteScores();
  }
  return remoteScoresPromise;
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

  if (firestoreDb) {
    setDoc(doc(firestoreDb, 'scores', playerId), snapshot).catch((err) => {
      console.warn(`[Firebase] Could not persist score for ${playerId}:`, err.message);
    });
  }

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

  if (firestoreDb) {
    deleteDoc(doc(firestoreDb, 'scores', playerId)).catch((err) => {
      console.warn(`[Firebase] Could not delete score for ${playerId}:`, err.message);
    });
  }

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

// Multer configuration for media uploads
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, imagesDir),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!ext || ext.length <= 1) {
      const mime = (file.mimetype || '').toLowerCase();
      if (mime.includes('png')) ext = '.png';
      else if (mime.includes('gif')) ext = '.gif';
      else if (mime.includes('webp')) ext = '.webp';
      else if (mime.includes('svg')) ext = '.svg';
      else ext = '.jpg';
    }
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage: imageStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per image
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff'];
    const mime = (file.mimetype || '').toLowerCase();
    if (
      !ext ||
      allowedExts.includes(ext) ||
      mime.startsWith('image/') ||
      mime === 'application/octet-stream' ||
      !mime
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, GIF, WEBP, SVG images allowed.'));
    }
  }
});

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, videosDir),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!ext || ext.length <= 1) {
      const mime = (file.mimetype || '').toLowerCase();
      if (mime.includes('webm')) ext = '.webm';
      else if (mime.includes('ogg') || mime.includes('ogv')) ext = '.ogg';
      else if (mime.includes('quicktime') || mime.includes('mov')) ext = '.mov';
      else if (mime.includes('mkv') || mime.includes('matroska')) ext = '.mkv';
      else ext = '.mp4';
    }
    cb(null, uuidv4() + ext);
  }
});
const uploadVideos = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB per video
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = [
      '.mp4', '.webm', '.ogg', '.ogv', '.mov', '.qt', '.mkv', '.avi',
      '.m4v', '.3gp', '.3g2', '.flv', '.wmv', '.ts', '.mts', '.m2ts',
      '.mpg', '.mpeg', '.vob', '.f4v', '.asf'
    ];
    const mime = (file.mimetype || '').toLowerCase();
    if (
      !ext ||
      allowedExts.includes(ext) ||
      mime.startsWith('video/') ||
      mime.includes('mp4') ||
      mime.includes('quicktime') ||
      mime.includes('webm') ||
      mime === 'application/octet-stream' ||
      !mime
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload a standard video file (MP4, WebM, MOV, MKV, AVI, etc.).'));
    }
  }
});
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, audioDir),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!ext || ext.length <= 1) {
      const mime = (file.mimetype || '').toLowerCase();
      if (mime.includes('wav')) ext = '.wav';
      else if (mime.includes('ogg') || mime.includes('oga')) ext = '.ogg';
      else if (mime.includes('m4a') || mime.includes('aac')) ext = '.m4a';
      else if (mime.includes('flac')) ext = '.flac';
      else ext = '.mp3';
    }
    cb(null, uuidv4() + ext);
  }
});
const uploadAudios = multer({
  storage: audioStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB per audio
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.webm', '.flac', '.opus', '.wma', '.alac', '.aiff'];
    if ((file.mimetype && file.mimetype.startsWith('audio/')) || allowedExts.includes(ext) || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files (MP3, WAV, OGG, M4A, AAC, WEBM, FLAC, etc.) are allowed.'));
    }
  }
});

function storeUploadedMedia(routePrefix, file) {
  const filename = file.filename;
  const url = `${routePrefix}/${encodeURIComponent(filename)}`;
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
      const stored = storeUploadedMedia('/images', file);
      const mediaItem = {
        id: imageId,
        name: file.originalname,
        url: stored.url,
        filename: stored.filename,
        type: 'image',
        uploadedAt: new Date().toISOString(),
        size: file.size
      };
      imageDatabase.set(imageId, mediaItem);
      saveRemoteMedia(imageId, mediaItem, path.join(imagesDir, file.filename)).catch(err => {
        console.warn(`[Firebase] Image remote save notice for ${imageId}:`, err.message);
      });
      uploadedImages.push({
        imageId,
        url: stored.url,
        name: file.originalname,
        size: file.size
      });
    }

    saveImageIndex();

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
app.get('/api/images/list', async (req, res) => {
  await ensureRemoteIndexesLoaded(Boolean(req.query.refresh));
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
app.get('/api/images/:imageId', async (req, res) => {
  await ensureRemoteIndexesLoaded();
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
    const filePath = path.join(imagesDir, imageData.filename);
    await fs.promises.unlink(filePath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    imageDatabase.delete(imageId);
    saveImageIndex();
    deleteRemoteMedia(imageId).catch(err => console.warn(`[Firebase] Image delete background notice:`, err.message));
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

app.post('/api/videos/upload', (req, res, next) => {
  uploadVideos.array('videos', 50)(req, res, error => {
    if (!error) return next();
    const isBadRequest = error instanceof multer.MulterError || (error.message && error.message.startsWith('Invalid file type'));
    res.status(isBadRequest ? 400 : 500).json({
      error: isBadRequest ? error.message : 'Could not process video upload'
    });
  });
}, async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No videos uploaded' });
  try {
    const videos = [];
    for (const file of req.files) {
      const videoId = createVideoId();
      const stored = storeUploadedMedia('/videos', file);
      const mediaItem = {
        id: videoId,
        name: file.originalname,
        url: stored.url,
        filename: stored.filename,
        type: 'video',
        uploadedAt: new Date().toISOString(),
        size: file.size
      };
      videoDatabase.set(videoId, mediaItem);
      // Persist to Firestore in background so large video chunks do not delay or time out the client HTTP upload
      saveRemoteMedia(videoId, mediaItem, path.join(videosDir, file.filename)).catch(remoteErr => {
        console.warn(`[Firebase] Video remote save notice for ${videoId}:`, remoteErr.message);
      });
      videos.push({ videoId, name: mediaItem.name, url: mediaItem.url, size: mediaItem.size });
    }
    saveVideoIndex();
    res.json({ success: true, message: `${videos.length} video(s) uploaded successfully`, videos });
  } catch (error) {
    console.error('Video upload error:', error);
    res.status(500).json({ error: error.message || 'Could not upload video files' });
  }
});

app.get('/api/videos/list', async (req, res) => {
  await ensureRemoteIndexesLoaded(Boolean(req.query.refresh));
  res.json({
    videos: Array.from(videoDatabase.entries()).map(([videoId, data]) => {
      const filePath = path.join(videosDir, data.filename || '');
      const fileOnDisk = fs.existsSync(filePath);
      const isAvailable = fileOnDisk || Boolean(data.hasChunks) || (data.url && data.url.startsWith('http'));
      return {
        videoId,
        name: data.name,
        url: data.url,
        uploadedAt: data.uploadedAt,
        size: data.size,
        fileOnDisk,
        isAvailable
      };
    })
  });
});

app.get('/api/scores', async (req, res) => {
  await ensureRemoteScoresLoaded();
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
    await fs.promises.unlink(path.join(videosDir, video.filename)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    videoDatabase.delete(req.params.videoId);
    saveVideoIndex();
    deleteRemoteMedia(req.params.videoId).catch(err => console.warn(`[Firebase] Video delete background notice:`, err.message));
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
      const stored = storeUploadedMedia('/audio', file);
      const mediaItem = {
        id: audioId,
        name: file.originalname,
        url: stored.url,
        filename: stored.filename,
        type: 'audio',
        uploadedAt: new Date().toISOString(),
        size: file.size
      };
      audioDatabase.set(audioId, mediaItem);
      saveRemoteMedia(audioId, mediaItem, path.join(audioDir, file.filename)).catch(err => {
        console.warn(`[Firebase] Audio remote save notice for ${audioId}:`, err.message);
      });
      audios.push({ audioId, name: mediaItem.name, url: mediaItem.url, size: mediaItem.size });
    }
    saveAudioIndex();
    res.json({ success: true, message: `${audios.length} audio file(s) uploaded successfully`, audios });
  } catch (error) {
    console.error('Audio upload error:', error);
    res.status(500).json({ error: error.message || 'Could not upload audio files' });
  }
});

app.get('/api/audio/list', async (req, res) => {
  if (req.query.refresh) {
    loadAudioIndex();
  }
  ensureRemoteIndexesLoaded(Boolean(req.query.refresh)).catch(() => {});
  res.json({
    audios: Array.from(audioDatabase.entries()).map(([audioId, data]) => ({
      audioId,
      name: data.name,
      url: data.url,
      uploadedAt: data.uploadedAt,
      size: data.size
    }))
  });
});

app.delete('/api/audio/:audioId', async (req, res) => {
  const audio = audioDatabase.get(req.params.audioId);
  if (!audio) return res.status(404).json({ error: 'Audio not found' });
  try {
    await fs.promises.unlink(path.join(audioDir, audio.filename)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    audioDatabase.delete(req.params.audioId);
    saveAudioIndex();
    deleteRemoteMedia(req.params.audioId).catch(err => console.warn(`[Firebase] Audio delete background notice:`, err.message));
    res.json({ success: true, message: 'Audio deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete audio file' });
  }
});

// Explicit media sync endpoint from Firestore
app.all(['/api/media/sync', '/api/media/refresh'], async (req, res) => {
  try {
    await loadRemoteIndexes(true);
    res.json({
      success: true,
      message: 'Synced successfully with Firebase Firestore',
      counts: {
        images: imageDatabase.size,
        videos: videoDatabase.size,
        audios: audioDatabase.size
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add media via URL or Firebase Storage URL
app.post('/api/media/add-url', async (req, res) => {
  try {
    const { url, name, type } = req.body || {};
    if (!url || !url.trim()) {
      return res.status(400).json({ error: 'Media URL is required' });
    }
    const cleanUrl = normalizeMediaUrl(url);
    const mediaType = ['image', 'video', 'audio'].includes(type) ? type : inferMediaType(name, '', cleanUrl);
    
    let mediaId = '';
    if (mediaType === 'video') mediaId = createVideoId();
    else if (mediaType === 'audio') mediaId = createAudioId();
    else mediaId = createImageId();

    const displayName = (name && name.trim()) || path.basename(cleanUrl.split('?')[0]) || `${mediaType}-${Date.now()}`;
    const filename = path.basename(cleanUrl.split('?')[0]) || `${mediaId}.${mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : 'jpg'}`;

    const mediaItem = {
      id: mediaId,
      name: displayName,
      url: cleanUrl,
      filename: filename,
      type: mediaType,
      uploadedAt: new Date().toISOString(),
      size: 0
    };

    if (mediaType === 'video') videoDatabase.set(mediaId, mediaItem);
    else if (mediaType === 'audio') audioDatabase.set(mediaId, mediaItem);
    else imageDatabase.set(mediaId, mediaItem);

    await saveRemoteMedia(mediaId, mediaItem);

    if (mediaType === 'video') saveVideoIndex();
    else if (mediaType === 'audio') saveAudioIndex();
    else saveImageIndex();

    res.json({ success: true, message: `${mediaType} added successfully to library and Firestore`, media: mediaItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  if (room.host && room.host.readyState === WebSocket.OPEN) send(room.host, message);
  for (const [, p] of room.players.entries()) {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) {
      send(p.ws, message);
    }
  }
}

function broadcastConnectionStatus(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcastToRoom(roomId, {
    type: 'connection_status',
    payload: {
      host: Boolean(room.host && room.host.readyState === WebSocket.OPEN),
      player: Array.from(room.players.values()).some(({ ws }) => ws && ws.readyState === WebSocket.OPEN)
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
        rooms.set(roomId, {
          roomId,
          host: null,
          players: new Map(),
          currentQuestion: null,
          currentVideo: null,
          currentAudio: null,
          questionLevel: 1,
          lifelines: { callUsed: false, fiftyFiftyUsed: false, fiftyFiftyRemove: null }
        });
      }
      const room = rooms.get(roomId);
      room.roomId = roomId;

      if (role === 'host') {
        const isReconnect = Boolean(room.host);
        room.host = ws;

        send(ws, { 
          type: 'joined', 
          payload: { 
            role: 'host', 
            roomId, 
            reconnected: isReconnect,
            questionLevel: room.questionLevel || 1 
          } 
        });

        // 1. Sync active question to the host if in progress
        if (room.currentQuestion) {
          send(ws, { type: 'question', payload: room.currentQuestion });
          if (room.currentQuestion.hostSelectedAnswer) {
            send(ws, { type: 'host_answer_selected', payload: { answer: room.currentQuestion.hostSelectedAnswer } });
          }
          if (room.currentQuestion.answerLocked) {
            const activePlayer = room.currentQuestion.activePlayerId ? room.players.get(room.currentQuestion.activePlayerId) : null;
            send(ws, {
              type: 'answer_locked',
              payload: {
                answer: room.currentQuestion.hostSelectedAnswer,
                playerId: room.currentQuestion.activePlayerId,
                playerName: activePlayer?.name || 'Player'
              }
            });
          }
        }

        // 2. Sync media preview if running
        if (room.currentVideo) {
          send(ws, { type: 'video_preview', payload: room.currentVideo });
        } else if (room.currentAudio) {
          send(ws, { type: 'audio_preview', payload: room.currentAudio });
        }

        // 3. Sync lifelines state
        if (room.lifelines?.fiftyFiftyUsed) {
          send(ws, { type: 'lifeline_5050', payload: { remove: room.lifelines.fiftyFiftyRemove || [] } });
        }
        if (room.lifelines?.callUsed) {
          send(ws, { type: 'lifeline_call' });
        }

        // 4. Sync players and scoreboard
        broadcastScoreboard(room);
        const playersList = Array.from(room.players.entries()).map(([pid, p]) => ({
          playerId: pid,
          name: p.name,
          score: p.score,
          cash: p.cash,
          clearedLevel: p.clearedLevel,
          eliminated: Boolean(p.eliminated),
          connected: Boolean(p.ws && p.ws.readyState === WebSocket.OPEN)
        }));
        send(ws, { type: 'players', payload: playersList });
      } else {
        const reqPlayerId = payload?.playerId;
        const normalizedName = String(ws.name || '').trim().toLowerCase();
        let existingPlayerKey = null;
        let existingPlayer = null;

        // Check if player ID matches an existing record in room
        if (reqPlayerId && room.players.has(reqPlayerId)) {
          existingPlayerKey = reqPlayerId;
          existingPlayer = room.players.get(reqPlayerId);
        } else {
          // Check by name match in this room
          for (const [pId, p] of room.players.entries()) {
            if (String(p.name || '').trim().toLowerCase() === normalizedName) {
              existingPlayerKey = pId;
              existingPlayer = p;
              break;
            }
          }
        }

        if (existingPlayer) {
          // Reconnect existing player
          ws.id = existingPlayerKey;
          existingPlayer.ws = ws;
          existingPlayer.name = ws.name;
          existingPlayer.connected = true;
          delete existingPlayer.disconnectedAt;

          console.log(`[Reconnected] Player "${existingPlayer.name}" (ID: ${ws.id}) in room ${roomId}. Cash: ₹${existingPlayer.cash}, Cleared: Q${existingPlayer.clearedLevel}`);

          send(ws, {
            type: 'joined',
            payload: {
              role: 'player',
              roomId,
              playerId: ws.id,
              name: existingPlayer.name,
              reconnected: true
            }
          });

          // 1. Sync full game and ladder state
          send(ws, {
            type: 'sync_state',
            payload: {
              playerId: ws.id,
              name: existingPlayer.name,
              cash: existingPlayer.cash || 0,
              score: existingPlayer.score || existingPlayer.cash || 0,
              clearedLevel: existingPlayer.clearedLevel || 0,
              eliminated: Boolean(existingPlayer.eliminated),
              questionLevel: room.questionLevel || 1,
              lifelines: room.lifelines || {}
            }
          });

          // 2. Sync lifelines
          if (room.lifelines?.callUsed) {
            send(ws, { type: 'lifeline_call' });
          }
          if (room.lifelines?.fiftyFiftyRemove && Array.isArray(room.lifelines.fiftyFiftyRemove)) {
            send(ws, { type: 'lifeline_5050', payload: { remove: room.lifelines.fiftyFiftyRemove } });
          }

          // 3. Sync media preview if active
          if (room.currentVideo) {
            send(ws, { type: 'video_preview', payload: room.currentVideo });
          } else if (room.currentAudio) {
            send(ws, { type: 'audio_preview', payload: room.currentAudio });
          }

          // 4. Sync active question
          if (room.currentQuestion) {
            const questionPayload = { ...room.currentQuestion };
            if (questionPayload.startedAt && questionPayload.timeLimitSec) {
              const elapsedSec = Math.floor((Date.now() - questionPayload.startedAt) / 1000);
              questionPayload.remainingTimeSec = Math.max(0, Number(questionPayload.timeLimitSec) - elapsedSec);
            }
            send(ws, { type: 'question', payload: questionPayload });

            if (room.currentQuestion.hostSelectedAnswer) {
              send(ws, { type: 'host_answer_selected', payload: { answer: room.currentQuestion.hostSelectedAnswer } });
            }
            if (room.currentQuestion.answerLocked) {
              send(ws, {
                type: 'answer_locked',
                payload: {
                  answer: room.currentQuestion.hostSelectedAnswer,
                  playerId: room.currentQuestion.activePlayerId,
                  playerName: existingPlayer.name
                }
              });
            }
            if (room.currentQuestion.resultMarked) {
              const correctAnswer = String(room.currentQuestion.metadata?.correct || '').toUpperCase();
              const result = room.currentQuestion.hostSelectedAnswer === correctAnswer ? 'correct' : 'wrong';
              send(ws, {
                type: 'answer_result',
                payload: {
                  result,
                  answer: room.currentQuestion.hostSelectedAnswer,
                  playerId: ws.id,
                  cash: existingPlayer.cash,
                  eliminated: existingPlayer.eliminated,
                  level: room.currentQuestion.level || 1,
                  resetLevel: result === 'wrong' ? 1 : null
                }
              });
            }
          }

          if (room.host) {
            send(room.host, {
              type: 'player_reconnected',
              payload: { playerId: ws.id, name: existingPlayer.name, cash: existingPlayer.cash, clearedLevel: existingPlayer.clearedLevel }
            });
          }
          broadcastScoreboard(room);
        } else {
          // Fresh player join
          room.players.set(ws.id, { ws, name: ws.name, score: 0, cash: 0, clearedLevel: 0, eliminated: false, connected: true });
          send(ws, { type: 'joined', payload: { role: 'player', roomId, playerId: ws.id, reconnected: false } });
          if (room.lifelines?.callUsed) send(ws, { type: 'lifeline_call' });
          if (room.lifelines?.fiftyFiftyRemove && Array.isArray(room.lifelines.fiftyFiftyRemove)) {
            send(ws, { type: 'lifeline_5050', payload: { remove: room.lifelines.fiftyFiftyRemove } });
          }
          if (room.currentQuestion) {
            send(ws, { type: 'question', payload: room.currentQuestion });
          }
          if (room.host) send(room.host, { type: 'player_joined', payload: { playerId: ws.id, name: ws.name } });
        }
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
      const correctAnswer = String(room.currentQuestion.metadata?.correct || '').toUpperCase();
      const hostJudgement = payload?.result;
      const autoResult = room.currentQuestion.hostSelectedAnswer === correctAnswer ? 'correct' : 'wrong';
      const result = (hostJudgement === 'correct' || hostJudgement === 'wrong') ? hostJudgement : autoResult;

      const playerId = room.currentQuestion.activePlayerId || payload?.playerId || (room.players.size > 0 ? room.players.keys().next().value : null);
      let targetPlayer = playerId ? room.players.get(playerId) : null;
      if (!targetPlayer && room.players.size > 0) {
        targetPlayer = room.players.values().next().value;
      }
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
      let timeLimit = payload?.timeLimitSec;
      if (timeLimit === 'auto' || timeLimit === undefined || timeLimit === null || timeLimit === '') {
        timeLimit = getQuestionTimeLimit(level);
      } else {
        const val = Number(timeLimit);
        timeLimit = [30, 45, 60].includes(val) ? val : getQuestionTimeLimit(level) || 30;
      }
      let videoUrl = payload?.videoUrl;
      if (!videoUrl && payload?.videoId && videoDatabase.has(payload.videoId)) {
        videoUrl = videoDatabase.get(payload.videoId)?.url;
      }
      let audioUrl = payload?.audioUrl;
      if (!audioUrl && payload?.audioId && audioDatabase.has(payload.audioId)) {
        audioUrl = audioDatabase.get(payload.audioId)?.url;
      }
      let cleanText = payload?.text ? fixDevanagariMatras(payload.text) : '';
      let cleanOptions = Array.isArray(payload?.metadata?.options) 
        ? payload.metadata.options.map(opt => fixDevanagariMatras(opt))
        : (payload?.metadata?.options || []);

      room.currentQuestion = {
        ...payload,
        text: cleanText,
        metadata: {
          ...(payload?.metadata || {}),
          options: cleanOptions
        },
        level,
        startedAt: Date.now(),
        timeLimitSec: timeLimit,
        videoUrl: videoUrl || payload?.videoUrl || null,
        audioUrl: audioUrl || payload?.audioUrl || null,
        hostSelectedAnswer: null,
        answerLocked: false,
        activePlayerId: null,
        resultMarked: false
      };
      room.currentVideo = null;
      room.currentAudio = null;
      if (room.lifelines) {
        room.lifelines.fiftyFiftyRemove = null;
      }
      room.questionLevel = Math.min(room.questionLevel + 1, PRIZE_LADDER.length);
      broadcastToRoom(ws.roomId, { type: 'question', payload: room.currentQuestion });
      send(ws, {
        type: 'question_sent',
        payload: {
          text: room.currentQuestion.text,
          videoId: room.currentQuestion.videoId || null,
          audioId: room.currentQuestion.audioId || null,
          format: room.currentQuestion.format || 'text',
          level,
          timeLimitSec: timeLimit
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
          clearedLevel: p.clearedLevel,
          eliminated: Boolean(p.eliminated),
          connected: Boolean(p.ws && p.ws.readyState === WebSocket.OPEN)
        }));
        send(ws, { type: 'players', payload: players });
      }
      return;
    }

    // 7. LIFELINE
    if (type === 'video_preview') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'host') return;
      let url = payload?.url;
      if (!url && payload?.videoId && videoDatabase.has(payload.videoId)) {
        url = videoDatabase.get(payload.videoId)?.url;
      }
      if (!url) return;
      room.currentVideo = { url, name: payload.name || 'Video question', videoId: payload.videoId || null };
      room.currentAudio = null;
      broadcastToRoom(ws.roomId, { type: 'video_preview', payload: room.currentVideo });
      return;
    }

    if (type === 'video_ended') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'player') return;
      const playerRecord = room.players.get(ws.id);
      const playerName = ws.name || playerRecord?.name || payload?.playerName || 'Player';
      if (room.host) send(room.host, { type: 'video_ended', payload: { videoId: payload?.videoId || null, playerId: ws.id, playerName } });
      return;
    }

    if (type === 'audio_preview') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'host' || !payload?.url) return;
      room.currentAudio = { url: payload.url, name: payload.name || 'Audio question', audioId: payload.audioId || null };
      room.currentVideo = null;
      broadcastToRoom(ws.roomId, { type: 'audio_preview', payload: room.currentAudio });
      return;
    }

    if (type === 'audio_ended') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'player') return;
      const playerRecord = room.players.get(ws.id);
      const playerName = ws.name || playerRecord?.name || payload?.playerName || 'Player';
      if (room.host) send(room.host, { type: 'audio_ended', payload: { audioId: payload?.audioId || null, playerId: ws.id, playerName } });
      return;
    }

    if (type === 'lifeline_5050') {
      const room = rooms.get(ws.roomId);
      if (room) {
        room.lifelines = room.lifelines || {};
        room.lifelines.fiftyFiftyUsed = true;
        room.lifelines.fiftyFiftyRemove = payload?.remove || [];
      }
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
        persistScoreSnapshot({ playerId: player.ws?.id || player.id, name: player.name, roomId: ws.roomId, score: 0, cash: 0, clearedLevel: 0, eliminated: false });
        if (player.ws) {
          send(player.ws, { type: 'refresh' });
          player.ws.role = null;
        }
      }
      room.players.clear();
      room.currentQuestion = null;
      room.currentVideo = null;
      room.currentAudio = null;
      room.questionLevel = 1;
      room.lifelines = { callUsed: false, fiftyFiftyUsed: false, fiftyFiftyRemove: null };
      broadcastScoreboard(room);
      broadcastConnectionStatus(ws.roomId);
      console.log("Players refreshed and roster cleared");
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    if (ws.role === 'host' && room.host === ws) {
      room.host = null;
    } else if (ws.role === 'player') {
      const player = room.players.get(ws.id);
      if (player) {
        player.ws = null;
        player.connected = false;
        player.disconnectedAt = Date.now();
      }
      if (room.host) send(room.host, { type: 'player_left', payload: { playerId: ws.id, name: player ? player.name : ws.name } });
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
    eliminated: player.eliminated,
    connected: Boolean(player.ws && player.ws.readyState === WebSocket.OPEN)
  }));
  broadcastToRoom(room.roomId || '', { type: 'scoreboard', payload: scoreboard });
}

function escapeXml(unsafe) {
  return String(unsafe || '').replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

app.get('/images/:filename', async (req, res, next) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(imagesDir, filename);
  if (fs.existsSync(filePath)) return next();
  const restored = await rehydrateMediaFile('image', filename);
  if (restored && fs.existsSync(filePath)) return res.sendFile(filePath);
  const item = Array.from(imageDatabase.values()).find(i => i.filename === filename);
  if (item && item.url && item.url.startsWith('http')) {
    return res.redirect(item.url);
  }
  const title = item ? item.name : filename;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
    <rect width="600" height="400" fill="#152238"/>
    <rect x="20" y="20" width="560" height="360" rx="12" fill="#1f3252" stroke="#ffd54d" stroke-width="2"/>
    <text x="50%" y="45%" text-anchor="middle" fill="#ffd54d" font-family="sans-serif" font-size="24" font-weight="bold">📷 ${escapeXml(title)}</text>
    <text x="50%" y="60%" text-anchor="middle" fill="#9ec5e8" font-family="sans-serif" font-size="14">Persisted media record from Firestore</text>
  </svg>`);
});

app.get('/videos/:filename', async (req, res, next) => {
  const rawParam = req.params.filename || '';
  const decodedName = decodeURIComponent(rawParam);
  const filename = path.basename(decodedName);

  // 1. Check if direct file exists on disk
  let filePath = path.join(videosDir, filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath, { acceptRanges: true });
  }

  // 2. Check if requested by videoId or filename in database
  const item = videoDatabase.get(filename) || Array.from(videoDatabase.values()).find(v => v.filename === filename || v.id === filename);
  if (item) {
    if (item.filename) {
      filePath = path.join(videosDir, item.filename);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath, { acceptRanges: true });
      }
    }
    if (item.url && item.url.startsWith('http')) {
      return res.redirect(item.url);
    }
  }

  // 3. Try rehydrating from remote
  const restored = await rehydrateMediaFile('video', item?.filename || filename);
  if (restored && fs.existsSync(filePath)) {
    return res.sendFile(filePath, { acceptRanges: true });
  }

  next();
});

app.get('/audio/:filename', async (req, res, next) => {
  const rawParam = req.params.filename || '';
  const decodedName = decodeURIComponent(rawParam);
  const filename = path.basename(decodedName);
  let filePath = path.join(audioDir, filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath, { acceptRanges: true });
  }
  const item = audioDatabase.get(filename) || Array.from(audioDatabase.values()).find(a => a.filename === filename || a.id === filename);
  if (item) {
    if (item.filename) {
      filePath = path.join(audioDir, item.filename);
      if (fs.existsSync(filePath)) return res.sendFile(filePath, { acceptRanges: true });
    }
    if (item.url && item.url.startsWith('http')) {
      return res.redirect(item.url);
    }
  }
  const restored = await rehydrateMediaFile('audio', item?.filename || filename);
  if (restored && fs.existsSync(filePath)) return res.sendFile(filePath, { acceptRanges: true });
  next();
});

app.use('/images', express.static(imagesDir));
app.use('/videos', express.static(videosDir, {
  acceptRanges: true,
  setHeaders: (res, filePath) => {
    res.setHeader('Accept-Ranges', 'bytes');
    const ext = path.extname(filePath).toLowerCase();
    if (!ext || ext === '.mp4') res.setHeader('Content-Type', 'video/mp4');
    else if (ext === '.webm') res.setHeader('Content-Type', 'video/webm');
    else if (ext === '.ogg' || ext === '.ogv') res.setHeader('Content-Type', 'video/ogg');
    else if (ext === '.mov' || ext === '.qt') res.setHeader('Content-Type', 'video/quicktime');
  }
}));
app.use('/audio', express.static(audioDir, { acceptRanges: true }));

// Healthcheck endpoints for Cloud Run and container readiness probes
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/healthz', (req, res) => res.status(200).send('OK'));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

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
  printServerUrls();
  // Asynchronously load remote indexes and scores without blocking healthchecks
  Promise.all([
    Promise.race([loadRemoteIndexes(), new Promise(r => setTimeout(r, 4000))]),
    Promise.race([loadRemoteScores(), new Promise(r => setTimeout(r, 4000))])
  ]).catch(error => {
    console.warn('[Firebase] Non-blocking initial sync notice:', error?.message || error);
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    printServerUrls('Server is already running at');
    return;
  }
  console.error('HTTP server error:', error);
});

wss.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    printServerUrls('Server is already running at');
    return;
  }
  console.error('WebSocket server error:', error);
});

// Clean shutdown signals for container environments
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, closing gracefully');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('Received SIGINT, closing gracefully');
  server.close(() => process.exit(0));
});
