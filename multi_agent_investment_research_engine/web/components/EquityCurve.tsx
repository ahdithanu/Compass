"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Point {
  date: string;
  value: number;
}

export function EquityCurve({ data }: { data: Point[] }) {
  if (!data || data.length === 0) return null;
  const start = data[0].value || 1;
  const norm = data.map((d) => ({ date: d.date, indexed: d.value / start }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={norm} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#1f2632" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickFormatter={(d) => d.slice(2, 7)}
            minTickGap={28}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickFormatter={(v) => v.toFixed(2) + "x"}
            domain={["auto", "auto"]}
            width={48}
          />
          <Tooltip
            contentStyle={{ background: "#171c25", border: "1px solid #2b3340" }}
            labelStyle={{ color: "#cbd5e1" }}
            formatter={(value: number) => [value.toFixed(3) + "x", "Indexed"]}
          />
          <Line
            type="monotone"
            dataKey="indexed"
            stroke="#5eead4"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
