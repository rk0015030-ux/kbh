const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

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
  const postMatras = '[\\u0901-\\u0903\\u093A-\\u094F\\u0951-\\u0957\\u0962-\\u0963]';
  const postMatrasNoPre = '[\\u0901-\\u0903\\u093A-\\u093E\\u0940-\\u094F\\u0951-\\u0957\\u0962-\\u0963]';
  const vowelSigns = '[\\u093E-\\u094C]';
  const cluster = '(?:' + baseChar + nukta + '?(?:' + halant + baseChar + nukta + '?)*)';
  const devStart = '(^|[^\\u0900-\\u097F])';
  const devEnd = '(?=[^\\u0900-\\u097F]|$)';
  const nonConsBefore = '(^|[^\\u0915-\\u0939\\u0958-\\u095F\\u093C\\u094D])\\s*';

  // 1. Remove non-printing noise: zero-width spaces, BOM, soft hyphens
  s = s.replace(/[\u200B\uFEFF\u00AD]/g, '');

  // 2. Remove stray zero-width joiners/non-joiners around spaces
  s = s.replace(/\s*[\u200C\u200D]\s*/g, '');

  // 3. Specific common PDF spaced decompositions for Priya / Priye / Priyaa
  s = s.replace(/प\s*्\s*र\s*ि\s*य\s*ा/gu, 'प्रिया');
  s = s.replace(/प\s*्\s*र\s*ि\s*य/gu, 'प्रिय');
  s = s.replace(/प\s*्\s*र\s+य\s*ा/gu, 'प्रिया');
  s = s.replace(/प\s*्\s*र\s+य(?=[^\u0900-\u097F]|$)/gu, 'प्रिय');

  // 4. Remove artificial spaces around halant (virama) in consonant clusters
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\s+(' + halant + ')', 'g'), '$1$2');
  s = s.replace(new RegExp('(' + halant + ')\\s+(' + baseChar + nukta + '?)', 'g'), '$1$2');

  // 5. Vocalic R (ृ \u0943 / ॄ \u0944) repairs:
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\s*' + halant + '?\\s*\\u090B', 'gu'), '$1\u0943');
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\s+([\\u0943\\u0944])', 'g'), '$1$2');
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)' + halant + '\\s*([\\u0943\\u0944])', 'g'), '$1$2');
  s = s.replace(new RegExp(nonConsBefore + '([\\u0943\\u0944])\\s*(' + cluster + ')', 'gu'), '$1$3$2');

  // 6. Connect base consonant to following matra when space was artificially inserted:
  // e.g. "क ि स" -> "कि स" -> "किस", "न ि म् न" -> "नि म्न" -> "निम्न"
  s = s.replace(new RegExp('(^|\\s)(' + baseChar + nukta + '?)\\s+\\u093F(?=\\s*' + baseChar + ')', 'gu'), (m, p1, p2) => p1 + p2 + '\u093F');
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\s+(' + postMatrasNoPre + ')', 'g'), '$1$2');

  // Spaced token repairs for common quiz words
  s = s.replace(/नि\s+म्न/gu, 'निम्न');
  s = s.replace(/कि\s+स/gu, 'किस');

  // 7. Pre-base short I (ि \u093F) reordering:
  // Visual order in PDF: \u093F appears BEFORE the consonant or consonant cluster
  // e.g. "िक" -> "कि", "िकस" -> "किस", "िनम्न" -> "निम्न", "िकताब" -> "किताब"
  s = s.replace(new RegExp('(^|[^\\u0915-\\u0939\\u0958-\\u095F\\u093C\\u094D])(\\s*)\\u093F\\s*(' + cluster + ')', 'gu'), (match, p1, p2, p3) => {
    return p1 + p2 + p3 + '\u093F';
  });

  // Reconnect any remaining spaced matras
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\s+(' + postMatras + ')', 'g'), '$1$2');

  // Spaced token repairs for common quiz words
  s = s.replace(/नि\s+म्न/gu, 'निम्न');
  s = s.replace(/कि\s+स/gu, 'किस');

  // 8. Remove spaces between vowel signs and anusvara / visarga / candrabindu
  s = s.replace(new RegExp('([\\u093E-\\u094C\\u0943\\u0944])\\s+([\\u0901-\\u0903])', 'g'), '$1$2');

  // 9. Reph (र् \u0930\u094D) repairs:
  s = s.replace(new RegExp('(' + baseChar + nukta + '?(?:[\\u093E-\\u094C\\u0943\\u0944])?)\\s+(\\u0930' + halant + baseChar + nukta + '?)', 'g'), '$1$2');
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)(' + postMatras + '?)\\u0930' + halant + devEnd, 'gu'), (m, p1, p2) => {
    return '\u0930\u094D' + p1 + (p2 || '');
  });

  // 10. Displaced short I (ि \u093F) in PDF glyph streams:
  s = s.replace(new RegExp('(' + cluster + ')(' + cluster + ')\\u093F(' + vowelSigns + ')', 'g'), '$1\u093F$2$3');
  s = s.replace(new RegExp(devStart + 'करिण' + devEnd, 'gu'), '$1किरण');

  // 11. Devanagari specific repair for "प्र" split from "य", "या", "ये", etc.
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
  s = s.replace(new RegExp(devStart + '(प्र\\u093F)\\s+(य[\\u093E-\\u094C]?)' + devEnd, 'gu'), '$1$2$3');
  s = s.replace(new RegExp('(^|\\s)प्रय' + devEnd, 'gu'), '$1प्रिय');
  s = s.replace(new RegExp(devStart + 'अप्रय' + devEnd, 'gu'), '$1अप्रिय');
  s = s.replace(new RegExp(devStart + 'सर्वप्रय' + devEnd, 'gu'), '$1सर्वप्रिय');
  s = s.replace(new RegExp(devStart + 'प्राणप्रय' + devEnd, 'gu'), '$1प्राणप्रिय');

  // 12. Dropped matra repairs for common Hindi question and option words:
  // निम्न & निम्नलिखित
  s = s.replace(new RegExp(devStart + 'नम्नलिखित' + devEnd, 'gu'), '$1निम्नलिखित');
  s = s.replace(new RegExp(devStart + 'नम्नलखत' + devEnd, 'gu'), '$1निम्नलिखित');
  s = s.replace(new RegExp(devStart + 'नम्र्नलिखित' + devEnd, 'gu'), '$1निम्नलिखित');
  s = s.replace(new RegExp(devStart + 'नम्न' + devEnd, 'gu'), '$1निम्न');

  // किस & derivative question words
  s = s.replace(new RegExp(devStart + 'कसने' + devEnd, 'gu'), '$1किसने');
  s = s.replace(new RegExp(devStart + 'कसी' + devEnd, 'gu'), '$1किसी');
  s = s.replace(new RegExp(devStart + 'कसका' + devEnd, 'gu'), '$1किसका');
  s = s.replace(new RegExp(devStart + 'कसकी' + devEnd, 'gu'), '$1किसकी');
  s = s.replace(new RegExp(devStart + 'कसके' + devEnd, 'gu'), '$1किसके');
  s = s.replace(new RegExp(devStart + 'कतने' + devEnd, 'gu'), '$1कितने');
  s = s.replace(new RegExp(devStart + 'कतना' + devEnd, 'gu'), '$1कितना');
  s = s.replace(new RegExp(devStart + 'कतनी' + devEnd, 'gu'), '$1कितनी');
  s = s.replace(new RegExp(devStart + 'कसे' + devEnd, 'gu'), '$1किसे');
  s = s.replace(new RegExp(devStart + 'कस' + devEnd, 'gu'), '$1किस');

  // दिए & किया
  s = s.replace(new RegExp(devStart + 'दए\\s+गए' + devEnd, 'gu'), '$1दिए गए');
  s = s.replace(new RegExp(devStart + 'दए' + devEnd, 'gu'), '$1दिए');
  s = s.replace(new RegExp(devStart + 'दया\\s+गया' + devEnd, 'gu'), '$1दिया गया');
  s = s.replace(new RegExp(devStart + 'कया\\s+गया' + devEnd, 'gu'), '$1किया गया');
  s = s.replace(new RegExp(devStart + 'कया' + devEnd, 'gu'), '$1किया');
  s = s.replace(new RegExp(devStart + 'कए' + devEnd, 'gu'), '$1किए');

  // जिस & जिन
  s = s.replace(new RegExp(devStart + 'जसमें' + devEnd, 'gu'), '$1जिसमें');
  s = s.replace(new RegExp(devStart + 'जसका' + devEnd, 'gu'), '$1जिसका');
  s = s.replace(new RegExp(devStart + 'जसके' + devEnd, 'gu'), '$1जिसके');
  s = s.replace(new RegExp(devStart + 'जसकी' + devEnd, 'gu'), '$1जिसकी');
  s = s.replace(new RegExp(devStart + 'जसने' + devEnd, 'gu'), '$1जिसने');
  s = s.replace(new RegExp(devStart + 'जन्हें' + devEnd, 'gu'), '$1जिन्हें');
  s = s.replace(new RegExp(devStart + 'जनमें' + devEnd, 'gu'), '$1जिनमें');
  s = s.replace(new RegExp(devStart + 'जनका' + devEnd, 'gu'), '$1जिनका');
  s = s.replace(new RegExp(devStart + 'जनके' + devEnd, 'gu'), '$1जिनके');
  s = s.replace(new RegExp(devStart + 'जनकी' + devEnd, 'gu'), '$1जिनकी');
  s = s.replace(new RegExp(devStart + 'जस' + devEnd, 'gu'), '$1जिस');

  // मिलता & नियम & दिशा & दिन
  s = s.replace(new RegExp(devStart + 'मलता' + devEnd, 'gu'), '$1मिलता');
  s = s.replace(new RegExp(devStart + 'मलते' + devEnd, 'gu'), '$1मिलते');
  s = s.replace(new RegExp(devStart + 'मलती' + devEnd, 'gu'), '$1मिलती');
  s = s.replace(new RegExp(devStart + 'मला' + devEnd, 'gu'), '$1मिला');
  s = s.replace(new RegExp(devStart + 'मले' + devEnd, 'gu'), '$1मिले');
  s = s.replace(new RegExp(devStart + 'नयम' + devEnd, 'gu'), '$1नियम');
  s = s.replace(new RegExp(devStart + 'दशा' + devEnd, 'gu'), '$1दिशा');
  s = s.replace(new RegExp(devStart + 'दन' + devEnd, 'gu'), '$1दिन');
  s = s.replace(new RegExp(devStart + 'दल' + devEnd, 'gu'), '$1दिल');
  s = s.replace(new RegExp(devStart + 'शक्षा' + devEnd, 'gu'), '$1शिक्षा');
  s = s.replace(new RegExp(devStart + 'हन्दी' + devEnd, 'gu'), '$1हिन्दी');
  s = s.replace(new RegExp(devStart + 'हंदी' + devEnd, 'gu'), '$1हिंदी');
  s = s.replace(new RegExp(devStart + 'संधु' + devEnd, 'gu'), '$1सिंधु');
  s = s.replace(new RegExp(devStart + 'सक्के' + devEnd, 'gu'), '$1सिक्के');
  s = s.replace(new RegExp(devStart + 'सक्का' + devEnd, 'gu'), '$1सिक्का');
  s = s.replace(new RegExp(devStart + 'हस्सा' + devEnd, 'gu'), '$1हिस्सा');
  s = s.replace(new RegExp(devStart + 'कला' + devEnd, 'gu'), '$1किला');
  s = s.replace(new RegExp(devStart + 'कले' + devEnd, 'gu'), '$1किले');
  s = s.replace(new RegExp(devStart + 'गनती' + devEnd, 'gu'), '$1गिनती');
  s = s.replace(new RegExp(devStart + 'लखिए' + devEnd, 'gu'), '$1लिखिए');
  s = s.replace(new RegExp(devStart + 'लखें' + devEnd, 'gu'), '$1लिखें');
  s = s.replace(new RegExp(devStart + 'दखाई' + devEnd, 'gu'), '$1दिखाई');
  s = s.replace(new RegExp(devStart + 'दखता' + devEnd, 'gu'), '$1दिखता');
  s = s.replace(new RegExp(devStart + 'दखते' + devEnd, 'gu'), '$1दिखते');
  s = s.replace(new RegExp(devStart + 'दखती' + devEnd, 'gu'), '$1दिखती');

  // वि prefix words
  s = s.replace(new RegExp(devStart + 'वकल्पों' + devEnd, 'gu'), '$1विकल्पों');
  s = s.replace(new RegExp(devStart + 'वकल्प' + devEnd, 'gu'), '$1विकल्प');
  s = s.replace(new RegExp(devStart + 'वकास' + devEnd, 'gu'), '$1विकास');
  s = s.replace(new RegExp(devStart + 'वज्ञान' + devEnd, 'gu'), '$1विज्ञान');
  s = s.replace(new RegExp(devStart + 'वशेष' + devEnd, 'gu'), '$1विशेष');
  s = s.replace(new RegExp(devStart + 'वश्व' + devEnd, 'gu'), '$1विश्व');
  s = s.replace(new RegExp(devStart + 'वद्यार्थी' + devEnd, 'gu'), '$1विद्यार्थी');
  s = s.replace(new RegExp(devStart + 'वद्या' + devEnd, 'gu'), '$1विद्या');
  s = s.replace(new RegExp(devStart + 'वभाग' + devEnd, 'gu'), '$1विभाग');
  s = s.replace(new RegExp(devStart + 'वजेता' + devEnd, 'gu'), '$1विजेता');
  s = s.replace(new RegExp(devStart + 'वस्तार' + devEnd, 'gu'), '$1विस्तार');
  s = s.replace(new RegExp(devStart + 'वद्रोह' + devEnd, 'gu'), '$1विद्रोह');
  s = s.replace(new RegExp(devStart + 'वदेशी' + devEnd, 'gu'), '$1विदेशी');
  s = s.replace(new RegExp(devStart + 'वदेश' + devEnd, 'gu'), '$1विदेश');
  s = s.replace(new RegExp(devStart + 'ववाह' + devEnd, 'gu'), '$1विवाह');
  s = s.replace(new RegExp(devStart + 'वचार' + devEnd, 'gu'), '$1विचार');
  s = s.replace(new RegExp(devStart + 'वषय' + devEnd, 'gu'), '$1विषय');
  s = s.replace(new RegExp(devStart + 'ववरण' + devEnd, 'gu'), '$1विवरण');
  s = s.replace(new RegExp(devStart + 'संवधान' + devEnd, 'gu'), '$1संविधान');
  s = s.replace(new RegExp(devStart + 'अधकार' + devEnd, 'gu'), '$1अधिकार');
  s = s.replace(new RegExp(devStart + 'अधनयम' + devEnd, 'gu'), '$1अधिनियम');
  s = s.replace(new RegExp(devStart + 'अधवेशन' + devEnd, 'gu'), '$1अधिवेशन');
  s = s.replace(new RegExp(devStart + 'अधकतम' + devEnd, 'gu'), '$1अधिकतम');
  s = s.replace(new RegExp(devStart + 'अधक' + devEnd, 'gu'), '$1अधिक');
  s = s.replace(new RegExp(devStart + 'परणाम' + devEnd, 'gu'), '$1परिणाम');
  s = s.replace(new RegExp(devStart + 'परवर्तन' + devEnd, 'gu'), '$1परिवर्तन');
  s = s.replace(new RegExp(devStart + 'प्रसद्ध' + devEnd, 'gu'), '$1प्रसिद्ध');
  s = s.replace(new RegExp(devStart + 'इतहास' + devEnd, 'gu'), '$1इतिहास');

  // Other known words
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

  // Reconnect detached "प्र" prefix when followed by common words
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

  // 13. Deduplicate adjacent identical matras (e.g. \u093F\u093F -> \u093F)
  s = s.replace(/(\u093F)+/g, '$1');
  s = s.replace(/([\u093E-\u094C])\1+/g, '$1');

  // 14. Normalize multiple horizontal spaces
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
let supabaseClient = null;
let supabaseChecked = false;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'media';
const ensuredBuckets = new Set();

