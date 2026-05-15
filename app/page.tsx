"use client";

import { useEffect, useMemo, useState } from "react";
import questionsData from "@/app/data/questions.json";

type Question = {
  question: string;
  options: string[];
  answer: string | string[];
  explanation: string;
  domain: string;
};

const DEFAULT_SESSION_SIZE = 30;
const REVIEW_MASTERY_TARGET = 2;
type QuizMode = "normal" | "weak" | "review";
const WEAK_AREAS_STORAGE_KEY = "dp900-weak-question-ids";

function createSeededRandom(seed: number) {
  let value = seed;

  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function shuffleArray<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function isCompleteQuestion(q: Question): boolean {
  const answerValid = Array.isArray(q.answer)
    ? q.answer.length > 0
    : typeof q.answer === "string" && q.answer.trim() !== "";
  return q.question.trim() !== "" && q.question.trim() !== " " && answerValid;
}

function buildQuizSet(
  source: Question[],
  weakQuestionIds: string[] = [],
  random: () => number = Math.random,
  sessionSize: number = DEFAULT_SESSION_SIZE,
): Question[] {
  const complete = source.filter(isCompleteQuestion);
  const weakIdSet = new Set(weakQuestionIds);
  const weakQuestions = complete.filter((item) => weakIdSet.has(item.question));
  const randomRemainder = shuffleArray(complete.filter((item) => !weakIdSet.has(item.question)), random);
  const selected = [...weakQuestions, ...randomRemainder].slice(0, Math.min(sessionSize, complete.length));

  return selected.map((item) => ({
    ...item,
    options: shuffleArray(item.options, random),
  }));
}

function categorizeQuestion(question: Question): string {
  const haystack = `${question.question} ${question.explanation} ${question.options.join(" ")}`.toLowerCase();

  if (
    haystack.includes("blob")
    || haystack.includes("storage")
    || haystack.includes("data lake")
    || haystack.includes("adls")
    || haystack.includes("archive")
    || haystack.includes("hot")
    || haystack.includes("cool")
  ) {
    return "Azure storage";
  }

  if (question.domain.toLowerCase().includes("relational")) {
    return "Relational data";
  }

  if (question.domain.toLowerCase().includes("analytics")) {
    return "Analytics workloads";
  }

  if (question.domain.toLowerCase().includes("non-relational")) {
    return "Non-relational data";
  }

  return "Core data concepts";
}

function getCorrectAnswers(question: Question): string[] {
  // If answer is already an array, use it directly
  if (Array.isArray(question.answer)) {
    return question.answer;
  }

  const normalizedAnswer = question.answer.trim();

  // Exact single-option match
  if (question.options.includes(normalizedAnswer)) {
    return [normalizedAnswer];
  }

  // Find which options appear verbatim inside the answer string.
  // This handles answers like "Option A, Option B" even when option text
  // itself contains commas (e.g. "optimized for create, read, update...").
  const matchingOptions = question.options.filter((opt) => normalizedAnswer.includes(opt));

  if (matchingOptions.length > 1) {
    return matchingOptions;
  }

  // Fall back: comma-split (for simple cases with no embedded commas)
  const splitAnswers = normalizedAnswer
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (splitAnswers.length > 1 && splitAnswers.every((item) => question.options.includes(item))) {
    return splitAnswers;
  }

  return [normalizedAnswer];
}

function areAnswerSetsEqual(selected: string[], correct: string[]): boolean {
  if (selected.length !== correct.length) {
    return false;
  }

  const selectedSet = new Set(selected);
  return correct.every((item) => selectedSet.has(item));
}

export default function Home() {
  const allQuestions = questionsData as Question[];
  const initialSessionSize = Math.min(DEFAULT_SESSION_SIZE, allQuestions.length);
  const [sessionSize, setSessionSize] = useState(initialSessionSize);
  const [quiz, setQuiz] = useState<Question[]>(() => buildQuizSet(allQuestions, [], createSeededRandom(900), initialSessionSize));
  const [hasStarted, setHasStarted] = useState(false);
  const [mode, setMode] = useState<QuizMode>("normal");
  const [index, setIndex] = useState(0);
  const [selectedChoices, setSelectedChoices] = useState<string[]>([]);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [reviewQueueIds, setReviewQueueIds] = useState<string[]>([]);
  const [reviewStreaks, setReviewStreaks] = useState<Record<string, number>>({});
  const [reviewInitialCount, setReviewInitialCount] = useState(0);
  const [reviewMasteredCount, setReviewMasteredCount] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [weakQuestionIds, setWeakQuestionIds] = useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(WEAK_AREAS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(WEAK_AREAS_STORAGE_KEY, JSON.stringify(weakQuestionIds));
  }, [weakQuestionIds]);

  const questionMap = useMemo(() => {
    return new Map(allQuestions.map((item) => [item.question, item]));
  }, [allQuestions]);

  const reviewCurrent = mode === "review" ? questionMap.get(reviewQueueIds[0]) : undefined;

  const current = reviewCurrent ?? quiz[index];
  const correctAnswers = current ? getCorrectAnswers(current) : [];
  const isMultiSelectQuestion = correctAnswers.length > 1;

  const weakCategoryStats = useMemo(() => {
    const counts = new Map<string, number>();

    weakQuestionIds.forEach((id) => {
      const question = questionMap.get(id);
      if (!question) {
        return;
      }

      const category = categorizeQuestion(question);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [questionMap, weakQuestionIds]);

  const progress = useMemo(() => {
    if (mode === "review") {
      if (reviewInitialCount === 0) {
        return 0;
      }

      return Math.round((reviewMasteredCount / reviewInitialCount) * 100);
    }

    if (quiz.length === 0) {
      return 0;
    }

    return Math.round((index / quiz.length) * 100);
  }, [index, mode, quiz.length, reviewInitialCount, reviewMasteredCount]);

  const handleSelect = (choice: string) => {
    if (!current || isSubmitted) {
      return;
    }

    if (isMultiSelectQuestion) {
      setSelectedChoices((previous) => (previous.includes(choice)
        ? previous.filter((item) => item !== choice)
        : [...previous, choice]));
      return;
    }

    setSelectedChoices([choice]);
  };

  const handleNext = () => {
    if (!current) {
      return;
    }

    if (!isSubmitted) {
      if (selectedChoices.length === 0) {
        return;
      }

      setIsSubmitted(true);
      return;
    }

    const isCorrect = areAnswerSetsEqual(selectedChoices, correctAnswers);

    if (mode === "review") {
      const currentId = current.question;
      const nextStreak = isCorrect ? (reviewStreaks[currentId] ?? 0) + 1 : 0;
      const willMasterQuestion = isCorrect && nextStreak >= REVIEW_MASTERY_TARGET;
      const wasLastQuestionInQueue = reviewQueueIds.length === 1;

      setReviewStreaks((previous) => ({
        ...previous,
        [currentId]: nextStreak,
      }));

      if (willMasterQuestion) {
        setReviewMasteredCount((value) => value + 1);
        setScore((value) => value + 1);
        setWeakQuestionIds((previous) => previous.filter((item) => item !== currentId));
        setReviewQueueIds((previous) => previous.slice(1));

        if (wasLastQuestionInQueue) {
          setIsFinished(true);
        }
      } else {
        if (!isCorrect) {
          setWeakQuestionIds((previous) => (previous.includes(currentId)
            ? previous
            : [...previous, currentId]));
        }

        setReviewQueueIds((previous) => {
          const [, ...remaining] = previous;
          return [...remaining, currentId];
        });
      }

      setSelectedChoices([]);
      setIsSubmitted(false);
      return;
    }

    if (isCorrect) {
      setScore((value) => value + 1);
      setWeakQuestionIds((previous) => previous.filter((item) => item !== current.question));
    } else {
      setWeakQuestionIds((previous) => (previous.includes(current.question)
        ? previous
        : [...previous, current.question]));
    }

    const lastQuestion = index >= quiz.length - 1;
    if (lastQuestion) {
      setIsFinished(true);
      return;
    }

    setIndex((value) => value + 1);
    setSelectedChoices([]);
    setIsSubmitted(false);
  };

  const restart = (nextMode: QuizMode, nextSessionSize: number = sessionSize) => {
    const shouldUseWeakQuestions = nextMode === "weak" && weakQuestionIds.length > 0;
    const shouldUseReview = nextMode === "review" && weakQuestionIds.length > 0;
    setHasStarted(true);
    setSessionSize(nextSessionSize);

    if (shouldUseReview) {
      const queue = shuffleArray(weakQuestionIds);
      setMode("review");
      setQuiz([]);
      setReviewQueueIds(queue);
      setReviewStreaks({});
      setReviewInitialCount(queue.length);
      setReviewMasteredCount(0);
    } else {
      setMode(shouldUseWeakQuestions ? "weak" : "normal");
      setQuiz(buildQuizSet(allQuestions, shouldUseWeakQuestions ? weakQuestionIds : [], Math.random, nextSessionSize));
      setReviewQueueIds([]);
      setReviewStreaks({});
      setReviewInitialCount(0);
      setReviewMasteredCount(0);
    }

    setIndex(0);
    setSelectedChoices([]);
    setIsSubmitted(false);
    setScore(0);
    setIsFinished(false);
  };

  const resetWeakAreas = () => {
    setWeakQuestionIds([]);
    if (mode === "weak" || mode === "review") {
      setMode("normal");
      setQuiz(buildQuizSet(allQuestions, [], Math.random, sessionSize));
      setReviewQueueIds([]);
      setReviewStreaks({});
      setReviewInitialCount(0);
      setReviewMasteredCount(0);
    }
  };

  const sessionSizeOptions = [10, 30, 50, allQuestions.length].filter((value, index, list) => {
    return value <= allQuestions.length && list.indexOf(value) === index;
  });

  if (quiz.length === 0) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
        <p>No questions found in the quiz data file.</p>
      </main>
    );
  }

  if (!hasStarted) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0f172a,#020617)] p-5 text-zinc-100">
        <section className="mx-auto mt-8 w-full max-w-xl rounded-3xl border border-cyan-300/20 bg-zinc-900/70 p-6 shadow-[0_20px_80px_rgba(8,145,178,0.2)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">DP-900 Revision Quiz</p>
          <h1 className="mt-2 text-3xl font-semibold">Choose Your Session</h1>
          <p className="mt-3 text-sm text-zinc-300">Question bank: {allQuestions.length}</p>
          <p className="mt-1 text-sm text-zinc-300">Weak question bank: {mounted ? weakQuestionIds.length : 0}</p>

          {mounted && weakCategoryStats.length > 0 ? (
            <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-100/5 p-3 text-sm">
              <p className="font-semibold text-cyan-100">Weak areas by category</p>
              <div className="mt-2 space-y-1 text-zinc-200">
                {weakCategoryStats.map((item) => (
                  <p key={item.category}>{item.category}: {item.count} wrong</p>
                ))}
              </div>
            </div>
          ) : null}

          <label className="mt-6 block text-sm text-zinc-200" htmlFor="session-size-start">
            Session length
          </label>
          <select
            id="session-size-start"
            value={sessionSize}
            onChange={(event) => setSessionSize(Number(event.target.value))}
            className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
          >
            {sessionSizeOptions.map((value) => (
              <option key={value} value={value}>
                {value === allQuestions.length ? `All (${value})` : value}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => restart("normal", sessionSize)}
            className="mt-8 w-full rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-zinc-900 transition hover:bg-cyan-300"
          >
            Start New Set
          </button>
          <button
            type="button"
            onClick={() => restart("weak", sessionSize)}
            disabled={!mounted || weakQuestionIds.length === 0}
            className="mt-3 w-full rounded-xl border border-cyan-300/40 bg-transparent px-4 py-3 font-semibold text-cyan-100 transition enabled:hover:bg-cyan-100/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Practice Weak Areas First
          </button>
          <button
            type="button"
            onClick={() => restart("review", sessionSize)}
            disabled={!mounted || weakQuestionIds.length === 0}
            className="mt-3 w-full rounded-xl border border-amber-300/40 bg-transparent px-4 py-3 font-semibold text-amber-100 transition enabled:hover:bg-amber-100/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Review Weak Questions
          </button>
        </section>
      </main>
    );
  }

  if (isFinished) {
    const percentage = Math.round((score / quiz.length) * 100);

    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0f172a,#020617)] p-5 text-zinc-100">
        <section className="mx-auto mt-8 w-full max-w-xl rounded-3xl border border-cyan-300/20 bg-zinc-900/70 p-6 shadow-[0_20px_80px_rgba(8,145,178,0.2)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Session Complete</p>
          <h1 className="mt-2 text-3xl font-semibold">DP-900 Revision Quiz</h1>
          <p className="mt-6 text-lg">Score: {score} / {mode === "review" ? reviewInitialCount : quiz.length}</p>
          <p className="mt-2 text-4xl font-bold text-cyan-300">{percentage}%</p>
          <p className="mt-4 text-sm text-zinc-300">Weak question bank: {mounted ? weakQuestionIds.length : 0}</p>

          {mode === "review" ? (
            <p className="mt-1 text-sm text-zinc-300">Mastery target per weak question: {REVIEW_MASTERY_TARGET} correct answers</p>
          ) : null}

          {mounted && weakCategoryStats.length > 0 ? (
            <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-100/5 p-3 text-sm">
              <p className="font-semibold text-cyan-100">Weak areas by category</p>
              <div className="mt-2 space-y-1 text-zinc-200">
                {weakCategoryStats.map((item) => (
                  <p key={item.category}>{item.category}: {item.count} wrong</p>
                ))}
              </div>
            </div>
          ) : null}

          <label className="mt-6 block text-sm text-zinc-200" htmlFor="session-size">
            Next session length
          </label>
          <select
            id="session-size"
            value={sessionSize}
            onChange={(event) => setSessionSize(Number(event.target.value))}
            className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
          >
            {sessionSizeOptions.map((value) => (
              <option key={value} value={value}>
                {value === allQuestions.length ? `All (${value})` : value}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => restart("normal", sessionSize)}
            className="mt-8 w-full rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-zinc-900 transition hover:bg-cyan-300"
          >
            Start New Set
          </button>
          <button
            type="button"
            onClick={() => restart("weak", sessionSize)}
            disabled={!mounted || weakQuestionIds.length === 0}
            className="mt-3 w-full rounded-xl border border-cyan-300/40 bg-transparent px-4 py-3 font-semibold text-cyan-100 transition enabled:hover:bg-cyan-100/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Practice Weak Areas First
          </button>
          <button
            type="button"
            onClick={() => restart("review", sessionSize)}
            disabled={!mounted || weakQuestionIds.length === 0}
            className="mt-3 w-full rounded-xl border border-amber-300/40 bg-transparent px-4 py-3 font-semibold text-amber-100 transition enabled:hover:bg-amber-100/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Review Weak Questions
          </button>
          <button
            type="button"
            onClick={resetWeakAreas}
            disabled={!mounted || weakQuestionIds.length === 0}
            className="mt-3 w-full rounded-xl border border-rose-300/40 bg-transparent px-4 py-3 font-semibold text-rose-100 transition enabled:hover:bg-rose-100/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset Weak Areas
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0f172a,#020617)] p-4 text-zinc-100 sm:p-6">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-cyan-300/20 bg-zinc-900/70 p-5 shadow-[0_20px_80px_rgba(8,145,178,0.2)] backdrop-blur sm:p-7">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-cyan-200">
          <span>{mode === "review" ? "Review Weak Questions" : mode === "weak" ? "DP-900 Weak Areas" : "DP-900 Quiz"}</span>
          <span>{mode === "review" ? `${reviewMasteredCount}/${reviewInitialCount}` : `${index + 1}/${quiz.length}`}</span>
        </div>

        <p className="mt-3 inline-flex rounded-full border border-cyan-200/30 px-3 py-1 text-[11px] text-cyan-100">
          {current.domain}
        </p>

        {mode === "review" ? (
          <p className="mt-2 text-xs text-zinc-300">Need {REVIEW_MASTERY_TARGET} correct answers per weak question to mark it solid.</p>
        ) : null}

        <div className="mt-4 h-2 rounded-full bg-zinc-800">
          <div
            className="h-2 rounded-full bg-cyan-300 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <h1 className="mt-6 text-xl font-semibold leading-7 sm:text-2xl">{current.question}</h1>

        {isMultiSelectQuestion ? (
          <p className="mt-2 text-xs text-zinc-300">Select all correct answers, then click Check Answer.</p>
        ) : null}

        <div className="mt-6 grid gap-3">
          {current.options.map((choice) => {
            const isCorrect = isSubmitted && correctAnswers.includes(choice);
            const isWrong = isSubmitted && selectedChoices.includes(choice) && !correctAnswers.includes(choice);
            const isSelected = selectedChoices.includes(choice);

            return (
              <button
                type="button"
                key={choice}
                onClick={() => handleSelect(choice)}
                className={`rounded-xl border px-4 py-3 text-left text-sm transition sm:text-base ${
                  isCorrect
                    ? "border-emerald-300 bg-emerald-300/20"
                    : isWrong
                      ? "border-rose-300 bg-rose-300/20"
                      : isSelected
                        ? "border-cyan-300/70 bg-cyan-300/10"
                      : "border-zinc-700 bg-zinc-800/80 hover:border-cyan-300/50"
                }`}
              >
                {choice}
              </button>
            );
          })}
        </div>

        {isSubmitted ? (
          <div className="mt-6 rounded-xl border border-cyan-200/20 bg-cyan-100/10 p-4 text-sm leading-6 text-cyan-50 sm:text-base">
            <p className="font-semibold">{areAnswerSetsEqual(selectedChoices, correctAnswers) ? "Correct" : "Not quite"}</p>
            <p className="mt-2">{current.explanation}</p>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-sm text-zinc-300">Score: {score}</p>
          <button
            type="button"
            onClick={handleNext}
            disabled={selectedChoices.length === 0}
            className="rounded-xl bg-cyan-400 px-5 py-2.5 font-semibold text-zinc-900 transition enabled:hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {!isSubmitted ? "Check Answer" : index === quiz.length - 1 ? "Finish" : "Next"}
          </button>
        </div>

        <p className="mt-4 text-xs text-zinc-400">
          Practice set aligned to Microsoft Learn DP-900 skill areas. Questions are original and not official exam items.
        </p>
      </section>
    </main>
  );
}
