import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { suggestAddresses } from '../../services/api';
import { toTitleCase, formatCountyMatchLabel } from '../../utils/format';
import './SearchBar.css';

function formatSuggestion(item) {
  return {
    ...item,
    address: toTitleCase(item.address),
    detail: [toTitleCase(item.municipality), item.countyName].filter(Boolean).join(', '),
    label: formatCountyMatchLabel(item),
  };
}

export default function SearchBar({ onSearch, onCancel, isLoading }) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);
  const suggestAbortRef = useRef(null);
  const skipSuggestRef = useRef(false);

  const closeSuggestions = useCallback(() => {
    clearTimeout(debounceRef.current);
    suggestAbortRef.current?.abort();
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
    setLoadingSuggestions(false);
  }, []);

  const runSearch = useCallback(
    (address, match = null) => {
      const trimmed = address.trim();
      if (!trimmed) return;
      closeSuggestions();
      onSearch(trimmed, match);
    },
    [onSearch, closeSuggestions]
  );

  const pickSuggestion = useCallback(
    item => {
      skipSuggestRef.current = true;
      setValue(item.label);
      runSearch(item.label, item);
    },
    [runSearch]
  );

  const handleCancel = () => {
    closeSuggestions();
    onCancel?.();
  };

  const handleSubmit = e => {
    e.preventDefault();
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      pickSuggestion(suggestions[activeIndex]);
      return;
    }
    runSearch(value);
  };

  useEffect(() => {
    if (skipSuggestRef.current) {
      skipSuggestRef.current = false;
      return undefined;
    }

    const trimmed = value.trim();
    clearTimeout(debounceRef.current);
    suggestAbortRef.current?.abort();

    if (trimmed.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return undefined;
    }

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      setLoadingSuggestions(true);
      try {
        const data = await suggestAddresses(trimmed, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const items = (data.suggestions || []).map(formatSuggestion);
        setSuggestions(items);
        setOpen(items.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        if (axios.isCancel(err) || controller.signal.aborted) return;
        setSuggestions([]);
        setOpen(false);
      } finally {
        if (!controller.signal.aborted) setLoadingSuggestions(false);
      }
    }, 250);

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
              closeSuggestions();
              if (isLoading) handleCancel();
            }}
            aria-label="Clear"
          >
            ×
          </button>
        )}

        {isLoading ? (
          <button
            type="button"
            className="search-bar-btn search-bar-btn-cancel"
            onClick={handleCancel}
            aria-label="Cancel search"
          >
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            className="search-bar-btn"
            disabled={!value.trim()}
            aria-label="Search"
          >
            Search
          </button>
        )}
      </form>

      {open && suggestions.length > 0 && (
        <ul className="search-suggestions" id="address-suggestions" role="listbox">
          {suggestions.map((item, i) => (
            <li key={`${item.countyKey}-${item.parcelId}`} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                className={`search-suggestion-item${i === activeIndex ? ' active' : ''}`}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pickSuggestion(item)}
              >
                <span className="search-suggestion-address">{item.address}</span>
                {item.detail && (
                  <span className="search-suggestion-detail">{item.detail}</span>
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