function getBucketForType(type) {
  if (type === 'video') return 'videos';
  if (type === 'audio') return 'audio';
  return 'images';
}

function inferMimeType(filePath, type) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return type === 'video' ? 'video/ogg' : 'audio/ogg';
  if (ext === '.oga') return 'audio/ogg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.opus') return 'audio/opus';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return type === 'video' ? 'video/webm' : 'audio/webm';
  if (ext === '.mov' || ext === '.qt') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function getOrCreateSupabase() {
  if (supabaseClient) return supabaseClient;
  try {
    let supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                      process.env.SUPABASE_SERVICE_KEY || 
                      process.env.SUPABASE_KEY || 
                      process.env.SUPABASE_ANON_KEY || 
                      process.env.VITE_SUPABASE_ANON_KEY;

    const configPath = path.join(__dirname, 'supabase-config.json');
    if (!supabaseUrl && fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        supabaseUrl = config.supabaseUrl || config.url || config.SUPABASE_URL;
        supabaseKey = config.supabaseKey || config.key || config.serviceRoleKey || config.SUPABASE_KEY;
      } catch (e) {}
    }

    if (supabaseUrl && supabaseKey) {
      supabaseClient = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false }
      });
      if (!supabaseChecked) {
        console.log('[Supabase] Initialized Supabase client for', supabaseUrl);
        supabaseChecked = true;
      }
    } else if (!supabaseChecked) {
      console.log('[Supabase] Operating with local filesystem storage. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for cloud persistence.');
      supabaseChecked = true;
    }
  } catch (err) {
    console.warn('[Supabase] Client init error:', err.message);
  }
  return supabaseClient;
}

