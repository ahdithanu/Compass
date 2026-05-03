import { api } from "@/lib/api";
import { Card } from "@/components/Card";
import { RankingsTable } from "@/components/RankingsTable";

export const dynamic = "force-dynamic";

interface Search {
  sector?: string;
  rating?: string;
  in_slice?: string;
  q?: string;
  page?: string;
}

const PAGE_SIZE = 50;

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const sector = searchParams.sector || undefined;
  const rating =
    searchParams.rating === "BUY" ||
    searchParams.rating === "HOLD" ||
    searchParams.rating === "AVOID"
      ? (searchParams.rating as "BUY" | "HOLD" | "AVOID")
      : undefined;
  const inSlice =
    searchParams.in_slice === "true"
      ? true
      : searchParams.in_slice === "false"
      ? false
      : undefined;
  const q = searchParams.q || undefined;

  const [universe, rankings] = await Promise.all([
    api.universe(),
    api.rankings({
      sector,
      rating,
      in_slice: inSlice,
      q,
      limit: PAGE_SIZE,
      offset,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Company rankings</h1>
        <p className="text-sm text-slate-400 mt-1">
          {universe.size > 0
            ? `Composite signal score across ${universe.size} ${universe.universe.toUpperCase()} constituents.`
            : "Composite signal score per ticker."}{" "}
          {universe.funnel_top_n != null && universe.size > 0 ? (
            <>
              The LangChain reasoning agents wrote a thesis + outbound angle for
              the top{" "}
              <span className="text-slate-200 font-semibold">
                {universe.funnel_top_n}
              </span>{" "}
              of these. Rows outside the slice show quant scores only.
            </>
          ) : null}
        </p>
      </div>

      <Card>
        <RankingsTable
          rows={rankings.rows}
          total={rankings.total}
          page={page}
          pageSize={PAGE_SIZE}
          sectors={universe.sectors}
          activeSector={sector}
          activeRating={rating}
          activeInSlice={inSlice}
          activeQuery={q}
        />
      </Card>
    </div>
  );
}
