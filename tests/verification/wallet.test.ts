import { describe, it, expect } from 'vitest';
import { recoverAddress, verifyWalletSignature, buildRegisterMessage } from '../../src/verification/wallet.js';

// ─── Test vectors ────────────────────────────────────────────────────────────
// Generated with ethers.js v6:
//   const wallet = new ethers.Wallet(privateKey);
//   const sig = await wallet.signMessage(message);
//
// Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
// Address:     0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
// (Hardhat default account #0)

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_MESSAGE = 'hello world';
// Signature of "hello world" by the above address
const TEST_SIGNATURE = '0x5dbae23786cd5e6400c475b88dd49ae003e28c28dd141943f9d242b028a05eae43398aa40015d03a771c8b036e4525d2bf5cc8fb2a3f372f3d6f402ae69677b21c';

describe('Wallet Verification', () => {
  describe('recoverAddress', () => {
    it('recovers the correct address from a valid signature', () => {
      const recovered = recoverAddress(TEST_MESSAGE, TEST_SIGNATURE);
      expect(recovered).toBe(TEST_ADDRESS.toLowerCase());
    });

    it('handles signatures without 0x prefix', () => {
      const recovered = recoverAddress(TEST_MESSAGE, TEST_SIGNATURE.slice(2));
      expect(recovered).toBe(TEST_ADDRESS.toLowerCase());
    });

    it('returns lowercase address', () => {
      const recovered = recoverAddress(TEST_MESSAGE, TEST_SIGNATURE);
      expect(recovered).toBe(recovered.toLowerCase());
      expect(recovered.startsWith('0x')).toBe(true);
    });

    it('throws on invalid signature length', () => {
      expect(() => recoverAddress(TEST_MESSAGE, '0xdead')).toThrow('Invalid signature length');
    });

    it('throws on invalid recovery id', () => {
      // Change last byte to invalid v value (0x05 = 5, after -27 = still invalid)
      const badSig = TEST_SIGNATURE.slice(0, -2) + '05';
      expect(() => recoverAddress(TEST_MESSAGE, badSig)).toThrow();
    });

    it('recovers different address for different message', () => {
      // Recovering with wrong message should give a different address
      const recovered = recoverAddress('wrong message', TEST_SIGNATURE);
      expect(recovered).not.toBe(TEST_ADDRESS.toLowerCase());
    });
  });

  describe('verifyWalletSignature', () => {
    it('returns true for valid signature matching address', () => {
      const result = verifyWalletSignature(TEST_ADDRESS, TEST_MESSAGE, TEST_SIGNATURE);
      expect(result).toBe(true);
    });

    it('returns true regardless of address case', () => {
      const result = verifyWalletSignature(TEST_ADDRESS.toUpperCase(), TEST_MESSAGE, TEST_SIGNATURE);
      // toUpperCase makes 0X... but that's fine, we lowercase both
      expect(result).toBe(true);
    });

    it('returns false for wrong address', () => {
      const result = verifyWalletSignature('0x0000000000000000000000000000000000000001', TEST_MESSAGE, TEST_SIGNATURE);
      expect(result).toBe(false);
    });

    it('returns false for wrong message', () => {
      const result = verifyWalletSignature(TEST_ADDRESS, 'tampered message', TEST_SIGNATURE);
      expect(result).toBe(false);
    });

    it('returns false for invalid signature', () => {
      const result = verifyWalletSignature(TEST_ADDRESS, TEST_MESSAGE, '0xdead');
      expect(result).toBe(false);
    });
  });

  describe('buildRegisterMessage', () => {
    it('builds deterministic challenge message', () => {
      const msg = buildRegisterMessage('dev-123', '1709312400');
      expect(msg).toBe('agentic-ads:register:dev-123:1709312400');
    });

    it('includes developer id and timestamp', () => {
      const msg = buildRegisterMessage('abc', '999');
      expect(msg).toContain('abc');
      expect(msg).toContain('999');
      expect(msg).toContain('agentic-ads:register:');
    });
  });
});
