/**
 * Request access — the login screen's twin, shown only in builds with
 * SIGNUP_ALLOWED=true (see `src/lib/signup.ts`).
 *
 * Honest about what it can do: the Pincer API has no registration endpoint.
 * Accounts are created by whoever runs the instance (`pincer identity create`),
 * so this page collects who is asking, hands the request over as a prefilled
 * mail draft — like the reset page — and says an administrator will create
 * the account. It never signs anyone in.
 */
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import '@/styles/marketing.css';
import { useSession } from '@/stores/session';

/** Where access requests go. Same address the reset page uses. */
const ADMIN_CONTACT = 'support@3days.ai';

const Signup = () => {
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    company: '',
  });

  // Mirror Login: already-signed-in visitors skip straight to the app.
  useEffect(() => {
    if (useSession.getState().connected) navigate('/dashboard', { replace: true });
  }, [navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Flip the view first: handing off to `mailto:` is a navigation, and it
    // must never be able to pre-empt the state update behind it.
    setSubmitted(true);

    const subject = encodeURIComponent('Access request');
    const body = encodeURIComponent(
      `Please create a platform account for:\n\n` +
        `Name: ${formData.firstName.trim()} ${formData.lastName.trim()}\n` +
        `Email: ${formData.email.trim()}\n` +
        `Company: ${formData.company.trim()}\n\n` +
        `(Sent from the 3Days.ai request-access page.)`,
    );
    window.location.href = `mailto:${ADMIN_CONTACT}?subject=${subject}&body=${body}`;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const inputCls =
    'h-11 rounded-[10px] border-[color:var(--line)] bg-[color:var(--paper)] text-[color:var(--ink)] placeholder:text-[color:var(--text-5)]';
  const labelCls = 'text-[13px] font-medium text-[color:var(--text-2)]';

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
            Put your first AI employee to work today
          </h1>
          <p className="mt-8 max-w-md text-[17px] leading-relaxed text-[color:var(--text-3)]">
            Tell us who you are and we'll pass the request to whoever runs your 3Days instance.
            They create your account and send you your sign-in details.
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
            {submitted ? (
              <div className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[14px] bg-[color:var(--sand)]">
                  <MailCheck className="h-5 w-5 text-[color:var(--ink)]" strokeWidth={1.75} />
                </span>
                <h2 className="mt-5 text-[26px] text-[color:var(--ink)]">Request prepared</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-[color:var(--text-3)]">
                  A mail draft for <span className="font-semibold text-[color:var(--ink)]">{formData.email}</span>{' '}
                  was opened in your mail app. Send it and an administrator will create your account.
                </p>
                <p className="mt-4 text-[13px] text-[color:var(--text-4)]">
                  Nothing opened?{' '}
                  <a
                    href={`mailto:${ADMIN_CONTACT}`}
                    className="font-semibold text-[color:var(--ink)] underline underline-offset-2"
                  >
                    Write to {ADMIN_CONTACT}
                  </a>
                </p>
              </div>
            ) : (
            <>
            <h2 className="text-center text-[26px] text-[color:var(--ink)]">Request access</h2>
            <p className="mt-2 text-center text-[15px] text-[color:var(--text-3)]">
              Tell us who needs an account
            </p>

            <div className="mt-7">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className={labelCls}>First name</Label>
                  <Input
                    id="firstName"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    required
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className={labelCls}>Last name</Label>
                  <Input
                    id="lastName"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleInputChange}
                    required
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className={labelCls}>Work email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="name@company.com"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  className={inputCls}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="company" className={labelCls}>Company name</Label>
                <Input
                  id="company"
                  name="company"
                  value={formData.company}
                  onChange={handleInputChange}
                  required
                  className={inputCls}
                />
              </div>

              <p className="rounded-[10px] border border-amber-300/70 bg-amber-50/60 p-3.5 text-xs leading-relaxed text-amber-800">
                This deployment has no self-service sign-up — accounts are created by whoever runs
                your instance. Sending opens a prefilled request to {ADMIN_CONTACT}; no account is
                created automatically.
              </p>

              <button
                type="submit"
                className="mt-1 h-11 w-full rounded-full bg-[color:var(--brand)] text-[15px] font-semibold text-[color:var(--on-brand)] transition-colors hover:bg-[color:var(--brand-hover)]"
              >
                Send access request
              </button>
            </form>
            </div>
            </>
            )}

            <div className="my-5 flex items-center gap-4">
              <span className="h-px flex-1 bg-[color:var(--line)]" />
              <span className="text-[13px] text-[color:var(--text-4)]">or</span>
              <span className="h-px flex-1 bg-[color:var(--line)]" />
            </div>

            <p className="text-center text-[13px] text-[color:var(--text-3)]">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-[color:var(--ink)] underline underline-offset-2">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signup;