async function ensureBucket(client, bucketName) {
  if (!client || ensuredBuckets.has(bucketName)) return true;
  try {
    const { data: buckets } = await client.storage.listBuckets();
    const found = buckets && buckets.some(b => b.name === bucketName);
    if (!found) {
      await client.storage.createBucket(bucketName, { public: true });
      console.log(`[Supabase] Created public storage bucket "${bucketName}"`);
    }
    ensuredBuckets.add(bucketName);
    return true;
  } catch (e) {
    ensuredBuckets.add(bucketName);
    return false;
  }
}

let remoteIndexesLoaded = false;
let remoteIndexesPromise = null;
let remoteScoresLoaded = false;
let remoteScoresPromise = null;

// Multi-tier Indestructible Master Archive
const masterArchiveDir = path.join(__dirname, 'data');
const masterArchivePath = path.join(masterArchiveDir, 'master_archive.json');
const masterArchive = new Map();

function saveMasterArchive() {
  try {
    if (!fs.existsSync(masterArchiveDir)) fs.mkdirSync(masterArchiveDir, { recursive: true });
    fs.writeFileSync(masterArchivePath, JSON.stringify(Object.fromEntries(masterArchive), null, 2));
  } catch (err) {
    console.warn('[MasterArchive] Could not save master archive:', err.message);
  }
}

