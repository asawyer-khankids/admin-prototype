'use strict';

/* ============================================================
   DATA — REAL DATA LAYER
   computed.json is produced by build/preprocess.py from the
   raw items + roster CSVs. All visible numbers in the prototype
   are derived from this in-memory dataset.
   ============================================================ */

const DOMAINS = ['Overview', 'Math', 'Literacy', 'Language', 'Executive Function'];
const SKILL_DOMAINS = ['Math', 'Literacy', 'Language', 'Executive Function'];

// Canonical scale display names + ordering, sourced from
// "[SPEC] Assessment Reports for Educators.md" (Math Scales + Literacy Scales sections).
// Math + Literacy follow the SPEC's visual table order (which is age-of-first-assessment,
// not code-number order). Language + Executive Function aren't given an explicit order
// in the SPEC, so they follow code order.
const SCALE_DISPLAY = {
  'Math': [
    { code: 'MAT3',  name: 'Count 1-by-1' },
    { code: 'MAT4',  name: 'More or Less' },
    { code: 'MAT9',  name: 'Shapes' },
    { code: 'MAT8',  name: 'Measurement' },
    { code: 'MAT5',  name: 'Numerals' },
    { code: 'MAT7',  name: 'Patterns' },
    { code: 'MAT10', name: 'Positions' },
    { code: 'MAT2',  name: 'Subitizing' },
    { code: 'MAT6a', name: 'Addition' },
    { code: 'MAT6b', name: 'Subtraction' },
  ],
  'Literacy': [
    { code: 'LIT5',    name: 'Answering Questions' },
    { code: 'LIT3a',   name: 'Letter Names' },
    { code: 'LIT2',    name: 'Print Concepts' },
    { code: 'LIT4',    name: 'Retelling Stories' },
    { code: 'LIT1a',   name: 'Rhyming' },
    { code: 'LIT1c',   name: 'Segmenting' },
    { code: 'LIT1b',   name: 'Blending & Adding' },
    { code: 'LIT3bi',  name: 'Consonant Sounds' },
    { code: 'LIT3bii', name: 'Vowel Sounds' },
    { code: 'LIT1d',   name: 'Decoding & Encoding' },
  ],
  'Language': [
    { code: 'LAN6',  name: 'Vocabulary' },
    { code: 'LAN7a', name: 'Word Categories' },
    { code: 'LAN7b', name: 'Shared Characteristics' },
  ],
  'Executive Function': [
    { code: 'ATL5a', name: 'Hearts and Stars' },
    { code: 'ATL5b', name: 'Day and Night' },
    { code: 'ATL8',  name: 'Reverse Order Sequence' },
    { code: 'ATL9',  name: 'Dimensional Card Sort' },
  ],
};

// CD = Computed Data, populated by loadComputed() at startup.
const CD = {
  raw: null,                // full computed.json contents
  ready: false,             // true once loaded
  // Indices built after load:
  windowIdx: {},            // 'Fall 2025' -> 0
  scaleByIdx: [],           // [{leaf_path, code, name, domain, language}]
  scaleIdxByPath: {},       // leaf_path -> index
  scalesByDomain: {},       // 'Math' -> [scale_idx, ...]
  classByGroup: {},         // group_id -> {name, grade, school_id}
  schoolBySid: {},          // school_id -> {name, district_id}
  studentByIdx: [],         // [{user_id, name, group_id, school_id, district_id, language}]
  studentIdxByUid: {},      // user_id -> idx
  studentsByGroup: {},      // group_id -> [user_idx, ...]
  studentsBySchool: {},     // school_id -> [user_idx, ...]
  studentsByDistrict: {},   // district_id -> [user_idx, ...]
  // Pre-grouped levels for fast lookup:
  // levelsByUser[user_idx] = [{w: window_idx, s: scale_idx, r: rank}, ...]
  levelsByUser: [],
  // Demo dataset (loaded lazily; activated when slGate === 'demo'). Same shape
  // as levelsByUser, built from data/computed_demo.json.
  realLevelsByUser: [],
  demoLevelsByUser: null,
  demoLoaded: false,
  demoLoading: null,
};

// Aggregate a set of student indices into a counts array
// [na_count, age2_count, age3_count, age4_count, kinder_count] for a given scope.
//
// scaleSel: null/'Overview' (median across ALL scales attempted),
//           a domain name string (median across scales in that domain),
//           or a number (specific scale_idx).
// windowName: 'All assessment windows' or a specific window like 'Fall 2025'.
// languageFilter: 'EN' | 'SP' | 'All' | 'English' | 'Spanish' (UI label form).
// gradeFilter: 'Pre-K 3' | 'Pre-K 4' | 'Kindergarten' | 'All grades'.
function aggregateLevels(userIndices, scaleSel, windowName, languageFilter, gradeFilter) {
  const counts = [0, 0, 0, 0, 0];
  if (!CD.ready) return counts;
  const allWindows = !windowName || windowName === 'All assessment windows';
  const winIdx = allWindows ? null : CD.windowIdx[windowName];
  if (!allWindows && winIdx === undefined) return counts;
  const useDomain = typeof scaleSel === 'string' && scaleSel && scaleSel !== 'Overview';
  const useScale = typeof scaleSel === 'number';
  const domainScales = useDomain ? new Set(CD.scalesByDomain[scaleSel] || []) : null;
  // Normalize language filter to internal code form ('EN'/'SP'/'All').
  const langCode = languageFilter === 'English' ? 'EN'
                 : languageFilter === 'Spanish' ? 'SP'
                 : languageFilter || 'All';

  for (const ui of userIndices) {
    const stu = CD.studentByIdx[ui];
    if (!stu) continue;
    if (langCode && langCode !== 'All' && stu.language !== langCode) continue;
    if (gradeFilter && gradeFilter !== 'All grades') {
      const c = CD.classByGroup[stu.group_id];
      if (!c || c.grade !== gradeFilter) continue;
    }

    const userLevels = CD.levelsByUser[ui] || [];
    const ranks = [];
    for (const lvl of userLevels) {
      if (lvl.r === 0) continue; // skip attempts that didn't pass a module — SL only medians passes
      if (winIdx !== null && lvl.w !== winIdx) continue;
      if (useScale && lvl.s !== scaleSel) continue;
      if (useDomain && !domainScales.has(lvl.s)) continue;
      ranks.push(lvl.r);
    }
    // Apply SL gate (minimum passes required to receive a domain score). Skipped for
    // specific-scale views (scale-level levels don't need a multi-scale floor).
    const cls = CD.classByGroup[stu.group_id];
    const grade = cls ? cls.grade : 'Pre-K 4';
    const minRequired = useScale ? 1 : slGateMinPasses(scaleSel, grade, stu.language);
    let level = 0; // not assessed
    if (ranks.length >= minRequired) {
      ranks.sort((a, b) => a - b);
      // Lower median for ties (matches the SPEC's "median" rollup intent).
      level = ranks[Math.floor((ranks.length - 1) / 2)];
    }
    counts[level]++;
  }
  return counts;
}

// Aggregate per-scale-CODE levels: each student contributes their HIGHEST rank
// across the given scaleIndices (typically the EN + SP versions of one scale code).
// Per SPEC: "use the student's highest domain score for a given domain, regardless
// of language" — applied at the scale level so the standards-mode view doesn't
// split students who took the same scale in different languages.
function aggregateLevelsMergedByCode(userIndices, scaleIndices, windowName, languageFilter, gradeFilter) {
  const counts = [0, 0, 0, 0, 0];
  if (!CD.ready || !scaleIndices || scaleIndices.size === 0) return counts;
  const allWindows = !windowName || windowName === 'All assessment windows';
  const winIdx = allWindows ? null : CD.windowIdx[windowName];
  if (!allWindows && winIdx === undefined) return counts;
  const langCode = languageFilter === 'English' ? 'EN'
                 : languageFilter === 'Spanish' ? 'SP'
                 : languageFilter || 'All';

  for (const ui of userIndices) {
    const stu = CD.studentByIdx[ui];
    if (!stu) continue;
    if (langCode !== 'All' && stu.language !== langCode) continue;
    if (gradeFilter && gradeFilter !== 'All grades') {
      const c = CD.classByGroup[stu.group_id];
      if (!c || c.grade !== gradeFilter) continue;
    }
    let maxRank = 0;
    for (const lvl of (CD.levelsByUser[ui] || [])) {
      if (lvl.r === 0) continue;
      if (winIdx !== null && lvl.w !== winIdx) continue;
      if (!scaleIndices.has(lvl.s)) continue;
      if (lvl.r > maxRank) maxRank = lvl.r;
    }
    counts[maxRank]++;
  }
  return counts;
}

// Per-(domain, grade, language) completion thresholds from the SPEC. The student
// must pass at least this many scales in the domain to be considered "Completed".
// Kindergarten falls through to the Pre-K 4 thresholds (SPEC didn't specify KG).
const COMPLETION_THRESHOLDS = {
  'Pre-K 3': {
    'Math':               { EN: 6, SP: 6 },
    'Literacy':           { EN: 4, SP: 5 },
    'Language':           { EN: 3, SP: 3 },
    'Executive Function': { EN: 4, SP: 4 },
  },
  'Pre-K 4': {
    'Math':               { EN: 7, SP: 7 },
    'Literacy':           { EN: 6, SP: 7 },
    'Language':           { EN: 3, SP: 3 },
    'Executive Function': { EN: 4, SP: 4 },
  },
  // Default for grades not explicitly specced (e.g. Kindergarten): use Pre-K 4.
};

// Raw SPEC threshold for (domain, grade, language) — ignores user mode setting.
function specThresholdFor(domain, grade, languageCode) {
  if (domain === 'Overview') return null;
  const table = COMPLETION_THRESHOLDS[grade] || COMPLETION_THRESHOLDS['Pre-K 4'];
  const entry = table[domain];
  if (!entry) return null;
  return entry[languageCode] || entry.EN;
}

// Required passes adjusted for the current Completion Mode setting (used by AC + SP).
function requiredPassesFor(domain, grade, languageCode) {
  if (domain === 'Overview') return null;
  const spec = specThresholdFor(domain, grade, languageCode);
  if (spec == null) return null;
  const mode = (state && state.filters && state.filters.completionMode) || 'spec';
  if (mode === 'loose') return 1;
  if (mode === 'soft50') return Math.max(1, Math.round(spec / 2));
  return spec;
}

// Minimum passes a student must have within a domain to receive an SL domain score.
// (Students under this floor are counted as "Not Assessed" by aggregateLevels and aggregateReadiness.)
function slGateMinPasses(domain, grade, languageCode) {
  const mode = (state && state.filters && state.filters.slGate) || 'min1';
  if (mode === 'min1') return 1;
  if (mode === 'min2') return 2;
  if (mode === 'min3') return 3;
  if (mode === 'spec') {
    if (!domain || domain === 'Overview') return 1; // Overview floor isn't a single SPEC value
    const spec = specThresholdFor(domain, grade, languageCode);
    return spec || 1;
  }
  return 1;
}

// Returns a single student's median rank (0-4) for a given domain in a given window.
// 0 = not assessed (or under SL gate floor), 1 = 2YO, 2 = 3YO, 3 = 4YO, 4 = KG.
function studentLevelForDomain(ui, domain, winIdx) {
  if (!CD.ready) return 0;
  const stu = CD.studentByIdx[ui];
  const cls = stu ? CD.classByGroup[stu.group_id] : null;
  const ranks = [];
  const useDomain = domain && domain !== 'Overview';
  const domainScales = useDomain ? new Set(CD.scalesByDomain[domain] || []) : null;
  for (const lvl of (CD.levelsByUser[ui] || [])) {
    if (lvl.r === 0) continue;
    if (winIdx !== null && lvl.w !== winIdx) continue;
    if (useDomain && !domainScales.has(lvl.s)) continue;
    ranks.push(lvl.r);
  }
  const minRequired = slGateMinPasses(domain, cls && cls.grade, stu && stu.language);
  if (ranks.length < minRequired) return 0;
  ranks.sort((a, b) => a - b);
  return ranks[Math.floor((ranks.length - 1) / 2)];
}

function scalesInDomain(domain, language) {
  if (!CD.ready) return [];
  const figmaLang = language === 'EN' ? 'English' : language === 'SP' ? 'Spanish' : null;
  return (CD.scalesByDomain[domain] || []).filter(idx => {
    if (!figmaLang) return true;
    return CD.scaleByIdx[idx].language === figmaLang;
  });
}

// Compute a single student's completion category for a single domain.
// Returns 'not-started' | 'in-progress' | 'completed'.
function studentDomainCompletion(ui, domain, winIdx) {
  const stu = CD.studentByIdx[ui];
  if (!stu) return 'not-started';
  const cls = CD.classByGroup[stu.group_id];
  const grade = cls ? cls.grade : 'Pre-K 4';
  const required = requiredPassesFor(domain, grade, stu.language);
  if (required == null) return 'not-started';
  const eligible = new Set(scalesInDomain(domain, stu.language));

  let attempted = 0, passed = 0;
  const seen = new Set();
  for (const lvl of (CD.levelsByUser[ui] || [])) {
    if (winIdx !== null && lvl.w !== winIdx) continue;
    if (!eligible.has(lvl.s)) continue;
    if (seen.has(lvl.s)) continue;
    seen.add(lvl.s);
    attempted++;
    if (lvl.r > 0) passed++;
  }
  if (attempted === 0) return 'not-started';
  if (passed >= required) return 'completed';
  return 'in-progress';
}

// Aggregate Assessment Completion: returns [notStarted, inProgress, completed] counts.
// For 'Overview', a student is "Completed" only if they're Completed in ALL four
// skill domains; "Not Started" if they haven't attempted any; "In Progress" otherwise.
function aggregateCompletion(userIndices, domain, windowName, languageFilter, gradeFilter) {
  const counts = [0, 0, 0]; // not-started, in-progress, completed
  if (!CD.ready) return counts;
  const allWindows = !windowName || windowName === 'All assessment windows';
  const winIdx = allWindows ? null : CD.windowIdx[windowName];
  if (!allWindows && winIdx === undefined) return counts;
  const langCode = languageFilter === 'English' ? 'EN'
                 : languageFilter === 'Spanish' ? 'SP'
                 : languageFilter || 'All';

  for (const ui of userIndices) {
    const stu = CD.studentByIdx[ui];
    if (!stu) continue;
    if (langCode !== 'All' && stu.language !== langCode) continue;
    if (gradeFilter && gradeFilter !== 'All grades') {
      const c = CD.classByGroup[stu.group_id];
      if (!c || c.grade !== gradeFilter) continue;
    }

    let category;
    if (domain === 'Overview') {
      const perDomain = SKILL_DOMAINS.map(d => studentDomainCompletion(ui, d, winIdx));
      if (perDomain.every(c => c === 'not-started')) category = 'not-started';
      else if (perDomain.every(c => c === 'completed')) category = 'completed';
      else category = 'in-progress';
    } else {
      category = studentDomainCompletion(ui, domain, winIdx);
    }
    counts[category === 'not-started' ? 0 : category === 'in-progress' ? 1 : 2]++;
  }
  return counts;
}

