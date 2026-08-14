export function compactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

export function storyDate(value: string) {
  const normalized = value.replace(/([+-]\d{2}:\d{2})$/, "$1");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ");
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function initials(name: string) {
  const letters = Array.from(name.normalize("NFKC")).filter((char) => /[\p{L}\p{N}]/u.test(char));
  return (letters.slice(0, 2).join("") || "AI").toUpperCase();
}

export function avatarGradient(seed: string) {
  let hue = 0;
  for (const char of seed) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${hue} 78% 72%), hsl(${(hue + 52) % 360} 72% 52%))`;
}
