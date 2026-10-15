import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import { Button, Input, useToast } from '../../components/ui';
import { AuthLayout, FormError } from './AuthLayout';
import { authClient } from './authClient';
import { authErrorMessage } from './errors';
import { confirmSchema } from './schemas';

type Values = z.infer<typeof confirmSchema>;

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const email = (useLocation().state as { email?: string } | null)?.email ?? '';
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(confirmSchema), defaultValues: { email } });

  const onSubmit = handleSubmit(async ({ email: addr, code }) => {
    setError(null);
    try {
      await authClient.confirmRegistration(addr, code);
      toast({ title: 'Email verified', description: 'You can sign in now.', tone: 'good' });
      navigate('/login', { state: { email: addr } });
    } catch (e) {
      setError(authErrorMessage(e));
    }
  });

  const resend = async () => {
    setError(null);
    try {
      await authClient.resendCode(getValues('email'));
      toast({ title: 'Code sent', description: 'Check your inbox.' });
    } catch (e) {
      setError(authErrorMessage(e));
    }
  };

  return (
    <AuthLayout title="Verify your email" subtitle="Enter the 6-digit code we emailed you.">
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
        <Button type="submit" loading={isSubmitting} className="w-full">
          Verify
        </Button>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        <button type="button" onClick={resend} className="font-medium text-accent dark:text-accent-dark">
          Resend code
        </button>
        <Link to="/login" className="text-slate-600 dark:text-slate-400">
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
