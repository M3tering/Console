import { connect } from "mqtt";
import { handleUplinks } from "../../src/logic/mqtt";
import { enqueue } from "../../src/logic/grpc";
import { interact } from "../../src/logic/arweave";
import { encode, encodeTransaction } from "../../src/logic/encode";
import { getGPS } from "../../src/logic/gps";
import {
  getMeterByPublicKey,
  insertTransaction,
  updateMeterNonce,
} from "../../src/store/sqlite";
import {
  getProverURL,
  sendPendingTransactionsToProver
} from "../../src/logic/verify";

// Mock all dependencies
jest.mock("mqtt");
jest.mock("../../src/logic/grpc");
jest.mock("../../src/logic/arweave");
jest.mock("../../src/logic/encode");
jest.mock("../../src/logic/gps");
jest.mock("../../src/store/sqlite");
jest.mock("../../src/logic/verify");

describe("MQTT Message Callback", () => {
  let mockClient: any;
  let messageCallback: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock the MQTT client
    mockClient = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };

    (connect as jest.Mock).mockReturnValue(mockClient);

    // Mock environment variables
    process.env.CHIRPSTACK_HOST = "test-host";
    process.env.APPLICATION_ID = "test-app-id";
    process.env.PREFERRED_PROVER_NODE = "test-preferred-prover";

    // Setup the client and capture the message callback
    handleUplinks();
    
    // Extract the message callback from the mock calls
    const onCalls = mockClient.on.mock.calls;
    const messageCall = onCalls.find((call: any) => call[0] === "message");
    messageCallback = messageCall[1];
  });

  afterEach(() => {
    delete process.env.CHIRPSTACK_HOST;
    delete process.env.APPLICATION_ID;
  });

  describe("Message processing", () => {
    it("should process valid message successfully", async () => {
      // Mock dependencies
      const mockMeter = {
        publicKey: "test-public-key",
        contractId: "test-contract-id",
        latestNonce: 5,
      };
      
      const mockPayload = [
        JSON.stringify([6, 220, 10, 2.5]), // [nonce, voltage, current, energy]
        "test-signature",
        "test-public-key",
      ];
      
      const mockMessage = {
        data: Buffer.from(JSON.stringify(mockPayload)).toString("base64"),
        deviceInfo: { devEui: "test-dev-eui" },
      };
      
      const mockBlob = Buffer.from(JSON.stringify(mockMessage));
      
      const mockInteractResult = { nonce: 6, is_on: true };
      const mockTransactionBytes = [1, 2, 3, 4];
      const mockGPS = [12.34, 56.78];
      const mockEncodedResult = [5, 6, 7, 8];

      // Setup mocks
      (getMeterByPublicKey as jest.Mock).mockReturnValue(mockMeter);
      (getGPS as jest.Mock).mockReturnValue(mockGPS);
      (encodeTransaction as jest.Mock).mockReturnValue(mockTransactionBytes);
      (interact as jest.Mock).mockResolvedValue(mockInteractResult);
      (getProverURL as jest.Mock).mockResolvedValue("test-prover-url");
      (sendPendingTransactionsToProver as jest.Mock).mockResolvedValue(void 0);
      (encode as jest.Mock).mockReturnValue(mockEncodedResult);

      // Execute the callback
      await messageCallback("test-topic", mockBlob);

      // Verify calls
      expect(getMeterByPublicKey).toHaveBeenCalledWith("test-public-key");
      expect(getGPS).toHaveBeenCalled();
      expect(encodeTransaction).toHaveBeenCalledWith({
        nonce: 5, // Uses meter's latestNonce
        energy: 2.5,
        signature: "test-signature",
        voltage: 220,
        deviceId: "test-public-key",
        longitude: 56.78,
        latitude: 12.34,
      });
      expect(interact).toHaveBeenCalledWith(
        "test-contract-id",
        5,
        mockPayload,
        mockTransactionBytes
      );
      expect(sendPendingTransactionsToProver).toHaveBeenCalledWith("test-prover-url");
      expect(updateMeterNonce).toHaveBeenCalledWith("test-public-key", 6);
      expect(insertTransaction).toHaveBeenCalledWith({
        nonce: 5,
        energy: 2.5,
        signature: "test-signature",
        voltage: 220,
        deviceId: "test-public-key",
        longitude: 56.78,
        latitude: 12.34,
        identifier: "test-public-key",
        receivedAt: expect.any(Number),
        raw: expect.any(String),
      });
      expect(enqueue).toHaveBeenCalledWith("test-dev-eui", mockEncodedResult);
    });

    it("should handle meter not found", async () => {
      const mockPayload = [
        JSON.stringify([1, 220, 10, 2.5]),
        "test-signature", 
        "unknown-public-key",
      ];
      
      const mockMessage = {
        data: Buffer.from(JSON.stringify(mockPayload)).toString("base64"),
        deviceInfo: { devEui: "test-dev-eui" },
      };
      
      const mockBlob = Buffer.from(JSON.stringify(mockMessage));
      
      // Mock meter not found
      (getMeterByPublicKey as jest.Mock).mockReturnValue(null);

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      // Execute the callback
      await messageCallback("test-topic", mockBlob);

      // Verify error handling
      expect(consoleSpy).toHaveBeenCalledWith(
        "Meter not found for public key:",
        "unknown-public-key"
      );
      expect(encodeTransaction).not.toHaveBeenCalled();
      expect(interact).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it("should handle invalid nonce sequence", async () => {
      const mockMeter = {
        publicKey: "test-public-key",
        contractId: "test-contract-id", 
        latestNonce: 5,
      };
      
      // Nonce is not sequential (should be 6, but is 8)
      const mockPayload = [
        JSON.stringify([8, 220, 10, 2.5]), // Invalid nonce sequence
        "test-signature",
        "test-public-key",
      ];
      
      const mockMessage = {
        data: Buffer.from(JSON.stringify(mockPayload)).toString("base64"),
        deviceInfo: { devEui: "test-dev-eui" },
      };
      
      const mockBlob = Buffer.from(JSON.stringify(mockMessage));
      
      const mockInteractResult = { nonce: 6, is_on: true }; // Different nonce returned
      const mockTransactionBytes = [1, 2, 3, 4];
      const mockGPS = [12.34, 56.78];

      // Setup mocks
      (getMeterByPublicKey as jest.Mock).mockReturnValue(mockMeter);
      (getGPS as jest.Mock).mockReturnValue(mockGPS);
      (encodeTransaction as jest.Mock).mockReturnValue(mockTransactionBytes);
      (interact as jest.Mock).mockResolvedValue(mockInteractResult);

      // Execute the callback
      await messageCallback("test-topic", mockBlob);

      // Verify that nonce is NOT updated (since device nonce !== latestNonce + 1)
      expect(updateMeterNonce).not.toHaveBeenCalled();
      expect(insertTransaction).not.toHaveBeenCalled();
      expect(sendPendingTransactionsToProver).not.toHaveBeenCalled();
    });

    it("should handle correct nonce sequence", async () => {
      const mockMeter = {
        publicKey: "test-public-key",
        contractId: "test-contract-id",
        latestNonce: 5,
      };
      
      // Correct nonce sequence (latestNonce + 1)
      const mockPayload = [
        JSON.stringify([6, 220, 10, 2.5]), 
        "test-signature",
        "test-public-key",
      ];
      
      const mockMessage = {
        data: Buffer.from(JSON.stringify(mockPayload)).toString("base64"),
        deviceInfo: { devEui: "test-dev-eui" },
      };
      
      const mockBlob = Buffer.from(JSON.stringify(mockMessage));
      
      const mockInteractResult = { nonce: 6, is_on: true };
      const mockTransactionBytes = [1, 2, 3, 4];
      const mockGPS = [12.34, 56.78];

      // Setup mocks
      (getMeterByPublicKey as jest.Mock).mockReturnValue(mockMeter);
      (getGPS as jest.Mock).mockReturnValue(mockGPS);
      (encodeTransaction as jest.Mock).mockReturnValue(mockTransactionBytes);
      (interact as jest.Mock).mockResolvedValue(mockInteractResult);
      (getProverURL as jest.Mock).mockResolvedValue("test-prover-url");
      (sendPendingTransactionsToProver as jest.Mock).mockResolvedValue(void 0);

      // Execute the callback
      await messageCallback("test-topic", mockBlob);

      // Verify that nonce IS updated (since device nonce === latestNonce + 1)
      expect(updateMeterNonce).toHaveBeenCalledWith("test-public-key", 6);
      expect(insertTransaction).toHaveBeenCalled();
      expect(sendPendingTransactionsToProver).toHaveBeenCalledWith("test-prover-url");
    });

    it("should handle missing payload data gracefully", async () => {
      const mockPayload = [
        JSON.stringify([1, 220]), // Missing energy value
        "test-signature",
        "test-public-key",
      ];
      
      const mockMessage = {
        data: Buffer.from(JSON.stringify(mockPayload)).toString("base64"),
        deviceInfo: { devEui: "test-dev-eui" },
      };
      
      const mockBlob = Buffer.from(JSON.stringify(mockMessage));
      
      const mockMeter = {
        publicKey: "test-public-key",
        contractId: "test-contract-id",
        latestNonce: 0,
      };

      (getMeterByPublicKey as jest.Mock).mockReturnValue(mockMeter);
      (getGPS as jest.Mock).mockReturnValue([12.34, 56.78]);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      // Execute the callback
      await messageCallback("test-topic", mockBlob);

      // Should catch error and log it
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it("should handle JSON parsing errors", async () => {
      // Invalid JSON
      const mockBlob = Buffer.from("invalid-json");
      
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      // Execute the callback
      await messageCallback("test-topic", mockBlob);

      // Should catch error and log it
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it("should handle arweave interaction errors", async () => {
      const mockMeter = {
        publicKey: "test-public-key",
        contractId: "test-contract-id",
        latestNonce: 5,
      };
      
      const mockPayload = [
        JSON.stringify([6, 220, 10, 2.5]),
        "test-signature",
        "test-public-key",
      ];
      
      const mockMessage = {
        data: Buffer.from(JSON.stringify(mockPayload)).toString("base64"),
        deviceInfo: { devEui: "test-dev-eui" },
      };
      
      const mockBlob = Buffer.from(JSON.stringify(mockMessage));

      // Setup mocks
      (getMeterByPublicKey as jest.Mock).mockReturnValue(mockMeter);
      (getGPS as jest.Mock).mockReturnValue([12.34, 56.78]);
      (encodeTransaction as jest.Mock).mockReturnValue([1, 2, 3, 4]);
      (interact as jest.Mock).mockRejectedValue(new Error("Arweave error"));
      (getProverURL as jest.Mock).mockResolvedValue("test-prover-url");
      (sendPendingTransactionsToProver as jest.Mock).mockResolvedValue(void 0);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      // Execute the callback
      await messageCallback("test-topic", mockBlob);

      // Should catch error and log it
      expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it("should handle missing deviceInfo in message", async () => {
      const mockMeter = {
        publicKey: "test-public-key",
        contractId: "test-contract-id",
        latestNonce: 5,
      };
      
      const mockPayload = [
        JSON.stringify([6, 220, 10, 2.5]),
        "test-signature",
        "test-public-key",
      ];
      
      // Message without deviceInfo
      const mockMessage = {
        data: Buffer.from(JSON.stringify(mockPayload)).toString("base64"),
        // missing deviceInfo
      };
      
      const mockBlob = Buffer.from(JSON.stringify(mockMessage));
      
      const mockInteractResult = { nonce: 6, is_on: true };

      // Setup mocks
      (getMeterByPublicKey as jest.Mock).mockReturnValue(mockMeter);
      (getGPS as jest.Mock).mockReturnValue([12.34, 56.78]);
      (encodeTransaction as jest.Mock).mockReturnValue([1, 2, 3, 4]);
      (interact as jest.Mock).mockResolvedValue(mockInteractResult);
      (encode as jest.Mock).mockReturnValue([5, 6, 7, 8]);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      // Execute the callback
      await messageCallback("test-topic", mockBlob);

      // Should handle the error when trying to access deviceInfo.devEui
      expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it("should handle empty or null result from interact", async () => {
      const mockMeter = {
        publicKey: "test-public-key",
        contractId: "test-contract-id",
        latestNonce: 5,
      };
      
      const mockPayload = [
        JSON.stringify([6, 220, 10, 2.5]),
        "test-signature",
        "test-public-key",
      ];
      
      const mockMessage = {
        data: Buffer.from(JSON.stringify(mockPayload)).toString("base64"),
        deviceInfo: { devEui: "test-dev-eui" },
      };
      
      const mockBlob = Buffer.from(JSON.stringify(mockMessage));

      // Setup mocks with null result
      (getMeterByPublicKey as jest.Mock).mockReturnValue(mockMeter);
      (getGPS as jest.Mock).mockReturnValue([12.34, 56.78]);
      (encodeTransaction as jest.Mock).mockReturnValue([1, 2, 3, 4]);
      (interact as jest.Mock).mockResolvedValue(null);
      (getProverURL as jest.Mock).mockResolvedValue("test-prover-url");
      (sendPendingTransactionsToProver as jest.Mock).mockResolvedValue(void 0);

      // Execute the callback
      await messageCallback("test-topic", mockBlob);

      // Should not call enqueue when result is null
      expect(enqueue).not.toHaveBeenCalled();
      expect(sendPendingTransactionsToProver).toHaveBeenCalled();
    });

    it("should handle meter with zero latestNonce", async () => {
      const mockMeter = {
        publicKey: "test-public-key",
        contractId: "test-contract-id",
        latestNonce: 0,
      };
      
      const mockPayload = [
        JSON.stringify([1, 220, 10, 2.5]), // nonce = 1 (latestNonce + 1)
        "test-signature",
        "test-public-key",
      ];
      
      const mockMessage = {
        data: Buffer.from(JSON.stringify(mockPayload)).toString("base64"),
        deviceInfo: { devEui: "test-dev-eui" },
      };
      
      const mockBlob = Buffer.from(JSON.stringify(mockMessage));
      
      const mockInteractResult = { nonce: 1, is_on: true };
      const mockTransactionBytes = [1, 2, 3, 4];
      const mockGPS = [12.34, 56.78];

      // Setup mocks
      (getMeterByPublicKey as jest.Mock).mockReturnValue(mockMeter);
      (getGPS as jest.Mock).mockReturnValue(mockGPS);
      (encodeTransaction as jest.Mock).mockReturnValue(mockTransactionBytes);
      (interact as jest.Mock).mockResolvedValue(mockInteractResult);
      (getProverURL as jest.Mock).mockResolvedValue("test-prover-url");
      (sendPendingTransactionsToProver as jest.Mock).mockResolvedValue(void 0);

      // Execute the callback
      await messageCallback("test-topic", mockBlob);

      // Verify that nonce IS updated (since device nonce === latestNonce + 1 = 1)
      expect(updateMeterNonce).toHaveBeenCalledWith("test-public-key", 1);
      expect(insertTransaction).toHaveBeenCalled();
      expect(sendPendingTransactionsToProver).toHaveBeenCalledWith("test-prover-url");
    });
  });

  describe("MQTT Client Setup", () => {
    it("should initialize MQTT client with correct configuration", () => {
      expect(connect).toHaveBeenCalledWith({
        host: "test-host",
        port: 1883,
        clean: true,
        connectTimeout: 9000,
        reconnectPeriod: 1000,
      });
    });

    it("should set up connect event handler", () => {
      const connectCall = mockClient.on.mock.calls.find(
        (call: any) => call[0] === "connect"
      );
      expect(connectCall).toBeDefined();
      
      // Test the connect callback
      const connectCallback = connectCall[1];
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      
      connectCallback();
      
      expect(mockClient.subscribe).toHaveBeenCalledWith(
        `application/test-app-id/device/+/event/up`,
        expect.any(Function)
      );
      
      // Test the subscribe callback
      const subscribeCallback = mockClient.subscribe.mock.calls[0][1];
      subscribeCallback();
      
      expect(consoleSpy).toHaveBeenCalledWith("\nConnected & Subscribed\n");
      
      consoleSpy.mockRestore();
    });

    it("should set up message event handler", () => {
      const messageCall = mockClient.on.mock.calls.find(
        (call: any) => call[0] === "message"
      );
      expect(messageCall).toBeDefined();
      expect(typeof messageCall[1]).toBe("function");
    });
  });
});
