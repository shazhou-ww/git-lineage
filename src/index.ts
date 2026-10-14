/**
 * Return a friendly greeting for a non-empty name.
 */
export function greet(name: string): string {
  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw new TypeError("name must not be empty");
  }

  return `Hello, ${normalizedName}!`;
}
