import React from 'react';
import './DataPanel.css';

function CardRetryButton({ label, onRetry }) {
  return (
    <button
      type="button"
      className="data-card-retry"
      onClick={onRetry}
      aria-label={`Retry ${label}`}
      title={`Retry ${label}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <polyline points="21 3 21 9 15 9" />
      </svg>
    </button>
  );
}

export default React.memo(CardRetryButton);
