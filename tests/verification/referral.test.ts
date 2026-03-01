import { describe, it, expect } from 'vitest';
import { generateReferralCode, buildReferralLink } from '../../src/verification/referral.js';

describe('Referral Codes', () => {
  describe('generateReferralCode', () => {
    it('generates an 8-character hex code', () => {
      const code = generateReferralCode('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
      expect(code).toMatch(/^[0-9a-f]{8}$/);
    });

    it('is deterministic for the same wallet', () => {
      const wallet = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
      const code1 = generateReferralCode(wallet);
      const code2 = generateReferralCode(wallet);
      expect(code1).toBe(code2);
    });

    it('is case-insensitive (normalizes to lowercase)', () => {
      const upper = generateReferralCode('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
      const lower = generateReferralCode('0xabcdef1234567890abcdef1234567890abcdef12');
      expect(upper).toBe(lower);
    });

    it('produces different codes for different wallets', () => {
      const code1 = generateReferralCode('0x0000000000000000000000000000000000000001');
      const code2 = generateReferralCode('0x0000000000000000000000000000000000000002');
      expect(code1).not.toBe(code2);
    });
  });

  describe('buildReferralLink', () => {
    it('appends ref and referrer params', () => {
      const link = buildReferralLink(
        'https://onlyswaps.fyi',
        'a3f7c2b1',
        '0xDev1234',
      );
      const url = new URL(link);
      expect(url.searchParams.get('ref')).toBe('a3f7c2b1');
      expect(url.searchParams.get('referrer')).toBe('0xDev1234');
    });

    it('preserves existing URL params', () => {
      const link = buildReferralLink(
        'https://onlyswaps.fyi?chain=137',
        'code123',
        '0xWallet',
      );
      const url = new URL(link);
      expect(url.searchParams.get('chain')).toBe('137');
      expect(url.searchParams.get('ref')).toBe('code123');
      expect(url.searchParams.get('referrer')).toBe('0xWallet');
    });

    it('preserves path and hash', () => {
      const link = buildReferralLink(
        'https://onlyswaps.fyi/swap#top',
        'code',
        '0xAddr',
      );
      const url = new URL(link);
      expect(url.pathname).toBe('/swap');
      expect(url.hash).toBe('#top');
    });
  });
});
