import type { MediaPreview, MediaType } from "../models/media";
import type { AIMovieRecommendation } from "../services/ai/models";

export type AIRecommendationSearch = (
  title: string,
  type: MediaType | null,
) => Promise<MediaPreview[]>;

/**
 * Match an AI-generated recommendation to a real catalog preview. Both Search
 * mood picks and Assistant cards use this so every clickable result opens the
 * same Detail flow with a complete media identity.
 */
export async function resolveAIRecommendation(
  recommendation: AIMovieRecommendation,
  search: AIRecommendationSearch | null,
): Promise<MediaPreview | null> {
  if (search != null) {
    const items = await search(
      recommendation.title,
      recommendation.mediaType ?? null,
    );
    const normalizedTitle = recommendation.title.trim().toLowerCase();
    const sorted = [...items].sort((left, right) => {
      const leftExact = left.title.trim().toLowerCase() === normalizedTitle ? 1 : 0;
      const rightExact = right.title.trim().toLowerCase() === normalizedTitle ? 1 : 0;
      const leftYear = recommendation.year != null && left.year === recommendation.year ? 1 : 0;
      const rightYear = recommendation.year != null && right.year === recommendation.year ? 1 : 0;
      return rightExact + rightYear - (leftExact + leftYear);
    });
    return sorted[0] ?? null;
  }

  // No local metadata service: AI responses that already carry a stable media
  // identity can still open Detail through the existing preview fallback.
  if (recommendation.mediaId != null && recommendation.mediaType != null) {
    return {
      id: recommendation.mediaId,
      type: recommendation.mediaType,
      title: recommendation.title,
      year: recommendation.year,
      posterPath: recommendation.posterPath,
    };
  }
  return null;
}
