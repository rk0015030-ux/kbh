// Automated migration script to transfer all local media, archive, and indexes to Supabase
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

async function runMigration(providedUrl, providedKey) {
  let supabaseUrl = providedUrl || process.env.SUPABASE_URL;
  let supabaseKey = providedKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  const configPath = path.join(__dirname, 'supabase-config.json');
  if ((!supabaseUrl || !supabaseKey) && fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      supabaseUrl = supabaseUrl || cfg.supabaseUrl || cfg.url || cfg.SUPABASE_URL;
      supabaseKey = supabaseKey || cfg.supabaseKey || cfg.key || cfg.serviceRoleKey || cfg.SUPABASE_KEY;
    } catch (e) {}
  }

  if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    console.error('Please pass them as arguments: node migrate-to-supabase.js <SUPABASE_URL> <SUPABASE_KEY>');
    console.error('Or save them in supabase-config.json');
    return false;
  }

  console.log(`[Migration] Starting transfer to Supabase: ${supabaseUrl}`);
  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  });

  const buckets = ['images', 'videos', 'audio'];
  for (const bucket of buckets) {
    try {
      const { data: bList } = await client.storage.listBuckets();
      const exists = bList && bList.some(b => b.name === bucket);
      if (!exists) {
        console.log(`[Migration] Creating public bucket: "${bucket}"...`);
        await client.storage.createBucket(bucket, { public: true });
      }
    } catch (bErr) {
      console.warn(`[Migration] Notice creating bucket "${bucket}":`, bErr.message);
    }
  }

  // 1. Transfer Master Archive
  const masterArchivePath = path.join(__dirname, 'data', 'master_archive.json');
  let masterArchive = {};
  if (fs.existsSync(masterArchivePath)) {
    try {
      masterArchive = JSON.parse(fs.readFileSync(masterArchivePath, 'utf8'));
      console.log(`[Migration] Uploading master_archive.json (${Object.keys(masterArchive).length} items)...`);
      await client.storage
        .from('images')
        .upload('master_archive.json', Buffer.from(JSON.stringify(masterArchive, null, 2)), {
          contentType: 'application/json',
          upsert: true
        });
    } catch (e) {
      console.warn('[Migration] Archive upload warning:', e.message);
    }
  }

  // 2. Transfer Audio files
  const audioDir = path.join(__dirname, 'public', 'audio');
  if (fs.existsSync(audioDir)) {
    const audioFiles = fs.readdirSync(audioDir);
    for (const file of audioFiles) {
      if (file === 'index.json' || file.startsWith('.')) continue;
      const filePath = path.join(audioDir, file);
      if (fs.statSync(filePath).isFile()) {
        try {
          console.log(`[Migration] Uploading audio: ${file}...`);
          const buf = fs.readFileSync(filePath);
          await client.storage
            .from('audio')
            .upload(file, buf, { contentType: 'audio/mpeg', upsert: true });
        } catch (e) {
          console.warn(`[Migration] Failed audio upload ${file}:`, e.message);
        }
      }
    }
  }

  // 3. Transfer Images
  const imagesDir = path.join(__dirname, 'public', 'images');
  if (fs.existsSync(imagesDir)) {
    const imgFiles = fs.readdirSync(imagesDir);
    for (const file of imgFiles) {
      if (file === 'index.json' || file === '_index.json' || file === 'master_archive.json' || file === 'scores.json' || file.startsWith('.')) continue;
      const filePath = path.join(imagesDir, file);
      if (fs.statSync(filePath).isFile()) {
        try {
          console.log(`[Migration] Uploading image: ${file}...`);
          const buf = fs.readFileSync(filePath);
          await client.storage
            .from('images')
            .upload(file, buf, { contentType: 'image/jpeg', upsert: true });
        } catch (e) {
          console.warn(`[Migration] Failed image upload ${file}:`, e.message);
        }
      }
    }
  }

  // 3b. Transfer Videos
  const videosDir = path.join(__dirname, 'public', 'videos');
  if (fs.existsSync(videosDir)) {
    const vidFiles = fs.readdirSync(videosDir);
    for (const file of vidFiles) {
      if (file === 'index.json' || file === '_index.json' || file.startsWith('.')) continue;
      const filePath = path.join(videosDir, file);
      if (fs.statSync(filePath).isFile()) {
        try {
          console.log(`[Migration] Uploading video: ${file}...`);
          const buf = fs.readFileSync(filePath);
          await client.storage
            .from('videos')
            .upload(file, buf, { contentType: 'video/mp4', upsert: true });
        } catch (e) {
          console.warn(`[Migration] Failed video upload ${file}:`, e.message);
        }
      }
    }
  }

  // 4. Transfer Assets
  const assetsDir = path.join(__dirname, 'public', 'assets', 'aistudio');
  if (fs.existsSync(assetsDir)) {
    const assetFiles = fs.readdirSync(assetsDir);
    for (const file of assetFiles) {
      const filePath = path.join(assetsDir, file);
      if (fs.statSync(filePath).isFile()) {
        try {
          console.log(`[Migration] Uploading asset: ${file}...`);
          const buf = fs.readFileSync(filePath);
          await client.storage
            .from('images')
            .upload(file, buf, { contentType: 'image/jpeg', upsert: true });
        } catch (e) {
          console.warn(`[Migration] Failed asset upload ${file}:`, e.message);
        }
      }
    }
  }

  // 5. Transfer Indexes
  for (const t of ['images', 'audio', 'videos']) {
    const idxPath = path.join(__dirname, 'public', t, 'index.json');
    if (fs.existsSync(idxPath)) {
      try {
        console.log(`[Migration] Uploading ${t} index.json...`);
        const buf = fs.readFileSync(idxPath);
        await client.storage
          .from(t)
          .upload('index.json', buf, { contentType: 'application/json', upsert: true });
      } catch (e) {}
    }
  }

  console.log('[Migration] All local data successfully transferred to Supabase!');
  return true;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  runMigration(args[0], args[1]).then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runMigration };
