/**
 * Wanderlust Stage 2 Analysis Bridge — Build 8 — Autosave, Timing & Status
 * Deploy as a Google Apps Script web app: execute as owner; access by anyone
 * permitted by the Wanderlust front-end deployment.
 *
 * Required Script Properties:
 *   SUBMISSION_TOKEN
 *   OPENAI_API_KEY
 *   STAGE2_ARCHIVE_FOLDER_ID
 * Optional:
 *   OPENAI_MODEL (defaults to gpt-5.6)
 */

const APP_VERSION = '1.0.8';
const DEFAULT_MODEL = 'gpt-5.6';
const APPROVED_RECIPIENTS = [
  'john@wanderlust.properties',
  'nidia@wanderlust.properties',
  'margie@wanderlust.properties'
];

function doGet() {
  return json_({ ok: true, service: 'Wanderlust Stage 2 Analysis', version: APP_VERSION });
}

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    validateToken_(request.token);
    switch (request.action) {
      case 'analyze': return json_({ ok: true, analysis: analyzeProperty_(request) });
      case 'startAnalyze': return json_({ ok: true, job: startPropertyAnalysis_(request) });
      case 'startCompleteGrades': return json_({ ok: true, job: startCompleteGrades_(request) });
      case 'startRecalculate': return json_({ ok: true, job: startRecalculate_(request.analysis) });
      case 'poll': return json_({ ok: true, job: pollAnalysis_(request) });
      case 'recalculate': return json_({ ok: true, analysis: recalculate_(request.analysis) });
      case 'analyzeImages': return json_({ ok: true, analysis: analyzeImages_(request.analysis, request.images || []) });
      case 'uploadImage': return json_({ ok: true, image: uploadImage_(request) });
      case 'saveDraft': return json_(saveDraft_(request));
      case 'saveAndDeliver': return json_(saveAndDeliver_(request));
      case 'save': return json_({ ok: true, id: saveAnalysis_(request.analysis) });
      case 'list': return json_({ ok: true, items: listAnalyses_() });
      case 'load': return json_({ ok: true, analysis: loadAnalysis_(request.id) });
      default: throw new Error('Unsupported action.');
    }
  } catch (error) {
    return json_({ ok: false, error: error && error.message ? error.message : String(error) });
  }
}

function analyzeProperty_(request) {
  if (!request.address) throw new Error('Property address is required.');
  const result = callOpenAI_(buildInitialInput_(request), true);
  normalizeAnalysis_(result, request.address, request.ownership || '');
  return result;
}

function buildInitialInput_(request) {
  const input = [{
    role: 'user',
    content: [{ type: 'input_text', text: initialPrompt_(request.address, request.ownership || '') }]
  }];
  if (request.dataScoutImage) {
    input[0].content.push({ type: 'input_image', image_url: request.dataScoutImage, detail: 'high' });
    input[0].content.push({ type: 'input_text', text: 'The attached image is an optional ACT DataScout screenshot. Extract only facts that are visibly supported.' });
  }
  return input;
}

function startPropertyAnalysis_(request) {
  if (!request.address) throw new Error('Property address is required.');
  return startOpenAIBackground_(buildInitialInput_(request), true);
}

function startCompleteGrades_(request) {
  const analysis = request.analysis;
  if (!analysis || !analysis.address) throw new Error('Analysis is missing.');
  const content = [{ type: 'input_text', text: completeGradesPrompt_(analysis) }];
  if (request.includeImages !== false) {
    (analysis.evidenceImages || []).slice(0, 6).forEach(function(image) {
      const url = typeof image === 'string' ? image : image && image.url;
      if (/^https:\/\//i.test(String(url || ''))) {
        content.push({ type: 'input_image', image_url: url, detail: 'high' });
      }
    });
  }
  return startOpenAIBackground_([{ role: 'user', content: content }], true);
}

function completeGradesPrompt_(analysis) {
  return [
    'Complete the non-ARV portions of this preliminary Stage 2 analysis for ' + analysis.address + '.',
    'This is a focused second pass. Perform fresh targeted web research for every construction, intangible, and additional field. Inspect every attached subject-property image. Use the prior facts, source links, listing descriptions, and ownership note as supporting evidence.',
    'Return the complete required JSON schema and preserve the prior address, ownership, facts, and ARV exactly.',
    'For construction and visual intangibles, make the best supportable recommendation from subject photos and descriptions. Use Low confidence for dated, partial, or indirect evidence. Use Unknown only if neither images nor researched descriptions support a responsible entry.',
    'For nonvisual intangibles, compare the confirmed existing configuration with the ordinary local buyer pool. Do not grade protected characteristics or demographics.',
    'For Additional Stage 2 fields, conduct a distinct search for each field. Google Search is Passed unless a material adverse result is found. Research vacancy or occupancy signals, sewer or septic, road classification, USDA eligibility, and FEMA or authoritative flood risk. Use a concise reason and confidence for each.',
    'Prior analysis: ' + JSON.stringify(analysis)
  ].join('\n');
}

function recalculate_(analysis) {
  if (!analysis || !analysis.address) throw new Error('Analysis is missing.');
  const result = callOpenAI_([{ role: 'user', content: [{ type: 'input_text', text: recalculatePrompt_(analysis) }] }], true);
  normalizeAnalysis_(result, analysis.address, analysis.ownership || '');
  return result;
}

