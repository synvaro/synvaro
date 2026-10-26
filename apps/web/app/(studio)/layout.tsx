import { currentOrganization } from '../../lib/organization-brand';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth';
import { Logout } from '../logout';

export const dynamic = 'force-dynamic';
export default async function AuthenticatedStudio({
  children,
}: {
  children: ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const organization = await currentOrganization();
  return (
    <>
      <div className="session-bar">
        <div>
          <strong>{organization?.name ?? 'Set up your organization'}</strong>
          <br />
          <span>Signed in as {user.email}</span>
        </div>
        <Logout />
      </div>
      {children}
    </>
  );
}
