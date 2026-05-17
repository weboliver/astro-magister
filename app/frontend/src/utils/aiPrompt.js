/**
 * aiPrompt.js - Utility functions for AI prompt generation and validation
 * @module aiPrompt
 */

/**
 * Maximum length for additional question input in AI interpretation requests
 * @type {number}
 */
export const ADDITIONAL_QUESTION_MAX_LENGTH = 255

export function normalizeAdditionalQuestion(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || null
}