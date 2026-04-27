'use strict';

/* ============================================================
   DATA — REAL DATA LAYER
   computed.json is produced by build/preprocess.py from the
   raw items + roster CSVs. All visible numbers in the prototype
   are derived from this in-memory dataset.
   ============================================================ */

const DOMAINS = ['Overview', 'Math', 'Literacy', 'Language', 'Executive Function'];
const SKILL_DOMAINS = ['Math', 'Literacy', 'Language', 'Executive Function'];

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
    let level = 0; // not assessed
    if (ranks.length > 0) {
      ranks.sort((a, b) => a - b);
      // Lower median for ties (matches the SPEC's "median" rollup intent).
      level = ranks[Math.floor((ranks.length - 1) / 2)];
    }
    counts[level]++;
  }
  return counts;
}

// Domain completion threshold (fraction of scales required to be considered "Complete").
// SPEC values cluster around 70%; using a single fraction here as a placeholder until
// the per-(domain, grade) thresholds are confirmed.
const COMPLETION_THRESHOLD_FRACTION = 0.7;

function scalesInDomain(domain, language) {
  if (!CD.ready) return [];
  const figmaLang = language === 'EN' ? 'English' : language === 'SP' ? 'Spanish' : null;
  return (CD.scalesByDomain[domain] || []).filter(idx => {
    if (!figmaLang) return true;
    return CD.scaleByIdx[idx].language === figmaLang;
  });
}

// Aggregate Assessment Completion: returns [notStarted, inProgress, completed] counts.
// "Completed" = student passed >= ceil(THRESHOLD × scales-in-domain) scales.
// "Not Started" = student attempted 0 scales in domain.
// "In Progress" = anything between.
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
    // Per-student language: scales eligible for this student
    const eligibleScales = new Set(scalesInDomain(domain, stu.language));
    const required = Math.ceil(eligibleScales.size * COMPLETION_THRESHOLD_FRACTION);

    let attempted = 0;
    let passed = 0;
    const userLevels = CD.levelsByUser[ui] || [];
    const seenScales = new Set();
    for (const lvl of userLevels) {
      if (winIdx !== null && lvl.w !== winIdx) continue;
      if (!eligibleScales.has(lvl.s)) continue;
      if (seenScales.has(lvl.s)) continue;
      seenScales.add(lvl.s);
      attempted++;
      if (lvl.r > 0) passed++;
    }
    if (attempted === 0) counts[0]++;
    else if (passed >= required && required > 0) counts[2]++;
    else counts[1]++;
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
    if (ranks.length === 0) { counts[0]++; continue; }
    ranks.sort((a, b) => a - b);
    const studentRank = ranks[Math.floor((ranks.length - 1) / 2)];

    if (studentRank < gradeRank) counts[1]++;       // need support
    else if (studentRank === gradeRank) counts[2]++; // progressing
    else counts[3]++;                                // on track
  }
  return counts;
}