// Aggregate Grade-Level Readiness (Student Placement): returns [notAssessed, needSupport, progressing, onTrack].
// Compares student's median domain rank vs their enrolled-grade rank.
const GRADE_TO_RANK = { 'Pre-K 2': 1, 'Pre-K 3': 2, 'Pre-K 4': 3, 'Kindergarten': 4 };
function aggregateReadiness(userIndices, domain, windowName, languageFilter) {
  const counts = [0, 0, 0, 0]; // notAssessed, needSupport, progressing, onTrack
  if (!CD.ready) return counts;
  const allWindows = !windowName || windowName === 'All assessment windows';
  const winIdx = allWindows ? null : CD.windowIdx[windowName];
  if (!allWindows && winIdx === undefined) return counts;
  const langCode = languageFilter === 'English' ? 'EN'
                 : languageFilter === 'Spanish' ? 'SP'
                 : languageFilter || 'All';
  const useDomain = domain && domain !== 'Overview';
  const domainScales = useDomain ? new Set(CD.scalesByDomain[domain] || []) : null;

  for (const ui of userIndices) {
    const stu = CD.studentByIdx[ui];
    if (!stu) continue;
    if (langCode !== 'All' && stu.language !== langCode) continue;
    const cls = CD.classByGroup[stu.group_id];
    const gradeRank = cls ? GRADE_TO_RANK[cls.grade] : null;
    if (!gradeRank) { counts[0]++; continue; }

    // Median rank across passed scales in this domain (within window)
    const ranks = [];
    for (const lvl of (CD.levelsByUser[ui] || [])) {
      if (lvl.r === 0) continue;
      if (winIdx !== null && lvl.w !== winIdx) continue;
      if (useDomain && !domainScales.has(lvl.s)) continue;
      ranks.push(lvl.r);
    }
    const minRequired = slGateMinPasses(useDomain ? domain : 'Overview', cls && cls.grade, stu.language);
    if (ranks.length < minRequired) { counts[0]++; continue; }
    ranks.sort((a, b) => a - b);
    const studentRank = ranks[Math.floor((ranks.length - 1) / 2)];

    if (studentRank < gradeRank) counts[1]++;       // need support
    else if (studentRank === gradeRank) counts[2]++; // progressing
    else counts[3]++;                                // on track
  }
  return counts;
}

// Per-scale skill descriptions (bullets per age band) — sourced from
// asm_skills_by_age.csv. Loaded asynchronously at startup; keyed by scale code.
let SKILLS_BY_AGE = {};

async function loadComputed() {
  // Cache-buster query string so browsers don't keep stale data after preprocessor runs.
  const v = Date.now();
  const r = await fetch('data/computed.json?v=' + v);
  CD.raw = await r.json();
  // Skills file (best-effort — silent failure leaves bullets empty)
  try {
    const sr = await fetch('data/skills_by_age.json?v=' + v);
    if (sr.ok) SKILLS_BY_AGE = await sr.json();
  } catch (e) { /* no-op */ }
  // Build indices
  CD.raw.windows.forEach((w, i) => { CD.windowIdx[w] = i; });
  CD.scaleByIdx = CD.raw.scales;
  CD.raw.scales.forEach((sc, i) => {
    CD.scaleIdxByPath[sc.leaf_path] = i;
    if (sc.domain) {
      (CD.scalesByDomain[sc.domain] = CD.scalesByDomain[sc.domain] || []).push(i);
    }
  });
  for (const c of CD.raw.classes) CD.classByGroup[c.group_id] = c;
  for (const s of CD.raw.schools) CD.schoolBySid[s.school_id] = s;
  CD.studentByIdx = CD.raw.students;
  CD.raw.students.forEach((s, i) => {
    CD.studentIdxByUid[s.user_id] = i;
    (CD.studentsByGroup[s.group_id] = CD.studentsByGroup[s.group_id] || []).push(i);
    (CD.studentsBySchool[s.school_id] = CD.studentsBySchool[s.school_id] || []).push(i);
    (CD.studentsByDistrict[s.district_id] = CD.studentsByDistrict[s.district_id] || []).push(i);
  });
  CD.levelsByUser = CD.raw.students.map(() => []);
  for (const [u, s, w, r] of CD.raw.levels) {
    if (CD.levelsByUser[u]) CD.levelsByUser[u].push({ s, w, r });
  }
  CD.realLevelsByUser = CD.levelsByUser;
  CD.ready = true;
}

// Demo dataset is loaded on first activation (slGate === 'demo'). Its scale +
// student indices match the real computed.json byte-for-byte, so the same CD
// indices apply — only `levelsByUser` needs swapping.
async function ensureDemoLoaded() {
  if (CD.demoLoaded) return;
  if (CD.demoLoading) return CD.demoLoading;
  CD.demoLoading = (async () => {
    try {
      const r = await fetch('data/computed_demo.json?v=' + Date.now());
      if (!r.ok) throw new Error('demo fetch failed: ' + r.status);
      const demoRaw = await r.json();
      const arr = CD.raw.students.map(() => []);
      for (const [u, s, w, ra] of demoRaw.levels) {
        if (arr[u]) arr[u].push({ s, w, r: ra });
      }
      CD.demoLevelsByUser = arr;
      CD.demoLoaded = true;
    } catch (e) {
      console.warn('Demo dataset unavailable:', e);
      CD.demoLevelsByUser = CD.realLevelsByUser; // fall back to real
      CD.demoLoaded = true;
    }
  })();
  return CD.demoLoading;
}

// Student Levels: [notAssessed, age2, age3, age4, kinder]  (% of TOTAL)
// SL is rebuilt from CD on every render via refreshSL() once computed.json loads.
// The hardcoded values below are placeholders shown briefly during the initial fetch.
let SL = {
  domain: {
    'Overview':           [20, 40, 20, 15,  5],
    'Math':               [20, 20, 40, 10, 10],
    'Literacy':           [10, 50, 20, 15,  5],
    'Language':           [30, 35, 20, 15,  0],
    'Executive Function': [20, 20, 40, 10, 10],
  },
  // Standards per domain (shown at L0 when a specific domain is selected in filter)
  domainStandards: {
    'Math':               ['Count 1 by 1', 'More or Less', 'Numerals', 'Add', 'Subtract', 'Patterns'],
    'Literacy':           ['Phonological Awareness', 'Letter Recognition', 'Print Concepts', 'Reading Comprehension', 'Story Retell'],
    'Language':           ['Vocabulary', 'Following Directions', 'Sentence Structure', 'Story Understanding'],
    'Executive Function': ['Attention & Focus', 'Working Memory', 'Inhibitory Control', 'Cognitive Flexibility'],
  },
  // Sub-standards for Math domain drill-down (kept for sub-row expand in Overview mode)
  mathStandards: ['Count 1 by 1', 'More or Less', 'Numerals', 'Add', 'Subtract', 'Patterns'],
  standard: {
    // Math
    'Count 1 by 1':        [15, 25, 38, 15,  7],
    'More or Less':         [15, 22, 40, 18,  5],
    'Numerals':             [18, 22, 42, 12,  6],
    'Add':                  [25, 20, 38, 12,  5],
    'Subtract':             [28, 18, 35, 14,  5],
    'Patterns':             [18, 22, 40, 15,  5],
    // Literacy
    'Phonological Awareness':   [12, 45, 25, 12,  6],
    'Letter Recognition':        [8, 38, 30, 16,  8],
    'Print Concepts':           [15, 42, 28, 10,  5],
    'Reading Comprehension':    [20, 35, 28, 12,  5],
    'Story Retell':             [18, 40, 25, 12,  5],
    // Language
    'Vocabulary':               [22, 38, 24, 12,  4],
    'Following Directions':     [28, 32, 22, 14,  4],
    'Sentence Structure':       [35, 30, 20, 12,  3],
    'Story Understanding':      [25, 36, 24, 12,  3],
    // Executive Function
    'Attention & Focus':        [18, 22, 38, 14,  8],
    'Working Memory':           [20, 24, 36, 12,  8],
    'Inhibitory Control':       [22, 20, 40, 12,  6],
    'Cognitive Flexibility':    [25, 18, 38, 14,  5],
  },
  // Schools (L1 after clicking a domain)
  schools: {
    'District': [20, 20, 40, 10, 10],
    'School E': [15, 25, 38, 12, 10],
    'School F': [22, 18, 42, 10,  8],
    'School B': [20, 20, 40, 10, 10],
    'School A': [18, 22, 38, 14,  8],
    'School C': [25, 15, 35, 15, 10],
    'School D': [20, 20, 42, 10,  8],
  },
  // Classes (L2 after clicking a school)
  classes: {
    'School E total': [15, 25, 38, 12, 10],
    'Class 1A': [18, 22, 42, 12,  6],
    'Class 1B': [20, 18, 40, 14,  8],
    'Class 2A': [22, 20, 34, 18,  6],
  },
  // Educator report data for each class
  classReport: {
    'Class 1A': {
      classScore: 'age4',
      notAttempted: ['Francisco C.'],
      age2:   ['Marvin B.', 'Bonnie S.'],
      age3:   ['Janie D.', 'Oliver H.', 'Theodore B.'],
      age4:   ['Adriana M.', 'Blake L.', 'Kelly C.', 'Josefina C.', 'Harvey H.', 'Flora K.'],
      kinder: ['Thomas W.'],
      otherDomains: [
        { name: 'Math',               score: 'age3' },
        { name: 'Literacy',           score: 'age2' },
        { name: 'Language',           score: 'age4' },
        { name: 'Executive Function', score: 'age3' },
      ],
    },
    'Class 1B': {
      classScore: 'age3',
      notAttempted: ['Sam J.'],
      age2:   ['Alex K.', 'Maria G.'],
      age3:   ['Chris L.', 'Pat B.', 'Jordan D.', 'Emma W.'],
      age4:   ['Sofia M.', 'Noah T.', 'Lily A.'],
      kinder: ['Ethan W.', 'Ava H.'],
      otherDomains: [
        { name: 'Math',               score: 'age3' },
        { name: 'Literacy',           score: 'age3' },
        { name: 'Language',           score: 'age2' },
        { name: 'Executive Function', score: 'age4' },
      ],
    },
    'Class 2A': {
      classScore: 'age4',
      notAttempted: [],
      age2:   ['Isabella M.', 'Lucas J.'],
      age3:   ['Mia T.', 'Mason L.', 'Charlotte S.'],
      age4:   ['Aiden G.', 'Harper B.', 'Ella N.', 'Owen C.'],
      kinder: ['Liam M.', 'Sophia R.', 'James T.'],
      otherDomains: [
        { name: 'Math',               score: 'age4' },
        { name: 'Literacy',           score: 'age3' },
        { name: 'Language',           score: 'age4' },
        { name: 'Executive Function', score: 'age3' },
      ],
    },
  },
};

// Per-window data for "All assessment windows" mode
// Real windows derived from data are filled in by refreshSL().
let SL_WINDOWS = ['Fall 2025', 'Spring 2026'];
let SL_CURRENT_WINDOW = 'Spring 2026';
const SL_WINDOW_DATA = {
  domain: {
    'Fall 2026':   [12, 28, 26, 18, 16],
    'Winter 2026': [10, 22, 24, 22, 22],
    'Spring 2027': [4,  14, 20, 26, 36],
  },
  schools: {
    'Fall 2026':   [20, 26, 28, 16, 10],
    'Winter 2026': [18, 22, 30, 18, 12],
    'Spring 2027': [15, 20, 35, 20, 10],
  },
  classes: {
    'Fall 2026':   [22, 26, 28, 14,  8],
    'Winter 2026': [18, 22, 30, 18, 12],
    'Spring 2027': [15, 20, 35, 20, 10],
  },
};

// Assessment Completion: [notStarted, inProgress, completed]
const AC = {
  domain: {
    'Overview':           [20, 60, 20],
    'Math':               [30, 20, 50],
    'Literacy':           [50, 30, 20],
    'Language':           [20, 20, 60],
    'Executive Function': [20, 60, 20],
  },
  schools: {
    'District': [30, 20, 50],
    'School E': [30, 60, 10],
    'School F': [30, 60, 10],
    'School B': [20, 50, 30],
    'School A': [30, 60, 10],
    'School C': [40, 45, 15],
    'School D': [25, 55, 20],
  },
  classes: {
    'School E total': [30, 60, 10],
    'Class 1A': [25, 25, 50],
    'Class 1B': [30, 35, 35],
    'Class 2A': [35, 30, 35],
  },
  students: {
    'Class 1A': [
      { name: 'Francisco C.',  status: 'not-started' },
      { name: 'Marvin B.',     status: 'completed' },
      { name: 'Bonnie S.',     status: 'in-progress' },
      { name: 'Janie D.',      status: 'completed' },
      { name: 'Oliver H.',     status: 'completed' },
      { name: 'Theodore B.',   status: 'in-progress' },
      { name: 'Adriana M.',    status: 'completed' },
      { name: 'Blake L.',      status: 'completed' },
      { name: 'Kelly C.',      status: 'in-progress' },
      { name: 'Josefina C.',   status: 'not-started' },
      { name: 'Harvey H.',     status: 'completed' },
      { name: 'Flora K.',      status: 'completed' },
      { name: 'Thomas W.',     status: 'completed' },
    ],
    'Class 1B': [
      { name: 'Sam J.',     status: 'not-started' },
      { name: 'Alex K.',    status: 'in-progress' },
      { name: 'Maria G.',   status: 'completed' },
      { name: 'Chris L.',   status: 'completed' },
      { name: 'Pat B.',     status: 'in-progress' },
      { name: 'Jordan D.',  status: 'completed' },
    ],
    'Class 2A': [
      { name: 'Isabella M.', status: 'completed' },
      { name: 'Lucas J.',    status: 'in-progress' },
      { name: 'Mia T.',      status: 'completed' },
      { name: 'Mason L.',    status: 'completed' },
      { name: 'Charlotte S.',status: 'in-progress' },
    ],
  },
};

// Student Placement: [notAssessed, needSupport, progressing, onTrack]
const SP = {
  domain: {
    'Overview':           [30, 40, 20, 10],
    'Math':               [30, 40, 20, 10],
    'Literacy':           [20, 10, 50, 20],
    'Language':           [30, 15, 35, 20],
    'Executive Function': [25, 50, 20,  5],
  },
  schools: {
    'District': [30, 40, 20, 10],
    'School E': [25, 45, 22,  8],
    'School F': [32, 38, 20, 10],
    'School B': [28, 42, 20, 10],
    'School A': [30, 38, 24,  8],
    'School C': [35, 35, 22,  8],
    'School D': [30, 40, 20, 10],
  },
  classes: {
    'School E total': [25, 45, 22, 8],
    'Class 1A': [20, 48, 24, 8],
    'Class 1B': [28, 42, 22, 8],
    'Class 2A': [27, 45, 20, 8],
  },
  students: {
    'Class 1A': [
      { name: 'Francisco C.',  placement: 'not-assessed' },
      { name: 'Marvin B.',     placement: 'need-support' },
      { name: 'Bonnie S.',     placement: 'progressing' },
      { name: 'Janie D.',      placement: 'on-track' },
      { name: 'Oliver H.',     placement: 'on-track' },
      { name: 'Theodore B.',   placement: 'need-support' },
      { name: 'Adriana M.',    placement: 'progressing' },
      { name: 'Blake L.',      placement: 'need-support' },
      { name: 'Kelly C.',      placement: 'progressing' },
      { name: 'Josefina C.',   placement: 'not-assessed' },
      { name: 'Harvey H.',     placement: 'need-support' },
      { name: 'Flora K.',      placement: 'on-track' },
      { name: 'Thomas W.',     placement: 'progressing' },
    ],
    'Class 1B': [
      { name: 'Sam J.',     placement: 'not-assessed' },
      { name: 'Alex K.',    placement: 'need-support' },
      { name: 'Maria G.',   placement: 'progressing' },
      { name: 'Chris L.',   placement: 'on-track' },
      { name: 'Pat B.',     placement: 'need-support' },
      { name: 'Jordan D.',  placement: 'progressing' },
    ],
    'Class 2A': [
      { name: 'Isabella M.', placement: 'on-track' },
      { name: 'Lucas J.',    placement: 'need-support' },
      { name: 'Mia T.',      placement: 'progressing' },
      { name: 'Mason L.',    placement: 'on-track' },
      { name: 'Charlotte S.',placement: 'progressing' },
    ],
  },
};

/* ============================================================
   APP STATE
   ============================================================ */
