'use client';
import Link from 'next/link';
import { ImagePanel } from './image-panel';
import { VoicePanel } from './voice-panel';
import { VideoPanel } from './video-panel';
import { ReelPanel } from './reel-panel';
import { AiPanel } from './ai-panel';
import { AttachedMedia } from './attachments';
import { PublishPanel } from './publish-panel';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Content, ContentResponse } from '@synvaro/contracts';
export function DraftEditor({
  brand,
  initial,
}: {
  brand: { id: string; name: string };
  initial: Content | null;
}) {
  const [attachmentVersion, setAttachmentVersion] = useState(0);
  const [content, setContent] = useState(initial);
  const [saved, setSaved] = useState({
    title: initial?.title ?? '',
    body: initial?.body ?? '',
  });
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [leaving, setLeaving] = useState<HTMLElement | 'discard' | null>(null);
  const [pendingAI, setPendingAI] = useState<string | null>(null);
  const bypass = useRef(false);
  const keepButton = useRef<HTMLButtonElement>(null);
  const dirty = value.title !== saved.title || value.body !== saved.body;
  useEffect(() => {
    if (leaving) keepButton.current?.focus();
  }, [leaving]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (!bypass.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const click = (event: MouseEvent) => {
      if (bypass.current) return;
      const target =
        event.target instanceof Element
          ? event.target.closest('a, .logout-button')
          : null;
      if (target instanceof HTMLElement) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setLeaving(target);
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);
  function discard() {
    const target = leaving;
    setLeaving(null);
    setValue(saved);
    setError('');
    setNotice('Changes discarded.');
    if (target && target !== 'discard') {
      bypass.current = true;
      target.click();
      bypass.current = false;
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!value.title.trim()) {
      setError('Enter a title for this draft.');
      return;
    }
    setBusy(true);
    const fields = content
      ? {
          ...(value.title !== saved.title ? { title: value.title } : {}),
          ...(value.body !== saved.body ? { body: value.body } : {}),
        }
      : { brandId: brand.id, ...value };
    try {
      const response = await fetch(
        content ? `/api/contents/${content.id}` : '/api/contents',
        {
          method: content ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setError(
          response.status === 401
            ? 'Your session expired. Copy your text before signing in again.'
            : (result.message ?? 'Unable to save draft.'),
        );
        return;
      }
      const next = (result as ContentResponse).content;
      setContent(next);
      setSaved({ title: next.title, body: next.body });
      setValue({ title: next.title, body: next.body });
      setNotice('Draft saved.');
      // Next integrates native replaceState; keep the saved ID across browser refreshes.
      if (!content)
        window.history.replaceState(null, '', `/content/${next.id}`);
    } catch {
      setError('Unable to connect. Your text is still here; please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function applySuggestion(text: string, confirmed = false) {
    if (!content) return;
    if (value.body !== saved.body && !confirmed) {
      setPendingAI(text);
      return;
    }
    setPendingAI(null);
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/contents/${content.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? 'Unable to apply suggestion.');
      const next = (result as ContentResponse).content;
      setContent(next);
      setSaved((previous) => ({ ...previous, body: next.body }));
      setValue((previous) => ({ ...previous, body: next.body }));
      setNotice(
        'AI suggestion applied and saved. Any unsaved title is preserved.',
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to apply. Your edits are still here.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="draft-editor">
      <Link className="auth-link" href={`/content?brandId=${brand.id}`}>
        Return to content list
      </Link>
      <p className="eyebrow profile-brand-name">Brand: {brand.name}</p>
      <h1>{content ? 'Edit draft' : 'Create draft'}</h1>
      <span className="badge">DRAFT</span>
      <p className="intro">
        Plain text for {brand.name}. Saving does not publish this draft.
      </p>
      <form className="brand-form-card" onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy || !!leaving}>
          <label htmlFor="draft-title">Title</label>
          <input
            id="draft-title"
            required
            maxLength={200}
            value={value.title}
            onChange={(event) => {
              setValue({ ...value, title: event.target.value });
              setNotice('');
            }}
          />
          <small>Required, up to 200 characters.</small>
          <label htmlFor="draft-body">Body</label>
          <textarea
            id="draft-body"
            rows={12}
            maxLength={20000}
            value={value.body}
            onChange={(event) => {
              setValue({ ...value, body: event.target.value });
              setNotice('');
            }}
          />
          <small>
            Plain text, up to 20,000 characters. An empty body is allowed.
          </small>
          <p role="status" className="form-notice">
            {notice || (dirty ? 'You have unsaved changes.' : '')}
          </p>
          <p role="alert" className="form-error">
            {error}
          </p>
          <div className="form-actions">
            <button className="button" disabled={!dirty} type="submit">
              {busy ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!dirty}
              onClick={() => setLeaving('discard')}
            >
              Discard changes
            </button>
          </div>
        </fieldset>
      </form>
      {content ? (
        <AttachedMedia
          key={`${content.id}-${attachmentVersion}`}
          contentId={content.id}
          brand={brand}
          disabled={busy || !!leaving}
        />
      ) : (
        <p>Save this draft before attaching existing brand media.</p>
      )}
      {content && (
        <AiPanel
          contentId={content.id}
          disabled={busy || !!leaving || pendingAI !== null}
          onApply={(text) => void applySuggestion(text)}
        />
      )}
      {content && (
        <ImagePanel
          contentId={content.id}
          brandId={brand.id}
          brandName={brand.name}
          disabled={busy || !!leaving}
          onAttached={() => setAttachmentVersion((v) => v + 1)}
        />
      )}
      {content && (
        <VoicePanel
          contentId={content.id}
          brandName={brand.name}
          savedBody={saved.body}
          disabled={busy || !!leaving}
          onAttached={() => setAttachmentVersion((v) => v + 1)}
        />
      )}
      {content && (
        <VideoPanel
          contentId={content.id}
          brandId={brand.id}
          brandName={brand.name}
          disabled={busy || !!leaving}
          onAttached={() => setAttachmentVersion((v) => v + 1)}
        />
      )}
      {content && (
        <ReelPanel
          contentId={content.id}
          brandId={brand.id}
          brandName={brand.name}
          disabled={busy || !!leaving}
          onAttached={() => setAttachmentVersion((v) => v + 1)}
        />
      )}
      {content && (
        <PublishPanel
          contentId={content.id}
          brandId={brand.id}
          savedBody={saved.body}
          dirty={dirty}
          disabled={busy || !!leaving}
        />
      )}
      {pendingAI !== null && (
        <section
          className="discard-prompt"
          role="alertdialog"
          aria-labelledby="ai-replace-title"
        >
          <h2 id="ai-replace-title">Replace unsaved body edits?</h2>
          <p>
            Applying saves the AI suggestion in place of your current body. Your
            unsaved title is preserved.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setPendingAI(null)}
            >
              Keep my body edits
            </button>
            <button
              type="button"
              className="button"
              onClick={() => void applySuggestion(pendingAI, true)}
            >
              Replace body and save
            </button>
          </div>
        </section>
      )}
      {leaving && (
        <section
          className="discard-prompt"
          role="alertdialog"
          aria-labelledby="discard-title"
          aria-describedby="discard-description"
        >
          <h2 id="discard-title">Discard unsaved changes?</h2>
          <p id="discard-description">Your latest edits have not been saved.</p>
          <div className="form-actions">
            <button
              ref={keepButton}
              className="secondary-button"
              onClick={() => setLeaving(null)}
            >
              Keep editing
            </button>
            <button className="secondary-button" onClick={discard}>
              Discard unsaved changes
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
