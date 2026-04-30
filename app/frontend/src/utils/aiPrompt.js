export const ADDITIONAL_QUESTION_MAX_LENGTH = 255

export function normalizeAdditionalQuestion(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || null
}