"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { RankingsPage } from "@/lib/api";
import { RatingBadge, ScoreBadge, FlagPill } from "@/components/Badge";

const fmtFrac = (v?: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}%`;

interface Props {
  rows: RankingsPage["rows"];
  total: number;
  page: number;
  pageSize: number;
  sectors: string[];
  activeSector?: string;
  activeRating?: "BUY" | "HOLD" | "AVOID";
  activeInSlice?: boolean;
  activeQuery?: string;
}

export function RankingsTable({
  rows,
  total,
  page,
  pageSize,
  sectors,
  activeSector,
  activeRating,
  activeInSlice,
  activeQuery,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [queryDraft, setQueryDraft] = useState(activeQuery ?? "");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const setParam = (key: string, value?: string | null, resetPage = true) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (value == null || value === "") sp.delete(key);
    else sp.set(key, value);
    if (resetPage) sp.delete("page");
    start(() => router.push(`/rankings?${sp.toString()}`));
  };

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParam("q", queryDraft);
  };

  const filtersActive =
    activeSector || activeRating || activeInSlice != null || activeQuery;

  const sliceLabel = useMemo(() => {
    if (activeInSlice === true) return "narrated only";
    if (activeInSlice === false) return "tail only";
    return "all";
  }, [activeInSlice]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <form onSubmit={onSearch} className="flex items-end gap-2">
          <label className="block">
            <span className="text-xs text-slate-400 uppercase tracking-wide">
              Search
            </span>
            <input
              type="search"
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              placeholder="ticker or company"
              className="mt-1 block w-56 rounded-md bg-ink-700 border border-ink-600 px-3 py-1.5 text-sm placeholder-slate-500"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-accent-500/20 hover:bg-accent-500/30 border border-accent-500/40 text-accent-500 text-xs font-semibold px-3 py-1.5"
          >
            Apply
          </button>
        </form>

        <label className="block">
          <span className="text-xs text-slate-400 uppercase tracking-wide">
            Sector
          </span>
          <select
            value={activeSector ?? ""}
            onChange={(e) => setParam("sector", e.target.value || null)}
            className="mt-1 block rounded-md bg-ink-700 border border-ink-600 px-3 py-1.5 text-sm min-w-[180px]"
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-slate-400 uppercase tracking-wide">
            Rating
          </span>
          <select
            value={activeRating ?? ""}
            onChange={(e) => setParam("rating", e.target.value || null)}
            className="mt-1 block rounded-md bg-ink-700 border border-ink-600 px-3 py-1.5 text-sm"
          >
            <option value="">Any</option>
            <option value="BUY">BUY</option>
            <option value="HOLD">HOLD</option>
            <option value="AVOID">AVOID</option>
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-slate-400 uppercase tracking-wide">
            Reasoning slice
          </span>
          <select
            value={
              activeInSlice == null ? "" : activeInSlice ? "true" : "false"
            }
            onChange={(e) => setParam("in_slice", e.target.value || null)}
            className="mt-1 block rounded-md bg-ink-700 border border-ink-600 px-3 py-1.5 text-sm"
          >
            <option value="">All names</option>
            <option value="true">In slice (narrated)</option>
            <option value="false">Tail only</option>
          </select>
        </label>

        {filtersActive && (
          <button
            onClick={() => start(() => router.push("/rankings"))}
            className="ml-auto text-xs text-slate-400 hover:text-white"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="text-xs text-slate-500">
        Showing <span className="text-slate-300">{rows.length}</span> of{" "}
        <span className="text-slate-300">{total}</span> ({sliceLabel})
        {pending && <span className="ml-2 text-accent-500">…</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-400 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-2 py-2">Rank</th>
              <th className="px-2 py-2">Ticker</th>
              <th className="px-2 py-2">Company</th>
              <th className="px-2 py-2">Sector</th>
              <th className="px-2 py-2">Rating</th>
              <th className="px-2 py-2">Signal</th>
              <th className="px-2 py-2 hidden md:table-cell">Market</th>
              <th className="px-2 py-2 hidden md:table-cell">News</th>
              <th className="px-2 py-2 hidden md:table-cell">Fundamentals</th>
              <th className="px-2 py-2 hidden md:table-cell">Alt-data</th>
              <th className="px-2 py-2 hidden lg:table-cell">Conviction</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-6 text-center text-slate-500" colSpan={11}>
                  No companies match these filters.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const inSlice = row.in_reasoning_slice !== false;
              return (
                <tr
                  key={row.ticker}
                  className="border-t border-ink-600 hover:bg-ink-700/40"
                >
                  <td className="px-2 py-2 text-slate-500">
                    {row.rank ?? "—"}
                  </td>
                  <td className="px-2 py-2 font-mono">
                    <Link
                      href={`/ticker/${row.ticker}`}
                      className="text-accent-500 hover:underline"
                    >
                      {row.ticker}
                    </Link>
                    {!inSlice && (
                      <span className="ml-1 text-[10px] text-slate-500" title="Outside reasoning slice">
                        ·
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 max-w-[18rem] truncate text-slate-300">
                    {row.company_name ?? "—"}
                  </td>
                  <td className="px-2 py-2">
                    {row.sector ? (
                      <FlagPill label={row.sector} />
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <RatingBadge rating={row.rating} />
                  </td>
                  <td className="px-2 py-2">
                    <ScoreBadge score={row.signal_score} />
                  </td>
                  <td className="px-2 py-2 hidden md:table-cell">
                    {row.market_score?.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 hidden md:table-cell">
                    {row.news_score?.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 hidden md:table-cell">
                    {row.fundamental_score?.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 hidden md:table-cell">
                    {row.alt_score?.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 hidden lg:table-cell text-slate-300">
                    {row.conviction ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>
          Page <span className="text-slate-200">{page}</span> of{" "}
          <span className="text-slate-200">{totalPages}</span>
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setParam("page", String(Math.max(1, page - 1)), false)}
            disabled={page <= 1}
            className="px-3 py-1 rounded-md bg-ink-700 border border-ink-600 disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            onClick={() =>
              setParam("page", String(Math.min(totalPages, page + 1)), false)
            }
            disabled={page >= totalPages}
            className="px-3 py-1 rounded-md bg-ink-700 border border-ink-600 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
