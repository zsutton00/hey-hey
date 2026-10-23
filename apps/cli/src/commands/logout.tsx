import { logOutAccount } from '../auth/account-logout';
import { OAuthClient } from '../auth/index';

export const runLogoutCommand = async (): Promise<boolean> => {
  console.log('Logging out...');
  const result = await logOutAccount(new OAuthClient());
  switch (result.outcome) {
    case 'not-signed-in':
      console.log('Not currently authenticated.');
      return true;
    case 'signed-out':
      console.log('Logged out. Credentials revoked and removed.');
      return true;
    case 'failed':
      console.error(`Logout failed: ${result.message}`);
      return false;
  }
};
