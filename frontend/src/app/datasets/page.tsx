"use client";

import clsx from "clsx";
import { FileText } from "lucide-react";
import { useState } from "react";
import { Badge, ErrorState, Loading, PageHeader, Panel, PanelHeader, Segmented, Table, Td, Th } from "@/components/ui";
import type { Dataset, DatasetSummary } from "@/lib/api";
import { useApi } from "@/lib/hooks";

export default function DatasetsPage() {
  const { data: datasets, error } = useApi<DatasetSummary[]>("/datasets");
  const [selected, setSelected] = useState<string>("sample_dataset");
  const { data: dataset } = useApi<Dataset>(selected ? `/datasets/${selected}` : null);
  const [tab, setTab] = useState<"samples" | "documents">("samples");
  const [category, setCategory] = useState<string>("all");

  if (error) return <ErrorState error={error} />;
  if (!datasets) return <Loading />;
  const samples = dataset?.samples.filter((s) => category === "all" || s.category === category) ?? [];
  const summary = datasets.find((d) => d.name === selected);

  return (
    <>
      <PageHeader
        title="Evaluation Datasets"
        subtitle={
          <>
            A dataset is a document corpus plus questions with reference answers and relevance labels. Add one with{" "}
            <code className="rounded bg-white/5 px-1 text-xs">POST /datasets</code>.
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-3">
          <PanelHeader title="Datasets" />
          <ul className="space-y-1.5">
            {datasets.map((d) => (
              <li key={d.name}>
                <button
                  onClick={() => setSelected(d.name)}
                  className={clsx(
                    "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    selected === d.name ? "border-accent/30 bg-accent/10" : "border-transparent hover:bg-white/[0.03]",
                  )}
                >
                  <div className="text-sm font-medium text-text">{d.name}</div>
                  <div className="text-xs text-text-2">
                    {d.documents} docs · {d.samples} questions
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="p-0 lg:col-span-9">
          {!dataset ? (
            <Loading />
          ) : (
            <>
              <div className="border-b border-border p-5">
                <h2 className="text-base font-semibold text-text">{dataset.name}</h2>
                <p className="mt-1 text-sm text-text-2">{dataset.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {summary?.categories.map((c) => (
                    <Badge key={c} tone="accent">
                      {c} · {dataset.samples.filter((s) => s.category === c).length}
                    </Badge>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <div className="w-64">
                    <Segmented
                      value={tab}
                      onChange={setTab}
                      options={[
                        { value: "samples", label: `Questions (${dataset.samples.length})` },
                        { value: "documents", label: `Documents (${dataset.documents.length})` },
                      ]}
                    />
                  </div>
                  {tab === "samples" && (
                    <select
                      className="rounded-lg border border-border-strong bg-bg-elevated px-3 text-xs text-text"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      aria-label="Filter by category"
                    >
                      <option value="all">All categories</option>
                      {summary?.categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {tab === "samples" ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>ID</Th>
                      <Th>Question</Th>
                      <Th>Reference answer</Th>
                      <Th>Relevant docs</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {samples.map((s) => (
                      <tr key={s.id} className="align-top">
                        <Td className="text-xs text-muted">{s.id}</Td>
                        <Td className="max-w-[300px] whitespace-normal">
                          {s.question}
                          {s.category && <div className="mt-1 text-[11px] capitalize text-muted">{s.category}</div>}
                        </Td>
                        <Td className="max-w-[340px] whitespace-normal text-text-2">{s.reference_answer}</Td>
                        <Td className="text-xs text-text-2">{s.relevant_doc_ids.join(", ")}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <ul className="divide-y divide-border">
                  {dataset.documents.map((d) => (
                    <li key={d.id} className="p-5">
                      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-text">
                        <FileText size={14} className="text-accent" /> {d.title}
                        <span className="text-xs font-normal text-muted">{d.id}</span>
                      </div>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-text-2">{d.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
