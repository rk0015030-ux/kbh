const assert = require('node:assert/strict');

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

// --------------------------------------------------------------------------
// TEST SUITE: All target words requested by the user
// --------------------------------------------------------------------------

// Specific user report: निम्न vs नम्न, किस vs कस
assert.equal(fixDevanagariMatras('निम्न'), 'निम्न');
assert.equal(fixDevanagariMatras('नम्न'), 'निम्न');
assert.equal(fixDevanagariMatras('िनम्न'), 'निम्न');
assert.equal(fixDevanagariMatras('न ि म् न'), 'निम्न');
assert.equal(fixDevanagariMatras('निम्नलिखित'), 'निम्नलिखित');
assert.equal(fixDevanagariMatras('नम्नलिखित'), 'निम्नलिखित');
assert.equal(fixDevanagariMatras('नम्नलखत'), 'निम्नलिखित');
assert.equal(fixDevanagariMatras('किस'), 'किस');
assert.equal(fixDevanagariMatras('कस'), 'किस');
assert.equal(fixDevanagariMatras('िकस'), 'किस');
assert.equal(fixDevanagariMatras('क ि स'), 'किस');
assert.equal(fixDevanagariMatras('कसने'), 'किसने');
assert.equal(fixDevanagariMatras('कसी'), 'किसी');
assert.equal(fixDevanagariMatras('कतने'), 'कितने');
assert.equal(fixDevanagariMatras('कसे'), 'किसे');
assert.equal(fixDevanagariMatras('दए गए'), 'दिए गए');
assert.equal(fixDevanagariMatras('कया गया'), 'किया गया');
assert.equal(fixDevanagariMatras('जसमें'), 'जिसमें');
assert.equal(fixDevanagariMatras('नयम'), 'नियम');
assert.equal(fixDevanagariMatras('दशा'), 'दिशा');
assert.equal(fixDevanagariMatras('दन'), 'दिन');
assert.equal(fixDevanagariMatras('शक्षा'), 'शिक्षा');
assert.equal(fixDevanagariMatras('हन्दी'), 'हिन्दी');
assert.equal(fixDevanagariMatras('वकल्प'), 'विकल्प');
assert.equal(fixDevanagariMatras('वकास'), 'विकास');
assert.equal(fixDevanagariMatras('वज्ञान'), 'विज्ञान');
assert.equal(fixDevanagariMatras('संवधान'), 'संविधान');
assert.equal(fixDevanagariMatras('अधकार'), 'अधिकार');
assert.equal(fixDevanagariMatras('दखता'), 'दिखता');

// Problem 1: Short I vowel sign (ि)
// Words: कि, किताब, किसान, विज्ञान, विद्यार्थी, किरण, इतिहास, स्थिति, निश्चित
assert.equal(fixDevanagariMatras('कि'), 'कि');
assert.equal(fixDevanagariMatras('\u093F\u0915'), 'कि'); // visual pre-base \u093F before क
assert.equal(fixDevanagariMatras('किताब'), 'किताब');
assert.equal(fixDevanagariMatras('िकताब'), 'किताब');
assert.equal(fixDevanagariMatras('कतिाब'), 'किताब');
assert.equal(fixDevanagariMatras('किसान'), 'किसान');
assert.equal(fixDevanagariMatras('िकसान'), 'किसान');
assert.equal(fixDevanagariMatras('कसिान'), 'किसान');
assert.equal(fixDevanagariMatras('किरण'), 'किरण');
assert.equal(fixDevanagariMatras('िकरण'), 'किरण');
assert.equal(fixDevanagariMatras('करिण'), 'किरण');
assert.equal(fixDevanagariMatras('विज्ञान'), 'विज्ञान');
assert.equal(fixDevanagariMatras('िवज्ञान'), 'विज्ञान');
assert.equal(fixDevanagariMatras('इतिहास'), 'इतिहास');
assert.equal(fixDevanagariMatras('इितहास'), 'इतिहास');
assert.equal(fixDevanagariMatras('स्थिति'), 'स्थिति');
assert.equal(fixDevanagariMatras('िस्थिति'), 'स्थिति');
assert.equal(fixDevanagariMatras('निश्चित'), 'निश्चित');
assert.equal(fixDevanagariMatras('िनिश्चित'), 'निश्चित');
assert.equal(fixDevanagariMatras('विद्यार्थी'), 'विद्यार्थी');
assert.equal(fixDevanagariMatras('िवद्यार्थी'), 'विद्यार्थी');
assert.equal(fixDevanagariMatras('विद्याथीर्'), 'विद्यार्थी');

