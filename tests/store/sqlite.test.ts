import { raw } from "body-parser";
import setupDatabase, {
  saveMeter,
  getMeterByPublicKey,
  getAllMeterRecords,
  deleteMeterByPublicKey,
  updateMeterNonce,
  getUnverifiedTransactionRecords,
  markTransactionAsVerified,
  deleteVerifiedTransactionRecords,
  insertTransaction,
  deleteDatabase,
} from "../../src/store/sqlite";

beforeEach(() => {
  setupDatabase("test.db");
});

afterEach(() => {
  // Clean up test database
  deleteDatabase("test.db");
});

it("should have no meters and transactions", () => {
  const meters = getAllMeterRecords();
  const transactions = getUnverifiedTransactionRecords();
  expect(meters).toHaveLength(0);
  expect(transactions).toHaveLength(0);
});

it("should insert meter", () => {
  const meterData = {
    publicKey: "test_public_key",
    tokenId: 1,
    contractId: "test_contract_id",
    latestNonce: 0,
  };
  saveMeter(meterData);

  const meters = getAllMeterRecords();
  expect(meters).toHaveLength(1);
});

it("should get meter by public key", () => {
  const meterData = {
    publicKey: "test_public_key",
    tokenId: 1,
    contractId: "test_contract_id",
    latestNonce: 0,
  };
  saveMeter(meterData);

  const retrievedMeter = getMeterByPublicKey(meterData.publicKey);
  expect(retrievedMeter).toEqual(meterData);
});

it("should delete meter", () => {
  const meterData = {
    publicKey: "test_public_key",
    tokenId: 1,
    contractId: "test_contract_id",
    latestNonce: 0,
  };
  saveMeter(meterData);
  const deleted = deleteMeterByPublicKey(meterData.publicKey);
  expect(deleted).toBe(true);
  const meters = getAllMeterRecords();
  expect(meters).toHaveLength(0);
});

it("should update meter nonce", () => {
  const meterData = {
    publicKey: "test_public_key",
    tokenId: 1,
    contractId: "test_contract_id",
    latestNonce: 0,
  };
  saveMeter(meterData);

  const updated = updateMeterNonce(meterData.publicKey, 5);
  expect(updated).toBe(true);

  const updatedMeter = getMeterByPublicKey(meterData.publicKey);
  expect(updatedMeter?.latestNonce).toBe(5);
});

it("should insert transaction", () => {
  const transactionData = {
    nonce: 1,
    energy: 2.222,
    signature: "signature",
    voltage: 220,
    identifier: "test_identifier",
    longitude: 123.456,
    latitude: 78.91,
    receivedAt: Date.now(),
    raw: ""
  };
  insertTransaction(transactionData);

  const transactions = getUnverifiedTransactionRecords();
  expect(transactions).toHaveLength(1);
  expect(transactions[0]).toEqual({ ...transactionData, verified: 0 });
});

it("should mark transaction as verified", () => {
  const transactionData = {
    nonce: 1,
    energy: 2.222,
    signature: "signature",
    voltage: 220,
    identifier: "test_identifier",
    longitude: 123.456,
    latitude: 78.91,
    receivedAt: Date.now(),
  };

  markTransactionAsVerified(transactionData.nonce);
  const verifiedTransactions = getUnverifiedTransactionRecords();
  expect(verifiedTransactions).toHaveLength(0);
});

it("should delete verified transactions", () => {
  const transactionData = {
    nonce: 1,
    energy: 2.222,
    signature: "signature",
    voltage: 220,
    identifier: "test_identifier",
    longitude: 123.456,
    latitude: 78.91,
    verified: true,
    receivedAt: Date.now(),
    raw: ""
  };
  insertTransaction(transactionData);

  const deleted = deleteVerifiedTransactionRecords();
  expect(deleted).toBe(1);

  const transactions = getUnverifiedTransactionRecords();
  expect(transactions).toHaveLength(0);
});
