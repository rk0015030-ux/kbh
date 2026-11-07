const assert = require('node:assert/strict');

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

// 1. Normal logical Priya must remain Priya
assert.equal(fixDevanagariMatras('प्रिया'), 'प्रिया');

// 2. Pre-base visual 'ि' before paden ra conjunct 'प्र' must become 'प्रिया'
assert.equal(fixDevanagariMatras('िप्रया'), 'प्रिया');

// 3. Spaced pre-base 'ि' and 'प्रया'
assert.equal(fixDevanagariMatras('ि  प्रया'), 'प्रिया');

// 4. Displaced matra sequence 'प्रयिा' (which previously caused "प्र य" display) must be repaired to 'प्रिया'
assert.equal(fixDevanagariMatras('प्रयिा'), 'प्रिया');

// 5. Artificial spaces between halant characters: 'प ् र ि य ा'
assert.equal(fixDevanagariMatras('प ् र ि य ा'), 'प्रिया');

// 6. Split 'प्रि या'
assert.equal(fixDevanagariMatras('प्रि या'), 'प्रिया');

// 7. Other words with 'ि' and conjuncts
assert.equal(fixDevanagariMatras('किताब'), 'किताब');
assert.equal(fixDevanagariMatras('िकताब'), 'किताब');
assert.equal(fixDevanagariMatras('कतिाब'), 'किताब');
assert.equal(fixDevanagariMatras('प्रत्येक'), 'प्रत्येक');
assert.equal(fixDevanagariMatras('स्थिति'), 'स्थिति');
assert.equal(fixDevanagariMatras('िस्थिति'), 'स्थिति');
assert.equal(fixDevanagariMatras('द्रविड़'), 'द्रविड़');
assert.equal(fixDevanagariMatras('प्रकाश'), 'प्रकाश');
assert.equal(fixDevanagariMatras('प्रतिदिन'), 'प्रतिदिन');
assert.equal(fixDevanagariMatras('प्रतियोगिता'), 'प्रतियोगिता');

// 8. User specific cases: "बहुत प्र य" -> "बहुत प्रिय", "बहुत क्रोधत" -> "बहुत क्रोधित"
assert.equal(fixDevanagariMatras('बहुत प्र य'), 'बहुत प्रिय');
assert.equal(fixDevanagariMatras('बहुत क्रोधत'), 'बहुत क्रोधित');
assert.equal(fixDevanagariMatras('बहुत प्रिय'), 'बहुत प्रिय');
assert.equal(fixDevanagariMatras('बहुत िप्रय'), 'बहुत प्रिय');
assert.equal(fixDevanagariMatras('बहुत ि प्र य'), 'बहुत प्रिय');
assert.equal(fixDevanagariMatras('बहुत प्र या'), 'बहुत प्रिया');

console.log('devanagari.test.js: all Devanagari matra and conjunct tests passed!');
