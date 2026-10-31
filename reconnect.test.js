const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const port = 8094;
const url = `ws://127.0.0.1:${port}`;
const roomId = `reconnect-test-${Date.now()}`;
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

function connect(role, name, playerId = null) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages = [];
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'join',
        payload: { role, roomId, name: name || `${role}-test`, playerId }
      }));
    });
    socket.on('message', data => {
      const message = JSON.parse(data);
      messages.push(message);
      if (message.type === 'joined') resolve({ socket, messages, playerId: message.payload.playerId || null, reconnected: Boolean(message.payload.reconnected) });
    });
    socket.on('error', reject);
  });
}

function waitFor(messages, predicateOrType, timeout = 2500) {
  const predicate = typeof predicateOrType === 'string' ? msg => msg.type === predicateOrType : predicateOrType;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const message = messages.find(predicate);
      if (message) return resolve(message);
      if (Date.now() - started >= timeout) return reject(new Error(`Timed out waiting for message`));
      setTimeout(check, 10);
    };
    check();
  });
}

(async () => {
  await waitForServer();

  // 1. Host and Player connect
  const host = await connect('host', 'Host-1');
  const player1 = await connect('player', 'TestPlayer');
  assert.ok(player1.playerId, 'Player must have a playerId');
  assert.equal(player1.reconnected, false);

  // 2. Host sends Question 1
  host.socket.send(JSON.stringify({
    type: 'send_question',
    payload: {
      format: 'text',
      text: 'What is the capital of India?',
      metadata: { options: ['Mumbai', 'New Delhi', 'Kolkata', 'Chennai'], correct: 'B' }
    }
  }));

  const q1 = await waitFor(player1.messages, 'question');
  assert.equal(q1.payload.text, 'What is the capital of India?');

  // 3. Host selects and locks B, marks correct
  host.socket.send(JSON.stringify({ type: 'host_select_answer', payload: { answer: 'B' } }));
  await waitFor(host.messages, 'host_answer_selected');
  host.socket.send(JSON.stringify({ type: 'host_lock_answer', payload: { playerId: player1.playerId } }));
  await waitFor(host.messages, 'answer_locked');
  host.socket.send(JSON.stringify({ type: 'host_mark_result', payload: {} }));
  const resultMsg = await waitFor(player1.messages, 'answer_result');
  assert.equal(resultMsg.payload.result, 'correct');
  assert.equal(resultMsg.payload.cash, 100);

  // 4. Host sends Question 2 (Money ladder is now on Q2, ₹100 won)
  host.socket.send(JSON.stringify({
    type: 'send_question',
    payload: {
      format: 'text',
      text: 'Which planet is known as the Red Planet?',
      metadata: { options: ['Mars', 'Venus', 'Jupiter', 'Saturn'], correct: 'A' }
    }
  }));
  const q2 = await waitFor(player1.messages, m => m.type === 'question' && m.payload.text === 'Which planet is known as the Red Planet?');
  assert.equal(q2.payload.text, 'Which planet is known as the Red Planet?');

  // 5. Player gets disconnected due to poor connection
  player1.socket.close();
  await new Promise(r => setTimeout(r, 200));

  // 6. Player clicks JOIN / RECONNECT with the same session / name
  const playerReconnect = await connect('player', 'TestPlayer', player1.playerId);
  assert.equal(playerReconnect.reconnected, true, 'Player should be recognized as reconnected');
  assert.equal(playerReconnect.playerId, player1.playerId, 'Player should retain the same playerId');

  // 7. Verify sync_state was received with exact cash won and cleared level
  const syncMsg = await waitFor(playerReconnect.messages, 'sync_state');
  assert.equal(syncMsg.payload.cash, 100, 'Reconnected player must retain their cash won (₹100)');
  assert.equal(syncMsg.payload.clearedLevel, 1, 'Reconnected player must retain cleared level');

  // 8. Verify active question was re-delivered upon reconnecting
  const q2Restored = await waitFor(playerReconnect.messages, 'question');
  assert.equal(q2Restored.payload.text, 'Which planet is known as the Red Planet?', 'Active question must be restored on reconnect');

  // 9. Host receives player_reconnected notification
  const hostReconnectedMsg = await waitFor(host.messages, 'player_reconnected');
  assert.equal(hostReconnectedMsg.payload.playerId, player1.playerId);
  assert.equal(hostReconnectedMsg.payload.cash, 100);

  playerReconnect.socket.close();
  host.socket.close();
  serverProcess.kill();
  console.log('reconnect.test.js: all player reconnection and state recovery cases passed successfully!');
})().catch(err => {
  serverProcess.kill();
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
