/**
 * Reset password — the third auth page, on the same shell as Login and Signup.
 *
 * Honest about what it can do: this deployment has no self-service password
 * reset. Sign-in is either the credential pair configured for the instance or
 * a Pincer bearer token, and neither can be re-issued from the browser. So the
 * page collects the address, hands the request to whoever runs the instance
 * (a prefilled mail draft), and says plainly that no automated email goes out
 * — rather than showing a "check your inbox" screen that would be a lie.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import '@/styles/marketing.css';

/** Where reset requests go. Same address the marketing pages use for support. */
const ADMIN_CONTACT = 'support@3days.ai';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const field =
    'h-11 rounded-[10px] border-[color:var(--line)] bg-[color:var(--paper)] text-[color:var(--ink)] placeholder:text-[color:var(--text-5)]';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;

    // Flip the view first: handing off to `mailto:` is a navigation, and it
    // must never be able to pre-empt the state update behind it.
    setSubmitted(true);

    // The only real action available: open a prefilled request to the people
    // who can actually re-issue access for this instance.
    const subject = encodeURIComponent('Password reset request');
    const body = encodeURIComponent(
      `Please reset platform access for: ${address}\n\n(Sent from the 3Days.ai reset page.)`,
    );
    window.location.href = `mailto:${ADMIN_CONTACT}?subject=${subject}&body=${body}`;
    toast({
      title: 'Request prepared',
      description: `A mail draft to ${ADMIN_CONTACT} was opened in your mail app.`,
    });
  };

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
            Locked out happens. Let's get you back in
          </h1>
          <p className="mt-8 max-w-md text-[17px] leading-relaxed text-[color:var(--text-3)]">
            Tell us the address on your account and we'll pass the request to whoever runs your
            3Days instance. Your AI employees keep working in the meantime.
          </p>
        </div>

        <p className="text-sm text-[color:var(--text-4)]">
          Copyright © {new Date().getFullYear()} All Rights Reserved by 3Days.ai
        </p>
      </div>

      {/* ── Right: the form, floating on the brand panel ── */}
      <div className="p-4 lg:py-6 lg:pr-6">
        <div className="m-auth-art flex min-h-[560px] items-center justify-center p-6 lg:min-h-full">
          <div className="relative z-10 w-full max-w-[420px] rounded-[20px] bg-[color:var(--paper)] p-7 shadow-[0_30px_60px_-32px_rgba(10,16,60,0.55)] sm:p-9">
            {!submitted ? (
              <>
                <h2 className="text-center text-[26px] text-[color:var(--ink)]">Reset password</h2>
                <p className="mt-2 text-center text-[15px] text-[color:var(--text-3)]">
                  Enter the email on your account
                </p>

                <form onSubmit={handleSubmit} className="mt-7 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-[13px] font-medium text-[color:var(--text-2)]">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      className={field}
                    />
                  </div>

                  <p className="rounded-[10px] border border-amber-300/70 bg-amber-50/60 p-3.5 text-xs leading-relaxed text-amber-800">
                    This deployment has no self-service reset yet — access is issued by whoever runs
                    your instance. Sending opens a prefilled request to {ADMIN_CONTACT}; no automated
                    email is sent.
                  </p>

                  <button
                    type="submit"
                    className="mt-1 h-11 w-full rounded-full bg-[color:var(--ink)] text-[15px] font-semibold text-[color:var(--on-ink)] transition-opacity hover:opacity-85"
                  >
                    Send reset request
                  </button>
                </form>
              </>
            ) : (
              <div className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[14px] bg-[color:var(--sand)]">
                  <MailCheck className="h-5 w-5 text-[color:var(--ink)]" strokeWidth={1.75} />
                </span>
                <h2 className="mt-5 text-[26px] text-[color:var(--ink)]">Request prepared</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-[color:var(--text-3)]">
                  A mail draft for <span className="font-semibold text-[color:var(--ink)]">{email}</span>{' '}
                  was opened in your mail app. Send it and your administrator will re-issue access.
                </p>
                <p className="mt-4 text-[13px] text-[color:var(--text-4)]">
                  Nothing arrived?{' '}
                  <a
                    href={`mailto:${ADMIN_CONTACT}`}
                    className="font-semibold text-[color:var(--ink)] underline underline-offset-2"
                  >
                    Write to {ADMIN_CONTACT}
                  </a>
                </p>
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="mt-6 h-11 w-full rounded-full border border-[color:var(--line)] text-[15px] font-semibold text-[color:var(--text-2)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
                >
                  Use a different email
                </button>
              </div>
            )}

            <div className="my-5 flex items-center gap-4">
              <span className="h-px flex-1 bg-[color:var(--line)]" />
              <span className="text-[13px] text-[color:var(--text-4)]">or</span>
              <span className="h-px flex-1 bg-[color:var(--line)]" />
            </div>

            <p className="flex items-center justify-center gap-1.5 text-center text-[13px] text-[color:var(--text-3)]">
              <ArrowLeft className="h-3.5 w-3.5" />
              <Link to="/login" className="font-semibold text-[color:var(--ink)] underline underline-offset-2">
                Back to sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
