import { ZeroAddress } from "ethers";
import {
  initializeVerifiersCache,
  isVerifiersCacheInitialized,
  getCachedVerifiersCount,
  getCrossChainRevenue,
} from "../../src/lib/sync";

// Mock the context module
jest.mock("../../src/services/context", () => ({
  provider: {
    resolveName: jest.fn(),
  },
  ccipRevenueReader: {
    verifierCount: jest.fn(),
    verifiers: jest.fn(),
    read: jest.fn(),
  },
}));

// Mock the retry utility
jest.mock("../../src/lib/utils", () => ({
  retry: jest.fn((fn) => fn()),
}));

describe("Verifiers Cache", () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it("should initialize cache successfully", async () => {
    const { provider, ccipRevenueReader } = require("../../src/services/context");

    // Mock successful responses
    ccipRevenueReader.verifierCount.mockResolvedValue(2n);
    ccipRevenueReader.verifiers
      .mockResolvedValueOnce(["test1.eth", "0x1234567890123456789012345678901234567890"])
      .mockResolvedValueOnce(["test2.eth", "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdef"]);

    provider.resolveName
      .mockResolvedValueOnce("0x1111111111111111111111111111111111111111")
      .mockResolvedValueOnce("0x2222222222222222222222222222222222222222");

    expect(isVerifiersCacheInitialized()).toBe(false);
    expect(getCachedVerifiersCount()).toBe(0);

    await initializeVerifiersCache();

    expect(isVerifiersCacheInitialized()).toBe(true);
    expect(getCachedVerifiersCount()).toBe(2);
    expect(ccipRevenueReader.verifierCount).toHaveBeenCalledTimes(1);
    expect(ccipRevenueReader.verifiers).toHaveBeenCalledTimes(2);
    expect(provider.resolveName).toHaveBeenCalledTimes(2);
  });

  it("should throw error if ENS resolution fails (returns null)", async () => {
    const { provider, ccipRevenueReader } = require("../../src/services/context");

    // Mock responses with ENS resolution failure
    ccipRevenueReader.verifierCount.mockResolvedValue(1n);
    ccipRevenueReader.verifiers.mockResolvedValue(["invalid.eth", "0x1234567890123456789012345678901234567890"]);
    provider.resolveName.mockResolvedValue(null); // ENS resolution fails

    await expect(initializeVerifiersCache()).rejects.toThrow("Failed to resolve ENS name: invalid.eth");

    expect(isVerifiersCacheInitialized()).toBe(false);
    expect(getCachedVerifiersCount()).toBe(0);
  });

  it("should throw error if ENS resolution fails (returns zero address)", async () => {
    const { provider, ccipRevenueReader } = require("../../src/services/context");

    // Mock responses with ENS resolution failure
    ccipRevenueReader.verifierCount.mockResolvedValue(1n);
    ccipRevenueReader.verifiers.mockResolvedValue(["invalid.eth", "0x1234567890123456789012345678901234567890"]);
    provider.resolveName.mockResolvedValue(ZeroAddress); // ENS resolution fails

    await expect(initializeVerifiersCache()).rejects.toThrow("Failed to resolve ENS name: invalid.eth");

    expect(isVerifiersCacheInitialized()).toBe(false);
    expect(getCachedVerifiersCount()).toBe(0);
  });

  it("should use cached verifiers for getCrossChainRevenue", async () => {
    const { provider, ccipRevenueReader } = require("../../src/services/context");

    // Mock successful initialization
    ccipRevenueReader.verifierCount.mockResolvedValue(1n);
    ccipRevenueReader.verifiers.mockResolvedValue(["test.eth", "0x1234567890123456789012345678901234567890"]);
    provider.resolveName.mockResolvedValue("0x1111111111111111111111111111111111111111");

    // Initialize cache
    await initializeVerifiersCache();

    // Mock revenue reading
    ccipRevenueReader.read.mockResolvedValue(1000n);

    const result = await getCrossChainRevenue(123);

    expect(result).toBe(1000);
    expect(ccipRevenueReader.read).toHaveBeenCalledWith(
      123,
      "0x1234567890123456789012345678901234567890",
      "0x1111111111111111111111111111111111111111",
      { enableCcipRead: true },
    );

    // Verify that verifierCount and verifiers are NOT called again
    expect(ccipRevenueReader.verifierCount).toHaveBeenCalledTimes(1);
    expect(ccipRevenueReader.verifiers).toHaveBeenCalledTimes(1);
  });
});
