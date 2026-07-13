'use client';

import { openExternalUrl } from '../lib/external';

const SCIENTIST_TOOL_URL = process.env.NEXT_PUBLIC_SCIENTIST_TOOL_URL || 'https://scientist-tool.vercel.app';

export default function ScientistToolScreen() {
  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0' }}>
      <div className="container page-shell scientist-tool-shell">
        <section className="scientist-tool-card">
          <div>
            <p className="eyebrow" style={{ marginBottom: '8px' }}>Scientist Tool</p>
            <h2 style={{ font: 'var(--font-h2)', margin: 0 }}>Research workspace</h2>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void openExternalUrl(SCIENTIST_TOOL_URL)}
          >
            Open Scientist Tool
          </button>
        </section>
      </div>
    </div>
  );
}
