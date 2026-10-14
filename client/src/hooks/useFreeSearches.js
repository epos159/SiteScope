import { useCallback, useState } from 'react';

export const FREE_SEARCH_LIMIT = 5;

const STORAGE_KEY = 'sitescope.freeSearches.v1';

function readCountedParcels() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Free searches for signed-out visitors, tracked in the browser.
 * Only searches that load a parcel count, and re-opening the same parcel is free.
 */
export function useFreeSearches() {
  const [countedParcels, setCountedParcels] = useState(readCountedParcels);

  const recordSearch = useCallback(parcelKey => {
    setCountedParcels(prev => {
      if (!parcelKey || prev.includes(parcelKey)) return prev;
      const next = [...prev, parcelKey];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private browsing can block storage; the count just won't persist.
      }
      return next;
    });
  }, []);

  const hasSearched = useCallback(parcelKey => countedParcels.includes(parcelKey), [countedParcels]);

  return {
    used: countedParcels.length,
    remaining: Math.max(0, FREE_SEARCH_LIMIT - countedParcels.length),
    recordSearch,
    hasSearched,
  };
}