function loadMasterArchive() {
  try {
    if (fs.existsSync(masterArchivePath)) {
      const parsed = JSON.parse(fs.readFileSync(masterArchivePath, 'utf8'));
      Object.entries(parsed).forEach(([id, item]) => {
        if (item && item.filename) {
          masterArchive.set(id, item);
        }
      });
      console.log(`[MasterArchive] Loaded ${masterArchive.size} permanent media records from disk archive`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[MasterArchive] Load notice:', err.message);
  }
}

loadMasterArchive();

async function saveRemoteMedia(mediaId, item, localFilePath = null) {
  const type = item.type || inferMediaType(item.name, item.filename, item.url);
  const bucketName = getBucketForType(type);
  const filename = item.filename || `${mediaId}.${type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg'}`;

  // 1. TIER 1: Permanent Master Archive Record (Immutable & Append-Only)
  let base64Data = null;
  if (localFilePath && fs.existsSync(localFilePath)) {
    try {
      const stats = fs.statSync(localFilePath);
      // For images, audio, and videos up to 35MB: embed base64 into master archive so it survives container wipes offline
      if (stats.size > 0 && stats.size <= 35 * 1024 * 1024) {
        base64Data = fs.readFileSync(localFilePath).toString('base64');
      }
    } catch (e) {}
  }

  const existingArchive = masterArchive.get(mediaId) || {};
  const archiveItem = {
    id: mediaId,
    name: item.name || existingArchive.name || filename,
    url: item.url || existingArchive.url || '',
    filename: filename,
    type: type,
    size: Number(item.size) || existingArchive.size || 0,
    uploadedAt: item.uploadedAt || existingArchive.uploadedAt || new Date().toISOString(),
    base64: base64Data || existingArchive.base64 || null,
    permanent: true,
    archived: false
  };
  masterArchive.set(mediaId, archiveItem);
  saveMasterArchive();

  // 2. TIER 2: Supabase Cloud Storage & Database Persistence
  const client = getOrCreateSupabase();
  if (client) {
    try {
      await ensureBucket(client, bucketName);

      if (localFilePath && fs.existsSync(localFilePath)) {
        try {
          const fileBuf = fs.readFileSync(localFilePath);
          const mimeType = inferMimeType(filename, type);
          const { error: uploadErr } = await client.storage
            .from(bucketName)
            .upload(filename, fileBuf, {
              contentType: mimeType,
              upsert: true
            });

          if (!uploadErr) {
            const { data: pubData } = client.storage
              .from(bucketName)
              .getPublicUrl(filename);
            if (pubData && pubData.publicUrl) {
              item.url = pubData.publicUrl;
              archiveItem.url = pubData.publicUrl;
              masterArchive.set(mediaId, archiveItem);
              saveMasterArchive();
            }
            console.log(`[Supabase] Uploaded ${type} "${item.name}" to bucket "${bucketName}"`);
          } else {
            console.warn(`[Supabase] Storage upload notice for ${mediaId}:`, uploadErr.message);
          }
        } catch (err) {
          console.warn(`[Supabase] Could not upload file ${mediaId}:`, err.message);
        }
      }

      // Upload master_archive.json to cloud storage for indestructible backup
      try {
        const archiveExport = {};
        for (const [k, v] of masterArchive.entries()) {
          // Export metadata without gigantic base64 blobs in index to keep payload nimble
          archiveExport[k] = { ...v, base64: v.base64 ? true : false };
        }
        await client.storage
          .from(bucketName)
          .upload('master_archive.json', Buffer.from(JSON.stringify(archiveExport, null, 2)), {
            contentType: 'application/json',
            upsert: true
          });
      } catch (archErr) {}

      // Persist active library index.json
      try {
        let dbMap = imageDatabase;
        if (type === 'video') dbMap = videoDatabase;
        else if (type === 'audio') dbMap = audioDatabase;
        const indexObj = Object.fromEntries(dbMap);
        await client.storage
          .from(bucketName)
          .upload('index.json', Buffer.from(JSON.stringify(indexObj, null, 2)), {
            contentType: 'application/json',
            upsert: true
          });
      } catch (idxErr) {}

      // Upsert to Supabase database table `media`
      try {
        await client.from('media').upsert({
          id: mediaId,
          name: item.name || '',
          url: item.url || '',
          filename: filename,
          type: type,
          uploaded_at: item.uploadedAt ? (item.uploadedAt instanceof Date ? item.uploadedAt.toISOString() : String(item.uploadedAt)) : new Date().toISOString(),
          size: Number(item.size) || 0
        }, { onConflict: 'id' });
      } catch (dbErr) {}
    } catch (error) {
      console.warn(`[Supabase] saveRemoteMedia error for ${mediaId}:`, error.message);
    }
  }
}

// Never-Delete Policy: Soft-delete in active view only; NEVER delete from Cloud or Master Archive!
async function deleteRemoteMedia(mediaId) {
  const item = masterArchive.get(mediaId) || imageDatabase.get(mediaId) || videoDatabase.get(mediaId) || audioDatabase.get(mediaId);
  if (item) {
    item.archived = true;
    masterArchive.set(mediaId, item);
    saveMasterArchive();
  }

  // Update remote index.json in Supabase so active view stays in sync, but cloud file is PRESERVED
  const client = getOrCreateSupabase();
  if (client && item) {
    try {
      const type = item.type || 'image';
      const bucketName = getBucketForType(type);
      let dbMap = imageDatabase;
      if (type === 'video') dbMap = videoDatabase;
      else if (type === 'audio') dbMap = audioDatabase;
      const indexObj = Object.fromEntries(dbMap);
      await client.storage
        .from(bucketName)
        .upload('index.json', Buffer.from(JSON.stringify(indexObj, null, 2)), {
          contentType: 'application/json',
          upsert: true
        });
      console.log(`[Supabase] Media ${mediaId} archived in active view; permanent cloud file preserved.`);
    } catch (e) {}
  }
}

async function rehydrateMediaFile(type, filename) {
  if (!filename) return false;
  let targetDir = imagesDir;
  let dbMap = imageDatabase;
  if (type === 'video') { targetDir = videosDir; dbMap = videoDatabase; }
  else if (type === 'audio') { targetDir = audioDir; dbMap = audioDatabase; }

  const targetPath = path.join(targetDir, filename);
  if (fs.existsSync(targetPath)) return true;

  // 1. FAST LOCAL: Check Master Archive for offline base64 payload
  const archiveItem = Array.from(masterArchive.values()).find(m => m.filename === filename || m.id === filename);
  if (archiveItem && archiveItem.base64 && typeof archiveItem.base64 === 'string') {
    try {
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetPath, Buffer.from(archiveItem.base64, 'base64'));
      console.log(`[MasterArchive] Restored ${type} "${filename}" instantly from local master archive`);
      return true;
    } catch (bErr) {
      console.warn(`[MasterArchive] Could not write base64 for ${filename}:`, bErr.message);
    }
  }

  // 2. SUPABASE CLOUD: Try downloading directly from Supabase Storage bucket
  const client = getOrCreateSupabase();
  const bucketName = getBucketForType(type);

  if (client) {
    try {
      const { data: blob, error } = await client.storage
        .from(bucketName)
        .download(filename);

      if (!error && blob) {
        const arrayBuf = await blob.arrayBuffer();
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(targetPath, Buffer.from(arrayBuf));
        console.log(`[Supabase] Successfully rehydrated ${type} "${filename}" from Supabase Storage`);
        return true;
      }
    } catch (err) {
      console.warn(`[Supabase] Download error for ${filename}:`, err.message);
    }
  }

  // 3. REMOTE URL: If item has a public HTTP/HTTPS URL, download to cache
  const item = Array.from(dbMap.values()).find(m => m.filename === filename) || archiveItem;
  if (item && item.url && item.url.startsWith('http')) {
    try {
      const res = await fetch(item.url);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(targetPath, Buffer.from(arrayBuf));
        console.log(`[Supabase] Successfully cached ${type} "${filename}" from URL`);
        return true;
      }
    } catch (fErr) {
      console.warn(`[Supabase] URL stream download notice for ${filename}:`, fErr.message);
    }
  }

  return false;
}