function recalculatePrompt_(analysis) {
  const facts = (analysis.facts || []).reduce(function(map, fact) {
    map[fact.key] = fact.confirmedValue;
    return map;
  }, {});
  return [
    'Recalculate only the preliminary ARV portion of this Stage 2 analysis using the confirmed existing configuration below.',
    'Do fresh web research. Produce a balanced, market-supported preliminary range; do not discount the value merely because this is Stage 2. Do not assume additions, conversions, added bedrooms/bathrooms, added square footage, or other post-walk value creation.',
    'Value the confirmed existing configuration after a competent, market-appropriate restoration. Use relevant ordinary restored sold properties as the primary range evidence. Use active listings and materially superior, waterfront, acreage, newer, or income-producing properties only to test a credible street or neighborhood ceiling.',
    'The low value is the defensible restored-value floor supported by relevant ordinary comps. The high value is the supported upper end for the same ordinary restored configuration. ARV Ceiling is a downward location cap: it must equal the high ARV when no lower neighborhood cap is supported, or be lower when the street or neighborhood limits value. It must never exceed the high ARV total.',
    'Return the complete analysis JSON schema. Only the ARV and supporting source links will be applied by the app; all prior grading and evidence are preserved deterministically.',
    'Address: ' + analysis.address,
    'Confirmed facts: ' + JSON.stringify(facts),
    'Prior analysis: ' + JSON.stringify(analysis)
  ].join('\n');
}

function startRecalculate_(analysis) {
  if (!analysis || !analysis.address) throw new Error('Analysis is missing.');
  return startOpenAIBackground_([{ role: 'user', content: [{ type: 'input_text', text: recalculatePrompt_(analysis) }] }], true);
}

function analyzeImages_(analysis, images) {
  if (!analysis) throw new Error('Analysis is missing.');
  if (!images.length) return analysis;
  const content = [{
    type: 'input_text',
    text: [
      'Analyze the attached exterior property images for a preliminary Stage 2 screen.',
      'Update only construction grades (Siding, Windows, Roof, Exterior) and visual intangibles (Curb Appeal, Neighbors, Parking, Yard).',
      'Use: Siding 0 serviceable, .5 paint, 1 replacement. Windows 0 serviceable, .5 replacement. Roof 0 no indication, .5 replacement, 1 complicated roofline or probable decking replacement. Exterior 0 no material neglect, .5 unkept yard, 1 unkept plus trash, 1.5 severe neglect such as broken windows or gutter vegetation.',
      'Intangibles must be Positive, Neutral, or Negative. Never infer protected personal or demographic characteristics for Neighbors; evaluate only visible surrounding-property condition and market compatibility.',
      'Return the complete analysis JSON schema, retaining all other values.',
      'Current analysis: ' + JSON.stringify(analysis)
    ].join('\n')
  }];
  images.slice(0, 6).forEach(function(image) { content.push({ type: 'input_image', image_url: image, detail: 'high' }); });
  const result = callOpenAI_([{ role: 'user', content: content }], false);
  normalizeAnalysis_(result, analysis.address, analysis.ownership || '');
  return result;
}

function callOpenAI_(input, useWebSearch) {
  const properties = PropertiesService.getScriptProperties();
  const key = properties.getProperty('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY is not configured in Script Properties.');
  const payload = {
    model: properties.getProperty('OPENAI_MODEL') || DEFAULT_MODEL,
    instructions: developerPrompt_(),
    input: input,
    reasoning: { effort: 'medium' }
  };
  if (useWebSearch) {
    payload.tools = [{ type: 'web_search', search_context_size: 'medium' }];
  } else {
    payload.text = { format: { type: 'json_object' } };
  }
  const response = UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('OpenAI request failed (' + code + '): ' + body.slice(0, 500));
  const parsed = JSON.parse(body);
  const outputText = extractOutputText_(parsed);
  if (!outputText) throw new Error('OpenAI returned no structured analysis.');
  try {
    return parseJsonOutput_(outputText);
  } catch (parseError) {
    if (!useWebSearch) throw parseError;
    return repairJsonOutput_(outputText, properties.getProperty('OPENAI_MODEL') || DEFAULT_MODEL, key);
  }
}

function startOpenAIBackground_(input, useWebSearch) {
  const properties = PropertiesService.getScriptProperties();
  const key = properties.getProperty('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY is not configured in Script Properties.');
  const payload = {
    model: properties.getProperty('OPENAI_MODEL') || DEFAULT_MODEL,
    instructions: developerPrompt_(),
    input: input,
    reasoning: { effort: 'medium' },
    background: true
  };
  if (useWebSearch) {
    payload.tools = [{ type: 'web_search', search_context_size: 'medium' }];
  } else {
    payload.text = { format: { type: 'json_object' } };
  }
  const response = UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('OpenAI background request failed (' + code + '): ' + body.slice(0, 500));
  const parsed = JSON.parse(body);
  if (!parsed.id) throw new Error('OpenAI did not return a background job ID.');
  return { id: parsed.id, status: parsed.status || 'queued' };
}

