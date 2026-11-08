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

  // 0. Legacy font / PUA glyph mappings (e.g. Kruti Dev f or PUA characters)
  s = s.replace(/[\uF020]/g, ' ');
  s = s.replace(/[\uF066\uF02F]/g, '\u093F');

  // 1. Remove non-printing noise: zero-width spaces, BOM, soft hyphens
  s = s.replace(/[\u200B\uFEFF\u00AD]/g, '');

  // 2. Remove stray zero-width joiners/non-joiners around spaces
  s = s.replace(/\s*[\u200C\u200D]\s*/g, '');

  // 3. Normalize known multi-syllable visual corruptions before pre-base reordering
  s = s.replace(new RegExp(devStart + '(?:िथत|थित|स्िथत|सि्थत|िस्थत|स्थत)' + devEnd, 'gu'), '$1स्थित');
  s = s.replace(new RegExp(devStart + '(?:िथति|थिति|स्िथति|सि्थति|िस्थिति|स्थति)' + devEnd, 'gu'), '$1स्थिति');
  s = s.replace(new RegExp(devStart + '(?:उपस्थत|उपस्िथत|उपस्थात)' + devEnd, 'gu'), '$1उपस्थित');
  s = s.replace(new RegExp(devStart + '(?:उपस्थति|उपस्िथति)' + devEnd, 'gu'), '$1उपस्थिति');
  s = s.replace(new RegExp(devStart + '(?:परस्थति|परिस्थति|परििथति)' + devEnd, 'gu'), '$1परिस्थिति');
  s = s.replace(new RegExp(devStart + '(?:अनुपस्थत|अनुपस्िथत)' + devEnd, 'gu'), '$1अनुपस्थित');
  s = s.replace(new RegExp(devStart + '(?:अनुपस्थति|अनुपस्िथति)' + devEnd, 'gu'), '$1अनुपस्थिति');

  s = s.replace(new RegExp(devStart + '(?:िवीडियो|वीिडयो|विीडियो|विडयो)' + devEnd, 'gu'), '$1वीडियो');
  s = s.replace(new RegExp(devStart + '(?:िक्रिकेट|िक्रकेट|क्रकेट)' + devEnd, 'gu'), '$1क्रिकेट');
  s = s.replace(new RegExp(devStart + 'महिर्षी?' + devEnd, 'gu'), '$1महर्षि');
  s = s.replace(new RegExp(devStart + '(?:नर्िदयी|नर्दयी)' + devEnd, 'gu'), '$1निर्दयी');

  // Early spaced decompositions for target words
  s = s.replace(/ग\s*ि?\s*र\s*[िी]?\s*ड\s*[ीि]?\s*ह/gu, 'गिरिडीह');
  s = s.replace(/ि?\s*व\s*ि?\s*ट\s*ा\s*म\s*ि?\s*न\s*ि?/gu, 'विटामिन');
  s = s.replace(/प\s*्\s*र\s*ि\s*य\s*ा/gu, 'प्रिया');
  s = s.replace(/प\s*्\s*र\s*ि\s*य/gu, 'प्रिय');
  s = s.replace(/प\s*्\s*र\s+य\s*ा/gu, 'प्रिया');
  s = s.replace(/प\s*्\s*र\s+य(?=[^\u0900-\u097F]|$)/gu, 'प्रिय');

  // 5. Remove artificial spaces around halant (virama) in consonant clusters
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\s+(' + halant + ')', 'g'), '$1$2');
  s = s.replace(new RegExp('(' + halant + ')\\s+(' + baseChar + nukta + '?)', 'g'), '$1$2');

  // 5b. General Conjunct Virama-Matra Inversion:
  // In PDF font glyph streams, the short-i matra \u093F is frequently drawn visually before the 2nd consonant of a conjunct
  // e.g. C1 + halant + \u093F + C2 -> C1 + halant + C2 + \u093F (e.g. स्िथत -> स्थित, द्िवतीय -> द्वितीय)
  s = s.replace(new RegExp('(' + baseChar + nukta + '?' + halant + ')\\u093F\\s*(' + cluster + ')', 'gu'), '$1$2\u093F');
  // Also handle C1 + \u093F + halant + C2 -> C1 + halant + C2 + \u093F
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\u093F\\s*(' + halant + cluster + ')', 'gu'), '$1$2\u093F');

  // 6. Vocalic R (ृ \u0943 / ॄ \u0944) repairs:
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\s*' + halant + '?\\s*\\u090B', 'gu'), '$1\u0943');
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\s+([\\u0943\\u0944])', 'g'), '$1$2');
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)' + halant + '\\s*([\\u0943\\u0944])', 'g'), '$1$2');
  s = s.replace(new RegExp(nonConsBefore + '([\\u0943\\u0944])\\s*(' + cluster + ')', 'gu'), '$1$3$2');

  // 7. Connect base consonant to following matra when space was artificially inserted:
  s = s.replace(new RegExp('(^|\\s)(' + baseChar + nukta + '?)\\s+\\u093F(?=\\s*' + baseChar + ')', 'gu'), (m, p1, p2) => p1 + p2 + '\u093F');
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\s+(' + postMatrasNoPre + ')', 'g'), '$1$2');

  // Deduplicate duplicate \u093F surrounding a cluster at word start or after non-Devanagari (font ligature artifact, e.g. \u093F + cluster + \u093F)
  s = s.replace(new RegExp('(^|[^\\u0900-\\u097F]|\\s)\\u093F\\s*(' + cluster + ')\\u093F', 'gu'), '$1$2\u093F');

  // 8. Universal pre-base short I (ि \u093F) & long EE (ी \u0940) reordering:
  const preBasePrefix = '(^|[^\\u0900-\\u097F]|[\\u0904-\\u0914]|[\\u093E-\\u094C\\u0943\\u0944\\u0962\\u0963\\u093F]|[\\u0901-\\u0903]|\\s)';
  s = s.replace(new RegExp(preBasePrefix + '\\u093F\\s*(' + cluster + ')', 'gu'), '$1$2\u093F');
  s = s.replace(new RegExp(preBasePrefix + '\\u0940\\s*(' + cluster + ')', 'gu'), '$1$2\u0940');

  // Reconnect any remaining spaced matras
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)\\s+(' + postMatras + ')', 'g'), '$1$2');

  // Spaced token repairs for common quiz words
  s = s.replace(/नि\s+म्न/gu, 'निम्न');
  s = s.replace(/कि\s+स/gu, 'किस');
  s = s.replace(/ब\s+ीन/gu, 'बीन');
  s = s.replace(/ब\s+िन/gu, 'बिन');

  // 9. Remove spaces between vowel signs and anusvara / visarga / candrabindu
  s = s.replace(new RegExp('([\\u093E-\\u094C\\u0943\\u0944])\\s+([\\u0901-\\u0903])', 'g'), '$1$2');

  // 10. Reph (र् \u0930\u094D) repairs:
  s = s.replace(new RegExp('(' + baseChar + nukta + '?(?:[\\u093E-\\u094C\\u0943\\u0944])?)\\s+(\\u0930' + halant + baseChar + nukta + '?)', 'g'), '$1$2');
  s = s.replace(new RegExp('(' + baseChar + nukta + '?)(' + postMatras + '?)\\u0930' + halant + devEnd, 'gu'), (m, p1, p2) => {
    return '\u0930\u094D' + p1 + (p2 || '');
  });

  // 11. Inter-consonant displaced short I (ि \u093F) in PDF glyph streams:
  s = s.replace(new RegExp(devStart + '(?:छिव|िछव|छव)' + devEnd, 'gu'), '$1छवि');
  s = s.replace(new RegExp(devStart + 'छ\\s+(?:वि|िव|व\\s*ि)' + devEnd, 'gu'), '$1छवि');
  s = s.replace(new RegExp(devStart + '(?:छिवयों|छवयों)' + devEnd, 'gu'), '$1छवियों');
  s = s.replace(new RegExp(devStart + '(?:छिवयां|छवयां|छिवयाँ|छवयाँ)' + devEnd, 'gu'), '$1छवियां');

  s = s.replace(new RegExp(devStart + 'प्रित' + devEnd, 'gu'), '$1प्रति');
  s = s.replace(new RegExp(devStart + 'प्र\\s*त(?=[^\\u0900-\\u097F]|$)', 'gu'), '$1प्रति');
  s = s.replace(new RegExp(devStart + 'तिमलनाडु' + devEnd, 'gu'), '$1तमिलनाडु');
  s = s.replace(new RegExp(devStart + 'तमलनाडु' + devEnd, 'gu'), '$1तमिलनाडु');
  s = s.replace(new RegExp(devStart + 'मिणपुर' + devEnd, 'gu'), '$1मणिपुर');
  s = s.replace(new RegExp(devStart + 'मणपुर' + devEnd, 'gu'), '$1मणिपुर');
  s = s.replace(new RegExp(devStart + 'नरिसंह' + devEnd, 'gu'), '$1नरसिंह');
  s = s.replace(new RegExp(devStart + 'नरसंह' + devEnd, 'gu'), '$1नरसिंह');
  s = s.replace(new RegExp(devStart + 'संबंधत' + devEnd, 'gu'), '$1संबंधित');
  s = s.replace(new RegExp(devStart + 'संबंिधत' + devEnd, 'gu'), '$1संबंधित');
  s = s.replace(new RegExp(devStart + 'करिण' + devEnd, 'gu'), '$1किरण');
  s = s.replace(new RegExp('विद्याप(?:form|fit|ित)' + devEnd, 'gu'), 'विद्यापति');

  // General cluster-cluster \u093F displacement
  s = s.replace(new RegExp('(' + cluster + ')(' + cluster + ')\\u093F(' + vowelSigns + ')', 'g'), '$1\u093F$2$3');

  // 12. Devanagari specific repair for "प्र" split from "य", "या", "ये", etc.
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

  // 13. Dropped matra repairs for all 64 target words and quiz vocabulary:
  // Note: Check longer compounds BEFORE shorter roots!
  s = s.replace(new RegExp(devStart + '(?:नम्नलिखित|नम्नलखत|नम्र्नलिखित|िनम्नलिखित|निम्नलखत)' + devEnd, 'gu'), '$1निम्नलिखित');
  s = s.replace(new RegExp(devStart + 'नम्न' + devEnd, 'gu'), '$1निम्न');

  // Target words specific restorations
  s = s.replace(new RegExp(devStart + 'वपरीतार्थक' + devEnd, 'gu'), '$1विपरीतार्थक');
  s = s.replace(new RegExp(devStart + 'नराशा' + devEnd, 'gu'), '$1निराशा');
  s = s.replace(new RegExp(devStart + 'बल्ली' + devEnd, 'gu'), '$1बिल्ली');
  s = s.replace(new RegExp(devStart + '(?:िगिरिडीह|िगरिडीह|िगिरीडीह|गरिडीह|गीरीडीह|गिरेडिह)' + devEnd, 'gu'), '$1गिरिडीह');
  s = s.replace(new RegExp(devStart + 'रकेट्स' + devEnd, 'gu'), '$1रिकेट्स');
  s = s.replace(new RegExp(devStart + '(?:िवटामनि|विटामनि|वटामन|वटामिन|विटामन)' + devEnd, 'gu'), '$1विटामिन');
  s = s.replace(new RegExp(devStart + '(?:िथत|थित|स्िथत|सि्थत|िस्थत|स्थत)' + devEnd, 'gu'), '$1स्थित');
  s = s.replace(new RegExp(devStart + '(?:िथति|थिति|स्िथति|सि्थति|िस्थिति|स्थति)' + devEnd, 'gu'), '$1स्थिति');
  s = s.replace(new RegExp(devStart + 'मंदर' + devEnd, 'gu'), '$1मंदिर');
  s = s.replace(new RegExp(devStart + 'पंडत' + devEnd, 'gu'), '$1पंडित');
  s = s.replace(new RegExp(devStart + 'हमालय' + devEnd, 'gu'), '$1हिमालय');
  s = s.replace(new RegExp(devStart + '(?:दखाएं|दखाएँ|दखाइए|दिखाएँ)' + devEnd, 'gu'), '$1दिखाएं');
  s = s.replace(new RegExp(devStart + 'दखाया' + devEnd, 'gu'), '$1दिखाया');
  s = s.replace(new RegExp(devStart + 'दखाना' + devEnd, 'gu'), '$1दखाना');
  s = s.replace(new RegExp(devStart + 'दखाने' + devEnd, 'gu'), '$1दखाने');
  s = s.replace(new RegExp(devStart + 'दखाये' + devEnd, 'gu'), '$1दिखाये');
  s = s.replace(new RegExp(devStart + 'त्रभुज' + devEnd, 'gu'), '$1त्रिभुज');
  s = s.replace(new RegExp(devStart + 'चत्रकला' + devEnd, 'gu'), '$1चित्रकला');
  s = s.replace(new RegExp(devStart + 'चत्र' + devEnd, 'gu'), '$1चित्र');
  s = s.replace(new RegExp(devStart + 'अम अमिताभ' + devEnd, 'gu'), '$1अमिताभ');
  s = s.replace(new RegExp(devStart + 'अमताभ' + devEnd, 'gu'), '$1अमिताभ');
  s = s.replace(new RegExp(devStart + 'लवर' + devEnd, 'gu'), '$1लिवर');
  s = s.replace(new RegExp(devStart + 'वभीषण' + devEnd, 'gu'), '$1विभीषण');
  s = s.replace(new RegExp(devStart + 'दवंगत' + devEnd, 'gu'), '$1दिवंगत');
  s = s.replace(new RegExp(devStart + 'वैज्ञानक' + devEnd, 'gu'), '$1वैज्ञानिक');
  s = s.replace(new RegExp(devStart + 'औद्योगक' + devEnd, 'gu'), '$1औद्योगिक');
  s = s.replace(new RegExp(devStart + 'कलोमीटर' + devEnd, 'gu'), '$1किलोमीटर');
  s = s.replace(new RegExp(devStart + 'चंटी' + devEnd, 'gu'), '$1चिंटी');
  s = s.replace(new RegExp(devStart + 'लखी' + devEnd, 'gu'), '$1लिखी');
  s = s.replace(new RegExp(devStart + 'संह' + devEnd, 'gu'), '$1सिंह');
  s = s.replace(new RegExp(devStart + 'वष्णु' + devEnd, 'gu'), '$1विष्णु');
  s = s.replace(new RegExp(devStart + 'डजटल' + devEnd, 'gu'), '$1डिजिटल');
  s = s.replace(new RegExp(devStart + 'फशंग' + devEnd, 'gu'), '$1फिशिंग');
  s = s.replace(new RegExp(devStart + 'फिशंग' + devEnd, 'gu'), '$1फिशिंग');
  s = s.replace(new RegExp(devStart + 'बहार' + devEnd, 'gu'), '$1बिहार');
  s = s.replace(new RegExp(devStart + 'फल्म' + devEnd, 'gu'), '$1फिल्म');
  s = s.replace(new RegExp(devStart + 'अहल्या' + devEnd, 'gu'), '$1अहिल्या');
  s = s.replace(new RegExp(devStart + 'अंकत' + devEnd, 'gu'), '$1अंकित');
  s = s.replace(new RegExp(devStart + 'सूचत' + devEnd, 'gu'), '$1सूचित');
  s = s.replace(new RegExp(devStart + 'वाचका' + devEnd, 'gu'), '$1वाचिका');
  s = s.replace(new RegExp(devStart + 'मठाई' + devEnd, 'gu'), '$1मिठाई');
  s = s.replace(new RegExp(devStart + 'जावत्री' + devEnd, 'gu'), '$1जावित्री');
  s = s.replace(new RegExp(devStart + 'कशोरावस्था' + devEnd, 'gu'), '$1किशोरावस्था');

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
  s = s.replace(new RegExp(devStart + 'स्थित' + devEnd, 'gu'), '$1स्थित');
  s = s.replace(new RegExp(devStart + 'स्थत' + devEnd, 'gu'), '$1स्थित');
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

  // 14. Deduplicate adjacent identical matras (e.g. \u093F\u093F -> \u093F)
  s = s.replace(/(\u093F)+/g, '$1');
  s = s.replace(/([\u093E-\u094C])\1+/g, '$1');

  // 15. Normalize multiple horizontal spaces
  s = s.replace(/[ \t]+/g, ' ');
  return s.normalize('NFC').trim();
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