const state = {
  report: 'student-levels',
  role: 'district',   // 'district' | 'school'
  // Two filter sets:
  //   filters: COMMITTED values used by render. Only update when "Generate Report"
  //            is clicked (or on Reset/role-switch). Threshold settings are an
  //            exception — they apply immediately since they're display options.
  //   pendingFilters: what the user has SELECTED in the dropdowns. The filter card
  //            shows these. They become committed only on Generate Report.
  filters: {
    window: 'Spring 2026',  // most-recent real window (overridden after CD loads)
    domain: 'Overview',
    language: 'All',
    school: 'All',
    cls: 'All',
    grade: 'All grades',
    // Display thresholds — configurable so we can balance SPEC strictness vs. data coverage.
    completionMode: 'spec',   // 'spec' | 'soft50' | 'loose'
    slGate: 'min1',           // 'min1' (any pass) | 'min2' | 'min3' | 'spec'
  },
  pendingFilters: {
    window: 'Spring 2026',
    domain: 'Overview',
    language: 'All',
    school: 'All',
    cls: 'All',
    grade: 'All grades',
    completionMode: 'spec',
    slGate: 'min1',
  },
  sl: { level: 0, path: [], showAvg: false, expandedRows: new Set() },
  ac: { level: 0, path: [] },
  sp: { level: 0, path: [] },
  dirty: false,
  generated: false,   // false until "Generate Report" is clicked
  loading: false,
  windowBannerDismissed: false,
};

/* ============================================================
   UTILS
   ============================================================ */
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// vals are now COUNTS per level [na, age2, age3, age4, kinder].
// pillLabel takes (count, total) and returns "20% (30 of 150)".
function pillLabel(c, total) {
  const p = total > 0 ? Math.round((c / total) * 100) : 0;
  return `${p}% (${c} of ${total})`;
}

// Returns index (1–4) of the highest non-zero skill column
function hiIdx(vals) {
  let best = 1;
  for (let i = 2; i < vals.length; i++) {
    if (vals[i] > vals[best]) best = i;
  }
  return best;
}

const PILL_TYPES = ['na', 'age2', 'age3', 'age4', 'kinder'];
const COL_LABELS = ['Not Assessed', 'Age 2 Skills', 'Age 3 Skills', 'Age 4 Skills', 'Kindergarten Skills'];
const COL_CLASSES = ['col-na', 'col-age2', 'col-age3', 'col-age4', 'col-kinder'];

// Average: weighted mean of skill levels (Age2=2, Age3=3, Age4=4, Kinder=5)
// vals = [notAssessed, age2, age3, age4, kinder]
function calcAverage(vals) {
  const [, a2, a3, a4, kg] = vals;
  const total = a2 + a3 + a4 + kg;
  if (total === 0) return null;
  return (2*a2 + 3*a3 + 4*a4 + 5*kg) / total;
}

// Render the continuous average bar (spans all 5 data columns via colspan).
// Bar + tag color = the band the AVERAGE falls in (2-3 → age2, 3-4 → age3,
// 4-5 → age4, ≥5 → kinder). E.g., avg 3.9 lands in age3 → purple bar.
function avgBand(avg) {
  if (avg >= 5) return 'kinder';
  if (avg >= 4) return 'age4';
  if (avg >= 3) return 'age3';
  return 'age2';
}
function makeAvgBar(vals) {
  const avg = calcAverage(vals);
  if (avg === null) return '<td colspan="5" class="avg-cell"><em style="color:var(--grey-400);font-size:12px;">Not enough data</em></td>';
  // Round to one decimal up-front so the displayed number, marker position, and
  // band color all stay consistent. (E.g., a true mean of 3.96 displays as "4.0"
  // and bands as age4 — previously the raw 3.96 banded as age3.)
  const rounded = Math.round(avg * 10) / 10;
  // 5 equal columns (NA, Age 2, Age 3, Age 4, Kinder) at 20% each. Each integer
  // score X lands at the START of its column (X-1): score 2 → 20% (left edge
  // of Age 2 col), score 4 → 60% (left edge of Age 4 col). Decimals advance
  // the marker linearly within the column. With placeholder gaps removed,
  // these positions match the visual column boundaries exactly.
  const pctPos = (rounded - 1) * 20;
  const display = rounded.toFixed(1);
  const band = avgBand(rounded);
  return `
    <td colspan="5" class="avg-cell">
      <div class="avg-bar-wrap">
        <div class="avg-placeholders">
          <div class="avg-pl-pill pl-na"></div>
          <div class="avg-pl-pill pl-age2"></div>
          <div class="avg-pl-pill pl-age3"></div>
          <div class="avg-pl-pill pl-age4"></div>
          <div class="avg-pl-pill pl-kinder"></div>
        </div>
        <div class="avg-bar-fill avg-${band}" style="width:${pctPos}%"></div>
        <div class="avg-bar-tag avg-${band}" style="left:${pctPos}%">${display}</div>
        <div class="avg-bar-label" style="left:${pctPos}%">Average</div>
      </div>
    </td>`;
}

function makePill(val, total, idx, hi, colLabel, baseCtx) {
  const t = PILL_TYPES[idx];
  const hiClass = hi ? ' hi' : '';
  const label = colLabel || COL_LABELS[idx];
  // Every pill (including Not Assessed) is clickable; opens the detail popup for that column.
  // baseCtx (optional) carries scope/scale/window so the popup can resolve the
  // exact set of students that match this cell. Auto-fills `r` (rank = idx).
  let ctxAttr = '';
  if (baseCtx) {
    const ctx = { ...baseCtx, r: idx };
    ctxAttr = ` data-ctx="${esc(JSON.stringify(ctx))}"`;
  }
  return `<span class="pill pill-${t}${hiClass}" data-action="openPopup" data-col="${esc(label)}" data-val="${val}" data-total="${total}"${ctxAttr}>${pillLabel(val, total)}</span>`;
}

function makeBar(segs) {
  // segs: [{cls, flex, label}]
  // Every visible segment shows its percentage label, even small ones — narrow
  // segments rely on the .seg flex:0 0 auto + min-width treatment in CSS so the
  // label stays readable instead of being clipped to nothing.
  return '<div class="stacked-bar">' +
    segs.filter(s => s.flex > 0).map(s =>
      `<div class="seg ${s.cls}" style="flex:${s.flex}" title="${esc(s.label)}">${s.label}</div>`
    ).join('') + '</div>';
}

