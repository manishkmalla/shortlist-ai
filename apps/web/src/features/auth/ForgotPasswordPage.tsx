import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import { Button, Input } from '../../components/ui';
import { AuthLayout, FormError } from './AuthLayout';
import { authClient } from './authClient';
import { authErrorMessage } from './errors';
import { forgotSchema } from './schemas';

type Values = z.infer<typeof forgotSchema>;

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(forgotSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await authClient.requestPasswordReset(email);
      navigate('/reset-password', { state: { email } });
    } catch (e) {
      setError(authErrorMessage(e));
    }
  });

  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a code to set a new password.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Button type="submit" loading={isSubmitting} className="w-full">
          Send code
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
