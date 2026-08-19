import { type FC, useState, useEffect, useRef } from 'react';
import type { TokenInfo } from '../lib/api';
import { formatAddress } from '../lib/format';

interface TokenSearchProps {
  onSelect: (token: TokenInfo) => void;
  onSearch: (query: string) => void;
  results: TokenInfo[];
  isSearching: boolean;
}

export const TokenSearch: FC<TokenSearchProps> = ({
  onSelect,
  onSearch,
  results,
  isSearching,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      onSearch('');
      return;
    }
    debounceRef.current = setTimeout(() => {
      onSearch(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, onSearch]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (token: TokenInfo) => {
    onSelect(token);
    setQuery('');
    setIsOpen(false);
  };

  return (
    <div className="token-search" ref={wrapperRef}>
      <span className="token-search-icon">&#x2315;</span>
      <input
        className="token-search-input"
        type="text"
        placeholder="Search tokens..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
      />
      {isOpen && query.trim() && (
        <div className="token-search-dropdown">
          {isSearching ? (
            <div className="empty-state" style={{ padding: '16px' }}>
              <span className="spinner" />
            </div>
          ) : results.length === 0 ? (
            <div className="empty-state" style={{ padding: '16px' }}>
              No tokens found
            </div>
          ) : (
            results.map((token) => (
              <div
                key={token.address}
                className="token-search-item"
                onClick={() => handleSelect(token)}
              >
                <div className="token-search-item-left">
                  <span className="token-search-item-name">{token.name}</span>
                  <span className="token-search-item-addr">
                    {formatAddress(token.address, 6)}
                  </span>
                </div>
                <span className="token-search-item-symbol">{token.symbol}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
