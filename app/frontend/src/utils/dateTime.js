/**
 * dateTime.js - Date and time formatting utilities
 * @module dateTime
 */

/**
 * Pads a number to 2 digits with leading zero
 * @param {number} value - Number to pad
 * @returns {string} Padded string
 */
export const pad2 = (value) => String(value).padStart(2, '0')

export function formatDateTimeValue(year, month, day, hour, minute, second) {
  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
}