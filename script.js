'use strict';

/* ============================================================
   DATA
   ============================================================ */

const TOTAL = 150;
const DOMAINS = ['Overview', 'Math', 'Literacy', 'Language', 'Executive Function'];

// Student Levels: [notAssessed, age2, age3, age4, kinder]  (% of TOTAL)
const SL = {
  domain: {
    'Overview':           [20, 20, 20, 20, 20],
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
    'More or Less':         [20, 30, 35, 10,  5],
    'Numerals':             [18, 22, 42, 12,  6],
    'Add':                  [25, 20, 38, 12,  5],
    'Subtract':             [28, 18, 35, 14,  5],
    'Patterns':             [22, 24, 40, 10,  4],
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
const SL_WINDOWS = ['Fall 2026', 'Winter 2026', 'Spring 2027'];
const SL_CURRENT_WINDOW = 'Spring 2027';
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
    window: 'Spring 2027',
    domain: 'Overview',
    language: 'All',
    school: 'All',
    cls: 'All',
    grade: 'Pre-K 4',
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

function pct(val) { return `${val}%`; }
function count(val) { return `${Math.round(val / 100 * TOTAL)} of ${TOTAL}`; }
function pillLabel(val) { return `${val}% (${count(val)})`; }

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

// Render the continuous average bar (spans all 5 data columns via colspan)
function makeAvgBar(vals) {
  const avg = calcAverage(vals);
  if (avg === null) return '<td colspan="5" class="avg-cell"><em style="color:var(--grey-400);font-size:12px;">Not enough data</em></td>';
  const pctPos = ((avg - 2) / 3) * 100; // scale 2–5 → 0–100%
  const display = avg.toFixed(1);
  return `
    <td colspan="5" class="avg-cell">
      <div class="avg-bar-wrap">
        <div class="avg-bar-track">
          <div class="avg-bar-fill" style="width:${pctPos}%"></div>
          <div class="avg-bar-circle" style="left:${pctPos}%">${display}</div>
        </div>
        <div class="avg-bar-label" style="left:${pctPos}%">Average</div>
      </div>
    </td>`;
}

function makePill(val, idx, hi, colLabel) {
  const t = PILL_TYPES[idx];
  const hiClass = hi ? ' hi' : '';
  const label = colLabel || COL_LABELS[idx];
  // Numbers are clickable to open the detail popup (only for skill columns, not Not Assessed)
  const inner = idx > 0
    ? `<span class="pill-num" data-action="openPopup" data-col="${esc(label)}" data-val="${val}">${pillLabel(val)}</span>`
    : pillLabel(val);
  return `<span class="pill pill-${t}${hiClass}">${inner}</span>`;
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
  // School admins always have school pre-filled; class is always enabled for them
  const effectiveSchool = isSchoolAdmin ? 'School E' : f.school;
  const classEnabled = !locked && (isSchoolAdmin || effectiveSchool !== 'All');
  const schools = ['All','School A','School B','School C','School D','School E','School F'];
  const classes = classEnabled ? ['All','Class 1A','Class 1B','Class 2A'] : ['All'];
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
          ${sel('window', ['All assessment windows','Spring 2027','Fall 2026','Winter 2026'], f.window)}
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
  if (state.sl.showAvg) return makeAvgBar(vals);
  const hi = hiIdx(vals);
  return vals.map((v, i) => `<td>${makePill(v, i, i === hi)}</td>`).join('');
}

function slTheadCells() {
  if (state.sl.showAvg) {
    return `<th class="col-na" colspan="5" style="text-align:left;color:var(--grey-500);">Average Level</th>`;
  }
  return `
    <th class="col-na">Not Assessed</th>
    <th class="col-age2">Age 2 Skills</th>
    <th class="col-age3">Age 3 Skills</th>
    <th class="col-age4">Age 4 Skills</th>
    <th class="col-kinder">Kindergarten Skills</th>`;
}

function renderWindowSubRows(type) {
  return SL_WINDOWS.map(win => {
    const isCurrent = win === SL_CURRENT_WINDOW;
    const vals = SL_WINDOW_DATA[type][win];
    const hi = hiIdx(vals);
    return `<tr class="sub-row show window-sub-row">
      <td class="window-sub-label">
        ${esc(win)}${isCurrent ? `<span class="star-badge">&#9733;</span>` : ''}
      </td>
      ${vals.map((v,i) => `<td style="text-align:center;padding:0 6px;">${makePill(v,i,i===hi)}</td>`).join('')}
    </tr>`;
  }).join('');
}

// L0 – Domain list (Overview) or Standards list (specific domain selected)
function renderSL_L0() {
  const isAllWindows = state.filters.window === 'All assessment windows';
  const selectedDomain = state.filters.domain;
  const isStandardsMode = selectedDomain !== 'Overview';

  let rows, colHeader;

  if (isStandardsMode) {
    // Show standards for the selected domain
    const standards = SL.domainStandards[selectedDomain] || [];
    colHeader = 'Standard';
    rows = standards.map(std => {
      const vals = SL.standard[std] || [20, 20, 20, 20, 20];
      const isExpanded = state.sl.expandedRows.has(std);
      let subRows = '';
      if (isExpanded && isAllWindows) {
        subRows = `<tr class="sub-row show">
          <td colspan="6" style="padding:0; height:auto;">
            <table class="tbl-levels" style="width:100%"><tbody>${renderWindowSubRows('domain')}</tbody></table>
          </td>
        </tr>`;
      }
      return `<tr>
        <td>
          <div class="dom-cell">
            ${isAllWindows ? `<button class="expand-chevron${isExpanded ? ' open' : ''}" data-action="sl-toggle-expand:${esc(std)}" title="Expand">&#8964;</button>` : ''}
            <span class="dom-link" data-action="sl-drill-standard:${esc(std)}">${esc(std)}</span>
          </div>
        </td>
        ${slDataCells(vals)}
      </tr>${subRows}`;
    }).join('');
  } else {
    // Overview mode: show all domains
    colHeader = 'Domain';
    rows = DOMAINS.map(domain => {
      const vals = SL.domain[domain];
      const isExpanded = state.sl.expandedRows.has(domain);
      let subRows = '';
      if (isExpanded) {
        const inner = isAllWindows
          ? renderWindowSubRows('domain')
          : renderSubRows(domain);
        subRows = `<tr class="sub-row show" data-sub="${esc(domain)}">
          <td colspan="6" style="padding:0; height:auto;">
            <table class="tbl-levels" style="width:100%"><tbody>${inner}</tbody></table>
          </td>
        </tr>`;
      }
      return `<tr data-domain="${esc(domain)}">
        <td>
          <div class="dom-cell">
            <button class="expand-chevron${isExpanded ? ' open' : ''}" data-action="sl-toggle-expand:${esc(domain)}" title="Expand">&#8964;</button>
            <span class="dom-link" data-action="sl-drill-domain:${esc(domain)}">${esc(domain)}</span>
          </div>
        </td>
        ${slDataCells(vals)}
      </tr>${subRows}`;
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
    return `<tr class="sub-row show">
      <td class="window-sub-label" style="color:var(--grey-500);font-weight:400;">${esc(n)}</td>
      ${vals.map((v,i) => `<td style="text-align:center;padding:0 6px;">${makePill(v,i,i===hi)}</td>`).join('')}
    </tr>`;
  }).join('');
}

// L1 – Schools list (after clicking a domain)
function renderSL_L1(path) {
  const isAllWindows = state.filters.window === 'All assessment windows';
  const schoolOrder = ['District','School E','School F','School B','School A','School C','School D'];

  const rows = schoolOrder.flatMap(name => {
    const vals = SL.schools[name] || SL.schools['District'];
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
    const subRow = `<tr class="sub-row show">
      <td colspan="6" style="padding:0; height:auto;">
        <table class="tbl-levels" style="width:100%"><tbody>${renderWindowSubRows('schools')}</tbody></table>
      </td>
    </tr>`;
    return [mainRow, subRow];
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
  const school = path[1].label;
  const classOrder = [`${school} total`, 'Class 1A', 'Class 1B', 'Class 2A'];

  const rows = classOrder.flatMap(name => {
    const vals = SL.classes[name] || SL.classes['School E total'];
    const isTotal = name.includes('total');
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
    const subRow = `<tr class="sub-row show">
      <td colspan="6" style="padding:0; height:auto;">
        <table class="tbl-levels" style="width:100%"><tbody>${renderWindowSubRows('classes')}</tbody></table>
      </td>
    </tr>`;
    return [mainRow, subRow];
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
  const [ns, ip, cp] = vals;
  return makeBar([
    { cls: 'seg-grey',   flex: ns, label: `${ns}%` },
    { cls: 'seg-yellow', flex: ip, label: `${ip}%` },
    { cls: 'seg-green',  flex: cp, label: `${cp}%` },
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
  const rows = DOMAINS.map(d => {
    const vals = AC.domain[d];
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
  const schoolOrder = ['District','School E','School F','School B','School A','School C','School D'];
  const rows = schoolOrder.map(name => {
    const vals = AC.schools[name] || AC.schools['District'];
    const isDistrict = name === 'District';
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
  const school = path[1].label;
  const classOrder = [`${school} total`, 'Class 1A', 'Class 1B', 'Class 2A'];
  const rows = classOrder.map(name => {
    const vals = AC.classes[name] || AC.classes['School E total'];
    const isTotal = name.includes('total');
    const displayName = isTotal ? school : name;
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
  const cls = path[2].label;
  const students = AC.students[cls] || AC.students['Class 1A'];

  const statusMap = {
    'not-started': { cls: 'not-started', dot: 'not-started', label: 'Not started' },
    'in-progress': { cls: 'in-progress', dot: 'in-progress', label: 'In progress' },
    'completed':   { cls: 'completed',   dot: 'completed',   label: 'Completed' },
  };

  const rows = students.map(s => {
    const st = statusMap[s.status];
    return `<tr>
      <td>${makeAvatar(s.name)} &nbsp; ${esc(s.name)}</td>
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
  const [na, ns, pr, ot] = vals;
  return makeBar([
    { cls: 'seg-grey',   flex: na, label: `${na}%` },
    { cls: 'seg-red',    flex: ns, label: `${ns}%` },
    { cls: 'seg-yellow', flex: pr, label: `${pr}%` },
    { cls: 'seg-green',  flex: ot, label: `${ot}%` },
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
  const rows = DOMAINS.map(d => {
    const vals = SP.domain[d];
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
  const schoolOrder = ['District','School E','School F','School B','School A','School C','School D'];
  const rows = schoolOrder.map(name => {
    const vals = SP.schools[name] || SP.schools['District'];
    const isDistrict = name === 'District';
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
  const school = path[1].label;
  const classOrder = [`${school} total`, 'Class 1A', 'Class 1B', 'Class 2A'];
  const rows = classOrder.map(name => {
    const vals = SP.classes[name] || SP.classes['School E total'];
    const isTotal = name.includes('total');
    const displayName = isTotal ? school : name;
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
  const cls = path[2].label;
  const students = SP.students[cls] || SP.students['Class 1A'];

  const PLACEMENT_MAP = {
    'not-assessed': { cls: 'not-started', dot: 'not-started', label: 'Not assessed' },
    'need-support': { cls: 'in-progress', dot: 'in-progress', label: 'Need support',
                      style: 'background:#fde8e5;color:#8a1e10;' },
    'progressing':  { cls: 'in-progress', dot: 'in-progress', label: 'Progressing' },
    'on-track':     { cls: 'completed',   dot: 'completed',   label: 'On track' },
  };
  const DOT_COLORS = {
    'not-assessed': 'var(--grey-400)',
    'need-support': 'var(--red)',
    'progressing':  'var(--yellow)',
    'on-track':     'var(--green)',
  };

  const rows = students.map(s => {
    const p = s.placement;
    const label = PLACEMENT_MAP[p].label;
    const dotColor = DOT_COLORS[p];
    const badgeStyle = p === 'need-support' ? 'background:#fde8e5;color:#8a1e10;'
                     : p === 'progressing'  ? 'background:#fff3d6;color:#7a5200;'
                     : p === 'on-track'     ? 'background:#e8f4d6;color:#2d5a00;'
                     :                        'background:var(--grey-200);color:var(--grey-600);';
    return `<tr>
      <td>${makeAvatar(s.name)} &nbsp; ${esc(s.name)}</td>
      <td>
        <span class="status-badge" style="${badgeStyle}">
          <span class="status-dot" style="background:${dotColor}"></span>
          ${label}
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
  const win = f.window === 'Spring 2027' ? 'Spring' : f.window === 'Fall 2026' ? 'Fall' : 'Winter';
  const year = f.window.includes('2027') ? '2027' : '2026';
  const titles = {
    'student-levels':    `${win} ${year} Student Learning Levels`,
    'completion':        `${win} ${year} Assessment Completion`,
    'student-placement': `${win} ${year} Grade-Level Readiness`,
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
function render() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <h1 class="page-title">${esc(getPageTitle())}</h1>
    ${renderFilterCard()}
    ${state.generated ? renderWindowBanner() : ''}
    ${state.generated ? `<div class="report-block">${renderReportContent()}</div>` : ''}`;

  updateSidebar();
  wireEvents();
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
    const val = el.dataset.val;
    openDetailPopup(colLabel, val);
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
  const isAC = state.report === 'completion';
  state.filters = {
    window:   'Spring 2027',
    domain:   'Overview',
    language: 'All',
    school:   'All',
    cls:      'All',
    grade:    isAC ? 'All grades' : 'Pre-K 4',
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

function openDetailPopup(colLabel, val) {
  const overlay = document.getElementById('detailPopup');
  document.getElementById('popupTitle').textContent = `${getReportTitle()}: Report Details`;
  document.getElementById('popupSubtitle').textContent = `${colLabel}: ${val}% (${Math.round(val/100*TOTAL)} of ${TOTAL})`;

  const levelKey = colLabel.toLowerCase().replace('age ', 'age').replace(' skills','').replace('kindergarten','kinder');
  const rows = POPUP_STUDENTS.filter(s => s.levelLabel === colLabel || true).slice(0, 10);

  const tbody = document.getElementById('popupTbody');
  tbody.innerHTML = rows.map(s => `
    <tr>
      <td>River Valley SD</td>
      <td>${esc(s.school)}</td>
      <td>${esc(s.cls)}</td>
      <td>${esc(s.name)}</td>
      <td>${esc(s.grade)}</td>
      <td>${esc(s.domain)}</td>
      <td>
        <span class="learning-level-badge" style="background:${LEVEL_COLORS[s.level]};color:${LEVEL_TEXT[s.level]}">
          ${esc(s.levelLabel)}
        </span>
      </td>
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
      state.filters.school = 'School E';
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

  // Detail popup close handlers
  document.getElementById('popupCancel').addEventListener('click', () => {
    document.getElementById('detailPopup').classList.remove('open');
  });
  document.getElementById('detailPopup').addEventListener('click', e => {
    if (e.target === document.getElementById('detailPopup')) {
      document.getElementById('detailPopup').classList.remove('open');
    }
  });

  render();
});
