import { notFound } from 'next/navigation';

const sections = {
  calendar: {
    title: 'Calendar',
    empty: 'Room for what comes next.',
    description:
      'Content planning and scheduling are planned. No publications can be scheduled in this preview.',
    icon: '▦',
  },
  media: {
    title: 'Media',
    empty: 'A place for your visual stories.',
    description:
      'A media library is planned. Uploads and asset management are not available yet.',
    icon: '▧',
  },
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

export default async function Section({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!Object.hasOwn(sections, section)) notFound();
  const item = sections[section as keyof typeof sections];
  return (
    <>
      <p className="eyebrow">YOUR STUDIO</p>
      <h1>{item.title}</h1>
      <section className="empty-state" aria-labelledby="empty-title">
        <div className="empty-icon" aria-hidden="true">
          {item.icon}
        </div>
        <span className="badge">Coming later</span>
        <h2 id="empty-title">{item.empty}</h2>
        <p>{item.description}</p>
      </section>
    </>
  );
}
