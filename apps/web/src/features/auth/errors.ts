/** Map Cognito error names to messages that are safe and helpful to show. */
const messages: Record<string, string> = {
  NotAuthorizedException: 'Incorrect email or password.',
  UserNotFoundException: 'Incorrect email or password.',
  UsernameExistsException: 'An account with this email already exists. Try signing in.',
  InvalidPasswordException: 'Password does not meet the requirements.',
  CodeMismatchException: 'That code is not correct. Check the email and try again.',
  ExpiredCodeException: 'That code has expired. Request a new one.',
  LimitExceededException: 'Too many attempts. Please wait a few minutes and try again.',
  TooManyRequestsException: 'Too many attempts. Please wait a few minutes and try again.',
  TooManyFailedAttemptsException: 'Too many attempts. Please wait a few minutes and try again.',
  NetworkError: 'Network problem. Check your connection and try again.',
};

export function authErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return messages[name] ?? 'Something went wrong. Please try again.';
}