async function loadComputed() {
  const r = await fetch('data/computed.json');
  CD.raw = await r.json();
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
  CD.ready = true;
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
let SL_WINDOWS = ['Fall 2025', 'Winter 2025', 'Spring 2026'];
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
  filters: {
    window: 'Spring 2026',  // most-recent real window (overridden after CD loads)
    domain: 'Overview',
    language: 'All',
    school: 'All',
    cls: 'All',
    grade: 'All grades',
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
// Bar + pill tag color = the modal skill band for this row, so it matches the
// highlighted pill shown when Show Average is off (same data, same color).
function makeAvgBar(vals) {
  const avg = calcAverage(vals);
  if (avg === null) return '<td colspan="5" class="avg-cell"><em style="color:var(--grey-400);font-size:12px;">Not enough data</em></td>';
  // 5 equal columns (NA, Age 2, Age 3, Age 4, Kinder) at 20% each.
  // Each value unit spans one column: avg=2 → start of Age 2 (20%), avg=3 → start of Age 3 (40%),
  // avg=5 → start of Kinder (80%). So avg=2.5 sits halfway through Age 2.
  const pctPos = (avg - 1) * 20;
  const display = avg.toFixed(1);
  const band = PILL_TYPES[hiIdx(vals)]; // 'age2' | 'age3' | 'age4' | 'kinder'
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

function makePill(val, total, idx, hi, colLabel) {
  const t = PILL_TYPES[idx];
  const hiClass = hi ? ' hi' : '';
  const label = colLabel || COL_LABELS[idx];
  // Every pill (including Not Assessed) is clickable; opens the detail popup for that column.
  return `<span class="pill pill-${t}${hiClass}" data-action="openPopup" data-col="${esc(label)}" data-val="${val}" data-total="${total}">${pillLabel(val, total)}</span>`;
}

function makeBar(segs) {
  // segs: [{cls, flex, label}]
  return '<div class="stacked-bar">' +
    segs.filter(s => s.flex > 0).map(s =>
      `<div class="seg ${s.cls}" style="flex:${s.flex}">${s.flex >= 10 ? s.label : ''}</div>`
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
  const f = state.filters;
  const isAC = state.report === 'completion';
  const disabled = locked ? 'disabled' : '';

  const sel = (name, opts, val, dis = '') => {
    const isDisabled = dis || disabled;
    const disAttr = isDisabled ? ' data-disabled="true"' : '';
    const items = opts.map(o =>
      `<div class="cdd-option${o === val ? ' selected' : ''}" data-value="${esc(o)}">${esc(o)}</div>`
    ).join('');
    return `<div class="cdd${isDisabled ? ' cdd-disabled' : ''}" data-name="${name}"${disAttr}>
      <div class="cdd-trigger">
        <span class="cdd-value">${esc(val)}</span>
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
  const items = path.map((p, i) => {
    const isLast = i === path.length - 1;
    if (isLast) return `<span class="crumb-current">${esc(p.label)}</span>`;
    return `<a data-action="breadcrumb:${i}">${esc(p.label)}</a>`;
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
  const collapseAll = showToggle ? `
    <button class="btn btn-ghost" style="padding:5px 10px;font-size:11px;" data-action="collapseAll" title="Collapse all rows">
      &#8963; Collapse all
    </button>` : '';
  return `
    <div class="report-toolbar">
      <div class="toolbar-left" style="gap:8px;">${toggle}${collapseAll}</div>
      <div class="toolbar-center">${esc(title)} <span class="info-icon" title="Data from most recent assessment window">&#9432;</span></div>
      <div class="toolbar-right">
        <button class="btn btn-ghost">&#11015; Download CSV</button>
      </div>
    </div>`;
}

/* ============================================================
   RENDER: STUDENT LEVELS TABLE
   ============================================================ */

function slDataCells(vals) {
  // vals = counts [na, age2, age3, age4, kinder]
  if (state.sl.showAvg) return makeAvgBar(vals);
  const total = vals.reduce((a, b) => a + b, 0);
  const hi = hiIdx(vals);
  return vals.map((v, i) => `<td>${makePill(v, total, i, i === hi)}</td>`).join('');
}

function slTheadCells() {
  return `
    <th class="col-na">Not Assessed</th>
    <th class="col-age2">Age 2 Skills</th>
    <th class="col-age3">Age 3 Skills</th>
    <th class="col-age4">Age 4 Skills</th>
    <th class="col-kinder">Kindergarten Skills</th>`;
}

function renderWindowSubRows(getCounts) {
  // getCounts: (windowName) => 5-element counts array [na, age2, age3, age4, kinder]
  return SL_WINDOWS.map(win => {
    const isCurrent = win === SL_CURRENT_WINDOW;
    const vals = getCounts(win);
    const hi = hiIdx(vals);
    const total = vals.reduce((a, b) => a + b, 0);
    return `<tr class="sub-row show window-sub-row">
      <td class="window-sub-label">
        ${esc(win)}${isCurrent ? `<span class="star-badge">&#9733;</span>` : ''}
      </td>
      ${vals.map((v,i) => `<td style="text-align:center;padding:0 6px;">${makePill(v, total, i, i===hi)}</td>`).join('')}
    </tr>`;
  }).join('');
}

// L0 – Domain list (Overview) or Standards list (specific domain selected)
function renderSL_L0() {
  const isAllWindows = state.filters.window === 'All assessment windows';
  const selectedDomain = state.filters.domain;
  const isStandardsMode = selectedDomain !== 'Overview';

  let rows, colHeader;

  const f = state.filters;
  const scope = l0ScopeStudents();
  if (isStandardsMode) {
    // Show standards for the selected domain
    const standards = SL.domainStandards[selectedDomain] || [];
    colHeader = 'Standard';
    rows = standards.map(std => {
      const vals = SL.standard[std] || [0, 0, 0, 0, 0];
      const isExpanded = isAllWindows && state.sl.expandedRows.has(std);
      // Find scale_idx for this code so per-window aggregation works
      const scIdx = (CD.scalesByDomain[selectedDomain] || []).find(idx => CD.scaleByIdx[idx].code === std);
      const subRowsHtml = isExpanded
        ? renderWindowSubRows(win => aggregateLevels(scope, scIdx, win, f.language, f.grade))
        : '';
      return `<tr>
        <td>
          <div class="dom-cell">
            ${isAllWindows ? `<button class="expand-chevron${isExpanded ? ' open' : ''}" data-action="sl-toggle-expand:${esc(std)}" title="Expand">&#8964;</button>` : ''}
            <span class="dom-link" data-action="sl-drill-standard:${esc(std)}">${esc(std)}</span>
          </div>
        </td>
        ${slDataCells(vals)}
      </tr>${subRowsHtml}`;
    }).join('');
  } else {
    // Overview mode: show all domains. Rows are only expandable when "All assessment windows" is selected.
    colHeader = 'Domain';
    rows = DOMAINS.map(domain => {
      const vals = SL.domain[domain] || [0, 0, 0, 0, 0];
      const isExpanded = isAllWindows && state.sl.expandedRows.has(domain);
      const subRowsHtml = isExpanded
        ? renderWindowSubRows(win => aggregateLevels(scope, domain, win, f.language, f.grade))
        : '';
      return `<tr data-domain="${esc(domain)}">
        <td>
          <div class="dom-cell">
            ${isAllWindows ? `<button class="expand-chevron${isExpanded ? ' open' : ''}" data-action="sl-toggle-expand:${esc(domain)}" title="Expand">&#8964;</button>` : ''}
            <span class="dom-link" data-action="sl-drill-domain:${esc(domain)}">${esc(domain)}</span>
          </div>
        </td>
        ${slDataCells(vals)}
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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
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

// L1 – Schools list (after clicking a domain)
function renderSL_L1(path) {
  const isAllWindows = state.filters.window === 'All assessment windows';
  const f = state.filters;
  const drilledDomain = path[0].label;
  // District row first, then real schools from CD
  const schoolOrder = ['District', ...((CD.raw && CD.raw.schools) || []).map(s => s.name)];

  const rows = schoolOrder.flatMap(name => {
    const vals = SL.schools[name] || [0, 0, 0, 0, 0];
    const isDistrict = name === 'District';
    const isExpanded = !isDistrict && isAllWindows && state.sl.expandedRows.has(name);

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
      ${slDataCells(vals)}
    </tr>`;

    if (!isExpanded) return [mainRow];
    const schObj = (CD.raw && CD.raw.schools || []).find(s => s.name === name);
    const stuIndices = schObj ? (CD.studentsBySchool[schObj.school_id] || []) : [];
    const subRows = renderWindowSubRows(win => aggregateLevels(stuIndices, drilledDomain, win, f.language, f.grade));
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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
}

// L2 – Classes list (after clicking a school)
function renderSL_L2(path) {
  const isAllWindows = state.filters.window === 'All assessment windows';
  const f = state.filters;
  // path = [domain, 'District' literal, school]
  const drilledDomain = path[0].label;
  const school = path[2] ? path[2].label : path[1].label;
  // Look up the school's classes from CD
  const schObj = (CD.raw && CD.raw.schools || []).find(s => s.name === school);
  const schoolClasses = schObj
    ? (CD.raw.classes || []).filter(c => c.school_id === schObj.school_id).map(c => c.name)
    : [];
  const classOrder = [`${school} total`, ...schoolClasses];

  const rows = classOrder.flatMap(name => {
    const vals = SL.classes[name] || [0, 0, 0, 0, 0];
    const isTotal = name === `${school} total`;
    const displayName = isTotal ? school : name;
    const isExpanded = !isTotal && isAllWindows && state.sl.expandedRows.has(name);

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
      ${slDataCells(vals)}
    </tr>`;

    if (!isExpanded) return [mainRow];
    const cls = (CD.raw && CD.raw.classes || []).find(c => c.name === name);
    const stuIndices = cls ? (CD.studentsByGroup[cls.group_id] || []) : [];
    const subRows = renderWindowSubRows(win => aggregateLevels(stuIndices, drilledDomain, win, f.language, f.grade));
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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
}

// L3 – Educator Report (class level)
function renderSL_L3(path) {
  const cls = path[2].label;
  const data = SL.classReport[cls] || SL.classReport['Class 1A'];
  const LEVELS = ['age2', 'age3', 'age4', 'kinder'];
  const LEVEL_LABELS = { age2: 'Age 2 Skills', age3: 'Age 3 Skills', age4: 'Age 4 Skills', kinder: 'Kindergarten Skills' };
  const SKILLS = {
    age2:   ['Select the set with more or less, up to 2 similar items','Select the first item in a line'],
    age3:   ['Select the set with more or less, up to 4 similar items','Select the first and second items in a line'],
    age4:   ['Select the set with more or less, up to 5 similar items','Identify which number is greater, up to 10'],
    kinder: ['Select the set with more or less, up to 10 similar items','Identify which number is greater, up to 10'],
  };

  const headerCols = LEVELS.map(lv => {
    const isScore = lv === data.classScore;
    return `<th>
      <div class="edu-col-header ${lv}${isScore ? ' class-score' : ''}">
        ${isScore ? '<div class="class-score-badge">Class Score</div>' : ''}
        <div style="font-weight:600;">${LEVEL_LABELS[lv]}</div>
        <ul class="skill-bullets">
          ${SKILLS[lv].map(s => `<li>${esc(s)}</li>`).join('')}
        </ul>
      </div>
    </th>`;
  }).join('');

  // Overview row (expanded, with student cards)
  const notAttemptedCell = data.notAttempted.length
    ? `<td class="edu-cell not-attempted">
        <div class="not-attempted-label">Not Yet Attempted</div>
        ${data.notAttempted.map(n => `<div class="student-card">${makeAvatar(n)}<span>${esc(n)}</span></div>`).join('')}
      </td>`
    : '';

  const studentCols = LEVELS.map(lv => {
    const students = data[lv] || [];
    const isScore = lv === data.classScore;
    return `<td class="edu-cell ${lv}${isScore ? ' class-score' : ''}">
      ${students.map(n => `<div class="student-card" data-action="sl-drill-student:${esc(n)}">${makeAvatar(n)}<span>${esc(n)}</span></div>`).join('')}
    </td>`;
  }).join('');

  // Other domain rows (collapsed, show bar)
  const otherRows = (data.otherDomains || []).map(d => {
    const scoreLevel = d.score;
    const barCols = LEVELS.map(lv => {
      return `<td class="domain-bar-cell">
        <div class="domain-bar">
          <div class="domain-bar-seg ${lv === scoreLevel ? lv : 'blank'}" style="flex:1;"></div>
        </div>
      </td>`;
    }).join('');
    return `<tr>
      <td>
        <div class="edu-domain-cell">
          <button class="edu-expand-btn">&#8964;</button>
          <span style="font-size:13px;font-weight:500;">${esc(d.name)}</span>
        </div>
      </td>
      ${barCols}
    </tr>`;
  }).join('');

  return `
    ${renderBreadcrumbs(path)}
    <div class="report-toolbar">
      <div class="toolbar-left"></div>
      <div class="toolbar-center">Fall Student Levels <span class="info-icon">&#9432;</span></div>
      <div class="toolbar-right"><button class="btn btn-ghost">&#11015; Download CSV</button></div>
    </div>
    <div class="tbl-wrap">
      <table class="edu-report">
        <thead>
          <tr>
            <th>Domain</th>
            ${headerCols}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div class="edu-domain-cell">
                <button class="edu-expand-btn open">&#8964;</button>
                <span style="font-size:13px;font-weight:600;">Overview</span>
              </div>
            </td>
            ${notAttemptedCell}
            ${studentCols}
          </tr>
          ${otherRows}
        </tbody>
      </table>
    </div>
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
}

/* ============================================================
   RENDER: ASSESSMENT COMPLETION
   ============================================================ */
function acBar(vals) {
  // vals = counts [notStarted, inProgress, completed]
  const [ns, ip, cp] = vals;
  const total = ns + ip + cp;
  const pct = c => total > 0 ? Math.round((c / total) * 100) : 0;
  return makeBar([
    { cls: 'seg-grey',   flex: ns, label: `${pct(ns)}%` },
    { cls: 'seg-yellow', flex: ip, label: `${pct(ip)}%` },
    { cls: 'seg-green',  flex: cp, label: `${pct(cp)}%` },
  ]);
}

function renderACLegend() {
  return `
    <div class="legend-bar">
      <div class="leg-item"><div class="leg-dot" style="background:var(--grey-300)"></div> Not started</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--yellow)"></div> In progress</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--green)"></div> Completed <span class="info-icon" title="Students who met the domain completion requirement">&#9432;</span></div>
      <div class="spacer"></div>
      <div style="font-family:'Fredoka',sans-serif;font-size:18px;font-weight:600;color:var(--grey-600);">
        Fall Assessment Completion <span class="info-icon">&#9432;</span>
      </div>
      <button class="btn btn-ghost" style="margin-left:16px;">&#11015; Download CSV</button>
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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
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

    // Compute per-student completion status for the drilled domain
    const eligible = new Set(scalesInDomain(drilledDomain, stu.language));
    const required = Math.ceil(eligible.size * COMPLETION_THRESHOLD_FRACTION);
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
    const status = attempted === 0 ? 'not-started'
                 : (passed >= required && required > 0) ? 'completed'
                 : 'in-progress';

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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
}

/* ============================================================
   RENDER: STUDENT PLACEMENT
   ============================================================ */
function spBar(vals) {
  // vals = counts [notAssessed, needSupport, progressing, onTrack]
  const [na, ns, pr, ot] = vals;
  const total = na + ns + pr + ot;
  const pct = c => total > 0 ? Math.round((c / total) * 100) : 0;
  return makeBar([
    { cls: 'seg-grey',   flex: na, label: `${pct(na)}%` },
    { cls: 'seg-red',    flex: ns, label: `${pct(ns)}%` },
    { cls: 'seg-yellow', flex: pr, label: `${pct(pr)}%` },
    { cls: 'seg-green',  flex: ot, label: `${pct(ot)}%` },
  ]);
}

function renderSPLegend() {
  return `
    <div class="legend-bar">
      <div class="leg-item"><div class="leg-dot" style="background:var(--grey-300)"></div> Not assessed</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--red)"></div> Need support</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--yellow)"></div> Progressing</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--green)"></div> On track <span class="info-icon" title="Student placement tiers">&#9432;</span></div>
      <div class="spacer"></div>
      <div style="font-family:'Fredoka',sans-serif;font-size:18px;font-weight:600;color:var(--grey-600);">
        Fall Student Placement <span class="info-icon">&#9432;</span>
      </div>
      <button class="btn btn-ghost" style="margin-left:16px;">&#11015; Download CSV</button>
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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
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
    <div class="report-footer">Last Updated: Sep 30, 2025</div>`;
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
  const f = state.filters;
  // Window is "Fall 2025" / "Winter 2025" / "Spring 2026" or "All assessment windows"
  const winLabel = f.window === 'All assessment windows' ? 'All windows' : f.window;
  const titles = {
    'student-levels':    `${winLabel} Student Learning Levels`,
    'completion':        `${winLabel} Assessment Completion`,
    'student-placement': `${winLabel} Grade-Level Readiness`,
  };
  return titles[state.report] || '';
}

/* ============================================================
   RENDER: WINDOW BANNER (for Assessment Completion)
   ============================================================ */
function renderWindowBanner() {
  if (state.windowBannerDismissed) return '';
  // Only show for completion and placement; simulate urgency based on selected window
  if (!['completion', 'student-placement'].includes(state.report)) return '';
  const daysMap = { 'Spring 2027': 30, 'Fall 2026': 10, 'Winter 2026': 3 };
  const days = daysMap[state.filters.window] || 30;
  const colorClass = days >= 15 ? 'green' : days >= 7 ? 'yellow' : 'red';
  const endDate = state.filters.window === 'Fall 2026' ? 'Aug 15, 2026 – Oct 31, 2026'
                : state.filters.window === 'Winter 2026' ? 'Dec 1, 2026 – Feb 28, 2027'
                : 'Mar 1, 2027 – May 15, 2027';
  return `
    <div class="window-banner ${colorClass}" id="windowBanner">
      <span>&#128197;</span>
      ${days} days remaining in the ${state.filters.window} window: ${endDate}
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
    SL.domainStandards[d] = (CD.scalesByDomain[d] || [])
      .map(idx => CD.scaleByIdx[idx])
      .filter(sc => figmaLang === 'All' || sc.language === figmaLang)
      .map(sc => sc.code);
  }
  SL.mathStandards = SL.domainStandards.Math || [];

  // Build per-scale rollups when a specific domain filter is selected (L0 standards mode)
  if (f.domain && f.domain !== 'Overview' && CD.scalesByDomain[f.domain]) {
    for (const idx of CD.scalesByDomain[f.domain]) {
      const sc = CD.scaleByIdx[idx];
      if (figmaLang !== 'All' && sc.language !== figmaLang) continue;
      SL.standard[sc.code] = aggregateLevels(scope, idx, win, lang, grade);
    }
  }

  // L1 (Schools view): aggregate per-school for the drilled-into domain
  const drilledDomain = state.sl.level >= 1 ? state.sl.path[0].label : null;
  if (drilledDomain) {
    SL.schools.District = aggregateLevels(scope, drilledDomain, win, lang, grade);
    for (const sch of CD.raw.schools) {
      const stuIndices = CD.studentsBySchool[sch.school_id] || [];
      SL.schools[sch.name] = aggregateLevels(stuIndices, drilledDomain, win, lang, grade);
    }
  }

  // L2 (Classes view): aggregate per-class for the drilled-into school + domain
  // path = [domain, 'District' literal, school, class?]
  const drilledSchool = state.sl.level >= 2 ? (state.sl.path[2] ? state.sl.path[2].label : null) : null;
  if (drilledDomain && drilledSchool) {
    const schObj = CD.raw.schools.find(s => s.name === drilledSchool);
    if (schObj) {
      const schoolStudents = CD.studentsBySchool[schObj.school_id] || [];
      SL.classes[`${drilledSchool} total`] = aggregateLevels(
        schoolStudents, drilledDomain, win, lang, grade
      );
      for (const cls of CD.raw.classes) {
        if (cls.school_id !== schObj.school_id) continue;
        const stuIndices = CD.studentsByGroup[cls.group_id] || [];
        SL.classes[cls.name] = aggregateLevels(stuIndices, drilledDomain, win, lang, grade);
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
      if (!isLocked() && state.filters[name] !== val) {
        state.filters[name] = val;
        if (name === 'school') state.filters.cls = 'All';
        state.dirty = true;
        render();
      }
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

  // Student Levels drilling
  if (action && action.startsWith('sl-drill-domain:')) {
    const domain = action.split(':').slice(1).join(':');
    state.sl.level = 1;
    state.sl.path = [{ label: domain }, { label: 'District' }];
    render(); return;
  }
  if (action && action.startsWith('sl-drill-standard:')) {
    const std = action.split(':').slice(1).join(':');
    state.sl.level = 1;
    state.sl.path = [{ label: std }, { label: 'District' }];
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
    openDetailPopup(colLabel, val, total);
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
  state.filters = {
    window:   SL_CURRENT_WINDOW || 'Spring 2026',
    domain:   'Overview',
    language: 'All',
    school:   'All',
    cls:      'All',
    grade:    'All grades',
  };
  state.dirty = true;
  render();
}

/* ============================================================
   REPORT DETAILS POPUP
   ============================================================ */
const POPUP_STUDENTS = [
  { school:'School E', cls:'Class 1A', name:'Adriana M.',    grade:'Pre-K 4', domain:'Math',      level:'age4',   levelLabel:'Age 4 Skills'   },
  { school:'School E', cls:'Class 1A', name:'Blake L.',      grade:'Pre-K 4', domain:'Math',      level:'age4',   levelLabel:'Age 4 Skills'   },
  { school:'School E', cls:'Class 1B', name:'Maria G.',      grade:'Pre-K 4', domain:'Math',      level:'age2',   levelLabel:'Age 2 Skills'   },
  { school:'School E', cls:'Class 1B', name:'Alex K.',       grade:'Pre-K 3', domain:'Math',      level:'age2',   levelLabel:'Age 2 Skills'   },
  { school:'School F', cls:'Class 1A', name:'Oliver H.',     grade:'Pre-K 4', domain:'Literacy',  level:'age3',   levelLabel:'Age 3 Skills'   },
  { school:'School F', cls:'Class 1A', name:'Janie D.',      grade:'Pre-K 4', domain:'Language',  level:'age3',   levelLabel:'Age 3 Skills'   },
  { school:'School B', cls:'Class 2A', name:'Mia T.',        grade:'Pre-K 4', domain:'Math',      level:'age3',   levelLabel:'Age 3 Skills'   },
  { school:'School B', cls:'Class 2A', name:'Mason L.',      grade:'Pre-K 4', domain:'Literacy',  level:'age4',   levelLabel:'Age 4 Skills'   },
  { school:'School A', cls:'Class 1A', name:'Thomas W.',     grade:'Kinder',  domain:'Math',      level:'kinder', levelLabel:'Kindergarten'   },
  { school:'School C', cls:'Class 1B', name:'Francisco C.',  grade:'Pre-K 3', domain:'Math',      level:'age2',   levelLabel:'Age 2 Skills'   },
];

const LEVEL_COLORS = { age2: 'var(--pink-100)', age3: 'var(--purple-100)', age4: 'var(--blue-100)', kinder: 'var(--teal-100)' };
const LEVEL_TEXT   = { age2: 'var(--pink-500)', age3: 'var(--purple-500)', age4: 'var(--blue-500)', kinder: 'var(--teal-400)' };

function openDetailPopup(colLabel, val, total) {
  const overlay = document.getElementById('detailPopup');
  document.getElementById('popupTitle').textContent = `${getReportTitle()}: Report Details`;
  const pct = total > 0 ? Math.round((val / total) * 100) : 0;
  document.getElementById('popupSubtitle').textContent = `${colLabel}: ${pct}% (${val} of ${total})`;

  const levelKey = colLabel.toLowerCase().replace('age ', 'age').replace(' skills','').replace('kindergarten','kinder');
  const rows = POPUP_STUDENTS.filter(s => s.levelLabel === colLabel || true).slice(0, 10);

  const tbody = document.getElementById('popupTbody');
  // Readiness compares Learning Level vs Enrolled Grade on a 2–5 scale
  // (Pre-K 2 = 2, Pre-K 3 = 3, Pre-K 4 = 4, Kinder = 5; Age N Skills follows the same).
  const GRADE_RANK = { 'Pre-K 2': 2, 'Pre-K 3': 3, 'Pre-K 4': 4, 'Kinder': 5 };
  const LEVEL_RANK = { age2: 2, age3: 3, age4: 4, kinder: 5 };
  const readiness = s => {
    const g = GRADE_RANK[s.grade], l = LEVEL_RANK[s.level];
    if (g == null || l == null) return '';
    if (l > g) return 'Above Level';
    if (l < g) return 'Below Level';
    return 'On Level';
  };
  tbody.innerHTML = rows.map(s => `
    <tr>
      <td>River Valley SD</td>
      <td>${esc(s.school)}</td>
      <td>${esc(s.cls)}</td>
      <td>${esc(s.name)}</td>
      <td>${esc(s.grade)}</td>
      <td>${esc(s.domain)}</td>
      <td>
        <span class="learning-level-cell">
          <span class="level-dot" style="background:${LEVEL_COLORS[s.level]}"></span>
          ${esc(s.levelLabel)}
        </span>
      </td>
      <td>${readiness(s)}</td>
    </tr>`).join('');

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
  // Set domain filter appropriately
  if (report === 'completion') {
    state.filters.domain = 'Overview'; // locked to Overview
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
    // Reset school/class when switching roles
    if (role === 'school') {
      state.filters.school = (CD.raw && CD.raw.schools && CD.raw.schools[0]) ? CD.raw.schools[0].name : 'All';
      state.filters.cls = 'All';
    } else {
      state.filters.school = 'All';
      state.filters.cls = 'All';
    }
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
      }
      render();
    })
    .catch(err => {
      console.error('Failed to load computed.json:', err);
    });
});
