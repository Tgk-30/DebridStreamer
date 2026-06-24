// WelcomeGuide — a short, beautiful feature tour shown once to new users (after
// the setup onboarding) and re-openable from Settings / ⌘K. It introduces the
// signature features as a sequence of focused "boxes" rather than dumping
// everything at once — progressive disclosure, fully skippable, keyboard-driven.
//
// Design principles applied: one idea per step, a clear icon→title→one-line copy
// hierarchy, an always-visible Skip, a visible progress indicator, motion that
// the global reduced-motion rule damps, and tokens so it themes everywhere.

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon, type IconName } from "./Icon";
import "./WelcomeGuide.css";

interface Step {
  icon: IconName;
  title: string;
  body: string;
  /** Optional keycap chips rendered under the copy (e.g. the ⌘K shortcut). */
  keys?: string[];
}

const STEPS: Step[] = [
  {
    icon: "sparkles",
    title: "Welcome to DebridStreamer",
    body: "Your whole library, beautifully in one place. Here's a 30-second tour of what makes it shine.",
  },
  {
    icon: "discover",
    title: "A cinematic home",
    body: "Discover opens on a full-bleed spotlight of what's worth watching, with rows of trending, popular, and top-rated titles.",
  },
  {
    icon: "wand-search",
    title: "Describe a vibe",
    body: "Tell the AI a mood — “cozy fall mysteries”, “mind-bending sci-fi” — and it curates a lineup made for the moment.",
  },
  {
    icon: "history",
    title: "Pick up where you left off",
    body: "Continue Watching keeps your in-progress titles at the top of the home, with a resume bar on every poster.",
  },
  {
    icon: "sliders",
    title: "Jump anywhere, instantly",
    body: "Press the shortcut any time to search, switch screens, or change themes — no hunting through menus.",
    keys: ["⌘", "K"],
  },
  {
    icon: "settings",
    title: "Make it yours",
    body: "Four themes, multiple profiles, kid-safe modes, and fine-grained appearance controls all live in Settings.",
  },
  {
    icon: "check",
    title: "You're all set",
    body: "That's the tour. Dive in — everything is a click (or ⌘K) away.",
  },
];

export function WelcomeGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const last = step === STEPS.length - 1;
  const current = STEPS[step];

  const next = useCallback(() => {
    if (last) {
      onClose();
    } else {
      setDir(1);
      setStep((s) => s + 1);
    }
  }, [last, onClose]);

  const back = useCallback(() => {
    setDir(-1);
    setStep((s) => Math.max(0, s - 1));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onClose]);

  return (
    <div
      className="welcome-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome tour"
    >
      <div className="welcome-card">
        <button
          type="button"
          className="welcome-skip"
          onClick={onClose}
          aria-label="Skip the tour"
        >
          Skip
        </button>

        <div className="welcome-stage">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              className="welcome-step"
              custom={dir}
              initial={{ opacity: 0, x: dir * 26 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -26 }}
              transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="welcome-halo">
                <Icon name={current.icon} size={30} />
              </div>
              <h2 className="welcome-title">{current.title}</h2>
              <p className="welcome-body">{current.body}</p>
              {current.keys && (
                <div className="welcome-keys" aria-hidden>
                  {current.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="welcome-dots" aria-hidden>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`welcome-dot${i === step ? " is-active" : ""}`}
            />
          ))}
        </div>

        <div className="welcome-foot">
          <button
            type="button"
            className="btn welcome-back"
            onClick={back}
            disabled={step === 0}
          >
            Back
          </button>
          <span className="welcome-count">
            {step + 1} / {STEPS.length}
          </span>
          <button type="button" className="btn btn-prominent" onClick={next}>
            {last ? "Get started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
