const assert = require('assert');
const fs = require('fs');

// Extract actual implementation from host.html
const hostHtml = fs.readFileSync(__dirname + '/host.html', 'utf8');
const fn1 = hostHtml.match(/function fixDevanagariMatras[\s\S]*?\n  \}/)[0];
const fn2 = hostHtml.match(/function parsePdfQuestions[\s\S]*?\n  \}/)[0];

eval(fn1);
eval(fn2);

console.log('Running question-parser tests against host.html implementation...');

// Case 1: Question statement containing 'उत्तर प्रदेश' and answer is 'B'
const test1 = `
Q1. उत्तर प्रदेश की राजधानी कौन सी है?
A. कानपुर
B. लखनऊ
C. वाराणसी
D. प्रयागराज
उत्तर: B
`;
const q1 = parsePdfQuestions(test1);
assert.strictEqual(q1.length, 1);
assert.strictEqual(q1[0].correct, 'B', 'Case 1: Answer B must be recognized, not overridden by "उत्तर प्रदेश"');
assert.strictEqual(q1[0].options[1], 'लखनऊ');
assert.strictEqual(q1[0].options[3], 'प्रयागराज', 'Option D must not contain the answer line');

// Case 2: Hindi option characters 'क', 'ख', 'ग', 'घ' and answer 'उत्तर: विकल्प (ग)'
const test2 = `
प्रश्न 2: भारत का राष्ट्रीय खेल कौन सा है?
(क) क्रिकेट
(ख) फुटबॉल
(ग) हॉकी
(घ) कबड्डी
उत्तर: विकल्प (ग)
`;
const q2 = parsePdfQuestions(test2);
assert.strictEqual(q2.length, 1);
assert.strictEqual(q2[0].correct, 'C', 'Case 2: विकल्प (ग) must map to C');
assert.strictEqual(q2[0].options[2], 'हॉकी');

// Case 3: Devanagari numerals for options: १, २, ३, ४ and answer 'Ans - 2'
const test3 = `
3. सौरमंडल का सबसे बड़ा ग्रह कौन सा है?
१. पृथ्वी
२. बृहस्पति
३. मंगल
४. शुक्र
Ans - 2
`;
const q3 = parsePdfQuestions(test3);
assert.strictEqual(q3.length, 1);
assert.strictEqual(q3[0].correct, 'B', 'Case 3: Ans - 2 must map to B');
assert.strictEqual(q3[0].options[1], 'बृहस्पति');

// Case 4: Answer specified by full text instead of letter: 'उत्तर: पेरिस'
const test4 = `
Q4) फ्रांस की राजधानी कहाँ है?
A) बर्लिन
B) रोम
C) पेरिस
D) मैड्रिड
उत्तर: पेरिस
`;
const q4 = parsePdfQuestions(test4);
assert.strictEqual(q4.length, 1);
assert.strictEqual(q4[0].correct, 'C', 'Case 4: Text answer पेरिस must resolve to C');

// Case 5: Answer line followed by explanation line
const test5 = `
Q5. जल का रासायनिक सूत्र क्या है?
A. CO2
B. NaCl
C. H2O
D. CH4
Answer: C
`;
const q5 = parsePdfQuestions(test5);
assert.strictEqual(q5.length, 1);
assert.strictEqual(q5[0].correct, 'C', 'Case 5: Answer C should be found');
assert.strictEqual(q5[0].options[3], 'CH4', 'Option D should not contain answer line');

// Case 6: Short Hindi abbreviation 'उ० ख'
const test6 = `
प्रश्न ६) महाभारत के रचयिता कौन थे?
(अ) तुलसीदास
(ब) महर्षि वेदव्यास
(स) कालिदास
(द) वाल्मीकि
उ० ख
`;
const q6 = parsePdfQuestions(test6);
assert.strictEqual(q6.length, 1);
assert.strictEqual(q6[0].correct, 'B', 'Case 6: उ० ख must map to B');

// Case 7: Inline answer format: 'Ans: Option D'
const test7 = `
Q7. कंप्यूटर का मस्तिष्क किसे कहा जाता है?
A: RAM
B: Hard Disk
C: Motherboard
D: CPU
Ans: Option D
`;
const q7 = parsePdfQuestions(test7);
assert.strictEqual(q7.length, 1);
assert.strictEqual(q7[0].correct, 'D', 'Case 7: Option D must map to D');

// Case 8: Answer with trailing dot: 'Answer: B.'
const test8 = `
Q8. भारत के प्रथम प्रधानमंत्री कौन थे?
A. महात्मा गांधी
B. पंडित जवाहरलाल नेहरू
C. सरदार पटेल
D. डॉ. राजेंद्र प्रसाद
Answer: B.
`;
const q8 = parsePdfQuestions(test8);
assert.strictEqual(q8.length, 1);
assert.strictEqual(q8[0].correct, 'B', 'Case 8: Answer: B. must map to B');

