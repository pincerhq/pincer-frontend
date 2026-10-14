/**
 * Login — split layout: the story on the left, the form on a brand-blue art
 * panel on the right (the reference composition, in our own design language).
 *
 * One way in: an identity's name or email plus its password, checked by the
 * Pincer API (`POST /api/auth/login`). The session store keeps the token pair
 * — for this tab, or on the device with "remember me" — and every protected
 * page reads that store.
 */
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import '@/styles/marketing.css';
import { ApiError } from '@/lib/api/client';
import { loginErrorKind } from '@/lib/api/auth';
import { SIGNUP_ALLOWED } from '@/lib/signup';
import { defaultApiUrl, resolveReturnTo, useSession } from '@/stores/session';

function loginErrorMessage(err: unknown): string {
  switch (loginErrorKind(err)) {
    case 'invalid':
      // Never which of the two: that would confirm an account exists.
      return 'Name/email or password is incorrect.';
    case 'locked': {
      const wait = err instanceof ApiError ? err.retryAfter : undefined;
      return wait
        ? `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} min.`
        : 'Too many failed attempts. Try again in a few minutes.';
    }
    case 'validation':
      return 'Enter your name or email and your password.';
    case 'unreachable':
      return `The server at ${defaultApiUrl()} cannot be reached.`;
    default:
      return err instanceof Error && err.message ? err.message : 'Sign-in failed. Please try again.';
  }
}

const Login = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();

  // Redirect already-signed-in visitors away from /login. This runs only on
  // mount — the submit handler does its own navigation after a sign-in.
  useEffect(() => {
    if (useSession.getState().connected) navigate(resolveReturnTo('/dashboard'), { replace: true });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await useSession.getState().login({ identifier, password, remember: rememberMe });
    } catch (err) {
      setError(loginErrorMessage(err));
      setIsLoading(false);
      return;
    }
    const target = resolveReturnTo('/dashboard');
    useSession.getState().setReturnTo(null);
    navigate(target, { replace: true });
  };

  const field =
    'h-11 rounded-[10px] border-[color:var(--line)] bg-[color:var(--paper)] text-[color:var(--ink)] placeholder:text-[color:var(--text-5)]';

  return (
    <div className="site3d min-h-screen lg:grid lg:grid-cols-[1fr_1fr]">
      {/* ── Left: the story ── */}
      <div className="flex flex-col justify-between px-8 py-10 lg:px-16 lg:py-14">
        <Link to="/" className="m-lockup">
          <span className="name">3DAYS</span>
          <span className="kind">PLATFORM</span>
        </Link>

        <div className="py-14 lg:py-0">
          <h1 className="max-w-[13ch] text-[clamp(2.4rem,4.6vw,4.1rem)] text-[color:var(--ink)]">
            An AI workforce that starts before you do
          </h1>
          <p className="mt-8 max-w-md text-[17px] leading-relaxed text-[color:var(--text-3)]">
            Sign in to review what your AI employees handled, approve what needs a human,
            and see the hours they gave back this week.
          </p>
        </div>

        <p className="text-sm text-[color:var(--text-4)]">
          Copyright © {new Date().getFullYear()} All Rights Reserved by 3Days.ai
        </p>
      </div>

      {/* ── Right: the form, floating on the brand panel ── */}
      <div className="p-4 lg:py-6 lg:pr-6">
        <div className="m-auth-art flex min-h-[560px] items-center justify-center p-6 lg:min-h-full">
          <div className="relative z-10 w-full max-w-[420px] rounded-[20px] bg-[color:var(--paper)] p-7 shadow-[0_30px_60px_-32px_color-mix(in_srgb,var(--shade)_55%,transparent)] sm:p-9">
            <h2 className="text-center text-[26px] text-[color:var(--ink)]">Sign in</h2>
            <p className="mt-2 text-center text-[15px] text-[color:var(--text-3)]">
              Enter your account details below
            </p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4" aria-busy={isLoading}>
              <div className="space-y-1.5">
                <Label htmlFor="identifier" className="text-[13px] font-medium text-[color:var(--text-2)]">
                  Name or email
                </Label>
                <Input
                  id="identifier"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={320}
                  placeholder="Your name or email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  className={field}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[13px] font-medium text-[color:var(--text-2)]">
                  Password
                </Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  className={field}
                />
              </div>

              {error && (
                <p id="login-error" role="alert" className="text-[13px] text-red-700">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="rememberMe"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked === true)}
                  />
                  <Label
                    htmlFor="rememberMe"
                    className="cursor-pointer text-[13px] font-normal text-[color:var(--text-3)]"
                  >
                    Remember me
                  </Label>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="mt-1 h-11 w-full rounded-full bg-[color:var(--brand)] text-[15px] font-semibold text-[color:var(--on-brand)] transition-colors hover:bg-[color:var(--brand-hover)] disabled:opacity-40"
              >
                {isLoading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className="mt-5 text-center text-[13px] text-[color:var(--text-3)]">
              Forgot your credentials?{' '}
              <Link to="/forgot-password" className="font-semibold text-[color:var(--ink)] underline underline-offset-2">
                Reset password
              </Link>
            </p>

            {SIGNUP_ALLOWED && (
              <>
                <div className="my-5 flex items-center gap-4">
                  <span className="h-px flex-1 bg-[color:var(--line)]" />
                  <span className="text-[13px] text-[color:var(--text-4)]">or</span>
                  <span className="h-px flex-1 bg-[color:var(--line)]" />
                </div>

                <p className="text-center text-[13px] text-[color:var(--text-3)]">
                  Don't have an account?{' '}
                  <Link to="/signup" className="font-semibold text-[color:var(--ink)] underline underline-offset-2">
                    Request access
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
