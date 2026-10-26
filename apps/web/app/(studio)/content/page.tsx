import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentBrands } from '../../../lib/organization-brand';
import { drafts } from '../../../lib/content';
import { BrandSelector } from './selector';
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string | string[] }>;
}) {
  const brands = await currentBrands();
  const { brandId } = await searchParams;
  const selected = brands.find((brand) => brand.id === brandId);
  if (brandId && !selected) notFound();
  const contents = selected ? await drafts(selected.id) : [];
  return (
    <>
      <p className="eyebrow">YOUR STUDIO</p>
      <h1>Content</h1>
      <p className="intro">
        Write and save manual drafts for your brands. Nothing here is published.
      </p>
      {brands.length === 0 ? (
        <section className="empty-state">
          <h2>Create a brand first</h2>
          <p>Drafts belong to a brand.</p>
          <Link className="auth-link" href="/brands">
            Go to Brands
          </Link>
        </section>
      ) : (
        <>
          <BrandSelector
            brands={brands.map(({ id, name }) => ({ id, name }))}
            selected={selected?.id ?? ''}
          />
          {selected ? (
            <>
              <div className="brands-heading">
                <h2 className="content-brand-name">{selected.name}</h2>
                <Link
                  className="button"
                  href={`/content/new?brandId=${selected.id}`}
                >
                  Create Draft
                </Link>
              </div>
              {contents.length === 0 ? (
                <section className="empty-state">
                  <h2>No drafts yet</h2>
                  <p>Create your first draft for {selected.name}.</p>
                </section>
              ) : (
                <ul className="draft-list">
                  {contents.map((content) => (
                    <li className="brand-card" key={content.id}>
                      <span className="badge">{content.status}</span>
                      <h2>
                        <Link
                          className="auth-link"
                          href={`/content/${content.id}`}
                        >
                          {content.title}
                        </Link>
                      </h2>
                      <p className="draft-date">
                        Updated{' '}
                        <time dateTime={content.updatedAt}>
                          {new Date(content.updatedAt)
                            .toISOString()
                            .replace('T', ' ')
                            .slice(0, 16)}{' '}
                          UTC
                        </time>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <section className="empty-state">
              <h2>Select a brand</h2>
              <p>Choose which brand’s drafts you want to manage.</p>
            </section>
          )}
        </>
      )}
    </>
  );
}
