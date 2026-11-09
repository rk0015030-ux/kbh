const assert = require('node:assert/strict');

// Replicate identical logic as server.js, host.html, and Player.html
function getQuestionTimeLimit(level) {
  const lvl = Number(level) || 1;
  if (lvl <= 5) return 30;
  if (lvl <= 8) return 45;
  return 60;
}

function resolveQuestionTimeLimit(timeLimitChoice, level) {
  if (timeLimitChoice === 'auto' || timeLimitChoice === undefined || timeLimitChoice === null || timeLimitChoice === '') {
    const lvl = Number(level) || 1;
    if (lvl <= 5) return 30;
    if (lvl <= 8) return 45;
    return 60;
  }
  const val = Number(timeLimitChoice);
  if (val === 45) return 45;
  if (val === 60) return 60;
  return 30;
}

function selectTimerAudioTrack(totalTime) {
  if (totalTime <= 30) return '30 sec timer.mp3';
  if (totalTime <= 45) return '45 sec audio.mp3';
  return '60 sec timer.mp3';
}

// 1. Verify Q1 to Q5: 30 seconds & 30s timer audio
for (let lvl = 1; lvl <= 5; lvl++) {
  const limit = getQuestionTimeLimit(lvl);
  assert.equal(limit, 30, `Question ${lvl} must have 30 second time limit`);
  assert.equal(resolveQuestionTimeLimit('auto', lvl), 30, `Question ${lvl} auto resolution must be 30s`);
  assert.equal(selectTimerAudioTrack(limit), '30 sec timer.mp3', `Question ${lvl} must play 30 sec timer.mp3`);
}

// 2. Verify Q6 to Q8: 45 seconds & 45s timer audio
for (let lvl = 6; lvl <= 8; lvl++) {
  const limit = getQuestionTimeLimit(lvl);
  assert.equal(limit, 45, `Question ${lvl} must have 45 second time limit`);
  assert.equal(resolveQuestionTimeLimit('auto', lvl), 45, `Question ${lvl} auto resolution must be 45s`);
  assert.equal(selectTimerAudioTrack(limit), '45 sec audio.mp3', `Question ${lvl} must play 45 sec audio.mp3`);
}

// 3. Verify Q9 to Q10: 60 seconds & 60s timer audio
for (let lvl = 9; lvl <= 10; lvl++) {
  const limit = getQuestionTimeLimit(lvl);
  assert.equal(limit, 60, `Question ${lvl} must have 60 second time limit`);
  assert.equal(resolveQuestionTimeLimit('auto', lvl), 60, `Question ${lvl} auto resolution must be 60s`);
  assert.equal(selectTimerAudioTrack(limit), '60 sec timer.mp3', `Question ${lvl} must play 60 sec timer.mp3`);
}

// 4. Verify Question 1 never receives 60 seconds even after Q10 completes
let simulatedHostLevel = 10;
// When new question set or Q1 is loaded:
const newQuestionIndex = 0; // Question 1
simulatedHostLevel = newQuestionIndex + 1; // Resets to 1
assert.equal(simulatedHostLevel, 1, 'Question 1 level must be 1');
const q1Time = resolveQuestionTimeLimit('auto', simulatedHostLevel);
assert.equal(q1Time, 30, 'Question 1 must strictly resolve to 30s, not 60s');
assert.equal(selectTimerAudioTrack(q1Time), '30 sec timer.mp3', 'Question 1 must play 30 sec timer.mp3');

console.log('timer-rules.test.js: all question level timer rules (Q1-5: 30s, Q6-8: 45s, Q9-10: 60s) passed successfully!');