// Avatar color cycling
const AVATAR_COLORS = ['#ef6593','#a47fbb','#48b6ce','#14bf96','#f4bf51','#546a94','#f16756'];
function avatarColor(name) {
  let h = 0; for (let c of name) h = (h * 31 + c.charCodeAt(0)) & 0xff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function makeAvatar(name) {
  const initials = name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
  const bg = avatarColor(name);
  return `<span class="avatar" style="background:${bg}">${initials}</span>`;
}

/* ============================================================
   CURRENT REPORT STATE HELPERS
   ============================================================ */
function current() {
  return state[state.report === 'student-levels' ? 'sl'
             : state.report === 'completion'      ? 'ac'
             :                                      'sp'];
}

function isLocked() {
  return current().level > 0;
}

/* ============================================================
   RENDER: FILTER CARD
   ============================================================ */
function renderFilterCard() {
  const locked = isLocked();
  // Filter card displays PENDING values (the user's current selection),
  // while the report below renders from COMMITTED state.filters.
  const f = state.pendingFilters;
  const isAC = state.report === 'completion';
  const disabled = locked ? 'disabled' : '';

  const sel = (name, opts, val, dis = '') => {
    const isDisabled = dis || disabled;
    const disAttr = isDisabled ? ' data-disabled="true"' : '';
    // opts can be ['x', 'y'] (label === value) or [{value, label}, ...]
    const norm = opts.map(o => typeof o === 'string' ? { value: o, label: o } : o);
    const current = norm.find(o => o.value === val);
    const display = current ? current.label : val;
    const items = norm.map(o =>
      `<div class="cdd-option${o.value === val ? ' selected' : ''}" data-value="${esc(o.value)}">${esc(o.label)}</div>`
    ).join('');
    return `<div class="cdd${isDisabled ? ' cdd-disabled' : ''}" data-name="${name}"${disAttr}>
      <div class="cdd-trigger">
        <span class="cdd-value">${esc(display)}</span>
        <svg class="cdd-arrow" viewBox="0 0 10 6" width="10" height="6"><path d="M0 0l5 6 5-6z" fill="currentColor"/></svg>
      </div>
      <div class="cdd-menu">${items}</div>
    </div>`;
  };

  const isSchoolAdmin = state.role === 'school';
  // School admins always have school pre-filled (first school in the data) and class is enabled
  const schoolNames = (CD.raw && CD.raw.schools || []).map(s => s.name);
  const adminSchool = schoolNames[0] || 'All';
  const effectiveSchool = isSchoolAdmin ? adminSchool : f.school;
  const classEnabled = !locked && (isSchoolAdmin || effectiveSchool !== 'All');
  const schools = ['All', ...schoolNames];
  // Class options are filtered to the currently-selected school (if any)
  let classes = ['All'];
  if (classEnabled && CD.raw && CD.raw.classes) {
    const selSchool = (CD.raw.schools || []).find(s => s.name === effectiveSchool);
    if (selSchool) {
      classes = ['All', ...CD.raw.classes.filter(c => c.school_id === selSchool.school_id).map(c => c.name)];
    }
  }
  const schoolDisabled = isSchoolAdmin || locked ? 'disabled' : '';

  const domainDisabled = isAC ? 'disabled' : '';

  // Bottom row message
  let msgHtml = '';
  if (locked) {
    msgHtml = `<div class="filter-msg locked">
      <span>&#128276;</span>
      Filters can only be edited from the main report. Use the links below to return to the main view.
      <button class="close-msg" data-action="closeLockMsg">&times;</button>
    </div>`;
  } else if (state.dirty) {
    msgHtml = `<div class="filter-msg dirty">
      <span>&#9888;</span>
      Remember to click &ldquo;Generate Report&rdquo; after changing the filters.
      <button class="close-msg" data-action="closeDirtyMsg">&times;</button>
    </div>`;
  } else {
    msgHtml = '<div style="flex:1"></div>'; // spacer so buttons stay right
  }

  const completionOpts = [
    { value: 'spec',   label: 'they’ve met the domain completion requirement' },
    { value: 'soft50', label: 'they’ve met half the domain completion requirement' },
    { value: 'loose',  label: 'they pass any one assessment' },
    { value: 'demo',   label: 'demo' },
  ];
  const slGateOpts = [
    { value: 'min1', label: 'they’ve completed any assessment' },
    { value: 'min2', label: 'they’ve completed at least 2 assessments' },
    { value: 'min3', label: 'they’ve completed at least 3 assessments' },
    { value: 'spec', label: 'they’ve met the domain completion requirement' },
    { value: 'demo', label: 'demo' },
  ];

  return `
    <div class="filter-card">
      <div class="filter-row">
        <div class="filter-group">
          <label>Assessment Window</label>
          ${sel('window', ['All assessment windows', ...SL_WINDOWS], f.window)}
        </div>
        <div class="filter-group">
          <label>Select domain</label>
          ${sel('domain', ['Overview','Math','Literacy','Language','Executive Function'], f.domain, domainDisabled)}
        </div>
        <div class="filter-group">
          <label>Select language</label>
          ${sel('language', ['All','English','Spanish'], f.language)}
        </div>
        <div class="filter-divider" aria-hidden="true"></div>
        <div class="filter-group">
          <label>Select school</label>
          ${sel('school', schools, effectiveSchool, schoolDisabled)}
        </div>
        <div class="filter-group">
          <label>Select class</label>
          ${sel('cls', classes, f.cls, classEnabled ? '' : 'disabled')}
        </div>
        <div class="filter-group">
          <label>Select grade</label>
          ${sel('grade', ['All grades','Pre-K 3','Pre-K 4','Kindergarten'], f.grade)}
        </div>
      </div>
      ${
        // AC uses the Completion threshold; SL + SP use the "show level when" gate.
        // Only render the dropdown that applies to the current report.
        state.report === 'completion'
          ? `<div class="filter-row filter-row-thresholds">
              <div class="filter-group">
                <label>Mark student &ldquo;Completed&rdquo; when&hellip;</label>
                ${sel('completionMode', completionOpts, f.completionMode || 'spec')}
              </div>
            </div>`
          : `<div class="filter-row filter-row-thresholds">
              <div class="filter-group">
                <label>Show student&rsquo;s level when&hellip;</label>
                ${sel('slGate', slGateOpts, f.slGate || 'min1')}
              </div>
            </div>`
      }
      <div class="filter-bottom">
        ${msgHtml}
        <div class="filter-actions">
          <button class="btn btn-secondary" ${locked ? 'disabled' : ''} data-action="reset"><img src="reset.png" alt="" class="btn-ico" /> Reset</button>
          <button class="btn btn-primary"    ${locked ? 'disabled' : ''} data-action="generate"><img src="generate.png" alt="" class="btn-ico" /> Generate Report</button>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   RENDER: BREADCRUMBS
   ============================================================ */
function renderBreadcrumbs(path) {
  if (!path || path.length === 0) return '';
  // Hide entries the user didn't actually navigate through (drill skipped them).
  // Original index is preserved so breadcrumb clicks still target the right level.
  const visible = [];
  path.forEach((p, originalIdx) => {
    if (p.skipped) return;
    visible.push({ ...p, originalIdx });
  });
  if (visible.length === 0) return '';
  const items = visible.map((p, i) => {
    const isLast = i === visible.length - 1;
    if (isLast) return `<span class="crumb-current">${esc(p.label)}</span>`;
    return `<a data-action="breadcrumb:${p.originalIdx}">${esc(p.label)}</a>`;
  });
  return `<div class="breadcrumbs">${items.join('<span class="sep"> &gt; </span>')}</div>`;
}

/* ============================================================
   RENDER: TOOLBAR
   ============================================================ */
function renderToolbar(showToggle = true) {
  const title = getReportTitle();
  const checked = state.sl.showAvg ? 'checked' : '';
  const toggle = showToggle ? `
    <label class="toggle-wrap">
      <span class="toggle"><input type="checkbox" id="showAvg" ${checked} data-action="toggleAvg" /><span class="toggle-slider"></span></span>
      Show average
    </label>` : '';
  // Collapse-all only makes sense when rows can be expanded — i.e., when
  // "All assessment windows" is selected (rows expand to show per-window data).
  // Also require CD.ready: if the dataset failed to load, the per-window
  // aggregator returns empty counts, so expanding would show 0-of-0 rows.
  // Hide the expand affordance entirely until real data is available.
  const isAllWindows = state.filters.window === 'All assessment windows' && CD.ready;
  const collapseAll = (showToggle && isAllWindows) ? `
    <button class="btn btn-ghost" style="padding:5px 10px;font-size:11px;" data-action="collapseAll" title="Collapse all rows">
      &#8963; Collapse all
    </button>` : '';
  return `
    <div class="report-toolbar">
      <div class="toolbar-left" style="gap:8px;">${toggle}${collapseAll}</div>
      <div class="toolbar-center">${esc(title)}</div>
      <div class="toolbar-right">
        <button class="btn btn-ghost">&#11015; Download CSV</button>
      </div>
    </div>`;
}

/* ============================================================
   RENDER: STUDENT LEVELS TABLE
   ============================================================ */

// Returns the set of supported module ranks (1-4) for a scale code, taking the
// UNION across EN + SP versions of that code. Used by standards-mode rendering
// to mark cells as N/A when a scale doesn't test a particular age band.
function supportedRanksForCode(domain, code) {
  if (!CD.ready) return new Set();
  const ranks = new Set();
  for (const idx of (CD.scalesByDomain[domain] || [])) {
    const sc = CD.scaleByIdx[idx];
    if (sc.code !== code) continue;
    for (const r of (sc.modules || [])) ranks.add(r);
  }
  return ranks;
}

// Build the `scale` portion of a pill context from a renderer's drilled state.
// drilledEntry comes from path[0] (an SL drill path entry) or null at L0.
// At L0 the per-row scale type is row-dependent (Overview row vs domain row vs
// standard row), so callers pass null and build their own per-row scale ctx.
function pillScaleCtx(drilledEntry) {
  if (!drilledEntry) return null;
  if (drilledEntry.isStandard) {
    return { tk: 'standard', d: drilledEntry.scaleDomain, c: drilledEntry.scaleCode };
  }
  if (drilledEntry.label === 'Overview') return { tk: 'overview' };
  return { tk: 'domain', d: drilledEntry.label };
}

function slDataCells(vals, naRanks, baseCtx) {
  // vals = counts [na, age2, age3, age4, kinder]
  // naRanks: optional Set of column indices (1-4) to render as N/A indicator pills
  //   for scales that don't have that age module (e.g., MAT6a "Add" 2YO/3YO).
  // baseCtx: optional pill context (forwarded to makePill so the popup can
  //   resolve the exact list of students that match this cell).
  if (state.sl.showAvg) return makeAvgBar(vals);
  const total = vals.reduce((a, b) => a + b, 0);
  const hi = hiIdx(vals);
  return vals.map((v, i) => {
    if (naRanks && naRanks.has(i)) {
      return `<td><span class="pill pill-na pill-empty" title="This scale does not test this age band">N/A</span></td>`;
    }
    return `<td>${makePill(v, total, i, i === hi, undefined, baseCtx)}</td>`;
  }).join('');
}

function slTheadCells() {
  return `
    <th class="col-na">Not Assessed</th>
    <th class="col-age2">Age 2 Skills</th>
    <th class="col-age3">Age 3 Skills</th>
    <th class="col-age4">Age 4 Skills</th>
    <th class="col-kinder">Kindergarten Skills</th>`;
}

function renderWindowSubRows(getCounts, baseCtx) {
  // getCounts: (windowName) => 5-element counts array [na, age2, age3, age4, kinder]
  // baseCtx: optional pill context for the parent row (window field gets
  //   overridden per sub-row so each window's pills target that window).
  return SL_WINDOWS.map(win => {
    const isCurrent = win === SL_CURRENT_WINDOW;
    const vals = getCounts(win);
    const hi = hiIdx(vals);
    const total = vals.reduce((a, b) => a + b, 0);
    const subCtx = baseCtx ? { ...baseCtx, w: win } : undefined;
    return `<tr class="sub-row show window-sub-row">
      <td class="window-sub-label">
        ${esc(win)}${isCurrent ? `<span class="star-badge">&#9733;</span>` : ''}
      </td>
      ${vals.map((v,i) => `<td style="text-align:center;padding:0 6px;">${makePill(v, total, i, i===hi, undefined, subCtx)}</td>`).join('')}
    </tr>`;
  }).join('');
}

// L0 – Domain list (Overview) or Standards list (specific domain selected)
function renderSL_L0() {
  // Also require CD.ready: if the dataset failed to load, the per-window
  // aggregator returns empty counts, so expanding would show 0-of-0 rows.
  // Hide the expand affordance entirely until real data is available.
  const isAllWindows = state.filters.window === 'All assessment windows' && CD.ready;
  const selectedDomain = state.filters.domain;
  const isStandardsMode = selectedDomain !== 'Overview';

  let rows, colHeader;

  const f = state.filters;
  const scope = l0ScopeStudents();
  if (isStandardsMode) {
    // Show standards for the selected domain
    const standards = SL.domainStandards[selectedDomain] || [];
    colHeader = 'Standard';
    const figmaLang = f.language === 'EN' ? 'English' : f.language === 'SP' ? 'Spanish' : f.language;

    // Pinned aggregate row at the top: domain-level score (e.g., "Math").
    // Clickable — drills into the domain (district/school/class breakdown of
    // the domain-level score), same as clicking the Math row from Overview L0.
    const domainVals = SL.domain[selectedDomain] || [0, 0, 0, 0, 0];
    const domainCtx = { ...l0ScopeCtx(), tk: 'domain', d: selectedDomain, w: f.window };
    const domainRow = `<tr class="pinned">
      <td>
        <div class="dom-cell">
          <span class="dom-link" style="font-weight:600;" data-action="sl-drill-domain:${esc(selectedDomain)}">${esc(selectedDomain)}</span>
        </div>
      </td>
      ${slDataCells(domainVals, undefined, domainCtx)}
    </tr>`;

    rows = domainRow + standards.map(std => {
      // std is {code, name} — display the human-readable name, use code as the stable identifier
      const vals = SL.standard[std.code] || [0, 0, 0, 0, 0];
      const isExpanded = isAllWindows && state.sl.expandedRows.has(std.code);
      // Per-window sub-rows: also merge EN + SP versions of this scale code
      const scIdxs = new Set(
        (CD.scalesByDomain[selectedDomain] || []).filter(idx => {
          const sc = CD.scaleByIdx[idx];
          if (sc.code !== std.code) return false;
          if (figmaLang !== 'All' && sc.language !== figmaLang) return false;
          return true;
        })
      );
      const baseCtx = { ...l0ScopeCtx(), tk: 'standard', d: selectedDomain, c: std.code, w: f.window };
      const subRowsHtml = isExpanded
        ? renderWindowSubRows(win => aggregateLevelsMergedByCode(scope, scIdxs, win, f.language, f.grade), baseCtx)
        : '';
      // Mark age columns as N/A when this scale doesn't test that age band
      const supported = supportedRanksForCode(selectedDomain, std.code);
      const naRanks = new Set([1, 2, 3, 4].filter(r => !supported.has(r)));
      return `<tr>
        <td>
          <div class="dom-cell">
            ${isAllWindows ? `<button class="expand-chevron${isExpanded ? ' open' : ''}" data-action="sl-toggle-expand:${esc(std.code)}" title="Expand">&#8964;</button>` : ''}
            <span class="dom-link" data-action="sl-drill-standard:${esc(selectedDomain)}|${esc(std.code)}|${esc(std.name)}">${esc(std.name)}</span>
          </div>
        </td>
        ${slDataCells(vals, naRanks, baseCtx)}
      </tr>${subRowsHtml}`;
    }).join('');
  } else {
    // Overview mode: show all domains. Rows are only expandable when "All assessment windows" is selected.
    colHeader = 'Domain';
    rows = DOMAINS.map(domain => {
      const vals = SL.domain[domain] || [0, 0, 0, 0, 0];
      const isExpanded = isAllWindows && state.sl.expandedRows.has(domain);
      const baseCtx = { ...l0ScopeCtx(), w: f.window,
        ...(domain === 'Overview' ? { tk: 'overview' } : { tk: 'domain', d: domain }) };
      const subRowsHtml = isExpanded
        ? renderWindowSubRows(win => aggregateLevels(scope, domain, win, f.language, f.grade), baseCtx)
        : '';
      return `<tr data-domain="${esc(domain)}">
        <td>
          <div class="dom-cell">
            ${isAllWindows ? `<button class="expand-chevron${isExpanded ? ' open' : ''}" data-action="sl-toggle-expand:${esc(domain)}" title="Expand">&#8964;</button>` : ''}
            <span class="dom-link" data-action="sl-drill-domain:${esc(domain)}">${esc(domain)}</span>
          </div>
        </td>
        ${slDataCells(vals, undefined, baseCtx)}
      </tr>${subRowsHtml}`;
    }).join('');
  }

  return `
    ${renderToolbar()}
    <div class="tbl-wrap">
      <table class="tbl-levels">
        <thead>
          <tr>
            <th class="col-dom">${esc(colHeader)}</th>
            ${slTheadCells()}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

function renderSubRows(domain) {
  const subs = domain === 'Math' ? SL.mathStandards : [];
  const subNames = {
    'Overview':  ['Emergent Skills', 'Developing Skills'],
    'Literacy':  ['Phonological Awareness', 'Print Concepts'],
    'Language':  ['Receptive Language', 'Expressive Language'],
    'Executive Function': ['Attention & Inhibition', 'Working Memory'],
  };
  const names = subs.length ? subs : (subNames[domain] || []);
  return names.map(n => {
    const vals = subs.length ? SL.standard[n] : SL.domain[domain].map(v => Math.round(v * (0.85 + Math.random()*0.3)));
    const hi = hiIdx(vals);
    const total = vals.reduce((a, b) => a + b, 0);
    return `<tr class="sub-row show">
      <td class="window-sub-label" style="color:var(--grey-500);font-weight:400;">${esc(n)}</td>
      ${vals.map((v,i) => `<td style="text-align:center;padding:0 6px;">${makePill(v, total, i, i===hi)}</td>`).join('')}
    </tr>`;
  }).join('');
}

// Build a per-window aggregator that matches whatever was drilled at path[0].
// Used by L1 + L2 sub-rows so the Fall/Spring breakdown sums to the same parent
// row total — both standards (merge EN+SP by code) and domains (median across
// scales).
function makeDrilledWindowAggregator(drilledEntry, lang, grade) {
  const figmaLang = langToFigma(lang);
  if (drilledEntry && drilledEntry.isStandard) {
    const scIdxs = new Set();
    for (const idx of (CD.scalesByDomain[drilledEntry.scaleDomain] || [])) {
      const sc = CD.scaleByIdx[idx];
      if (sc.code !== drilledEntry.scaleCode) continue;
      if (figmaLang !== 'All' && sc.language !== figmaLang) continue;
      scIdxs.add(idx);
    }
    return (stuIndices, win) => aggregateLevelsMergedByCode(stuIndices, scIdxs, win, lang, grade);
  }
  return (stuIndices, win) => aggregateLevels(stuIndices, drilledEntry.label, win, lang, grade);
}

// L1 – Schools list (after clicking a domain)
function renderSL_L1(path) {
  // Also require CD.ready: if the dataset failed to load, the per-window
  // aggregator returns empty counts, so expanding would show 0-of-0 rows.
  // Hide the expand affordance entirely until real data is available.
  const isAllWindows = state.filters.window === 'All assessment windows' && CD.ready;
  const f = state.filters;
  const drilledAgg = makeDrilledWindowAggregator(path[0], f.language, f.grade);
  // District row first, then real schools from CD
  const schoolOrder = ['District', ...((CD.raw && CD.raw.schools) || []).map(s => s.name)];

  const scaleCtx = pillScaleCtx(path[0]);
  const rows = schoolOrder.flatMap(name => {
    const vals = SL.schools[name] || [0, 0, 0, 0, 0];
    const isDistrict = name === 'District';
    const isExpanded = !isDistrict && isAllWindows && state.sl.expandedRows.has(name);
    const schObj = (CD.raw && CD.raw.schools || []).find(s => s.name === name);
    // District row uses the L0 top-level scope (honors school/class filter);
    // each school row uses studentsBySchool[id].
    const rowScope = isDistrict
      ? l0ScopeCtx()
      : (schObj ? { sk: 'school', sid: schObj.school_id } : { sk: 'all' });
    const baseCtx = { ...rowScope, ...scaleCtx, w: f.window };

    const mainRow = `<tr ${isDistrict ? 'class="pinned"' : ''}>
      <td>
        <div class="dom-cell">
          ${isDistrict
            ? `<span class="dom-link no-link" style="cursor:default;text-decoration:none;font-weight:600;">${esc(name)}${isAllWindows ? `<span class="star-badge">&#9733;</span>` : ''}</span>`
            : isAllWindows
              ? `<button class="expand-chevron${isExpanded ? ' open' : ''}" data-action="sl-toggle-expand:${esc(name)}" title="Expand">&#8964;</button>
                 <span class="dom-link" data-action="sl-drill-school:${esc(name)}">${esc(name)}</span>`
              : `<span class="dom-link" data-action="sl-drill-school:${esc(name)}">${esc(name)}</span>`}
        </div>
      </td>
      ${slDataCells(vals, undefined, baseCtx)}
    </tr>`;

    if (!isExpanded) return [mainRow];
    const stuIndices = schObj ? (CD.studentsBySchool[schObj.school_id] || []) : [];
    const subRows = renderWindowSubRows(win => drilledAgg(stuIndices, win), baseCtx);
    return [mainRow, subRows];
  }).join('');

  return `
    ${renderBreadcrumbs(path)}
    ${renderToolbar()}
    <div class="tbl-wrap">
      <table class="tbl-levels">
        <thead>
          <tr>
            <th class="col-dom"><span class="sort-hdr">Schools <span class="sort-icons">&#8597;</span></span></th>
            ${slTheadCells()}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

// L2 – Classes list (after clicking a school)
function renderSL_L2(path) {
  // Also require CD.ready: if the dataset failed to load, the per-window
  // aggregator returns empty counts, so expanding would show 0-of-0 rows.
  // Hide the expand affordance entirely until real data is available.
  const isAllWindows = state.filters.window === 'All assessment windows' && CD.ready;
  const f = state.filters;
  // path = [domain, 'District' literal, school]
  const drilledAgg = makeDrilledWindowAggregator(path[0], f.language, f.grade);
  const school = path[2] ? path[2].label : path[1].label;
  // Look up the school's classes from CD
  const schObj = (CD.raw && CD.raw.schools || []).find(s => s.name === school);
  const schoolClasses = schObj
    ? (CD.raw.classes || []).filter(c => c.school_id === schObj.school_id).map(c => c.name)
    : [];
  const classOrder = [`${school} total`, ...schoolClasses];
  const scaleCtx = pillScaleCtx(path[0]);

  const rows = classOrder.flatMap(name => {
    const vals = SL.classes[name] || [0, 0, 0, 0, 0];
    const isTotal = name === `${school} total`;
    const displayName = isTotal ? school : name;
    const isExpanded = !isTotal && isAllWindows && state.sl.expandedRows.has(name);
    const cls = isTotal ? null : (CD.raw && CD.raw.classes || []).find(c => c.name === name);
    // Total row uses the school scope; each class row uses its own group_id.
    const rowScope = isTotal
      ? (schObj ? { sk: 'school', sid: schObj.school_id } : { sk: 'all' })
      : (cls ? { sk: 'class', sid: cls.group_id } : { sk: 'all' });
    const baseCtx = { ...rowScope, ...scaleCtx, w: f.window };

    const mainRow = `<tr ${isTotal ? 'class="pinned"' : ''}>
      <td>
        <div class="dom-cell">
          ${isTotal
            ? `<span class="dom-link no-link" style="cursor:default;text-decoration:none;font-weight:600;">${esc(displayName)}${isAllWindows ? `<span class="star-badge">&#9733;</span>` : ''}</span>`
            : isAllWindows
              ? `<button class="expand-chevron${isExpanded ? ' open' : ''}" data-action="sl-toggle-expand:${esc(name)}" title="Expand">&#8964;</button>
                 <span class="dom-link" data-action="sl-drill-class:${esc(name)}">${esc(name)}</span>`
              : `<span class="dom-link" data-action="sl-drill-class:${esc(name)}">${esc(name)}</span>`}
        </div>
      </td>
      ${slDataCells(vals, undefined, baseCtx)}
    </tr>`;

    if (!isExpanded) return [mainRow];
    const stuIndices = cls ? (CD.studentsByGroup[cls.group_id] || []) : [];
    const subRows = renderWindowSubRows(win => drilledAgg(stuIndices, win), baseCtx);
    return [mainRow, subRows];
  }).join('');

  return `
    ${renderBreadcrumbs(path)}
    ${renderToolbar()}
    <div class="tbl-wrap">
      <table class="tbl-levels">
        <thead>
          <tr>
            <th class="col-dom"><span class="sort-hdr">Classes <span class="sort-icons">&#8597;</span></span></th>
            ${slTheadCells()}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

// L3 – Educator Class Report — per-scale rows per Figma "class-math" design
// Each row = one assessment (or one domain when filter=Overview). Collapsed rows
// show colored level bars with a "Class Score" badge in the column matching the
// class median. Expanding a row reveals student cards bucketed by their level
// for that scale, plus a "Not Yet Attempted" section.
function renderSL_L3(path) {
  const f = state.filters;
  // path = [domain, 'District', school, class]
  const drilledDomain = path[0].label;
  const cls = path[3] ? path[3].label : path[2].label;
  const clsObj = (CD.raw && CD.raw.classes || []).find(c => c.name === cls);
  const stuIndices = clsObj ? (CD.studentsByGroup[clsObj.group_id] || []) : [];

  const LEVELS = ['age2', 'age3', 'age4', 'kinder'];
  const LEVEL_LABELS = { age2: 'Age 2 Skills', age3: 'Age 3 Skills', age4: 'Age 4 Skills', kinder: 'Kindergarten Skills' };
  const RANK_TO_LEVEL = { 1: 'age2', 2: 'age3', 3: 'age4', 4: 'kinder' };

  const allWindows = !f.window || f.window === 'All assessment windows';
  const winIdx = allWindows ? null : CD.windowIdx[f.window];
  const langCode = f.language === 'English' ? 'EN' : f.language === 'Spanish' ? 'SP' : 'All';
  const figmaLang = langCode === 'EN' ? 'English' : langCode === 'SP' ? 'Spanish' : 'All';

  // Apply language filter to the class roster
  const eligibleStudents = stuIndices.filter(ui => {
    const s = CD.studentByIdx[ui];
    return s && (langCode === 'All' || s.language === langCode);
  });

  // Compute per-student rank for a single scale code (max across EN+SP versions).
  function studentRankForCode(ui, code) {
    let max = 0;
    for (const idx of (CD.scalesByDomain[drilledDomain === 'Overview' ? null : drilledDomain] || [])) {
      const sc = CD.scaleByIdx[idx];
      if (sc.code !== code) continue;
      if (figmaLang !== 'All' && sc.language !== figmaLang) continue;
      for (const lvl of (CD.levelsByUser[ui] || [])) {
        if (lvl.s !== idx) continue;
        if (winIdx !== null && lvl.w !== winIdx) continue;
        if (lvl.r > max) max = lvl.r;
      }
    }
    return max;
  }

  // Compute per-row data: { code, name, supported, classScoreRank, buckets }
  // For drilled-into Overview: rows are 4 domains.
  // For drilled-into specific domain: rows are scales of that domain.
  // For drilled-into specific standard: just one row for that scale.
  let rowsData;
  const drilledEntry = path[0];
  if (drilledEntry && drilledEntry.isStandard) {
    const dom = drilledEntry.scaleDomain;
    const code = drilledEntry.scaleCode;
    const supported = supportedRanksForCode(dom, code);
    const buckets = { notAttempted: [], age2: [], age3: [], age4: [], kinder: [] };
    const ranks = [];
    // Inline studentRankForCode using the standard's domain (overrides the closure's drilledDomain)
    const rankForCode = (ui) => {
      let max = 0;
      for (const idx of (CD.scalesByDomain[dom] || [])) {
        const sc = CD.scaleByIdx[idx];
        if (sc.code !== code) continue;
        if (figmaLang !== 'All' && sc.language !== figmaLang) continue;
        for (const lvl of (CD.levelsByUser[ui] || [])) {
          if (lvl.s !== idx) continue;
          if (winIdx !== null && lvl.w !== winIdx) continue;
          if (lvl.r > max) max = lvl.r;
        }
      }
      return max;
    };
    for (const ui of eligibleStudents) {
      const stu = CD.studentByIdx[ui];
      const rank = rankForCode(ui);
      if (rank === 0) buckets.notAttempted.push(stu.name);
      else buckets[RANK_TO_LEVEL[rank]].push(stu.name);
      if (rank > 0) ranks.push(rank);
    }
    ranks.sort((a, b) => a - b);
    const csRank = ranks.length ? ranks[Math.floor((ranks.length - 1) / 2)] : 0;
    rowsData = [{ code, name: drilledEntry.label, supported, classScoreRank: csRank, buckets }];
  } else if (drilledDomain === 'Overview') {
    // Single row showing the class's overall Overview score (median across all
    // domains per student). Mirrors the SPEC: drilling from Overview shows the
    // overall score, not the per-domain breakdown.
    const buckets = { notAttempted: [], age2: [], age3: [], age4: [], kinder: [] };
    const ranks = [];
    for (const ui of eligibleStudents) {
      const rank = studentLevelForDomain(ui, 'Overview', winIdx);
      const stu = CD.studentByIdx[ui];
      if (rank === 0) buckets.notAttempted.push(stu.name);
      else buckets[RANK_TO_LEVEL[rank]].push(stu.name);
      if (rank > 0) ranks.push(rank);
    }
    ranks.sort((a, b) => a - b);
    const csRank = ranks.length ? ranks[Math.floor((ranks.length - 1) / 2)] : 0;
    rowsData = [{
      code: 'Overview', name: 'Overview', supported: new Set([1,2,3,4]),
      classScoreRank: csRank, buckets,
    }];
  } else {
    // Drilled into a specific domain (Math / Literacy / Language / Executive
    // Function): show a single row for that domain's aggregate score (median
    // across the domain's scales per student). The per-standard breakdown is
    // available by drilling into a specific standard from L0.
    const buckets = { notAttempted: [], age2: [], age3: [], age4: [], kinder: [] };
    const ranks = [];
    for (const ui of eligibleStudents) {
      const rank = studentLevelForDomain(ui, drilledDomain, winIdx);
      const stu = CD.studentByIdx[ui];
      if (rank === 0) buckets.notAttempted.push(stu.name);
      else buckets[RANK_TO_LEVEL[rank]].push(stu.name);
      if (rank > 0) ranks.push(rank);
    }
    ranks.sort((a, b) => a - b);
    const csRank = ranks.length ? ranks[Math.floor((ranks.length - 1) / 2)] : 0;
    rowsData = [{
      code: drilledDomain, name: drilledDomain, supported: new Set([1, 2, 3, 4]),
      classScoreRank: csRank, buckets,
    }];
  }

  // Header (5 cols: Standard|Domain | Age 2 | Age 3 | Age 4 | Kindergarten).
  // "Standard" only when the user explicitly drilled into a single standard;
  // domain or Overview drills both show a single domain row.
  const headerLabel = (drilledEntry && drilledEntry.isStandard) ? 'Standard' : 'Domain';
  const headerCols = LEVELS.map(lv => {
    return `<th>
      <div class="edu-col-header ${lv}">
        <div style="font-size:14px;font-weight:600;">${LEVEL_LABELS[lv]}</div>
      </div>
    </th>`;
  }).join('');

  // Per-row rendering. When drilled into a single standard, force expansion since
  // collapsing would leave an empty page.
  const forceExpand = drilledEntry && drilledEntry.isStandard;
  const rowsHtml = rowsData.map(row => {
    const isExpanded = forceExpand || state.sl.expandedRows.has(row.code);
    const csLevel = RANK_TO_LEVEL[row.classScoreRank] || null;

    if (!isExpanded) {
      // Collapsed: scale name + colored bars in level columns; "Class Score" badge in
      // the column matching the class median.
      const cells = LEVELS.map(lv => {
        const supportedRank = { age2: 1, age3: 2, age4: 3, kinder: 4 }[lv];
        const isSupported = row.supported.has(supportedRank);
        const isScore = lv === csLevel;
        if (!isSupported) {
          return `<td class="edu-cell-collapsed na"><span class="edu-na">N/A</span></td>`;
        }
        return `<td class="edu-cell-collapsed">
          <div class="edu-bar ${lv}${isScore ? ' is-score' : ''}">
            ${isScore ? '<span class="edu-class-score-label">Class Score</span>' : ''}
          </div>
        </td>`;
      }).join('');
      return `<tr class="edu-row-collapsed">
        <td>
          <div class="edu-domain-cell">
            <button class="expand-chevron" data-action="sl-toggle-expand:${esc(row.code)}" title="Expand">&#8964;</button>
            <span style="font-size:14px;font-weight:600;">${esc(row.name)}</span>
          </div>
        </td>
        ${cells}
      </tr>`;
    }

    // Expanded: scale name + students per level (Class Score column highlighted).
    const cells = LEVELS.map(lv => {
      const supportedRank = { age2: 1, age3: 2, age4: 3, kinder: 4 }[lv];
      const isSupported = row.supported.has(supportedRank);
      const isScore = lv === csLevel;
      if (!isSupported) {
        return `<td class="edu-cell ${lv}"><div class="edu-na-block">N/A</div></td>`;
      }
      const students = row.buckets[lv] || [];
      // Skill bullets — only show when drilled into a specific scale (Overview rows
      // aren't per-scale; bullets only exist per-(scale, age band) per the SPEC CSV)
      const bullets = (drilledDomain !== 'Overview' && SKILLS_BY_AGE[row.code] && SKILLS_BY_AGE[row.code][lv]) || [];
      const bulletsHtml = bullets.length
        ? `<ul class="edu-skill-bullets">${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`
        : '';
      return `<td class="edu-cell ${lv}${isScore ? ' class-score' : ''}">
        ${isScore ? `<div class="edu-class-score-band ${lv}">Class Score</div>` : ''}
        ${bulletsHtml}
        ${students.map(n => `<div class="student-card">${makeAvatar(n)}<span>${esc(n)}</span></div>`).join('')}
      </td>`;
    }).join('');
    const naBanner = row.buckets.notAttempted.length
      ? `<tr class="edu-row-not-attempted">
          <td colspan="5">
            <div class="edu-na-section">
              <div class="edu-na-label">Not Yet Attempted</div>
              <div class="edu-na-students">
                ${row.buckets.notAttempted.map(n => `<div class="student-card">${makeAvatar(n)}<span>${esc(n)}</span></div>`).join('')}
              </div>
            </div>
          </td>
        </tr>`
      : '';
    return `<tr class="edu-row-expanded">
      <td>
        <div class="edu-domain-cell">
          <button class="expand-chevron open" data-action="sl-toggle-expand:${esc(row.code)}" title="Collapse">&#8964;</button>
          <span style="font-size:14px;font-weight:600;">${esc(row.name)}</span>
        </div>
      </td>
      ${cells}
    </tr>${naBanner}`;
  }).join('');

  // L3 always renders as a single-row "edu-grid" matching the Figma class-math
  // layout: Domain label | Not Yet Attempted | 4 age columns.
  // - Standard drill: title = scale's domain, subtitle = scale name, skill bullets per column
  // - Domain drill: title = domain name, no subtitle, no bullets
  // - Overview drill: title = "Overview", no subtitle, no bullets
  if (rowsData.length === 1) {
    const row = rowsData[0];
    const csLevel = RANK_TO_LEVEL[row.classScoreRank] || null;
    const isStandard = drilledEntry && drilledEntry.isStandard;
    const title = isStandard ? (drilledEntry.scaleDomain || drilledDomain) : row.name;
    const subtitle = isStandard ? row.name : '';
    const studentCard = n => `<div class="student-card">${makeAvatar(n)}<span>${esc(n)}</span></div>`;
    const levelCell = lv => {
      const supportedRank = { age2: 1, age3: 2, age4: 3, kinder: 4 }[lv];
      const isSupported = row.supported.has(supportedRank);
      const isScore = lv === csLevel;
      if (!isSupported) {
        return `<div class="edu-g-cell level ${lv} na">N/A</div>`;
      }
      // Bullets are per-(scale code, age band). Only populated for standard drills.
      const bullets = isStandard && SKILLS_BY_AGE[row.code] && SKILLS_BY_AGE[row.code][lv] || [];
      const bulletsHtml = bullets.length
        ? `<ul class="edu-g-bullets">${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`
        : '';
      const students = row.buckets[lv] || [];
      return `<div class="edu-g-cell level ${lv}${isScore ? ' class-score' : ''}">
        ${isScore ? `<div class="edu-g-score-band ${lv}">Class Score</div>` : ''}
        <div class="edu-g-cell-body">
          ${bulletsHtml}
          ${students.map(studentCard).join('')}
        </div>
      </div>`;
    };
    return `
      ${renderBreadcrumbs(path)}
      <div class="report-toolbar">
        <div class="toolbar-left"></div>
        <div class="toolbar-center">${esc(getReportTitle())}</div>
        <div class="toolbar-right"><button class="btn btn-ghost">&#11015; Download CSV</button></div>
      </div>
      <div class="edu-grid">
        <div class="edu-g-h domain">Domain</div>
        <div class="edu-g-h na"></div>
        <div class="edu-g-h age2">Age 2 Skills</div>
        <div class="edu-g-h age3">Age 3 Skills</div>
        <div class="edu-g-h age4">Age 4 Skills</div>
        <div class="edu-g-h kinder">Kindergarten Skills</div>

        <div class="edu-g-cell domain-label">
          <div class="title">${esc(title)}</div>
          ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}
        </div>
        <div class="edu-g-cell not-attempted-col">
          <div class="edu-g-na-tag">Not Yet Attempted</div>
          <div class="edu-g-na-list">
            ${row.buckets.notAttempted.map(studentCard).join('')}
          </div>
        </div>
        ${LEVELS.map(levelCell).join('')}
      </div>
      <div class="report-footer" style="margin-top:12px;">Last Updated: April 27, 2026</div>`;
  }

  return `
    ${renderBreadcrumbs(path)}
    <div class="report-toolbar">
      <div class="toolbar-left"></div>
      <div class="toolbar-center">${esc(getReportTitle())} <span class="info-icon">&#9432;</span></div>
      <div class="toolbar-right"><button class="btn btn-ghost">&#11015; Download CSV</button></div>
    </div>
    <div class="tbl-wrap">
      <table class="edu-report">
        <thead>
          <tr>
            <th>${esc(headerLabel)}</th>
            ${headerCols}
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

/* ============================================================
   RENDER: ASSESSMENT COMPLETION
   ============================================================ */
function acBar(vals) {
  // vals = counts [notStarted, inProgress, completed]
  const [ns, ip, cp] = vals;
  const total = ns + ip + cp;
  const pct = c => total > 0 ? Math.round((c / total) * 100) : 0;
  // Use the rounded percent as both the flex weight and the visibility check
  // so a segment that rounds to 0% renders no colored bar at all.
  return makeBar([
    { cls: 'seg-grey',   flex: pct(ns), label: `${pct(ns)}%` },
    { cls: 'seg-yellow', flex: pct(ip), label: `${pct(ip)}%` },
    { cls: 'seg-green',  flex: pct(cp), label: `${pct(cp)}%` },
  ]);
}

function renderACLegend() {
  // Title is centered: legend items left, spacer, title, spacer, Download CSV right.
  return `
    <div class="legend-bar">
      <div class="leg-item"><div class="leg-dot" style="background:var(--grey-300)"></div> Not started</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--yellow)"></div> In progress</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--green)"></div> Completed <span class="info-icon" title="Students who met the domain completion requirement">&#9432;</span></div>
      <div class="spacer"></div>
      <div class="legend-title">Fall Assessment Completion</div>
      <div class="spacer"></div>
      <button class="btn btn-ghost">&#11015; Download CSV</button>
    </div>`;
}

// L0 – Domains
function renderAC_L0() {
  const f = state.filters;
  const scope = l0ScopeStudents();
  const rows = DOMAINS.map(d => {
    const vals = aggregateCompletion(scope, d, f.window, f.language, f.grade);
    return `<tr>
      <td><span class="bar-label" data-action="ac-drill-domain:${esc(d)}">${esc(d)}</span></td>
      <td>${acBar(vals)}</td>
    </tr>`;
  }).join('');

  return `
    ${renderACLegend()}
    <div class="tbl-wrap">
      <table class="tbl-bars">
        <thead><tr><th>Domain</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

// L1 – Schools
function renderAC_L1(path) {
  const f = state.filters;
  const drilledDomain = path[0].label;
  const schoolOrder = ['District', ...((CD.raw && CD.raw.schools) || []).map(s => s.name)];
  const allScope = l0ScopeStudents();
  const rows = schoolOrder.map(name => {
    const isDistrict = name === 'District';
    const stuIndices = isDistrict
      ? allScope
      : ((() => {
          const sch = (CD.raw && CD.raw.schools || []).find(s => s.name === name);
          return sch ? (CD.studentsBySchool[sch.school_id] || []) : [];
        })());
    const vals = aggregateCompletion(stuIndices, drilledDomain, f.window, f.language, f.grade);
    return `<tr ${isDistrict ? 'class="pinned"' : ''}>
      <td>
        <div class="bar-label">
          ${isDistrict
            ? `<span class="no-link">${esc(name)} <span class="star-badge">&#9733;</span></span>`
            : `<span data-action="ac-drill-school:${esc(name)}" style="text-decoration:underline;cursor:pointer;">${esc(name)}</span>`}
        </div>
      </td>
      <td>${acBar(vals)}</td>
    </tr>`;
  }).join('');

  return `
    ${renderBreadcrumbs(path)}
    ${renderACLegend()}
    <div class="tbl-wrap">
      <table class="tbl-bars">
        <thead>
          <tr>
            <th><span class="sort-hdr">Schools <span class="sort-icons">&#8597;</span></span></th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

// L2 – Classes
function renderAC_L2(path) {
  const f = state.filters;
  const drilledDomain = path[0].label;
  // path = [domain, 'District' literal, school]
  const school = path[2] ? path[2].label : path[1].label;
  const schObj = (CD.raw && CD.raw.schools || []).find(s => s.name === school);
  const schoolStudents = schObj ? (CD.studentsBySchool[schObj.school_id] || []) : [];
  const schoolClasses = schObj
    ? (CD.raw.classes || []).filter(c => c.school_id === schObj.school_id).map(c => c.name)
    : [];
  const classOrder = [`${school} total`, ...schoolClasses];

  const rows = classOrder.map(name => {
    const isTotal = name === `${school} total`;
    const displayName = isTotal ? school : name;
    const stuIndices = isTotal
      ? schoolStudents
      : ((() => {
          const cls = (CD.raw && CD.raw.classes || []).find(c => c.name === name);
          return cls ? (CD.studentsByGroup[cls.group_id] || []) : [];
        })());
    const vals = aggregateCompletion(stuIndices, drilledDomain, f.window, f.language, f.grade);
    return `<tr ${isTotal ? 'class="pinned"' : ''}>
      <td>
        <div class="bar-label">
          ${isTotal
            ? `<span class="no-link">${esc(displayName)} <span class="star-badge">&#9733;</span></span>`
            : `<span data-action="ac-drill-class:${esc(name)}" style="text-decoration:underline;cursor:pointer;">${esc(name)}</span>`}
        </div>
      </td>
      <td>${acBar(vals)}</td>
    </tr>`;
  }).join('');

  return `
    ${renderBreadcrumbs(path)}
    ${renderACLegend()}
    <div class="tbl-wrap">
      <table class="tbl-bars">
        <thead>
          <tr>
            <th><span class="sort-hdr">Classes <span class="sort-icons">&#8597;</span></span></th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

// L3 – Students
function renderAC_L3(path) {
  const f = state.filters;
  const drilledDomain = path[0].label;
  // path = [domain, 'District', school, class]
  const cls = path[3] ? path[3].label : path[2].label;
  const clsObj = (CD.raw && CD.raw.classes || []).find(c => c.name === cls);
  const stuIndices = clsObj ? (CD.studentsByGroup[clsObj.group_id] || []) : [];

  const statusMap = {
    'not-started': { cls: 'not-started', dot: 'not-started', label: 'Not started' },
    'in-progress': { cls: 'in-progress', dot: 'in-progress', label: 'In progress' },
    'completed':   { cls: 'completed',   dot: 'completed',   label: 'Completed' },
  };

  const allWindows = !f.window || f.window === 'All assessment windows';
  const winIdx = allWindows ? null : CD.windowIdx[f.window];
  const langCode = f.language === 'English' ? 'EN' : f.language === 'Spanish' ? 'SP' : 'All';

  const rows = stuIndices.map(ui => {
    const stu = CD.studentByIdx[ui];
    if (!stu) return '';
    if (langCode !== 'All' && stu.language !== langCode) return '';

    // For Overview, a student is Completed only if all 4 skill domains are Completed.
    let status;
    if (drilledDomain === 'Overview') {
      const perDomain = SKILL_DOMAINS.map(d => studentDomainCompletion(ui, d, winIdx));
      status = perDomain.every(c => c === 'not-started') ? 'not-started'
             : perDomain.every(c => c === 'completed') ? 'completed'
             : 'in-progress';
    } else {
      status = studentDomainCompletion(ui, drilledDomain, winIdx);
    }
    const st = statusMap[status];
    return `<tr>
      <td>${makeAvatar(stu.name)} &nbsp; ${esc(stu.name)}</td>
      <td>
        <span class="status-badge status-${st.cls}">
          <span class="status-dot dot-${st.dot}"></span>
          ${st.label}
        </span>
      </td>
    </tr>`;
  }).join('');

  return `
    ${renderBreadcrumbs(path)}
    ${renderACLegend()}
    <div class="tbl-wrap">
      <table class="tbl-students">
        <thead>
          <tr>
            <th><span class="sort-hdr">Student <span class="sort-icons">&#8597;</span></span></th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

/* ============================================================
   RENDER: STUDENT PLACEMENT
   ============================================================ */
function spBar(vals) {
  // vals = counts [notAssessed, needSupport, progressing, onTrack]
  const [na, ns, pr, ot] = vals;
  const total = na + ns + pr + ot;
  const pct = c => total > 0 ? Math.round((c / total) * 100) : 0;
  // Flex by rounded percent so segments that round to 0% don't render at all.
  return makeBar([
    { cls: 'seg-grey',   flex: pct(na), label: `${pct(na)}%` },
    { cls: 'seg-red',    flex: pct(ns), label: `${pct(ns)}%` },
    { cls: 'seg-yellow', flex: pct(pr), label: `${pct(pr)}%` },
    { cls: 'seg-green',  flex: pct(ot), label: `${pct(ot)}%` },
  ]);
}

function renderSPLegend() {
  // Title is centered: legend items left, spacer, title, spacer, Download CSV right.
  return `
    <div class="legend-bar">
      <div class="leg-item"><div class="leg-dot" style="background:var(--grey-300)"></div> Not assessed</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--red)"></div> Need support</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--yellow)"></div> Progressing</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--green)"></div> On track <span class="info-icon" title="Student placement tiers">&#9432;</span></div>
      <div class="spacer"></div>
      <div class="legend-title">Grade-Level Readiness</div>
      <div class="spacer"></div>
      <button class="btn btn-ghost">&#11015; Download CSV</button>
    </div>`;
}

// L0 – Domains
function renderSP_L0() {
  const f = state.filters;
  const scope = l0ScopeStudents();
  const rows = DOMAINS.map(d => {
    const vals = aggregateReadiness(scope, d, f.window, f.language);
    return `<tr>
      <td><span class="bar-label" data-action="sp-drill-domain:${esc(d)}">${esc(d)}</span></td>
      <td>${spBar(vals)}</td>
    </tr>`;
  }).join('');

  return `
    ${renderSPLegend()}
    <div class="tbl-wrap">
      <table class="tbl-bars">
        <thead><tr><th>Domain</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

// L1 – Schools
function renderSP_L1(path) {
  const f = state.filters;
  const drilledDomain = path[0].label;
  const schoolOrder = ['District', ...((CD.raw && CD.raw.schools) || []).map(s => s.name)];
  const allScope = l0ScopeStudents();
  const rows = schoolOrder.map(name => {
    const isDistrict = name === 'District';
    const stuIndices = isDistrict
      ? allScope
      : ((() => {
          const sch = (CD.raw && CD.raw.schools || []).find(s => s.name === name);
          return sch ? (CD.studentsBySchool[sch.school_id] || []) : [];
        })());
    const vals = aggregateReadiness(stuIndices, drilledDomain, f.window, f.language);
    return `<tr ${isDistrict ? 'class="pinned"' : ''}>
      <td>
        <div class="bar-label">
          ${isDistrict
            ? `<span class="no-link">${esc(name)} <span class="star-badge">&#9733;</span></span>`
            : `<span data-action="sp-drill-school:${esc(name)}" style="text-decoration:underline;cursor:pointer;">${esc(name)}</span>`}
        </div>
      </td>
      <td>${spBar(vals)}</td>
    </tr>`;
  }).join('');

  return `
    ${renderBreadcrumbs(path)}
    ${renderSPLegend()}
    <div class="tbl-wrap">
      <table class="tbl-bars">
        <thead>
          <tr>
            <th><span class="sort-hdr">Schools <span class="sort-icons">&#8597;</span></span></th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

// L2 – Classes
function renderSP_L2(path) {
  const f = state.filters;
  const drilledDomain = path[0].label;
  const school = path[2] ? path[2].label : path[1].label;
  const schObj = (CD.raw && CD.raw.schools || []).find(s => s.name === school);
  const schoolStudents = schObj ? (CD.studentsBySchool[schObj.school_id] || []) : [];
  const schoolClasses = schObj
    ? (CD.raw.classes || []).filter(c => c.school_id === schObj.school_id).map(c => c.name)
    : [];
  const classOrder = [`${school} total`, ...schoolClasses];

  const rows = classOrder.map(name => {
    const isTotal = name === `${school} total`;
    const displayName = isTotal ? school : name;
    const stuIndices = isTotal
      ? schoolStudents
      : ((() => {
          const cls = (CD.raw && CD.raw.classes || []).find(c => c.name === name);
          return cls ? (CD.studentsByGroup[cls.group_id] || []) : [];
        })());
    const vals = aggregateReadiness(stuIndices, drilledDomain, f.window, f.language);
    return `<tr ${isTotal ? 'class="pinned"' : ''}>
      <td>
        <div class="bar-label">
          ${isTotal
            ? `<span class="no-link">${esc(displayName)} <span class="star-badge">&#9733;</span></span>`
            : `<span data-action="sp-drill-class:${esc(name)}" style="text-decoration:underline;cursor:pointer;">${esc(name)}</span>`}
        </div>
      </td>
      <td>${spBar(vals)}</td>
    </tr>`;
  }).join('');

  return `
    ${renderBreadcrumbs(path)}
    ${renderSPLegend()}
    <div class="tbl-wrap">
      <table class="tbl-bars">
        <thead>
          <tr>
            <th><span class="sort-hdr">Classes <span class="sort-icons">&#8597;</span></span></th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

// L3 – Students
function renderSP_L3(path) {
  const f = state.filters;
  const drilledDomain = path[0].label;
  // path = [domain, 'District', school, class]
  const cls = path[3] ? path[3].label : path[2].label;
  const clsObj = (CD.raw && CD.raw.classes || []).find(c => c.name === cls);
  const stuIndices = clsObj ? (CD.studentsByGroup[clsObj.group_id] || []) : [];

  const PLACEMENT_LABELS = {
    'not-assessed': 'Not assessed',
    'need-support': 'Need support',
    'progressing':  'Progressing',
    'on-track':     'On track',
  };
  const DOT_COLORS = {
    'not-assessed': 'var(--grey-400)',
    'need-support': 'var(--red)',
    'progressing':  'var(--yellow)',
    'on-track':     'var(--green)',
  };

  const allWindows = !f.window || f.window === 'All assessment windows';
  const winIdx = allWindows ? null : CD.windowIdx[f.window];
  const langCode = f.language === 'English' ? 'EN' : f.language === 'Spanish' ? 'SP' : 'All';
  const useDomain = drilledDomain && drilledDomain !== 'Overview';
  const domainScales = useDomain ? new Set(CD.scalesByDomain[drilledDomain] || []) : null;

  const rows = stuIndices.map(ui => {
    const stu = CD.studentByIdx[ui];
    if (!stu) return '';
    if (langCode !== 'All' && stu.language !== langCode) return '';
    const cobj = CD.classByGroup[stu.group_id];
    const gradeRank = cobj ? GRADE_TO_RANK[cobj.grade] : null;

    let placement = 'not-assessed';
    if (gradeRank) {
      const ranks = [];
      for (const lvl of (CD.levelsByUser[ui] || [])) {
        if (lvl.r === 0) continue;
        if (winIdx !== null && lvl.w !== winIdx) continue;
        if (useDomain && !domainScales.has(lvl.s)) continue;
        ranks.push(lvl.r);
      }
      if (ranks.length > 0) {
        ranks.sort((a, b) => a - b);
        const studentRank = ranks[Math.floor((ranks.length - 1) / 2)];
        placement = studentRank < gradeRank ? 'need-support'
                  : studentRank === gradeRank ? 'progressing'
                  : 'on-track';
      }
    }

    const dotColor = DOT_COLORS[placement];
    const badgeCls = placement === 'need-support' ? 'status-need-support'
                   : placement === 'progressing'  ? 'status-progressing'
                   : placement === 'on-track'     ? 'status-on-track'
                   :                                'status-not-started';
    return `<tr>
      <td>${makeAvatar(stu.name)} &nbsp; ${esc(stu.name)}</td>
      <td>
        <span class="status-badge ${badgeCls}">
          <span class="status-dot" style="background:${dotColor}"></span>
          ${PLACEMENT_LABELS[placement]}
        </span>
      </td>
    </tr>`;
  }).join('');

  return `
    ${renderBreadcrumbs(path)}
    ${renderSPLegend()}
    <div class="tbl-wrap">
      <table class="tbl-students">
        <thead>
          <tr>
            <th><span class="sort-hdr">Student <span class="sort-icons">&#8597;</span></span></th>
            <th>Placement</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: April 27, 2026</div>`;
}

/* ============================================================
   RENDER: REPORT BLOCK
   ============================================================ */
function renderReportContent() {
  const r = state.report;
  if (r === 'student-levels') {
    const { level, path } = state.sl;
    switch (level) {
      case 0: return renderSL_L0();
      case 1: return renderSL_L1(path);
      case 2: return renderSL_L2(path);
      case 3: return renderSL_L3(path);
      default: return renderSL_L0();
    }
  }
  if (r === 'completion') {
    const { level, path } = state.ac;
    switch (level) {
      case 0: return renderAC_L0();
      case 1: return renderAC_L1(path);
      case 2: return renderAC_L2(path);
      case 3: return renderAC_L3(path);
      default: return renderAC_L0();
    }
  }
  if (r === 'student-placement') {
    const { level, path } = state.sp;
    switch (level) {
      case 0: return renderSP_L0();
      case 1: return renderSP_L1(path);
      case 2: return renderSP_L2(path);
      case 3: return renderSP_L3(path);
      default: return renderSP_L0();
    }
  }
  return '';
}

/* ============================================================
   RENDER: PAGE TITLE
   ============================================================ */
function getPageTitle() {
  const titles = {
    'student-levels':    'Student Learning Levels',
    'completion':        'Assessment Completion',
    'student-placement': 'Grade-Level Readiness',
  };
  return titles[state.report] || '';
}

function getReportTitle() {
  // Window is selected via filter; the title itself stays clean.
  const titles = {
    'student-levels':    'Student Learning Levels',
    'completion':        'Assessment Completion',
    'student-placement': 'Grade-Level Readiness',
  };
  return titles[state.report] || '';
}

/* ============================================================
   RENDER: WINDOW BANNER (for Assessment Completion)
   ============================================================ */
function renderWindowBanner() {
  if (state.windowBannerDismissed) return '';
  // Only show for completion and placement; banner shows the selected window's date range.
  if (!['completion', 'student-placement'].includes(state.report)) return '';
  const ranges = {
    'Fall 2025':   { dates: 'Aug 1 – Dec 31, 2025', daysLeft: 0 },
    'Spring 2026': { dates: 'Jan 1 – Apr 27, 2026', daysLeft: 0 },
  };
  const r = ranges[state.filters.window];
  if (!r) return ''; // "All assessment windows" or unknown — no banner
  const colorClass = r.daysLeft >= 15 ? 'green' : r.daysLeft >= 7 ? 'yellow' : 'red';
  return `
    <div class="window-banner ${colorClass}" id="windowBanner">
      <span>&#128197;</span>
      ${state.filters.window} window: ${r.dates}
      <button class="banner-close" data-action="dismissWindowBanner">&times;</button>
    </div>`;
}

/* ============================================================
   MAIN RENDER
   ============================================================ */
/* ============================================================
   REFRESH SL FROM COMPUTED DATA
   Recomputes the SL.* structures (the same shape as the original
   hardcoded fixture) on every render based on current filter/drill
   state. No-op until computed.json finishes loading.
   ============================================================ */
function langToFigma(lang) { return lang === 'EN' ? 'English' : lang === 'SP' ? 'Spanish' : 'All'; }

// Returns the student indices in scope for the L0 view, applying school/class filters.
function l0ScopeStudents() {
  const f = state.filters;
  if (!CD.ready) return [];
  // Class filter wins (most specific)
  if (f.cls && f.cls !== 'All') {
    const c = (CD.raw.classes || []).find(c => c.name === f.cls);
    return c ? (CD.studentsByGroup[c.group_id] || []) : [];
  }
  // Effective school: school admin sees just their school
  let effSchool = f.school;
  if (state.role === 'school' && CD.raw.schools.length) {
    effSchool = CD.raw.schools[0].name; // pick first as the school admin's home
  }
  if (effSchool && effSchool !== 'All') {
    const s = (CD.raw.schools || []).find(s => s.name === effSchool);
    return s ? (CD.studentsBySchool[s.school_id] || []) : [];
  }
  return CD.studentByIdx.map((_, i) => i);
}

// Mirror of l0ScopeStudents() that returns the scope as an encodable context
// (kind + id) rather than a list of indices. Used to populate pill ctx so the
// popup can resolve the same scope at click time.
function l0ScopeCtx() {
  const f = state.filters;
  if (f.cls && f.cls !== 'All') {
    const c = (CD.raw && CD.raw.classes || []).find(c => c.name === f.cls);
    return c ? { sk: 'class', sid: c.group_id } : { sk: 'all' };
  }
  let effSchool = f.school;
  if (state.role === 'school' && CD.raw && CD.raw.schools.length) {
    effSchool = CD.raw.schools[0].name;
  }
  if (effSchool && effSchool !== 'All') {
    const s = (CD.raw && CD.raw.schools || []).find(s => s.name === effSchool);
    return s ? { sk: 'school', sid: s.school_id } : { sk: 'all' };
  }
  return { sk: 'all' };
}

function studentsForScopeCtx(ctx) {
  if (!ctx) return l0ScopeStudents();
  if (ctx.sk === 'school' && ctx.sid) return CD.studentsBySchool[ctx.sid] || [];
  if (ctx.sk === 'class'  && ctx.sid) return CD.studentsByGroup[ctx.sid] || [];
  return l0ScopeStudents();
}

function refreshSL() {
  if (!CD.ready) return;
  const f = state.filters;
  const win = f.window;
  const lang = f.language;
  const grade = f.grade;
  const figmaLang = langToFigma(lang);
  const scope = l0ScopeStudents();

  // Reset SL with the same shape the renderers expect.
  // L3 (Educator Class Report) still relies on synthetic data — keep prior classReport intact.
  const prevClassReport = SL.classReport || {};
  SL = {
    domain: {},
    domainStandards: {},
    mathStandards: [],
    standard: {},
    schools: {},
    classes: {},
    classReport: prevClassReport,
  };

  // Build domain rollups for L0 Overview mode
  SL.domain.Overview = aggregateLevels(scope, 'Overview', win, lang, grade);
  for (const d of SKILL_DOMAINS) {
    SL.domain[d] = aggregateLevels(scope, d, win, lang, grade);
    // Use the canonical SPEC list (name + order). Filter to only include codes
    // for which the dataset has at least one scale matching the language filter.
    const codesPresent = new Set();
    for (const idx of (CD.scalesByDomain[d] || [])) {
      const sc = CD.scaleByIdx[idx];
      if (figmaLang !== 'All' && sc.language !== figmaLang) continue;
      codesPresent.add(sc.code);
    }
    SL.domainStandards[d] = (SCALE_DISPLAY[d] || []).filter(item => codesPresent.has(item.code));
  }
  SL.mathStandards = SL.domainStandards.Math || [];

  // Build per-scale rollups when a specific domain filter is selected (L0 standards mode).
  // Group by scale code so EN + SP versions of the same code merge into one row;
  // each student contributes their HIGHEST rank across the merged scales (per SPEC).
  if (f.domain && f.domain !== 'Overview' && CD.scalesByDomain[f.domain]) {
    const codeToIdxs = {};
    for (const idx of CD.scalesByDomain[f.domain]) {
      const sc = CD.scaleByIdx[idx];
      if (figmaLang !== 'All' && sc.language !== figmaLang) continue;
      (codeToIdxs[sc.code] = codeToIdxs[sc.code] || []).push(idx);
    }
    for (const [code, idxs] of Object.entries(codeToIdxs)) {
      SL.standard[code] = aggregateLevelsMergedByCode(scope, new Set(idxs), win, lang, grade);
    }
  }

  // L1 (Schools view): aggregate per-school for either the drilled-into domain
  // OR a specific standard scale (when the user drilled in from L0 standards mode).
  const drilledEntry = state.sl.level >= 1 ? state.sl.path[0] : null;
  const drilledLabel = drilledEntry ? drilledEntry.label : null;
  // Build an aggregator that knows whether we're drilling into a domain or a single scale code.
  const aggregateDrilled = (stuIndices, windowName) => {
    if (!drilledEntry) return [0, 0, 0, 0, 0];
    if (drilledEntry.isStandard) {
      // Aggregate as a single scale code, merging EN + SP versions
      const scIdxs = new Set();
      for (const idx of (CD.scalesByDomain[drilledEntry.scaleDomain] || [])) {
        const sc = CD.scaleByIdx[idx];
        if (sc.code !== drilledEntry.scaleCode) continue;
        if (figmaLang !== 'All' && sc.language !== figmaLang) continue;
        scIdxs.add(idx);
      }
      return aggregateLevelsMergedByCode(stuIndices, scIdxs, windowName, lang, grade);
    }
    return aggregateLevels(stuIndices, drilledEntry.label, windowName, lang, grade);
  };
  if (drilledLabel) {
    SL.schools.District = aggregateDrilled(scope, win);
    for (const sch of CD.raw.schools) {
      const stuIndices = CD.studentsBySchool[sch.school_id] || [];
      SL.schools[sch.name] = aggregateDrilled(stuIndices, win);
    }
  }

  // L2 (Classes view): aggregate per-class for the drilled-into school + scope
  // path = [scope, 'District' literal, school, class?]
  const drilledSchool = state.sl.level >= 2 ? (state.sl.path[2] ? state.sl.path[2].label : null) : null;
  if (drilledLabel && drilledSchool) {
    const schObj = CD.raw.schools.find(s => s.name === drilledSchool);
    if (schObj) {
      const schoolStudents = CD.studentsBySchool[schObj.school_id] || [];
      SL.classes[`${drilledSchool} total`] = aggregateDrilled(schoolStudents, win);
      for (const cls of CD.raw.classes) {
        if (cls.school_id !== schObj.school_id) continue;
        const stuIndices = CD.studentsByGroup[cls.group_id] || [];
        SL.classes[cls.name] = aggregateDrilled(stuIndices, win);
      }
    }
  }

  // Update window globals for renderWindowSubRows + the star indicator
  if (CD.raw.windows.length) {
    SL_WINDOWS = CD.raw.windows.slice();
    // "Current" window = the latest (alphabetical sort doesn't work — sort by start month/year)
    const orderKey = w => {
      const [season, yr] = w.split(' ');
      const seasonRank = season === 'Fall' ? 0 : season === 'Winter' ? 1 : 2;
      return Number(yr) * 10 + seasonRank;
    };
    SL_CURRENT_WINDOW = SL_WINDOWS.slice().sort((a, b) => orderKey(b) - orderKey(a))[0];
  }
}

function render() {
  // Swap the active dataset based on the slGate or completionMode filter.
  // 'demo' on either dropdown uses the synthetic dataset (loaded lazily);
  // everything else uses real data.
  const wantDemo = state.filters.slGate === 'demo' || state.filters.completionMode === 'demo';
  if (wantDemo && !CD.demoLoaded) {
    // Kick off load and re-render once it lands. Render with real data for now
    // so the page isn't blank during the fetch.
    CD.levelsByUser = CD.realLevelsByUser;
    ensureDemoLoaded().then(() => render());
  } else if (wantDemo) {
    CD.levelsByUser = CD.demoLevelsByUser || CD.realLevelsByUser;
  } else {
    CD.levelsByUser = CD.realLevelsByUser;
  }

  refreshSL();
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <h1 class="page-title">${esc(getPageTitle())}</h1>
    ${renderFilterCard()}
    ${state.generated ? renderWindowBanner() : ''}
    ${state.generated ? `<div class="report-block">${renderReportContent()}</div>` : ''}`;

  updateSidebar();
}

/* ============================================================
   SIDEBAR ACTIVE STATE
   ============================================================ */
function updateSidebar() {
  document.querySelectorAll('.nav-deep-item, .nav-item').forEach(el => el.classList.remove('active'));
  const map = {
    'student-levels':    'nav-student-levels',
    'completion':        'nav-completion',
    'student-placement': 'nav-student-placement',
  };
  const el = document.getElementById(map[state.report]);
  if (el) el.classList.add('active');
}

/* ============================================================
   EVENT HANDLING
   ============================================================ */
function wireEvents() {
  const main = document.getElementById('mainContent');

  // Custom dropdown open/close
  main.addEventListener('click', e => {
    const trigger = e.target.closest('.cdd-trigger');
    const option = e.target.closest('.cdd-option');

    if (option) {
      const cdd = option.closest('.cdd');
      if (cdd.dataset.disabled) return;
      const name = cdd.dataset.name;
      const val = option.dataset.value;
      cdd.classList.remove('open');
      if (isLocked() || state.pendingFilters[name] === val) return;

      // Threshold settings are display options — apply immediately to both pending
      // and committed so the report updates without "Generate Report".
      if (name === 'completionMode' || name === 'slGate') {
        state.pendingFilters[name] = val;
        state.filters[name] = val;
        render();
        return;
      }

      // Other filters: stage in pendingFilters until "Generate Report" is clicked.
      state.pendingFilters[name] = val;
      if (name === 'school') state.pendingFilters.cls = 'All';
      state.dirty = true;
      render();
      return;
    }

    if (trigger) {
      const cdd = trigger.closest('.cdd');
      if (cdd.dataset.disabled) return;
      const isOpen = cdd.classList.contains('open');
      // Close all other open dropdowns
      main.querySelectorAll('.cdd.open').forEach(d => d.classList.remove('open'));
      if (!isOpen) cdd.classList.add('open');
      return;
    }

    // Click outside any dropdown — close all
    main.querySelectorAll('.cdd.open').forEach(d => d.classList.remove('open'));

    handleClick(e);
  });

  // Also close dropdowns when clicking outside the filter card
  document.addEventListener('click', e => {
    if (!e.target.closest('.filter-card')) {
      main.querySelectorAll('.cdd.open').forEach(d => d.classList.remove('open'));
    }
  });
}

function handleClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'generate') {
    triggerGenerate();
    return;
  }
  if (action === 'reset') {
    resetFilters();
    return;
  }
  if (action === 'closeDirtyMsg') {
    state.dirty = false; render(); return;
  }
  if (action === 'closeLockMsg') {
    render(); return; // re-render without dismissing (banner is spec-required)
  }
  if (action === 'dismissWindowBanner') {
    state.windowBannerDismissed = true; render(); return;
  }

  // Breadcrumb navigation
  if (action && action.startsWith('breadcrumb:')) {
    const idx = parseInt(action.split(':')[1]);
    navigateToBreadcrumb(idx);
    return;
  }

  // Student Levels drilling. When the user has a specific class selected in the
  // filter, drilling a domain or standard jumps STRAIGHT to the class view (skipping
  // the school + class lists). Same idea for school: a specific school skips L1.
  // Helper resolves the (school name, class name) to attach to the drill path.
  const drillContext = () => {
    const f = state.filters;
    let schoolName = null, className = null;
    if (f.cls && f.cls !== 'All') {
      const cls = (CD.raw && CD.raw.classes || []).find(c => c.name === f.cls);
      if (cls) {
        className = cls.name;
        const sch = (CD.raw && CD.raw.schools || []).find(s => s.school_id === cls.school_id);
        if (sch) schoolName = sch.name;
      }
    } else if (f.school && f.school !== 'All') {
      schoolName = f.school;
    }
    return { schoolName, className };
  };

  // Path entries that the user *skipped* (didn't actually navigate through) get
  // a `skipped: true` flag so the breadcrumb hides them.
  if (action && action.startsWith('sl-drill-domain:')) {
    const domain = action.split(':').slice(1).join(':');
    const { schoolName, className } = drillContext();
    if (className) {
      state.sl.level = 3;
      state.sl.path = [
        { label: domain },
        { label: 'District', skipped: true },
        { label: schoolName || '', skipped: true },
        { label: className },
      ];
    } else if (schoolName) {
      state.sl.level = 2;
      state.sl.path = [
        { label: domain },
        { label: 'District', skipped: true },
        { label: schoolName },
      ];
    } else {
      state.sl.level = 1;
      state.sl.path = [{ label: domain }, { label: 'District' }];
    }
    render(); return;
  }
  if (action && action.startsWith('sl-drill-standard:')) {
    // Format: sl-drill-standard:<domain>|<scaleCode>|<displayName>
    const rest = action.slice('sl-drill-standard:'.length);
    const [domain, code, name] = rest.split('|');
    const head = { label: name || code, isStandard: true, scaleCode: code, scaleDomain: domain };
    const { schoolName, className } = drillContext();
    if (className) {
      state.sl.level = 3;
      state.sl.path = [
        head,
        { label: 'District', skipped: true },
        { label: schoolName || '', skipped: true },
        { label: className },
      ];
    } else if (schoolName) {
      state.sl.level = 2;
      state.sl.path = [
        head,
        { label: 'District', skipped: true },
        { label: schoolName },
      ];
    } else {
      state.sl.level = 1;
      state.sl.path = [head, { label: 'District' }];
    }
    render(); return;
  }
  if (action && action.startsWith('sl-drill-school:')) {
    const school = action.split(':').slice(1).join(':');
    state.sl.path = [...state.sl.path.slice(0, 2), { label: school }];
    state.sl.level = 2;
    render(); return;
  }
  if (action && action.startsWith('sl-drill-class:')) {
    const cls = action.split(':').slice(1).join(':');
    state.sl.path = [...state.sl.path.slice(0, 3), { label: cls }];
    state.sl.level = 3;
    render(); return;
  }
  if (action && action.startsWith('sl-drill-student:')) {
    // Student-level drill is defined but not built out in this prototype
    return;
  }

  // Assessment Completion drilling
  if (action && action.startsWith('ac-drill-domain:')) {
    const domain = action.split(':').slice(1).join(':');
    state.ac.level = 1;
    state.ac.path = [{ label: domain }, { label: 'District' }];
    render(); return;
  }
  if (action && action.startsWith('ac-drill-school:')) {
    const school = action.split(':').slice(1).join(':');
    state.ac.path = [...state.ac.path.slice(0, 2), { label: school }];
    state.ac.level = 2;
    render(); return;
  }
  if (action && action.startsWith('ac-drill-class:')) {
    const cls = action.split(':').slice(1).join(':');
    state.ac.path = [...state.ac.path.slice(0, 3), { label: cls }];
    state.ac.level = 3;
    render(); return;
  }

  // Show average toggle
  if (action === 'toggleAvg') {
    state.sl.showAvg = e.target.checked;
    render(); return;
  }

  // Collapse all expanded rows
  if (action === 'collapseAll') {
    state.sl.expandedRows.clear();
    render();
    return;
  }

  // Toggle row expansion (all-windows sub-rows or single-window standards)
  if (action && action.startsWith('sl-toggle-expand:')) {
    const key = action.split(':').slice(1).join(':');
    if (state.sl.expandedRows.has(key)) {
      state.sl.expandedRows.delete(key);
    } else {
      state.sl.expandedRows.add(key);
    }
    render();
    return;
  }

  // Open Report Details popup
  if (action === 'openPopup') {
    const colLabel = el.dataset.col;
    const val = Number(el.dataset.val);
    const total = Number(el.dataset.total);
    let ctx = null;
    if (el.dataset.ctx) {
      try { ctx = JSON.parse(el.dataset.ctx); } catch (_) { ctx = null; }
    }
    openDetailPopup(colLabel, val, total, ctx);
    return;
  }

  // Student Placement drilling
  if (action && action.startsWith('sp-drill-domain:')) {
    const domain = action.split(':').slice(1).join(':');
    state.sp.level = 1;
    state.sp.path = [{ label: domain }, { label: 'District' }];
    render(); return;
  }
  if (action && action.startsWith('sp-drill-school:')) {
    const school = action.split(':').slice(1).join(':');
    state.sp.path = [...state.sp.path.slice(0, 2), { label: school }];
    state.sp.level = 2;
    render(); return;
  }
  if (action && action.startsWith('sp-drill-class:')) {
    const cls = action.split(':').slice(1).join(':');
    state.sp.path = [...state.sp.path.slice(0, 3), { label: cls }];
    state.sp.level = 3;
    render(); return;
  }

}

function navigateToBreadcrumb(idx) {
  const cs = current();
  if (idx === 0) {
    // Go back to L0 (domain list)
    cs.level = 0;
    cs.path = [];
  } else {
    cs.level = idx;
    cs.path = cs.path.slice(0, idx + 1);
  }
  render();
}

/* ============================================================
   GENERATE REPORT
   ============================================================ */
function triggerGenerate() {
  if (state.loading) return;
  state.loading = true;
  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.add('open');

  // Commit pending filter selections — only now does the report use them.
  state.filters = { ...state.pendingFilters };

  // Reset any active cascade when re-generating
  state.sl.level = 0; state.sl.path = []; state.sl.expandedRows = new Set();
  state.ac.level = 0; state.ac.path = [];
  state.sp.level = 0; state.sp.path = [];

  // Animate progress bar over ~3 seconds
  const fill = document.getElementById('loadingBarFill');
  const label = document.getElementById('loadingBarLabel');
  const DURATION = 3000; // ms
  const start = Date.now();
  fill.style.width = '0%';
  label.textContent = '2 min remaining';

  const tick = () => {
    if (!state.loading) return;
    const elapsed = Date.now() - start;
    const pct = Math.min(100, (elapsed / DURATION) * 100);
    fill.style.width = pct + '%';
    const secsLeft = Math.max(0, Math.round((DURATION - elapsed) / 1000));
    label.textContent = secsLeft > 60
      ? `${Math.ceil(secsLeft / 60)} min remaining`
      : secsLeft > 0 ? `${secsLeft} sec remaining` : 'Almost done…';
    if (pct < 100) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  setTimeout(() => {
    state.loading = false;
    state.dirty = false;
    state.generated = true;
    overlay.classList.remove('open');
    render();
  }, DURATION);
}

function resetFilters() {
  const defaults = {
    window:   SL_CURRENT_WINDOW || 'Spring 2026',
    domain:   'Overview',
    language: 'All',
    school:   'All',
    cls:      'All',
    grade:    'All grades',
    completionMode: 'spec',
    slGate:   'min1',
  };
  // Reset only sets the PENDING values — user still has to click Generate Report
  // for the data to update. (Threshold settings apply immediately, but they reset
  // along with the rest here.)
  state.pendingFilters = { ...defaults };
  state.filters.completionMode = defaults.completionMode;
  state.filters.slGate = defaults.slGate;
  state.dirty = true;
  render();
}

/* ============================================================
   REPORT DETAILS POPUP
   ============================================================ */
// Saturated dot colors for the popup's Learning Level cell — match the
// "highlighted pill" palette so the dots read clearly at 10px.
const LEVEL_COLORS = { age2: 'var(--pink-500)', age3: 'var(--purple-500)', age4: 'var(--blue-500)', kinder: 'var(--teal-400)', na: 'var(--grey-400)' };
const READINESS_COLORS = {
  'On Level':    '#2ea84a',  // deep saturated green
  'Above Level': '#c8e8a8',  // pastel green — clearly lighter than On Level
  'Below Level': 'var(--red)',
};
const RANK_TO_KEY    = { 0: 'na',   1: 'age2',         2: 'age3',         3: 'age4',         4: 'kinder' };
const RANK_TO_LABEL  = { 0: 'Not Assessed', 1: 'Age 2 Skills', 2: 'Age 3 Skills', 3: 'Age 4 Skills', 4: 'Kindergarten Skills' };

// Compute a single student's rank (0-4) under the given pill ctx + window.
// Mirrors the aggregation rules used by aggregateLevels / aggregateLevelsMergedByCode
// so the popup buckets match the totals on the table.
function studentRankForCtx(ui, ctx, windowName) {
  const stu = CD.studentByIdx[ui];
  if (!stu) return -1;
  const f = state.filters;
  const langCode = f.language === 'English' ? 'EN' : f.language === 'Spanish' ? 'SP' : (f.language || 'All');
  if (langCode !== 'All' && stu.language !== langCode) return -1;
  if (f.grade && f.grade !== 'All grades') {
    const c = CD.classByGroup[stu.group_id];
    if (!c || c.grade !== f.grade) return -1;
  }
  const allWindows = !windowName || windowName === 'All assessment windows';
  const winIdx = allWindows ? null : CD.windowIdx[windowName];
  if (!allWindows && winIdx === undefined) return -1;

  if (ctx.tk === 'standard') {
    const figmaLang = langToFigma(f.language);
    let max = 0;
    for (const idx of (CD.scalesByDomain[ctx.d] || [])) {
      const sc = CD.scaleByIdx[idx];
      if (sc.code !== ctx.c) continue;
      if (figmaLang !== 'All' && sc.language !== figmaLang) continue;
      for (const lvl of (CD.levelsByUser[ui] || [])) {
        if (lvl.s !== idx) continue;
        if (lvl.r === 0) continue;
        if (winIdx !== null && lvl.w !== winIdx) continue;
        if (lvl.r > max) max = lvl.r;
      }
    }
    return max;
  }
  // domain or overview: per-student median rank under the SL gate
  const useDomain = ctx.tk === 'domain';
  const domainScales = useDomain ? new Set(CD.scalesByDomain[ctx.d] || []) : null;
  const ranks = [];
  for (const lvl of (CD.levelsByUser[ui] || [])) {
    if (lvl.r === 0) continue;
    if (winIdx !== null && lvl.w !== winIdx) continue;
    if (useDomain && !domainScales.has(lvl.s)) continue;
    ranks.push(lvl.r);
  }
  const cls = CD.classByGroup[stu.group_id];
  const grade = cls ? cls.grade : 'Pre-K 4';
  const minRequired = slGateMinPasses(useDomain ? ctx.d : 'Overview', grade, stu.language);
  if (ranks.length < minRequired) return 0;
  ranks.sort((a, b) => a - b);
  return ranks[Math.floor((ranks.length - 1) / 2)];
}

function readinessFromRank(grade, rank) {
  if (rank === 0) return '—';
  const g = GRADE_TO_RANK[grade];
  if (!g) return '';
  if (rank > g) return 'Above Level';
  if (rank < g) return 'Below Level';
  return 'On Level';
}

function readinessCell(label) {
  const color = READINESS_COLORS[label];
  if (!color) return esc(label);
  return `<span class="readiness-cell">
    <span class="level-dot" style="background:${color}"></span>
    ${esc(label)}
  </span>`;
}

function popupDomainLabel(ctx) {
  if (!ctx) return '';
  if (ctx.tk === 'overview') return 'All Domains';
  if (ctx.tk === 'standard') return `${ctx.d} – ${ctx.c}`;
  return ctx.d || '';
}

function openDetailPopup(colLabel, val, total, ctx) {
  const overlay = document.getElementById('detailPopup');
  document.getElementById('popupTitle').textContent = `${getReportTitle()}: Report Details`;
  const pct = total > 0 ? Math.round((val / total) * 100) : 0;
  document.getElementById('popupSubtitle').textContent = `${colLabel}: ${pct}% (${val} of ${total})`;

  const tbody = document.getElementById('popupTbody');
  let rowsHtml = '';

  if (ctx && CD.ready) {
    const scope = studentsForScopeCtx(ctx);
    const targetRank = ctx.r;
    const win = ctx.w;
    const districtName = (CD.raw.districts && CD.raw.districts[0] && CD.raw.districts[0].name) || '';
    const matched = [];
    for (const ui of scope) {
      const rank = studentRankForCtx(ui, ctx, win);
      if (rank < 0) continue;          // filtered out by language/grade
      if (rank !== targetRank) continue;
      const stu = CD.studentByIdx[ui];
      const cls = CD.classByGroup[stu.group_id];
      const sch = cls ? CD.schoolBySid[cls.school_id] : null;
      matched.push({
        district: districtName,
        school:   sch ? sch.name : '',
        cls:      cls ? cls.name : '',
        name:     stu.name,
        grade:    cls ? cls.grade : '',
        domain:   popupDomainLabel(ctx),
        rank,
      });
    }
    matched.sort((a, b) => a.name.localeCompare(b.name));
    rowsHtml = matched.map(s => {
      const lvlKey = RANK_TO_KEY[s.rank];
      const lvlLabel = RANK_TO_LABEL[s.rank];
      return `
        <tr>
          <td>${esc(s.district)}</td>
          <td>${esc(s.school)}</td>
          <td>${esc(s.cls)}</td>
          <td>${esc(s.name)}</td>
          <td>${esc(s.grade)}</td>
          <td>${esc(s.domain)}</td>
          <td>
            <span class="learning-level-cell">
              <span class="level-dot" style="background:${LEVEL_COLORS[lvlKey]}"></span>
              ${esc(lvlLabel)}
            </span>
          </td>
          <td>${readinessCell(readinessFromRank(s.grade, s.rank))}</td>
        </tr>`;
    }).join('');
    if (!matched.length) {
      rowsHtml = `<tr><td colspan="8" style="text-align:center;color:var(--grey-500);padding:24px;">No students match this bucket.</td></tr>`;
    }
  } else {
    rowsHtml = `<tr><td colspan="8" style="text-align:center;color:var(--grey-500);padding:24px;">Click a pill to see student details.</td></tr>`;
  }

  tbody.innerHTML = rowsHtml;
  overlay.classList.add('open');
}

/* ============================================================
   SIDEBAR NAVIGATION
   ============================================================ */
function handleSidebarClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'toggle:engagement') {
    const sub = document.getElementById('navEngagementSub');
    const btn = document.getElementById('navEngagementTop');
    sub.classList.toggle('open');
    btn.classList.toggle('open');
    return;
  }
  if (action === 'toggle:practice') {
    const sub = document.getElementById('navPracticeSub');
    const btn = document.getElementById('navPracticeTop');
    sub.classList.toggle('open');
    btn.classList.toggle('open');
    return;
  }
  if (action === 'toggle:class-reports') {
    const sub = document.getElementById('navClassReportsSub');
    const btn = document.getElementById('navClassReportsTop');
    sub.classList.toggle('open');
    btn.classList.toggle('open');
    return;
  }
  if (action === 'toggle:assessments') {
    const sub = document.getElementById('navAssessmentsSub');
    const btn = document.getElementById('navAssessmentsTop');
    sub.classList.toggle('open');
    btn.classList.toggle('open');
    return;
  }
  if (action === 'report:student-levels') {
    switchReport('student-levels'); return;
  }
  if (action === 'report:completion') {
    switchReport('completion'); return;
  }
  if (action === 'report:student-placement') {
    switchReport('student-placement'); return;
  }
}

function switchReport(report) {
  state.report = report;
  state.dirty = false;
  state.generated = false;
  state.sl.level = 0; state.sl.path = []; state.sl.expandedRows = new Set();
  state.ac.level = 0; state.ac.path = [];
  state.sp.level = 0; state.sp.path = [];
  // Set domain filter appropriately (both committed and pending)
  if (report === 'completion') {
    state.filters.domain = 'Overview';
    state.pendingFilters.domain = 'Overview';
  }
  render();
}

/* ============================================================
   LOADING CANCEL
   ============================================================ */
document.getElementById('loadingCancel').addEventListener('click', () => {
  state.loading = false;
  state.dirty = true;
  document.getElementById('loadingOverlay').classList.remove('open');
  render();
});

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('.sidebar').addEventListener('click', handleSidebarClick);

  // Role switcher
  document.querySelector('.topbar').addEventListener('click', e => {
    const btn = e.target.closest('.role-btn');
    if (!btn) return;
    const role = btn.dataset.role;
    if (role === state.role) return;
    state.role = role;
    document.querySelectorAll('.role-btn').forEach(b => b.classList.toggle('active', b.dataset.role === role));
    // Reset school/class when switching roles (both committed and pending)
    const newSchool = role === 'school'
      ? ((CD.raw && CD.raw.schools && CD.raw.schools[0]) ? CD.raw.schools[0].name : 'All')
      : 'All';
    state.filters.school = newSchool;
    state.filters.cls = 'All';
    state.pendingFilters.school = newSchool;
    state.pendingFilters.cls = 'All';
    // Reset cascades
    state.sl.level = 0; state.sl.path = [];
    state.ac.level = 0; state.ac.path = [];
    state.sp.level = 0; state.sp.path = [];
    state.dirty = false;
    state.generated = false;
    render();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('loadingOverlay').classList.remove('open');
      document.getElementById('detailPopup').classList.remove('open');
      state.loading = false;
    }
  });

  // District dropdown
  document.getElementById('districtBtn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('districtDropdown').classList.toggle('open');
  });
  document.addEventListener('click', () => {
    document.getElementById('districtDropdown').classList.remove('open');
  });

  // Detail popup close handlers (X button, Cancel button, click-outside)
  const closePopup = () => document.getElementById('detailPopup').classList.remove('open');
  document.getElementById('popupClose').addEventListener('click', closePopup);
  document.getElementById('popupCancel').addEventListener('click', closePopup);
  document.getElementById('detailPopup').addEventListener('click', e => {
    if (e.target === document.getElementById('detailPopup')) closePopup();
  });

  // Wire delegated listeners on #mainContent ONCE (they survive re-renders since
  // render() only replaces innerHTML, not the #mainContent element itself).
  wireEvents();

  // Initial render with placeholder data, then re-render once computed.json arrives.
  render();
  loadComputed()
    .then(() => {
      // Snap initial filter window to the most-recent real window so users see data immediately.
      if (CD.raw && CD.raw.windows.length) {
        const order = w => {
          const [season, yr] = w.split(' ');
          return Number(yr) * 10 + (season === 'Fall' ? 0 : season === 'Winter' ? 1 : 2);
        };
        const newest = CD.raw.windows.slice().sort((a, b) => order(b) - order(a))[0];
        if (state.filters.window !== newest) state.filters.window = newest;
        state.pendingFilters.window = newest;
      }
      render();
    })
    .catch(err => {
      console.error('Failed to load computed.json:', err);
    });
});