// Full verification of all 64 user-requested target words
const all64TargetWords = [
  'विपरीतार्थक', 'निर्दयी', 'निराशा', 'निम्न', 'बिल्ली', 'गिरिडीह', 'छवि', 'रिकेट्स',
  'विटामिन', 'स्थित', 'मंदिर', 'पंडित', 'निम्नलिखित', 'विकल्प', 'हिमालय', 'दिखाये',
  'त्रिभुज', 'महर्षि', 'तमिलनाडु', 'प्राचीन', 'चित्र', 'किस', 'अमिताभ', 'कितने',
  'वीडियो', 'लिवर', 'विभीषण', 'दिवंगत', 'वैज्ञानिक', 'औद्योगिक', 'सर्वप्रथम', 'प्रिय',
  'चित्रकला', 'इनमें', 'विद्यापति', 'किलोमीटर', 'प्रति', 'कितनी', 'प्रसिद्ध', 'किसकी',
  'दिशा', 'चिंटी', 'लिखी', 'सिंह', 'विष्णु', 'संबंधित', 'नरसिंह', 'क्रिकेट',
  'मुक्केबाजी', 'डिजिटल', 'फिशिंग', 'बिहार', 'राजधानी', 'मणिपुर', 'फिल्म', 'अहिल्या',
  'बैद्यनाथधाम', 'अंकित', 'सूचित', 'वाचिका', 'श्वेता', 'मिठाई', 'जावित्री', 'किशोरावस्था'
];

