export function maskSecret(value: string): string {
  if (value.length === 0) return "(empty)";
  if (value.length <= 8) return "********";
  return `${"*".repeat(8)}${value.slice(-4)}`;
}

export function maskValue(value: string, secrets: Array<string | undefined>): string {
  let masked = value;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      masked = masked.split(secret).join(maskSecret(secret));
    }
  }
  return masked;
}
