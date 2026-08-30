'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type SignInIntent = 'sell' | 'buy';

const COPY: Record<SignInIntent, { title: string; description: string }> = {
  sell: {
    title: 'Sign in to Sell',
    description: 'Create and manage listings from your account.',
  },
  buy: {
    title: 'Sign in to Buy',
    description: 'Sign in to claim items and make offers.',
  },
};

export function SignInRequiredModal({
  intent,
  returnTo,
  cancelTo = '/listings',
}: {
  intent: SignInIntent;
  returnTo: string;
  cancelTo?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const copy = COPY[intent];
  const titleId = `sign-in-to-${intent}-title`;

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        router.push(cancelTo);
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [cancelTo, router]);

  function close() {
    router.push(cancelTo);
  }

  return (
    <div className="auth-modal">
      <div className="auth-modal__backdrop" aria-hidden="true" onClick={close} />
      <section
        ref={dialogRef}
        className="auth-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button ref={closeRef} className="auth-modal__close" type="button" onClick={close} aria-label="close">
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <h1 id={titleId}>{copy.title}</h1>
        <p>{copy.description}</p>
        <div className="auth-modal__actions">
          <Link className="button" href={{ pathname: '/sign-in', query: { returnTo } }}>
            Go to Sign In
          </Link>
        </div>
        <p className="auth-modal__signup">
          Don&apos;t have an account?{' '}
          <Link href={{ pathname: '/sign-in', query: { mode: 'sign-up', returnTo } }}>Create one here</Link>
        </p>
      </section>
    </div>
  );
}
