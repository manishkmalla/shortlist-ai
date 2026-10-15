import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import { Button, Input, useToast } from '../../components/ui';
import { AuthLayout, FormError } from './AuthLayout';
import { authClient } from './authClient';
import { authErrorMessage } from './errors';
import { resetSchema } from './schemas';

type Values = z.infer<typeof resetSchema>;

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const email = (useLocation().state as { email?: string } | null)?.email ?? '';
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(resetSchema), defaultValues: { email } });

  const onSubmit = handleSubmit(async ({ email: addr, code, password }) => {
    setError(null);
    try {
      await authClient.completePasswordReset(addr, code, password);
      toast({ title: 'Password updated', description: 'Sign in with your new password.', tone: 'good' });
      navigate('/login', { state: { email: addr } });
    } catch (e) {
      setError(authErrorMessage(e));
    }
  });

  return (
    <AuthLayout title="Choose a new password" subtitle="Enter the code from your email and a new password.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Input
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          error={errors.code?.message}
          {...register('code')}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters with upper and lower case letters and a number."
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" loading={isSubmitting} className="w-full">
          Update password
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-slate-600 dark:text-slate-400">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
