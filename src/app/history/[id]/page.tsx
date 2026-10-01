import { Tracker } from "@/ui/tracker";
export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Tracker screen="history" sessionId={id} />;
}
