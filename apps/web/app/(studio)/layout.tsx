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
  return (
    <>
      <div className="session-bar">
        <span>Signed in as {user.email}</span>
        <Logout />
      </div>
      {children}
    </>
  );
}
