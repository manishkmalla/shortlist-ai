import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import { Button, Input } from '../../components/ui';
import { useAuth } from './AuthProvider';
import { AuthLayout, FormError } from './AuthLayout';
import { authClient } from './authClient';
import { authErrorMessage } from './errors';
import { loginSchema } from './schemas';

type Values = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const state = useLocation().state as { email?: string; from?: string } | null;
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(loginSchema), defaultValues: { email: state?.email ?? '' } });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      const result = await authClient.login(email, password);
      if (result === 'needs-confirmation') {
        await authClient.resendCode(email);
        navigate('/verify', { state: { email } });
        return;
      }
      await refresh();
      navigate(state?.from ?? '/', { replace: true });
    } catch (e) {
      setError(authErrorMessage(e));
    }
  });

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" loading={isSubmitting} className="w-full">
          Sign in
        </Button>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        <Link to="/forgot-password" className="font-medium text-accent dark:text-accent-dark">
          Forgot password?
        </Link>
        <Link to="/signup" className="text-slate-600 dark:text-slate-400">
          Create account
        </Link>
      </div>
    </AuthLayout>
  );
}
