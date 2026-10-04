import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { PreviousPerformance } from "@/domain/training/previous-performance";
import { PreviousPerformanceView } from "./previous-performance";

it.each([
  ["WEIGHTED", "80.12500000000000000001 kg × 8 · RIR 2"],
  ["BODYWEIGHT", "BW × 8 · RIR 2"],
  ["ASSISTED_BODYWEIGHT", "Assist 80.12500000000000000001 kg × 8 · RIR 2"],
] as const)(
  "compact %s uses historical semantics and exact values",
  (loadType, text) => {
    const previous: PreviousPerformance = {
      sessionId: "s",
      sessionExerciseId: "e",
      trainingDay: "2026-09-28",
      loadType,
      sets: [
        {
          id: "1",
          position: 0,
          loadKg: loadType === "BODYWEIGHT" ? null : "80.12500000000000000001",
          reps: 8,
          rir: 2,
        },
        {
          id: "2",
          position: 2,
          loadKg: loadType === "BODYWEIGHT" ? null : "79",
          reps: 7,
          rir: null,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <PreviousPerformanceView previous={previous} unavailable={false} />,
    );
    expect(markup).toContain("Previous · Sep 28");
    expect(markup).toContain(text);
    expect(markup.match(/<li>/g)).toHaveLength(2);
    expect(markup.match(/RIR/g)).toHaveLength(1);
  },
);
it("no history is an explicit compact empty state", () => {
  expect(
    renderToStaticMarkup(
      <PreviousPerformanceView previous={null} unavailable={false} />,
    ),
  ).toContain("No previous performance");
});
it("failed lookup does not pretend history is empty or prevent logging", () => {
  const markup = renderToStaticMarkup(
    <PreviousPerformanceView previous={null} unavailable />,
  );
  expect(markup).toContain(
    "Previous performance unavailable. You can keep logging.",
  );
  expect(markup).not.toContain("No previous performance");
});