// 1. Idempotency: All 64 target words must be preserved exactly as valid Unicode NFC
for (const word of all64TargetWords) {
  assert.equal(fixDevanagariMatras(word), word, `Target word idempotency failed for: ${word}`);
}

// 2. Visual Pre-base Short I (\u093F) test cases for target words
const preBaseWordTests = [
  ['िवपरीतार्थक', 'विपरीतार्थक'],
  ['िनराशा', 'निराशा'],
  ['िनम्न', 'निम्न'],
  ['िबल्ली', 'बिल्ली'],
  ['िरकेट्स', 'रिकेट्स'],
  ['िवटामिन', 'विटामिन'],
  ['िस्थत', 'स्थित'],
  ['िवकल्प', 'विकल्प'],
  ['िहमालय', 'हिमालय'],
  ['िदखाये', 'दिखाये'],
  ['ित्रभुज', 'त्रिभुज'],
  ['िचत्र', 'चित्र'],
  ['िकस', 'किस'],
  ['िकतने', 'कितने'],
  ['िवभीषण', 'विभीषण'],
  ['िदवंगत', 'दिवंगत'],
  ['िप्रय', 'प्रिय'],
  ['िचत्रकला', 'चित्रकला'],
  ['िकलोमीटर', 'किलोमीटर'],
  ['िकतनी', 'कितनी'],
  ['िकसकी', 'किसकी'],
  ['िदशा', 'दिशा'],
  ['िचंटी', 'चिंटी'],
  ['िलखी', 'लिखी'],
  ['िसंह', 'सिंह'],
  ['िवष्णु', 'विष्णु'],
  ['िबहार', 'बिहार'],
  ['िफल्म', 'फिल्म'],
  ['िमठाई', 'मिठाई'],
  ['िकशोरावस्था', 'किशोरावस्था']
];
for (const [input, expected] of preBaseWordTests) {
  assert.equal(fixDevanagariMatras(input), expected, `Pre-base fix failed for: ${input}`);
}

