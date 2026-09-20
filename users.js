// users.js
// ============================================================
// USER REGISTRY — unique entry codes for candidates
// ============================================================
// Each user has:
//   - code: unique entry code (string)
//   - name: candidate's full name
//   - used: whether the code has been used (boolean)
//   - isDemo: whether this is the shared demo account (boolean)
//
// The DEMO account can be used unlimited times for practice.
// All other codes can only be used ONCE.
// ============================================================

const userRegistry = [
  // ---------- DEMO ACCOUNT (unlimited uses) ----------
  {
    code: "DEMO-2025",
    name: "Practice Candidate",
    used: false,
    isDemo: true
  },

  // ---------- REAL CANDIDATES ----------
  { code: "CBT-A1B2C3", name: "Adaeze Okafor",     used: false, isDemo: false },
  { code: "CBT-D4E5F6", name: "Bola Adeyemi",      used: false, isDemo: false },
  { code: "CBT-G7H8I9", name: "Chinedu Eze",       used: false, isDemo: false },
  { code: "CBT-J1K2L3", name: "Fatima Bello",      used: false, isDemo: false },
  { code: "CBT-M4N5O6", name: "Gbenga Ogunleye",   used: false, isDemo: false },
  { code: "CBT-P7Q8R9", name: "Halima Yusuf",      used: false, isDemo: false },
  { code: "CBT-S1T2U3", name: "Ibrahim Musa",      used: false, isDemo: false },
  { code: "CBT-V4W5X6", name: "Jumoke Adebayo",    used: false, isDemo: false },
  { code: "CBT-Y7Z8A9", name: "Kelechi Nwosu",     used: false, isDemo: false },
  { code: "CBT-B1C2D3", name: "Lami Danjuma",      used: false, isDemo: false },
  { code: "CBT-E4F5G6", name: "Musa Abdullahi",    used: false, isDemo: false },
  { code: "CBT-H7I8J9", name: "Ngozi Okonkwo",     used: false, isDemo: false },
  { code: "CBT-K1L2M3", name: "Oluwaseun Adeleke", used: false, isDemo: false },
  { code: "CBT-N4O5P6", name: "Peace Etim",        used: false, isDemo: false },
  { code: "CBT-Q7R8S9", name: "Rashida Sani",      used: false, isDemo: false },
  { code: "CBT-T1U2V3", name: "Segun Bakare",      used: false, isDemo: false },
  { code: "CBT-W4X5Y6", name: "Titi Lawal",        used: false, isDemo: false },
  { code: "CBT-Z7A8B9", name: "Uche Nnamdi",       used: false, isDemo: false },
  { code: "CBT-C1D2E3", name: "Victoria Umeh",     used: false, isDemo: false },
  { code: "CBT-F4G5H6", name: "Wale Ogunbiyi",     used: false, isDemo: false },

  // ============================================================
  // ADD MORE CANDIDATES BELOW
  // Format: { code: "CBT-XXXXXX", name: "Full Name", used: false, isDemo: false },
  // ============================================================
];

// ============================================================
// PERSISTENCE LAYER
// ============================================================
// We persist "used" codes in localStorage so a code stays
// consumed even after page refresh (on this browser).
// ============================================================

const STORAGE_KEY = "cbt_used_codes";

function getUsedCodes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function markCodeAsUsed(code) {
  const used = getUsedCodes();
  if (!used.includes(code)) {
    used.push(code);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(used));
  }
}

function isCodeUsed(code) {
  return getUsedCodes().includes(code);
}

/**
 * Validate an entry code.
 * Returns one of:
 *   { valid: true,  user: {...} }                  — OK to proceed
 *   { valid: false, reason: "not_found" }          — code doesn't exist
 *   { valid: false, reason: "used", user: {...} }  — code already used
 */
function validateEntryCode(code) {
  const normalized = (code || "").trim().toUpperCase();
  const user = userRegistry.find(u => u.code.toUpperCase() === normalized);

  if (!user) {
    return { valid: false, reason: "not_found" };
  }

  // Demo account is always allowed
  if (user.isDemo) {
    return { valid: true, user };
  }

  // Real accounts: check both the in-memory flag and localStorage
  if (user.used || isCodeUsed(user.code)) {
    return { valid: false, reason: "used", user };
  }

  return { valid: true, user };
}

/**
 * Consume a code after a successful exam start.
 * Demo account is never consumed.
 */
function consumeEntryCode(user) {
  if (user.isDemo) return;
  user.used = true;
  markCodeAsUsed(user.code);
}