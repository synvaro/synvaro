'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const register = mode === 'register';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'),
          password: data.get('password'),
        }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        setMessage(result.message ?? 'Please try again.');
        return;
      }
      form.reset();
      if (register) {
        setMessage('Registration received. You can now try signing in.');
      } else {
        router.replace('/');
        router.refresh();
      }
    } catch {
      setMessage('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card">
      <p className="eyebrow">SYNVARO STUDIO</p>
      <h1>{register ? 'Create an account' : 'Welcome back'}</h1>
      <p>
        {register
          ? 'Start with your email and a strong password.'
          : 'Sign in to your studio.'}
      </p>
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={register ? 'new-password' : 'current-password'}
          minLength={12}
          maxLength={128}
          required
          aria-describedby="password-hint"
        />
        <small id="password-hint">Use 12–128 characters.</small>
        <button className="button" disabled={busy}>
          {busy ? 'Please wait…' : register ? 'Register' : 'Log in'}
        </button>
        <p role="status" aria-live="polite">
          {message}
        </p>
      </form>
      <Link className="auth-link" href={register ? '/login' : '/register'}>
        {register ? 'Already registered? Log in' : 'Create an account'}
      </Link>
    </section>
  );
}
