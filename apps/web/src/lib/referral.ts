// Referral capture — reads ?ref=CODE from any entry URL, stores it, and
// mirrors it to a cookie so it also rides the top-level Google OAuth
// navigation (which can't carry custom state). Read at signup time.

const REF_KEY = 'scale_ref';

/** Call once on app load. Captures ?ref= from the URL if present. */
export function captureReferral(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('ref');
    if (!raw) return;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return;
    // First ref wins — don't overwrite an existing capture
    if (!localStorage.getItem(REF_KEY)) {
      localStorage.setItem(REF_KEY, code);
    }
    document.cookie = `${REF_KEY}=${code}; path=/; max-age=2592000; SameSite=Lax`;
  } catch {
    // storage unavailable — ignore
  }
}

/** The captured referral code, or null. */
export function getReferral(): string | null {
  try {
    return localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}
