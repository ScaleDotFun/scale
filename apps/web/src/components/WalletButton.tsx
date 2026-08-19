import { type FC, useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';
import { formatAddress } from '../lib/format';

export const WalletButton: FC = () => {
  const { user, isAuthenticated, login, register, logout, loading } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const [mode, setMode] = useState<'idle' | 'login' | 'register'>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setMode('idle');
        setError('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setError('');
    setSubmitting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password);
      }
      setShowDropdown(false);
      setMode('idle');
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(user.walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  if (loading) {
    return <div className="auth-btn auth-btn-loading">...</div>;
  }

  // Logged in state
  if (isAuthenticated && user) {
    return (
      <div className="auth-wrapper" ref={dropdownRef}>
        <button
          className="auth-btn auth-btn-account"
          onClick={() => setShowDropdown(!showDropdown)}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>{user.email.length > 16 ? user.email.slice(0, 14) + '...' : user.email}</span>
        </button>

        {showDropdown && (
          <div className="auth-dropdown">
            <div className="auth-dropdown-section">
              <span className="auth-dropdown-label">Deposit Wallet</span>
              <div className="auth-dropdown-address">
                <span className="mono">{formatAddress(user.walletAddress, 6)}</span>
                <button className="auth-copy-btn" onClick={handleCopy} type="button">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="auth-dropdown-divider" />
            <button className="auth-dropdown-item auth-signout" onClick={logout} type="button">
              Sign Out
            </button>
          </div>
        )}
      </div>
    );
  }

  // Logged out state — link to full auth page
  return (
    <Link to="/auth" className="auth-btn auth-btn-signin" style={{ textDecoration: 'none' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
      Sign In
    </Link>
  );
};
