export function contextSeverity(remaining: number): "success" | "warning" | "error" {
  if (remaining <= 20) return "error"
  if (remaining <= 50) return "warning"
  return "success"
}
