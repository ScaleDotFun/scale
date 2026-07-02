import { useState, useCallback } from 'react';
import { useApi } from './useApi';
import * as api from '../lib/api';

/** Hook for token data: listed tokens, trending, search, and selection. */
export function useTokens() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<api.TokenInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedToken, setSelectedToken] = useState<api.TokenInfo | null>(null);

  // Fetch listed tokens (always available)
  const listedResult = useApi<api.TokenInfo[]>(
    () => api.getListedTokens(15),
    [],
  );

  // Fetch trending tokens (may be empty if no recent volume)
  const trendingResult = useApi<api.TokenInfo[]>(
    () => api.getTrendingTokens(),
    [],
  );

  const listed = listedResult.data ?? [];
  const trendingRaw = trendingResult.data ?? [];

  // Use trending if available, otherwise fall back to listed
  const trending = trendingRaw.length > 0 ? trendingRaw : listed;

  const search = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await api.searchTokens(query);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const selectToken = useCallback((token: api.TokenInfo) => {
    setSelectedToken(token);
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedToken(null);
  }, []);

  return {
    searchQuery,
    searchResults,
    isSearching,
    selectedToken,
    listed,
    trending,
    trendingLoading: trendingResult.loading || listedResult.loading,
    search,
    selectToken,
    clearSelection,
  };
}
