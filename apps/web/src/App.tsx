import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './providers/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Trade } from './pages/Trade';
import { Explore } from './pages/Explore';
import { Portfolio } from './pages/Portfolio';
import { Account } from './pages/Account';
import { ListToken } from './pages/ListToken';
import { Locks } from './pages/Locks';
import { Stats } from './pages/Stats';
import { Docs } from './pages/Docs';
import { Auth } from './pages/Auth';
import AuthCallback from './pages/AuthCallback';


export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Landing page — standalone, no sidebar */}
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* App shell — sidebar + top bar */}
            <Route element={<Layout />}>
              <Route path="/trade" element={<Trade />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/account" element={<Account />} />
              <Route path="/list" element={<ListToken />} />
              <Route path="/locks" element={<Locks />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/docs" element={<Docs />} />
            </Route>

            {/* Catch-all 404 — redirect to landing */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
