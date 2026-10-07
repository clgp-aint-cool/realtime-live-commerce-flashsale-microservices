export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Thiếu biến môi trường ${name}`);
  }
  return value;
}
