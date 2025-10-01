import { raw } from "body-parser";
import setupDatabase, {
  saveMeter,
  getMeterByPublicKey,
  getAllMeterRecords,
  deleteMeterByPublicKey,
  updateMeterNonce,
  insertTransaction,
  deleteDatabase,
  getMeterByDevEui,
  updateMeterDevEui,
  getAllTransactionRecords,
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
  const transactions = getAllTransactionRecords();
  expect(meters).toHaveLength(0);
  expect(transactions).toHaveLength(0);
});

it("should insert meter without devEui", () => {
  const meterData = {
    publicKey: "test_public_key",
    tokenId: 1,
    latestNonce: 0,
    devEui: null,
  };
  saveMeter(meterData);

  const meters = getAllMeterRecords();
  expect(meters).toHaveLength(1);
});

it("should insert meter with devEui", () => {
  const meterData = {
    publicKey: "test_public_key",
    tokenId: 1,
    latestNonce: 0,
    devEui: "test_dev_eui",
  };
  saveMeter(meterData);

  const meters = getAllMeterRecords();
  expect(meters).toHaveLength(1);
  expect(meters[0].devEui).toBe("test_dev_eui");
});

it("should get meter by public key", () => {
  const meterData = {
    publicKey: "test_public_key",
    tokenId: 1,
    latestNonce: 0,
    devEui: "test_dev_eui",
  };
  saveMeter(meterData);

  const retrievedMeter = getMeterByPublicKey(meterData.publicKey);
  expect(retrievedMeter).toEqual(meterData);
});

it("should get meter by device EUI", () => {
  const meterData = {
    publicKey: "test_public_key",
    tokenId: 1,
    latestNonce: 0,
    devEui: "test_dev_eui",
  };
  saveMeter(meterData);

  const retrievedMeter = getMeterByDevEui(meterData.devEui);
  expect(retrievedMeter).toEqual(meterData);
});


it("should delete meter", () => {
  const meterData = {
    publicKey: "test_public_key",
    tokenId: 1,
    latestNonce: 0,
    devEui: "test_dev_eui",
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
    latestNonce: 0,
    devEui: "test_dev_eui",
  };
  saveMeter(meterData);

  const updated = updateMeterNonce(meterData.publicKey, 5);
  expect(updated).toBe(true);

  const updatedMeter = getMeterByPublicKey(meterData.publicKey);
  expect(updatedMeter?.latestNonce).toBe(5);
});

it("should update meter devEui", () => {
  const meterData = {
    publicKey: "test_public_key",
    tokenId: 1,
    latestNonce: 0,
    devEui: "test_dev_eui",
  };
  saveMeter(meterData);

  const updated = updateMeterDevEui(meterData.publicKey, "new_dev_eui");
  expect(updated).toBe(true);

  const updatedMeter = getMeterByPublicKey(meterData.publicKey);
  expect(updatedMeter?.devEui).toBe("new_dev_eui");
});

it("should insert transaction", () => {
  const transactionData = {
    nonce: 1,
    identifier: "0", // meter token ID
    receivedAt: Date.now(),
    raw: "",
  };
  insertTransaction(transactionData);

  const transactions = getAllTransactionRecords();
  expect(transactions).toHaveLength(1);
  expect(transactions[0]).toEqual({ ...transactionData });
});
