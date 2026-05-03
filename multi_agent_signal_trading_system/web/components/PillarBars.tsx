"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import type { CompanyScoreRow } from "@/lib/api";

const PILLAR_COLORS: Record<string, string> = {
  market_score: "#7dd3fc",
  news_score: "#fbbf24",
  fundamental_score: "#a78bfa",
  alt_score: "#5eead4",
};

export function PillarBars({ row }: { row: CompanyScoreRow }) {
  const data = [
    { pillar: "Market", value: row.market_score, key: "market_score" },
    { pillar: "News", value: row.news_score, key: "news_score" },
    { pillar: "Fundamentals", value: row.fundamental_score, key: "fundamental_score" },
    { pillar: "Alt-data", value: row.alt_score, key: "alt_score" },
  ];
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="#1f2632" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 1]}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickFormatter={(v) => v.toFixed(1)}
          />
          <YAxis
            type="category"
            dataKey="pillar"
            tick={{ fontSize: 12, fill: "#cbd5e1" }}
            width={100}
          />
          <Tooltip
            contentStyle={{ background: "#171c25", border: "1px solid #2b3340" }}
            formatter={(value: number) => [value.toFixed(2), "Score (0-1)"]}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]}>
            {data.map((d) => (
              <Cell key={d.key} fill={PILLAR_COLORS[d.key]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