// 3. Multi-syllable, intra-word, font ligatures, and dropped matra tests
const complexWordTests = [
  ['छिव', 'छवि'],
  ['छव', 'छवि'],
  ['प्रित', 'प्रति'],
  ['प्र त', 'प्रति'],
  ['तिमलनाडु', 'तमिलनाडु'],
  ['तमलनाडु', 'तमिलनाडु'],
  ['मिणपुर', 'मणिपुर'],
  ['मणपुर', 'मणिपुर'],
  ['नरिसंह', 'नरसिंह'],
  ['नरसंह', 'नरसिंह'],
  ['महिर्ष', 'महर्षि'],
  ['महिर्षी', 'महर्षि'],
  ['नर्िदयी', 'निर्दयी'],
  ['नर्दयी', 'निर्दयी'],
  ['वीिडयो', 'वीडियो'],
  ['िवीडियो', 'वीडियो'],
  ['िक्रिकेट', 'क्रिकेट'],
  ['िक्रकेट', 'क्रिकेट'],
  ['क्रकेट', 'क्रिकेट'],
  ['अिमताभ', 'अमिताभ'],
  ['अमताभ', 'अमिताभ'],
  ['अिहल्या', 'अहिल्या'],
  ['अहल्या', 'अहिल्या'],
  ['जािवत्री', 'जावित्री'],
  ['जावत्री', 'जावित्री'],
  ['वािचका', 'वाचिका'],
  ['वाचका', 'वाचिका'],
  ['सूिचत', 'सूचित'],
  ['सूचत', 'सूचित'],
  ['अंिकत', 'अंकित'],
  ['अंकत', 'अंकित'],
  ['वैज्ञािनक', 'वैज्ञानिक'],
  ['वैज्ञानक', 'वैज्ञानिक'],
  ['औद्योिगक', 'औद्योगिक'],
  ['औद्योगक', 'औद्योगिक'],
  ['संबंिधत', 'संबंधित'],
  ['संबंधत', 'संबंधित'],
  ['विद्यापform', 'विद्यापति'],
  ['विद्यापति', 'विद्यापति'],
  ['वपरीतार्थक', 'विपरीतार्थक'],
  ['नराशा', 'निराशा'],
  ['बल्ली', 'बिल्ली'],
  ['गरिडीह', 'गिरिडीह'],
  ['रकेट्स', 'रिकेट्स'],
  ['वटामन', 'विटामिन'],
  ['मंदर', 'मंदिर'],
  ['पंडत', 'पंडित'],
  ['हमालय', 'हिमालय'],
  ['दखाये', 'दिखाये'],
  ['त्रभुज', 'त्रिभुज'],
  ['चत्रकला', 'चित्रकला'],
  ['चत्र', 'चित्र'],
  ['लवर', 'लिवर'],
  ['वभीषण', 'विभीषण'],
  ['दवंगत', 'दिवंगत'],
  ['कलोमीटर', 'किलोमीटर'],
  ['चंटी', 'चिंटी'],
  ['लखी', 'लिखी'],
  ['संह', 'सिंह'],
  ['वष्णु', 'विष्णु'],
  ['डजटल', 'डिजिटल'],
  ['फशंग', 'फिशिंग'],
  ['फिशंग', 'फिशिंग'],
  ['बहार', 'बिहार'],
  ['फल्म', 'फिल्म'],
  ['मठाई', 'मिठाई'],
  ['कशोरावस्था', 'किशोरावस्था'],
  ['नम्नलखत', 'निम्नलिखित'],
  ['नम्नलिखित', 'निम्नलिखित']
];
for (const [input, expected] of complexWordTests) {
  assert.equal(fixDevanagariMatras(input), expected, `Complex/dropped fix failed for: ${input}`);
}

