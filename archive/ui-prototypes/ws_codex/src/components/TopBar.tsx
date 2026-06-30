import { RefreshCcw, Search } from "lucide-react";

type Props = {
  query: string;
  onQueryChange: (query: string) => void;
  onlineCount: number;
  totalCount: number;
  onRefresh: () => void;
};

export function TopBar({ query, onQueryChange, onlineCount, totalCount, onRefresh }: Props) {
  return (
    <header className="topbar">
      <div>
        <h1>Servers</h1>
        <p>
          {onlineCount} of {totalCount} hosts reachable
        </p>
      </div>

      <div className="topbar-actions">
        <label className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search hosts or services"
            type="search"
          />
        </label>
        <button className="icon-button" onClick={onRefresh} title="Refresh status" type="button">
          <RefreshCcw size={17} />
        </button>
      </div>
    </header>
  );
}
