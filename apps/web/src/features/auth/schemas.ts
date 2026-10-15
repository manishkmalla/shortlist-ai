import { z } from 'zod';

export const emailField = z.string().trim().min(1, 'Enter your email').email('Enter a valid email');

/** Mirrors the Cognito password policy in AuthStack (min 12, lower, upper, digit). */
export const passwordField = z
  .string()
  .min(12, 'Use at least 12 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

const codeField = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Enter your full name').max(100),
  email: emailField,
  password: passwordField,
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password'),
});

export const confirmSchema = z.object({ email: emailField, code: codeField });
export const forgotSchema = z.object({ email: emailField });
export const resetSchema = z.object({ email: emailField, code: codeField, password: passwordField });