// Proactive background rehydration to ensure every saved media file always exists on disk
async function autoRehydrateAllMedia() {
  const allItems = [
    ...Array.from(imageDatabase.values()),
    ...Array.from(videoDatabase.values()),
    ...Array.from(audioDatabase.values()),
    ...Array.from(masterArchive.values())
  ];

  const seenFilenames = new Set();
  let rehydratedCount = 0;

  for (const item of allItems) {
    if (!item || !item.filename || seenFilenames.has(item.filename)) continue;
    seenFilenames.add(item.filename);

    const type = item.type || 'image';
    let targetDir = imagesDir;
    if (type === 'video') targetDir = videosDir;
    else if (type === 'audio') targetDir = audioDir;

    const targetPath = path.join(targetDir, item.filename);
    if (!fs.existsSync(targetPath)) {
      try {
        const success = await rehydrateMediaFile(type, item.filename);
        if (success) rehydratedCount++;
      } catch (err) {}
    }
  }

  if (rehydratedCount > 0) {
    console.log(`[AutoRehydrate] Restored ${rehydratedCount} media file(s) to disk`);
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

async function loadRemoteIndexes(force = false) {
  const client = getOrCreateSupabase();
  if (!client) {
    remoteIndexesLoaded = true;
    return;
  }

  try {
    let totalLoaded = 0;
    const bucketTypes = [
      { bucket: 'images', type: 'image', db: imageDatabase },
      { bucket: 'videos', type: 'video', db: videoDatabase },
      { bucket: 'audio', type: 'audio', db: audioDatabase }
    ];

    for (const { bucket, type, db } of bucketTypes) {
      try {
        // A. Check if index.json exists in bucket
        const { data: indexBlob, error: indexErr } = await client.storage
          .from(bucket)
          .download('index.json');

        if (!indexErr && indexBlob) {
          try {
            const text = await indexBlob.text();
            const entries = JSON.parse(text);
            Object.entries(entries).forEach(([id, item]) => {
              if (item && (item.filename || item.url)) {
                db.set(id, item);
                totalLoaded++;
              }
            });
          } catch (jsonErr) {}
        }

        // B. Also list files directly from the bucket
        const { data: files, error: listErr } = await client.storage
          .from(bucket)
          .list();

        if (!listErr && Array.isArray(files)) {
          const existingFilenames = new Set(Array.from(db.values()).map(m => m.filename));
          files.forEach(file => {
            if (!file.name || file.name === 'index.json' || file.name.startsWith('.')) return;
            if (existingFilenames.has(file.name)) return;

            const { data: pubData } = client.storage.from(bucket).getPublicUrl(file.name);
            const pubUrl = pubData?.publicUrl || `/${type === 'audio' ? 'audio' : type + 's'}/${encodeURIComponent(file.name)}`;
            const mediaId = `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const mediaItem = {
              id: mediaId,
              name: file.name,
              url: pubUrl,
              filename: file.name,
              type: type,
              uploadedAt: file.created_at || new Date().toISOString(),
              size: file.metadata?.size || 0
            };
            db.set(mediaId, mediaItem);
            existingFilenames.add(file.name);
            totalLoaded++;
          });
        }
        // C. Check master_archive.json in bucket for complete permanent history
        try {
          const { data: archBlob } = await client.storage.from(bucket).download('master_archive.json');
          if (archBlob) {
            const parsedArch = JSON.parse(await archBlob.text());
            Object.entries(parsedArch).forEach(([id, item]) => {
              if (item && item.filename) {
                if (!masterArchive.has(id)) {
                  masterArchive.set(id, item);
                }
                const itType = item.type || type;
                if (itType === 'video' && !videoDatabase.has(id)) videoDatabase.set(id, item);
                else if (itType === 'audio' && !audioDatabase.has(id)) audioDatabase.set(id, item);
                else if (!imageDatabase.has(id)) imageDatabase.set(id, item);
                totalLoaded++;
              }
            });
          }
        } catch (mErr) {}
      } catch (bucketErr) {
        // Individual bucket error is non-fatal
      }
    }

    // D. Also check if media table exists in Supabase DB
    try {
      const { data: rows } = await client.from('media').select('*');
      if (Array.isArray(rows)) {
        rows.forEach(row => {
          const id = String(row.id);
          let type = String(row.type || '').toLowerCase();
          if (!['image', 'video', 'audio'].includes(type)) {
            type = inferMediaType(row.name, row.filename, row.url);
          }
          const item = {
            id,
            name: String(row.name || id),
            url: row.url || '',
            filename: row.filename || `${id}.${type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg'}`,
            type,
            uploadedAt: row.uploaded_at || new Date().toISOString(),
            size: Number(row.size) || 0
          };
          if (!masterArchive.has(id)) masterArchive.set(id, item);
          if (type === 'video') videoDatabase.set(id, item);
          else if (type === 'audio') audioDatabase.set(id, item);
          else imageDatabase.set(id, item);
          totalLoaded++;
        });
      }
    } catch (e) {}

    // E. Synchronize from local Master Archive so offline-persisted media is always active
    masterArchive.forEach((item, id) => {
      if (item && item.filename) {
        const type = item.type || 'image';
        if (type === 'video' && !videoDatabase.has(id)) videoDatabase.set(id, item);
        else if (type === 'audio' && !audioDatabase.has(id)) audioDatabase.set(id, item);
        else if (!imageDatabase.has(id)) imageDatabase.set(id, item);
        totalLoaded++;
      }
    });

    saveMasterArchive();
    saveImageIndex();
    saveVideoIndex();
    saveAudioIndex();
    lastRemoteIndexesFetchTime = Date.now();
    if (totalLoaded > 0) {
      console.log(`[Supabase] Loaded ${totalLoaded} media records from Supabase & Master Archive`);
    }
  } catch (error) {
    console.warn('[Supabase] Could not load media indexes:', error.message);
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
  // Scan local imagesDir and public/assets/aistudio for any disk files
  try {
    if (fs.existsSync(imagesDir)) {
      const diskFiles = fs.readdirSync(imagesDir);
      const existingFilenames = new Set(Array.from(imageDatabase.values()).map(img => img.filename));
      diskFiles.forEach(file => {
        if (file === 'index.json' || existingFilenames.has(file)) return;
        const filePath = path.join(imagesDir, file);
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) return;
        const imageId = createImageId();
        const item = {
          id: imageId,
          name: file,
          url: `/images/${encodeURIComponent(file)}`,
          filename: file,
          type: 'image',
          uploadedAt: stats.mtime.toISOString(),
          size: stats.size
        };
        imageDatabase.set(imageId, item);
        existingFilenames.add(file);
      });
      saveImageIndex();
    }
  } catch (err) {
    console.warn('Could not scan imagesDir:', err.message);
  }

  // Scan public/assets/aistudio images
  try {
    const assetsDir = path.join(__dirname, 'public', 'assets', 'aistudio');
    if (fs.existsSync(assetsDir)) {
      const diskFiles = fs.readdirSync(assetsDir);
      const existingFilenames = new Set(Array.from(imageDatabase.values()).map(img => img.filename));
      diskFiles.forEach(file => {
        if (existingFilenames.has(file)) return;
        const filePath = path.join(assetsDir, file);
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) return;
        const imageId = createImageId();
        const item = {
          id: imageId,
          name: file.replace(/_[a-f0-9]+\.jpg$/i, '').replace(/_/g, ' '),
          url: `/assets/aistudio/${encodeURIComponent(file)}`,
          filename: file,
          type: 'image',
          uploadedAt: stats.mtime.toISOString(),
          size: stats.size
        };
        imageDatabase.set(imageId, item);
        existingFilenames.add(file);
      });
      saveImageIndex();
    }
  } catch (err) {}
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
  const client = getOrCreateSupabase();
  if (!client) {
    remoteScoresLoaded = true;
    return;
  }
  try {
    // 1. Try Supabase database table `scores`
    const { data: rows, error } = await client.from('scores').select('*');
    if (!error && Array.isArray(rows) && rows.length > 0) {
      rows.forEach(data => {
        const playerId = data.player_id || data.playerId;
        if (!playerId) return;
        const formatted = {
          playerId,
          name: data.name,
          roomId: data.room_id || data.roomId || 'unknown',
          score: Number(data.score) || 0,
          cash: Number(data.cash) || 0,
          clearedLevel: Number(data.cleared_level || data.clearedLevel) || 0,
          eliminated: Boolean(data.eliminated),
          updatedAt: data.updated_at || data.updatedAt || new Date().toISOString()
        };
        const existingIdx = scoreDatabase.findIndex((e) => e.playerId === playerId && e.roomId === formatted.roomId);
        if (existingIdx >= 0) {
          scoreDatabase[existingIdx] = { ...scoreDatabase[existingIdx], ...formatted };
        } else {
          scoreDatabase.push(formatted);
        }
      });
      scoreDatabase.sort((a, b) => Number(b.score) - Number(a.score));
      saveScoreDatabase();
      console.log(`[Supabase] Loaded ${rows.length} scores from Supabase table`);
    } else {
      // 2. Fallback: try scores.json in Supabase storage
      try {
        const { data: scoreBlob } = await client.storage.from('images').download('scores.json');
        if (scoreBlob) {
          const text = await scoreBlob.text();
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            parsed.forEach(entry => {
              if (entry && entry.playerId) {
                const existingIdx = scoreDatabase.findIndex((e) => e.playerId === entry.playerId && e.roomId === entry.roomId);
                if (existingIdx >= 0) scoreDatabase[existingIdx] = { ...scoreDatabase[existingIdx], ...entry };
                else scoreDatabase.push(entry);
              }
            });
            scoreDatabase.sort((a, b) => Number(b.score) - Number(a.score));
            saveScoreDatabase();
          }
        }
      } catch (storageScoreErr) {}
    }
  } catch (error) {
    console.warn('[Supabase] Could not load scores from Supabase:', error.message);
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

  const client = getOrCreateSupabase();
  if (client) {
    // Upsert into Supabase table if available
    client.from('scores').upsert({
      player_id: playerId,
      name: snapshot.name,
      room_id: snapshot.roomId,
      score: snapshot.score,
      cash: snapshot.cash,
      cleared_level: snapshot.clearedLevel,
      eliminated: snapshot.eliminated,
      updated_at: snapshot.updatedAt
    }, { onConflict: 'player_id' }).catch(() => {});

    // Also persist scores.json in Supabase Storage
    client.storage.from('images').upload('scores.json', Buffer.from(JSON.stringify(scoreDatabase, null, 2)), {
      contentType: 'application/json',
      upsert: true
    }).catch(() => {});
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

  const client = getOrCreateSupabase();
  if (client) {
    client.from('scores').delete().eq('player_id', playerId).catch(() => {});
    client.storage.from('images').upload('scores.json', Buffer.from(JSON.stringify(scoreDatabase, null, 2)), {
      contentType: 'application/json',
      upsert: true
    }).catch(() => {});
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
        console.warn(`[Supabase] Image remote save notice for ${imageId}:`, err.message);
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
    deleteRemoteMedia(imageId).catch(err => console.warn(`[Supabase] Image delete background notice:`, err.message));
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
      // Persist to Supabase in background so large video chunks do not delay or time out the client HTTP upload
      saveRemoteMedia(videoId, mediaItem, path.join(videosDir, file.filename)).catch(remoteErr => {
        console.warn(`[Supabase] Video remote save notice for ${videoId}:`, remoteErr.message);
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
    deleteRemoteMedia(req.params.videoId).catch(err => console.warn(`[Supabase] Video delete background notice:`, err.message));
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
        console.warn(`[Supabase] Audio remote save notice for ${audioId}:`, err.message);
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
    deleteRemoteMedia(req.params.audioId).catch(err => console.warn(`[Supabase] Audio delete background notice:`, err.message));
    res.json({ success: true, message: 'Audio deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete audio file' });
  }
});

// Explicit media sync endpoint from Supabase
app.all(['/api/media/sync', '/api/media/refresh'], async (req, res) => {
  try {
    await loadRemoteIndexes(true);
    autoRehydrateAllMedia().catch(() => {});
    res.json({
      success: true,
      message: 'Synced successfully with Supabase Storage & Master Archive',
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

// Restore ALL historical saved media from Master Archive & Cloud Storage
app.all('/api/media/restore-all', async (req, res) => {
  try {
    // 1. Reload from disk archive and cloud
    loadMasterArchive();
    await loadRemoteIndexes(true);

    // 2. Un-archive every historical media record so it reappears in active library
    let restoredCount = 0;
    masterArchive.forEach((item, id) => {
      if (item && item.filename) {
        item.archived = false;
        const type = item.type || 'image';
        if (type === 'video') videoDatabase.set(id, item);
        else if (type === 'audio') audioDatabase.set(id, item);
        else imageDatabase.set(id, item);
        restoredCount++;
      }
    });

    saveMasterArchive();
    saveImageIndex();
    saveVideoIndex();
    saveAudioIndex();

    // 3. Proactively rehydrate files to disk
    await autoRehydrateAllMedia();

    res.json({
      success: true,
      message: `Restored ${restoredCount} media files from indestructible master archive & Supabase!`,
      counts: {
        images: imageDatabase.size,
        videos: videoDatabase.size,
        audios: audioDatabase.size,
        totalArchived: masterArchive.size
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List permanent master archive records
app.get('/api/media/archive/list', (req, res) => {
  res.json({
    total: masterArchive.size,
    items: Array.from(masterArchive.values()).map(item => ({
      id: item.id,
      name: item.name,
      filename: item.filename,
      type: item.type,
      size: item.size,
      uploadedAt: item.uploadedAt,
      url: item.url,
      hasOfflineBackup: Boolean(item.base64)
    }))
  });
});

// Full Media Backup Export: Downloadable JSON containing all media and base64
app.get('/api/media/export-all', async (req, res) => {
  try {
    loadMasterArchive();
    const exportData = {
      app: 'Kaun Banega Hazarpati',
      exportedAt: new Date().toISOString(),
      counts: {
        images: imageDatabase.size,
        videos: videoDatabase.size,
        audios: audioDatabase.size,
        masterArchive: masterArchive.size
      },
      images: Array.from(imageDatabase.values()),
      videos: Array.from(videoDatabase.values()),
      audios: Array.from(audioDatabase.values()),
      masterArchive: Array.from(masterArchive.values())
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="kbh-all-media-backup.json"');
    res.send(JSON.stringify(exportData, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full Media Backup Import: Restore all media from a JSON backup file
app.post('/api/media/import-all', express.json({ limit: '500mb' }), async (req, res) => {
  try {
    const data = req.body;
    if (!data || (!data.images && !data.videos && !data.audios && !data.masterArchive)) {
      return res.status(400).json({ error: 'Invalid backup file format' });
    }
    let restoredCount = 0;
    if (Array.isArray(data.masterArchive)) {
      data.masterArchive.forEach(item => {
        if (item && (item.id || item.filename)) {
          const id = item.id || `archive-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          item.archived = false;
          masterArchive.set(id, item);
          const type = item.type || 'image';
          if (type === 'video') videoDatabase.set(id, item);
          else if (type === 'audio') audioDatabase.set(id, item);
          else imageDatabase.set(id, item);
          restoredCount++;
        }
      });
    }
    if (Array.isArray(data.images)) {
      data.images.forEach(img => {
        if (img && img.id) {
          imageDatabase.set(img.id, img);
          masterArchive.set(img.id, { ...img, type: 'image', archived: false });
          restoredCount++;
        }
      });
    }
    if (Array.isArray(data.videos)) {
      data.videos.forEach(vid => {
        if (vid && vid.id) {
          videoDatabase.set(vid.id, vid);
          masterArchive.set(vid.id, { ...vid, type: 'video', archived: false });
          restoredCount++;
        }
      });
    }
    if (Array.isArray(data.audios)) {
      data.audios.forEach(aud => {
        if (aud && aud.id) {
          audioDatabase.set(aud.id, aud);
          masterArchive.set(aud.id, { ...aud, type: 'audio', archived: false });
          restoredCount++;
        }
      });
    }

    saveMasterArchive();
    saveImageIndex();
    saveVideoIndex();
    saveAudioIndex();
    await autoRehydrateAllMedia();

    res.json({
      success: true,
      message: `Safaltapurvak ${restoredCount} media items restore ho gaye!`,
      counts: {
        images: imageDatabase.size,
        videos: videoDatabase.size,
        audios: audioDatabase.size,
        masterArchive: masterArchive.size
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add media via URL or Supabase Storage URL
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

    res.json({ success: true, message: `${mediaType} added successfully to library and Supabase`, media: mediaItem });
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
    <text x="50%" y="60%" text-anchor="middle" fill="#9ec5e8" font-family="sans-serif" font-size="14">Persisted media record from Supabase</text>
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
  // Asynchronously load remote indexes, scores, and auto-rehydrate all media to disk
  Promise.all([
    Promise.race([loadRemoteIndexes(), new Promise(r => setTimeout(r, 4000))]),
    Promise.race([loadRemoteScores(), new Promise(r => setTimeout(r, 4000))])
  ]).then(() => {
    autoRehydrateAllMedia().catch(() => {});
  }).catch(error => {
    console.warn('[Supabase] Non-blocking initial sync notice:', error?.message || error);
  });

  // Background check every 10 minutes to guarantee all media files remain permanently on disk
  setInterval(() => {
    autoRehydrateAllMedia().catch(() => {});
  }, 10 * 60 * 1000);
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
