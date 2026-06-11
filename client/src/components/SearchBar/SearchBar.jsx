import React, { useState, useEffect, useRef, useCallback } from 'react';
import { suggestAddresses } from '../../services/api';
import './SearchBar.css';

export default function SearchBar({ onSearch, isLoading }) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  const runSearch = useCallback(
    address => {
      const trimmed = address.trim();
      if (!trimmed || isLoading) return;
      setOpen(false);
      setSuggestions([]);
      setActiveIndex(-1);
      onSearch(trimmed);
    },
    [isLoading, onSearch]
  );

  const handleSubmit = e => {
    e.preventDefault();
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      const picked = suggestions[activeIndex].address;
      setValue(picked);
      runSearch(picked);
      return;
    }
    runSearch(value);
  };

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return undefined;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const data = await suggestAddresses(trimmed);
        setSuggestions(data.suggestions || []);
        setOpen((data.suggestions || []).length > 0);
        setActiveIndex(-1);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 280);

    return () => clearTimeout(debounceRef.current);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = e => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = e => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter') handleSubmit(e);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    } else if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  const pickSuggestion = address => {
    setValue(address);
    runSearch(address);
  };

  return (
    <div className="search-bar-wrapper" ref={wrapperRef}>
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
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          disabled={isLoading}
          autoComplete="off"
          spellCheck={false}
          aria-label="Search address"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="address-suggestions"
        />

        {value && (
          <button
            type="button"
            className="search-bar-clear"
            onClick={() => {
              setValue('');
              setSuggestions([]);
              setOpen(false);
            }}
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

      {open && suggestions.length > 0 && (
        <ul className="search-suggestions" id="address-suggestions" role="listbox">
          {suggestions.map((item, i) => (
            <li key={`${item.address}-${i}`} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                className={`search-suggestion-item${i === activeIndex ? ' active' : ''}`}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pickSuggestion(item.address)}
              >
                <span className="search-suggestion-address">{item.address}</span>
                {item.source === 'york' && (
                  <span className="search-suggestion-tag">York GIS</span>
                )}
              </button>
            </li>
          ))}
          {loadingSuggestions && (
            <li className="search-suggestion-loading">Loading…</li>
          )}
        </ul>
      )}
    </div>
  );
}
