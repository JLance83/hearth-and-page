import { useEffect, useState } from 'react';

// StatusPage — the first real screen built on /app-v2/.
//
// Fetches /api/health and /api/pdf-runtime-check and displays them as human
// readable panels. Refreshes every 30s. Useful during launch/rollout as a
// real-time confidence panel instead of curling from a terminal.
//
// Doubles as the acceptance test for the /app-v2/ pipeline: if this page
// renders and successfully fetches from /api/*, the build → serve → route →
// same-origin API flow is all wired correctly.

type Health = {
  ok: boolean;
  time: string;
  db: 'ok' | 'skipped' | string;
  keyRole: string;
  commit: string;
  commitShort: string;
  startTime: string;
  uptimeSec: number;
  node: string;
  version: string;
};

type PdfCheck = {
  ok: boolean;
  pypdfVersion?: string;
  pypdfPath?: string;
  durationMs?: number;
  error?: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [pdfCheck, setPdfCheck] = useState<PdfCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [h, p] = await Promise.all([
          fetchJson<Health>('/api/health'),
          fetchJson<PdfCheck>('/api/pdf-runtime-check'),
        ]);
        if (cancelled) return;
        setHealth(h);
        setPdfCheck(p);
        setError(null);
        setLastRefresh(new Date());
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Production status</h1>
        <p className="mt-1 text-sm text-hp-muted">
          Live view of{' '}
          <code className="rounded bg-white px-1 py-0.5 text-xs">/api/health</code>{' '}
          and{' '}
          <code className="rounded bg-white px-1 py-0.5 text-xs">
            /api/pdf-runtime-check
          </code>
          . Refreshes every 30s.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-medium">Failed to load status</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="API health" ok={health?.ok}>
          {health ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Row label="Version" value={health.version} />
              <Row label="Commit" value={<code className="font-mono">{health.commitShort}</code>} />
              <Row label="Uptime" value={formatUptime(health.uptimeSec)} />
              <Row label="Node" value={health.node} />
              <Row label="DB" value={<StatusPill status={health.db} />} />
              <Row label="Key role" value={health.keyRole} />
            </dl>
          ) : (
            <SkeletonRows n={6} />
          )}
        </Panel>

        <Panel title="PDF runtime" ok={pdfCheck?.ok}>
          {pdfCheck ? (
            pdfCheck.ok ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Row label="pypdf" value={pdfCheck.pypdfVersion ?? '—'} />
                <Row
                  label="Duration"
                  value={pdfCheck.durationMs != null ? `${pdfCheck.durationMs}ms` : '—'}
                />
                <Row
                  label="Path"
                  value={
                    <code className="font-mono text-xs break-all">
                      {pdfCheck.pypdfPath ?? '—'}
                    </code>
                  }
                />
              </dl>
            ) : (
              <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <div className="font-medium">pypdf load failed</div>
                <div className="mt-1 font-mono text-xs">{pdfCheck.error ?? 'unknown error'}</div>
              </div>
            )
          ) : (
            <SkeletonRows n={3} />
          )}
        </Panel>
      </div>

      <div className="text-xs text-hp-muted">
        Last refreshed {lastRefresh.toLocaleTimeString()} — auto-refreshes every 30s.
      </div>
    </div>
  );
}

function Panel({
  title,
  ok,
  children,
}: {
  title: string;
  ok?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-hp-border bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-hp-ink">{title}</h2>
        {ok !== undefined && (
          <span
            className={
              'rounded-full px-2 py-0.5 text-xs font-medium ' +
              (ok
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-red-100 text-red-800')
            }
          >
            {ok ? 'ok' : 'degraded'}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-hp-muted">{label}</dt>
      <dd className="text-hp-ink">{value}</dd>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const positive = status === 'ok';
  return (
    <span
      className={
        'rounded-full px-2 py-0.5 text-xs font-medium ' +
        (positive
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-amber-100 text-amber-800')
      }
    >
      {status}
    </span>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="mt-3 space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-4 w-full animate-pulse rounded bg-hp-border" />
      ))}
    </div>
  );
}
