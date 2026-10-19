const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const port = 8092;
const url = `ws://127.0.0.1:${port}`;
const roomId = `submit-test-${Date.now()}`;
const serverProcess = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      fetch(`http://127.0.0.1:${port}/`)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - started >= 10000) return reject(new Error('Test server did not start'));
          setTimeout(check, 25);
        });
    };
    serverProcess.once('error', reject);
    check();
  });
}

function connect(role) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages = [];
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'join',
        payload: { role, roomId, name: `${role}-test` }
      }));
    });
    socket.on('message', data => {
      const message = JSON.parse(data);
      messages.push(message);
      if (message.type === 'joined') resolve({ socket, messages, playerId: message.payload.playerId || null });
    });
    socket.on('error', reject);
  });
}

function waitFor(messages, type, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const message = messages.find(item => item.type === type);
      if (message) return resolve(message);
      if (Date.now() - started >= timeout) return reject(new Error(`Timed out waiting for ${type}`));
      setTimeout(check, 10);
    };
    check();
  });
}

function waitForConnectionStatus(messages, expected, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const statuses = messages.filter(message => message.type === 'connection_status');
      const latest = statuses[statuses.length - 1];
      if (latest && latest.payload.host === expected.host && latest.payload.player === expected.player) return resolve(latest);
      if (Date.now() - started >= timeout) return reject(new Error('Timed out waiting for connection status'));
      setTimeout(check, 10);
    };
    check();
  });
}

async function sendQuestion(host, player, payload) {
  const playerCount = player.messages.filter(message => message.type === 'question').length;
  const hostAckCount = host.messages.filter(message => message.type === 'question_sent').length;
  host.socket.send(JSON.stringify({ type: 'send_question', payload }));
  const question = await new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const next = player.messages.filter(message => message.type === 'question')[playerCount];
      if (next) return resolve(next);
      if (Date.now() - started >= 2000) return reject(new Error('Player did not receive question'));
      setTimeout(check, 10);
    };
    check();
  });
  const acknowledgement = await new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const next = host.messages.filter(message => message.type === 'question_sent')[hostAckCount];
      if (next) return resolve(next);
      if (Date.now() - started >= 2000) return reject(new Error('Host did not receive question_sent acknowledgement'));
      setTimeout(check, 10);
    };
    check();
  });
  assert.equal(question.payload.text, payload.text);
  assert.equal(question.payload.videoId || null, payload.videoId || null);
  assert.equal(question.payload.audioId || null, payload.audioId || null);
  assert.equal(acknowledgement.payload.text, payload.text);
  return question;
}

