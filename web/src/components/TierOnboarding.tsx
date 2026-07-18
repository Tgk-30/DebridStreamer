// Tier-aware welcome onboarding - the first thing a new user sees, tailored to
// which build they were given (family / friends / public). It guides them to the
// right setup; the existing FirstRunWizard / ServerSetupWizard then collect the
// actual config. Branches on useBuildProfile(); uses the AI ambient loops.

import { useState } from "react";
import { AmbientVideo, type AmbientVideoName } from "./AmbientVideo";
import { useBuildProfile, type BuildProfile } from "../lib/ServerSessionContext";
import "./TierOnboarding.css";

interface Step {
  video: AmbientVideoName;
  title: string;
  body: string;
}

const FLOWS: Record<BuildProfile, Step[]> = {
  family: [
    {
      video: "aurora",
      title: "Welcome",
      body: "This app connects to a private family server. Your library, history, and streaming all run through it - there are no keys for you to manage.",
    },
    {
      video: "secure",
      title: "Sign in to the family server",
      body: "On the next screen, enter the server address you were given and sign in with your account. That's the whole setup.",
    },
  ],
  friends: [
    {
      video: "aurora",
      title: "Your server is ready",
      body: "You're self-hosting YAWF Stream. This build already has the media keys you were given, encrypted into the server - nothing to paste.",
    },
    {
      video: "secure",
      title: "Create your owner account",
      body: "Set up your account next. Discovery and ratings work out of the box thanks to the built-in keys. Add your own debrid account in Settings to stream.",
    },
    {
      video: "cinema",
      title: "Invite your household",
      body: "Add profiles for the people you live with - with kids limits if you want - any time from Settings → Server.",
    },
  ],
  public: [
    {
      video: "aurora",
      title: "Welcome to YAWF Stream",
      body: "A streaming app you run yourself. To get going you'll add a few of your own keys - it only takes a minute.",
    },
    {
      video: "secure",
      title: "Bring your own keys",
      body: "In Settings, add a free TMDB key (artwork + discovery) and your debrid account (TorBox, Real-Debrid, AllDebrid, or Premiumize) for streams. OMDb is optional for extra ratings.",
    },
    {
      video: "cinema",
      title: "You're set",
      body: "Open any title, pick a cached stream, and play. Your watchlist and history stay on this device, or sync when you connect a server.",
    },
  ],
};

export function TierOnboarding({ onDone }: { onDone: () => void }) {
  const profile = useBuildProfile();
  const steps = FLOWS[profile];
  const [step, setStep] = useState(0);
  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="tier-onboarding" role="dialog" aria-modal="true" aria-label="Welcome">
      <AmbientVideo name={current.video} opacity={0.55} className="tier-onboarding-bg" />
      <div className="tier-onboarding-scrim" />
      <div className="tier-onboarding-card">
        <span className="tier-onboarding-eyebrow">
          {profile === "family" ? "Family" : profile === "friends" ? "Your server" : "Get started"}
        </span>
        <h1 className="tier-onboarding-title">{current.title}</h1>
        <p className="tier-onboarding-body">{current.body}</p>

        <div className="tier-onboarding-dots" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={`tier-onboarding-dot${i === step ? " is-active" : ""}`} />
          ))}
        </div>

        <div className="tier-onboarding-actions">
          <button type="button" className="tier-onboarding-skip" onClick={onDone}>
            Skip
          </button>
          <div className="tier-onboarding-nav">
            {step > 0 && (
              <button type="button" className="btn" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            <button
              type="button"
              className="btn btn-prominent"
              onClick={() => (last ? onDone() : setStep((s) => s + 1))}
            >
              {last ? "Get started" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
