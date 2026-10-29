import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const env = process.env;
const isTest = env.NODE_ENV === 'test' || env.VITEST === 'true';

export const config = {
  env: env.NODE_ENV ?? 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest,
  port: Number(env.PORT ?? 3000),
  databaseUrl: isTest
    ? env.TEST_DATABASE_URL ?? 'postgres://crm:crm_dev@localhost:5432/crm_recluta_test'
    : env.DATABASE_URL ?? 'postgres://crm:crm_dev@localhost:5432/crm_recluta',
  publicBaseUrl: env.PUBLIC_BASE_URL ?? 'http://localhost:5173',
  otpSecret: env.OTP_SECRET ?? (env.NODE_ENV === 'production' ? '' : 'dev-only-otp-secret'),
  deliveryMode: env.DELIVERY_MODE ?? 'sandbox',
  // Solo se expone el código OTP en sandbox y nunca en producción.
  exposeDevOtp: env.NODE_ENV !== 'production' && (env.DELIVERY_MODE ?? 'sandbox') === 'sandbox' && env.EXPOSE_DEV_OTP !== 'false',
  timezone: env.APP_TIMEZONE ?? 'America/Mexico_City',
  rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', fileURLToPath(import.meta.url).includes('/dist/') ? '..' : ''),
};

if (config.isProduction && (!config.otpSecret || config.otpSecret.length < 32)) {
  throw new Error('OTP_SECRET debe configurarse (mínimo 32 caracteres) en producción');
}