(async () => {
  await waitForServer();
  const hostPageResponse = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(hostPageResponse.status, 200);
  assert.match(await hostPageResponse.text(), /Quiz Host/);
  const playerPageResponse = await fetch(`http://127.0.0.1:${port}/player`);
  assert.equal(playerPageResponse.status, 200);
  assert.match(await playerPageResponse.text(), /Player/);

  const invalidAudioForm = new FormData();
  invalidAudioForm.append('audios', new Blob([Buffer.from('not audio')], { type: 'text/plain' }), 'invalid-audio.txt');
  const invalidAudioResponse = await fetch(`http://127.0.0.1:${port}/api/audio/upload`, { method: 'POST', body: invalidAudioForm });
  const invalidAudioData = await invalidAudioResponse.json();
  assert.equal(invalidAudioResponse.status, 400);
  assert.match(invalidAudioData.error, /Invalid file type/);

  const audioForm = new FormData();
  audioForm.append('audios', new Blob([Buffer.from('audio test fixture')], { type: 'audio/mpeg' }), 'submit-flow-test.mp3');
  const audioUploadResponse = await fetch(`http://127.0.0.1:${port}/api/audio/upload`, { method: 'POST', body: audioForm });
  const audioUploadData = await audioUploadResponse.json();
  assert.equal(audioUploadResponse.status, 200);
  const uploadedAudio = audioUploadData.audios[0];
  assert.ok(uploadedAudio.audioId);
  const audioListResponse = await fetch(`http://127.0.0.1:${port}/api/audio/list`);
  const audioListData = await audioListResponse.json();
  assert.ok(audioListData.audios.some(audio => audio.audioId === uploadedAudio.audioId));
  const audioFileResponse = await fetch(`http://127.0.0.1:${port}${uploadedAudio.url}`);
  assert.equal(audioFileResponse.status, 200);
  const audioDeleteResponse = await fetch(`http://127.0.0.1:${port}/api/audio/${uploadedAudio.audioId}`, { method: 'DELETE' });
  assert.equal(audioDeleteResponse.status, 200);

  const [host, player] = await Promise.all([connect('host'), connect('player')]);
  await Promise.all([
    waitForConnectionStatus(host.messages, { host: true, player: true }),
    waitForConnectionStatus(player.messages, { host: true, player: true })
  ]);
  const base = { metadata: { options: ['A', 'B', 'C', 'D'], correct: 'A' }, timeLimitSec: 30 };

  await sendQuestion(host, player, { ...base, format: 'text', text: 'Normal question exactly as entered' });
  await sendQuestion(host, player, { ...base, format: 'image', text: 'Image question', dataUrl: '/images/example.jpg', imageId: 'image-1' });
  await sendQuestion(host, player, { ...base, format: 'text', text: 'Video question', videoId: 'video-1' });

  host.socket.send(JSON.stringify({ type: 'audio_preview', payload: { url: '/audio/audio-1.mp3', audioId: 'audio-1' } }));
  await waitFor(player.messages, 'audio_preview');
  player.socket.send(JSON.stringify({ type: 'audio_ended', payload: { audioId: 'audio-1' } }));
  await waitFor(host.messages, 'audio_ended');
  await sendQuestion(host, player, { ...base, format: 'text', text: 'Audio question', audioId: 'audio-1' });

  host.socket.send(JSON.stringify({ type: 'video_preview', payload: { url: '/videos/video-1.mp4', videoId: 'video-2' } }));
  await waitFor(player.messages, 'video_preview');
  await sendQuestion(host, player, { ...base, format: 'text', text: 'Question after video playback', videoId: 'video-2' });
  await sendQuestion(host, player, { ...base, format: 'text', text: 'Second video question', videoId: 'video-3' });

  const scorePayload = { roomId, playerId: player.playerId, name: 'player-test', score: 2500, cash: 2500, clearedLevel: 8 };
  host.socket.send(JSON.stringify({ type: 'score_update', payload: { playerId: player.playerId, cash: scorePayload.cash } }));
  await waitFor(player.messages, 'scoreboard');

  const scoresResponse = await fetch(`http://127.0.0.1:${port}/api/scores`);
  const scoresData = await scoresResponse.json();
  assert.equal(scoresResponse.status, 200);
  const savedScore = scoresData.scores.find(entry => entry.playerId === player.playerId && entry.score === scorePayload.score);
  assert.ok(savedScore, 'Expected player score to be persisted to the score database');

  host.socket.send(JSON.stringify({ type: 'host_select_answer', payload: { answer: 'B' } }));
  await waitFor(host.messages, 'host_answer_selected');
  host.socket.send(JSON.stringify({ type: 'host_lock_answer', payload: { playerId: player.playerId } }));
  await waitFor(host.messages, 'answer_locked');
  host.socket.send(JSON.stringify({ type: 'host_mark_result', payload: {} }));
  const wrongResult = await waitFor(host.messages, 'answer_result');
  assert.equal(wrongResult.payload.result, 'wrong');

  const eliminatedScoresResponse = await fetch(`http://127.0.0.1:${port}/api/scores`);
  const eliminatedScoresData = await eliminatedScoresResponse.json();
  const eliminatedScore = eliminatedScoresData.scores.find(entry => entry.playerId === player.playerId);
  assert.equal(eliminatedScore.eliminated, true);

  host.socket.close();
  await waitForConnectionStatus(player.messages, { host: false, player: true });
  player.socket.close();
  serverProcess.kill();
  console.log('submit-flow.test.js: all submit-flow cases passed');
})().catch(error => {
  serverProcess.kill();
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
