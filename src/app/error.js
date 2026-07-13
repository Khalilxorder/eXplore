'use client';

export default function RootError({ error, reset }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        background: '#f8fafd',
        color: '#122033',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          width: 'min(520px, 100%)',
          background: '#ffffff',
          border: '1px solid #d6dfeb',
          borderRadius: '24px',
          padding: '32px',
          boxShadow: '0 24px 80px rgba(18, 32, 51, 0.08)',
        }}
      >
        <p style={{ margin: 0, fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5d7698' }}>
          Light mode only
        </p>
        <h1 style={{ margin: '12px 0 10px', fontSize: '34px', lineHeight: 1.05 }}>
          Something went wrong.
        </h1>
        <p style={{ margin: 0, color: '#4a607c', lineHeight: 1.6 }}>
          eXplore hit an unexpected error on this screen. Try the page again.
        </p>
        {error?.message ? (
          <p style={{ marginTop: '14px', color: '#5d7698', lineHeight: 1.5 }}>
            {error.message}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: '20px',
            padding: '12px 16px',
            borderRadius: '999px',
            border: 'none',
            background: '#1851b0',
            color: '#ffffff',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

