import ReactMarkdown from "react-markdown";
import { api } from "@/lib/api";
import { Card } from "@/components/Card";

export default async function MemoPage() {
  const md = await api.memo();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Weekly investment memo</h1>
        <p className="text-sm text-slate-400 mt-1">
          Reviewer-ready output of the ThesisAgent + ReportingAgent.
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
