export function parseTagNames(value) {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}