function pollAnalysis_(request) {
  const id = String(request.jobId || '');
  if (!/^resp_[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid analysis job ID.');
  const properties = PropertiesService.getScriptProperties();
  const key = properties.getProperty('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY is not configured in Script Properties.');
  const response = UrlFetchApp.fetch('https://api.openai.com/v1/responses/' + encodeURIComponent(id), {
    method: 'get', headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('OpenAI polling failed (' + code + '): ' + body.slice(0, 500));
  const parsed = JSON.parse(body);
  if (parsed.status === 'queued' || parsed.status === 'in_progress') {
    return { id: id, status: parsed.status };
  }
  if (parsed.status !== 'completed') {
    const detail = parsed.error && parsed.error.message ? parsed.error.message : parsed.status;
    throw new Error('Stage 2 research did not complete: ' + detail);
  }
  const outputText = extractOutputText_(parsed);
  if (!outputText) throw new Error('OpenAI returned no completed Stage 2 analysis.');
  let analysis;
  try {
    analysis = parseJsonOutput_(outputText);
  } catch (error) {
    analysis = repairJsonOutput_(outputText, properties.getProperty('OPENAI_MODEL') || DEFAULT_MODEL, key);
  }
  normalizeAnalysis_(analysis, String(request.address || analysis.address || ''), String(request.ownership || analysis.ownership || ''));
  return { id: id, status: 'completed', analysis: analysis };
}

function parseJsonOutput_(text) {
  const cleaned = String(text || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw error;
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function repairJsonOutput_(outputText, model, key) {
  const response = UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({
      model: model,
      instructions: developerPrompt_(),
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: 'Convert the following completed research into the required JSON object. Preserve its facts, estimates, evidence, and source links. Return JSON only.\n\n' + outputText
        }]
      }],
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_object' } }
    }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('OpenAI JSON repair failed (' + code + '): ' + body.slice(0, 500));
  const parsed = JSON.parse(body);
  const repairedText = extractOutputText_(parsed);
  if (!repairedText) throw new Error('OpenAI returned no repaired JSON analysis.');
  return parseJsonOutput_(repairedText);
}

function extractOutputText_(response) {
  if (response.output_text) return response.output_text;
  const chunks = [];
  (response.output || []).forEach(function(item) {
    (item.content || []).forEach(function(part) {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
    });
  });
  return chunks.join('');
}

function normalizeAnalysis_(analysis, address, ownership) {
  analysis.address = address;
  analysis.ownership = ownership;
  analysis.createdAt = analysis.createdAt || new Date().toISOString();
  analysis.updatedAt = new Date().toISOString();
  analysis.status = 'draft';
  analysis.evidenceImages = Array.isArray(analysis.evidenceImages) ? analysis.evidenceImages : [];
  analysis.sourceLinks = Array.isArray(analysis.sourceLinks) ? analysis.sourceLinks : [];
  analysis.facts = normalizeFacts_(analysis.facts);
  analysis.arv = normalizeArv_(analysis.arv);
  analysis.construction = normalizeGradeRows_(analysis.construction, [
    { label: 'Base', value: '2.5', reason: 'Standard Stage 2 rehabilitation base.' },
    { label: 'Premium', value: 'Unknown' },
    { label: 'Siding', value: 'Unknown' },
    { label: 'Windows', value: 'Unknown' },
    { label: 'Roof', value: 'Unknown' },
    { label: 'Exterior', value: 'Unknown' }
  ]);
  analysis.intangibles = normalizeGradeRows_(analysis.intangibles, [
    { label: 'Comp Risk', value: 'Unknown' },
    { label: 'Basement', value: 'Unknown' },
    { label: 'Beds / Baths', value: 'Unknown' },
    { label: 'Curb Appeal', value: 'Unknown' },
    { label: 'Neighbors', value: 'Unknown' },
    { label: 'Parking', value: 'Unknown' },
    { label: 'Yard', value: 'Unknown' }
  ]);
  analysis.additional = normalizeGradeRows_(analysis.additional, [
    { label: 'Google Search', value: 'Unknown' },
    { label: 'Vacant', value: 'Unknown' },
    { label: 'Septic', value: 'Unknown' },
    { label: 'Road Type', value: 'Unknown' },
    { label: 'USDA', value: 'Unknown' },
    { label: 'Flood Risk', value: 'Unknown' }
  ]);
  const knownConstruction = analysis.construction.filter(function(row) { return !isNaN(Number(row.value)); });
  const constructionSum = knownConstruction.reduce(function(sum, row) { return sum + Number(row.value); }, 0);
  analysis.constructionTotal = String(constructionSum);
  analysis.constructionConfidence = normalizeConfidence_(analysis.constructionConfidence);
}

function normalizeFacts_(facts) {
  const definitions = [
    ['propertyType', 'Property type'], ['bedrooms', 'Bedrooms'], ['fullBaths', 'Full bathrooms'],
    ['halfBaths', 'Half bathrooms'], ['squareFeet', 'Living area'], ['lotSize', 'Lot size'],
    ['stories', 'Stories'], ['basement', 'Basement'], ['parking', 'Garage / carport'],
    ['waterfront', 'Waterfront / access']
  ];
  const supplied = Array.isArray(facts) ? facts : [];
  return definitions.map(function(definition) {
    const found = supplied.find(function(item) { return item && item.key === definition[0]; }) || {};
    const aiValue = String(found.aiValue || found.confirmedValue || 'Unknown');
    return {
      key: definition[0], label: definition[1], aiValue: aiValue,
      confirmedValue: String(found.confirmedValue || aiValue), conflict: Boolean(found.conflict),
      sources: Array.isArray(found.sources) ? found.sources : []
    };
  });
}

function normalizeArv_(arv) {
  arv = arv || {};
  const confidence = normalizeConfidence_(arv.confidence);
  const lowPsf = Number(arv.lowPsf) || 0;
  let highPsf = Number(arv.highPsf) || 0;
  const originalHighTotal = Number(arv.highTotal) || 0;
  const proposedCeiling = Number(arv.ceiling) || originalHighTotal;
  const proposedCeilingReason = String(arv.ceilingReason || '').trim();
  const hasDistinctSupportedCap = Boolean(
    originalHighTotal &&
    proposedCeiling > 0 &&
    proposedCeiling < originalHighTotal &&
    proposedCeilingReason
  );
  const inferredSquareFeet = lowPsf && Number(arv.lowTotal)
    ? Number(arv.lowTotal) / lowPsf
    : (highPsf && Number(arv.highTotal) ? Number(arv.highTotal) / highPsf : 0);
  const minimumSpread = confidence === 'Low' ? 30 : 20;

  if (lowPsf && highPsf && highPsf - lowPsf < minimumSpread) {
    highPsf = lowPsf + minimumSpread;
  }

  const lowTotal = lowPsf && inferredSquareFeet
    ? Math.round(lowPsf * inferredSquareFeet)
    : (Number(arv.lowTotal) || 0);
  const highTotal = highPsf && inferredSquareFeet
    ? Math.round(highPsf * inferredSquareFeet)
    : (Number(arv.highTotal) || 0);
  return {
    lowPsf: lowPsf, lowTotal: lowTotal,
    highPsf: highPsf, highTotal: highTotal,
    ceiling: highTotal ? (hasDistinctSupportedCap ? Math.min(proposedCeiling, highTotal) : highTotal) : 0,
    ceilingReason: hasDistinctSupportedCap ? proposedCeilingReason : '',
    confidence: confidence
  };
}

function normalizeGradeRows_(rows, definitions) {
  const supplied = Array.isArray(rows) ? rows : [];
  return definitions.map(function(definition, index) {
    const target = definition.label.toLowerCase().replace(/[^a-z0-9]/g, '');
    const found = supplied.find(function(item) {
      return item && String(item.label || '').toLowerCase().replace(/[^a-z0-9]/g, '') === target;
    }) || (supplied[index] && !supplied[index].label ? supplied[index] : {});
    return {
      label: definition.label,
      value: String(found.value !== undefined && found.value !== null ? found.value : definition.value),
      confidence: normalizeConfidence_(found.confidence),
      reason: String(found.reason || definition.reason || 'Insufficient public evidence.'),
      images: Array.isArray(found.images) ? found.images : []
    };
  });
}

function normalizeConfidence_(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'high') return 'High';
  if (normalized === 'moderate' || normalized === 'medium') return 'Moderate';
  if (normalized === 'low') return 'Low';
  return 'Unknown';
}

function initialPrompt_(address, ownership) {
  return [
    'Run a preliminary Stage 2 property analysis for: ' + address,
    ownership ? 'User-supplied ownership/acquisition note: ' + ownership : 'Ownership/acquisition type was not supplied.',
    'Research public property facts, current and archived listing information, relevant sold and active properties, street-level or listing imagery when accessible, flood information, USDA eligibility, road type, utilities, and occupancy signals.',
    'This is a five-to-ten-minute pre-walk opportunity screen. Its purpose is to decide whether the property has enough plausible restored-value upside to justify investing approximately one to one-and-a-half hours in a physical walk. It is not an appraisal, a final ARV, or an offer-construction tool; those belong in Stage 4. Favor preserving a plausible acquisition opportunity over presenting false precision because an unnecessary walk is less costly than incorrectly rejecting a viable property. Evaluate a balanced, market-supported ARV range for the property’s EXISTING publicly supported configuration after a competent, market-appropriate restoration. Do not reduce the estimate merely because this is Stage 2. Do not assume additions, room conversions, added bedrooms or bathrooms, added square footage, or other value creation that would require a property walk.',
    'If sources disagree, mark the affected fact conflict=true, show a concise combined AI finding, and choose a conservative confirmedValue for the user to edit against Master Suite.',
    'For ARV, use relevant ordinary restored sold properties as primary evidence. The low and high values must describe the probable market-supported range for the same existing configuration after competent restoration. Do not use an as-is sale, assessed value, AVM, or one unusually low comp as the restored-value floor. When exact comps are scarce, use the broader cluster of the best ordinary restored evidence and express that uncertainty by widening the range toward the plausible high side rather than shifting the entire range downward. Use a minimum spread of $20 per square foot for High or Moderate confidence and $30 per square foot for Low confidence. Treat waterfront, lake-view, acreage, newer construction, superior amenities, and income-producing properties only as secondary evidence when the subject lacks those traits. ARV Ceiling is only a downward street or neighborhood cap: it must equal the high ARV when no lower cap is supported, or be lower than the high ARV when a location cap applies. It must never exceed highTotal. Do not average AVMs. Return rounded whole-dollar per-square-foot values and matching totals.',
    'Attempt photo-based preliminary grades and research-based Stage 2 entries. Make a best-supported suggested entry whenever public evidence permits, with Low confidence when evidence is indirect or dated. Use Unknown only after reasonable searches fail to support any responsible suggestion.',
    'Return only the required JSON.'
  ].join('\n');
}

function developerPrompt_() {
  return [
    'You are the Wanderlust Properties Stage 2 Analysis engine for Hot Springs, Arkansas acquisition screening.',
    'Return one valid JSON object and no prose outside it. No methodology narrative belongs in the user interface.',
    'Required top-level keys: address, ownership, createdAt, updatedAt, facts, arv, construction, constructionTotal, constructionConfidence, intangibles, additional, evidenceImages, sourceLinks, status.',
    'facts is an array of exactly these keys and labels: propertyType/Property type, bedrooms/Bedrooms, fullBaths/Full bathrooms, halfBaths/Half bathrooms, squareFeet/Living area, lotSize/Lot size, stories/Stories, basement/Basement, parking/Garage / carport, waterfront/Waterfront / access. Each item: {key,label,aiValue,confirmedValue,conflict,sources}. Every confirmedValue must be a non-empty string; use Unknown if necessary.',
    'arv: {lowPsf,lowTotal,highPsf,highTotal,ceiling,ceilingReason,confidence}. confidence must be High, Moderate, Low, or Unknown. Default ceiling to highTotal and return ceilingReason as an empty string. Only return a ceiling below highTotal when specific street or neighborhood market evidence demonstrates that the otherwise supported restored comp range cannot be achieved at the subject; in that exceptional case, ceilingReason must state the concrete evidence in one concise sentence. Never lower the ceiling merely because comps are scarce, confidence is Low or Moderate, the subject needs renovation, or the range is broad.',
    'construction must contain Base, Premium, Siding, Windows, Roof, Exterior. Each: {label,value,confidence,reason,images}. Base is always 2.5. Premium is 0 ordinary, .5 foreclosure, 1 tax sale. Siding 0 serviceable, .5 paint, 1 replacement. Windows 0 serviceable, .5 replacement. Roof 0 no visible need, .5 replacement, 1 complicated roofline or probable decking. Exterior 0 no material neglect, .5 unkept yard, 1 unkept plus trash, 1.5 severe neglect. constructionTotal is the numeric sum as a string. Reasons must be one short sentence. Images contain only verified direct image URLs with source/date/label.',
    'intangibles must contain Comp Risk, Basement, Beds / Baths, Curb Appeal, Neighbors, Parking, Yard. Values are only Positive, Neutral, Negative, or Unknown. Every entry must include a concise one-sentence reason explaining the property evidence and market logic behind the suggested grade so the user can decide whether to override it later in Master Suite. Confidence is required. For Beds / Baths, state whether the existing count and primary-suite functionality are typical or deficient for the likely restored market. For Parking, evaluate both formal covered parking and the practical amount of usable on-site parking; do not assign Negative solely because a garage is absent when the lot provides adequate usable parking. For Yard, distinguish current visible condition from size, usability, and improvement potential when those are publicly observable. Neighbors means visible property condition and market compatibility only, never people or demographics.',
    'additional must contain Google Search, Vacant, Septic, Road Type, USDA, Flood Risk. Each has value, confidence, and one short reason. Google Search should be Passed unless research finds a material adverse issue, then Failed; do not use Unknown merely because no adverse result appears. Vacant should state Vacant or Occupied when supported. Septic should state Septic or Public Sewer when supported. Road Type should state the supported road/utility classification. USDA should state Qualified or Not Qualified when an authoritative eligibility result supports it. Flood Risk should state the supported risk level. Use Unknown only when reasonable research cannot support a responsible suggestion.',
    'For construction and intangibles, inspect every verified subject image and listing description before using Unknown. A cautious visual recommendation with Low confidence is preferred to Unknown when there is observable evidence. Never invent visibility that is not present.',
    'Do not include Location Grade or Market Risk. Master Suite handles them.',
    'evidenceImages is a deduplicated list of verified subject-property image URLs only. sourceLinks is a deduplicated list of supporting pages as {label,url}. status is draft.'
  ].join('\n');
}

function saveAnalysis_(analysis) {
  if (!analysis || !analysis.address) throw new Error('Completed analysis is missing.');
  const folder = resolveAnalysisFolder_(analysis, analysis.uploadedImages || [], '');
  const now = new Date();
  const stamp = Utilities.formatDate(now, Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HHmmss');
  const safeAddress = analysis.address.replace(/[^a-zA-Z0-9 -]/g, '').replace(/\s+/g, ' ').trim();
  analysis.createdAt = analysis.createdAt || now.toISOString();
  analysis.updatedAt = now.toISOString();
  analysis.status = 'completed';
  analysis.appVersion = APP_VERSION;
  analysis.archiveFolderId = folder.getId();
  folder.setName('Stage 2 — ' + safeAddress + ' — ' + stamp);
  const file = upsertTextFile_(folder, 'Stage 2 Analysis.json', JSON.stringify(analysis, null, 2));
  analysis.id = file.getId();
  file.setContent(JSON.stringify(analysis, null, 2));
  return file.getId();
}

function saveDraft_(request) {
  const analysis = request.analysis;
  if (!analysis || !analysis.address) throw new Error('Analysis draft is missing its property address.');
  const images = Array.isArray(analysis.uploadedImages) ? analysis.uploadedImages : [];
  const folder = resolveAnalysisFolder_(analysis, images, request.draftId || '');
  const now = new Date();
  analysis.createdAt = analysis.createdAt || now.toISOString();
  analysis.updatedAt = now.toISOString();
  analysis.status = 'draft';
  analysis.appVersion = APP_VERSION;
  analysis.archiveFolderId = folder.getId();
  const file = upsertTextFile_(folder, 'Stage 2 Analysis.json', JSON.stringify(analysis, null, 2));
  analysis.id = file.getId();
  file.setContent(JSON.stringify(analysis, null, 2));
  return { ok: true, id: file.getId(), folderId: folder.getId(), savedAt: analysis.updatedAt };
}

function uploadImage_(request) {
  if (!request.draftId) throw new Error('Draft ID is required for image storage.');
  const kind = request.kind === 'datascout' ? 'datascout' : 'property';
  const original = dataUrlBlob_(request.originalDataUrl, request.fileName || 'image');
  if (original.getBytes().length > 15 * 1024 * 1024) throw new Error('Each uploaded image must be 15 MB or smaller.');
  const draftFolder = findOrCreateDraftFolder_(request.draftId);
  const targetFolder = childFolder_(draftFolder, kind === 'datascout' ? 'ACT DataScout' : 'Property Photos');
  const thumbnailFolder = childFolder_(draftFolder, 'Report Thumbnails');
  const safeName = safeFileName_(request.fileName || (kind === 'datascout' ? 'DataScout Screenshot' : 'Property Photo'));
  original.setName(uniqueFileName_(targetFolder, safeName));
  const file = targetFolder.createFile(original);
  let thumbnailFileId = '';
  if (request.thumbnailDataUrl) {
    const thumbnail = dataUrlBlob_(request.thumbnailDataUrl, 'thumb-' + safeName);
    thumbnail.setName(uniqueFileName_(thumbnailFolder, 'thumb-' + safeName.replace(/\.[^.]+$/, '') + '.jpg'));
    thumbnailFileId = thumbnailFolder.createFile(thumbnail).getId();
  }
  return {
    fileId: file.getId(),
    thumbnailFileId: thumbnailFileId,
    name: file.getName(),
    kind: kind,
    viewUrl: driveFileUrl_(file.getId()),
    folderId: draftFolder.getId()
  };
}

function saveAndDeliver_(request) {
  const analysis = request.analysis;
  if (!analysis || !analysis.address) throw new Error('Completed analysis is missing.');
  const sendEmail = request.sendEmail === true;
  const recipients = validatedRecipients_(request.recipients || [], request.customEmail || '', sendEmail);
  const images = Array.isArray(analysis.uploadedImages) ? analysis.uploadedImages : [];
  const folder = resolveAnalysisFolder_(analysis, images, request.draftId || '');
  const now = new Date();
  const stamp = Utilities.formatDate(now, Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd HHmmss');
  const safeAddress = safeFileName_(analysis.address).replace(/\.[^.]+$/, '');
  folder.setName('Stage 2 — ' + safeAddress + ' — ' + stamp);
  analysis.createdAt = analysis.createdAt || now.toISOString();
  analysis.updatedAt = now.toISOString();
  analysis.status = 'completed';
  analysis.appVersion = APP_VERSION;
  analysis.archiveFolderId = folder.getId();
  analysis.photosUrl = driveFolderUrl_(folder.getId());

  APPROVED_RECIPIENTS.forEach(function(email) {
    try { folder.addViewer(email); } catch (ignore) {}
  });

  const reportName = 'Stage 2 Analysis — ' + safeAddress + '.pdf';
  const reportHtml = buildReportHtml_(analysis, images, folder);
  const reportBlob = HtmlService.createHtmlOutput(reportHtml).getBlob().getAs(MimeType.PDF).setName(reportName);
  const reportFile = replaceBlobFile_(folder, reportName, reportBlob);
  analysis.reportUrl = driveFileUrl_(reportFile.getId());

  const jsonFile = replaceFile_(folder, 'Stage 2 Analysis.json', JSON.stringify(analysis, null, 2), MimeType.PLAIN_TEXT);
  analysis.id = jsonFile.getId();
  analysis.delivery = {
    recipients: sendEmail ? recipients : [],
    deliveredAt: sendEmail ? now.toISOString() : '',
    reportFileId: reportFile.getId(),
    build: APP_VERSION
  };
  jsonFile.setContent(JSON.stringify(analysis, null, 2));

  if (sendEmail) sendReportEmail_(analysis, recipients, reportFile, folder);
  return {
    ok: true,
    id: jsonFile.getId(),
    folderId: folder.getId(),
    reportUrl: analysis.reportUrl,
    photosUrl: analysis.photosUrl,
    recipients: recipients
  };
}

function listAnalyses_() {
  const root = archiveFolder_();
  const items = [];
  const files = root.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (!/\.json$/i.test(file.getName())) continue;
    try {
      const analysis = JSON.parse(file.getBlob().getDataAsString());
      items.push({ id: file.getId(), address: analysis.address || file.getName(), createdAt: analysis.createdAt || file.getDateCreated().toISOString(), arvLow: analysis.arv && analysis.arv.lowTotal, arvHigh: analysis.arv && analysis.arv.highTotal });
    } catch (ignore) {}
  }
  const folders = root.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    const matches = folder.getFilesByName('Stage 2 Analysis.json');
    if (!matches.hasNext()) continue;
    const file = matches.next();
    try {
      const analysis = JSON.parse(file.getBlob().getDataAsString());
      items.push({ id: file.getId(), address: analysis.address || folder.getName(), createdAt: analysis.createdAt || file.getDateCreated().toISOString(), arvLow: analysis.arv && analysis.arv.lowTotal, arvHigh: analysis.arv && analysis.arv.highTotal });
    } catch (ignore) {}
  }
  items.sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return items.slice(0, 200);
}

function loadAnalysis_(id) {
  if (!id) throw new Error('Analysis ID is required.');
  const file = DriveApp.getFileById(id);
  if (!fileIsInArchive_(file)) throw new Error('Analysis is outside the configured archive.');
  return JSON.parse(file.getBlob().getDataAsString());
}

function buildReportHtml_(analysis, images, analysisFolder) {
  const facts = Array.isArray(analysis.facts) ? analysis.facts : [];
  const construction = Array.isArray(analysis.construction) ? analysis.construction : [];
  const intangibles = Array.isArray(analysis.intangibles) ? analysis.intangibles : [];
  const additional = Array.isArray(analysis.additional) ? analysis.additional : [];
  const propertyImages = images.filter(function(image) { return image && image.kind === 'property'; });
  const sources = Array.isArray(analysis.sourceLinks) ? analysis.sourceLinks : [];
  const arv = analysis.arv || {};
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@page{size:letter;margin:.48in}body{font-family:Arial,sans-serif;color:#17222d;font-size:10pt;line-height:1.35}h1{font-family:Georgia,serif;color:#173c31;font-size:24pt;margin:0 0 4px}h2{font-family:Georgia,serif;color:#173c31;font-size:15pt;margin:20px 0 8px;border-bottom:2px solid #d4ab63;padding-bottom:4px}.brand{color:#9c6c25;font-size:8pt;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase}.meta{color:#66727f;margin-bottom:16px}.notice{background:#edf6f0;border-left:4px solid #2e6b50;padding:9px 11px;margin:12px 0}.metrics{width:100%;border-collapse:separate;border-spacing:6px}.metrics td{border:1px solid #d7dfdc;border-radius:6px;padding:10px}.metrics span{display:block;color:#657181;font-size:8pt}.metrics strong{display:block;font-size:16pt;margin-top:3px}.data{width:100%;border-collapse:collapse}.data th{background:#edf1ef;color:#42515d;text-align:left;font-size:8pt;text-transform:uppercase;letter-spacing:.5px}.data th,.data td{border:1px solid #d7dfdc;padding:6px;vertical-align:top}.photos{display:flex;flex-wrap:wrap;gap:9px}.photo{width:31%;page-break-inside:avoid}.photo img{width:100%;height:115px;object-fit:cover;border:1px solid #d7dfdc}.photo a{display:block;color:#215a45;font-size:8pt;margin-top:3px;text-decoration:none}.sources{font-size:8pt;word-break:break-all}.footer{margin-top:20px;border-top:1px solid #d7dfdc;padding-top:7px;color:#6b7580;font-size:8pt}' +
    '</style></head><body>' +
    '<div class="brand">Wanderlust Properties · Stage 2 Analysis</div>' +
    '<h1>' + html_(analysis.address) + '</h1>' +
    '<div class="meta">Prepared ' + html_(formatReportDate_(analysis.updatedAt || new Date().toISOString())) + ' · Build 8' + (analysis.ownership ? ' · ' + html_(analysis.ownership) : '') + '</div>' +
    '<div class="notice"><strong>Preliminary screening report.</strong> This Stage 2 analysis supports the decision to investigate or walk a property. It is not a final valuation or an offer recommendation.</div>' +
    '<h2>Confirmed Property Configuration</h2>' + reportTable_(facts.map(function(item) { return [item.label, item.confirmedValue || item.aiValue || '—']; }), ['Property fact', 'Confirmed value']) +
    '<h2>Preliminary ARV</h2><table class="metrics"><tr>' +
      metricHtml_('Low ARV / sq. ft.', currency_(arv.lowPsf)) + metricHtml_('Low ARV total', currency_(arv.lowTotal)) + metricHtml_('High ARV / sq. ft.', currency_(arv.highPsf)) +
      '</tr><tr>' + metricHtml_('High ARV total', currency_(arv.highTotal)) + metricHtml_('ARV Ceiling', currency_(arv.ceiling)) + metricHtml_('Confidence', arv.confidence || 'Unknown') + '</tr></table>' +
    (arv.ceilingReason ? '<p><strong>ARV ceiling:</strong> ' + html_(arv.ceilingReason) + '</p>' : '') +
    '<h2>Preliminary Construction Grade</h2>' + reportGradeTable_(construction) + '<p><strong>Preliminary total:</strong> ' + html_(analysis.constructionTotal || '—') + ' · ' + html_(analysis.constructionConfidence || 'Unknown') + ' confidence</p>' +
    '<h2>Intangible Grading</h2>' + reportGradeTable_(intangibles) +
    '<h2>Additional Stage 2 Findings</h2>' + reportGradeTable_(additional) +
    (propertyImages.length ? '<h2>Property Photo Evidence</h2><div class="photos">' + propertyImages.map(photoHtml_).join('') + '</div><p><a href="' + driveFolderUrl_(analysisFolder.getId()) + '">View the full-resolution property photo archive</a></p>' : '') +
    (sources.length ? '<h2>Research Sources</h2><div class="sources">' + sources.map(function(source) { return '<p><a href="' + attr_(source.url) + '">' + html_(source.label || source.url) + '</a></p>'; }).join('') + '</div>' : '') +
    '<div class="footer">Wanderlust Properties · Stage 2 Analysis · Build 8</div></body></html>';
}

function reportTable_(rows, headers) {
  return '<table class="data"><thead><tr>' + headers.map(function(header) { return '<th>' + html_(header) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function(row) { return '<tr>' + row.map(function(value) { return '<td>' + html_(value) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
}

function reportGradeTable_(rows) {
  return reportTable_(rows.map(function(row) { return [row.label, row.value, row.confidence + ' confidence', row.reason || '—']; }), ['Field', 'Suggested entry', 'Confidence', 'Brief reason']);
}

function metricHtml_(label, value) { return '<td><span>' + html_(label) + '</span><strong>' + html_(value) + '</strong></td>'; }

function photoHtml_(image) {
  let dataUrl = '';
  try {
    const id = image.thumbnailFileId || image.fileId;
    const blob = DriveApp.getFileById(id).getBlob();
    dataUrl = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (ignore) {}
  if (!dataUrl) return '';
  return '<div class="photo"><a href="' + attr_(image.viewUrl || driveFileUrl_(image.fileId)) + '"><img src="' + dataUrl + '"></a><a href="' + attr_(image.viewUrl || driveFileUrl_(image.fileId)) + '">' + html_(image.name || 'Open full photo') + '</a></div>';
}

function sendReportEmail_(analysis, recipients, reportFile, folder) {
  const subject = 'Stage 2 Analysis — ' + analysis.address;
  const body = 'The completed Stage 2 Analysis for ' + analysis.address + ' is attached.\n\nOpen report: ' + driveFileUrl_(reportFile.getId()) + '\nView full photos: ' + driveFolderUrl_(folder.getId());
  const htmlBody = '<p>The completed Stage 2 Analysis for <strong>' + html_(analysis.address) + '</strong> is attached.</p><p><a href="' + driveFileUrl_(reportFile.getId()) + '">Open the saved PDF</a></p><p><a href="' + driveFolderUrl_(folder.getId()) + '">View the full-resolution property photos</a></p><p style="color:#66727f;font-size:12px">This is a preliminary screening analysis, not a final valuation or offer recommendation.</p>';
  MailApp.sendEmail({ to: recipients.join(','), subject: subject, body: body, htmlBody: htmlBody, attachments: [reportFile.getBlob()] });
}

function validatedRecipients_(selected, customEmail, required) {
  const recipients = [];
  (Array.isArray(selected) ? selected : []).forEach(function(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (APPROVED_RECIPIENTS.indexOf(normalized) !== -1 && recipients.indexOf(normalized) === -1) recipients.push(normalized);
  });
  const custom = String(customEmail || '').trim().toLowerCase();
  if (custom) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(custom)) throw new Error('Enter a valid additional email address.');
    if (recipients.indexOf(custom) === -1) recipients.push(custom);
  }
  if (required && !recipients.length) throw new Error('Select at least one report recipient.');
  return recipients;
}

function resolveAnalysisFolder_(analysis, images, draftId) {
  const root = archiveFolder_();
  const candidateId = analysis.archiveFolderId || (images[0] && images[0].folderId);
  if (candidateId) {
    const candidate = DriveApp.getFolderById(candidateId);
    if (folderIsChildOf_(candidate, root.getId())) return candidate;
  }
  return draftId ? findOrCreateDraftFolder_(draftId) : root.createFolder('Stage 2 Draft — ' + Utilities.getUuid());
}

function findOrCreateDraftFolder_(draftId) {
  const root = archiveFolder_();
  const name = 'Stage 2 Draft — ' + safeFileName_(draftId);
  const matches = root.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : root.createFolder(name);
}

function childFolder_(parent, name) { const matches = parent.getFoldersByName(name); return matches.hasNext() ? matches.next() : parent.createFolder(name); }
function folderIsChildOf_(folder, parentId) { const parents = folder.getParents(); while (parents.hasNext()) if (parents.next().getId() === parentId) return true; return false; }
function fileIsInArchive_(file) { const rootId = archiveFolder_().getId(); const parents = file.getParents(); while (parents.hasNext()) { const parent = parents.next(); if (parent.getId() === rootId || folderIsChildOf_(parent, rootId)) return true; } return false; }
function replaceFile_(folder, name, content, mimeType) { trashNamedFiles_(folder, name); return folder.createFile(name, content, mimeType); }
function upsertTextFile_(folder, name, content) { const files = folder.getFilesByName(name); if (files.hasNext()) { const file = files.next(); file.setContent(content); return file; } return folder.createFile(name, content, MimeType.PLAIN_TEXT); }
function replaceBlobFile_(folder, name, blob) { trashNamedFiles_(folder, name); blob.setName(name); return folder.createFile(blob); }
function trashNamedFiles_(folder, name) { const files = folder.getFilesByName(name); while (files.hasNext()) files.next().setTrashed(true); }
function uniqueFileName_(folder, name) { if (!folder.getFilesByName(name).hasNext()) return name; const dot = name.lastIndexOf('.'); return (dot > 0 ? name.slice(0, dot) : name) + ' — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'HHmmss') + (dot > 0 ? name.slice(dot) : ''); }
function dataUrlBlob_(dataUrl, name) { const match = String(dataUrl || '').match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/); if (!match) throw new Error('The uploaded image format is invalid.'); return Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], safeFileName_(name)); }
function safeFileName_(value) { return String(value || 'file').replace(/[^a-zA-Z0-9._ -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140) || 'file'; }
function driveFileUrl_(id) { return 'https://drive.google.com/file/d/' + id + '/view'; }
function driveFolderUrl_(id) { return 'https://drive.google.com/drive/folders/' + id; }
function currency_(value) { const number = Number(value); return number ? '$' + Math.round(number).toLocaleString('en-US') : '—'; }
function formatReportDate_(value) { return Utilities.formatDate(new Date(value), Session.getScriptTimeZone() || 'America/Chicago', 'MMMM d, yyyy h:mm a'); }
function html_(value) { return String(value === undefined || value === null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function attr_(value) { return html_(value); }

function archiveFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('STAGE2_ARCHIVE_FOLDER_ID');
  if (!id) throw new Error('STAGE2_ARCHIVE_FOLDER_ID is not configured in Script Properties.');
  return DriveApp.getFolderById(id);
}

function validateToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('SUBMISSION_TOKEN');
  if (!expected) throw new Error('SUBMISSION_TOKEN is not configured.');
  if (!token || token !== expected) throw new Error('Unauthorized request.');
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the Apps Script editor after supplying the parent Reports folder ID. */
function createStage2ArchiveFolder(reportsFolderId) {
  if (!reportsFolderId) throw new Error('Reports folder ID is required.');
  const parent = DriveApp.getFolderById(reportsFolderId);
  const matches = parent.getFoldersByName('Stage 2 Analysis Archive');
  const folder = matches.hasNext() ? matches.next() : parent.createFolder('Stage 2 Analysis Archive');
  PropertiesService.getScriptProperties().setProperty('STAGE2_ARCHIVE_FOLDER_ID', folder.getId());
  Logger.log('Stage 2 archive ready: ' + folder.getId());
  return folder.getId();
}
