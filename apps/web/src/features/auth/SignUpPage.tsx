import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import { Button, Input } from '../../components/ui';
import { AuthLayout, FormError } from './AuthLayout';
import { authClient } from './authClient';
import { authErrorMessage } from './errors';
import { signUpSchema } from './schemas';

type Values = z.infer<typeof signUpSchema>;

export function SignUpPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(signUpSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await authClient.register(values);
      navigate('/verify', { state: { email: values.email } });
    } catch (e) {
      setError(authErrorMessage(e));
    }
  });

  return (
    <AuthLayout title="Create your account" subtitle="Free to join. You bring your own Anthropic API key.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Input label="Full name" autoComplete="name" error={errors.name?.message} {...register('name')} />
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters with upper and lower case letters and a number."
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" loading={isSubmitting} className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-accent dark:text-accent-dark">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