// Case 9: Options with Hindi transliteration 'ए', 'बी', 'सी', 'डी'
const test9 = `
Q9. तिरंगे में कितने रंग होते हैं?
ए) दो
बी) तीन
सी) चार
डी) पांच
उत्तर : बी
`;
const q9 = parsePdfQuestions(test9);
assert.strictEqual(q9.length, 1);
assert.strictEqual(q9[0].correct, 'B', 'Case 9: उत्तर : बी must map to B');
assert.strictEqual(q9[0].options[1], 'तीन');

// Case 10: Multi-question txt file
const test10 = `
1. भारत की राजधानी क्या है?
A. मुंबई
B. नई दिल्ली
C. कोलकाता
D. चेन्नई
उत्तर: B

2. बिहार की राजधानी क्या है?
A. पटना
B. गया
C. मुजफ्फरपुर
D. भागलपुर
Ans: A
`;
const q10 = parsePdfQuestions(test10);
assert.strictEqual(q10.length, 2, 'Case 10: Both questions should be parsed');
assert.strictEqual(q10[0].correct, 'B');
assert.strictEqual(q10[1].correct, 'A');

// Case 11: Complete 10-Question set with various image formats, blank lines, and image-only questions
global.imageLibrary = [
  { imageId: 'image-1', url: '/images/image-1.jpg', name: 'taj.jpg' },
  { imageId: 'image-2', url: '/images/image-2.jpg', name: 'kalam.jpg' },
  { imageId: 'image-3', url: '/images/image-3.jpg', name: 'tiger.jpg' },
  { imageId: 'image-4', url: '/images/image-4.jpg', name: 'mango.jpg' }
];

const test11 = `
1. भारत की राजधानी क्या है?
A. मुंबई
B. नई दिल्ली
C. कोलकाता
D. चेन्नई
उत्तर: B

2. सौरमंडल का सबसे बड़ा ग्रह कौन सा है?
A. मंगल
B. पृथ्वी
C. बृहस्पति
D. शुक्र
उत्तर: C

3. दिए गए चित्र में दिख रहे स्मारक का नाम बताएं:
[Image: 1]
A. कुतुब मीनार
B. लाल किला
C. ताजमहल
D. इंडिया गेट
Answer: C

4. [Image: 2]
A. एपीजे अब्दुल कलाम
B. सीवी रमन
C. होमी भाभा
D. विक्रम साराभाई
Ans: A

5. क्रिकेट का भगवान किसे कहा जाता है?
(A) विराट कोहली
(B) सचिन तेंदुलकर
(C) एमएस धोनी
(D) रोहित शर्मा
Key: B

6. जल का रासायनिक सूत्र क्या है?
A. CO2
B. NaCl
C. H2O
D. O2
Ans: C

7. 
[चित्र 3]
इस चित्र में किस जानवर को दिखाया गया है?
(क) बाघ
(ख) शेर
(ग) चीता
(घ) तेंदुआ
उत्तर: (क)

8. बिहार का राजकीय पशु कौन सा है?
A) बैल
B) गाय
C) बाघ
D) हाथी
उत्तर: A

9. [IMAGE]
A. आम
B. सेब
C. केला
D. संतरा
Ans: A

10. कंप्यूटर का मस्तिष्क किसे कहते हैं?
A. RAM
B. ROM
C. CPU
D. GPU
उत्तर: C
`;

const q11 = parsePdfQuestions(test11);
assert.strictEqual(q11.length, 10, 'Case 11: Exactly 10 out of 10 questions must be extracted without skipping any');
assert.strictEqual(q11[2].image, '/images/image-1.jpg', 'Q3 image should resolve');
assert.strictEqual(q11[2].imageId, 'image-1');
assert.strictEqual(q11[3].image, '/images/image-2.jpg', 'Q4 image should resolve');
assert.strictEqual(q11[3].text, 'दिए गए चित्र को देखकर उत्तर दीजिए', 'Q4 text should not be empty');
assert.strictEqual(q11[6].image, '/images/image-3.jpg', 'Q7 image should resolve');
assert.strictEqual(q11[8].image, '/images/image-4.jpg', 'Q9 image should resolve');
assert.strictEqual(q11[9].correct, 'C', 'Q10 answer should be C');

// Case 12: 10-Question set with mixed Q headers, no blank lines
const test12 = `
Q1. Question 1
A) opt1
B) opt2
C) opt3
D) opt4
Ans: A
2. Question 2
[Image: 1]
A) opt1
B) opt2
C) opt3
D) opt4
Ans: B
Question 3: Capital of France?
A) Paris
B) Lyon
C) Nice
D) Marseille
Answer: A
4. [Image: 2]
A) 1
B) 2
C) 3
D) 4
Ans: C
5. Question 5
(A) a
(B) b
(C) c
(D) d
Key: D
6. Question 6
A. a
B. b
C. c
D. d
Ans: A
7. [चित्र: 3] Question 7
(क) ka
(ख) kha
(ग) ga
(घ) gha
उत्तर: ख
8. Question 8
1. one
2. two
3. three
4. four
Ans: 2
9. [IMAGE]
A) a
B) b
C) c
D) d
Ans: A
10. Question 10
A) RAM
B) ROM
C) CPU
D) GPU
Ans: C
`;

