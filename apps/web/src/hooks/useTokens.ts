import { useState, useCallback } from 'react';
import { useApi } from './useApi';
import * as api from '../lib/api';

/** Hook for token data: search, trending, and selection. */
export function useTokens() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<api.TokenInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedToken, setSelectedToken] = useState<api.TokenInfo | null>({
    address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    name: 'dogwifhat',
    symbol: '$WIF',
    tier: 'bonded',
    tierLabel: 'Bonded',
    isActive: true,
    maxLeverage: 10,
  });

  const trendingResult = useApi<api.TokenInfo[]>(
    () => api.getTrendingTokens(),
    [],
  );

  const trending = trendingResult.data ?? [];

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
    trending,
    trendingLoading: trendingResult.loading,
    search,
    selectToken,
    clearSelection,
  };
}
