import { Link, Route, Routes } from 'react-router-dom';
import StatusPage from './pages/StatusPage';

// Root component. This is the shell — thin nav bar + <Routes> for the pages
// mounted under /app-v2/*. New feature routes get added here.
export default function App() {
  return (
    <div className="min-h-screen bg-hp-surface text-hp-ink font-sans">
      <header className="border-b border-hp-border bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-lg font-semibold text-hp-primary">
            Hearth &amp; Page
            <span className="ml-2 text-xs font-normal text-hp-muted uppercase tracking-wide">
              v2 preview
            </span>
          </Link>
          <a
            href="/"
            className="text-sm text-hp-muted hover:text-hp-ink"
            title="Go back to the main app"
          >
            ← Main app
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Routes>
          <Route path="/" element={<StatusPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="mx-auto max-w-5xl px-6 py-6 text-xs text-hp-muted">
        <p>
          This is the v2 preview surface. Feature parity with the legacy app is a
          non-goal here — this is where new UI is built. See project note "Path C
          hybrid" for context.
        </p>
      </footer>
    </div>
  );
}

function NotFound() {
  return (
    <div className="rounded-lg border border-hp-border bg-white p-8 text-center">
      <h1 className="text-2xl font-semibold text-hp-ink">Not found</h1>
      <p className="mt-2 text-hp-muted">
        This route doesn't exist under /app-v2/.
      </p>
      <Link
        to="/"
        className="mt-4 inline-block rounded-md bg-hp-primary px-4 py-2 text-sm text-white hover:bg-hp-accent"
      >
        Back to status
      </Link>
    </div>
  );
}
