import Link from 'next/link';

export default function Home() {
  return (
    <>
      <p className="eyebrow">YOUR CREATIVE WORKSPACE</p>
      <h1>A clear space for your next idea.</h1>
      <p className="intro">
        Welcome to SYNVARO, an open-source studio for AI-assisted social
        content.
      </p>
      <section className="empty-state" aria-labelledby="welcome-title">
        <div className="empty-icon" aria-hidden="true">
          ✦
        </div>
        <span className="badge">SYN-001 · Foundation</span>
        <h2 id="welcome-title">The foundation is here.</h2>
        <p>
          Explore the studio layout. Brand management, content creation,
          scheduling and media uploads are planned and are not available yet.
        </p>
        <Link className="button" href="/brands">
          Explore the studio <span aria-hidden="true">→</span>
        </Link>
      </section>
      <p className="footnote">
        Human approval will stay at the heart of publishing.
      </p>
    </>
  );
}
