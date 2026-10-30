import { OAuthReturn } from './return';

export default async function SocialOAuthReturn({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; attempt?: string }>;
}) {
  const { brand, attempt } = await searchParams;
  const valid = /^[0-9a-f-]{36}$/i;
  const destination =
    brand && attempt && valid.test(brand) && valid.test(attempt)
      ? `/brands/${brand}/social-accounts?attempt=${attempt}`
      : '/brands?social=error';
  return <OAuthReturn destination={destination} />;
}
