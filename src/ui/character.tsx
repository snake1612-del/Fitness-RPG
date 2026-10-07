"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LevelProgress } from "@/domain/gamification/xp";
import { api, ApiError } from "./api";
import {
  characterMilestone,
  milestones,
  type Milestone,
} from "./character-milestones";

const stageNames: Record<Milestone, string> = {
  1: "Foundation",
  3: "Form",
  5: "Momentum",
  10: "Resolve",
  20: "Mastery",
};

function Emblem({ stage }: { stage: Milestone }) {
  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      aria-hidden="true"
      className="character-emblem"
    >
      <circle cx="100" cy="100" r="82" className="emblem-orbit" />
      {stage >= 3 && (
        <circle cx="100" cy="100" r="70" className="emblem-orbit" />
      )}
      {stage >= 5 && (
        <path d="M100 28 172 100 100 172 28 100Z" className="emblem-frame" />
      )}
      {stage >= 10 && (
        <path
          d="m32 76 18 24-18 24M168 76l-18 24 18 24M42 56l18 22M158 56l-18 22"
          className="emblem-detail"
        />
      )}
      {stage >= 20 && (
        <path
          d="M57 151Q17 110 43 61M143 151q40-41 14-90M37 87 24 76M34 106l-16-4M41 128l-15 4M163 87l13-11M166 106l16-4M159 128l15 4M91 24l9-10 9 10"
          className="emblem-detail"
        />
      )}
      <path d="M100 54 137 77v46l-37 23-37-23V77Z" className="emblem-core" />
      <path
        d="m82 106 18-30 18 30M88 97h24M100 110v17"
        className="emblem-mark"
      />
      {stage >= 3 && <path d="M81 137h38" className="emblem-detail" />}
    </svg>
  );
}

export function CharacterView({ data }: { data: LevelProgress }) {
  const { current, next } = characterMilestone(data.level);
  return (
    <div className="character-content" data-stage={current}>
      <section className="card character-hero" aria-label="Your Character">
        <p className="eyebrow">{stageNames[current]}</p>
        <div className="character-art">
          <Emblem stage={current} />
        </div>
        <p className="character-level">Level {data.level}</p>
        <p className="character-total">
          <strong>{data.totalXp}</strong> Total XP
        </p>
        <div className="character-progress">
          <div className="section-heading">
            <span>To Level {data.level + 1}</span>
            <strong>
              {data.xpIntoLevel} / {data.xpForNextLevel} XP
            </strong>
          </div>
          <progress
            aria-label="Progress to next Level"
            value={data.xpIntoLevel}
            max={data.xpForNextLevel}
          />
          <p>{data.xpRemaining} XP remaining</p>
        </div>
        {data.totalXp === 0 && (
          <p className="hint">
            Your journey starts here. Finish a workout to build your XP.
          </p>
        )}
      </section>
      <section className="card" aria-label="Visual milestones">
        <dl className="character-milestone-detail">
          <div>
            <dt>Current milestone</dt>
            <dd>
              Level {current} · {stageNames[current]}
            </dd>
          </div>
          <div>
            <dt>Next milestone</dt>
            <dd>
              {next === null
                ? "Final visual stage reached"
                : `Level ${next} · ${stageNames[next]}`}
            </dd>
          </div>
        </dl>
        <ol className="character-milestones" aria-label="Milestone stages">
          {milestones.map((stage) => (
            <li
              key={stage}
              data-stage={stage}
              aria-current={stage === current ? "step" : undefined}
            >
              <Emblem stage={stage} />
              <span>{stage}</span>
            </li>
          ))}
        </ol>
        <p className="hint">
          Your visual stage follows your current Level, including after saved
          workout corrections.
        </p>
      </section>
    </div>
  );
}

export function CharacterScreen() {
  const router = useRouter();
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: LevelProgress }
  >({ kind: "loading" });
  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    void api<LevelProgress>("/api/gamification")
      .then((data) => {
        if (current) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof ApiError && error.status === 401)
          router.replace("/login");
        setState({
          kind: "error",
          message:
            error instanceof ApiError && error.status === 401
              ? "Please sign in again."
              : "Could not load your Character. Please try again.",
        });
      });
    return () => {
      current = false;
    };
  }, [refresh, router]);
  return (
    <>
      <div className="section-heading">
        <h1>Character</h1>
        <button
          className="quiet"
          disabled={state.kind === "loading"}
          onClick={() => {
            setState({ kind: "loading" });
            setRefresh((value) => value + 1);
          }}
        >
          Refresh Character
        </button>
      </div>
      <p className="lede">Built from your saved training.</p>
      {state.kind === "loading" ? (
        <section className="card character-pending" role="status">
          Loading Character…
        </section>
      ) : state.kind === "error" ? (
        <section className="card error" role="alert">
          {state.message}
        </section>
      ) : (
        <CharacterView data={state.data} />
      )}
    </>
  );
}
