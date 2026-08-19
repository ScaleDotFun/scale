// ──────────────────────────────────────────────
// SCALE PROTOCOL — OAuth Callback Handler
// ──────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';

const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '').replace(/\/api$/, '')}/api`
  : '/api';

/**
 * Handles the OAuth callback redirect from the API.
 * Exchanges a one-time auth code for a JWT via POST.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setToken } = useAuth();
  const [status, setStatus] = useState('Authenticating...');

  useEffect(() => {
    const code = params.get('code');
    const token = params.get('token'); // Legacy fallback
    const error = params.get('error');

    if (error) {
      console.error('[OAuth] Error:', error);
      navigate('/auth?error=' + error, { replace: true });
      return;
    }

    if (code) {
      // Exchange one-time code for JWT via POST (prevents JWT in URL)
      fetch(`${BASE_URL}/auth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('Code exchange failed');
          const json = await res.json();
          const jwt = json.data?.token ?? json.token;
          if (!jwt) throw new Error('No token in response');
          setToken(jwt);
          navigate('/trade', { replace: true });
        })
        .catch((err) => {
          console.error('[OAuth] Code exchange error:', err);
          setStatus('Authentication failed. Please try again.');
          setTimeout(() => navigate('/auth', { replace: true }), 2000);
        });
    } else if (token) {
      // Legacy fallback: direct token in URL
      setToken(token);
      navigate('/trade', { replace: true });
    } else {
      navigate('/auth', { replace: true });
    }
  }, [params, navigate, setToken]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#060605',
      color: 'var(--primary)',
      fontSize: '1.2rem',
      fontFamily: 'Inter, sans-serif',
    }}>
      {status}
    </div>
  );
}
