"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Impact } from "@/lib/api";

function ImpactChart({ impact }: { impact: Impact | null }) {
  const data = Array.from({ length: 7 }, (_, i) => {
    const day = Math.floor(Date.now() / 86400000) - 6 + i;
    return {
      name: new Date(day * 86400000).toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      }),
      bottles: impact?.daily.find((d) => d.day === day)?.bottles || 0,
    };
  });
  return (
    <div
      className="chart"
      role="img"
      aria-label={`Bottles accepted in the last seven days: ${data.map((d) => `${d.name} ${d.bottles}`).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart
          data={data}
          margin={{ top: 15, right: 15, left: -25, bottom: 0 }}
        >
          <defs>
            <linearGradient id="impact-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a8c788" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#a8c788" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="4 4"
            vertical={false}
            stroke="#e8ece7"
          />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "#7b857e" }}
            dy={8}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "#7b857e" }}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid #dce4db" }}
          />
          <Area
            type="monotone"
            dataKey="bottles"
            stroke="#3b795d"
            strokeWidth={3}
            fill="url(#impact-fill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ImpactChart;
