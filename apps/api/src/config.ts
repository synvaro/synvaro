export interface ApiConfig {
  host: string;
  port: number;
  environment: 'development' | 'test' | 'production';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const environment = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const rawPort = env.API_PORT ?? '3001';
  if (
    !/^\d+$/.test(rawPort) ||
    Number(rawPort) < 1 ||
    Number(rawPort) > 65535
  ) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  const host = env.API_HOST ?? '127.0.0.1';
  if (!host.trim() || /\s/.test(host)) {
    throw new Error('API_HOST must be a non-empty host without whitespace');
  }
  return {
    host,
    port: Number(rawPort),
    environment: environment as ApiConfig['environment'],
  };
}
