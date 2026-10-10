import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from './contexts/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import { SIGNUP_ALLOWED } from './lib/signup';

// The public site is gone: everything it advertised is either shipped inside
// the app or was never built, so the only unauthenticated screens left are the
// ones the account flow needs. `/` goes straight to the sign-in form. Signup
// exists only in builds with SIGNUP_ALLOWED=true; otherwise /signup is a 404.
const Signup = SIGNUP_ALLOWED ? lazy(() => import('./pages/Signup')) : null;
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));

// Platform screens that read endpoints the backend actually serves:
// /api/{status,costs,audit,skills,schedules,conversations,integrations,chat}.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const CompanyHome = lazy(() => import('./pages/company/CompanyHome'));
const Chat = lazy(() => import('./pages/Chat'));
const Tasks = lazy(() => import('./pages/Tasks'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));

// Notes — its own backend (pincer_extensions/notes_app).
const NotesHome = lazy(() => import('./pages/notes/NotesHome'));
const NotesDaily = lazy(() => import('./pages/notes/NotesDaily'));
const NotesGraph = lazy(() => import('./pages/notes/NotesGraph'));
const NotesTrash = lazy(() => import('./pages/notes/NotesTrash'));
const NotesOpenItems = lazy(() => import('./pages/notes/NotesOpenItems'));
const NotesSearch = lazy(() => import('./pages/notes/NotesSearch'));
const NotesMatter = lazy(() => import('./pages/notes/NotesMatter'));
const NotesSavedView = lazy(() => import('./pages/notes/NotesSavedView'));

const TelephonyHome = lazy(() => import('./pages/telephony/TelephonyHome'));

// Notes — global quick-capture (mounted at root for Cmd+Shift+N from anywhere)
import QuickCapture from './pages/notes/_components/quick-capture/QuickCapture';
// Voice — live in-call approvals, mounted at root because the owner is rarely
// on the Voice page when the agent asks and the callee is on hold (S11 §6.5).
import VoiceApprovalHost from './components/voice/VoiceApprovalHost';
import { ROUTES as VOICE_ROUTES, TELEPHONY_STATIC_PATHS } from './pages/telephony/_lib/routes';
const OwnerLoginPage = lazy(() => import('./pages/telephony/OwnerLoginPage'));

/** Wraps a lazy screen in the protected shell with a matching fallback line. */
function Protected({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <ProtectedRoute>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-gray-400">{label ?? ''}</div>}>
        {children}
      </Suspense>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <ThemeProvider>
      <Router>
        <div className="App">
          <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-gray-400" />}>
          <Routes>
            {/* Auth screens — no layout wrapper; signup (when enabled) is login's twin */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            {Signup && <Route path="/signup" element={<Signup />} />}
            <Route path="/forgot-password" element={<ForgotPassword />} />

            {/* Protected routes — require authentication, use platform layout */}
            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            {/* Company Brain — driven by /api/integrations and /api/chat/message */}
            {(['', '/memory', '/sync'] as const).map((sub) => (
              <Route key={sub} path={`/company-brain${sub}`} element={<Protected><CompanyHome /></Protected>} />
            ))}
            <Route path="/chat" element={<Protected><Chat /></Protected>} />
            <Route path="/tasks" element={<Protected><Tasks /></Protected>} />
            <Route path="/integrations" element={<Protected><IntegrationsPage /></Protected>} />

            {/* AI-Native Notes */}
            <Route path="/notes" element={<Protected label="Loading notes…"><NotesHome /></Protected>} />
            <Route path="/notes/daily" element={<Protected><NotesDaily /></Protected>} />
            <Route path="/notes/graph" element={<Protected label="Loading graph…"><NotesGraph /></Protected>} />
            <Route path="/notes/search" element={<Protected label="Loading search…"><NotesSearch /></Protected>} />
            <Route path="/notes/matter/:key" element={<Protected label="Loading matter…"><NotesMatter /></Protected>} />
            <Route path="/notes/view/:id" element={<Protected label="Loading view…"><NotesSavedView /></Protected>} />
            <Route path="/notes/open" element={<Protected label="Loading open items…"><NotesOpenItems /></Protected>} />
            <Route path="/notes/trash" element={<Protected><NotesTrash /></Protected>} />
            <Route path="/notes/notebook/:id" element={<Protected><NotesHome /></Protected>} />
            <Route path="/notes/tag/:tag" element={<Protected><NotesHome /></Protected>} />
            <Route path="/notes/:id" element={<Protected label="Loading note…"><NotesHome /></Protected>} />

            {/* Owner login (FE1): creates the session, so it lives outside ProtectedRoute */}
            <Route
              path={VOICE_ROUTES.LOGIN}
              element={
                <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-gray-400" />}>
                  <OwnerLoginPage />
                </Suspense>
              }
            />
            {/* Telephony / owner app — static paths come from _lib/routes.ts (FE0) */}
            {TELEPHONY_STATIC_PATHS.map((path) => (
              <Route key={path} path={path} element={<Protected label="Loading Telephony…"><TelephonyHome /></Protected>} />
            ))}
            <Route path="/telephony/calls/:callSid" element={<Protected label="Loading call…"><TelephonyHome /></Protected>} />
            <Route path="/telephony/threads/:threadId" element={<Protected label="Loading thread…"><TelephonyHome /></Protected>} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          <Toaster />
          <QuickCapture />
          <VoiceApprovalHost />
        </div>
      </Router>
    </ThemeProvider>
  );
}

export default App;
