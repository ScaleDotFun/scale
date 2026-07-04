import { type FC, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../providers/AuthProvider';

export const Auth: FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login, register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Redirect if already authenticated
  if (isAuthenticated) {
    navigate('/trade');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password);
      }
      navigate('/trade');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = () => {
    const apiUrl = import.meta.env.VITE_API_URL
      ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '').replace(/\/api$/, '')}/api`
      : '/api';
    window.location.href = `${apiUrl}/auth/google`;
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#050408',
      display: 'flex',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background effects */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 30% 20%, rgba(139, 92, 255,0.04) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(139, 92, 255,0.03) 0%, transparent 60%)',
        pointerEvents: 'none',
      }} />

      {/* Left panel — branding */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px 80px',
        position: 'relative',
      }}>
        <Link to="/" style={{ textDecoration: 'none', position: 'absolute', top: 40, left: 80 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8b5cff" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#f4f2ff', letterSpacing: '0.04em' }}>FRONT</span>
          </div>
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 style={{
            fontSize: '2.2rem',
            fontWeight: 800,
            color: '#f4f2ff',
            lineHeight: 1.2,
            marginBottom: 16,
          }}>
            Leverage trade<br />
            any memecoin<br />
            <span style={{ color: '#8b5cff' }}>on Solana.</span>
          </h1>
          <p style={{
            fontSize: 15,
            color: '#6f668f',
            lineHeight: 1.6,
            maxWidth: 400,
            marginBottom: 40,
          }}>
            Deposit SOL, choose your leverage, and the protocol fills the rest.
            Real on-chain execution via Jupiter. No synthetic perps.
          </p>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 40 }}>
            {[
              { label: 'Max Leverage', value: '10x' },
              { label: 'Trading Fee', value: '0.5%' },
              { label: 'Creator Revenue', value: '30%' },
            ].map((s) => (
              <div key={s.label}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#8b5cff', fontFamily: "'JetBrains Mono', monospace" }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 11, color: '#5e5680', marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Right panel — form */}
      <div style={{
        width: 480,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 60px',
        borderLeft: '1px solid #0f0c1a',
      }}>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          style={{ width: '100%', maxWidth: 360 }}
        >
          {/* Tabs */}
          <div style={{
            display: 'flex',
            gap: 0,
            marginBottom: 32,
            borderBottom: '1px solid #211a38',
          }}>
            <button
              onClick={() => { setMode('login'); setError(''); }}
              style={{
                flex: 1,
                padding: '12px 0',
                fontSize: 14,
                fontWeight: 600,
                color: mode === 'login' ? '#f4f2ff' : '#5e5680',
                background: 'none',
                border: 'none',
                borderBottom: mode === 'login' ? '2px solid #8b5cff' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('register'); setError(''); }}
              style={{
                flex: 1,
                padding: '12px 0',
                fontSize: 14,
                fontWeight: 600,
                color: mode === 'register' ? '#f4f2ff' : '#5e5680',
                background: 'none',
                border: 'none',
                borderBottom: mode === 'register' ? '2px solid #8b5cff' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Create Account
            </button>
          </div>

          {/* Google button */}
          <button
            onClick={handleGoogleLogin}
            type="button"
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '12px 16px',
              background: '#0c0a16',
              border: '1px solid #241d3d',
              borderRadius: 8,
              color: '#c9c3e0',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
              marginBottom: 20,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#352a58';
              e.currentTarget.style.background = '#0f0c1a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#241d3d';
              e.currentTarget.style.background = '#0c0a16';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 001 12c0 1.92.45 3.73 1.18 5.33l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 20,
          }}>
            <div style={{ flex: 1, height: 1, background: '#211a38' }} />
            <span style={{ fontSize: 11, color: '#453a6b' }}>or</span>
            <div style={{ flex: 1, height: 1, background: '#211a38' }} />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{
                padding: '10px 14px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: 6,
                color: '#ff3d71',
                fontSize: 12,
                marginBottom: 16,
              }}>
                {error}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#5e5680', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Email
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: '#0c0a16',
                  border: '1px solid #241d3d',
                  borderRadius: 6,
                  color: '#f4f2ff',
                  fontSize: 13,
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#8b5cff40'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#241d3d'}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#5e5680', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Password
              </label>
              <input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: '#0c0a16',
                  border: '1px solid #241d3d',
                  borderRadius: 6,
                  color: '#f4f2ff',
                  fontSize: 13,
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#8b5cff40'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#241d3d'}
              />
            </div>

            {mode === 'register' && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#5e5680', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Confirm Password
                </label>
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    background: '#0c0a16',
                    border: '1px solid #241d3d',
                    borderRadius: 6,
                    color: '#f4f2ff',
                    fontSize: 13,
                    outline: 'none',
                    transition: 'border-color 0.2s',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#8b5cff40'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#241d3d'}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !email.trim() || !password.trim()}
              style={{
                width: '100%',
                padding: '13px 16px',
                background: '#8b5cff',
                color: '#050408',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 700,
                cursor: submitting ? 'wait' : 'pointer',
                transition: 'all 0.2s',
                marginTop: 8,
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting
                ? 'Processing...'
                : mode === 'login'
                  ? 'Sign In'
                  : 'Create Account'
              }
            </button>
          </form>

          {/* Footer note */}
          <div style={{
            marginTop: 24,
            padding: '14px 16px',
            background: '#0c0a16',
            border: '1px solid #211a38',
            borderRadius: 8,
          }}>
            <div style={{ fontSize: 11, color: '#5e5680', lineHeight: 1.6 }}>
              {mode === 'register' ? (
                <>A fresh Solana wallet will be generated for your account. You can deposit SOL to start trading with leverage.</>
              ) : (
                <>Sign in to access your trading account and managed wallet.</>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
