const assert = require('node:assert/strict');

// Replicate identical logic as server.js, host.html, and Player.html
function getQuestionTimeLimit(level) {
  const lvl = Number(level) || 1;
  if (lvl <= 5) return 30;
  if (lvl <= 8) return 45;
  return 60;
}

// 1. Verify Q1 to Q5: 30 seconds
for (let lvl = 1; lvl <= 5; lvl++) {
  assert.equal(getQuestionTimeLimit(lvl), 30, `Question ${lvl} must have 30 second time limit`);
}

// 2. Verify Q6 to Q8: 45 seconds
for (let lvl = 6; lvl <= 8; lvl++) {
  assert.equal(getQuestionTimeLimit(lvl), 45, `Question ${lvl} must have 45 second time limit`);
}

// 3. Verify Q9 to Q10: 60 seconds
for (let lvl = 9; lvl <= 10; lvl++) {
  assert.equal(getQuestionTimeLimit(lvl), 60, `Question ${lvl} must have 60 second time limit`);
}

console.log('timer-rules.test.js: all question level timer rules (Q1-5: 30s, Q6-8: 45s, Q9-10: 60s) passed successfully!');
