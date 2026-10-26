'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/brands', label: 'Brands', icon: '◈' },
  { href: '/content', label: 'Content', icon: '▤' },
  { href: '/calendar', label: 'Calendar', icon: '▦' },
  { href: '/media', label: 'Media', icon: '▧' },
];

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Studio navigation">
      {links.map(({ href, label, icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? 'page' : undefined}
        >
          <span aria-hidden="true">{icon}</span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