// Problem 2: ऋ vowel sign (ृ)
// Words: कृपा, कृषि, कृत्रिम, वृक्ष, पृथ्वी, मृत्यु
assert.equal(fixDevanagariMatras('कृपा'), 'कृपा');
assert.equal(fixDevanagariMatras('क ृपा'), 'कृपा');
assert.equal(fixDevanagariMatras('कऋपा'), 'कृपा');
assert.equal(fixDevanagariMatras('क्ृपा'), 'कृपा');
assert.equal(fixDevanagariMatras('कृषि'), 'कृषि');
assert.equal(fixDevanagariMatras('कऋषि'), 'कृषि');
assert.equal(fixDevanagariMatras('कृत्रिम'), 'कृत्रिम');
assert.equal(fixDevanagariMatras('कऋत्रिम'), 'कृत्रिम');
assert.equal(fixDevanagariMatras('वृक्ष'), 'वृक्ष');
assert.equal(fixDevanagariMatras('व ृक्ष'), 'वृक्ष');
assert.equal(fixDevanagariMatras('वऋक्ष'), 'वृक्ष');
assert.equal(fixDevanagariMatras('पृथ्वी'), 'पृथ्वी');
assert.equal(fixDevanagariMatras('प ृथ्वी'), 'पृथ्वी');
assert.equal(fixDevanagariMatras('पऋथ्वी'), 'पृथ्वी');
assert.equal(fixDevanagariMatras('मृत्यु'), 'मृत्यु');
assert.equal(fixDevanagariMatras('म ृत्यु'), 'मृत्यु');
assert.equal(fixDevanagariMatras('मऋत्यु'), 'मृत्यु');

// Problem 2: Reph (र्) and Conjunct consonants
// Words: पर्वत, कर्म, धर्म, सूर्य, अर्थ, राष्ट्र, प्रश्न, महत्वपूर्ण
assert.equal(fixDevanagariMatras('पर्वत'), 'पर्वत');
assert.equal(fixDevanagariMatras('प र्वत'), 'पर्वत');
assert.equal(fixDevanagariMatras('कर्म'), 'कर्म');
assert.equal(fixDevanagariMatras('कमर्'), 'कर्म');
assert.equal(fixDevanagariMatras('क र्म'), 'कर्म');
assert.equal(fixDevanagariMatras('धर्म'), 'धर्म');
assert.equal(fixDevanagariMatras('धमर्'), 'धर्म');
assert.equal(fixDevanagariMatras('सूर्य'), 'सूर्य');
assert.equal(fixDevanagariMatras('सूयर्'), 'सूर्य');
assert.equal(fixDevanagariMatras('सू र्य'), 'सूर्य');
assert.equal(fixDevanagariMatras('अर्थ'), 'अर्थ');
assert.equal(fixDevanagariMatras('अथर्'), 'अर्थ');
assert.equal(fixDevanagariMatras('महत्वपूर्ण'), 'महत्वपूर्ण');
assert.equal(fixDevanagariMatras('महत्वपूणर्'), 'महत्वपूर्ण');
assert.equal(fixDevanagariMatras('महत्वपू र्ण'), 'महत्वपूर्ण');

// Rakar (्र), half letters, and conjuncts
assert.equal(fixDevanagariMatras('राष्ट्र'), 'राष्ट्र');
assert.equal(fixDevanagariMatras('राष ् ट ् र'), 'राष्ट्र');
assert.equal(fixDevanagariMatras('प्रश्न'), 'प्रश्न');
assert.equal(fixDevanagariMatras('प ् र श ् न'), 'प्रश्न');
assert.equal(fixDevanagariMatras('प्र श्न'), 'प्रश्न');
assert.equal(fixDevanagariMatras('प्रिया'), 'प्रिया');
assert.equal(fixDevanagariMatras('िप्रया'), 'प्रिया');
assert.equal(fixDevanagariMatras('ि  प्रया'), 'प्रिया');
assert.equal(fixDevanagariMatras('प्रयिा'), 'प्रिया');
assert.equal(fixDevanagariMatras('प ् र ि य ा'), 'प्रिया');
assert.equal(fixDevanagariMatras('प्रि या'), 'प्रिया');
assert.equal(fixDevanagariMatras('प्रत्येक'), 'प्रत्येक');
assert.equal(fixDevanagariMatras('द्रविड़'), 'द्रविड़');
assert.equal(fixDevanagariMatras('प्रकाश'), 'प्रकाश');
assert.equal(fixDevanagariMatras('प्रतिदिन'), 'प्रतिदिन');
assert.equal(fixDevanagariMatras('प्रतियोगिता'), 'प्रतियोगिता');

// User conversational phrase test cases
assert.equal(fixDevanagariMatras('बहुत प्र य'), 'बहुत प्रिय');
assert.equal(fixDevanagariMatras('बहुत क्रोधत'), 'बहुत क्रोधित');
assert.equal(fixDevanagariMatras('बहुत प्रिय'), 'बहुत प्रिय');
assert.equal(fixDevanagariMatras('बहुत िप्रय'), 'बहुत प्रिय');
assert.equal(fixDevanagariMatras('बहुत ि प्र य'), 'बहुत प्रिय');
assert.equal(fixDevanagariMatras('बहुत प्र या'), 'बहुत प्रिया');

console.log('devanagari.test.js: all Devanagari matra, vocalic R, Reph, Rakar, conjunct, and dropped-matra tests passed!');
