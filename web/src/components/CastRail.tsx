// CastRail - a horizontally scrolling row of cast members (photo + name +
// character). Mirrors the native detail cast strip. Renders nothing when empty.

import type { CastMember } from "../models/media";
import { Icon } from "./Icon";
import "./CastRail.css";

interface CastRailProps {
  cast: CastMember[];
  /** Optional: tapping a member could route to their credits (deferred). */
  onSelect?: (member: CastMember) => void;
}

export function CastRail({ cast, onSelect }: CastRailProps) {
  if (cast.length === 0) return null;

  // Cap the rail at a reasonable number of top-billed members.
  const members = cast.slice(0, 20);

  return (
    <section className="cast">
      <h2 className="cast-title">Cast</h2>
      <div className="cast-scroll rail-fade">
        <div className="cast-track">
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              className="cast-card"
              onClick={() => onSelect?.(member)}
              title={`${member.name}${member.character ? ` - ${member.character}` : ""}`}
            >
              <div className="cast-photo">
                {member.profileURL ? (
                  <img
                    src={member.profileURL}
                    alt={member.name}
                    loading="lazy"
                    draggable={false}
                  />
                ) : (
                  <div className="cast-photo-placeholder">
                    <Icon name="assistant" size={20} />
                  </div>
                )}
              </div>
              <div className="cast-name">{member.name}</div>
              {member.character && (
                <div className="cast-character t-secondary">
                  {member.character}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
