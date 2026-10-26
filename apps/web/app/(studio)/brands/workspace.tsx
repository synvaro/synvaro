'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type {
  Brand,
  BrandResponse,
  Organization,
  OrganizationResponse,
} from '@synvaro/contracts';

export function BrandWorkspace({
  initialOrganization,
  initialBrands,
}: {
  initialOrganization: Organization | null;
  initialBrands: Brand[];
}) {
  const router = useRouter();
  const [organization, setOrganization] = useState(initialOrganization);
  const [brands, setBrands] = useState(initialBrands);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save(
    event: FormEvent<HTMLFormElement>,
    kind: 'organization' | 'create' | 'edit',
    id?: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: data.get('name'),
      ...(kind !== 'organization'
        ? { description: data.get('description') }
        : {}),
      ...(kind !== 'edit' && data.get('slug')
        ? { slug: data.get('slug') }
        : {}),
    };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        kind === 'organization'
          ? '/api/organizations'
          : kind === 'create'
            ? '/api/brands'
            : `/api/brands/${id}`,
        {
          method: kind === 'edit' ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const result = await response.json();
      if (response.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      if (!response.ok) {
        setError(result.message ?? 'Unable to save. Please try again.');
        return;
      }
      if (kind === 'organization') {
        setOrganization((result as OrganizationResponse).organization);
        setCreating(true);
        router.refresh();
        setNotice('Organization created. Add your first brand.');
      } else {
        const brand = (result as BrandResponse).brand;
        setBrands((previous) =>
          kind === 'create'
            ? [...previous, brand]
            : previous.map((item) => (item.id === brand.id ? brand : item)),
        );
        setCreating(false);
        setEditing(null);
        setNotice(kind === 'create' ? 'Brand created.' : 'Brand updated.');
      }
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  const feedback = (
    <>
      <p role="alert" className="form-error">
        {error}
      </p>
      <p role="status" className="form-notice">
        {notice}
      </p>
    </>
  );
  if (!organization)
    return (
      <section className="organization-card">
        <p className="eyebrow">WELCOME TO YOUR STUDIO</p>
        <h1>Create your organization</h1>
        <p>
          Give your workspace a name. You can manage multiple brands inside it.
        </p>
        <form
          aria-label="Create organization"
          onSubmit={(event) => void save(event, 'organization')}
        >
          <fieldset disabled={busy}>
            <label htmlFor="organization-name">Organization name</label>
            <input
              id="organization-name"
              name="name"
              required
              maxLength={120}
              autoComplete="organization"
            />
            <label htmlFor="organization-slug">Slug (optional)</label>
            <input
              id="organization-slug"
              name="slug"
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="Generated from the name"
              aria-describedby="org-slug-help"
            />
            <small id="org-slug-help">
              A unique identifier using lowercase letters, numbers and hyphens.
            </small>
            <button className="button" type="submit">
              {busy ? 'Creating…' : 'Create organization'}
            </button>
          </fieldset>
          {feedback}
        </form>
      </section>
    );
  return (
    <>
      <p className="eyebrow">{organization.name}</p>
      <div className="brands-heading">
        <div>
          <h1>Brands</h1>
          <p>Keep each brand’s identity in one place.</p>
        </div>
        {!creating && !editing && (
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              setCreating(true);
              setError('');
              setNotice('');
            }}
          >
            Create brand
          </button>
        )}
      </div>
      {feedback}
      {creating && (
        <section className="brand-form-card">
          <h2>Create brand</h2>
          <form
            aria-label="Create brand"
            onSubmit={(event) => void save(event, 'create')}
          >
            <fieldset disabled={busy}>
              <label htmlFor="brand-name">Brand name</label>
              <input id="brand-name" name="name" required maxLength={120} />
              <label htmlFor="brand-slug">Slug (optional)</label>
              <input
                id="brand-slug"
                name="slug"
                maxLength={80}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="Generated from the name"
              />
              <label htmlFor="brand-description">Description (optional)</label>
              <textarea
                id="brand-description"
                name="description"
                maxLength={2000}
                rows={3}
              />
              <div className="form-actions">
                <button className="button" type="submit">
                  {busy ? 'Saving…' : 'Save brand'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}
      {brands.length === 0 && !creating && (
        <section className="empty-state">
          <h2>No brands yet</h2>
          <p>Create your first brand to get started.</p>
        </section>
      )}
      <div className="brand-grid">
        {brands.map((brand) => (
          <article className="brand-card" key={brand.id}>
            {editing === brand.id ? (
              <>
                <h2>Edit brand</h2>
                <form
                  aria-label="Edit brand"
                  onSubmit={(event) => void save(event, 'edit', brand.id)}
                >
                  <fieldset disabled={busy}>
                    <label htmlFor={`name-${brand.id}`}>Brand name</label>
                    <input
                      id={`name-${brand.id}`}
                      name="name"
                      required
                      maxLength={120}
                      defaultValue={brand.name}
                    />
                    <label htmlFor={`description-${brand.id}`}>
                      Description (optional)
                    </label>
                    <textarea
                      id={`description-${brand.id}`}
                      name="description"
                      maxLength={2000}
                      rows={3}
                      defaultValue={brand.description ?? ''}
                    />
                    <div className="form-actions">
                      <button className="button" type="submit">
                        {busy ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </fieldset>
                </form>
              </>
            ) : (
              <>
                <h2>{brand.name}</h2>
                <span className="brand-slug">{brand.slug}</span>
                <p className="brand-description">
                  {brand.description || 'No description yet.'}
                </p>
                <button
                  className="secondary-button"
                  aria-label={`Edit ${brand.name}`}
                  disabled={busy}
                  onClick={() => {
                    setEditing(brand.id);
                    setCreating(false);
                    setError('');
                    setNotice('');
                  }}
                >
                  Edit brand
                </button>
              </>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
