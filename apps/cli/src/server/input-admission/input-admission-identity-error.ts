export class InputAdmissionIdentityError extends Error {
  constructor() {
    super('Input admission identity or fingerprint mismatch.');
    this.name = 'InputAdmissionIdentityError';
  }
}
