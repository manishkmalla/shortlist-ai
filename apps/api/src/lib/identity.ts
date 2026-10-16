import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { IdentityAdmin } from '../services/profileService';

/** The pool signs in by email, so each Cognito username is the user's `sub`. */
export function createIdentityAdmin(userPoolId: string): IdentityAdmin {
  const client = new CognitoIdentityProviderClient({});
  return {
    async deleteUser(userId) {
      await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: userId }));
    },
  };
}