const q12 = parsePdfQuestions(test12);
assert.strictEqual(q12.length, 10, 'Case 12: Exactly 10 out of 10 questions must be extracted in mixed format');

// Case 13: 10 Questions with (1)..(10) numbering and (A)..(D) options
const test13 = Array.from({length: 10}, (_, i) => `
(${i + 1}) प्रश्न संख्या ${i + 1} क्या है?
A. विकल्प 1
B. विकल्प 2
C. विकल्प 3
D. विकल्प 4
उत्तर: A
`).join('\n');
const q13 = parsePdfQuestions(test13);
assert.strictEqual(q13.length, 10, 'Case 13: (1)..(10) question numbering must extract all 10 questions');

// Case 14: 10 Questions with inline answers on Option D line
const test14 = Array.from({length: 10}, (_, i) => `
${i + 1}. सवाल ${i + 1} का विवरण:
A. ऑप्शन 1
B. ऑप्शन 2
C. ऑप्शन 3
D. ऑप्शन 4   Ans: B
`).join('\n');
const q14 = parsePdfQuestions(test14);
assert.strictEqual(q14.length, 10, 'Case 14: Inline answer on option D must extract all 10 questions');
assert.strictEqual(q14[0].correct, 'B');

// Case 15: 10 Questions with no space after option delimiter: A.विकल्प, B.विकल्प
const test15 = Array.from({length: 10}, (_, i) => `
${i + 1}. प्रश्न ${i + 1}
A.विकल्प 1
B.विकल्प 2
C.विकल्प 3
D.विकल्प 4
उत्तर: A
`).join('\n');
const q15 = parsePdfQuestions(test15);
assert.strictEqual(q15.length, 10, 'Case 15: No space after option delimiter must extract all 10 questions');

// Case 16: 10 Questions with options 2 per line
const test16 = Array.from({length: 10}, (_, i) => `
${i + 1}. प्रश्न ${i + 1}
A) विकल्प 1   B) विकल्प 2
C) विकल्प 3   D) विकल्प 4
उत्तर: C
`).join('\n');
const q16 = parsePdfQuestions(test16);
assert.strictEqual(q16.length, 10, 'Case 16: Options 2 per line must extract all 10 questions');
assert.strictEqual(q16[0].correct, 'C');

// Case 17: 10 Questions with Devanagari vowel options (अ), (आ), (इ), (ई)
const test17 = Array.from({length: 10}, (_, i) => `
${i + 1}. प्रश्न ${i + 1}
(अ) विकल्प 1
(आ) विकल्प 2
(इ) विकल्प 3
(ई) विकल्प 4
उत्तर: आ
`).join('\n');
const q17 = parsePdfQuestions(test17);
assert.strictEqual(q17.length, 10, 'Case 17: Devanagari vowel options (अ, आ, इ, ई) must extract all 10 questions');
assert.strictEqual(q17[0].correct, 'B');

// Case 18: 10 Questions with consecutive numeric options (1, 2, 3, 4)
const test18 = Array.from({length: 10}, (_, i) => `
${i + 1}. प्रश्न ${i + 1}
1. विकल्प 1
2. विकल्प 2
3. विकल्प 3
4. विकल्प 4
उत्तर: 2
`).join('\n');
const q18 = parsePdfQuestions(test18);
assert.strictEqual(q18.length, 10, 'Case 18: Consecutive numeric options 1..4 must extract all 10 questions');
assert.strictEqual(q18[0].correct, 'B');

// Case 19: 10 Questions with image/video tags and NO imageLibrary loaded (must NOT drop questions)
const test19 = Array.from({length: 10}, (_, i) => {
  if (i % 2 === 0) {
    return `${i + 1}. [Image: ${i + 1}]\nA. विकल्प 1\nB. विकल्प 2\nC. विकल्प 3\nD. विकल्प 4\nउत्तर: A`;
  }
  return `${i + 1}. सामान्य प्रश्न ${i + 1}\nA. विकल्प 1\nB. विकल्प 2\nC. विकल्प 3\nD. विकल्प 4\nउत्तर: A`;
}).join('\n\n');
const q19 = parsePdfQuestions(test19);
assert.strictEqual(q19.length, 10, 'Case 19: Questions with media tags must never be dropped even without imageLibrary');

// Case 20: 10 Questions with no blank lines between questions
const test20 = Array.from({length: 10}, (_, i) => `${i + 1}. प्रश्न ${i + 1} का विवरण:
A. विकल्प 1
B. विकल्प 2
C. विकल्प 3
D. विकल्प 4
उत्तर: A`).join('\n');
const q20 = parsePdfQuestions(test20);
assert.strictEqual(q20.length, 10, 'Case 20: No blank lines between questions must extract all 10 questions');

console.log('All 20 question-parser test cases passed! 10/10 questions extracted across all formats!');
