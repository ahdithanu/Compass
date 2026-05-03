import ReactMarkdown from "react-markdown";
import { api } from "@/lib/api";
import { Card } from "@/components/Card";

export default async function OutboundPage() {
  const md = await api.outbound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Outbound angles</h1>
        <p className="text-sm text-slate-400 mt-1">
          The same retrieved evidence the investment memo used, re-framed as
          GTM triggers. This is what shows the system supports both
          investing AND outbound.
        </p>
      </div>
      <Card>
        <article className="markdown-body max-w-none">
          <ReactMarkdown>{md}</ReactMarkdown>
        </article>
      </Card>
    </div>
  );
}
