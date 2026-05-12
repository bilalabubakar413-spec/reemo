/**
 * cvParser.js  –  Smart CV/Resume text extractor
 * Extracts: name, email, phone, role, skills, hourly rate, years of experience, summary
 */

// ── Known tech skills dictionary ─────────────────────────────────────────────
const KNOWN_SKILLS = [
  // Languages
  'JavaScript','TypeScript','Python','Java','C#','C++','PHP','Go','Rust','Swift','Kotlin','Ruby','Scala',
  'Dart','R','MATLAB','Bash','PowerShell','SQL','HTML','CSS','SCSS','LESS',
  // Frontend
  'React','Vue','Vue.js','Angular','Next.js','Nuxt.js','Svelte','Ember.js','Redux',
  'TailwindCSS','Tailwind','Bootstrap','Material UI','Chakra UI','Vite','Webpack',
  // Backend
  'Node.js','Express','FastAPI','Django','Flask','Laravel','Spring','Spring Boot',
  'ASP.NET','.NET','NestJS','Rails','Symfony','Gin',
  // Databases
  'PostgreSQL','MySQL','MongoDB','Redis','Elasticsearch','SQLite','MariaDB',
  'Supabase','Firebase','DynamoDB','Cassandra','Neo4j',
  // Cloud & DevOps
  'AWS','Azure','GCP','Google Cloud','Docker','Kubernetes','K8s','Terraform',
  'Ansible','Jenkins','GitHub Actions','GitLab CI','CI/CD','Linux','Nginx',
  // Data & AI
  'Machine Learning','Deep Learning','TensorFlow','PyTorch','scikit-learn',
  'Pandas','NumPy','Spark','Kafka','Airflow','dbt','Power BI','Tableau','Excel',
  // Tools & Other
  'Git','GraphQL','REST','REST API','gRPC','WebSockets','Figma','Jira','Confluence',
  'Agile','Scrum','Microservices','API','OAuth','JWT','Stripe','Prisma','Sequelize',
];

// ── Role / title keywords ─────────────────────────────────────────────────────
const ROLE_PATTERNS = [
  /senior\s+(?:front.?end|back.?end|full.?stack|software|web)\s+developer/i,
  /(?:front.?end|back.?end|full.?stack|web)\s+developer/i,
  /(?:full.?stack|frontend|backend)\s+engineer/i,
  /(?:software|cloud|platform|data|solutions?)\s+(?:engineer|architect|developer)/i,
  /devops\s+(?:engineer|lead|architect)/i,
  /mobile\s+developer/i,
  /machine\s+learning\s+engineer/i,
  /data\s+(?:scientist|engineer|analyst)/i,
  /(?:junior|medior|senior|lead|principal)\s+developer/i,
  /(?:junior|medior|senior|lead|principal)\s+engineer/i,
  /ui\/ux\s+designer/i,
  /(?:product|project)\s+manager/i,
  /(?:scrum\s+master|tech\s+lead|cto)/i,
];

// ── Hourly rate pattern ───────────────────────────────────────────────────────
const RATE_PATTERNS = [
  /(?:uurloon|uurtarief|hourly\s+rate|rate|tarief)[:\s€$£]*(\d{2,4})/i,
  /[€$£]?\s*(\d{2,4})\s*(?:p\/h|per\s+hour|\/hr|\/hour|uur|per\s+uur)/i,
  /(\d{2,4})\s*[-–]\s*\d{2,4}\s*(?:€|eur|per\s+uur)/i,
];

// ── Experience years pattern ──────────────────────────────────────────────────
const EXP_PATTERNS = [
  /(\d+)\+?\s*(?:jaar|years?)\s+(?:ervaring|experience)/i,
  /(?:ervaring|experience)\s+(?:van\s+)?(\d+)\+?\s*(?:jaar|years?)/i,
];

// ── Main extraction function ──────────────────────────────────────────────────
function parseCV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  return {
    name:       extractName(text, lines),
    email:      extractEmail(text),
    phone:      extractPhone(text),
    role:       extractRole(text),
    skills:     extractSkills(text),
    hourlyRate: extractHourlyRate(text),
    experience: extractExperience(text),
    summary:    extractSummary(lines),
    rawText:    text.slice(0, 500), // first 500 chars for debugging
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractName(text, lines) {
  // Heuristic: first non-empty line that is NOT an email/URL/phone and ≤ 5 words
  for (const line of lines.slice(0, 8)) {
    if (line.length < 3) continue;
    if (/[@http\d]/.test(line) && line.length < 30) continue;   // skip email/url/phone lines
    if (/^\d/.test(line)) continue;                              // skip lines starting with digits
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 5) {
      // Looks like a name (2-5 words, no special chars except hyphen/apostrophe)
      if (/^[A-Za-zÀ-ÖØ-öø-ÿ ''-]+$/.test(line)) return toTitleCase(line);
    }
  }
  // Fallback: look for "Naam:" or "Name:" label
  const m = text.match(/(?:naam|name)\s*[:\-]\s*([A-Za-zÀ-ÖØ-öø-ÿ\s''-]{3,40})/i);
  return m ? toTitleCase(m[1].trim()) : null;
}

function extractEmail(text) {
  const m = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

function extractPhone(text) {
  const m = text.match(/(?:\+31|0031|0)[\s.\-]?(?:6|[1-9]\d)[\s.\-]?\d{2,3}[\s.\-]?\d{2}[\s.\-]?\d{2}[\s.\-]?\d{0,2}|(?:\+\d{1,3}[\s.\-])?\(?\d{2,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{4}/);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

function extractRole(text) {
  for (const pattern of ROLE_PATTERNS) {
    const m = text.match(pattern);
    if (m) return toTitleCase(m[0].trim());
  }
  return null;
}

function extractSkills(text) {
  const found = new Set();
  const lower = text.toLowerCase();
  for (const skill of KNOWN_SKILLS) {
    // Match whole-word (allow dots like Node.js, Vue.js)
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![a-zA-Z])${escaped}(?![a-zA-Z])`, 'i');
    if (re.test(text)) found.add(skill);
  }
  return [...found].slice(0, 20); // max 20 skills
}

function extractHourlyRate(text) {
  for (const pattern of RATE_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const rate = parseInt(m[1]);
      if (rate >= 20 && rate <= 500) return rate; // sanity check
    }
  }
  return null;
}

function extractExperience(text) {
  for (const pattern of EXP_PATTERNS) {
    const m = text.match(pattern);
    if (m) return parseInt(m[1]);
  }
  return null;
}

function extractSummary(lines) {
  // Find a "profile" or "summary" section
  const markers = ['profiel', 'profile', 'samenvatting', 'summary', 'over mij', 'about me', 'introductie'];
  for (let i = 0; i < lines.length; i++) {
    if (markers.some(m => lines[i].toLowerCase().includes(m))) {
      // Collect next 3-5 non-empty lines as summary
      const summaryLines = [];
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (lines[j].length > 20) summaryLines.push(lines[j]);
      }
      if (summaryLines.length > 0) return summaryLines.join(' ').slice(0, 400);
    }
  }
  // Fallback: longest paragraph-like line in first 30 lines
  const candidates = lines.slice(0, 30).filter(l => l.length > 60 && l.length < 400);
  return candidates[0] || null;
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

module.exports = { parseCV };
