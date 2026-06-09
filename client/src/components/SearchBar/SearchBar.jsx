import React, { useState } from 'react';
import './SearchBar.css';

export default function SearchBar({ onSearch, isLoading }) {
  const [value, setValue] = useState('');

  const handleSubmit = e => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed && !isLoading) onSearch(trimmed);
  };

  const handleKeyDown = e => {
    if (e.key === 'Enter') handleSubmit(e);
  };

  return (
    <form className="search-bar" onSubmit={handleSubmit} role="search">
      <div className="search-bar-icon">
        {isLoading ? (
          <span className="search-bar-spinner" aria-label="Searching" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        )}
      </div>

      <input
        className="search-bar-input"
        type="text"
        placeholder="Search a Pennsylvania address…"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
        autoComplete="off"
        spellCheck={false}
        aria-label="Search address"
      />

      {value && (
        <button
          type="button"
          className="search-bar-clear"
          onClick={() => setValue('')}
          aria-label="Clear"
        >
          ×
        </button>
      )}

      <button
        type="submit"
        className="search-bar-btn"
        disabled={isLoading || !value.trim()}
        aria-label="Search"
      >
        {isLoading ? 'Searching…' : 'Search'}
      </button>
    </form>
  );
}
