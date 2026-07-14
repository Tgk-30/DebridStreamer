// CastRail - a horizontally scrolling row of cast members (photo + name +
// character). Mirrors the native detail cast strip. Renders nothing when empty.

import type { CastMember } from "../models/media";
import { Icon } from "./Icon";
import { isNetworkAllowed } from "../lib/networkPolicy";
import "./CastRail.css";

interface CastRailProps {
  cast: CastMember[];
  /** Optional: routes to the member's credits. There is no credits destination
   *  yet, so Detail renders the rail WITHOUT this - in which case the cards are
   *  plain, non-focusable elements. They used to be buttons regardless, which
   *  gave every card a pointer cursor, a hover lift and a tab stop for a click
   *  that could never do anything. */
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
          {members.map((member) => {
            const label = `${member.name}${member.character ? ` - ${member.character}` : ""}`;
            const body = (
              <>
                <div className="cast-photo">
                  {member.profileURL && isNetworkAllowed("images") ? (
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
              </>
            );
            return onSelect != null ? (
              <button
                key={member.id}
                type="button"
                className="cast-card"
                onClick={() => onSelect(member)}
                title={label}
              >
                {body}
              </button>
            ) : (
              <div key={member.id} className="cast-card" title={label}>
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
