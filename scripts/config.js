// ── App version — single source of truth ──
// Both index.html and login.html read this on DOMContentLoaded via #hdr-version span.
// Update ONLY this constant on every release — never hardcode version strings in HTML.
const APP_VERSION = 'v9.11';

// ── KPI Tree loader — 3-stage progressive disclosure ──

const LOADER_STAGES_MI = [
  {
    label: 'Researching the Market',
    messages: [
      'Sizing your market — finding the numbers that actually matter…',
      'Identifying who your real competitors are and what they\'re quietly shipping…',
      'Reading the competitive landscape so you don\'t have to…',
      'Checking what the market expects from a product like yours…',
      'Spotting the trends worth accelerating — and the ones already past their peak…',
      'Mapping where your product leads, matches, and lags the market…',
      'Looking for capability gaps your competitors haven\'t closed yet…',
      'Building a market perspective before your KPI tree locks in…',
      'Analysing buyer criteria — what actually drives decisions in your space…',
      'Cross-referencing competitor feature sets against market expectations…',
      'Assessing which trends are ACTIVE, which are PEAKING, and which are noise…',
      'Identifying the strategic moves worth accelerating vs. the ones to monitor…',
      'Synthesising the SWOT from a market lens — not an internal one…',
      'Connecting market signals to the capabilities your KPI tree should reflect…',
      'Almost ready to build your tree — market context locked in…'
    ]
  },
  {
    label: 'Building Your KPI Tree',
    messages: [
      'Selecting the measurement framework your product actually deserves…',
      'Mapping your product\'s value chain from first principles…',
      'Defining stages your team can actually rally around…',
      'Populating L1 metrics — the ones that move the needle, not just the dashboard…',
      'Decomposing into L2 and L3 signals — the ones that tell you why…',
      'Making sure every metric earns its place in the tree…',
      'Aligning metric vocabulary to your industry framework…',
      'Checking that every stage has something worth measuring…',
      'Connecting your North Star to every level of the tree…',
      'Validating the hierarchy — strategy down to diagnostic signal…'
    ]
  },
  {
    label: 'Finalising Results',
    messages: [
      'Naming your metrics with precision — words matter here…',
      'Locking in your North Star — the number everything else serves…',
      'Putting the finishing touches on your measurement model…',
      'Running a final check on stage coverage and metric depth…',
      'Almost there. Worth the wait.'
    ]
  }
];

const LOADER_STAGES_KPI = [
  {
    label: 'Analysing Your Product',
    messages: [
      'Selecting the measurement framework your product actually deserves…',
      'Mapping your product\'s value chain from first principles…',
      'Defining stages your team can actually rally around…',
      'Populating L1 metrics — the ones that move the needle, not just the dashboard…',
      'Decomposing into L2 and L3 signals — the ones that tell you why…',
      'Making sure every metric earns its place in the tree…',
      'Aligning metric vocabulary to your industry framework…',
      'Checking that every stage has something worth measuring…',
      'Connecting your North Star to every level of the tree…',
      'Validating the hierarchy — strategy down to diagnostic signal…'
    ]
  },
  {
    label: 'Building Your KPI Tree',
    messages: [
      'Attributing framework vocabulary to metric names…',
      'Validating metric hierarchy and stage coverage…',
      'Checking diagnostic signal depth at L3 and L4…',
      'Connecting every metric back to the North Star…',
      'Almost there — your KPI tree is taking shape…'
    ]
  },
  {
    label: 'Finalising Results',
    messages: [
      'Finalising your North Star metric…',
      'Building your measurement model summary…',
      'Running a final check on stage and metric coverage…',
      'Almost there. Worth the wait.'
    ]
  }
];

// Capability-driven mode variants — used when fd.approach==='capability-based'.
// No L2-L4 in capability-driven mode, so "decomposing into L2/L3" and
// "diagnostic signal depth at L3/L4" lines are dropped rather than reworded.
const LOADER_STAGES_KPI_CAP = [
  {
    label: 'Analysing Your Product',
    messages: [
      'Selecting the measurement framework your product actually deserves…',
      'Mapping your product\'s value chain from first principles…',
      'Defining stages your team can actually rally around…',
      'Populating L1 capabilities — the functions that actually run this product…',
      'Making sure every capability earns its place in the hierarchy…',
      'Aligning capability vocabulary to your industry framework…',
      'Checking that every stage has something worth building…',
      'Connecting your North Star to the capabilities that drive it…',
      'Validating the hierarchy — strategy down to operational capability…'
    ]
  },
  {
    label: 'Mapping Your Capability Hierarchy',
    messages: [
      'Attributing framework vocabulary to capability names…',
      'Validating capability hierarchy and stage coverage…',
      'Connecting every capability back to the North Star…',
      'Almost there — your capability map is taking shape…'
    ]
  },
  {
    label: 'Finalising Results',
    messages: [
      'Finalising your North Star metric…',
      'Building your value chain model summary…',
      'Running a final check on stage and capability coverage…',
      'Almost there. Worth the wait.'
    ]
  }
];


// ── Auth domain restriction ──
// Client deployment: change this one line to the client's email domain.
// Used by auth.js for sign-up domain validation — never hardcode elsewhere.
const AUTH_DOMAIN = 'hcltech.com';

// DD loader (unchanged)
const DD_STEPS=["Pulling definitions for every metric in the tree...","Finding real benchmarks — not the made-up kind...","Identifying red flags that actually mean something...","Writing definitions a CFO and a dev can both understand..."];
const DD_HEADS=["Building your metrics dictionary...","Sourcing real-world benchmarks...","Writing definitions that don't need a footnote..."];
const DD_SUBS=["This is the document you wished existed at your last job.","Benchmarks verified. Frameworks consulted.","Definitions incoming. Minimal jargon. Mostly."];