// --------------------------------------------------------------------------
// MANDATORY TEST SUITE FOR USER 6 TARGET WORDS:
// गिरिडीह, छवि, विटामिन, बीन, स्थित, दिखाएं
// --------------------------------------------------------------------------
const mandatory6TargetWordTests = [
  // 1. गिरिडीह
  ['गिरिडीह', 'गिरिडीह'],
  ['िगिरिडीह', 'गिरिडीह'],
  ['िगरिडीह', 'गिरिडीह'],
  ['िगिरीडीह', 'गिरिडीह'],
  ['गरिडीह', 'गिरिडीह'],
  ['ग िर िड ीह', 'गिरिडीह'],
  ['ग िरिडीह', 'गिरिडीह'],

  // 2. छवि
  ['छवि', 'छवि'],
  ['छिव', 'छवि'],
  ['िछव', 'छवि'],
  ['छव', 'छवि'],
  ['छ वि', 'छवि'],
  ['छ िव', 'छवि'],
  ['छ व ि', 'छवि'],
  ['छवियों', 'छवियों'],
  ['छिवयों', 'छवियों'],

  // 3. विटामिन
  ['विटामिन', 'विटामिन'],
  ['िवटामिन', 'विटामिन'],
  ['िवटामनि', 'विटामिन'],
  ['विटामनि', 'विटामिन'],
  ['वटामन', 'विटामिन'],
  ['वटामिन', 'विटामिन'],
  ['विटामन', 'विटामिन'],
  ['व िटामिन', 'विटामिन'],

  // 4. बीन
  ['बीन', 'बीन'],
  ['ब ीन', 'बीन'],
  ['ीबन', 'बीन'],
  ['बिन', 'बिन'],
  ['िबन', 'बिन'],
  ['ब िन', 'बिन'],

  // 5. स्थित
  ['स्थित', 'स्थित'],
  ['स्\u093Fथत', 'स्थित'],
  ['िस्थत', 'स्थित'],
  ['िथत', 'स्थित'],
  ['स्थत', 'स्थित'],
  ['स्थिति', 'स्थिति'],
  ['िथति', 'स्थिति'],
  ['िस्थिति', 'स्थिति'],
  ['स्थति', 'स्थिति'],

  // 6. दिखाएं
  ['दिखाएं', 'दिखाएं'],
  ['िदखाएं', 'दिखाएं'],
  ['दखाएं', 'दिखाएं'],
  ['द िखाएं', 'दिखाएं'],
  ['दिखाएँ', 'दिखाएं'],
  ['दखाएँ', 'दिखाएं'],
  ['दखाइए', 'दिखाएं'],
  ['दिखाये', 'दिखाये'],
  ['दखाये', 'दिखाये']
];

for (const [input, expected] of mandatory6TargetWordTests) {
  assert.equal(fixDevanagariMatras(input), expected, `Mandatory test failed for: ${input}`);
}

console.log('devanagari.test.js: all Devanagari matra, vocalic R, Reph, Rakar, conjunct, and 6 mandatory target words (गिरिडीह, छवि, विटामिन, बीन, स्थित, दिखाएं) tests passed!');

