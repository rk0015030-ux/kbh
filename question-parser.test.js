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

console.log('All 10 question-parser test cases passed successfully!');
